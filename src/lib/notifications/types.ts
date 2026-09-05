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
}

export interface NotificationSettings {
  enabled: boolean;
  /** Global quiet period (minutes) between ordinary notifications. */
  cooldownMinutes: number;
  /** Breathing room (minutes) after meaningful activity before nudging. */
  completionCooldownMinutes: number;
  taskReminders: boolean;
  specialTaskReminders: boolean;
  overdueReminders: boolean;
  /** Quiet hours — ordinary reminders suppressed inside this window. */
  quietHoursEnabled: boolean;
  /** Local "HH:MM" (24h) start of quiet hours. */
  quietStart: string;
  /** Local "HH:MM" (24h) end of quiet hours. */
  quietEnd: string;
  morningHour: number;
  snoozeMinutes: number;
}

/** The stable identity of a reminder: one per task/type/day. */
export type NotificationKey = `${string}:${NotificationType}:${string}`;

export function notifKey(n: Pick<TaskNotification, "taskId" | "type" | "date">): NotificationKey {
  return `${n.taskId}:${n.type}:${n.date}`;
}
