import { create } from "zustand";
import { db } from "./db";
import { createSeedState } from "./seed";
import { dateKey, todayKey } from "./date";
import { uid } from "./utils";
import { liveDayRec } from "./performance";
import { applyRecoveryKinds } from "./activity";
import { NOTIFICATION_DEFAULTS } from "./config";
import { planNotifications } from "./notifications/engine";
import type { TaskNotification, NotificationSettings } from "./notifications/types";
import { canAccomplish, isTaskDone, toAccomplished } from "./task-state";
import type {
  CustomSection,
  DailyPerformance,
  Priority,
  Schedule,
  SectionKind,
  Task,
  TimeLog,
} from "./types";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface TaskInput {
  title: string;
  section: SectionKind;
  customSectionId?: string;
  estimatedMinutes: number;
  description?: string;
  nextAction?: string;
  dueDate?: string;
  priority?: Priority;
  schedule?: Schedule;
}

export interface SectionInput {
  name: string;
  icon?: string;
  schedule: Schedule;
}

export type NotificationSettingsPatch = Partial<NotificationSettings>;

type State = {
  ready: boolean;
  tasks: Task[];
  logs: TimeLog[];
  sections: CustomSection[];
  history: DailyPerformance[];
  notifications: TaskNotification[];
  notificationSettings: NotificationSettings;
};

type Actions = {
  boot: () => Promise<void>;
  addTask: (input: TaskInput) => string;
  updateTask: (id: string, patch: Partial<Task>) => void;
  deleteTask: (id: string) => void;
  toggleTask: (id: string, completed?: boolean) => void;
  logTime: (taskId: string, minutes: number, date?: string) => void;
  accomplishTask: (id: string) => void;
  addCustomSection: (input: SectionInput) => void;
  removeCustomSection: (id: string) => void;
  syncNotifications: () => Promise<void>;
  dismissNotification: (id: string) => void;
  snoozeNotification: (id: string, minutes?: number) => void;
  setNotificationSettings: (patch: NotificationSettingsPatch) => void;
};

export interface MomentumState extends State, Actions {}

type SetFn = (partial: MomentumState | Partial<MomentumState> | ((s: MomentumState) => Partial<MomentumState>)) => void;
type GetFn = () => MomentumState;

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const defaultSettings: NotificationSettings = { ...NOTIFICATION_DEFAULTS };

function mergeSettings(raw: unknown): NotificationSettings {
  return {
    ...defaultSettings,
    ...(typeof raw === "object" && raw ? (raw as Partial<NotificationSettings>) : {}),
  };
}

async function readSettings(): Promise<NotificationSettings> {
  const row = await db.meta.get("notificationSettings");
  return mergeSettings(row?.value);
}

const isoDay = (iso?: string): string | null => {
  if (!iso) return null;
  try {
    return dateKey(new Date(iso));
  } catch {
    return null;
  }
};

function replaceToday(history: DailyPerformance[], rec: DailyPerformance): DailyPerformance[] {
  const idx = history.findIndex((h) => h.date === rec.date);
  if (idx === -1) return [...history, rec].sort((a, b) => (a.date < b.date ? -1 : 1));
  const next = [...history];
  next[idx] = rec;
  return next;
}

async function persistDayRec(tasks: Task[], logs: TimeLog[], key: string): Promise<void> {
  const rec = liveDayRec(tasks, logs, key);
  const existing = await db.performance.get(key);
  const writeable = key === todayKey() || !existing;
  if (!writeable) return;
  if (rec.plannedMinutes > 0 || rec.completedMinutes > 0) {
    await db.performance.put(rec);
  } else if (existing) {
    await db.performance.delete(key);
  }
}

const logError = (where: string) => (err: unknown) => {
  console.error(`Momentum: ${where} failed to persist:`, err);
};

/* ------------------------------------------------------------------ */
/* Boot + internal sync (called through the create closure)            */
/* ------------------------------------------------------------------ */

let bootPromise: Promise<void> | null = null;

async function doBoot(set: SetFn): Promise<void> {
  const [taskRows, logRows, sectionRows, perfRows, notifRows] = await Promise.all([
    db.tasks.toArray(),
    db.logs.toArray(),
    db.sections.toArray(),
    db.performance.toArray(),
    db.notifications.toArray(),
  ]);
  const seededFlag = await db.meta.get("seeded");

  let tasks = taskRows;
  let logs = logRows;
  let sections = sectionRows;
  let history = perfRows;

  // First run — install the example workspace exactly once.
  if (tasks.length === 0 && !seededFlag?.value) {
    const seed = createSeedState();
    await db.transaction(
      "rw",
      [db.tasks, db.logs, db.sections, db.performance, db.meta],
      async () => {
        if ((await db.tasks.count()) === 0) {
          if (seed.tasks.length > 0) await db.tasks.bulkAdd(seed.tasks);
          if (seed.logs.length > 0) await db.logs.bulkAdd(seed.logs);
          if (seed.sections.length > 0) await db.sections.bulkAdd(seed.sections);
          if (seed.history.length > 0) await db.performance.bulkAdd(seed.history);
          await db.meta.put({ key: "seeded", value: 1 });
        }
      },
    );
    [tasks, logs, sections, history] = await Promise.all([
      db.tasks.toArray(),
      db.logs.toArray(),
      db.sections.toArray(),
      db.performance.toArray(),
    ]);
  }

  // A new day resets recurring tasks (yesterday's completion/partial is done).
  const today = todayKey();
  const loggedToday = new Set(logs.filter((l) => l.date === today).map((l) => l.taskId));
  const rolloverChanges: Task[] = [];
  const rolledTasks: Task[] = tasks.map((t) => {
    if (!t.schedule) return t;
    const doneDay = isoDay(t.completedAt);
    if (t.status === "completed" && doneDay !== null && doneDay < today) {
      const n: Task = {
        ...t,
        status: "active",
        completedAt: undefined,
        remainingMinutes: t.estimatedMinutes,
      };
      rolloverChanges.push(n);
      return n;
    }
    if (
      t.status === "active" &&
      t.remainingMinutes < t.estimatedMinutes &&
      !loggedToday.has(t.id) &&
      doneDay !== today
    ) {
      const n: Task = { ...t, remainingMinutes: t.estimatedMinutes };
      rolloverChanges.push(n);
      return n;
    }
    return t;
  });
  if (rolloverChanges.length > 0) {
    await db.tasks.bulkPut(rolloverChanges);
    tasks = rolledTasks;
  }

  // Make sure today has a snapshot row.
  if (history.findIndex((h) => h.date === today) === -1) {
    await persistDayRec(tasks, logs, today);
    history = await db.performance.toArray();
  }

  // Classify past days (recovery/inactive) and persist the decisions.
  const classified = applyRecoveryKinds([...history], today);
  const kindChanges = classified.filter((r, i) => {
    const prev = history[i];
    return prev && r.kind !== prev.kind && r.date < today;
  });
  if (kindChanges.length > 0) {
    await db.performance.bulkPut(kindChanges);
  }

  const settings = await readSettings();
  set({
    ready: true,
    tasks,
    logs,
    sections,
    history: classified,
    notifications: notifRows,
    notificationSettings: settings,
  });
}

/** Recompute + persist today's snapshot, classify, refresh state. */
async function syncToday(get: GetFn, set: SetFn): Promise<void> {
  const s = get();
  try {
    const today = todayKey();
    const rec = liveDayRec(s.tasks, s.logs, today);
    await persistDayRec(s.tasks, s.logs, today);
    const merged = replaceToday(s.history, rec);
    set({ history: applyRecoveryKinds(merged, today) });
  } catch (err) {
    console.error("Failed to sync today's performance:", err);
  }
}

/* ------------------------------------------------------------------ */
/* Store                                                               */
/* ------------------------------------------------------------------ */

export const useStore = create<MomentumState>()((set, get) => ({
  ready: false,
  tasks: [],
  logs: [],
  sections: [],
  history: [],
  notifications: [],
  notificationSettings: defaultSettings,

  boot: () => {
    if (!bootPromise) {
      bootPromise = doBoot(set)
        .then(() => {
          if (get().ready) return get().syncNotifications();
        })
        .catch(async (err) => {
          console.error("Momentum: failed to hydrate local database:", err);
          bootPromise = null;
          const [tasks, logs, sections, history] = await Promise.all([
            db.tasks.toArray(),
            db.logs.toArray(),
            db.sections.toArray(),
            db.performance.toArray(),
          ]);
          set({ ready: true, tasks, logs, sections, history });
        });
    }
    return bootPromise;
  },

  /* ------------------------------ Tasks ------------------------------ */

  addTask: (input) => {
    const id = uid();
    const task: Task = {
      id,
      title: input.title.trim(),
      section: input.section,
      customSectionId: input.customSectionId,
      estimatedMinutes: Math.max(0, Math.round(input.estimatedMinutes)),
      remainingMinutes: Math.max(0, Math.round(input.estimatedMinutes)),
      description: input.description?.trim() || undefined,
      nextAction: input.nextAction?.trim() || undefined,
      dueDate: input.dueDate || undefined,
      priority: input.priority,
      schedule: input.schedule,
      status: "active",
      createdAt: new Date().toISOString(),
    };
    set((s) => ({ tasks: [task, ...s.tasks] }));
    db.tasks
      .add(task)
      .then(() => Promise.all([syncToday(get, set), get().syncNotifications()]))
      .catch(logError("create task"));
    return id;
  },

  updateTask: (id, patch) => {
    set((s) => ({
      tasks: s.tasks.map((t) => {
        if (t.id !== id) return t;
        const next: Task = { ...t, ...patch };

        // Keep the "remaining = estimated − logged" invariant when the
        // estimate changes on a task that is still in progress.
        if (
          patch.estimatedMinutes !== undefined &&
          patch.estimatedMinutes !== t.estimatedMinutes &&
          next.status === "active"
        ) {
          const burned = t.estimatedMinutes - t.remainingMinutes;
          next.remainingMinutes = Math.max(0, next.estimatedMinutes - burned);
        }
        if (next.status !== "active") next.remainingMinutes = 0;
        return next;
      }),
    }));
    const updated = get().tasks.find((t) => t.id === id);
    if (updated) {
      db.tasks
        .put(updated)
        .then(() => Promise.all([syncToday(get, set), get().syncNotifications()]))
        .catch(logError("update task"));
    }
  },

  deleteTask: (id) => {
    set((s) => ({
      tasks: s.tasks.filter((t) => t.id !== id),
      logs: s.logs.filter((l) => l.taskId !== id),
    }));
    db.transaction("rw", [db.tasks, db.logs, db.notifications], async () => {
      await db.tasks.delete(id);
      await db.logs.where("taskId").equals(id).delete();
      await db.notifications.where("taskId").equals(id).delete();
    })
      .then(() => Promise.all([syncToday(get, set), get().syncNotifications()]))
      .catch(logError("delete task"));
  },

  toggleTask: (id, completed) => {
    const task = get().tasks.find((t) => t.id === id);
    if (!task || task.status === "accomplished") return;
    const done = completed ?? !isTaskDone(task);

    const next: Task = done
      ? {
          ...task,
          status: "completed",
          completedAt: task.completedAt ?? new Date().toISOString(),
          remainingMinutes: 0,
        }
      : {
          ...task,
          status: "active",
          completedAt: undefined,
          remainingMinutes: task.estimatedMinutes,
        };

    set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? next : t)) }));
    db.tasks
      .put(next)
      .then(() => get().syncNotifications())
      .catch(logError("toggle task"));
  },

  logTime: (taskId, minutes, date) => {
    const state = get();
    const task = state.tasks.find((t) => t.id === taskId);
    if (!task || isTaskDone(task) || minutes <= 0) return;

    const applied = Math.min(Math.round(minutes), Math.max(0, task.remainingMinutes));
    if (applied <= 0) return;
    const logDate = date ?? todayKey();
    const done = task.remainingMinutes - applied <= 0;

    const nextTask: Task = done
      ? {
          ...task,
          status: "completed",
          completedAt: new Date().toISOString(),
          remainingMinutes: 0,
        }
      : { ...task, remainingMinutes: Math.max(0, task.remainingMinutes - applied) };

    const log: TimeLog = { id: uid(), taskId, minutes: applied, date: logDate };

    set((s) => ({
      tasks: s.tasks.map((t) => (t.id === taskId ? nextTask : t)),
      logs: [...s.logs, log],
    }));

    db.transaction("rw", [db.tasks, db.logs], async () => {
      await db.tasks.put(nextTask);
      await db.logs.add(log);
    })
      .then(() => Promise.all([syncToday(get, set), get().syncNotifications()]))
      .catch(logError("log time"));
  },

  accomplishTask: (id) => {
    const task = get().tasks.find((t) => t.id === id);
    if (!task || !canAccomplish(task)) return;

    const next = toAccomplished(task);
    set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? next : t)) }));
    db.tasks
      .put(next)
      .then(() => Promise.all([syncToday(get, set), get().syncNotifications()]))
      .catch(logError("accomplish task"));
  },

  /* -------------------------- Custom sections ------------------------ */

  addCustomSection: (input) => {
    const section: CustomSection = {
      id: uid(),
      name: input.name.trim(),
      icon: input.icon?.trim() || undefined,
      schedule: input.schedule,
      createdAt: new Date().toISOString(),
    };
    set((s) => ({ sections: [...s.sections, section] }));
    db.sections.add(section).catch(logError("create section"));
  },

  removeCustomSection: (id) => {
    if (get().tasks.some((t) => t.customSectionId === id)) return;
    set((s) => ({ sections: s.sections.filter((x) => x.id !== id) }));
    db.sections.delete(id).catch(logError("delete section"));
  },

  /* --------------------------- Notifications ------------------------- */

  syncNotifications: async () => {
    const s = get();
    const now = new Date();
    const { creates, updates } = planNotifications({
      now,
      tasks: s.tasks,
      logs: s.logs,
      existing: s.notifications,
      settings: s.notificationSettings,
    });

    if (creates.length === 0 && updates.length === 0) return;

    // The engine only emits creates that respect the cooldown (cues fire in
    // the future, next-task nudges wait for the cooldown to elapse), so any
    // create whose time has already arrived can be delivered immediately.
    const stamped: TaskNotification[] = creates.map((d) => {
      const past = new Date(d.scheduledAt).getTime() <= now.getTime();
      return {
        ...d,
        id: uid(),
        createdAt: now.toISOString(),
        status: past ? "delivered" : "scheduled",
        ...(past ? { deliveredAt: now.toISOString() } : {}),
      };
    });

    const byId = new Map(s.notifications.map((n) => [n.id, n]));
    for (const n of updates) byId.set(n.id, n);
    for (const n of stamped) byId.set(n.id, n);
    const next = [...byId.values()].sort((a, b) =>
      a.createdAt < b.createdAt ? 1 : -1,
    );
    set({ notifications: next });

    try {
      await db.transaction("rw", db.notifications, async () => {
        if (updates.length > 0) await db.notifications.bulkPut(updates);
        if (stamped.length > 0) await db.notifications.bulkAdd(stamped);
      });
    } catch (err) {
      logError("sync notifications")(err);
    }
  },

  dismissNotification: (id) => {
    const s = get();
    const n = s.notifications.find((x) => x.id === id);
    if (!n || n.status === "dismissed") return;
    const next: TaskNotification = {
      ...n,
      status: "dismissed",
      dismissedAt: new Date().toISOString(),
    };
    set((st) => ({
      notifications: st.notifications.map((x) => (x.id === id ? next : x)),
    }));
    db.notifications.put(next).catch(logError("dismiss notification"));
  },

  snoozeNotification: (id, minutes) => {
    const s = get();
    const n = s.notifications.find((x) => x.id === id);
    if (!n || n.status === "dismissed" || n.status === "cancelled") return;
    const mins = minutes ?? s.notificationSettings.snoozeMinutes;
    const until = new Date(Date.now() + mins * 60_000);
    const next: TaskNotification = {
      ...n,
      status: "snoozed",
      scheduledAt: until.toISOString(),
      snoozedUntil: until.toISOString(),
    };
    set((st) => ({
      notifications: st.notifications.map((x) => (x.id === id ? next : x)),
    }));
    db.notifications.put(next).catch(logError("snooze notification"));
  },

  setNotificationSettings: (patch) => {
    const next = { ...get().notificationSettings, ...patch };
    set({ notificationSettings: next });
    db.meta
      .put({ key: "notificationSettings", value: next })
      .then(() => get().syncNotifications())
      .catch(logError("save notification settings"));
  },
}));

/* ------------------------------------------------------------------ */
/* Selectors / helpers                                                 */
/* ------------------------------------------------------------------ */

/** Minutes logged for a task on a given date. */
export function loggedTodayForTask(
  logs: TimeLog[],
  taskId: string,
  date: string = todayKey(),
): number {
  return logs
    .filter((l) => l.taskId === taskId && l.date === date)
    .reduce((s, l) => s + l.minutes, 0);
}

export function isDueSoon(dueKey: string): boolean {
  const today = todayKey();
  const d = new Date(today + "T12:00:00");
  d.setDate(d.getDate() + 3);
  const soon = dateKey(d);
  return dueKey >= today && dueKey <= soon;
}
