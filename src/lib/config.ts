import { PROFILE } from "./types";

/**
 * Recovery-day rules. Centralized so behavior can be tuned without touching
 * the streak/analytics logic.
 *
 * A day with planned work that fell below the performance threshold can be
 * marked as a recovery day — keeping the streak intact — when the user earned
 * it through recent consistency. Recovery days are neutral in analytics:
 * they neither extend the streak nor count as productive time.
 */
export const RECOVERY_RULES = {
  /** How many qualifying days must precede a missed day to earn a recovery. */
  minimumConsistencyDays: 5,
  /** Qualifying day = planned work at/above this threshold. */
  minimumPerformanceThreshold: PROFILE.streakThreshold,
  /** Cap on recovery days per calendar month. */
  maximumRecoveryDaysPerMonth: 2,
  /** Look back this many calendar days when counting the qualifying run. */
  lookbackWindowDays: 7,
} as const;

/**
 * Notification defaults. Values here back the settings UI; the scheduler
 * reads the persisted settings and falls back to these.
 */
export const NOTIFICATION_DEFAULTS = {
  /** Master switch for all in-app task reminders. */
  enabled: true,
  /** Minutes of quiet time after completing work before another nudge. */
  cooldownMinutes: 30,
  /** Reminders for scheduled daily/custom tasks. */
  taskReminders: true,
  /** Reminders for due-today special tasks. */
  specialTaskReminders: true,
  /** Daily nudge for overdue remainder tasks. */
  overdueReminders: true,
  /** Hour of day (0–23) when morning checks fire. */
  morningHour: 9,
  /** Minutes a snooze pushes a notification back by. */
  snoozeMinutes: 30,
  /** How long a task is considered "just completed" (cooldown horizon). */
  completionCooldownMinutes: 20,
} as const;

export const COOLDOWN_OPTIONS = [
  { value: 15, label: "15 min" },
  { value: 30, label: "30 min" },
  { value: 60, label: "1 hour" },
] as const;

export const NOTIFICATION_TYPES = [
  "task_start",
  "task_reminder",
  "overdue",
  "special_task",
  "next_task",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATION_STATUSES = [
  "scheduled",
  "delivered",
  "dismissed",
  "snoozed",
  "cancelled",
] as const;

export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];
