/**
 * The ONE reminder planner.
 *
 * Answers exactly one question, deterministically: "which concrete reminders
 * should Android hold, and when do they fire?" Its output is the native alarm
 * queue — nothing else in the app decides delivery.
 *
 * Deliberately boring rules (see docs/notification-audit.md §7):
 *
 *   - daily / custom tasks  → their own time (task.notifyTime → section start
 *     time → global daily time) on every day the task occurs.
 *   - reminder tasks        → due date (and every day overdue), or once a week
 *     on the chosen weekend day when no due date exists.
 *   - occasional tasks      → due date (and every day overdue), or the chosen
 *     days of the month when no due date exists.
 *
 * No scores, no cooldowns, no quiet-hours gating, no "already notified" gates.
 * A reminder that already happened today while the app was closed is armed once
 * at `now + CATCH_UP_LEAD_MINUTES`; a passed moment for another day is skipped.
 *
 * The planner is pure — same input, same output — so every rule above is
 * covered by unit tests (planner.test.ts).
 */

import { NOTIFICATION_DEFAULTS } from "../config";
import { addDays, dateKey } from "../date";
import { scheduleForTask, taskOccursOn } from "../schedule";
import { isTaskDoneOn } from "../task-state";
import type { CustomSection, Task, TimeLog } from "../types";
import type { NotificationSettings } from "./types";

export type ReminderReason =
  | "task_time"
  | "due_today"
  | "overdue"
  | "weekend"
  | "monthly";

export interface ReminderPlanContext {
  now: Date;
  tasks: Task[];
  logs: TimeLog[];
  sections?: CustomSection[];
  settings: NotificationSettings;
}

export interface PlannedReminder {
  /** Stable identity: one reminder per task per day. */
  key: string;
  taskId: string;
  /** Local calendar day the reminder belongs to (YYYY-MM-DD). */
  date: string;
  title: string;
  body: string;
  at: Date;
  reason: ReminderReason;
  /** True when a passed moment was re-armed for later today. */
  catchUp: boolean;
}

export interface SkippedReminder {
  taskId: string;
  date: string;
  reason: string;
}

export interface ReminderPlan {
  records: PlannedReminder[];
  /** Dev diagnostics only — why a task produced nothing on a given day. */
  skipped: SkippedReminder[];
}

/** How many days ahead alarms are armed (today + 6). */
export const REMINDER_HORIZON_DAYS = 6;
/** Upper bound on armed alarms — keeps the queue sane on busy accounts. */
export const MAX_REMINDER_RECORDS = 40;
/** When today's moment has passed, re-arm this far ahead. */
export const CATCH_UP_LEAD_MINUTES = 15;

/** Local "HH:MM" → {h, m}, or null when malformed. */
export function parseHHMM(value: string | undefined): { h: number; m: number } | null {
  if (!value) return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return null;
  return { h, m };
}

function atLocal(day: Date, hhmm: string): Date | null {
  const parsed = parseHHMM(hhmm);
  if (!parsed) return null;
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), parsed.h, parsed.m);
}

/**
 * The time a task's reminder fires at.
 *
 * Order: the task's own explicit time, then its section/schedule start time
 * (the moment the user already told Momentum the work begins), then the
 * global default. Never returns null: an unparseable anything falls back to
 * the global time, which is always validated by `mergeSettings`.
 */
export function reminderTimeFor(
  task: Task,
  settings: NotificationSettings,
  sections: CustomSection[] = [],
): string {
  const explicit = parseHHMM(task.notifyTime) ? task.notifyTime! : null;
  if (explicit) return explicit;
  if (task.section === "daily" || task.section === "custom") {
    const start = scheduleForTask(task, sections)?.startTime;
    if (parseHHMM(start)) return start!;
    return settings.dailyReminderTime;
  }
  if (task.section === "remainder") return settings.remainderTime;
  return settings.occasionalTime;
}

function bodyFor(reason: ReminderReason, title: string): string {
  switch (reason) {
    case "overdue":
      return `Still open — ${title} is overdue`;
    case "due_today":
      return `Due today — ${title}`;
    case "weekend":
      return `Weekend reminder — ${title}`;
    case "monthly":
      return `Monthly reminder — ${title}`;
    case "task_time":
      return `Time for ${title}`;
  }
}

/** The reminder for one task on one day, or null when the task is not due. */
function planDayForTask(
  task: Task,
  day: Date,
  today: string,
  loggedToday: Set<string>,
  settings: NotificationSettings,
  sections: CustomSection[],
): { reason: ReminderReason; at: Date } | { skip: string } {
  const key = dateKey(day);
  // `isTaskDoneOn` is the authority — NOT `status !== "active"`. A recurring
  // task completed yesterday still carries status "completed" until a rollover,
  // and the whole point of planning ahead is the case where the app is never
  // opened to run that rollover.
  if (isTaskDoneOn(task, key)) {
    return { skip: task.status === "accomplished" ? "accomplished" : "done_on_day" };
  }
  if (key === today && loggedToday.has(task.id)) return { skip: "logged_today" };

  const due = task.dueDate;
  const overdue = Boolean(due && due < key);
  const dueToday = due === key;

  let reason: ReminderReason | null = null;
  if (task.section === "daily" || task.section === "custom") {
    if (!taskOccursOn(task, key, sections)) return { skip: "not_scheduled" };
    reason = overdue ? "overdue" : dueToday ? "due_today" : "task_time";
  } else if (overdue || dueToday) {
    reason = overdue ? "overdue" : "due_today";
  } else if (task.section === "remainder") {
    if (due) return { skip: "not_due" }; // dated work is reminded on its date
    if (day.getDay() !== settings.remainderWeekday) return { skip: "not_weekend_day" };
    reason = "weekend";
  } else if (task.section === "occasional") {
    if (due) return { skip: "not_due" };
    if (!settings.occasionalDays.includes(day.getDate())) return { skip: "not_monthly_day" };
    reason = "monthly";
  } else {
    return { skip: "unsupported_section" };
  }

  // Per-section switches stay meaningful: scheduled/check-in reminders,
  // due-today reminders and overdue reminders can be turned off independently.
  const scheduledKind = reason === "task_time" || reason === "weekend" || reason === "monthly";
  if (scheduledKind && !settings.taskReminders) return { skip: "task_reminders_off" };
  if (reason === "due_today" && !settings.specialTaskReminders) return { skip: "due_reminders_off" };
  if (reason === "overdue" && !settings.overdueReminders) return { skip: "overdue_reminders_off" };

  const at = atLocal(day, reminderTimeFor(task, settings, sections));
  if (!at) return { skip: "bad_time" };
  return { reason, at };
}

/**
 * Plan every alarm Android should hold: the next `REMINDER_HORIZON_DAYS + 1`
 * days, one reminder per task per day, earliest first.
 */
export function planUpcomingReminders(ctx: ReminderPlanContext): ReminderPlan {
  const { now, tasks, logs, sections = [] } = ctx;
  const settings: NotificationSettings = { ...NOTIFICATION_DEFAULTS, ...ctx.settings };
  const records: PlannedReminder[] = [];
  const skipped: SkippedReminder[] = [];

  if (!settings.enabled) return { records: [], skipped };

  const today = dateKey(now);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const nowMs = now.getTime();
  const loggedToday = new Set(logs.filter((l) => l.date === today).map((l) => l.taskId));

  for (let offset = 0; offset <= REMINDER_HORIZON_DAYS; offset++) {
    const day = addDays(todayStart, offset);
    const key = dateKey(day);
    for (const task of tasks) {
      const planned = planDayForTask(task, day, today, loggedToday, settings, sections);
      if ("skip" in planned) {
        skipped.push({ taskId: task.id, date: key, reason: planned.skip });
        continue;
      }
      let at = planned.at;
      let catchUp = false;
      if (at.getTime() <= nowMs + 1000) {
        // The moment already passed. Today it can still be delivered once,
        // a little later; any other day has gone.
        if (key !== today) {
          skipped.push({ taskId: task.id, date: key, reason: "moment_passed" });
          continue;
        }
        at = new Date(nowMs + CATCH_UP_LEAD_MINUTES * 60_000);
        catchUp = true;
      }
      records.push({
        key: `${task.id}:${key}`,
        taskId: task.id,
        date: key,
        title: task.title,
        body: bodyFor(planned.reason, task.title),
        at,
        reason: planned.reason,
        catchUp,
      });
      // `skipped` is diagnostics for work that produced nothing; once a record
      // exists for the day, earlier skip notes about it are noise.
      for (let i = skipped.length - 1; i >= 0; i--) {
        if (skipped[i].taskId === task.id && skipped[i].date === key) skipped.splice(i, 1);
      }
    }
  }

  records.sort((a, b) => a.at.getTime() - b.at.getTime());
  return {
    records: records.slice(0, MAX_REMINDER_RECORDS),
    skipped,
  };
}

/** Tasks a plan points at, for diagnostics copy. */
export function plannedTaskIds(plan: ReminderPlan): string[] {
  return [...new Set(plan.records.map((r) => r.taskId))];
}
