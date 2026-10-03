import type {
  NotificationStatus,
  NotificationType,
} from "../config";

export interface TaskNotification {
  id: string;
  taskId: string;
  type: NotificationType;
  /** Target day the notification belongs to (YYYY-MM-DD). */
  date: string;
  /** ISO timestamp when the notification should fire. */
  scheduledAt: string;
  status: NotificationStatus;
  /** Cooldown that was in effect when this was scheduled (minutes). */
  cooldownMinutes?: number;
  createdAt: string;
  deliveredAt?: string;
  snoozedUntil?: string;
  dismissedAt?: string;
  /**
   * After this moment the reminder's underlying reason is no longer valid —
   * scheduled-but-unexpired rows past this point are cancelled, never fired.
   * Defaults to the end of the reminder's local day.
   */
  expiresAt?: string;
  /** Why this reminder exists (the decision reason at scheduling time). */
  reason?: string;
}

export interface NotificationSettings {
  enabled: boolean;

  /* ---- Explicit reminder times (the only thing the planner uses) ---- */

  /** Default time for daily/custom tasks without a time of their own. */
  dailyReminderTime: string;
  /** One calm later check-in time for a day whose plan is still open. */
  followUpTime: string;
  /** Weekend day (Date#getDay()) for Reminder-section work without a due date. */
  remainderWeekday: number;
  /** Local "HH:MM" for that weekly reminder. */
  remainderTime: string;
  /** Days of the month for Occasional work without a due date. */
  occasionalDays: number[];
  /** Local "HH:MM" for that monthly reminder. */
  occasionalTime: string;

  /** Per-section switches (daily/custom, due-today, overdue). */
  taskReminders: boolean;
  specialTaskReminders: boolean;
  overdueReminders: boolean;
  snoozeMinutes: number;

  /* ---- Legacy (kept so stored settings and backups stay valid) ---- */

  /** @deprecated unused — reminders now fire at explicit times. */
  cooldownMinutes: number;
  /** @deprecated unused. */
  completionCooldownMinutes: number;
  /** @deprecated unused. */
  quietHoursEnabled: boolean;
  /** @deprecated unused. */
  quietStart: string;
  /** @deprecated unused. */
  quietEnd: string;
  /** @deprecated unused. */
  morningHour: number;
}

/** The stable identity of a reminder: one per task/type/day. */
export type NotificationKey = `${string}:${NotificationType}:${string}`;

export function notifKey(n: Pick<TaskNotification, "taskId" | "type" | "date">): NotificationKey {
  return `${n.taskId}:${n.type}:${n.date}`;
}
