import { describe, expect, it } from "vitest";
import {
  notificationMessage,
  pickNextTask,
  planNotifications,
  type NotifContext,
} from "./engine";
import type { NotificationSettings, TaskNotification } from "./types";
import type { Task, TimeLog } from "../types";

const TODAY = "2026-03-11";

const at = (key: string, h: number, m = 0): Date => {
  const [y, mo, d] = key.split("-").map(Number);
  return new Date(y, mo - 1, d, h, m);
};

const settings: NotificationSettings = {
  enabled: true,
  cooldownMinutes: 30,
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
  createdAt: "2026-01-01T09:00:00.000Z",
  ...o,
});

const N = (
  o: Partial<TaskNotification> & { id: string; taskId: string; type: TaskNotification["type"] },
): TaskNotification => ({
  date: TODAY,
  scheduledAt: at(TODAY, 9, 0).toISOString(),
  status: "scheduled",
  createdAt: at(TODAY, 0, 0).toISOString(),
  ...o,
});

const plan = (o: Partial<NotifContext>): ReturnType<typeof planNotifications> => {
  return planNotifications({
    now: at(TODAY, 10, 0),
    tasks: [],
    logs: [],
    existing: [],
    settings,
    ...o,
  });
};

describe("pickNextTask — deterministic next-task selection", () => {
  it("prefers the earliest scheduled start among open recurring tasks", () => {
    const tasks = [
      T({ id: "ml", title: "ML", schedule: { type: "daily", startTime: "19:00", endTime: "20:30" } }),
      T({ id: "dsa", title: "DSA", schedule: { type: "daily", startTime: "18:00", endTime: "19:30" } }),
      T({ id: "research", title: "Research", section: "custom", customSectionId: "s1", schedule: { type: "daily", startTime: "20:00" } }),
    ];
    expect(pickNextTask(TODAY, tasks)?.id).toBe("dsa");
  });

  it("treats a due-today one-off as a candidate (scheduled work still goes first)", () => {
    const tasks = [
      T({ id: "paper", title: "Submit Paper", section: "remainder", dueDate: TODAY }),
      T({ id: "dsa", title: "DSA", schedule: { type: "daily", startTime: "18:00" } }),
    ];
    // Both qualify; DSA has an explicit start (18:00), the one-off sorts after.
    expect(pickNextTask(TODAY, tasks)?.id).toBe("dsa");
  });

  it("picks the due-today one-off when no scheduled task competes", () => {
    const tasks = [
      T({ id: "paper", title: "Submit Paper", section: "remainder", dueDate: TODAY }),
      T({ id: "other", title: "No date", section: "remainder" }),
    ];
    expect(pickNextTask(TODAY, tasks)?.id).toBe("paper");
  });

  it("excludes completed, accomplished and undated one-off tasks", () => {
    const tasks = [
      T({ id: "c", title: "College", status: "completed", completedAt: "2026-03-11T08:00:00.000Z", remainingMinutes: 0 }),
      T({ id: "a", title: "M.Tech", section: "remainder", status: "accomplished", accomplishedAt: "2026-02-01T00:00:00.000Z" }),
      T({ id: "r", title: "Backlog", section: "remainder" }), // no due date today
    ];
    expect(pickNextTask(TODAY, tasks)).toBeNull();
  });

  it("returns null when nothing is open today", () => {
    expect(pickNextTask(TODAY, [])).toBeNull();
  });
});

describe("notification cooldown", () => {
  it("defers a due reminder while the user is still in the cooldown", () => {
    const tasks = [
      T({
        id: "college",
        title: "College",
        status: "completed",
        completedAt: at(TODAY, 9, 50).toISOString(),
        remainingMinutes: 0,
      }),
      T({ id: "ml", title: "ML", schedule: { type: "daily", startTime: "19:00" } }),
    ];
    const existing = [
      N({ id: "n1", taskId: "ml", type: "task_reminder", scheduledAt: at(TODAY, 10, 0).toISOString() }),
    ];
    const { updates } = plan({
      now: at(TODAY, 10, 5),
      tasks,
      existing,
    });
    const deferred = updates.find((n) => n.id === "n1");
    expect(deferred?.status).toBe("scheduled");
    // Deferred to the end of the cooldown: 09:50 + 30 min = 10:20.
    expect(deferred?.scheduledAt).toBe(at(TODAY, 10, 20).toISOString());
  });

  it("delivers the reminder once the cooldown has elapsed", () => {
    const tasks = [
      T({
        id: "college",
        title: "College",
        status: "completed",
        completedAt: at(TODAY, 9, 0).toISOString(),
        remainingMinutes: 0,
      }),
      T({ id: "ml", title: "ML", schedule: { type: "daily", startTime: "19:00" } }),
    ];
    const existing = [
      N({ id: "n1", taskId: "ml", type: "task_reminder", scheduledAt: at(TODAY, 10, 0).toISOString() }),
    ];
    const { updates } = plan({ now: at(TODAY, 10, 5), tasks, existing });
    const delivered = updates.find((n) => n.id === "n1");
    expect(delivered?.status).toBe("delivered");
    expect(delivered?.deliveredAt).toBe(at(TODAY, 10, 5).toISOString());
  });

  it("does not emit a next-task nudge while inside the cooldown", () => {
    const tasks = [
      T({
        id: "college",
        title: "College",
        status: "completed",
        completedAt: at(TODAY, 9, 58).toISOString(),
        remainingMinutes: 0,
      }),
      T({ id: "dsa", title: "DSA", schedule: { type: "daily", startTime: "18:00" } }),
    ];
    const { creates } = plan({ now: at(TODAY, 10, 0), tasks });
    expect(creates.some((n) => n.type === "next_task")).toBe(false);
  });

  it("emits one next-task nudge after the cooldown, aimed at the next open task", () => {
    const tasks = [
      T({
        id: "college",
        title: "College",
        status: "completed",
        completedAt: at(TODAY, 9, 10).toISOString(), // 50 min ago > 30 min cooldown
        remainingMinutes: 0,
      }),
      T({ id: "ml", title: "ML", schedule: { type: "daily", startTime: "19:00" } }),
      T({ id: "dsa", title: "DSA", schedule: { type: "daily", startTime: "18:00" } }),
    ];
    const { creates } = plan({ now: at(TODAY, 10, 0), tasks });
    const nudge = creates.find((n) => n.type === "next_task");
    expect(nudge?.taskId).toBe("dsa");
    expect(nudge?.scheduledAt).toBe(at(TODAY, 9, 40).toISOString()); // end of cooldown
  });
});

describe("scheduling + delivery rules", () => {
  it("creates a morning special-task reminder for due-today open tasks", () => {
    const tasks = [
      T({ id: "paper", title: "Paper", section: "remainder", dueDate: TODAY }),
      T({ id: "other", title: "Done paper", section: "remainder", dueDate: TODAY, status: "completed", completedAt: "2026-03-11T08:00:00.000Z", remainingMinutes: 0 }),
    ];
    const { creates } = plan({ now: at(TODAY, 8, 0), tasks });
    const specials = creates.filter((n) => n.type === "special_task");
    expect(specials).toHaveLength(1);
    expect(specials[0].taskId).toBe("paper");
    expect(specials[0].scheduledAt).toBe(at(TODAY, 9, 0).toISOString());
  });

  it("creates a morning overdue check for open overdue tasks (never occasional)", () => {
    const tasks = [
      T({ id: "form", title: "Fix form", section: "remainder", dueDate: "2026-03-10" }),
      T({ id: "movie", title: "Watch film", section: "occasional", dueDate: "2026-03-10" }),
    ];
    const { creates } = plan({ now: at(TODAY, 8, 0), tasks });
    const overdue = creates.filter((n) => n.type === "overdue");
    expect(overdue).toHaveLength(1);
    expect(overdue[0].taskId).toBe("form");
  });

  it("dedupes — only one reminder per task/type/day", () => {
    const tasks = [T({ id: "paper", title: "Paper", section: "remainder", dueDate: TODAY })];
    const existing = [
      N({ id: "n1", taskId: "paper", type: "special_task", scheduledAt: at(TODAY, 9, 0).toISOString() }),
    ];
    const { creates } = plan({ now: at(TODAY, 8, 0), tasks, existing });
    expect(creates.filter((n) => n.type === "special_task")).toHaveLength(0);
  });

  it("cancels a pending reminder when the task is done or no longer valid", () => {
    const tasks = [
      T({ id: "paper", title: "Paper", section: "remainder", dueDate: "2026-03-12" }), // due date moved
    ];
    const existing = [
      N({ id: "n1", taskId: "paper", type: "special_task", scheduledAt: at(TODAY, 9, 0).toISOString() }),
    ];
    const { updates } = plan({ now: at(TODAY, 8, 0), tasks, existing });
    expect(updates.find((n) => n.id === "n1")?.status).toBe("cancelled");
  });

  it("cancels pending rows and stops creating when reminders are disabled", () => {
    const tasks = [T({ id: "paper", title: "Paper", section: "remainder", dueDate: TODAY })];
    const existing = [
      N({ id: "n1", taskId: "paper", type: "special_task", scheduledAt: at(TODAY, 9, 0).toISOString() }),
    ];
    const { creates, updates } = plan({
      now: at(TODAY, 8, 0),
      tasks,
      existing,
      settings: { ...settings, enabled: false },
    });
    expect(updates.find((n) => n.id === "n1")?.status).toBe("cancelled");
    expect(creates).toHaveLength(0);
  });

  it("skips a cancelled row when re-creating later (dead rows free their key)", () => {
    const tasks = [T({ id: "paper", title: "Paper", section: "remainder", dueDate: TODAY })];
    const existing = [
      N({ id: "n1", taskId: "paper", type: "special_task", status: "cancelled", scheduledAt: at(TODAY, 9, 0).toISOString() }),
    ];
    const { creates } = plan({ now: at(TODAY, 8, 0), tasks, existing });
    expect(creates.filter((n) => n.type === "special_task")).toHaveLength(1);
  });

  it("schedules start/end cues only for future times and unengaged tasks", () => {
    const tasks = [
      T({ id: "dsa", title: "DSA", schedule: { type: "daily", startTime: "11:00", endTime: "12:00" } }),
    ];
    const early = plan({ now: at(TODAY, 10, 0), tasks });
    expect(early.creates.map((n) => n.type).sort()).toEqual(["task_reminder", "task_start"]);

    // After 12:00 no more cues today.
    const late = plan({ now: at(TODAY, 13, 0), tasks });
    expect(late.creates.filter((n) => n.type === "task_start" || n.type === "task_reminder")).toHaveLength(0);

    // Already logged today → no nagging.
    const logs: TimeLog[] = [{ id: "l1", taskId: "dsa", minutes: 30, date: TODAY }];
    const engaged = plan({ now: at(TODAY, 10, 0), tasks, logs });
    expect(engaged.creates.filter((n) => n.type === "task_start" || n.type === "task_reminder")).toHaveLength(0);
  });

  it("respects the per-type reminder switches", () => {
    const tasks = [
      T({ id: "paper", title: "Paper", section: "remainder", dueDate: TODAY }),
      T({ id: "form", title: "Fix form", section: "remainder", dueDate: "2026-03-10" }),
    ];
    const { creates } = plan({
      now: at(TODAY, 8, 0),
      tasks,
      settings: { ...settings, specialTaskReminders: false, overdueReminders: false },
    });
    expect(creates).toHaveLength(0);
  });
});

describe("notificationMessage", () => {
  it("renders human copy per type", () => {
    expect(notificationMessage({ type: "special_task" }, "Submit Paper")).toBe("Due today — Submit Paper");
    expect(notificationMessage({ type: "overdue" }, "Fix form")).toBe("Still open — Fix form is overdue");
    expect(notificationMessage({ type: "task_start" }, "DSA")).toBe("Time for DSA");
    expect(notificationMessage({ type: "task_reminder" }, "ML")).toContain("wrap up");
    expect(notificationMessage({ type: "next_task" }, "Research")).toContain("When you're ready");
  });
});
