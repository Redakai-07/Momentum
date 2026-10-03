import { describe, expect, it } from "vitest";
import type { CustomSection, Task, TimeLog } from "../types";
import {
  CATCH_UP_LEAD_MINUTES,
  MAX_REMINDER_RECORDS,
  reminderTimeFor,
  planUpcomingReminders,
} from "./planner";
import type { NotificationSettings } from "./types";

/**
 * The planner is the single source of truth for what Android should hold.
 * These tests pin its rules — explicit times, deterministic eligibility, no
 * scores, no cooldown, no quiet-hours gates.
 */

const settings: NotificationSettings = {
  enabled: true,
  dailyReminderTime: "09:00",
  remainderWeekday: 6, // Saturday
  remainderTime: "10:00",
  occasionalDays: [1, 15],
  occasionalTime: "10:00",
  taskReminders: true,
  specialTaskReminders: true,
  overdueReminders: true,
  snoozeMinutes: 30,
  cooldownMinutes: 60,
  completionCooldownMinutes: 30,
  quietHoursEnabled: true,
  quietStart: "22:30",
  quietEnd: "07:00",
  morningHour: 9,
};

const at = (y: number, mo: number, d: number, h = 8, m = 0): Date =>
  new Date(y, mo - 1, d, h, m);

const T = (o: Partial<Task> & { id: string; title: string }): Task => ({
  section: "daily",
  estimatedMinutes: 60,
  remainingMinutes: 60,
  status: "active",
  createdAt: "2026-01-01T09:00:00.000Z",
  ...o,
});

const L = (taskId: string, minutes: number, date: string): TimeLog => ({
  id: `${taskId}-${date}`,
  taskId,
  minutes,
  date,
});

const dates = (plan: ReturnType<typeof planUpcomingReminders>) =>
  plan.records.map((r) => r.date);

describe("planUpcomingReminders — explicit, deterministic reminders", () => {
  it("arms a daily task at the default time for the whole horizon", () => {
    // Monday 2026-09-14, 08:00 — before the 09:00 default.
    const plan = planUpcomingReminders({
      now: at(2026, 9, 14),
      tasks: [T({ id: "dsa", title: "DSA" })],
      logs: [],
      settings,
    });

    expect(plan.records).toHaveLength(7); // today + 6
    expect(new Set(dates(plan))).toEqual(
      new Set([
        "2026-09-14",
        "2026-09-15",
        "2026-09-16",
        "2026-09-17",
        "2026-09-18",
        "2026-09-19",
        "2026-09-20",
      ]),
    );
    for (const r of plan.records) {
      expect(r.at.getHours()).toBe(9);
      expect(r.at.getMinutes()).toBe(0);
      expect(r.reason).toBe("task_time");
    }
  });

  it("lets a task's own time win over the default", () => {
    const task = T({ id: "dsa", title: "DSA", notifyTime: "06:30" });
    expect(reminderTimeFor(task, settings)).toBe("06:30");

    const plan = planUpcomingReminders({
      now: at(2026, 9, 14, 5, 0),
      tasks: [task],
      logs: [],
      settings,
    });
    expect(plan.records[0].at.getHours()).toBe(6);
    expect(plan.records[0].at.getMinutes()).toBe(30);
  });

  it("uses the section's start time and only fires on scheduled days", () => {
    const section: CustomSection = {
      id: "sec-research",
      name: "Research",
      schedule: { type: "weekly", days: [1], startTime: "19:00" }, // Mondays
      createdAt: "2026-01-01T09:00:00.000Z",
    };
    const task = T({
      id: "paper",
      title: "Paper",
      section: "custom",
      customSectionId: "sec-research",
    });

    const plan = planUpcomingReminders({
      now: at(2026, 9, 14), // Monday
      tasks: [task],
      logs: [],
      sections: [section],
      settings,
    });

    expect(dates(plan)).toEqual(["2026-09-14"]);
    expect(plan.records[0].at.getHours()).toBe(19);
  });

  it("reminds about an undated Reminder task once a week on the chosen weekend day", () => {
    const task = T({ id: "sch", title: "Scholarship", section: "remainder" });
    const plan = planUpcomingReminders({
      now: at(2026, 9, 14), // Monday
      tasks: [task],
      logs: [],
      settings,
    });

    expect(dates(plan)).toEqual(["2026-09-19"]); // Saturday
    expect(plan.records[0].reason).toBe("weekend");
    expect(plan.records[0].at.getHours()).toBe(10);
  });

  it("reminds on a due date and every day it stays overdue", () => {
    const task = T({
      id: "sch",
      title: "Scholarship",
      section: "remainder",
      dueDate: "2026-09-16",
    });
    const plan = planUpcomingReminders({
      now: at(2026, 9, 14),
      tasks: [task],
      logs: [],
      settings,
    });

    expect(dates(plan)).toEqual([
      "2026-09-16",
      "2026-09-17",
      "2026-09-18",
      "2026-09-19",
      "2026-09-20",
    ]);
    expect(plan.records[0].reason).toBe("due_today");
    expect(plan.records[0].body).toContain("Due today");
    expect(plan.records[1].reason).toBe("overdue");
  });

  it("reminds about an undated Occasional task on the chosen days of the month", () => {
    const task = T({ id: "trip", title: "Plan trip", section: "occasional" });
    const plan = planUpcomingReminders({
      now: at(2026, 9, 14),
      tasks: [task],
      logs: [],
      settings,
    });

    expect(dates(plan)).toEqual(["2026-09-15"]); // the 15th is in the horizon
    expect(plan.records[0].reason).toBe("monthly");
  });

  it("skips a task that is done or already has minutes logged today", () => {
    const done = T({
      id: "dsa",
      title: "DSA",
      status: "completed",
      completedAt: at(2026, 9, 14, 7, 30).toISOString(),
      remainingMinutes: 0,
    });
    const logged = T({ id: "ml", title: "ML" });
    const plan = planUpcomingReminders({
      now: at(2026, 9, 14),
      tasks: [done, logged],
      logs: [L("ml", 30, "2026-09-14")],
      settings,
    });

    expect(plan.records.some((r) => r.date === "2026-09-14")).toBe(false);
    // Tomorrow both are due again (recurring work reopens).
    expect(plan.records.some((r) => r.date === "2026-09-15")).toBe(true);
    expect(plan.skipped.map((s) => s.reason)).toContain("done_on_day");
    expect(plan.skipped.map((s) => s.reason)).toContain("logged_today");
  });

  it("re-arms a passed moment once, later today", () => {
    const plan = planUpcomingReminders({
      now: at(2026, 9, 14, 15, 0),
      tasks: [T({ id: "dsa", title: "DSA" })],
      logs: [],
      settings,
    });

    const today = plan.records.filter((r) => r.date === "2026-09-14");
    expect(today).toHaveLength(1);
    expect(today[0].catchUp).toBe(true);
    expect(today[0].at.getTime()).toBe(
      at(2026, 9, 14, 15, 0).getTime() + CATCH_UP_LEAD_MINUTES * 60_000,
    );
    expect(plan.records.some((r) => r.date === "2026-09-15" && !r.catchUp)).toBe(true);
  });

  it("produces nothing when reminders are disabled", () => {
    const plan = planUpcomingReminders({
      now: at(2026, 9, 14),
      tasks: [T({ id: "dsa", title: "DSA" })],
      logs: [],
      settings: { ...settings, enabled: false },
    });
    expect(plan.records).toHaveLength(0);
  });

  it("honours the per-section switches", () => {
    const tasks = [
      T({ id: "daily", title: "Daily" }),
      T({ id: "due", title: "Due", section: "remainder", dueDate: "2026-09-14" }),
      T({ id: "late", title: "Late", section: "remainder", dueDate: "2026-09-10" }),
    ];
    const plan = planUpcomingReminders({
      now: at(2026, 9, 14),
      tasks,
      logs: [],
      settings: {
        ...settings,
        taskReminders: false,
        specialTaskReminders: false,
        overdueReminders: false,
      },
    });
    expect(plan.records).toHaveLength(0);
    expect(plan.skipped.map((s) => s.reason)).toEqual(
      expect.arrayContaining([
        "task_reminders_off",
        "due_reminders_off",
        "overdue_reminders_off",
      ]),
    );
  });

  it("caps the queue but keeps the earliest alarms", () => {
    const tasks = Array.from({ length: 20 }, (_, i) =>
      T({ id: `t${i}`, title: `Task ${i}` }),
    );
    const plan = planUpcomingReminders({
      now: at(2026, 9, 14),
      tasks,
      logs: [],
      settings,
    });

    expect(plan.records).toHaveLength(MAX_REMINDER_RECORDS);
    expect(plan.records[0].date).toBe("2026-09-14");
    expect(plan.records[plan.records.length - 1].date < "2026-09-20").toBe(true);
  });
});
