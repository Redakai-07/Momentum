import { describe, expect, it } from "vitest";
import { nativeIdForKey, notificationSchema, type NativeNotifRecord } from "./service";

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
    const schema = notificationSchema(record(), "granted", NOW);
    expect(schema.isExactNotification).toBe(true);
    // Never mandatory: a missing permission must degrade, not reject the call.
    expect(schema.isExactMandatory).toBe(false);
  });

  it("targets the Momentum Reminders channel so Android can post it", () => {
    const schema = notificationSchema(record(), "denied", NOW);
    expect(schema.channelId).toBe("momentum-reminders");
    expect(schema.title).toBe("DSA Practice");
  });

  it("bypasses Doze only for imminent reminders", () => {
    const soon = notificationSchema(record({ at: new Date(NOW + 5 * 60_000) }), "denied", NOW);
    const later = notificationSchema(record({ at: new Date(NOW + 6 * 60 * 60_000) }), "denied", NOW);
    expect(soon.schedule?.allowWhileIdle).toBe(true);
    expect(later.schedule?.allowWhileIdle).toBe(false);
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
