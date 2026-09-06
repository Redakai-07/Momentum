import { PROFILE, type DailyPerformance, type DayKind, type Task, type TimeLog } from "./types";
import { taskOccursOn } from "./schedule";
import { dateKey, normalizeDateKey, parseKey, startOfWeek } from "./date";

/** True when at least one time log exists for `taskId` on `date`. */
function hasLogOn(logs: TimeLog[], taskId: string, date: string): boolean {
  return logs.some((l) => l.taskId === taskId && l.date === date);
}

export interface DayRec {
  date: string;
  plannedMinutes: number;
  completedMinutes: number;
  percentage: number | null;
  /** Classification, when known (see lib/activity.ts). */
  kind?: DayKind;
}

/** A day with nothing planned — neutral for streaks and analytics. */
export function isRestDay(rec: DayRec): boolean {
  return rec.plannedMinutes === 0 || rec.percentage === null;
}

/** Rest, inactive, or earned recovery — never breaks the streak. */
export function isNeutralRec(rec: DayRec): boolean {
  return isRestDay(rec) || rec.kind === "inactive" || rec.kind === "recovery";
}

/** Day plan/workload for tasks that occur on `key`. */
export function workloadForTasks(tasks: Task[], key: string) {
  const occurring = tasks.filter(
    (t) => taskOccursOn(t, key) && t.status !== "accomplished",
  );
  let planned = 0;
  let remaining = 0;
  for (const t of occurring) {
    planned += t.estimatedMinutes;
    remaining += t.status === "active" ? Math.max(0, t.remainingMinutes) : 0;
  }
  const completed = Math.max(0, planned - remaining);
  return { planned, remaining, completed, count: occurring.length };
}

/**
 * Performance record for one day computed from tasks + time logs.
 * A logged one-off (e.g. a remainder task with no schedule) also counts as
 * planned work for that day — effort should never be invisible to the streak.
 */
export function liveDayRec(
  tasks: Task[],
  logs: TimeLog[],
  key: string,
): DayRec {
  let planned = 0;
  let completed = 0;
  for (const t of tasks) {
    if (t.status === "accomplished") continue;
    if (!taskOccursOn(t, key) && !hasLogOn(logs, t.id, key)) continue;
    planned += t.estimatedMinutes;
  }
  for (const l of logs) {
    if (l.date === key) completed += l.minutes;
  }
  completed = Math.min(completed, planned || completed);
  return {
    date: key,
    plannedMinutes: planned,
    completedMinutes: completed,
    percentage:
      planned > 0 ? Math.min(100, Math.round((completed / planned) * 100)) : null,
  };
}

/** Prefer live data (today) over stored history for a given key. */
export function pickDayRec(
  history: DailyPerformance[],
  live: DayRec | null,
  key: string,
): DayRec {
  if (live && live.date === key) return live;
  const found = history.find((h) => h.date === key);
  if (found) return found;
  return { date: key, plannedMinutes: 0, completedMinutes: 0, percentage: null };
}

export interface DayAggregate {
  plannedMinutes: number;
  completedMinutes: number;
  /** Weighted percentage (by planned minutes) or null when nothing was planned. */
  percentage: number | null;
}

/**
 * Aggregate across days that actually count: rest, inactive and earned
 * recovery days are neutral and excluded, so a recovery day can neither
 * break nor inflate the numbers.
 */
export function aggregate(recs: DayRec[]): DayAggregate {
  let planned = 0;
  let completed = 0;
  for (const r of recs) {
    if (isNeutralRec(r)) continue;
    planned += r.plannedMinutes;
    completed += r.completedMinutes;
  }
  return {
    plannedMinutes: planned,
    completedMinutes: completed,
    percentage: planned > 0 ? Math.round((completed / planned) * 100) : null,
  };
}

/** Raw planned/completed totals (all days, even recovery) for hour counts. */
export function rawTotals(recs: DayRec[]): DayAggregate {
  const planned = recs.reduce((s, r) => s + r.plannedMinutes, 0);
  const completed = recs.reduce((s, r) => s + r.completedMinutes, 0);
  return {
    plannedMinutes: planned,
    completedMinutes: completed,
    percentage: planned > 0 ? Math.round((completed / planned) * 100) : null,
  };
}

export function averagePercentage(recs: DayRec[]): number | null {
  const active = recs.filter((r) => !isNeutralRec(r));
  if (active.length === 0) return null;
  return Math.round(
    active.reduce((s, r) => s + (r.percentage ?? 0), 0) / active.length,
  );
}

/* ------------------------------------------------------------------ */
/* Period rollups (week / month / year)                                */
/* ------------------------------------------------------------------ */

/**
 * Performance for the Monday-first week containing `today`, counting only
 * days up to and including `today` (the in-progress day is never excluded).
 */
export function weeklyAggregate(recs: DayRec[], today: string): DayAggregate {
  const monday = dateKey(startOfWeek(parseKey(today)));
  return aggregate(recs.filter((r) => r.date >= monday && r.date <= today));
}

/** Performance for the calendar month containing `today`, up to `today`. */
export function monthlyAggregate(recs: DayRec[], today: string): DayAggregate {
  const month = today.slice(0, 7);
  return aggregate(recs.filter((r) => r.date.slice(0, 7) === month && r.date <= today));
}

/** Performance for the calendar year containing `today`, up to `today`. */
export function yearlyAggregate(recs: DayRec[], today: string): DayAggregate {
  const year = today.slice(0, 4);
  return aggregate(recs.filter((r) => r.date.slice(0, 4) === year && r.date <= today));
}

/**
 * Consistency streak. A day counts when it has planned activity and its
 * performance meets the threshold. Rest days and earned recovery days neither
 * extend nor break the streak. The current (in-progress) day only counts once
 * it has already crossed the threshold — a partial day never breaks the streak.
 */
export function currentStreak(recs: DayRec[], todayKey: string): number {
  const threshold = PROFILE.streakThreshold * 100;

  // A given calendar date must be counted at most once. Different callers
  // pass overlapping slices (stored history + a live today snapshot), and a
  // fresh user's first qualifying day must produce 1, never 2.
  const byDate = new Map<string, DayRec>();
  for (const r of recs) {
    // The last occurrence for a date wins — callers append the live snapshot
    // after the stored history, so today's live numbers take precedence.
    const normalizedDate = normalizeDateKey(r.date);
    byDate.set(normalizedDate, { ...r, date: normalizedDate });
  }
  const unique = [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));

  let streak = 0;
  for (let i = unique.length - 1; i >= 0; i--) {
    const r = unique[i];
    if (r.date > todayKey) continue;
    if (r.date === todayKey) {
      if (r.plannedMinutes > 0 && (r.percentage ?? 0) >= threshold) streak += 1;
      continue; // partial today never breaks, never over-counts when below
    }
    if (isNeutralRec(r)) continue;
    if ((r.percentage ?? 0) >= threshold) streak += 1;
    else break;
  }
  return streak;
}

/** Longest streak inside a historical series. */
export function longestStreak(recs: DayRec[]): number {
  const threshold = PROFILE.streakThreshold * 100;

  // Deduplicate by date so a duplicated today can never inflate the run.
  const byDate = new Map<string, DayRec>();
  for (const r of recs) {
    const normalizedDate = normalizeDateKey(r.date);
    byDate.set(normalizedDate, { ...r, date: normalizedDate });
  }
  const unique = [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));

  let best = 0;
  let run = 0;
  for (const r of unique) {
    if (isNeutralRec(r)) continue;
    if ((r.percentage ?? 0) >= threshold) {
      run += 1;
      best = Math.max(best, run);
    } else {
      run = 0;
    }
  }
  return best;
}
