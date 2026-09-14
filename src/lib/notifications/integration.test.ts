import { describe, expect, it } from "vitest";
import { dateKey } from "../date";
import type { Task, TimeLog } from "../types";
import { planNotifications, type DraftNotification } from "./engine";
import { nativeIdForKey, notificationSchema, type NativeNotifRecord } from "./service";
import { notifKey, type TaskNotification, type NotificationSettings } from "./types";

const TODAY = "2026-03-11";

const at = (key: string, h: number, m = 0): Date => {
  const [y, mo, d] = key.split("-").map(Number);
  return new Date(y, mo - 1, d, h, m);
};

const defaultSettings: NotificationSettings = {
  enabled: true,
  cooldownMinutes: 30,
  completionCooldownMinutes: 30,
  taskReminders: true,
  specialTaskReminders: true,
  overdueReminders: true,
  quietHoursEnabled: false,
  quietStart: "22:30",
  quietEnd: "07:00",
  morningHour: 9,
  snoozeMinutes: 30,
};

const T = (o: Partial<Task> & { id: string; title: string }): Task => ({
  section: "daily",
  estimatedMinutes: 60,
  remainingMinutes: 60,
  status: "active",
  createdAt: "2026-01-01T09:00:00.000Z",
  ...o,
});

describe("Native schedule building & retention across sync cycles", () => {
  it("retains scheduled tasks even when already present in the existing queue", () => {
    const now = at(TODAY, 10, 0);
    const tasks: Task[] = [
      T({ id: "dsa", title: "DSA", schedule: { type: "daily", startTime: "14:00", endTime: "15:00" } }),
      T({ id: "ml", title: "ML", schedule: { type: "daily", startTime: "16:00", endTime: "17:00" } }),
    ];

    // Cycle 1: First syncPlans
    const firstPlan = planNotifications({
      now,
      tasks,
      logs: [],
      existing: [],
      settings: defaultSettings,
    });

    expect(firstPlan.creates.length).toBe(4); // 2 starts + 2 reminders

    // Simulate storing in notifications queue
    const queue: TaskNotification[] = firstPlan.creates.map((c, i) => ({
      ...c,
      id: `notif-${i}`,
      status: "scheduled",
      createdAt: now.toISOString(),
    }));

    // Cycle 2: Second sync (e.g. app resume, 60s tick, or task edit)
    const secondPlan = planNotifications({
      now,
      tasks,
      logs: [],
      existing: queue,
      settings: defaultSettings,
    });

    // engine.ts returns creates: [] because they already exist in the queue
    expect(secondPlan.creates.length).toBe(0);

    // Now test the candidate gathering logic used in store.ts buildNativeSchedule:
    const candidates = new Map<string, TaskNotification | DraftNotification>();
    for (const c of secondPlan.creates) {
      candidates.set(notifKey(c), c);
    }
    for (const n of queue) {
      if ((n.status === "scheduled" || n.status === "snoozed") && n.date === TODAY) {
        candidates.set(notifKey(n), n);
      }
    }

    // All 4 scheduled tasks must still be candidates for native alarms
    expect(candidates.size).toBe(4);

    const records: NativeNotifRecord[] = [];
    for (const item of candidates.values()) {
      const fireAt = new Date(
        "status" in item && item.status === "snoozed" && item.snoozedUntil
          ? item.snoozedUntil
          : item.scheduledAt,
      );
      if (fireAt.getTime() <= now.getTime()) continue;

      const task = tasks.find((t) => t.id === item.taskId);
      if (!task || task.status !== "active") continue;

      records.push({
        id: nativeIdForKey(`${item.taskId}:${item.type}:${item.date}`),
        key: `${item.taskId}:${item.type}:${item.date}`,
        title: task.title,
        body: `Time for ${task.title}`,
        at: fireAt,
      });
    }

    expect(records.length).toBe(4);
    expect(records.map((r) => r.title)).toContain("DSA");
    expect(records.map((r) => r.title)).toContain("ML");
  });

  it("handles snoozed notifications with snoozedUntil timestamp", () => {
    const now = at(TODAY, 10, 0);
    const snoozeTime = at(TODAY, 10, 30).toISOString();
    const queue: TaskNotification[] = [
      {
        id: "n-snoozed",
        taskId: "dsa",
        type: "task_start",
        date: TODAY,
        status: "snoozed",
        scheduledAt: at(TODAY, 9, 0).toISOString(),
        snoozedUntil: snoozeTime,
        createdAt: now.toISOString(),
      },
    ];

    const tasks = [T({ id: "dsa", title: "DSA" })];

    const candidates = new Map<string, TaskNotification>();
    for (const n of queue) {
      if ((n.status === "scheduled" || n.status === "snoozed") && n.date === TODAY) {
        candidates.set(notifKey(n), n);
      }
    }

    const item = candidates.get("dsa:task_start:2026-03-11");
    expect(item).toBeDefined();

    const fireAt = new Date(item!.status === "snoozed" && item!.snoozedUntil ? item!.snoozedUntil : item!.scheduledAt);
    expect(fireAt.toISOString()).toBe(snoozeTime);
    expect(fireAt.getTime()).toBeGreaterThan(now.getTime());
  });

  it("excludes tasks completed on the current day from external alarms", () => {
    const now = at(TODAY, 10, 0);
    const completedTask = T({
      id: "dsa",
      title: "DSA",
      status: "completed",
      completedAt: at(TODAY, 9, 30).toISOString(),
      remainingMinutes: 0,
    });

    const queue: TaskNotification[] = [
      {
        id: "n1",
        taskId: "dsa",
        type: "task_start",
        date: TODAY,
        status: "scheduled",
        scheduledAt: at(TODAY, 14, 0).toISOString(),
        createdAt: now.toISOString(),
      },
    ];

    // DSA is status: completed, so it must not produce a native alarm
    const records: NativeNotifRecord[] = [];
    for (const n of queue) {
      if (completedTask.status !== "active") continue;
      records.push({
        id: nativeIdForKey(`${n.taskId}:${n.type}:${n.date}`),
        key: `${n.taskId}:${n.type}:${n.date}`,
        title: completedTask.title,
        body: completedTask.title,
        at: new Date(n.scheduledAt),
      });
    }

    expect(records.length).toBe(0);
  });
});
