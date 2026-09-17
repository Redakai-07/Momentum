import { dateKey } from "./date";

/**
 * Pomodoro focus engine — pure, timestamp-driven, testable.
 *
 * ## Why nothing here counts with a timer
 *
 * Android suspends the WebView when the app is backgrounded or the screen
 * locks, so a `setInterval` that decrements a counter would silently stop and
 * lose the user's work. Every value below is therefore derived from *wall-clock
 * timestamps*: the UI may tick once a second for display, but elapsed time is
 * always recomputed as `now - runStartedAt`, so closing the app for an hour
 * cannot corrupt the session.
 *
 * ## Where the time actually goes
 *
 * A finished focus phase credits minutes to the task through the ordinary
 * `logTime` path — the same `logs` table normal tracking uses. There is no
 * separate "pomodoro minutes" store, so performance, streaks and remaining
 * time all keep working off one source of truth.
 */

export type FocusPhase = "focus" | "short_break" | "long_break";

/** A session is either ticking or held; there is no third state. */
export type FocusStatus = "running" | "paused";

export interface FocusSettings {
  focusMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  /** Focus phases completed before a long break is offered. */
  sessionsBeforeLongBreak: number;
}

export const DEFAULT_FOCUS_SETTINGS: FocusSettings = {
  focusMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  sessionsBeforeLongBreak: 4,
};

/** Bounds the settings UI, so a typo cannot produce an unusable timer. */
export const FOCUS_LIMITS = {
  focusMinutes: { min: 5, max: 120 },
  shortBreakMinutes: { min: 1, max: 30 },
  longBreakMinutes: { min: 5, max: 60 },
} as const;

export interface FocusSession {
  id: string;
  taskId: string;
  /** Which part of the cycle is on the clock. */
  phase: FocusPhase;
  /** Local calendar day the session belongs to (YYYY-MM-DD). */
  date: string;
  status: FocusStatus;
  /** Epoch ms when the *current run* of this phase began. */
  runStartedAt: number;
  /** Ms of this phase already banked before the current run. */
  bankedMs: number;
  /** Focus phases finished today — drives the long-break cadence. */
  focusDoneToday: number;
  /** Epoch ms of the last state change (pause/resume/start). */
  updatedAt: number;
}

const MIN = 60_000;

/** Guard against nonsense values arriving from storage or the settings form. */
export function clampFocusSettings(s: Partial<FocusSettings> | null | undefined): FocusSettings {
  const pick = (
    value: unknown,
    fallback: number,
    limit: { min: number; max: number },
  ): number => {
    const n = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(limit.max, Math.max(limit.min, Math.round(n)));
  };
  return {
    focusMinutes: pick(s?.focusMinutes, DEFAULT_FOCUS_SETTINGS.focusMinutes, FOCUS_LIMITS.focusMinutes),
    shortBreakMinutes: pick(
      s?.shortBreakMinutes,
      DEFAULT_FOCUS_SETTINGS.shortBreakMinutes,
      FOCUS_LIMITS.shortBreakMinutes,
    ),
    longBreakMinutes: pick(
      s?.longBreakMinutes,
      DEFAULT_FOCUS_SETTINGS.longBreakMinutes,
      FOCUS_LIMITS.longBreakMinutes,
    ),
    sessionsBeforeLongBreak: pick(
      s?.sessionsBeforeLongBreak,
      DEFAULT_FOCUS_SETTINGS.sessionsBeforeLongBreak,
      { min: 2, max: 8 },
    ),
  };
}

/** How long the given phase runs for, in ms. */
export function targetMs(phase: FocusPhase, settings: FocusSettings): number {
  if (phase === "focus") return settings.focusMinutes * MIN;
  if (phase === "short_break") return settings.shortBreakMinutes * MIN;
  return settings.longBreakMinutes * MIN;
}

/** Ms of the current phase already spent, pauses excluded. */
export function elapsedMs(session: FocusSession, now: number = Date.now()): number {
  const live = session.status === "running" ? Math.max(0, now - session.runStartedAt) : 0;
  return Math.max(0, session.bankedMs + live);
}

/** Ms left in the current phase. Never negative. */
export function remainingMs(
  session: FocusSession,
  settings: FocusSettings,
  now: number = Date.now(),
): number {
  return Math.max(0, targetMs(session.phase, settings) - elapsedMs(session, now));
}

/** Whether the phase's clock has run out. */
export function isPhaseComplete(
  session: FocusSession,
  settings: FocusSettings,
  now: number = Date.now(),
): boolean {
  return remainingMs(session, settings, now) <= 0;
}

/** 0–100 completion of the current phase. */
export function phaseProgress(
  session: FocusSession,
  settings: FocusSettings,
  now: number = Date.now(),
): number {
  const target = targetMs(session.phase, settings);
  if (target <= 0) return 0;
  return Math.min(100, Math.round((elapsedMs(session, now) / target) * 100));
}

/** `mm:ss`, counting down. Padded so the digits never shift width. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

export function phaseLabel(phase: FocusPhase): string {
  if (phase === "focus") return "Focus";
  return phase === "short_break" ? "Short break" : "Long break";
}

/** Begin a focus phase for a task. */
export function startSession(
  taskId: string,
  now: number = Date.now(),
  id: string,
): FocusSession {
  return {
    id,
    taskId,
    phase: "focus",
    date: dateKey(new Date(now)),
    status: "running",
    runStartedAt: now,
    bankedMs: 0,
    focusDoneToday: 0,
    updatedAt: now,
  };
}

/** Hold the clock. The elapsed run is banked so resume picks up exactly. */
export function pauseSession(session: FocusSession, now: number = Date.now()): FocusSession {
  if (session.status === "paused") return session;
  return {
    ...session,
    status: "paused",
    bankedMs: elapsedMs(session, now),
    updatedAt: now,
  };
}

export function resumeSession(session: FocusSession, now: number = Date.now()): FocusSession {
  if (session.status === "running") return session;
  return { ...session, status: "running", runStartedAt: now, updatedAt: now };
}

/**
 * Minutes of real work to credit to the task.
 *
 * Focus phases only — a break is not progress. Rounds to the nearest minute,
 * keeps a partial effort (anything past 30 seconds is at least a minute, so
 * stopping at 12:00 does not record 0), and never credits more than the phase
 * was set to run for.
 */
export function focusMinutesWorked(
  session: FocusSession,
  settings: FocusSettings,
  now: number = Date.now(),
): number {
  if (session.phase !== "focus") return 0;
  const spent = elapsedMs(session, now);
  if (spent < 30_000) return 0;
  const target = Math.round(targetMs("focus", settings) / MIN);
  return Math.max(1, Math.min(Math.round(spent / MIN), target));
}

/**
 * Move to the next phase.
 *
 * A finished focus phase bumps the day's count; the break that follows is long
 * once the cadence is met. `focusDoneToday` carries across the transition so
 * the cycle stays on track without any extra state.
 */
export function advancePhase(
  session: FocusSession,
  settings: FocusSettings,
  now: number = Date.now(),
): FocusSession {
  const finishedFocus = session.phase === "focus";
  const focusDoneToday = finishedFocus
    ? session.focusDoneToday + 1
    : session.focusDoneToday;

  let phase: FocusPhase;
  if (finishedFocus) {
    const dueLong =
      focusDoneToday > 0 && focusDoneToday % settings.sessionsBeforeLongBreak === 0;
    phase = dueLong ? "long_break" : "short_break";
  } else {
    phase = "focus";
  }

  return {
    ...session,
    phase,
    status: "running",
    runStartedAt: now,
    bankedMs: 0,
    focusDoneToday,
    updatedAt: now,
  };
}

/**
 * Repair a session loaded from storage.
 *
 * The app can be closed mid-phase, so a stored record may be stale in two
 * harmless ways: its run started in the future (a clock change), or some of
 * its numbers are missing. Neither should throw — they should just be resolved.
 *
 * The stored `date` is deliberately **preserved**. Re-dating it to today would
 * hide the fact that the session began on an earlier day, and yesterday's
 * focus time would then be banked against today. Keeping the original date lets
 * `syncFocus` settle it honestly instead.
 */
export function normalizeSession(
  session: FocusSession | null | undefined,
  now: number = Date.now(),
): FocusSession | null {
  if (!session || !session.taskId || !session.id) return null;
  const phases: FocusPhase[] = ["focus", "short_break", "long_break"];
  if (!phases.includes(session.phase)) return null;
  const status: FocusStatus = session.status === "paused" ? "paused" : "running";
  const runStartedAt = Number.isFinite(session.runStartedAt)
    ? Math.min(session.runStartedAt, now)
    : now;
  return {
    ...session,
    status,
    date:
      typeof session.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(session.date)
        ? session.date
        : dateKey(new Date(runStartedAt)),
    runStartedAt,
    bankedMs: Math.max(0, session.bankedMs || 0),
    focusDoneToday: Math.max(0, Math.floor(session.focusDoneToday || 0)),
    updatedAt: session.updatedAt || now,
  };
}
