import { describe, expect, it } from "vitest";
import { breakdownForDay, scheduleOccursOn, taskOccursOn } from "./schedule";
import type { CustomSection, Task } from "./types";

const T = (o: Partial<Task> & { id: string; title: string }): Task => ({
  section: "daily",
  estimatedMinutes: 60,
  remainingMinutes: 60,
  status: "active",
  createdAt: "2026-01-01T09:00:00.000Z",
  ...o,
});

const KEY = "2026-03-11"; // Wednesday

describe("taskOccursOn", () => {
  it("daily-scheduled tasks occur every day", () => {
    expect(taskOccursOn(T({ id: "a", title: "DSA", schedule: { type: "daily" } }), "2026-03-11")).toBe(true);
    expect(taskOccursOn(T({ id: "a", title: "DSA", schedule: { type: "daily" } }), "2026-03-14")).toBe(true);
  });

  it("weekly/custom schedules fire only on their weekdays", () => {
    const gym = T({
      id: "g",
      title: "Gym",
      schedule: { type: "weekly", days: [1, 3] }, // Mon, Wed
    });
    expect(taskOccursOn(gym, "2026-03-09")).toBe(true); // Mon
    expect(taskOccursOn(gym, "2026-03-11")).toBe(true); // Wed
    expect(taskOccursOn(gym, "2026-03-12")).toBe(false); // Thu
  });

  it("one-off tasks occur only on their due date", () => {
    const paper = T({ id: "p", title: "Paper", section: "remainder", dueDate: "2026-03-11" });
    expect(taskOccursOn(paper, "2026-03-11")).toBe(true);
    expect(taskOccursOn(paper, "2026-03-10")).toBe(false);
    expect(taskOccursOn(T({ id: "q", title: "No date", section: "remainder" }), KEY)).toBe(false);
  });

  it("completed recurring tasks still occur (visible as history)", () => {
    const t = T({
      id: "c",
      title: "College",
      status: "completed",
      completedAt: "2026-03-11T08:00:00.000Z",
      remainingMinutes: 0,
      schedule: { type: "daily" },
    });
    expect(taskOccursOn(t, KEY)).toBe(true);
  });

  it("accomplished goals never occur again", () => {
    const t = T({
      id: "m",
      title: "M.Tech",
      section: "remainder",
      status: "accomplished",
      accomplishedAt: "2026-02-01T00:00:00.000Z",
      schedule: { type: "daily" },
    });
    expect(taskOccursOn(t, KEY)).toBe(false);
  });
});

describe("section schedule recurrence", () => {
  const local = (year: number, month: number, day: number) => new Date(year, month - 1, day);

  it("evaluates daily and weekly schedules", () => {
    expect(scheduleOccursOn({ type: "daily" }, local(2026, 3, 11))).toBe(true);
    expect(scheduleOccursOn({ type: "weekly", days: [1] }, local(2026, 3, 9))).toBe(true);
    expect(scheduleOccursOn({ type: "weekly", days: [1] }, local(2026, 3, 10))).toBe(false);
    expect(scheduleOccursOn({ type: "custom", days: [1, 5] }, local(2026, 3, 13))).toBe(true);
  });

  it("skips nonexistent monthly dates and supports the last day", () => {
    const day31 = { type: "monthly-date" as const, dayOfMonth: 31 };
    expect(scheduleOccursOn(day31, local(2026, 1, 31))).toBe(true);
    expect(scheduleOccursOn(day31, local(2026, 2, 28))).toBe(false);
    expect(scheduleOccursOn(day31, local(2026, 3, 31))).toBe(true);
    const last = (date: Date) => date.getDate() === new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    expect(last(local(2026, 2, 28))).toBe(true);
    expect(last(local(2026, 4, 30))).toBe(true);
    const lastSchedule = { type: "monthly-date" as const, dayOfMonth: "last" as const };
    expect(scheduleOccursOn(lastSchedule, local(2026, 1, 31))).toBe(true);
    expect(scheduleOccursOn(lastSchedule, local(2026, 2, 28))).toBe(true);
    expect(scheduleOccursOn(lastSchedule, local(2026, 4, 30))).toBe(true);
  });

  it("evaluates monthly weekday positions deterministically", () => {
    const firstMonday = { type: "monthly-weekday" as const, occurrence: "first" as const, weekday: 1 as const };
    const secondMonday = { ...firstMonday, occurrence: "second" as const };
    const lastFriday = { type: "monthly-weekday" as const, occurrence: "last" as const, weekday: 5 as const };
    const fourthMonday = { type: "monthly-weekday" as const, occurrence: "fourth" as const, weekday: 1 as const };
    expect(scheduleOccursOn(firstMonday, local(2026, 6, 1))).toBe(true);
    expect(scheduleOccursOn(firstMonday, local(2026, 6, 8))).toBe(false);
    expect(scheduleOccursOn(secondMonday, local(2026, 6, 8))).toBe(true);
    expect(scheduleOccursOn(lastFriday, local(2026, 5, 29))).toBe(true);
    expect(scheduleOccursOn(fourthMonday, local(2026, 2, 23))).toBe(true);
  });

  it("uses the section schedule for new custom-section tasks", () => {
    const section: CustomSection = {
      id: "research",
      name: "Research",
      schedule: { type: "monthly-date", dayOfMonth: 15 },
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const task = T({ id: "r", title: "Paper", section: "custom", customSectionId: "research" });
    expect(taskOccursOn(task, "2026-03-15", [section])).toBe(true);
    expect(taskOccursOn(task, "2026-03-14", [section])).toBe(false);
  });
});

describe("breakdownForDay — special-task prioritization", () => {
  const sections: CustomSection[] = [
    { id: "sec-research", name: "Research", icon: "🧪", schedule: { type: "daily" }, createdAt: "2026-01-01T00:00:00.000Z" },
  ];

  it("surfaces due-today remainder/occasional tasks as specials", () => {
    const tasks = [
      T({ id: "p", title: "Submit Paper", section: "remainder", dueDate: KEY, priority: "high" }),
      T({ id: "o", title: "Visit Hampi", section: "occasional", dueDate: KEY }),
      T({ id: "ml", title: "Learn ML", section: "remainder", dueDate: "2026-03-20" }), // not today
    ];
    const d = breakdownForDay(tasks, sections, KEY);
    expect(d.specials.map((t) => t.id)).toEqual(["p", "o"]);
  });

  it("keeps completed specials out of the urgent channel", () => {
    const tasks = [
      T({
        id: "p",
        title: "Submit Paper",
        section: "remainder",
        dueDate: KEY,
        status: "completed",
        completedAt: "2026-03-11T08:00:00.000Z",
        remainingMinutes: 0,
      }),
    ];
    const d = breakdownForDay(tasks, sections, KEY);
    expect(d.specials).toHaveLength(0);
    expect(d.specialsDone.map((t) => t.id)).toEqual(["p"]);
  });

  it("groups recurring daily work under Daily, custom work under its section", () => {
    const tasks = [
      T({ id: "d1", title: "DSA", schedule: { type: "daily" } }),
      T({ id: "r1", title: "Papers", section: "custom", customSectionId: "sec-research", schedule: { type: "daily" } }),
      T({ id: "rem", title: "Backlog one-off", section: "remainder", dueDate: "2026-04-01" }),
    ];
    const d = breakdownForDay(tasks, sections, KEY);
    expect(d.groups.map((g) => g.id)).toEqual(["builtin-daily", "sec-research"]);
    expect(d.groups[0].tasks.map((t) => t.id)).toEqual(["d1"]);
    expect(d.groups[1].title).toBe("Research");
    expect(d.groups[1].tasks.map((t) => t.id)).toEqual(["r1"]);
  });

  it("surfaces only custom sections scheduled for the current day", () => {
    const tasks = [T({ id: "d1", title: "DSA", schedule: { type: "daily" } })];
    const allSections: CustomSection[] = [
      { id: "sec-research", name: "Research", icon: "🧪", schedule: { type: "daily" }, createdAt: "2026-01-01T00:00:00.000Z" },
      { id: "sec-fitness", name: "Fitness", icon: "💪", schedule: { type: "weekly", days: [1, 3] }, createdAt: "2026-01-01T00:00:00.000Z" },
    ];
    const d = breakdownForDay(tasks, allSections, KEY);
    // Wednesday: Research is daily, Fitness is Monday/Wednesday.
    expect(d.groups.map((g) => g.id)).toEqual(["builtin-daily", "sec-research", "sec-fitness"]);
    expect(d.groups[1].title).toBe("Research");
    expect(d.groups[1].tasks).toHaveLength(0);
    expect(d.groups[2].title).toBe("Fitness");
    expect(d.groups[2].tasks).toHaveLength(0);

    const tuesday = breakdownForDay(tasks, allSections, "2026-03-10");
    expect(tuesday.groups.map((g) => g.id)).toEqual(["builtin-daily", "sec-research"]);
  });

  it("keeps custom-section tasks grouped under their section when the section exists", () => {
    const tasks = [
      T({
        id: "r1",
        title: "Read DL paper",
        section: "custom",
        customSectionId: "sec-research",
        schedule: { type: "daily" },
        estimatedMinutes: 45,
      }),
    ];
    const d = breakdownForDay(tasks, sections, KEY);
    expect(d.groups.map((g) => g.id)).toEqual(["sec-research"]);
    expect(d.groups[0].title).toBe("Research");
    expect(d.groups[0].tasks.map((t) => t.id)).toEqual(["r1"]);
  });

  it("does not list Daily when it has no tasks on the day", () => {
    const tasks: Task[] = [];
    const d = breakdownForDay(tasks, sections, KEY);
    expect(d.groups.map((g) => g.id)).toEqual(["sec-research"]);
  });

  it("orders open work before completed within a group", () => {
    const tasks = [
      T({
        id: "c1",
        title: "College",
        schedule: { type: "daily" },
        status: "completed",
        completedAt: "2026-03-11T08:00:00.000Z",
        remainingMinutes: 0,
      }),
      T({ id: "d1", title: "DSA", schedule: { type: "daily", startTime: "18:00" } }),
    ];
    const d = breakdownForDay(tasks, sections, KEY);
    expect(d.groups[0].tasks.map((t) => t.id)).toEqual(["d1", "c1"]);
  });
});
