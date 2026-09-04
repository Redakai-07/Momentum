import { PROFILE, type DailyPerformance, type Task, type TimeLog } from "./types";
import { taskOccursOn } from "./schedule";

export interface DayRec {
  date: string;
  plannedMinutes: number;
  completedMinutes: number;
  percentage: number | null;
}

export function isRestDay(rec: DayRec): boolean {
  return rec.plannedMinutes === 0 || rec.percentage === null;
}

/** Day plan/workload for tasks that occur on `key`. */
export function workloadForTasks(tasks: Task[], key: string) {
  const occurring = tasks.filter((t) => taskOccursOn(t, key));
  let planned = 0;
  let remaining = 0;
  for (const t of occurring) {
    planned += t.estimatedMinutes;
    remaining += t.completed ? 0 : Math.max(0, t.remainingMinutes);
  }
  const completed = Math.max(0, planned - remaining);
  return { planned, remaining, completed, count: occurring.length };
}

/** Live performance record for one day computed from tasks + time logs. */
export function liveDayRec(
  tasks: Task[],
  logs: TimeLog[],
  key: string,
): DayRec {
  const { planned } = workloadForTasks(tasks, key);
  let completed = 0;
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

/** Prefer live data (today) over mock history for a given key. */
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

export function aggregate(recs: DayRec[]): DayAggregate {
  const planned = recs.reduce((s, r) => s + r.plannedMinutes, 0);
  const completed = recs.reduce((s, r) => s + r.completedMinutes, 0);
  return {
    plannedMinutes: planned,
    completedMinutes: completed,
    percentage: planned > 0 ? Math.round((completed / planned) * 100) : null,
  };
}

export function averagePercentage(recs: DayRec[]): number | null {
  const active = recs.filter((r) => !isRestDay(r));
  if (active.length === 0) return null;
  return Math.round(
    active.reduce((s, r) => s + (r.percentage ?? 0), 0) / active.length,
  );
}

/**
 * Consistency streak. A day counts when it has planned activity and its
 * performance meets the threshold. Rest days (no plan) neither extend nor
 * break the streak. The current (in-progress) day only counts once it has
 * already crossed the threshold — a partial day never breaks the streak.
 */
export function currentStreak(recs: DayRec[], todayKey: string): number {
  const threshold = PROFILE.streakThreshold * 100;
  let streak = 0;
  for (let i = recs.length - 1; i >= 0; i--) {
    const r = recs[i];
    if (r.date > todayKey) continue;
    if (r.date === todayKey) {
      if (r.plannedMinutes > 0 && (r.percentage ?? 0) >= threshold) streak += 1;
      continue; // partial today never breaks, never over-counts when below
    }
    if (isRestDay(r)) continue;
    if ((r.percentage ?? 0) >= threshold) streak += 1;
    else break;
  }
  return streak;
}

/** Longest streak inside a historical series. */
export function longestStreak(recs: DayRec[]): number {
  const threshold = PROFILE.streakThreshold * 100;
  let best = 0;
  let run = 0;
  for (const r of recs) {
    if (isRestDay(r)) continue;
    if ((r.percentage ?? 0) >= threshold) {
      run += 1;
      best = Math.max(best, run);
    } else {
      run = 0;
    }
  }
  return best;
}
