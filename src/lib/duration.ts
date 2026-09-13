import type { Task, TaskDuration } from "./types";

/**
 * Task duration — the single source of truth.
 *
 * Momentum has two kinds of work, and the distinction is load-bearing:
 *
 * - **time-based** — has a planned duration. Tracked with planned / completed /
 *   remaining minutes and counted in the time-based daily performance.
 * - **completion-based** — `estimatedMinutes` is `null`. Tracked by completion
 *   state alone. It must never contribute planned minutes, because a
 *   durationless task adding `0` planned minutes next to `0` completed minutes
 *   is harmless, but *any* other treatment (a fake 0-minute estimate, a NaN
 *   percentage, a 0%-day) would silently corrupt performance and streaks.
 *
 * Everything that reasons about duration goes through these helpers, so the
 * rule lives in exactly one place.
 */

type DurationCarrier = Pick<Task, "estimatedMinutes">;
type RemainingCarrier = Pick<Task, "estimatedMinutes" | "remainingMinutes">;

/**
 * True when a task tracks time.
 *
 * Tolerates legacy data: `null`, `undefined` and `0` all mean "no duration".
 */
export function isTimedTask(task: DurationCarrier): boolean {
  const minutes = task.estimatedMinutes;
  return typeof minutes === "number" && Number.isFinite(minutes) && minutes > 0;
}

/** Planned minutes contributed to performance — 0 for completion-based work. */
export function plannedMinutesOf(task: DurationCarrier): number {
  return isTimedTask(task) ? Math.round(task.estimatedMinutes as number) : 0;
}

/** What is left of a timed task; always 0 for completion-based work. */
export function remainingMinutesOf(task: RemainingCarrier): number {
  const planned = plannedMinutesOf(task);
  if (planned <= 0) return 0;
  const left = typeof task.remainingMinutes === "number" ? task.remainingMinutes : planned;
  if (!Number.isFinite(left)) return planned;
  return Math.max(0, Math.min(planned, Math.round(left)));
}

/** Minutes already completed on a timed task; 0 for completion-based work. */
export function completedMinutesOf(task: RemainingCarrier): number {
  const planned = plannedMinutesOf(task);
  if (planned <= 0) return 0;
  return Math.max(0, planned - remainingMinutesOf(task));
}

/**
 * Time progress of a task, 0–100, or `null` for completion-based work.
 * Returning `null` (rather than 0) is what keeps "no duration" out of every
 * percentage calculation.
 */
export function taskProgress(task: RemainingCarrier): number | null {
  const planned = plannedMinutesOf(task);
  if (planned <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((completedMinutesOf(task) / planned) * 100)));
}

/**
 * Normalize a user-entered duration.
 *
 * Anything missing, non-finite or not positive becomes `null` — "no duration".
 * This is how an explicitly cleared field is stored, so a task is never given
 * a meaningless fake estimate like 0 or 1 minute.
 */
export function normalizeDuration(value: number | null | undefined): TaskDuration {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  return rounded > 0 ? rounded : null;
}

/**
 * The label for a task's duration: the formatted minutes, or `null` when the
 * task is completion-based (callers should show nothing / "No duration").
 */
export function durationLabel(
  task: DurationCarrier,
  format: (minutes: number) => string,
): string | null {
  return isTimedTask(task) ? format(plannedMinutesOf(task)) : null;
}
