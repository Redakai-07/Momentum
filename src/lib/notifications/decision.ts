import { dateKey, parseKey } from "../date";
import type { CustomSection, Task, TimeLog } from "../types";
import { taskOccursOn } from "../schedule";
import { isTaskDoneOn, remainingOn } from "../task-state";
import { isTimedTask, plannedMinutesOf } from "../duration";
import type { NotificationSettings } from "./types";

/**
 * Deterministic notification decision engine.
 *
 * This module answers ONE question: "should a notification happen right now
 * (or for this task)?" It is pure and testable — no Capacitor, no timers, no
 * storage. Actual delivery is handled by ./service.ts (Capacitor Local
 * Notifications); the in-app queue is handled by ./engine.ts.
 */

export type ReminderPriority = "high" | "normal" | "low";

export type DecisionReason =
  | "notifications_disabled"
  | "no_tasks"
  | "nothing_planned"
  | "all_done"
  | "quiet_hours"
  | "recent_activity"
  | "global_cooldown"
  | "already_notified"
  | "no_gap_yet"
  | "no_next_step"
  | "overdue_task"
  | "special_task"
  | "next_action"
  | "high_duration"
  | "normal_remaining";

export interface DecisionContext {
  now: Date;
  tasks: Task[];
  logs: TimeLog[];
  sections?: CustomSection[];
  settings: NotificationSettings;
  /** ISO timestamps of last events, or null when never happened. */
  lastNotificationAt?: string | null;
  lastMeaningfulActivityAt?: string | null;
  lastTaskCompletionAt?: string | null;
  lastInteractionAt?: string | null;
  /** taskId → ISO of last reminder sent about that task (dedupe). */
  lastReminderByTask?: Record<string, string> | null;
}

export interface Decision {
  shouldNotify: boolean;
  reason: DecisionReason;
  priority: ReminderPriority;
  /** The task a reminder would point at, when one applies. */
  task?: Task;
  /** Human notification copy (short, supportive, never guilt-tripping). */
  message?: string;
}

const MIN = 60_000;

/** Local "HH:MM" → minutes since midnight. Null when malformed. */
export function parseHM(value: string | undefined): number | null {
  if (!value) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h > 23 || mm > 59) return null;
  return h * 60 + mm;
}

/**
 * True when `now` falls inside the quiet-hours window. The window may wrap
 * across midnight (e.g. 22:30 → 07:00). A disabled window never suppresses.
 */
export function isQuietHours(now: Date, settings: NotificationSettings): boolean {
  if (!settings.quietHoursEnabled) return false;
  const start = parseHM(settings.quietStart);
  const end = parseHM(settings.quietEnd);
  if (start === null || end === null) return false;
  const mins = now.getHours() * 60 + now.getMinutes();
  if (start === end) return false; // zero-length window suppresses nothing
  if (start < end) return mins >= start && mins < end;
  return mins >= start || mins < end; // wraps past midnight
}

/** Minutes elapsed since an ISO timestamp (0 when null/future). */
export function minutesSince(iso: string | null | undefined, now: Date): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  const ms = new Date(iso).getTime();
  if (!Number.isFinite(ms)) return Number.POSITIVE_INFINITY;
  return Math.max(0, Math.floor((now.getTime() - ms) / MIN));
}

export function taskOccursToday(task: Task, key: string, sections: CustomSection[] = []): boolean {
  // Date-aware: recurring work completed on an earlier day is pending again
  // today, so a stale completion must never suppress today's reminder.
  if (isTaskDoneOn(task, key)) return false;
  if (taskOccursOn(task, key, sections)) return true;
  // Due today OR overdue — overdue work stays relevant until done.
  return Boolean(task.dueDate && task.dueDate <= key);
}

const isOverdue = (t: Task, key: string): boolean =>
  Boolean(t.dueDate && t.dueDate < key);

const isDueToday = (t: Task, key: string): boolean => t.dueDate === key;

/** Approaching due date: 1–3 days out, or not-quite-yet today's evening. */
function isDueSoon(t: Task, key: string): boolean {
  if (!t.dueDate || t.dueDate <= key) return false;
  const today = parseKey(key);
  const due = parseKey(t.dueDate);
  const days = Math.round((due.getTime() - today.getTime()) / 86_400_000);
  return days >= 1 && days <= 3;
}

/**
 * Pick the single most relevant task for a reminder, in priority order:
 * overdue → due today → due soon → explicit next action → longest remaining
 * time. Ties break deterministically by title.
 */
export function pickReminderTask(
  tasks: Task[],
  key: string,
  lastReminderByTask?: Record<string, string> | null,
  sections: CustomSection[] = [],
): Task | null {
  const today = dateKey(new Date(key + "T12:00:00"));
  const active = tasks
    .filter((t) => taskOccursToday(t, key, sections))
    .map((t) => ({ t, rank: rankTask(t, today) }))
    .sort((a, b) => a.rank - b.rank || a.t.title.localeCompare(b.t.title));

  // Avoid re-notifying the same task repeatedly within the same day.
  const notAgain = lastReminderByTask
    ? active.filter(
        ({ t }) => !lastReminderByTask[t.id] || lastReminderByTask[t.id].slice(0, 10) !== today,
      )
    : active;
  const pool = notAgain.length > 0 ? notAgain : active;
  return pool[0]?.t ?? null;
}

const ACTIVITY_BREATH_MINUTES = 30;

/** Minimum lead time before an ordinary reminder may fire. */
export const REMINDER_LEAD_MINUTES = 30;

/**
 * How today's work stands, independent of the clock.
 *
 * Shared by the point-in-time decision (`shouldNotify`) and the
 * future-oriented planner (`planDayReminder`) so the two can never drift
 * apart on what "there is still work to do" means.
 */
export interface DayWorkState {
  key: string;
  /** Tasks present today with effort still outstanding. */
  open: Task[];
  /** Overdue or due-today task — the day's most urgent item. */
  critical: Task | null;
  /** Whether anything at all is present today. */
  hasTasks: boolean;
  /** Whether the user has already logged minutes today. */
  hasProgress: boolean;
  /** Total outstanding minutes across today's timed work. */
  remainingMinutes: number;
}

export function dayWorkState(ctx: DecisionContext): DayWorkState {
  const key = dateKey(ctx.now);
  // "Present" is deliberately completion-agnostic: a day whose work is all
  // finished must report `hasTasks` + no open work, so the plan can honestly
  // say "all done" instead of pretending nothing was ever scheduled.
  const present = ctx.tasks.filter(
    (t) =>
      taskOccursOn(t, key, ctx.sections) ||
      // Overdue one-offs stay relevant until they are dealt with.
      Boolean(t.dueDate && t.dueDate <= key),
  );
  const loggedIds = new Set(
    ctx.logs.filter((l) => l.date === key).map((l) => l.taskId),
  );
  const open = present.filter((t) => isOutstanding(t, key, loggedIds.has(t.id)));
  return {
    key,
    open,
    critical: open.find((t) => isOverdue(t, key) || isDueToday(t, key)) ?? null,
    hasTasks: present.length > 0,
    hasProgress: ctx.logs.some((l) => l.date === key && l.minutes > 0),
    remainingMinutes: open.reduce(
      (sum, t) =>
        sum + (isTimedTask(t) ? remainingOn(t, key, loggedIds.has(t.id)) : 0),
      0,
    ),
  };
}

/**
 * Whether a task still has work left today.
 *
 * Timed work is measured in minutes; completion-based work (no duration) has
 * no minutes to measure, so it is outstanding while it is simply not done.
 * Treating it as "0 minutes remaining" used to make a day of reminders look
 * finished before it had started.
 */
export function isOutstanding(
  task: Task,
  key: string,
  loggedToday: boolean,
): boolean {
  if (isTimedTask(task)) return remainingOn(task, key, loggedToday) > 0;
  return !isTaskDoneOn(task, key);
}

/** First moment at or after `from` that sits outside quiet hours. */
export function nextOutsideQuiet(settings: NotificationSettings, from: Date): Date {
  let t = new Date(from);
  for (let i = 0; i < 24 * 4; i++) {
    if (!isQuietHours(t, settings)) return t;
    t = new Date(t.getTime() + 15 * MIN);
  }
  return t;
}

/** ISO → epoch ms, or `null` when missing/unparseable. */
function ms(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : null;
}

/**
 * The result of planning a *whole day*, not a single moment.
 *
 * This is what the native scheduler consumes. `shouldNotify` answers "is a
 * reminder appropriate right now?", which is the wrong question for an alarm
 * that has to fire later, while the app is closed — see `planDayReminder`.
 */
export interface DayPlan {
  eligible: boolean;
  reason: DecisionReason;
  priority: ReminderPriority;
  /** The task the day's nudge should point at. */
  task: Task | null;
  message: string | null;
  /**
   * Earliest stable moment an ordinary reminder may fire today, or null when
   * the day has run out of non-quiet time.
   */
  earliest: Date | null;
}

/**
 * Decide whether TODAY deserves a reminder, and from when it may fire.
 *
 * The crucial difference from `shouldNotify`: this deliberately does **not**
 * test the "idle gap" against the current instant.
 *
 * That gap is measured from `lastInteractionAt`, which is refreshed every time
 * the app opens, resumes, or a task changes — i.e. at exactly the moments the
 * scheduler runs. Gating a *future* alarm on a *present* gap means the alarm
 * was suppressed every time it could have been created, and nothing was left
 * pending once the user closed the app. Notifications therefore never fired.
 *
 * Instead the gap shapes `earliest` — when the alarm may fire — so the
 * anti-spam intent is preserved without making delivery depend on the app
 * being open.
 */
export function planDayReminder(ctx: DecisionContext): DayPlan {
  const { now, settings } = ctx;
  const none = (
    reason: DecisionReason,
    priority: ReminderPriority = "low",
    task: Task | null = null,
  ): DayPlan => ({ eligible: false, reason, priority, task, message: null, earliest: null });

  if (!settings.enabled) return none("notifications_disabled");

  const state = dayWorkState(ctx);
  if (!state.hasTasks) return none("no_tasks");
  if (state.open.length === 0) return none("all_done");

  const target = state.critical ?? pickReminderTask(
    ctx.tasks,
    state.key,
    ctx.lastReminderByTask,
    ctx.sections,
  );
  if (!target) return none("no_next_step");

  // Already reminded about this task today? Then the day is done covering it.
  const last = ctx.lastReminderByTask?.[target.id];
  if (last && last.slice(0, 10) === state.key) {
    return none("already_notified", "normal", target);
  }

  const highPriority = state.critical !== null;
  const priority: ReminderPriority = highPriority
    ? "high"
    : state.remainingMinutes >= 90 || target.nextAction
      ? "normal"
      : "low";

  // Earliest stable firing moment: a small lead from now, breathing room after
  // real work, and never before an ordinary cooldown has elapsed. High-priority
  // work may pierce the ordinary cooldown, exactly as `shouldNotify` allows.
  let at = now.getTime() + REMINDER_LEAD_MINUTES * MIN;
  const activity = Math.max(
    ms(ctx.lastMeaningfulActivityAt) ?? 0,
    ms(ctx.lastTaskCompletionAt) ?? 0,
  );
  if (activity > 0) {
    at = Math.max(at, activity + ACTIVITY_BREATH_MINUTES * MIN);
  }
  const lastNotified = ms(ctx.lastNotificationAt);
  if (!highPriority && lastNotified !== null) {
    at = Math.max(at, lastNotified + settings.cooldownMinutes * MIN);
  }

  const slot = nextOutsideQuiet(settings, new Date(at));
  const message = target.nextAction
    ? `Next: ${target.nextAction}`
    : state.critical
      ? `${target.title} is still waiting.`
      : target.title;

  return {
    eligible: true,
    reason: highPriority
      ? isOverdue(target, state.key)
        ? "overdue_task"
        : "special_task"
      : target.nextAction
        ? "next_action"
        : "normal_remaining",
    priority,
    task: target,
    message,
    // A slot that spills into tomorrow belongs to tomorrow's plan, not today's.
    earliest: dateKey(slot) === state.key ? slot : null,
  };
}

function rankTask(t: Task, today: string): number {
  if (isOverdue(t, today)) return 0;
  if (isDueToday(t, today)) return 1;
  if (isDueSoon(t, today)) return 2;
  if (t.nextAction) return 3;
  // Bigger time-based tasks come first; completion-based work has no size to
  // rank on, so it settles at the end without ever being treated as 0 minutes.
  const planned = plannedMinutesOf(t);
  if (planned > 0) return 4 - Math.min(1, planned / 180) * 0.9;
  return 5;
}

/** Short, natural, non-repetitive copy pool for ordinary reminders. */
const ORDINARY_COPY = [
  "Still have some momentum left today.",
  "You still have planned work waiting.",
  "There's still time to make progress today.",
] as const;

/**
 * The core decision. Given full context, decides whether an ordinary
 * reminder is warranted RIGHT NOW, at what priority, and with what copy.
 *
 * Special/overdue tasks are high-priority: they can pierce the ordinary
 * cooldown and the completion cooldown, but never duplicates.
 */
export function shouldNotify(ctx: DecisionContext): Decision {
  const { now, tasks, logs, settings } = ctx;
  const key = dateKey(now);

  if (!settings.enabled) {
    return { shouldNotify: false, reason: "notifications_disabled", priority: "low" };
  }

  const activeToday = tasks.filter((t) => taskOccursToday(t, key, ctx.sections));
  if (activeToday.length === 0) {
    return { shouldNotify: false, reason: "no_tasks", priority: "low" };
  }

  const loggedToday = logs
    .filter((l) => l.date === key)
    .reduce((s, l) => s + l.minutes, 0);
  const loggedTodayIds = new Set(
    logs.filter((l) => l.date === key).map((l) => l.taskId),
  );
  // Date-scoped: yesterday's completion does not make today's recurring work
  // "done", so the engine always reasons about today's remaining effort.
  const remainingToday = (t: Task) => remainingOn(t, key, loggedTodayIds.has(t.id));

  // Everything already done → nothing to remind about. Completion-based work
  // counts as outstanding on its own terms (see `isOutstanding`).
  if (activeToday.every((t) => !isOutstanding(t, key, loggedTodayIds.has(t.id)))) {
    return { shouldNotify: false, reason: "all_done", priority: "low" };
  }

  // High-priority candidate first: overdue or due-today special.
  const critical = activeToday.find(
    (t) => isOverdue(t, key) || isDueToday(t, key),
  );
  if (critical) {
    // Duplicate guard: never nag about the same task twice in one day.
    const last = ctx.lastReminderByTask?.[critical.id];
    if (last && last.slice(0, 10) === key) {
      return {
        shouldNotify: false,
        reason: "already_notified",
        priority: "normal",
        task: critical,
      };
    }
    const message = critical.nextAction
      ? `Next: ${critical.nextAction}`
      : `${critical.title} is still waiting.`;
    return {
      shouldNotify: true,
      reason: isOverdue(critical, key) ? "overdue_task" : "special_task",
      priority: "high",
      task: critical,
      message,
    };
  }

  // ---------------------------------------------------------------------
  // Ordinary reminders — every rule below must pass.
  // ---------------------------------------------------------------------

  if (isQuietHours(now, settings)) {
    return { shouldNotify: false, reason: "quiet_hours", priority: "low" };
  }

  // Breathing room after meaningful activity (completion / time logged).
  const recentActivity = Math.min(
    minutesSince(ctx.lastMeaningfulActivityAt, now),
    minutesSince(ctx.lastTaskCompletionAt, now),
  );
  if (recentActivity < ACTIVITY_BREATH_MINUTES) {
    return {
      shouldNotify: false,
      reason: "recent_activity",
      priority: "low",
      task: undefined,
    };
  }

  // Global per-momentum cooldown after the last delivered notification.
  if (minutesSince(ctx.lastNotificationAt, now) < settings.cooldownMinutes) {
    return { shouldNotify: false, reason: "global_cooldown", priority: "low" };
  }

  // The "drift" signal: meaningful activity stopped, but the plan remains.
  const sinceActivity = minutesSince(ctx.lastMeaningfulActivityAt, now);
  const sinceInteraction = minutesSince(ctx.lastInteractionAt, now);
  const gap = Math.min(sinceActivity, sinceInteraction);
  if (gap < 30) {
    return { shouldNotify: false, reason: "no_gap_yet", priority: "low" };
  }

  const hasProgress = loggedToday > 0;
  const remaining = activeToday.reduce((s, t) => s + remainingToday(t), 0);

  // If the user already made progress, require a real gap before nudging;
  // if nothing was logged at all, a quieter first nudge is fine after a gap.
  if (hasProgress && gap < 60) {
    return { shouldNotify: false, reason: "no_gap_yet", priority: "low" };
  }

  const task = pickReminderTask(tasks, key, ctx.lastReminderByTask, ctx.sections);
  if (!task) return { shouldNotify: false, reason: "no_next_step", priority: "low" };

  const priority: ReminderPriority =
    remaining >= 90 ? "normal" : task.nextAction ? "normal" : "low";

  if (task.nextAction) {
    return {
      shouldNotify: true,
      reason: "next_action",
      priority,
      task,
      message: `Next: ${task.nextAction}`,
    };
  }

  if (plannedMinutesOf(task) >= 90) {
    return {
      shouldNotify: true,
      reason: "high_duration",
      priority: "normal",
      task,
      message: ORDINARY_COPY[0],
    };
  }

  return {
    shouldNotify: true,
    reason: "normal_remaining",
    priority,
    task,
    message: ORDINARY_COPY[key.length % ORDINARY_COPY.length],
  };
}

/** Convenience for tests + dev logging: plain English reason. */
export function decisionLabel(d: Decision): string {
  return d.shouldNotify
    ? `allowed (${d.reason})`
    : `suppressed (${d.reason})`;
}