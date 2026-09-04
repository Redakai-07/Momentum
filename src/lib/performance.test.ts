import { describe, expect, it } from "vitest";
import {
  aggregate,
  currentStreak,
  liveDayRec,
  longestStreak,
  monthlyAggregate,
  weeklyAggregate,
  workloadForTasks,
  yearlyAggregate,
  type DayRec,
} from "./performance";
import type { Task, TimeLog } from "./types";

const KEY = "2026-03-11";

const T = (o: Partial<Task> & { id: string; title: string }): Task => {
  const estimated = o.estimatedMinutes ?? 60;
  return {
    section: "daily",
    estimatedMinutes: estimated,
    remainingMinutes: o.remainingMinutes ?? estimated,
    status: "active",
    createdAt: "2026-01-01T09:00:00.000Z",
    ...o,
  };
};

const L = (taskId: string, minutes: number, date: string = KEY): TimeLog => ({
  id: `${taskId}-${date}-${minutes}`,
  taskId,
  minutes,
  date,
});

describe("workloadForTasks — planned / remaining", () => {
  it("sums planned time for every task occurring on the day", () => {
    const tasks = [
      T({ id: "a", title: "DSA", estimatedMinutes: 90, schedule: { type: "daily" } }),
      T({ id: "b", title: "Research", estimatedMinutes: 60, schedule: { type: "daily" } }),
      T({ id: "c", title: "Paper", section: "remainder", estimatedMinutes: 120, dueDate: KEY }),
    ];
    const w = workloadForTasks(tasks, KEY);
    expect(w.planned).toBe(270);
    expect(w.count).toBe(3);
    expect(w.remaining).toBe(270);
    expect(w.completed).toBe(0);
  });

  it("skips tasks that are not scheduled on the given day", () => {
    const tasks = [
      T({
        id: "a",
        title: "Gym",
        schedule: { type: "weekly", days: [1, 3] }, // Mon + Wed
      }),
      T({ id: "b", title: "One-off", section: "remainder", dueDate: "2026-03-12" }),
    ];
    // 2026-03-11 is a Wednesday (day 3) → Gym occurs, one-off does not.
    const w = workloadForTasks(tasks, KEY);
    expect(w.planned).toBe(60);
    expect(w.count).toBe(1);
  });

  it("keeps planned time for completed tasks but zero remaining", () => {
    const tasks = [
      T({
        id: "a",
        title: "College",
        estimatedMinutes: 45,
        schedule: { type: "daily" },
        status: "completed",
        completedAt: "2026-03-11T08:00:00.000Z",
        remainingMinutes: 0,
      }),
    ];
    const w = workloadForTasks(tasks, KEY);
    expect(w.planned).toBe(45);
    expect(w.remaining).toBe(0);
    expect(w.completed).toBe(45);
  });

  it("excludes accomplished goals from today's workload", () => {
    const tasks = [
      T({
        id: "a",
        title: "M.Tech",
        section: "remainder",
        status: "accomplished",
        accomplishedAt: "2026-02-01T00:00:00.000Z",
      }),
    ];
    expect(workloadForTasks(tasks, KEY).planned).toBe(0);
  });

  it("counts only remaining minutes of in-progress (partial) tasks", () => {
    const tasks = [
      T({ id: "a", title: "DSA", estimatedMinutes: 90, remainingMinutes: 30, schedule: { type: "daily" } }),
    ];
    const w = workloadForTasks(tasks, KEY);
    expect(w.remaining).toBe(30);
    expect(w.completed).toBe(60);
  });
});

describe("liveDayRec — daily performance from tasks + time logs", () => {
  it("computes percentage from logged minutes over planned minutes", () => {
    const tasks = [
      T({ id: "a", title: "DSA", estimatedMinutes: 90 }),
      T({ id: "b", title: "ML", estimatedMinutes: 90 }),
    ];
    const logs = [L("a", 45), L("b", 90)];
    const rec = liveDayRec(tasks, logs, KEY);
    expect(rec.plannedMinutes).toBe(180);
    expect(rec.completedMinutes).toBe(135);
    expect(rec.percentage).toBe(75);
  });

  it("caps completed time at the planned amount (no free performance)", () => {
    const tasks = [T({ id: "a", title: "DSA", estimatedMinutes: 60 })];
    const logs = [L("a", 120)]; // way over-estimate
    const rec = liveDayRec(tasks, logs, KEY);
    expect(rec.completedMinutes).toBe(60);
    expect(rec.percentage).toBe(100);
  });

  it("reports a rest day as neutral (null percentage)", () => {
    const rec = liveDayRec([], [], KEY);
    expect(rec.plannedMinutes).toBe(0);
    expect(rec.completedMinutes).toBe(0);
    expect(rec.percentage).toBeNull();
  });

  it("counts a remainder one-off on its due date as planned work", () => {
    const tasks = [
      T({ id: "c", title: "Paper", section: "remainder", estimatedMinutes: 120, dueDate: KEY }),
    ];
    const logs = [L("c", 120)];
    const rec = liveDayRec(tasks, logs, KEY);
    expect(rec.plannedMinutes).toBe(120);
    expect(rec.percentage).toBe(100);
  });

  it("never hides effort: logged one-offs without a schedule still count", () => {
    const tasks = [
      T({ id: "c", title: "Deep work", section: "remainder", estimatedMinutes: 120 }),
    ];
    const logs = [L("c", 60)];
    const rec = liveDayRec(tasks, logs, KEY);
    expect(rec.plannedMinutes).toBe(120);
    expect(rec.percentage).toBe(50);
  });

  it("ignores accomplished goals and their planned time", () => {
    const tasks = [
      T({ id: "g", title: "M.Tech", section: "remainder", status: "accomplished", accomplishedAt: "2026-02-01T00:00:00.000Z" }),
    ];
    const rec = liveDayRec(tasks, [L("g", 30)], KEY);
    expect(rec.plannedMinutes).toBe(0);
  });
});

const rec = (
  date: string,
  planned: number,
  done: number,
  kind?: DayRec["kind"],
): DayRec => ({
  date,
  plannedMinutes: planned,
  completedMinutes: done,
  percentage: planned > 0 ? Math.round((done / planned) * 100) : null,
  kind,
});

describe("period rollups — week / month / year", () => {
  // Today is a Wednesday (2026-03-11). Week runs Mon 03-09 … Sun 03-15.
  const all: DayRec[] = [
    rec("2026-03-08", 200, 180), // Sunday before — previous week
    rec("2026-03-09", 200, 180), // Mon (90%)
    rec("2026-03-10", 200, 100), // Tue (50%)
    rec("2026-03-11", 200, 160), // Wed today (80%)
    rec("2026-03-12", 200, 200), // Thu — future, must be excluded
    rec("2026-04-01", 200, 180), // next month
    rec("2027-01-01", 200, 180), // next year
  ];

  it("aggregates the Monday-first week up to today (excludes future)", () => {
    const w = weeklyAggregate(all, "2026-03-11");
    expect(w.plannedMinutes).toBe(600);
    expect(w.completedMinutes).toBe(440);
    expect(w.percentage).toBe(73); // 440/600
  });

  it("aggregates the calendar month up to today", () => {
    const m = monthlyAggregate(all, "2026-03-11");
    // 03-08 … 03-11 = 800 planned, 620 done (03-12 is future → excluded)
    expect(m.plannedMinutes).toBe(800);
    expect(m.completedMinutes).toBe(620);
    expect(m.percentage).toBe(78);
  });

  it("aggregates the calendar year up to today", () => {
    const y = yearlyAggregate(all, "2026-03-11");
    expect(y.plannedMinutes).toBe(800);
    expect(y.completedMinutes).toBe(620);
  });

  it("returns null percentage when nothing countable was planned", () => {
    const agg = weeklyAggregate([], "2026-03-11");
    expect(agg.percentage).toBeNull();
    expect(agg.plannedMinutes).toBe(0);
  });

  it("treats recovery days as neutral — they never inflate a period", () => {
    const rows = [
      rec("2026-03-09", 200, 180),
      rec("2026-03-10", 300, 90, "recovery"), // failed, earned → excluded
      rec("2026-03-11", 200, 160),
    ];
    const w = weeklyAggregate(rows, "2026-03-11");
    expect(w.plannedMinutes).toBe(400);
    expect(w.completedMinutes).toBe(340);
    expect(w.percentage).toBe(85);
  });

  it("aggregate excludes rest, inactive and recovery days", () => {
    const rows = [
      rec("2026-03-09", 0, 0), // rest
      rec("2026-03-10", 200, 180),
      rec("2026-03-11", 300, 90, "inactive"),
      rec("2026-03-12", 300, 90, "recovery"),
    ];
    const agg = aggregate(rows);
    expect(agg.plannedMinutes).toBe(200);
    expect(agg.completedMinutes).toBe(180);
  });
});

describe("streak calculations", () => {
  const good = (date: string): DayRec => rec(date, 200, 180); // 90%
  const bad = (date: string): DayRec => rec(date, 200, 80); // 40% < 70%

  it("counts consecutive qualifying days", () => {
    const rows = [good("2026-03-08"), good("2026-03-09"), good("2026-03-10")];
    expect(currentStreak(rows, "2026-03-10")).toBe(3);
  });

  it("breaks on a day below the threshold", () => {
    const rows = [good("2026-03-08"), good("2026-03-09"), bad("2026-03-10"), good("2026-03-11")];
    expect(currentStreak(rows, "2026-03-11")).toBe(1);
  });

  it("does not break on rest, inactive or recovery days", () => {
    const rows = [
      good("2026-03-06"),
      rec("2026-03-07", 0, 0), // rest — neutral
      good("2026-03-08"),
      rec("2026-03-09", 300, 90, "recovery"), // earned recovery — neutral
      rec("2026-03-10", 0, 0, "inactive"), // no work planned — neutral
      good("2026-03-11"),
    ];
    // Neutral days neither extend nor break: 03-06, 03-08, 03-11 count.
    expect(currentStreak(rows, "2026-03-11")).toBe(3);
  });

  it("a partial in-progress day never breaks nor extends the streak", () => {
    const rows = [good("2026-03-09"), good("2026-03-10"), rec("2026-03-11", 200, 40)];
    expect(currentStreak(rows, "2026-03-11")).toBe(2); // today below threshold: neutral
  });

  it("counts today once it already crossed the threshold", () => {
    const rows = [good("2026-03-10"), rec("2026-03-11", 200, 180)];
    expect(currentStreak(rows, "2026-03-11")).toBe(2);
  });

  it("ignores future-dated rows", () => {
    const rows = [good("2026-03-10"), good("2026-03-12")];
    expect(currentStreak(rows, "2026-03-11")).toBe(1);
  });

  it("longestStreak finds the best historical run", () => {
    const rows = [
      good("2026-03-01"),
      good("2026-03-02"),
      bad("2026-03-03"),
      good("2026-03-04"),
      good("2026-03-05"),
      good("2026-03-06"),
    ];
    expect(longestStreak(rows)).toBe(3);
  });

  it("longestStreak skips neutral days without extending the run", () => {
    const rows = [
      good("2026-03-01"),
      rec("2026-03-02", 0, 0), // rest — neither extends nor breaks
      good("2026-03-03"),
      good("2026-03-04"),
    ];
    expect(longestStreak(rows)).toBe(3);
  });
});
