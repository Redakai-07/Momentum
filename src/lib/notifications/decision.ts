import { dateKey, parseKey } from "../date";
import type { Task, TimeLog } from "../types";
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

export function taskOccursToday(task: Task, key: string): boolean {
  if (task.status !== "active") return false;
  if (task.schedule) {
    // Mirror lib/schedule.ts: daily fires every day, weekly/custom on days.
    if (task.schedule.type === "daily") return true;
    const days = task.schedule.days;
    if (!days || days.length === 0) return false;
    const d = parseKey(key);
    return days.includes(d.getDay() as (typeof days)[number]);
  }
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
): Task | null {
  const today = dateKey(new Date(key + "T12:00:00"));
  const active = tasks
    .filter((t) => taskOccursToday(t, key))
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

function rankTask(t: Task, today: string): number {
  if (isOverdue(t, today)) return 0;
  if (isDueToday(t, today)) return 1;
  if (isDueSoon(t, today)) return 2;
  if (t.nextAction) return 3;
  if (t.estimatedMinutes > 0) return 4 - Math.min(1, t.estimatedMinutes / 180) * 0.9; // big tasks first
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

  const activeToday = tasks.filter((t) => taskOccursToday(t, key));
  if (activeToday.length === 0) {
    return { shouldNotify: false, reason: "no_tasks", priority: "low" };
  }

  const loggedToday = logs
    .filter((l) => l.date === key)
    .reduce((s, l) => s + l.minutes, 0);

  // Everything already done → nothing to remind about.
  if (activeToday.every((t) => t.remainingMinutes <= 0)) {
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
  const remaining = activeToday.reduce((s, t) => s + Math.max(0, t.remainingMinutes), 0);

  // If the user already made progress, require a real gap before nudging;
  // if nothing was logged at all, a quieter first nudge is fine after a gap.
  if (hasProgress && gap < 60) {
    return { shouldNotify: false, reason: "no_gap_yet", priority: "low" };
  }

  const task = pickReminderTask(tasks, key, ctx.lastReminderByTask);
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

  if (task.estimatedMinutes >= 90) {
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