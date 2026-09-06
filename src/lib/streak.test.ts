import { describe, expect, it } from "vitest";
import { currentStreak, longestStreak, liveDayRec, type DayRec } from "./performance";
import { PROFILE } from "./types";
import { dateKey, addDaysKey } from "./date";
import type { Task, TimeLog } from "./types";

const THRESHOLD = PROFILE.streakThreshold * 100; // 70

const T = (o: Partial<Task> & { id: string; title: string }): Task => ({
  section: "daily",
  estimatedMinutes: o.estimatedMinutes ?? 60,
  remainingMinutes: o.remainingMinutes ?? (o.estimatedMinutes ?? 60),
  status: o.status ?? "active",
  schedule: o.schedule ?? { type: "daily" },
  createdAt: "2026-01-01T09:00:00.000Z",
  ...o,
});

const L = (taskId: string, minutes: number, date: string): TimeLog => ({
  id: `${taskId}-${date}-${minutes}`,
  taskId,
  minutes,
  date,
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

describe("Streak behavior — deterministic unit tests", () => {
  // ------------------------------------------------------------------
  // Test 1: No activity → streak = 0
  // ------------------------------------------------------------------
  it("Test 1: no activity → streak = 0", () => {
    const rows: DayRec[] = [];
    expect(currentStreak(rows, "2026-09-04")).toBe(0);
  });

  // ------------------------------------------------------------------
  // Test 2: One qualifying day → streak = 1
  // ------------------------------------------------------------------
  it("Test 2: one qualifying day → streak = 1", () => {
    const rows = [rec("2026-09-04", 60, 50)]; // 83% ≥ 70%
    expect(currentStreak(rows, "2026-09-04")).toBe(1);
  });

  // ------------------------------------------------------------------
  // Test 3: One day with multiple time logs → streak = 1
  //   Three separate logs on the same calendar day must count as ONE day.
  // ------------------------------------------------------------------
  it("Test 3: one day with multiple time logs → streak = 1", () => {
    const tasks = [T({ id: "a", title: "DSA", estimatedMinutes: 90 })];
    const logs = [
      L("a", 10, "2026-09-04"),
      L("a", 20, "2026-09-04"),
      L("a", 40, "2026-09-04"),
    ];
    const live = liveDayRec(tasks, logs, "2026-09-04");
    // 90 planned, 70 completed → 77.7% → 78% ≥ 70%
    expect(live.plannedMinutes).toBe(90);
    expect(live.completedMinutes).toBe(70);
    expect(live.percentage).toBe(78);

    // Duplicate the live row to simulate the bug scenario: stored history
    // for today + a live snapshot both present. Deduplication must keep it 1.
    const duplicated = [live, live];
    expect(currentStreak(duplicated, "2026-09-04")).toBe(1);
  });

  // ------------------------------------------------------------------
  // Test 4: Two consecutive qualifying days → streak = 2
  // ------------------------------------------------------------------
  it("Test 4: two consecutive qualifying days → streak = 2", () => {
    const rows = [
      rec("2026-09-04", 60, 50), // 83%
      rec("2026-09-05", 60, 50), // 83%
    ];
    expect(currentStreak(rows, "2026-09-05")).toBe(2);
  });

  // ------------------------------------------------------------------
  // Test 5: Three consecutive qualifying days → streak = 3
  // ------------------------------------------------------------------
  it("Test 5: three consecutive qualifying days → streak = 3", () => {
    const rows = [
      rec("2026-09-03", 60, 50),
      rec("2026-09-04", 60, 50),
      rec("2026-09-05", 60, 50),
    ];
    expect(currentStreak(rows, "2026-09-05")).toBe(3);
  });

  // ------------------------------------------------------------------
  // Test 6: Qualifying day → gap → qualifying day → resets
  // ------------------------------------------------------------------
  it("Test 6: qualifying day → gap → qualifying day → streak resets", () => {
    const rows = [
      rec("2026-09-03", 60, 50), // 83% — qualifies
      rec("2026-09-04", 60, 20), // 33% — below threshold, breaks streak
      rec("2026-09-05", 60, 50), // 83% — new streak of 1
    ];
    expect(currentStreak(rows, "2026-09-05")).toBe(1);
  });

  // ------------------------------------------------------------------
  // Test 7: Today below 70% → must not incorrectly increase the streak
  //   (the original bug: logging time could push today's count to 2)
  // ------------------------------------------------------------------
  it("Test 7: today below 70% → today must not increase the streak", () => {
    const rows = [
      rec("2026-09-03", 60, 50), // 83% — qualifies
      rec("2026-09-04", 60, 20), // 33% — today below threshold
    ];
    expect(currentStreak(rows, "2026-09-04")).toBe(1);
  });

  it("Test 7b: first qualifying day never produces 2, even with duplicate today rows", () => {
    // Simulate the exact reported bug: a user's first day, after logging time
    // that crosses the threshold. The stored history row for today + the live
    // snapshot both qualify. Deduplication must yield 1, not 2.
    const today = "2026-09-05";
    const tasks = [T({ id: "x", title: "X", estimatedMinutes: 60 })];
    const logs = [L("x", 45, today)]; // 75% ≥ 70%
    const live = liveDayRec(tasks, logs, today);

    // The bug: caller passes [historyRowForToday, live] where both qualify.
    const buggyInput = [live, live];
    expect(currentStreak(buggyInput, today)).toBe(1);

    // A historical qualifying day plus today should be 2, not 3.
    const historical = [
      rec(addDaysKey(today, -1), 60, 50), // yesterday: 83%
      live,
      live, // duplicate today — must not inflate
    ];
    expect(currentStreak(historical, today)).toBe(2);
  });

  // ------------------------------------------------------------------
  // Test 8: Recovery Day — existing behavior preserved
  // ------------------------------------------------------------------
  it("Test 8: recovery day is neutral — neither extends nor breaks the streak", () => {
    const rows = [
      rec("2026-09-01", 60, 50), // 83%
      rec("2026-09-02", 60, 50), // 83%
      rec("2026-09-03", 60, 50), // 83%
      rec("2026-09-04", 60, 50), // 83%
      rec("2026-09-05", 60, 50), // 83% — five qualifying days
      rec("2026-09-06", 60, 20, "recovery"), // missed day, earned recovery
      rec("2026-09-07", 60, 50), // 83% — streak continues through recovery
    ];
    expect(currentStreak(rows, "2026-09-07")).toBe(6);
  });

  it("Test 8b: a normal failed day after a recovery day breaks the streak", () => {
    // Recovery days are neutral. A subsequent failed normal day (no recovery
    // earned) breaks the streak.
    const rows = [
      rec("2026-09-01", 60, 50), // 83%
      rec("2026-09-02", 60, 50), // 83%
      rec("2026-09-03", 60, 50), // 83%
      rec("2026-09-04", 60, 50), // 83%
      rec("2026-09-05", 60, 50), // 83%
      rec("2026-09-06", 60, 20, "recovery"), // neutral — streak intact
      rec("2026-09-07", 60, 20), // 33% — normal failed day → breaks
    ];
    // The recovery day (Sep 6) is neutral. Sep 7 is a normal failed day that
    // breaks the streak, so only Sep 1–5 count plus the recovery day's
    // neutrality means the streak ends at 5 (Sep 1–5).
    expect(currentStreak(rows, "2026-09-07")).toBe(5);
  });

  // ------------------------------------------------------------------
  // Test 9: Activity around midnight → correct local calendar date
  //   India: Sep 6 11:30 PM local must belong to Sep 6, not Sep 7.
  // ------------------------------------------------------------------
  it("Test 9: activity around midnight belongs to the local calendar date", () => {
    // Simulate a log made at 23:30 local on Sep 6. The date utility must
    // normalize it to "2026-09-06", not shift it to Sep 7 via UTC.
    const IndiaSep6_1130pm = new Date(2026, 8, 6, 23, 30, 0); // local
    expect(dateKey(IndiaSep6_1130pm)).toBe("2026-09-06");

    const afterMidnight = new Date(2026, 8, 7, 0, 15, 0);
    expect(dateKey(afterMidnight)).toBe("2026-09-07");

    // Streak uses the normalized key, so the late-night log counts for Sep 6.
    const tasks = [T({ id: "a", title: "A", estimatedMinutes: 60 })];
    const logs = [
      L("a", 30, "2026-09-06"),
      L("a", 30, "2026-09-06"), // same local date, second log
    ];
    const live = liveDayRec(tasks, logs, "2026-09-06");
    expect(live.plannedMinutes).toBe(60);
    expect(live.completedMinutes).toBe(60);
    expect(live.percentage).toBe(100);
    expect(currentStreak([live], "2026-09-06")).toBe(1);
  });

  // ------------------------------------------------------------------
  // Test 10: Duplicate records for the same date → counted only once
  // ------------------------------------------------------------------
  it("Test 10: duplicate records for the same date are counted once", () => {
    const today = "2026-09-05";
    const rows = [
      rec(addDaysKey(today, -3), 60, 50),
      rec(addDaysKey(today, -2), 60, 50),
      rec(addDaysKey(today, -1), 60, 50),
      rec(today, 60, 50), // today
      rec(today, 60, 50), // duplicate today
      rec(today, 60, 50), // another duplicate
    ];
    expect(currentStreak(rows, today)).toBe(4);
  });

  it("Test 10b: duplicate historical rows do not inflate longestStreak", () => {
    const rows = [
      rec("2026-09-01", 60, 50),
      rec("2026-09-01", 60, 50), // dup
      rec("2026-09-02", 60, 50),
      rec("2026-09-02", 60, 50), // dup
      rec("2026-09-03", 60, 50),
    ];
    expect(longestStreak(rows)).toBe(3);
  });

  // ------------------------------------------------------------------
  // Edge: future-dated rows ignored
  // ------------------------------------------------------------------
  it("ignores future-dated rows (streak looks backward from today)", () => {
    const rows = [
      rec("2026-09-04", 60, 50),
      rec("2026-09-05", 60, 50),
      rec("2026-09-06", 60, 50), // future relative to today 2026-09-05
    ];
    expect(currentStreak(rows, "2026-09-05")).toBe(2);
  });

  // ------------------------------------------------------------------
  // Edge: rest days (nothing planned) are neutral
  // ------------------------------------------------------------------
  it("rest days (nothing planned) are neutral and do not break the streak", () => {
    const rows = [
      rec("2026-09-03", 60, 50),
      rec("2026-09-04", 0, 0), // rest — neutral
      rec("2026-09-05", 60, 50),
    ];
    expect(currentStreak(rows, "2026-09-05")).toBe(2);
  });
});
