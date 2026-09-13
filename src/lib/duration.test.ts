import { describe, expect, it } from "vitest";
import {
  completedMinutesOf,
  isTimedTask,
  normalizeDuration,
  plannedMinutesOf,
  remainingMinutesOf,
  taskProgress,
} from "./duration";
import { aggregate, currentStreak, isRestDay, liveDayRec, workloadForTasks } from "./performance";
import { rolloverTasks } from "./task-state";
import type { Task, TaskDuration, TimeLog } from "./types";

/**
 * Optional duration.
 *
 * Reminder and Occasional work often has no meaningful duration. Momentum
 * stores that explicitly as `estimatedMinutes: null` and keeps it out of the
 * minute-based performance math entirely — a durationless task must never read
 * as "0 planned, 0 completed", because that would drag a day's percentage
 * around while measuring nothing.
 */

const DAY = "2026-09-14";

const T = (o: Partial<Task> & { id: string; title: string }): Task => ({
  section: "daily",
  estimatedMinutes: 60,
  remainingMinutes: 60,
  status: "active",
  createdAt: "2026-01-01T09:00:00.000Z",
  ...o,
});

const L = (taskId: string, minutes: number, date = DAY): TimeLog => ({
  id: `${taskId}-${date}-${minutes}`,
  taskId,
  minutes,
  date,
});

/** A durationless task, as the form now stores it. */
const untimed = (o: Partial<Task> & { id: string; title: string }): Task =>
  T({ section: "remainder", estimatedMinutes: null, remainingMinutes: 0, ...o });

describe("duration helpers", () => {
  it("treats null, undefined and 0 as 'no duration'", () => {
    expect(isTimedTask({ estimatedMinutes: null })).toBe(false);
    expect(isTimedTask({ estimatedMinutes: undefined as unknown as TaskDuration })).toBe(false);
    expect(isTimedTask({ estimatedMinutes: 0 })).toBe(false);
  });

  it("treats a positive estimate as time-based", () => {
    expect(isTimedTask({ estimatedMinutes: 1 })).toBe(true);
    expect(isTimedTask({ estimatedMinutes: 45 })).toBe(true);
  });

  it("never contributes planned minutes for completion-based work", () => {
    expect(plannedMinutesOf({ estimatedMinutes: null })).toBe(0);
    expect(plannedMinutesOf({ estimatedMinutes: 0 })).toBe(0);
    expect(plannedMinutesOf({ estimatedMinutes: 90 })).toBe(90);
  });

  it("clamps remaining minutes into 0…planned and returns 0 for untimed work", () => {
    expect(remainingMinutesOf({ estimatedMinutes: null, remainingMinutes: 999 })).toBe(0);
    expect(remainingMinutesOf({ estimatedMinutes: 60, remainingMinutes: 20 })).toBe(20);
    expect(remainingMinutesOf({ estimatedMinutes: 60, remainingMinutes: 999 })).toBe(60);
    expect(remainingMinutesOf({ estimatedMinutes: 60, remainingMinutes: -5 })).toBe(0);
  });

  it("reports progress as null (never 0 or NaN) for completion-based work", () => {
    expect(taskProgress({ estimatedMinutes: null, remainingMinutes: 0 })).toBeNull();
    expect(taskProgress({ estimatedMinutes: 60, remainingMinutes: 0 })).toBe(100);
    expect(taskProgress({ estimatedMinutes: 60, remainingMinutes: 30 })).toBe(50);
    expect(completedMinutesOf({ estimatedMinutes: 60, remainingMinutes: 30 })).toBe(30);
    expect(completedMinutesOf({ estimatedMinutes: null, remainingMinutes: 0 })).toBe(0);
  });

  it("normalizes user input — nothing, zero and junk all mean 'no duration'", () => {
    expect(normalizeDuration(null)).toBeNull();
    expect(normalizeDuration(undefined)).toBeNull();
    expect(normalizeDuration(0)).toBeNull();
    expect(normalizeDuration(-30)).toBeNull();
    expect(normalizeDuration(Number.NaN)).toBeNull();
    expect(normalizeDuration(Number.POSITIVE_INFINITY)).toBeNull();
    expect(normalizeDuration(45.4)).toBe(45);
    expect(normalizeDuration(60)).toBe(60);
  });
});

describe("TEST 9 / 10 — durationless Reminder and Occasional tasks", () => {
  it("completes with no fake duration and no NaN anywhere", () => {
    const reminder = untimed({ id: "form", title: "Submit application" });
    const occasional = untimed({ id: "movie", title: "Watch movie", section: "occasional" });

    expect(isTimedTask(reminder)).toBe(false);
    expect(plannedMinutesOf(reminder)).toBe(0);
    expect(taskProgress(reminder)).toBeNull();

    // A day holding only completion-based work is a neutral (rest) day —
    // explicitly null, never 0% or 100%.
    const rec = liveDayRec([reminder, occasional], [], DAY);
    expect(rec.plannedMinutes).toBe(0);
    expect(rec.completedMinutes).toBe(0);
    expect(rec.percentage).toBeNull();
    expect(isRestDay(rec)).toBe(true);
    expect(Number.isNaN(rec.percentage as unknown as number)).toBe(false);
  });

  it("does not move the streak — neither up nor down", () => {
    const onlyUntimed = liveDayRec([untimed({ id: "a", title: "Form" })], [], DAY);
    expect(currentStreak([onlyUntimed], DAY)).toBe(0);

    // A neutral day between two qualifying days must not break the run.
    const good = (date: string) => ({ date, plannedMinutes: 60, completedMinutes: 50, percentage: 83 });
    const rows = [good("2026-09-12"), onlyUntimed, good("2026-09-14")];
    expect(currentStreak(rows, DAY)).toBe(2);
  });

  it("keeps completion-based work out of period aggregates", () => {
    const onlyUntimed = liveDayRec([untimed({ id: "a", title: "Form" })], [], DAY);
    const agg = aggregate([onlyUntimed]);
    expect(agg.plannedMinutes).toBe(0);
    expect(agg.percentage).toBeNull();
  });

  it("does not show up as a 0-minute workload", () => {
    const w = workloadForTasks([untimed({ id: "a", title: "Form", dueDate: DAY })], DAY);
    expect(w.planned).toBe(0);
    expect(w.remaining).toBe(0);
    expect(w.completed).toBe(0);
    // ...but it is still counted as a task on the day.
    expect(w.count).toBe(1);
    expect(w.timedCount).toBe(0);
    expect(w.untimedCount).toBe(1);
  });

  it("survives the recurring rollover (nothing to reset, no crash)", () => {
    const done = untimed({ id: "a", title: "Form", status: "completed", completedAt: "2026-09-13T18:00:00.000Z" });
    // Remainder work is a one-off: it must NOT reopen tomorrow.
    expect(rolloverTasks([done], [], DAY).changed).toHaveLength(0);
  });
});

describe("TEST 11 — a mixed day stays strictly time-based", () => {
  const tasks = [
    T({
      id: "dsa",
      title: "DSA",
      estimatedMinutes: 60,
      remainingMinutes: 0,
      status: "completed",
      completedAt: "2026-09-14T08:00:00.000Z",
    }),
    T({ id: "ml", title: "ML", estimatedMinutes: 60, remainingMinutes: 30 }),
    untimed({ id: "form", title: "Submit form", dueDate: DAY, status: "completed", completedAt: "2026-09-14T09:00:00.000Z" }),
  ];
  const logs = [L("dsa", 60), L("ml", 30)];

  it("computes 90 / 120 = 75% exactly as specified", () => {
    const rec = liveDayRec(tasks, logs, DAY);
    expect(rec.plannedMinutes).toBe(120);
    expect(rec.completedMinutes).toBe(90);
    expect(rec.percentage).toBe(75);
  });

  it("produces exactly the same result as the same day without the untimed task", () => {
    const without = liveDayRec(tasks.filter((t) => t.id !== "form"), logs, DAY);
    expect(without.plannedMinutes).toBe(120);
    expect(without.completedMinutes).toBe(90);
    expect(without.percentage).toBe(75);
  });

  it("ignores stray time logs recorded against a durationless task", () => {
    // Defensive: legacy or imported data may carry logs for a task that has no
    // duration. They must not inflate the numerator.
    const withStray = liveDayRec(tasks, [...logs, L("form", 45)], DAY);
    expect(withStray.completedMinutes).toBe(90);
    expect(withStray.percentage).toBe(75);
  });

  it("counts both kinds of task in the workload without mixing minutes", () => {
    const w = workloadForTasks(tasks, DAY);
    expect(w.planned).toBe(120);
    expect(w.remaining).toBe(30);
    expect(w.completed).toBe(90);
    expect(w.count).toBe(3);
    expect(w.timedCount).toBe(2);
    expect(w.untimedCount).toBe(1);
  });
});

describe("TEST 12 — existing rows with missing / null duration", () => {
  it("loads and calculates safely", () => {
    const legacyMissing = T({ id: "a", title: "Legacy A" });
    delete (legacyMissing as unknown as { estimatedMinutes?: unknown }).estimatedMinutes;
    const legacyNull = T({ id: "b", title: "Legacy B", estimatedMinutes: null });
    const legacyZero = T({ id: "c", title: "Legacy C", estimatedMinutes: 0, remainingMinutes: 0 });

    for (const t of [legacyMissing, legacyNull, legacyZero]) {
      expect(isTimedTask(t)).toBe(false);
      expect(plannedMinutesOf(t)).toBe(0);
      expect(remainingMinutesOf(t)).toBe(0);
      expect(taskProgress(t)).toBeNull();
    }

    const rec = liveDayRec([legacyMissing, legacyNull, legacyZero], [], DAY);
    expect(rec.plannedMinutes).toBe(0);
    expect(rec.percentage).toBeNull();
    expect(Number.isFinite(rec.completedMinutes)).toBe(true);
  });
});

describe("TEST 13 — existing timed Reminder keeps working exactly as before", () => {
  it("still contributes planned and completed minutes", () => {
    const report = T({
      id: "report",
      title: "Submit report",
      section: "remainder",
      estimatedMinutes: 30,
      remainingMinutes: 0,
      dueDate: DAY,
      status: "completed",
      completedAt: "2026-09-14T08:00:00.000Z",
    });
    expect(isTimedTask(report)).toBe(true);

    const rec = liveDayRec([report], [L("report", 30)], DAY);
    expect(rec.plannedMinutes).toBe(30);
    expect(rec.completedMinutes).toBe(30);
    expect(rec.percentage).toBe(100);

    const w = workloadForTasks([report], DAY);
    expect(w.planned).toBe(30);
    expect(w.timedCount).toBe(1);
    expect(w.untimedCount).toBe(0);
  });

  it("keeps a partially logged timed Reminder in progress", () => {
    const report = T({
      id: "report",
      title: "Submit report",
      section: "remainder",
      estimatedMinutes: 30,
      remainingMinutes: 10,
      dueDate: DAY,
    });
    const rec = liveDayRec([report], [L("report", 20)], DAY);
    expect(rec.plannedMinutes).toBe(30);
    expect(rec.completedMinutes).toBe(20);
    expect(rec.percentage).toBe(67);
  });
});
