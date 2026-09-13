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
  refreshExactAlarmState,
  requestExactAlarmAccess as openExactAlarmSettings,
  getNativeDiagnostics,
  sendTestNotification,
  type NativeNotifRecord,
  type NativeDiagnostics,
  type TestNotificationResult,
} from "./notifications/service";
import type { TaskNotification, NotificationSettings } from "./notifications/types";
import { canAccomplish, isTaskDone, rolloverTasks, toAccomplished } from "./task-state";
import {
  buildBackup,
  serializeBackup,
  summarizeBackup,
  backupFilename,
  type BackupCounts,
  type MomentumBackup,
} from "./backup";
import { saveBackup, type SaveDestination } from "./backup-io";
import {
  DEFAULT_PROFILE_NAME,
  type CustomSection,
  type DailyPerformance,
  type Hobby,
  type HobbyAccent,
  type Note,
  type Priority,
  type Schedule,
  type SectionKind,
  type Task,
  type TaskDuration,
  type TimeLog,
} from "./types";
import {
  completedMinutesOf,
  isTimedTask,
  normalizeDuration,
  plannedMinutesOf,
} from "./duration";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface TaskInput {
  title: string;
  section: SectionKind;
  customSectionId?: string;
  /**
   * Planned minutes, or `null` for a completion-based task (Reminder /
   * Occasional with no meaningful duration).
   */
  estimatedMinutes: TaskDuration;
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

export interface HobbyInput {
  name: string;
  description?: string;
  icon?: string;
  accent?: HobbyAccent;
}

export interface NoteInput {
  title: string;
  content: string;
  /** Optional hobby association — omit for a standalone note. */
  hobbyId?: string;
}

export type NotificationSettingsPatch = Partial<NotificationSettings>;

export interface ExportBackupResult {
  ok: boolean;
  filename?: string;
  bytes?: number;
  counts?: BackupCounts;
  destination?: SaveDestination;
  uri?: string;
  error?: string;
}

export interface ImportBackupResult {
  ok: boolean;
  counts?: BackupCounts;
  /** The automatic pre-import copy of the data that was replaced. */
  safety?: { ok: boolean; filename: string; error?: string };
  error?: string;
}

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
  /** Optional Hobby & Notes space — never part of the task system. */
  hobbies: Hobby[];
  notes: Note[];
  notificationSettings: NotificationSettings;
  /** Notification intelligence timestamps (persisted in meta). */
  notificationMeta: NotificationMeta;
  /** Android/iOS permission: "granted" | "denied" | "prompt" | "prompt-with-rationale". */
  notificationPermission: string;
  /** Development aid: a truthful snapshot of the native notification pipeline. */
  notificationDiagnostics: NativeDiagnostics | null;
  /** Result of the most recent "Test notification" tap. */
  lastTestNotification: TestNotificationResult | null;
  /** Display name shown in the greeting and on the profile (persisted in meta). */
  profileName: string;
  /** When the user last exported a backup (persisted in meta), or null. */
  lastBackupAt: string | null;
};

type Actions = {
  boot: () => Promise<void>;
  /**
   * Reopen recurring work when the local calendar day has advanced.
   * Idempotent — safe to call on boot, on every resume and on a timer.
   */
  rolloverIfNewDay: () => Promise<boolean>;
  addTask: (input: TaskInput) => string;
  updateTask: (id: string, patch: Partial<Task>) => void;
  deleteTask: (id: string) => void;
  toggleTask: (id: string, completed?: boolean) => void;
  logTime: (taskId: string, minutes: number, date?: string) => void;
  accomplishTask: (id: string) => void;
  addCustomSection: (input: SectionInput) => void;
  updateCustomSection: (id: string, patch: Partial<CustomSection>) => void;
  removeCustomSection: (id: string) => void;

  /* Hobby & Notes — an optional, local-only personal space. */
  addHobby: (input: HobbyInput) => string;
  updateHobby: (id: string, patch: Partial<Hobby>) => void;
  /** Deletes a hobby and *unfiles* its notes — notes are never destroyed. */
  removeHobby: (id: string) => void;
  addNote: (input: NoteInput) => string;
  updateNote: (id: string, patch: Partial<Note>) => void;
  removeNote: (id: string) => void;

  /* Data & Backup — the user's portable copy of everything above. */
  /** Write a complete backup of the persistent data and hand it to the user. */
  exportBackup: () => Promise<ExportBackupResult>;
  /**
   * Atomically replace all persistent data with a validated backup, after
   * automatically saving a safety copy of what is being replaced.
   */
  importBackup: (backup: MomentumBackup) => Promise<ImportBackupResult>;
  testNotification: () => Promise<TestNotificationResult>;
  /** Re-read the native notification pipeline snapshot (diagnostics only). */
  refreshNotificationDiagnostics: () => Promise<void>;
  /** Open the Android "Alarms & reminders" screen (precision, not required). */
  requestExactAlarmAccess: () => Promise<void>;
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

function replaceToday(history: DailyPerformance[], rec: DailyPerformance): DailyPerformance[] {
  const idx = history.findIndex((h) => h.date === rec.date);
  if (idx === -1) return [...history, rec].sort((a, b) => (a.date < b.date ? -1 : 1));
  const next = [...history];
  next[idx] = rec;
  return next;
}

async function persistDayRec(tasks: Task[], logs: TimeLog[], key: string, sections: CustomSection[] = []): Promise<void> {
  const rec = liveDayRec(tasks, logs, key, sections);
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
/* Data & Backup helpers                                               */
/* ------------------------------------------------------------------ */

/**
 * The theme preference is the one setting that lives in localStorage rather
 * than IndexedDB, so a backup has to read it separately. It travels with the
 * backup, but IndexedDB stays the source of truth for the accent colour.
 */
function readStoredTheme(): string | null {
  try {
    const v = localStorage.getItem("momentum:theme");
    return v === "light" || v === "dark" || v === "system" ? v : null;
  } catch {
    return null;
  }
}

/**
 * Read every user-owned table as one consistent set and assemble a backup.
 * `notifications` is intentionally absent: it is a rebuildable runtime queue,
 * and its native alarm IDs belong to this device.
 */
async function buildCurrentBackup(): Promise<MomentumBackup> {
  const [tasks, logs, sections, performance, hobbies, notes, meta] = await Promise.all([
    db.tasks.toArray(),
    db.logs.toArray(),
    db.sections.toArray(),
    db.performance.toArray(),
    db.hobbies.toArray(),
    db.notes.toArray(),
    db.meta.toArray(),
  ]);
  return buildBackup({
    tasks,
    logs,
    sections,
    performance,
    hobbies,
    notes,
    meta,
    theme: readStoredTheme(),
  });
}

/* ------------------------------------------------------------------ */
/* Native notification helpers                                         */
/* ------------------------------------------------------------------ */

const isOrdinaryType = (t: string) =>
  t === "task_start" || t === "task_reminder" || t === "next_task";

/** Fire-time timestamp of a persisted record (tolerates round-tripped values). */
function recordAtMs(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string" || typeof value === "number") return new Date(value).getTime();
  return Number.NaN;
}

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
    sections: s.sections,
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
  const [taskRows, logRows, sectionRows, perfRows, notifRows, hobbyRows, noteRows] =
    await Promise.all([
      db.tasks.toArray(),
      db.logs.toArray(),
      db.sections.toArray(),
      db.performance.toArray(),
      db.notifications.toArray(),
      db.hobbies.toArray(),
      db.notes.toArray(),
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

  // A new local calendar day reopens recurring work: yesterday's completion or
  // partial progress belongs to yesterday, never to today. Only the live
  // fields on the task change — time logs and performance rows are untouched.
  const today = todayKey();
  const loggedToday = new Set(logs.filter((l) => l.date === today).map((l) => l.taskId));
  const rolled = rolloverTasks(tasks, loggedToday, today);
  if (rolled.changed.length > 0) {
    await db.tasks.bulkPut(rolled.changed);
    tasks = rolled.tasks;
    devLog("day rollover on boot", { today, reopened: rolled.changed.length });
  }
  // Remember which day the live state belongs to, so the runtime rollover can
  // short-circuit until the calendar actually advances.
  await writeMetaValue("lastRolloverDate", today);

  // Make sure today has a snapshot row.
  if (history.findIndex((h) => h.date === today) === -1) {
    await persistDayRec(tasks, logs, today, sections);
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
  let storedPermission = await readMetaValue<string>("notificationPermissionState");
  const storedName = await readMetaValue<string>("profileName");
  const storedBackupAt = await readMetaValue<string>("lastBackupAt");

  // Never trust a cached permission: the user may have revoked notifications
  // from Android settings since the last launch. Re-check on every boot.
  if (nativeAvailable()) {
    const live = await checkPermission();
    if (live !== storedPermission) {
      storedPermission = live;
      await writeMetaValue("notificationPermissionState", live);
    }
  }

  set({
    ready: true,
    tasks,
    logs,
    sections,
    history: classified,
    notifications: notifRows,
    hobbies: hobbyRows,
    notes: noteRows,
    notificationSettings: settings,
    notificationMeta,
    notificationPermission: storedPermission ?? (nativeAvailable() ? "prompt" : "granted"),
    profileName: storedName ?? DEFAULT_PROFILE_NAME,
    lastBackupAt: typeof storedBackupAt === "string" ? storedBackupAt : null,
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
    // Order matters: Android drops a notification posted to a channel that does
    // not exist yet, and the exact-alarm setting decides whether each alarm is
    // scheduled as exact or inexact. Both are resolved before anything fires.
    await ensureChannel();
    await refreshExactAlarmState();

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
    const permission = storedPermission ?? "prompt";
    if (permission === "prompt" && tasks.length > 0) {
      const granted = await requestPermission();
      await writeMetaValue("notificationPermissionState", granted);
      set({ notificationPermission: granted });
      devLog("first-use permission", granted);
    }

    await get().syncNativeNotifications();
    await get().refreshNotificationDiagnostics();
  }
}

/** Recompute + persist today's snapshot, classify, refresh state. */
async function syncToday(get: GetFn, set: SetFn): Promise<void> {
  const s = get();
  try {
    const today = todayKey();
    const rec = liveDayRec(s.tasks, s.logs, today, s.sections);
    await persistDayRec(s.tasks, s.logs, today, s.sections);
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
  hobbies: [],
  notes: [],
  notificationSettings: defaultSettings,
  notificationMeta: {},
  notificationPermission: "prompt",
  notificationDiagnostics: null,
  lastTestNotification: null,
  profileName: DEFAULT_PROFILE_NAME,
  lastBackupAt: null,

  boot: () => {
    if (!bootPromise) {
      bootPromise = doBoot(set, get)
        .then(() => {
          if (get().ready) return get().syncNotifications();
        })
        .catch(async (err) => {
          console.error("Momentum: failed to hydrate local database:", err);
          bootPromise = null;
          const [tasks, logs, sections, history, hobbies, notes] = await Promise.all([
            db.tasks.toArray(),
            db.logs.toArray(),
            db.sections.toArray(),
            db.performance.toArray(),
            db.hobbies.toArray(),
            db.notes.toArray(),
          ]);
          set({ ready: true, tasks, logs, sections, history, hobbies, notes });
        });
    }
    return bootPromise;
  },

  /**
   * Reopen recurring work when the local calendar day has advanced.
   *
   * Android keeps the WebView alive when the app is backgrounded, so a day
   * change cannot rely on a page reload (or a fragile midnight timer). This
   * runs on boot, on every return to the foreground and on a short interval.
   * It is idempotent: the persisted `lastRolloverDate` short-circuits repeat
   * calls within the same day, and the rollover itself is a pure scan.
   */
  rolloverIfNewDay: async () => {
    const state = get();
    if (!state.ready) return false;

    const today = todayKey();
    const last = await readMetaValue<string>("lastRolloverDate");
    if (last === today) return false;
    await writeMetaValue("lastRolloverDate", today);

    const loggedToday = new Set(
      state.logs.filter((l) => l.date === today).map((l) => l.taskId),
    );
    const rolled = rolloverTasks(state.tasks, loggedToday, today);
    const reopened = rolled.changed.length;

    if (reopened > 0) {
      set({ tasks: rolled.tasks });
      try {
        await db.tasks.bulkPut(rolled.changed);
      } catch (err) {
        logError("day rollover")(err);
      }
    }

    // The calendar day moved, so today's snapshot and the reminder queue must
    // both be rebuilt against the new date.
    await syncToday(get, set);
    await get().syncNotifications();
    await get().syncNativeNotifications();
    devLog("day rollover", { today, reopened });
    return reopened > 0;
  },

  /* ------------------------------ Tasks ------------------------------ */

  addTask: (input) => {
    const id = uid();
    // A missing/zero duration is stored explicitly as `null` — never a fake
    // 0-minute estimate, so completion-based tasks stay out of time-based math.
    const planned = normalizeDuration(input.estimatedMinutes);
    const task: Task = {
      id,
      title: input.title.trim(),
      section: input.section,
      customSectionId: input.customSectionId,
      estimatedMinutes: planned,
      remainingMinutes: planned ?? 0,
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

        // Keep the "remaining = planned − logged" invariant when the duration
        // changes on a task that is still in progress. Clearing the duration
        // (null) collapses remaining to 0; adding one restores it.
        if (
          patch.estimatedMinutes !== undefined &&
          patch.estimatedMinutes !== t.estimatedMinutes &&
          next.status === "active"
        ) {
          const burned = completedMinutesOf(t);
          next.remainingMinutes = Math.max(0, plannedMinutesOf(next) - burned);
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
          remainingMinutes: plannedMinutesOf(task),
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
    // Completion-based tasks have no minutes to log — they are toggled.
    if (!isTimedTask(task)) return;

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

  updateCustomSection: (id, patch) => {
    const section = get().sections.find((x) => x.id === id);
    if (!section) return;
    const next = { ...section, ...patch, name: patch.name?.trim() || section.name };
    set((s) => ({ sections: s.sections.map((x) => (x.id === id ? next : x)) }));
    db.sections.put(next).catch(logError("update section"));
  },

  removeCustomSection: (id) => {
    if (get().tasks.some((t) => t.customSectionId === id)) return;
    set((s) => ({ sections: s.sections.filter((x) => x.id !== id) }));
    db.sections.delete(id).catch(logError("delete section"));
  },

  /* --------------------------- Hobby & Notes ------------------------- */
  // Deliberately isolated from schedules, completion and performance: nothing
  // here calls syncToday, the rollover or the notification planner.

  addHobby: (input) => {
    const id = uid();
    const now = new Date().toISOString();
    const hobby: Hobby = {
      id,
      name: input.name.trim(),
      description: input.description?.trim() || undefined,
      icon: input.icon?.trim() || undefined,
      accent: input.accent,
      createdAt: now,
      updatedAt: now,
    };
    set((s) => ({ hobbies: [hobby, ...s.hobbies] }));
    db.hobbies.add(hobby).catch(logError("create hobby"));
    return id;
  },

  updateHobby: (id, patch) => {
    const current = get().hobbies.find((h) => h.id === id);
    if (!current) return;
    const next: Hobby = {
      ...current,
      ...patch,
      name: patch.name !== undefined ? patch.name.trim() || current.name : current.name,
      description:
        patch.description !== undefined ? patch.description.trim() || undefined : current.description,
      icon: patch.icon !== undefined ? patch.icon.trim() || undefined : current.icon,
      updatedAt: new Date().toISOString(),
    };
    set((s) => ({ hobbies: s.hobbies.map((h) => (h.id === id ? next : h)) }));
    db.hobbies.put(next).catch(logError("update hobby"));
  },

  removeHobby: (id) => {
    const state = get();
    // Notes outlive their hobby: unfiling keeps every note reachable instead
    // of silently destroying writing the user never asked to delete.
    const orphans = state.notes.filter((n) => n.hobbyId === id);
    set((s) => ({
      hobbies: s.hobbies.filter((h) => h.id !== id),
      notes: s.notes.map((n) => (n.hobbyId === id ? { ...n, hobbyId: undefined } : n)),
    }));
    db.transaction("rw", [db.hobbies, db.notes], async () => {
      await db.hobbies.delete(id);
      for (const note of orphans) {
        await db.notes.put({ ...note, hobbyId: undefined });
      }
    }).catch(logError("delete hobby"));
  },

  addNote: (input) => {
    const id = uid();
    const now = new Date().toISOString();
    const note: Note = {
      id,
      title: input.title.trim() || "Untitled note",
      content: input.content,
      hobbyId: input.hobbyId || undefined,
      createdAt: now,
      updatedAt: now,
    };
    set((s) => ({ notes: [note, ...s.notes] }));
    db.notes.add(note).catch(logError("create note"));
    return id;
  },

  updateNote: (id, patch) => {
    const current = get().notes.find((n) => n.id === id);
    if (!current) return;
    const next: Note = {
      ...current,
      ...patch,
      title:
        patch.title !== undefined ? patch.title.trim() || "Untitled note" : current.title,
      hobbyId: patch.hobbyId !== undefined ? patch.hobbyId || undefined : current.hobbyId,
      updatedAt: new Date().toISOString(),
    };
    set((s) => ({ notes: s.notes.map((n) => (n.id === id ? next : n)) }));
    db.notes.put(next).catch(logError("update note"));
  },

  removeNote: (id) => {
    set((s) => ({ notes: s.notes.filter((n) => n.id !== id) }));
    db.notes.delete(id).catch(logError("delete note"));
  },

  /* --------------------------- Data & Backup ------------------------- */

  exportBackup: async () => {
    try {
      const backup = await buildCurrentBackup();
      const json = serializeBackup(backup);
      const filename = backupFilename("momentum-backup");
      const saved = await saveBackup(json, filename);
      if (!saved.ok) {
        return { ok: false, error: saved.error ?? "The backup file could not be saved." };
      }
      const now = new Date().toISOString();
      await writeMetaValue("lastBackupAt", now);
      set({ lastBackupAt: now });
      return {
        ok: true,
        filename,
        bytes: json.length,
        counts: summarizeBackup(backup, json.length).counts,
        destination: saved.destination,
        uri: saved.uri,
      };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "The backup could not be created.",
      };
    }
  },

  importBackup: async (backup) => {
    const counts = summarizeBackup(backup).counts;

    // 1. Safety copy of exactly what is about to be replaced. If it cannot be
    //    written we stop here: the purpose of this feature is that data is
    //    never lost, so an un-backed-up overwrite is not acceptable.
    const safetyName = backupFilename("momentum-pre-import-backup");
    let safety: { ok: boolean; filename: string; error?: string };
    try {
      const current = await buildCurrentBackup();
      const saved = await saveBackup(serializeBackup(current), safetyName);
      safety = saved.ok
        ? { ok: true, filename: safetyName }
        : { ok: false, filename: safetyName, error: saved.error };
    } catch (err) {
      safety = {
        ok: false,
        filename: safetyName,
        error: err instanceof Error ? err.message : "Unknown error",
      };
    }
    if (!safety.ok) {
      return {
        ok: false,
        safety,
        error:
          "Momentum couldn't save a safety copy of your current data, so nothing was changed. " +
          "Allow downloads for Momentum and try again.",
      };
    }

    // 2. One transaction across every table, so a failure half-way through
    //    rolls the entire import back and leaves the existing data intact.
    try {
      await db.transaction(
        "rw",
        [
          db.tasks,
          db.logs,
          db.sections,
          db.performance,
          db.hobbies,
          db.notes,
          db.notifications,
          db.meta,
        ],
        async () => {
          await db.tasks.clear();
          await db.tasks.bulkAdd(backup.data.tasks);
          await db.logs.clear();
          await db.logs.bulkAdd(backup.data.logs);
          await db.sections.clear();
          await db.sections.bulkAdd(backup.data.sections);
          await db.performance.clear();
          await db.performance.bulkAdd(backup.data.performance);
          await db.hobbies.clear();
          await db.hobbies.bulkAdd(backup.data.hobbies);
          await db.notes.clear();
          await db.notes.bulkAdd(backup.data.notes);
          // The reminder queue is rebuilt from the restored tasks; carrying the
          // previous queue over would duplicate reminders and reference alarms
          // that belong to the old data.
          await db.notifications.clear();

          // Only the allowlisted settings are overwritten. Device facts such as
          // the notification permission and the rollover marker are left alone,
          // because they describe this phone, not the backup.
          for (const [key, value] of Object.entries(backup.data.settings.meta)) {
            await db.meta.put({ key, value });
          }
        },
      );
    } catch (err) {
      logError("import backup")(err);
      return {
        ok: false,
        safety,
        error:
          err instanceof Error
            ? `The import failed and your existing data was left unchanged. (${err.message})`
            : "The import failed and your existing data was left unchanged.",
      };
    }

    // 3. Preferences that live outside IndexedDB.
    try {
      const theme = backup.data.settings.theme;
      if (theme) localStorage.setItem("momentum:theme", theme);
    } catch {
      /* Storage may be unavailable — the import itself already succeeded. */
    }

    // 4. Re-hydrate through the normal boot pipeline. This is what makes the
    //    restore complete rather than merely written: recurring work reopens
    //    for today's date, today's performance snapshot is rebuilt, recovery
    //    days are reclassified, and the reminder queue is re-planned.
    try {
      bootPromise = null;
      await get().boot();
    } catch (err) {
      logError("reload after import")(err);
    }

    return { ok: true, counts, safety };
  },

  /* --------------------------- Notifications ------------------------- */

  syncNotifications: async () => {
    const s = get();
    const now = new Date();
    const { creates, updates } = planNotifications({
      now,
      tasks: s.tasks,
      logs: s.logs,
      sections: s.sections,
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

    // Skip the native round-trip when nothing changed. Stored records have
    // round-tripped through IndexedDB, so compare timestamps defensively.
    const same =
      tracked.length === nextRecords.length &&
      tracked.every(
        (t, i) =>
          t.key === nextRecords[i].key &&
          recordAtMs(t.at) === nextRecords[i].at.getTime(),
      );
    if (same) {
      devLog("native schedule unchanged", nextRecords.length);
      return;
    }

    const outcome = await resyncNative(tracked, nextRecords);
    await writeMetaValue("scheduledNotificationIds", nextRecords);
    devLog("native schedule synced", {
      count: nextRecords.length,
      scheduled: outcome.scheduled,
      warning: outcome.warning,
      error: outcome.error,
      keys: nextRecords.map((r) => r.key),
    });
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
    await get().refreshNotificationDiagnostics();
    devLog("permission requested", permission);
    return permission;
  },

  testNotification: async () => {
    const permission = await get().requestNotificationPermission();
    if (permission !== "granted") {
      const blocked: TestNotificationResult = {
        ok: false,
        reason: "permission",
        message:
          "Notifications are blocked for Momentum. Enable them in Android settings → Apps → Momentum → Notifications, then try again.",
      };
      set({ lastTestNotification: blocked });
      return blocked;
    }
    const result = await sendTestNotification();
    set({ lastTestNotification: result });
    void get().refreshNotificationDiagnostics();
    return result;
  },

  /**
   * Snapshot the native pipeline: permission, channel, exact-alarm access and
   * what Android actually has queued. Diagnostics only — never a gate.
   */
  refreshNotificationDiagnostics: async () => {
    const diagnostics = await getNativeDiagnostics();
    set({ notificationDiagnostics: diagnostics });
    if (diagnostics.permission !== get().notificationPermission) {
      set({ notificationPermission: diagnostics.permission });
      await writeMetaValue("notificationPermissionState", diagnostics.permission);
    }
  },

  requestExactAlarmAccess: async () => {
    await openExactAlarmSettings();
    await get().refreshNotificationDiagnostics();
    // Precision changed, so the pending alarms are rebuilt with the new mode.
    await get().syncNativeNotifications();
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