import { NOTIFICATION_DEFAULTS } from "../config";
import { addDaysKey, dateKey } from "../date";
import { scheduleForTask, taskOccursOn } from "../schedule";
import { isTaskDone } from "../task-state";
import type { CustomSection, Task, TimeLog } from "../types";
import { notifKey, type NotificationSettings, type TaskNotification } from "./types";

export interface NotifContext {
  now: Date;
  tasks: Task[];
  logs: TimeLog[];
  sections?: CustomSection[];
  existing: TaskNotification[];
  settings: NotificationSettings;
}

export type DraftNotification = Omit<
  TaskNotification,
  "id" | "createdAt" | "status"
>;

export interface EngineResult {
  /** New records to insert (ids/createdAt assigned by the caller). */
  creates: DraftNotification[];
  /** Existing records whose status/timing changed. */
  updates: TaskNotification[];
}

const MIN = 60_000;

function atLocal(now: Date, hour: number, minute: number): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute);
}

function parseHHMM(t: string): { h: number; m: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (!m) return null;
  return { h: Number(m[1]), m: Number(m[2]) };
}

/**
 * Deterministic next-task selection for a "what's next" nudge.
 * Among incomplete tasks present today, prefers the earliest scheduled start
 * (stable tie-break by title). Only recurring daily/custom work and tasks
 * due today qualify — one-offs without a due date are invisible to the nudge.
 */
export function pickNextTask(today: string, tasks: Task[], sections: CustomSection[] = []): Task | null {
  const candidates = tasks.filter(
    (t) =>
      !isTaskDone(t) &&
      taskOccursOn(t, today, sections) &&
      (t.section === "daily" || t.section === "custom" || t.dueDate === today),
  );
  if (candidates.length === 0) return null;
  return [...candidates].sort((a, b) => {
    const ta = scheduleForTask(a, sections)?.startTime ?? "99";
    const tb = scheduleForTask(b, sections)?.startTime ?? "99";
    if (ta !== tb) return ta < tb ? -1 : 1;
    return a.title.localeCompare(b.title);
  })[0];
}

/**
 * Reconcile the notification queue against current reality.
 *
 * Philosophy: nudge enough to stay on track, never twice the same thing,
 * never while the user is in a cooldown, and never about a task that is
 * already done. Delivered rows are kept as a dismissible record.
 */
export function planNotifications(ctx: NotifContext): EngineResult {
  const { now, tasks, logs, existing, settings, sections = [] } = ctx;
  const today = dateKey(now);
  const nowMs = now.getTime();

  const s = { ...NOTIFICATION_DEFAULTS, ...settings };
  const enabled = s.enabled;

  // Cancelled rows are dead — they must not block a future creation.
  const existingKeys = new Set(
    existing.filter((n) => n.status !== "cancelled").map(notifKey),
  );
  const creates: DraftNotification[] = [];
  const updates: TaskNotification[] = [];
  const updatesByKey = new Map<string, TaskNotification>();

  const pushUpdate = (n: TaskNotification) => {
    updatesByKey.set(notifKey(n), n);
  };

  /* ------------------------------------------------------------------ */
  /* 1. Clean up stale rows from previous days.                          */
  /* ------------------------------------------------------------------ */
  for (const n of existing) {
    if (n.date !== today && n.status === "scheduled") {
      pushUpdate({ ...n, status: "cancelled" });
    }
  }

  /* ------------------------------------------------------------------ */
  /* 2. Delivery + cancellation of today's pending rows.                 */
  /* ------------------------------------------------------------------ */
  const lastCompletedMs = tasks.reduce((max, t) => {
    if (!t.completedAt) return max;
    try {
      if (dateKey(new Date(t.completedAt)) !== today) return max;
      const ms = new Date(t.completedAt).getTime();
      return ms > max ? ms : max;
    } catch {
      return max;
    }
  }, 0);

  for (const n of existing) {
    if (n.date !== today || n.status === "cancelled") continue;

    const task = tasks.find((t) => t.id === n.taskId);

    // Snooze expired → back to scheduled so the next tick delivers it.
    if (n.status === "snoozed") {
      if (n.snoozedUntil && new Date(n.snoozedUntil).getTime() <= nowMs) {
        pushUpdate({
          ...n,
          status: "scheduled",
          scheduledAt: n.snoozedUntil,
          snoozedUntil: undefined,
        });
      }
      continue;
    }
    if (n.status === "scheduled") {
      const done = !task || isTaskDone(task);
      const stillValid =
        !done &&
        (n.type === "special_task"
          ? task!.dueDate === today
          : n.type === "overdue"
            ? Boolean(task!.dueDate && task!.dueDate < today)
            : taskOccursOn(task!, today, sections));

      if (!stillValid || !enabled) {
        // Task is moot, or reminders are switched off — cancel what is
        // still pending so a disabled queue never keeps delivering.
        pushUpdate({ ...n, status: "cancelled" });
        continue;
      }

      const fireMs = new Date(n.scheduledAt).getTime();
      if (fireMs > nowMs) continue; // not yet

      // Cooldown: if the user just completed something, defer rather than nag.
      const cooldownEnd = lastCompletedMs + (n.cooldownMinutes ?? s.cooldownMinutes) * MIN;
      const recentlyCompleted = lastCompletedMs > 0 && nowMs < cooldownEnd;
      if (recentlyCompleted && fireMs < cooldownEnd) {
        const deferred = new Date(Math.max(cooldownEnd, fireMs + MIN));
        if (new Date(n.scheduledAt).getTime() !== deferred.getTime()) {
          pushUpdate({ ...n, scheduledAt: deferred.toISOString() });
        }
        continue;
      }

      pushUpdate({
        ...n,
        status: "delivered",
        deliveredAt: now.toISOString(),
      });
    }
  }

  /* ------------------------------------------------------------------ */
  /* 3. Morning check: due-today specials + overdue tasks.               */
  /* ------------------------------------------------------------------ */
  const morning = atLocal(now, s.morningHour, 0).getTime();
  if (enabled) {
    if (s.specialTaskReminders) {
      for (const t of tasks) {
        if (isTaskDone(t) || t.dueDate !== today) continue;
        const key = notifKey({ taskId: t.id, type: "special_task", date: today });
        if (existingKeys.has(key)) continue;
        creates.push({
          taskId: t.id,
          type: "special_task",
          date: today,
          scheduledAt: new Date(morning).toISOString(),
          cooldownMinutes: s.cooldownMinutes,
        });
        existingKeys.add(key);
      }
    }
    if (s.overdueReminders) {
      for (const t of tasks) {
        if (isTaskDone(t) || !t.dueDate || t.dueDate >= today) continue;
        if (t.section === "occasional") continue;
        const key = notifKey({ taskId: t.id, type: "overdue", date: today });
        if (existingKeys.has(key)) continue;
        creates.push({
          taskId: t.id,
          type: "overdue",
          date: today,
          scheduledAt: new Date(morning).toISOString(),
          cooldownMinutes: s.cooldownMinutes,
        });
        existingKeys.add(key);
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* 4. Scheduled daily-task cues (start / time's-up).                   */
  /* ------------------------------------------------------------------ */
  if (enabled && s.taskReminders) {
    const loggedToday = new Set(logs.filter((l) => l.date === today).map((l) => l.taskId));
    for (const t of tasks) {
      const schedule = scheduleForTask(t, sections);
      if (isTaskDone(t) || !schedule || !taskOccursOn(t, today, sections)) continue;
      if (loggedToday.has(t.id)) continue; // already engaged — no nagging
      const start = schedule.startTime ? parseHHMM(schedule.startTime) : null;
      if (start) {
        const fire = atLocal(now, start.h, start.m).getTime();
        if (fire >= nowMs) {
          const key = notifKey({ taskId: t.id, type: "task_start", date: today });
          if (!existingKeys.has(key)) {
            creates.push({
              taskId: t.id,
              type: "task_start",
              date: today,
              scheduledAt: new Date(fire).toISOString(),
              cooldownMinutes: s.cooldownMinutes,
            });
            existingKeys.add(key);
          }
        }
      }
      const end = schedule.endTime ? parseHHMM(schedule.endTime) : null;
      if (end) {
        const fire = atLocal(now, end.h, end.m).getTime();
        if (fire >= nowMs) {
          const key = notifKey({ taskId: t.id, type: "task_reminder", date: today });
          if (!existingKeys.has(key)) {
            creates.push({
              taskId: t.id,
              type: "task_reminder",
              date: today,
              scheduledAt: new Date(fire).toISOString(),
              cooldownMinutes: s.cooldownMinutes,
            });
            existingKeys.add(key);
          }
        }
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* 5. Next-task nudge after a completion + cooldown.                   */
  /* ------------------------------------------------------------------ */
  if (enabled && s.taskReminders && lastCompletedMs > 0) {
    const cooldownEnd = lastCompletedMs + s.cooldownMinutes * MIN;
    if (nowMs >= cooldownEnd) {
      const target = pickNextTask(today, tasks, sections);
      if (target) {
        const key = notifKey({ taskId: target.id, type: "next_task", date: today });
        const already = existing.find((n) => notifKey(n) === key && n.status !== "cancelled");
        if (!already) {
          creates.push({
            taskId: target.id,
            type: "next_task",
            date: today,
            scheduledAt: new Date(cooldownEnd).toISOString(),
            cooldownMinutes: s.cooldownMinutes,
          });
        }
      }
    }
  }

  for (const n of updatesByKey.values()) updates.push(n);
  return { creates, updates };
}

/** Human message for a notification, based on the current task state. */
export function notificationMessage(n: Pick<TaskNotification, "type">, taskTitle: string): string {
  switch (n.type) {
    case "special_task":
      return `Due today — ${taskTitle}`;
    case "overdue":
      return `Still open — ${taskTitle} is overdue`;
    case "task_start":
      return `Time for ${taskTitle}`;
    case "task_reminder":
      return `Time's up for ${taskTitle} — wrap up or log what you did`;
    case "next_task":
      return `When you're ready: ${taskTitle}`;
  }
}

/** Suppressed/stale keys used when a task disappears. */
export function tomorrowKey(today: string): string {
  return addDaysKey(today, 1);
}
