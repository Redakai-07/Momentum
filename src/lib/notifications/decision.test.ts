import { describe, expect, it } from "vitest";
import { shouldNotify, type DecisionContext } from "./decision";
import type { NotificationSettings } from "./types";
import type { Task, TimeLog } from "../types";

const TODAY = "2026-03-11"; // Wednesday

const at = (h: number, m = 0): Date => new Date(2026, 2, 11, h, m);

const baseSettings: NotificationSettings = {
  enabled: true,
  cooldownMinutes: 60,
  completionCooldownMinutes: 30,
  taskReminders: true,
  specialTaskReminders: true,
  overdueReminders: true,
  quietHoursEnabled: true,
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
  // Daily tasks recur every day unless the test overrides the schedule.
  schedule: (o.section ?? "daily") === "daily" ? { type: "daily" } : undefined,
  createdAt: "2026-01-01T09:00:00.000Z",
  ...o,
});

const L = (taskId: string, minutes: number, date = TODAY): TimeLog => ({
  id: `${taskId}-${minutes}`,
  taskId,
  minutes,
  date,
});

const ctx = (o: Partial<DecisionContext>): DecisionContext => ({
  now: at(10, 0),
  tasks: [],
  logs: [],
  settings: baseSettings,
  lastMeaningfulActivityAt: at(7, 0).toISOString(),
  lastInteractionAt: at(7, 0).toISOString(),
  ...o,
});

describe("shouldNotify — intelligent notification decisions", () => {
  it("1. no tasks → no notification", () => {
    const d = shouldNotify(ctx({ tasks: [] }));
    expect(d.shouldNotify).toBe(false);
    expect(d.reason).toBe("no_tasks");
  });

  it("2. recently completed a task → no ordinary notification", () => {
    const tasks = [T({ id: "dsa", title: "DSA", estimatedMinutes: 90 })];
    const d = shouldNotify(
      ctx({
        tasks,
        lastTaskCompletionAt: at(9, 50).toISOString(), // 10 min ago
        lastMeaningfulActivityAt: at(9, 50).toISOString(),
      }),
    );
    expect(d.shouldNotify).toBe(false);
    expect(d.reason).toBe("recent_activity");
  });

  it("3. global cooldown active → no ordinary notification", () => {
    const tasks = [T({ id: "dsa", title: "DSA", estimatedMinutes: 90 })];
    const d = shouldNotify(
      ctx({
        tasks,
        lastNotificationAt: at(9, 30).toISOString(), // 30 min < 60 min cooldown
        lastMeaningfulActivityAt: at(6, 0).toISOString(),
        lastInteractionAt: at(6, 0).toISOString(),
      }),
    );
    expect(d.shouldNotify).toBe(false);
    expect(d.reason).toBe("global_cooldown");
  });

  it("4. quiet hours → no ordinary notification", () => {
    const tasks = [T({ id: "dsa", title: "DSA", estimatedMinutes: 90 })];
    const d = shouldNotify(
      ctx({
        now: at(23, 0),
        tasks,
        lastMeaningfulActivityAt: at(18, 0).toISOString(),
        lastInteractionAt: at(18, 0).toISOString(),
      }),
    );
    expect(d.shouldNotify).toBe(false);
    expect(d.reason).toBe("quiet_hours");
  });

  it("5. remaining tasks + enough elapsed time → allowed", () => {
    const tasks = [T({ id: "dsa", title: "DSA", estimatedMinutes: 90 })];
    const d = shouldNotify(
      ctx({
        tasks,
        lastMeaningfulActivityAt: at(7, 0).toISOString(), // 3h gap
        lastInteractionAt: at(7, 0).toISOString(),
      }),
    );
    expect(d.shouldNotify).toBe(true);
    expect(d.priority).toBe("normal");
  });

  it("6. special task approaching due time → high-priority notification", () => {
    const tasks = [
      T({ id: "paper", title: "Submit Paper", section: "remainder", dueDate: TODAY }),
    ];
    const d = shouldNotify(
      ctx({
        tasks,
        lastMeaningfulActivityAt: at(9, 50).toISOString(), // recent activity — overridden
        lastTaskCompletionAt: at(9, 50).toISOString(),
        lastNotificationAt: at(9, 55).toISOString(), // global cooldown — overridden
      }),
    );
    expect(d.shouldNotify).toBe(true);
    expect(d.priority).toBe("high");
    expect(d.reason).toBe("special_task");
  });

  it("7. already completed task → no notification about it", () => {
    const tasks = [
      T({
        id: "done",
        title: "Finished",
        status: "completed",
        remainingMinutes: 0,
        completedAt: "2026-03-11T09:00:00.000Z",
      }),
      T({ id: "open", title: "Open Work", section: "remainder" }), // no due today
    ];
    const d = shouldNotify(ctx({ tasks }));
    expect(d.shouldNotify).toBe(false);
    expect(d.task?.id).not.toBe("done");
  });

  it("8. same overdue task already notified → no duplicate", () => {
    const tasks = [
      T({ id: "form", title: "Fix Form", section: "remainder", dueDate: "2026-03-09" }),
    ];
    const d = shouldNotify(
      ctx({
        tasks,
        lastReminderByTask: { form: at(9, 0).toISOString() }, // same day
      }),
    );
    expect(d.shouldNotify).toBe(false);
    expect(d.reason).toBe("already_notified");
  });

  it("9. notifications disabled → no notification", () => {
    const tasks = [T({ id: "dsa", title: "DSA", estimatedMinutes: 90 })];
    const d = shouldNotify(
      ctx({ tasks, settings: { ...baseSettings, enabled: false } }),
    );
    expect(d.shouldNotify).toBe(false);
    expect(d.reason).toBe("notifications_disabled");
  });

  it("10. next action exists → notification uses the next action", () => {
    const tasks = [
      T({
        id: "dsa",
        title: "DSA",
        estimatedMinutes: 90,
        nextAction: "Complete 3Sum using the two-pointer approach",
      }),
    ];
    const d = shouldNotify(
      ctx({
        tasks,
        lastMeaningfulActivityAt: at(7, 0).toISOString(),
        lastInteractionAt: at(7, 0).toISOString(),
      }),
    );
    expect(d.shouldNotify).toBe(true);
    expect(d.reason).toBe("next_action");
    expect(d.message).toContain("Complete 3Sum using the two-pointer approach");
  });

  it("11. no next action → falls back to the task title", () => {
    const tasks = [T({ id: "dsa", title: "DSA", estimatedMinutes: 90 })];
    const d = shouldNotify(
      ctx({
        tasks,
        lastMeaningfulActivityAt: at(7, 0).toISOString(),
        lastInteractionAt: at(7, 0).toISOString(),
      }),
    );
    expect(d.shouldNotify).toBe(true);
    expect(d.task?.id).toBe("dsa");
    // Message comes from the copy pool — never empty.
    expect(d.message?.length ?? 0).toBeGreaterThan(5);
  });

  it("12. fresh user with zero data → no notifications", () => {
    // Nothing stored at all: no first-run, no settings — defaults disabled-ish.
    const d = shouldNotify(
      ctx({
        tasks: [],
        logs: [],
        lastNotificationAt: null,
        lastMeaningfulActivityAt: null,
        lastInteractionAt: null,
      }),
    );
    expect(d.shouldNotify).toBe(false);
  });

  it("high-duration remaining task gets an ordinary nudge after a real gap", () => {
    const tasks = [
      T({ id: "ml", title: "Machine Learning", estimatedMinutes: 180, remainingMinutes: 150 }),
    ];
    const d = shouldNotify(
      ctx({
        tasks,
        logs: [L("ml", 30)],
        lastMeaningfulActivityAt: at(8, 30).toISOString(), // 90 min gap with progress
        lastInteractionAt: at(8, 30).toISOString(),
      }),
    );
    expect(d.shouldNotify).toBe(true);
    expect(d.reason).toBe("high_duration");
  });
});