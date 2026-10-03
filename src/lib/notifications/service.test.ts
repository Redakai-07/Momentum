import { describe, expect, it } from "vitest";
import {
  nativeIdForKey,
  notificationSchema,
  checkPermission,
  reconcileTracked,
  sendTestNotification,
  sendWelcomeNotification,
  uniqueNativeIds,
  type NativeNotifRecord,
} from "./service";

/**
 * Regression tests for the Android delivery bug.
 *
 * Capacitor's Local Notifications plugin defaults `isExactNotification` to
 * `true`. On Android 12+ that makes `schedule()` refuse to schedule whenever
 * the app lacks `SCHEDULE_EXACT_ALARM` access and instead launch the system
 * "Alarms & reminders" screen — so nothing was ever posted. Since Android 14
 * that access is denied by default for apps targeting API 33+, which meant the
 * notification shade stayed empty forever.
 */

const record = (overrides: Partial<NativeNotifRecord> = {}): NativeNotifRecord => ({
  id: 42,
  key: "task:dsa:task_start:2026-09-14",
  title: "DSA Practice",
  body: "Time for DSA Practice",
  at: new Date(Date.now() + 30 * 60_000),
  ...overrides,
});

const NOW = Date.now();

describe("notificationSchema — alarms must never depend on special access", () => {
  it("schedules inexact when the exact-alarm setting is denied", () => {
    const schema = notificationSchema(record(), "denied", NOW);
    expect(schema.isExactNotification).toBe(false);
    expect(schema.isExactMandatory).toBe(false);
  });

  it("schedules inexact when the exact-alarm setting is unknown", () => {
    const schema = notificationSchema(record(), "unknown", NOW);
    expect(schema.isExactNotification).toBe(false);
  });

  it("upgrades to exact only when the user already granted access", () => {
    const schema = notificationSchema(record({ priority: "high" }), "granted", NOW);
    expect(schema.isExactNotification).toBe(true);
    // Never mandatory: a missing permission must degrade, not reject the call.
    expect(schema.isExactMandatory).toBe(false);
  });

  it("never asks for exact alarms on ordinary reminders", () => {
    for (const priority of ["medium", "low"] as const) {
      const schema = notificationSchema(record({ priority }), "granted", NOW);
      expect(schema.isExactNotification).toBe(false);
    }
  });

  it("carries the planner metadata as `extra` so a delivery can be traced", () => {
    const meta = {
      type: "daily",
      taskIds: ["dsa"],
      sectionIds: ["daily"],
      fireAt: new Date(NOW + 60_000).toISOString(),
      createdAt: new Date(NOW).toISOString(),
    };
    const schema = notificationSchema(record({ meta }), "denied", NOW);
    expect(schema.extra).toEqual(meta);
  });

  it("targets the Momentum Reminders channel so Android can post it", () => {
    const schema = notificationSchema(record(), "denied", NOW);
    expect(schema.channelId).toBe("momentum-reminders");
    expect(schema.title).toBe("DSA Practice");
  });

  it("bypasses Doze for reminders scheduled within the day", () => {
    const soon = notificationSchema(record({ at: new Date(NOW + 5 * 60_000) }), "denied", NOW);
    const inFewHours = notificationSchema(record({ at: new Date(NOW + 6 * 60 * 60_000) }), "denied", NOW);
    const farFuture = notificationSchema(record({ at: new Date(NOW + 48 * 60 * 60_000) }), "denied", NOW);
    expect(soon.schedule?.allowWhileIdle).toBe(true);
    expect(inFewHours.schedule?.allowWhileIdle).toBe(true);
    expect(farFuture.schedule?.allowWhileIdle).toBe(false);
  });
});

describe("nativeIdForKey", () => {
  it("is deterministic — the same logical key maps to the same alarm id", () => {
    expect(nativeIdForKey("a:b:c")).toBe(nativeIdForKey("a:b:c"));
    expect(nativeIdForKey("a:b:c")).not.toBe(nativeIdForKey("a:b:d"));
  });

  it("always yields a positive 31-bit integer", () => {
    for (const key of ["", "test:1", "task:dsa:task_start:2026-09-14", "🦾"]) {
      const id = nativeIdForKey(key);
      expect(Number.isInteger(id)).toBe(true);
      expect(id).toBeGreaterThanOrEqual(0);
      expect(id).toBeLessThanOrEqual(0x7fffffff);
    }
  });
});

describe("uniqueNativeIds", () => {
  it("keeps ids stable for the same key set, whatever the order", () => {
    const keys = ["a:2026-09-14", "b:2026-09-14", "group:daily:2026-09-14:9"];
    const first = uniqueNativeIds(keys);
    const shuffled = uniqueNativeIds([...keys].reverse());
    for (const key of keys) {
      expect(shuffled.get(key)).toBe(first.get(key));
      expect(first.get(key)).toBe(nativeIdForKey(key));
    }
  });

  it("never hands two different reminders the same Android id", () => {
    // Large enough that raw hash collisions occur; uniqueness must survive them.
    const keys = Array.from({ length: 150_000 }, (_, i) => `task-${i}:2026-09-14`);
    const ids = uniqueNativeIds(keys);
    expect(ids.size).toBe(keys.length);
    expect(new Set(ids.values()).size).toBe(keys.length);
  });
});

describe("reconcileTracked", () => {
  const now = new Date(2026, 8, 14, 10, 0);

  it("treats records still in the saved list as anchored", () => {
    const tracked = [record({ id: 7, key: "a:2026-09-14", at: new Date(2026, 8, 14, 9, 0) })];
    const { anchored, firedKeys } = reconcileTracked(tracked, new Set([7]), now);
    expect(anchored).toHaveLength(1);
    expect(firedKeys).toHaveLength(0);
  });

  it("treats a vanished past record as fired — it must not be re-armed", () => {
    const tracked = [record({ id: 7, key: "a:2026-09-14", at: new Date(2026, 8, 14, 9, 0) })];
    const { anchored, firedKeys } = reconcileTracked(tracked, new Set(), now);
    expect(anchored).toHaveLength(0);
    expect(firedKeys).toEqual(["a:2026-09-14"]);
  });

  it("treats a vanished future record as neither — the next sync re-arms it", () => {
    const tracked = [record({ id: 7, key: "a:2026-09-14", at: new Date(2026, 8, 14, 17, 0) })];
    const { anchored, firedKeys } = reconcileTracked(tracked, new Set(), now);
    expect(anchored).toHaveLength(0);
    expect(firedKeys).toHaveLength(0);
  });

  it("tolerates timestamps that round-tripped through IndexedDB as strings", () => {
    const tracked = [
      record({ id: 7, key: "a", at: "2026-09-14T09:00:00.000Z" as unknown as Date }),
    ];
    const { firedKeys } = reconcileTracked(tracked, new Set(), new Date("2026-09-14T10:00:00.000Z"));
    expect(firedKeys).toEqual(["a"]);
  });
});

describe("notification permissions and test trigger", () => {
  it("checks permission safely in node/test environment", async () => {
    const perm = await checkPermission();
    expect(["granted", "denied", "prompt"]).toContain(perm);
  });

  it("handles test notification call gracefully", async () => {
    const res = await sendTestNotification(5);
    expect(res).toBeDefined();
    expect(typeof res.ok).toBe("boolean");
    expect(typeof res.message).toBe("string");
  });

  it("handles sendWelcomeNotification call gracefully", async () => {
    await expect(sendWelcomeNotification()).resolves.toBeUndefined();
  });
});


