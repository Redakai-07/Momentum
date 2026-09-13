import { describe, expect, it } from "vitest";
import { breakdownForDay, scheduleOccursOn, taskOccursOn } from "./schedule";
import { isTaskDoneOn, rolloverTasks } from "./task-state";
import type { CustomSection, Schedule, Task } from "./types";

/**
 * Section-based recurrence.
 *
 * Recurrence belongs to the SECTION, not to the Daily built-in. Whatever the
 * schedule — every day, chosen weekdays, a monthly date, the last day of the
 * month, or a weekday occurrence — a task in that section must come back fresh
 * the next time the section is active, while every earlier completion stays in
 * history.
 */

const T = (o: Partial<Task> & { id: string; title: string }): Task => ({
  section: "custom",
  customSectionId: "sec",
  estimatedMinutes: 60,
  remainingMinutes: 60,
  status: "active",
  createdAt: "2026-01-01T09:00:00.000Z",
  ...o,
});

const section = (schedule: Schedule, id = "sec"): CustomSection => ({
  id,
  name: "Research",
  schedule,
  createdAt: "2026-01-01T09:00:00.000Z",
});

/** Local timestamp on a given day, so completion days stay timezone-honest. */
const at = (key: string, h: number): string => {
  const [y, mo, d] = key.split("-").map(Number);
  return new Date(y, mo - 1, d, h, 0).toISOString();
};

const local = (y: number, m: number, d: number) => new Date(y, m - 1, d);

/** The task ids the Today dashboard would show for a day. */
const shownOn = (tasks: Task[], sections: CustomSection[], key: string): string[] =>
  breakdownForDay(tasks, sections, key)
    .groups.flatMap((g) => g.tasks.map((t) => t.id));

const completedOn = (task: Task, key: string): Task => ({
  ...task,
  status: "completed",
  completedAt: at(key, 18),
  remainingMinutes: 0,
});

describe("TEST 7 — custom weekly section (Mon / Wed / Fri)", () => {
  // 2026-09-14 is a Monday.
  const MON = "2026-09-14";
  const TUE = "2026-09-15";
  const WED = "2026-09-16";
  const THU = "2026-09-17";
  const FRI = "2026-09-18";
  const schedule: Schedule = { type: "weekly", days: [1, 3, 5] };
  const sections = [section(schedule)];
  const task = T({ id: "r1", title: "Read research paper" });

  it("appears only on the scheduled weekdays", () => {
    expect(taskOccursOn(task, MON, sections)).toBe(true);
    expect(taskOccursOn(task, TUE, sections)).toBe(false);
    expect(taskOccursOn(task, WED, sections)).toBe(true);
    expect(taskOccursOn(task, THU, sections)).toBe(false);
    expect(taskOccursOn(task, FRI, sections)).toBe(true);
  });

  it("is not listed on an inactive day, and is on an active one", () => {
    expect(shownOn([task], sections, TUE)).toEqual([]);
    expect(shownOn([task], sections, WED)).toEqual(["r1"]);
  });

  it("comes back fresh on the next scheduled day after being completed", () => {
    const mondayDone = completedOn(task, MON);

    // Monday: done.
    expect(isTaskDoneOn(mondayDone, MON)).toBe(true);
    // Wednesday: the section is active again, so the task reads as pending.
    expect(isTaskDoneOn(mondayDone, WED)).toBe(false);

    const reopened = rolloverTasks([mondayDone], [], TUE).tasks[0];
    expect(reopened.status).toBe("active");
    expect(reopened.remainingMinutes).toBe(60);
    expect(reopened.completedAt).toBeUndefined();

    // The dashboard shows it again on Wednesday, but never on Tuesday.
    expect(shownOn([reopened], sections, WED)).toEqual(["r1"]);
    expect(shownOn([reopened], sections, TUE)).toEqual([]);
  });

  it("reopens again before Friday's session", () => {
    const mondayDone = completedOn(task, MON);
    const wednesday = rolloverTasks([mondayDone], [], TUE).tasks[0];
    const wednesdayDone = completedOn(wednesday, WED);
    const friday = rolloverTasks([wednesdayDone], [], THU).tasks[0];
    expect(friday.status).toBe("active");
    expect(shownOn([friday], sections, FRI)).toEqual(["r1"]);
  });
});

describe("TEST 8 — custom monthly-date section", () => {
  const SEP1 = "2026-09-01";
  const OCT1 = "2026-10-01";
  const sections = [section({ type: "monthly-date", dayOfMonth: 1 })];
  const task = T({ id: "rev1", title: "Review monthly goals" });

  it("is active on the 1st and inactive afterwards", () => {
    expect(taskOccursOn(task, SEP1, sections)).toBe(true);
    expect(taskOccursOn(task, "2026-09-02", sections)).toBe(false);
    expect(taskOccursOn(task, "2026-09-30", sections)).toBe(false);
    expect(taskOccursOn(task, OCT1, sections)).toBe(true);
  });

  it("reappears pending on the 1st of the next month", () => {
    const done = completedOn(task, SEP1);
    const reopened = rolloverTasks([done], [], "2026-09-02").tasks[0];
    expect(reopened.status).toBe("active");
    expect(reopened.remainingMinutes).toBe(60);
    expect(shownOn([reopened], sections, OCT1)).toEqual(["rev1"]);
    // Still hidden between sessions.
    expect(shownOn([reopened], sections, "2026-09-15")).toEqual([]);
  });

  it("handles a day of month that does not exist by skipping that month", () => {
    const day31: Schedule = { type: "monthly-date", dayOfMonth: 31 };
    expect(scheduleOccursOn(day31, local(2026, 9, 30))).toBe(false);
    expect(scheduleOccursOn(day31, local(2026, 10, 31))).toBe(true);
    expect(scheduleOccursOn(day31, local(2026, 2, 28))).toBe(false); // 2026 is not a leap year
  });
});

describe("monthly last-day sections use the real end of each local month", () => {
  const lastDay: Schedule = { type: "monthly-date", dayOfMonth: "last" };
  const sections = [section(lastDay)];
  const task = T({ id: "close", title: "Close the month" });

  it("lands on the actual final day, month by month", () => {
    expect(scheduleOccursOn(lastDay, local(2026, 9, 30))).toBe(true);
    expect(scheduleOccursOn(lastDay, local(2026, 10, 31))).toBe(true);
    expect(scheduleOccursOn(lastDay, local(2026, 11, 30))).toBe(true);
    expect(scheduleOccursOn(lastDay, local(2026, 12, 31))).toBe(true);
    expect(scheduleOccursOn(lastDay, local(2026, 2, 28))).toBe(true); // non-leap
    expect(scheduleOccursOn(lastDay, local(2028, 2, 29))).toBe(true); // leap year
  });

  it("does not fire a day early", () => {
    expect(scheduleOccursOn(lastDay, local(2026, 9, 29))).toBe(false);
    expect(scheduleOccursOn(lastDay, local(2026, 10, 30))).toBe(false);
  });

  it("reopens the task when the next month's last day arrives", () => {
    const done = completedOn(task, "2026-09-30");
    const reopened = rolloverTasks([done], [], "2026-10-01").tasks[0];
    expect(reopened.status).toBe("active");
    expect(shownOn([reopened], sections, "2026-10-31")).toEqual(["close"]);
    expect(shownOn([reopened], sections, "2026-10-15")).toEqual([]);
  });
});

describe("monthly weekday-occurrence sections", () => {
  // 2026-09-07 is the first Monday; 09-14 the second; 09-28 the last.
  const occurrences = [
    ["first", "2026-09-07", "2026-10-05"],
    ["second", "2026-09-14", "2026-10-12"],
    ["third", "2026-09-21", "2026-10-19"],
    ["fourth", "2026-09-28", "2026-10-26"],
  ] as const;

  it("fires on the configured Monday of each month", () => {
    for (const [occurrence, sep, oct] of occurrences) {
      const schedule: Schedule = { type: "monthly-weekday", occurrence, weekday: 1 };
      const [sy, sm, sd] = sep.split("-").map(Number);
      const [oy, om, od] = oct.split("-").map(Number);
      expect(scheduleOccursOn(schedule, new Date(sy, sm - 1, sd))).toBe(true);
      expect(scheduleOccursOn(schedule, new Date(oy, om - 1, od))).toBe(true);
    }
  });

  it("reopens the task for the next occurrence", () => {
    const sections = [
      section({ type: "monthly-weekday", occurrence: "first", weekday: 1 }),
    ];
    const task = T({ id: "first-mon", title: "Monthly planning" });
    const done = completedOn(task, "2026-09-07");
    const reopened = rolloverTasks([done], [], "2026-09-08").tasks[0];
    expect(reopened.status).toBe("active");
    // September's occurrence is spent; October's shows it pending again.
    expect(shownOn([reopened], sections, "2026-10-05")).toEqual(["first-mon"]);
    expect(shownOn([reopened], sections, "2026-09-14")).toEqual([]);
  });

  it("supports a last-occurrence schedule", () => {
    const lastMonday: Schedule = { type: "monthly-weekday", occurrence: "last", weekday: 1 };
    expect(scheduleOccursOn(lastMonday, local(2026, 9, 28))).toBe(true);
    expect(scheduleOccursOn(lastMonday, local(2026, 9, 21))).toBe(false);
  });
});

describe("recurrence is section-scoped, not Daily-only", () => {
  it("reopens a custom-section task but never a Reminder or Occasional one", () => {
    const custom = T({ id: "c", title: "Custom", section: "custom", customSectionId: "sec" });
    const reminder = T({ id: "r", title: "Reminder", section: "remainder", customSectionId: undefined });
    const occasional = T({ id: "o", title: "Occasional", section: "occasional", customSectionId: undefined });

    const day = "2026-09-14";
    const rolled = rolloverTasks(
      [completedOn(custom, "2026-09-13"), completedOn(reminder, "2026-09-13"), completedOn(occasional, "2026-09-13")],
      [],
      day,
    );

    expect(rolled.changed.map((t) => t.id)).toEqual(["c"]);
  });

  it("keeps a custom task's section identity through a rollover", () => {
    const custom = T({ id: "c", title: "Custom", customSectionId: "sec-research" });
    const reopened = rolloverTasks([completedOn(custom, "2026-09-13")], [], "2026-09-14").tasks[0];
    expect(reopened.section).toBe("custom");
    expect(reopened.customSectionId).toBe("sec-research");
    expect(reopened.title).toBe("Custom");
    expect(reopened.estimatedMinutes).toBe(60);
  });
});
