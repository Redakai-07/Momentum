import { create } from "zustand";
import { db } from "./db";
import { dateKey, todayKey } from "./date";
import { uid } from "./utils";
import { liveDayRec } from "./performance";
import { applyRecoveryKinds } from "./activity";
import { COOLDOWN_OPTIONS, NOTIFICATION_DEFAULTS } from "./config";
import { planNotifications, notificationMessage } from "./notifications/engine";
import {
  shouldNotify,
  isQuietHours,
  type DecisionContext,
} from "./notifications/decision";
import {
  checkPermission,
  requestPermission,
  resyncNative,
  onNativeNotification,
  nativeAvailable,
  nativeIdForKey,
  ensureChannel,
  type NativeNotifRecord,
} from "./notifications/service";
import type { TaskNotification, NotificationSettings } from "./notifications/types";
import { canAccomplish, isTaskDone, toAccomplished } from "./task-state";
import {
  DEFAULT_PROFILE_NAME,
  type CustomSection,
  type DailyPerformance,
  type Priority,
  type Schedule,
  type SectionKind,
  type Task,
  type TimeLog,
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

/**
 * Persistent timestamps that drive the notification intelligence.
 * All values are ISO strings; stored in the meta table so they survive
 * restarts, phone reboots and process kills.
 */
export interface NotificationMeta {
  lastNotificationAt?: string;
  lastMeaningfulActivityAt?: string;
  lastTaskCompletionAt?: string;
  lastInteractionAt?: string;
}

type State = {
  ready: boolean;
  tasks: Task[];
  logs: TimeLog[];
  sections: CustomSection[];
  history: DailyPerformance[];
  notifications: TaskNotification[];
  notificationSettings: NotificationSettings;
  /** Notification intelligence timestamps (persisted in meta). */
  notificationMeta: NotificationMeta;
  /** Android/iOS permission: "granted" | "denied" | "prompt" | "prompt-with-rationale". */
  notificationPermission: string;
  /** Display name shown in the greeting and on the profile (persisted in meta). */
  profileName: string;
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
  syncNativeNotifications: () => Promise<void>;
  dismissNotification: (id: string) => void;
  snoozeNotification: (id: string, minutes?: number) => void;
  setNotificationSettings: (patch: NotificationSettingsPatch) => void;
  /** Record that the user interacted (app open, task open) — feeds the gap logic. */
  markInteraction: () => void;
  requestNotificationPermission: () => Promise<string>;
  refreshNotificationPermission: () => Promise<void>;
  /** Update the display name shown in the greeting and on the profile. */
  setProfileName: (name: string) => void;
};

export interface MomentumState extends State, Actions {}

type SetFn = (partial: MomentumState | Partial<MomentumState> | ((s: MomentumState) => Partial<MomentumState>)) => void;
type GetFn = () => MomentumState;

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const defaultSettings: NotificationSettings = { ...NOTIFICATION_DEFAULTS };

function mergeSettings(raw: unknown): NotificationSettings {
  const merged: NotificationSettings = {
    ...defaultSettings,
    ...(typeof raw === "object" && raw ? (raw as Partial<NotificationSettings>) : {}),
  };
  // Clamp legacy values into the supported cooldown set so old installs
  // never keep a 15-minute spammy default.
  if (!COOLDOWN_OPTIONS.some((o) => o.value === merged.cooldownMinutes)) {
    merged.cooldownMinutes = defaultSettings.cooldownMinutes;
  }
  return merged;
}

async function readSettings(): Promise<NotificationSettings> {
  const row = await db.meta.get("notificationSettings");
  return mergeSettings(row?.value);
}

async function readMetaValue<T>(key: string): Promise<T | undefined> {
  try {
    const row = await db.meta.get(key);
    return row?.value as T | undefined;
  } catch {
    return undefined;
  }
}

async function writeMetaValue(key: string, value: unknown): Promise<void> {
  try {
    await db.meta.put({ key, value });
  } catch {
    /* meta writes are best-effort */
  }
}

async function readNotificationMeta(): Promise<NotificationMeta> {
  const [lastNotificationAt, lastMeaningfulActivityAt, lastTaskCompletionAt, lastInteractionAt] =
    await Promise.all([
      readMetaValue<string>("lastNotificationAt"),
      readMetaValue<string>("lastMeaningfulActivityAt"),
      readMetaValue<string>("lastTaskCompletionAt"),
      readMetaValue<string>("lastInteractionAt"),
    ]);
  return { lastNotificationAt, lastMeaningfulActivityAt, lastTaskCompletionAt, lastInteractionAt };
}

/** Real date the user first opened the app (persisted once, on first boot). */
export async function getFirstRunDate(): Promise<string | null> {
  try {
    const row = await db.meta.get("firstRunAt");
    const v = row?.value;
    if (typeof v === "string" && v.length >= 10) return v.slice(0, 10);
    return null;
  } catch {
    return null;
  }
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
/* Native notification helpers                                         */
/* ------------------------------------------------------------------ */

const isOrdinaryType = (t: string) =>
  t === "task_start" || t === "task_reminder" || t === "next_task";

/** Minutes since an ISO timestamp (Infinity when missing). */
function minutesSince(iso: string | null | undefined, now: Date): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  const ms = new Date(iso).getTime();
  if (!Number.isFinite(ms)) return Number.POSITIVE_INFINITY;
  return Math.max(0, Math.floor((now.getTime() - ms) / 60_000));
}

/**
 * Earliest sensible delivery time for an ordinary reminder: at least
 * 30 minutes out, past the global cooldown, and outside quiet hours.
 */
function nextOrdinarySlot(
  now: Date,
  settings: NotificationSettings,
  lastNotificationAt?: string,
): Date | null {
  let t = new Date(now.getTime() + 30 * 60_000);
  const cooldownEnd = lastNotificationAt
    ? new Date(new Date(lastNotificationAt).getTime() + settings.cooldownMinutes * 60_000)
    : null;
  if (cooldownEnd && t.getTime() < cooldownEnd.getTime()) t = cooldownEnd;
  for (let i = 0; i < 24 * 4; i++) {
    if (!isQuietHours(t, settings)) return t;
    t = new Date(t.getTime() + 15 * 60_000);
  }
  return null;
}

/**
 * Build the native schedule: per-task cues from the in-app queue (filtered
 * through quiet hours + completion cooldown) plus one possible ordinary
 * drift reminder chosen by the decision engine. Deterministic + deduped.
 */
function buildNativeSchedule(get: GetFn, now: Date): NativeNotifRecord[] {
  const s = get();
  const settings = s.notificationSettings;
  const today = dateKey(now);
  const records: NativeNotifRecord[] = [];

  const { creates } = planNotifications({
    now,
    tasks: s.tasks,
    logs: s.logs,
    existing: s.notifications,
    settings,
  });

  for (const c of creates) {
    const fireAt = new Date(c.scheduledAt);
    const task = s.tasks.find((t) => t.id === c.taskId);
    if (!task || task.status !== "active") continue;

    // Ordinary reminders: quiet hours + breathing room after activity.
    if (isOrdinaryType(c.type)) {
      if (isQuietHours(fireAt, settings)) continue;
      const recentActivity = Math.min(
        minutesSince(s.notificationMeta.lastMeaningfulActivityAt, now),
        minutesSince(s.notificationMeta.lastTaskCompletionAt, now),
      );
      if (recentActivity < settings.completionCooldownMinutes) continue;
    }

    const body =
      c.type === "next_task"
        ? task.nextAction
          ? `Next: ${task.nextAction}`
          : notificationMessage(c, task.title)
        : notificationMessage(c, task.title);

    records.push({
      id: nativeIdForKey(`${c.taskId}:${c.type}:${c.date}`),
      key: `${c.taskId}:${c.type}:${c.date}`,
      title: task.title,
      body,
      at: fireAt,
    });
  }

  // Ordinary drift reminder — the decision engine decides, deduped per day.
  const decisionCtx: DecisionContext = {
    now,
    tasks: s.tasks,
    logs: s.logs,
    settings,
    lastNotificationAt: s.notificationMeta.lastNotificationAt,
    lastMeaningfulActivityAt: s.notificationMeta.lastMeaningfulActivityAt,
    lastTaskCompletionAt: s.notificationMeta.lastTaskCompletionAt,
    lastInteractionAt: s.notificationMeta.lastInteractionAt,
  };
  const decision = shouldNotify(decisionCtx);
  if (decision.shouldNotify && decision.priority !== "high") {
    const at = nextOrdinarySlot(now, settings, s.notificationMeta.lastNotificationAt);
    if (at) {
      records.push({
        id: nativeIdForKey(`ordinary:${today}`),
        key: `ordinary:${today}`,
        title: "Momentum",
        body: decision.message ?? "You still have planned work waiting.",
        at,
      });
    }
  }

  return records;
}

const devLog = (msg: string, data?: unknown) => {
  if (process.env.NODE_ENV !== "production") {
    console.debug(`[notifications] ${msg}`, data ?? "");
  }
};

/* ------------------------------------------------------------------ */
/* Boot + internal sync (called through the create closure)            */
/* ------------------------------------------------------------------ */

let bootPromise: Promise<void> | null = null;

async function doBoot(set: SetFn, get: GetFn): Promise<void> {
  const [taskRows, logRows, sectionRows, perfRows, notifRows] = await Promise.all([
    db.tasks.toArray(),
    db.logs.toArray(),
    db.sections.toArray(),
    db.performance.toArray(),
    db.notifications.toArray(),
  ]);
  let tasks = taskRows;
  const logs = logRows;
  const sections = sectionRows;
  let history = perfRows;

  // First run — the workspace starts completely empty. Just remember when
  // the user joined so the profile can show a real date.
  const firstRun = await db.meta.get("firstRunAt");
  if (!firstRun) {
    await db.meta.put({ key: "firstRunAt", value: new Date().toISOString() });
  }
  if (!(await db.meta.get("notificationSettings"))) {
    await db.meta.put({ key: "notificationSettings", value: defaultSettings });
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
  const notificationMeta = await readNotificationMeta();
  const storedPermission = await readMetaValue<string>("notificationPermissionState");
  const storedName = await readMetaValue<string>("profileName");

  set({
    ready: true,
    tasks,
    logs,
    sections,
    history: classified,
    notifications: notifRows,
    notificationSettings: settings,
    notificationMeta,
    notificationPermission: storedPermission ?? (nativeAvailable() ? "prompt" : "granted"),
    profileName: storedName ?? DEFAULT_PROFILE_NAME,
  });

  // App opened = the user interacted. Feed the drift math.
  const now = new Date();
  if (
    !notificationMeta.lastInteractionAt ||
    now.getTime() - new Date(notificationMeta.lastInteractionAt).getTime() > 60_000
  ) {
    const meta = { ...notificationMeta, lastInteractionAt: now.toISOString() };
    void writeMetaValue("lastInteractionAt", meta.lastInteractionAt);
    set({ notificationMeta: meta });
  }

  // Native delivery listeners + first permission request (only when there is
  // actual content to remind about, so a fresh install stays silent).
  if (nativeAvailable()) {
    void ensureChannel();
    onNativeNotification({
      received: (record) => {
        devLog("native notification received", record.key);
        const receivedAt = new Date().toISOString();
        void writeMetaValue("lastNotificationAt", receivedAt);
        set((s) => ({
          notificationMeta: { ...s.notificationMeta, lastNotificationAt: receivedAt },
        }));
        void get().syncNativeNotifications();
      },
    });

    // First use: ask once, only when the user actually has content to be
    // reminded about. Never nudge a brand-new empty workspace.
    const permission = storedPermission ?? (nativeAvailable() ? "prompt" : "granted");
    if (permission === "prompt" && tasks.length > 0) {
      const granted = await requestPermission();
      await writeMetaValue("notificationPermissionState", granted);
      set({ notificationPermission: granted });
      devLog("first-use permission", granted);
    }

    void get().syncNativeNotifications();
  }
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
  notificationMeta: {},
  notificationPermission: "prompt",
  profileName: DEFAULT_PROFILE_NAME,

  boot: () => {
    if (!bootPromise) {
      bootPromise = doBoot(set, get)
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
    const meta = {
      ...get().notificationMeta,
      lastMeaningfulActivityAt: new Date().toISOString(),
      lastInteractionAt: new Date().toISOString(),
    };
    void writeMetaValue("lastMeaningfulActivityAt", meta.lastMeaningfulActivityAt);
    set({ notificationMeta: meta });
    db.tasks
      .add(task)
      .then(() =>
        Promise.all([syncToday(get, set), get().syncNotifications(), get().syncNativeNotifications()]),
      )
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
        .then(() =>
          Promise.all([syncToday(get, set), get().syncNotifications(), get().syncNativeNotifications()]),
        )
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
      .then(() =>
        Promise.all([syncToday(get, set), get().syncNotifications(), get().syncNativeNotifications()]),
      )
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
    if (done) {
      const nowIso = new Date().toISOString();
      const meta = {
        ...get().notificationMeta,
        lastMeaningfulActivityAt: nowIso,
        lastTaskCompletionAt: nowIso,
      };
      void writeMetaValue("lastMeaningfulActivityAt", nowIso);
      void writeMetaValue("lastTaskCompletionAt", nowIso);
      set({ notificationMeta: meta });
    }
    db.tasks
      .put(next)
      .then(() =>
        Promise.all([get().syncNotifications(), get().syncNativeNotifications()]),
      )
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

    // Meaningful progress — the user is engaged, so the next reminder waits.
    const nowIso = new Date().toISOString();
    const meta = {
      ...get().notificationMeta,
      lastMeaningfulActivityAt: nowIso,
      ...(done ? { lastTaskCompletionAt: nowIso } : {}),
    };
    void writeMetaValue("lastMeaningfulActivityAt", nowIso);
    if (done) void writeMetaValue("lastTaskCompletionAt", nowIso);
    set({ notificationMeta: meta });

    db.transaction("rw", [db.tasks, db.logs], async () => {
      await db.tasks.put(nextTask);
      await db.logs.add(log);
    })
      .then(() => Promise.all([syncToday(get, set), get().syncNotifications(), get().syncNativeNotifications()]))
      .catch(logError("log time"));
  },

  accomplishTask: (id) => {
    const task = get().tasks.find((t) => t.id === id);
    if (!task || !canAccomplish(task)) return;

    const next = toAccomplished(task);
    set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? next : t)) }));
    const nowIso = new Date().toISOString();
    const meta = {
      ...get().notificationMeta,
      lastMeaningfulActivityAt: nowIso,
      lastTaskCompletionAt: nowIso,
    };
    void writeMetaValue("lastMeaningfulActivityAt", nowIso);
    void writeMetaValue("lastTaskCompletionAt", nowIso);
    set({ notificationMeta: meta });
    db.tasks
      .put(next)
      .then(() => Promise.all([syncToday(get, set), get().syncNotifications(), get().syncNativeNotifications()]))
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

  /**
   * Keep the native schedule in sync with reality. Runs after every change
   * and whenever the app resumes: cancel outdated, schedule the meaningful
   * handful, persist what is pending. No-op on the web.
   */
  syncNativeNotifications: async () => {
    const s = get();
    if (!nativeAvailable()) return;

    const settings = s.notificationSettings;
    const now = new Date();
    const permission = s.notificationPermission;

    if (!settings.enabled || permission !== "granted") {
      const tracked = (await readMetaValue<NativeNotifRecord[]>("scheduledNotificationIds")) ?? [];
      if (tracked.length > 0) {
        await resyncNative(tracked, []);
        await writeMetaValue("scheduledNotificationIds", []);
        devLog("native schedule cleared (disabled or no permission)");
      }
      return;
    }

    const schedule = buildNativeSchedule(get, now);
    const nextRecords = schedule.slice(0, 12); // keep the meaningful few

    const tracked =
      (await readMetaValue<NativeNotifRecord[]>("scheduledNotificationIds")) ?? [];

    // Skip the native round-trip when nothing changed.
    const same =
      tracked.length === nextRecords.length &&
      tracked.every((t, i) => t.key === nextRecords[i].key && t.at.getTime() === nextRecords[i].at.getTime());
    if (same) {
      devLog("native schedule unchanged", nextRecords.length);
      return;
    }

    await resyncNative(tracked, nextRecords);
    await writeMetaValue("scheduledNotificationIds", nextRecords);
    devLog("native schedule synced", { count: nextRecords.length, keys: nextRecords.map((r) => r.key) });
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
      .then(() =>
        Promise.all([get().syncNotifications(), get().syncNativeNotifications()]),
      )
      .catch(logError("save notification settings"));
  },

  markInteraction: () => {
    const now = new Date();
    const last = get().notificationMeta.lastInteractionAt;
    if (last && now.getTime() - new Date(last).getTime() < 60_000) return; // throttle
    const iso = now.toISOString();
    void writeMetaValue("lastInteractionAt", iso);
    set((s) => ({ notificationMeta: { ...s.notificationMeta, lastInteractionAt: iso } }));
  },

  requestNotificationPermission: async () => {
    const permission = await requestPermission();
    await writeMetaValue("notificationPermissionState", permission);
    set({ notificationPermission: permission });
    if (permission === "granted") {
      await get().syncNativeNotifications();
    }
    devLog("permission requested", permission);
    return permission;
  },

  refreshNotificationPermission: async () => {
    const permission = await checkPermission();
    await writeMetaValue("notificationPermissionState", permission);
    set({ notificationPermission: permission });
  },

  setProfileName: (name) => {
    const trimmed = name.trim().slice(0, 40);
    const next = trimmed.length > 0 ? trimmed : DEFAULT_PROFILE_NAME;
    set({ profileName: next });
    void writeMetaValue("profileName", next);
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