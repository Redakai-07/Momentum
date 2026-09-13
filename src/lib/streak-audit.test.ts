import { describe, expect, it } from "vitest";
import {
  aggregate,
  currentStreak,
  longestStreak,
  liveDayRec,
  monthlyAggregate,
  weeklyAggregate,
  yearlyAggregate,
  type DayRec,
} from "./performance";
import { applyRecoveryKinds } from "./activity";
import { RECOVERY_RULES } from "./config";
import { PROFILE, type Task, type TimeLog } from "./types";
import { isTaskDoneOn, rolloverTasks } from "./task-state";
import { dateKey } from "./date";

/**
 * Streak + performance audit.
 *
 * Exercises the whole system after optional duration and section-scoped
 * recurrence landed: the 70% threshold, unique local calendar dates, recovery
 * days and their monthly cap, and cross-day isolation of completion state.
 */

const THRESHOLD = PROFILE.streakThreshold * 100; // 70

const T = (o: Partial<Task> & { id: string; title: string }): Task => ({
  section: "daily",
  estimatedMinutes: 60,
  remainingMinutes: 60,
  status: "active",
  createdAt: "2026-01-01T09:00:00.000Z",
  ...o,
});

const L = (taskId: string, minutes: number, date: string): TimeLog => ({
  id: `${taskId}-${date}-${minutes}`,
  taskId,
  minutes,
  date,
});

/** A stored day row. */
const day = (
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

const at = (key: string, h: number): string => {
  const [y, mo, d] = key.split("-").map(Number);
  return new Date(y, mo - 1, d, h, 0).toISOString();
};

/** One time-based task, so a day's ratio is trivial to reason about. */
const timedTask = (id = "dsa"): Task => T({ id, title: "DSA Practice", estimatedMinutes: 60 });

/** Single-task day record derived end-to-end from tasks + logs. */
const dayFrom = (key: string, completed: number, taskId = "dsa"): DayRec =>
  liveDayRec([timedTask(taskId)], completed > 0 ? [L(taskId, completed, key)] : [], key);

describe("AUDIT 1-2 — the first qualifying day, then a second", () => {
  const D1 = "2026-09-14";
  const D2 = "2026-09-15";

  it("TEST 1 — day 1: 60/60 → 100% and streak 1", () => {
    const d1 = dayFrom(D1, 60);
    expect(d1.percentage).toBe(100);
    expect(currentStreak([d1], D1)).toBe(1);
  });

  it("TEST 2 — day 2: 60/60 → streak 2", () => {
    const rows = [dayFrom(D1, 60), dayFrom(D2, 60)];
    expect(currentStreak(rows, D2)).toBe(2);
  });

  it("never reports 2 for a single qualifying day, however it is fed in", () => {
    const d1 = dayFrom(D1, 60);
    expect(currentStreak([d1, d1], D1)).toBe(1);
    expect(currentStreak([d1, { ...d1 }], D1)).toBe(1);
  });
});

describe("AUDIT 3-4 — partial days, the threshold, and returning after a miss", () => {
  const D1 = "2026-09-14";
  const D2 = "2026-09-15";
  const D3 = "2026-09-16";

  it("TEST 3 — 30/60 → 50% does not qualify today and never inflates it", () => {
    const d3 = dayFrom(D3, 30);
    expect(d3.percentage).toBe(50);
    // Today below threshold: neither extends nor breaks.
    expect(currentStreak([dayFrom(D1, 60), dayFrom(D2, 60), d3], D3)).toBe(2);
  });

  it("treats exactly 70% as qualifying and 69% as not", () => {
    const past70 = day("2026-09-13", 100, 70);
    const past69 = day("2026-09-13", 100, 69);
    const today = day(D1, 100, 70);
    expect(THRESHOLD).toBe(70);
    expect(currentStreak([past70, today], D1)).toBe(2);
    expect(currentStreak([past69, today], D1)).toBe(1);
  });

  it("TEST 4 — a missed day breaks the streak; the next qualifying day starts at 1", () => {
    const rows = [dayFrom(D1, 60), dayFrom(D2, 10), dayFrom(D3, 60)];
    expect(rows[1].percentage).toBe(17);
    expect(currentStreak(rows, D3)).toBe(1);
  });

  it("TEST 4b — an earned recovery day instead keeps the run alive", () => {
    // Five qualifying days, then a genuinely missed day that qualifies for
    // recovery, then a qualifying day.
    const rows: DayRec[] = [
      day("2026-09-08", 100, 90),
      day("2026-09-09", 100, 90),
      day("2026-09-10", 100, 90),
      day("2026-09-11", 100, 90),
      day("2026-09-12", 100, 90),
      day("2026-09-13", 300, 60), // failed — earns recovery
      day("2026-09-14", 100, 90),
    ];
    const classified = applyRecoveryKinds(rows, "2026-09-15");
    expect(classified[5].kind).toBe("recovery");
    expect(currentStreak(classified, "2026-09-14")).toBe(6);
  });
});

describe("AUDIT 5 — multiple logs on the same local date count once", () => {
  const D1 = "2026-09-14";

  it("TEST 5 — three separate logs sum into a single day, not three", () => {
    const tasks = [T({ id: "dsa", title: "DSA", estimatedMinutes: 60 })];
    const logs = [L("dsa", 20, D1), L("dsa", 20, D1), L("dsa", 20, D1)];
    const live = liveDayRec(tasks, logs, D1);
    expect(live.plannedMinutes).toBe(60);
    expect(live.completedMinutes).toBe(60);
    expect(live.percentage).toBe(100);
    expect(currentStreak([live], D1)).toBe(1);
    // Even repeated, the calendar date is counted once.
    expect(currentStreak([live, live, live], D1)).toBe(1);
  });
});

describe("AUDIT 6 — daily recurrence and cross-day isolation", () => {
  const D1 = "2026-09-14";
  const D2 = "2026-09-15";

  it("TEST 6 — day 1 completed, day 2 pending, history intact", () => {
    const task = timedTask();
    const done = { ...task, status: "completed" as const, completedAt: at(D1, 18), remainingMinutes: 0 };

    // Day 1: 100%, streak 1.
    const d1 = liveDayRec([task], [L("dsa", 60, D1)], D1);
    expect(d1.percentage).toBe(100);
    expect(currentStreak([d1], D1)).toBe(1);

    // Day 2: the task is pending again with the full estimate.
    const rolled = rolloverTasks([done], [], D2).tasks[0];
    expect(rolled.status).toBe("active");
    expect(rolled.remainingMinutes).toBe(60);
    expect(isTaskDoneOn(rolled, D2)).toBe(false);

    // Day 1's history is untouched by the rollover.
    expect(liveDayRec([task], [L("dsa", 60, D1)], D1).percentage).toBe(100);
    // Day 2 has planned work and nothing done yet.
    const d2 = liveDayRec([rolled], [L("dsa", 60, D1)], D2);
    expect(d2.plannedMinutes).toBe(60);
    expect(d2.completedMinutes).toBe(0);
    expect(d2.percentage).toBe(0);

    // The streak still reads 1 (day 2 is in progress, below threshold).
    expect(currentStreak([d1, d2], D2)).toBe(1);
  });

  it("AUDIT 13-14 — today's completion does not leak into tomorrow, nor vice versa", () => {
    const task = timedTask();
    const doneToday = { ...task, status: "completed" as const, completedAt: at(D1, 20), remainingMinutes: 0 };
    // Yesterday's completion must not read as done today.
    expect(isTaskDoneOn(doneToday, D2)).toBe(false);
    // And today's own completion reads as done today.
    expect(isTaskDoneOn(doneToday, D1)).toBe(true);
  });
});

describe("AUDIT 8-11 — recovery days", () => {
  it("does not award a recovery day without enough recent consistency", () => {
    const rows: DayRec[] = [
      day("2026-09-08", 100, 90),
      day("2026-09-09", 100, 90),
      day("2026-09-10", 100, 90), // only 3 qualifying days
      day("2026-09-11", 300, 60), // failed
    ];
    const classified = applyRecoveryKinds(rows, "2026-09-12");
    expect(classified[3].kind).toBe("normal");
    expect(currentStreak(classified, "2026-09-11")).toBe(3);
  });

  it("AUDIT 10 — caps recovery days per calendar month", () => {
    const rows: DayRec[] = [1, 2, 3, 4, 5].map((d) =>
      day(`2026-03-0${d}`, 200, 180),
    );
    rows.push(day("2026-03-06", 200, 40));
    rows.push(day("2026-03-07", 200, 40));
    rows.push(day("2026-03-08", 200, 40));
    const classified = applyRecoveryKinds(rows, "2026-03-09");
    const recoveries = classified.filter((r) => r.kind === "recovery");
    expect(recoveries).toHaveLength(RECOVERY_RULES.maximumRecoveryDaysPerMonth);
    expect(recoveries.map((r) => r.date)).toEqual(["2026-03-06", "2026-03-07"]);
  });

  it("AUDIT 11 — a recovery day never inflates performance to 100%", () => {
    const recovered = day("2026-09-13", 300, 60, "recovery");
    expect(recovered.percentage).toBe(20);
    // Excluded from productivity aggregates entirely — not counted as perfect.
    const agg = aggregate([day("2026-09-14", 100, 90), recovered]);
    expect(agg.plannedMinutes).toBe(100);
    expect(agg.completedMinutes).toBe(90);
    expect(agg.percentage).toBe(90);
    // ...and neutral for the streak: it neither extends the run nor breaks it,
    // so only the two qualifying days on either side are counted.
    expect(
      currentStreak(
        [day("2026-09-12", 100, 90), recovered, day("2026-09-14", 100, 90)],
        "2026-09-14",
      ),
    ).toBe(2);
  });

  it("AUDIT 9 — today is never pre-classified as a recovery day", () => {
    const rows: DayRec[] = [
      day("2026-09-08", 100, 90),
      day("2026-09-09", 100, 90),
      day("2026-09-10", 100, 90),
      day("2026-09-11", 100, 90),
      day("2026-09-12", 100, 90),
      day("2026-09-13", 300, 60), // today, in progress
    ];
    const classified = applyRecoveryKinds(rows, "2026-09-13");
    expect(classified[5].kind).toBe("normal");
  });
});

describe("AUDIT 12 — durationless work cannot distort the streak", () => {
  const D1 = "2026-09-14";

  it("a day of only completion-based tasks stays neutral", () => {
    const untimed = (id: string, section: Task["section"]): Task =>
      T({ id, title: id, section, estimatedMinutes: null, remainingMinutes: 0, dueDate: D1 });

    const rec = liveDayRec([untimed("form", "remainder"), untimed("movie", "occasional")], [], D1);
    expect(rec.plannedMinutes).toBe(0);
    expect(rec.percentage).toBeNull();
    // Neutral: not 0%, not 100%, and it does not break a run.
    expect(currentStreak([day("2026-09-13", 100, 90), rec, day("2026-09-15", 100, 90)], "2026-09-15")).toBe(2);
  });

  it("a durationless task completed today leaves a time-based day untouched", () => {
    const timed = timedTask();
    const untimed = T({ id: "form", title: "Submit form", section: "remainder", estimatedMinutes: null, remainingMinutes: 0, dueDate: D1 });
    const logs = [L("dsa", 45, D1)];

    const baseline = liveDayRec([timed], logs, D1);
    const mixed = liveDayRec([timed, untimed], logs, D1);
    expect(mixed).toEqual(baseline);
    expect(mixed.percentage).toBe(75);
  });
});

describe("AUDIT 15 — unique local calendar dates", () => {
  it("uses the device's local date, not a UTC shift", () => {
    // 23:30 local must stay on today's local date.
    const lateNight = new Date(2026, 8, 6, 23, 30, 0);
    expect(dateKey(lateNight)).toBe("2026-09-06");
    // Just after midnight belongs to the new local day.
    expect(dateKey(new Date(2026, 8, 7, 0, 15, 0))).toBe("2026-09-07");
  });

  it("counts a late-night log on its own local day, exactly once", () => {
    const D = "2026-09-06";
    const rec = dayFrom(D, 60);
    expect(rec.percentage).toBe(100);
    expect(currentStreak([rec], D)).toBe(1);

    // The run carries into the next day until that day resolves (yesterday's
    // qualifying day is not erased at midnight)…
    expect(currentStreak([rec], "2026-09-07")).toBe(1);
    // …and the 09-06 record stays exactly one day: completing 09-07 extends the
    // run to 2 rather than the record being re-attributed to 09-07.
    expect(currentStreak([rec, dayFrom("2026-09-07", 60)], "2026-09-07")).toBe(2);
  });
});

describe("TEST 14 — historical performance is correct with nullable durations", () => {
  const MON = "2026-09-14"; // Monday
  const TUE = "2026-09-15";
  const WED = "2026-09-16";

  /** Mon 100%, Tue 50%, Wed a durationless task only (neutral). */
  const rows: DayRec[] = [
    liveDayRec([timedTask("dsa")], [L("dsa", 60, MON)], MON),
    liveDayRec([timedTask("ml")], [L("ml", 30, TUE)], TUE),
    liveDayRec(
      [T({ id: "form", title: "Submit form", section: "remainder", estimatedMinutes: null, remainingMinutes: 0, dueDate: WED })],
      [],
      WED,
    ),
  ];

  it("rolls up the week, month and year from the same corrected series", () => {
    expect(rows.map((r) => r.percentage)).toEqual([100, 50, null]);

    // The neutral durationless day is excluded from every window.
    const week = weeklyAggregate(rows, WED);
    expect(week.plannedMinutes).toBe(120);
    expect(week.completedMinutes).toBe(90);
    expect(week.percentage).toBe(75);

    expect(monthlyAggregate(rows, WED).percentage).toBe(75);
    expect(yearlyAggregate(rows, WED).percentage).toBe(75);
  });

  it("keeps future days out of the rollups", () => {
    const withFuture = [...rows, day("2026-09-20", 100, 100)];
    expect(weeklyAggregate(withFuture, WED).plannedMinutes).toBe(120);
    expect(monthlyAggregate(withFuture, WED).percentage).toBe(75);
  });

  it("reports the longest run across the audited series", () => {
    const series = [
      day("2026-09-08", 100, 90),
      day("2026-09-09", 100, 90),
      day("2026-09-10", 100, 50),
      day("2026-09-11", 100, 90),
      day("2026-09-12", 100, 95),
      day("2026-09-13", 100, 99),
    ];
    expect(longestStreak(series)).toBe(3);
    expect(currentStreak(series, "2026-09-13")).toBe(3);
  });
});

describe("AUDIT — no NaN, Infinity or 0÷0 can reach the display", () => {
  it("guards every degenerate input", () => {
    const cases: DayRec[] = [
      liveDayRec([], [], "2026-09-14"),
      liveDayRec([T({ id: "z", title: "Zero", estimatedMinutes: 0, remainingMinutes: 0 })], [], "2026-09-14"),
    ];
    for (const rec of cases) {
      expect(rec.percentage).toBeNull();
      expect(Number.isFinite(rec.plannedMinutes)).toBe(true);
      expect(Number.isFinite(rec.completedMinutes)).toBe(true);
    }
    const agg = aggregate(cases);
    expect(agg.percentage).toBeNull();
    expect(Number.isFinite(agg.plannedMinutes)).toBe(true);
  });

  it("clamps over-logging instead of exceeding 100%", () => {
    const rec = liveDayRec([timedTask()], [L("dsa", 600, "2026-09-14")], "2026-09-14");
    expect(rec.percentage).toBe(100);
    expect(rec.completedMinutes).toBe(60);
  });
});
