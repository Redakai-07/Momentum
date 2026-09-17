import { create } from "zustand";
import { db } from "./db";
import { dateKey, todayKey } from "./date";
import { uid } from "./utils";
import { liveDayRec } from "./performance";
import { applyRecoveryKinds } from "./activity";
import { COOLDOWN_OPTIONS, NOTIFICATION_DEFAULTS } from "./config";
import { planNotifications, notificationMessage } from "./notifications/engine";
import {
  planDayReminder,
  isQuietHours,
  nextOutsideQuiet,
  type DecisionContext,
} from "./notifications/decision";
import {
  DEFAULT_FOCUS_SETTINGS,
  advancePhase,
  clampFocusSettings,
  focusMinutesWorked,
  isPhaseComplete,
  normalizeSession,
  pauseSession,
  phaseLabel,
  remainingMs,
  resumeSession,
  startSession,
  type FocusPhase,
  type FocusSession,
  type FocusSettings,
} from "./focus";
import { remainingMinutesOf } from "./duration";
import { playFocusTransitionSound, primeFocusSound } from "./focus-sound";
import {
  checkPermission,
  requestPermission,
  resyncNative,
  onNativeNotification,
  nativeAvailable,
  nativeIdForKey,
  ensureChannel,
  refreshExactAlarmState,
  scheduleRecords,
  cancelNative,
  requestExactAlarmAccess as openExactAlarmSettings,
  getNativeDiagnostics,
  sendTestNotification,
  sendWelcomeNotification,
  showWebNotification,
  type NativeNotifRecord,
  type NativeDiagnostics,
  type TestNotificationResult,
} from "./notifications/service";
import { notifKey, type TaskNotification, type NotificationSettings } from "./notifications/types";
import { canAccomplish, isTaskDone, isTaskDoneOn, rolloverTasks, toAccomplished } from "./task-state";
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
  /**
   * taskId → ISO of the last reminder sent about it. Lets the engine avoid
   * pointing two reminders in one day at the same task. Persisted, so the
   * guard survives restarts instead of resetting on every launch.
   */
  lastReminderByTask?: Record<string, string>;
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
  /** Development aid: why today's task reminder is or is not planned. */
  notificationDecision: DecisionDiagnostics | null;
  /** Result of the most recent "Test notification" tap. */
  lastTestNotification: TestNotificationResult | null;
  /** Display name shown in the greeting and on the profile (persisted in meta). */
  profileName: string;
  /** When the user last exported a backup (persisted in meta), or null. */
  lastBackupAt: string | null;
  /** Active Pomodoro session, or null. Rebuilt from timestamps, never a tick count. */
  focusSession: FocusSession | null;
  /**
   * Whether focus mode is occupying the screen. Session *state* is separate:
   * minimising shows the app while the timer keeps running, so this is UI, not
   * progress, and deliberately not persisted.
   */
  focusScreenOpen: boolean;
  /** Focus/break lengths — user-configurable, persisted in meta. */
  focusSettings: FocusSettings;
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
  /** Rebuild the day's native reminder alarms now (used by the diagnostics panel). */
  rescheduleNotifications: () => Promise<DecisionDiagnostics | null>;
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

  /* Focus (Pomodoro) — an optional way to work a duration-based task. */
  /** Begin a focus phase for a timed task. No-op for completion-based work. */
  startFocus: (taskId: string, focusMinutes?: number) => void;
  pauseFocus: () => void;
  resumeFocus: () => void;
  /** End the session, banking whatever focus time was actually done. */
  stopFocus: () => void;
  /** End the current phase early and move to the next one. */
  skipFocusPhase: () => void;
  /** Called by the UI on a display tick; banks and advances a finished phase. */
  syncFocus: () => void;
  setFocusSettings: (patch: Partial<FocusSettings>) => void;
  /** Take over the screen with the running session. */
  openFocusScreen: () => void;
  /** Step back to the app; the session keeps running in the banner. */
  minimizeFocusScreen: () => void;
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
  const [
    lastNotificationAt,
    lastMeaningfulActivityAt,
    lastTaskCompletionAt,
    lastInteractionAt,
    lastReminderByTask,
  ] = await Promise.all([
    readMetaValue<string>("lastNotificationAt"),
    readMetaValue<string>("lastMeaningfulActivityAt"),
    readMetaValue<string>("lastTaskCompletionAt"),
    readMetaValue<string>("lastInteractionAt"),
    readMetaValue<Record<string, string>>("lastReminderByTask"),
  ]);
  return {
    lastNotificationAt,
    lastMeaningfulActivityAt,
    lastTaskCompletionAt,
    lastInteractionAt,
    lastReminderByTask,
  };
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

/** Persisted anchor for today's ordinary nudge, so it cannot drift. */
interface OrdinaryPlan {
  date: string;
  at: string;
}

/** Catch-up lead: a cue whose moment already passed fires this much later. */
const CATCHUP_LEAD_MINUTES = 15;

/**
 * Earliest moment a *missed* cue may still be delivered, or null when the day
 * has no non-quiet time left. Without this, a cue whose scheduled time had
 * already passed when the app was next opened (the common case — a due-today
 * task seen at 15:00, an alarm that fired while the app was closed) was simply
 * dropped and never reached the user.
 */
function catchupSlot(now: Date, settings: NotificationSettings): Date | null {
  const today = dateKey(now);
  const slot = nextOutsideQuiet(
    settings,
    new Date(now.getTime() + CATCHUP_LEAD_MINUTES * 60_000),
  );
  return dateKey(slot) === today ? slot : null;
}

interface BuiltSchedule {
  records: NativeNotifRecord[];
  /** Stable fire time for today's ordinary nudge (null when none today). */
  ordinaryAt: Date | null;
}

/**
 * Build the native schedule: per-task cues from the in-app queue (filtered
 * through quiet hours + completion cooldown) plus the day's ordinary nudge.
 * Deterministic + deduped.
 *
 * Every record here is a real `AlarmManager` alarm, so delivery does not
 * depend on the WebView staying alive — that is the whole point. The day
 * planner (`planDayReminder`) decides *whether* today deserves a nudge and
 * from when; `storedOrdinary` keeps that moment fixed across syncs so it
 * cannot slide forward on every app open.
 */
function buildNativeSchedule(
  get: GetFn,
  now: Date,
  storedOrdinary: OrdinaryPlan | null,
): BuiltSchedule {
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

  // Collect candidate reminders from both newly planned creates and existing
  // scheduled / snoozed records.
  const candidates = new Map<
    string,
    { taskId: string; type: TaskNotification["type"]; date: string; scheduledAt: string; snoozedUntil?: string; status?: string }
  >();

  for (const c of creates) {
    candidates.set(notifKey(c), c);
  }
  for (const n of s.notifications) {
    if ((n.status === "scheduled" || n.status === "snoozed") && n.date === today) {
      candidates.set(notifKey(n), n);
    }
  }

  for (const item of candidates.values()) {
    let fireAt = new Date(
      item.status === "snoozed" && item.snoozedUntil ? item.snoozedUntil : item.scheduledAt,
    );

    const task = s.tasks.find((t) => t.id === item.taskId);
    if (!task || task.status !== "active") continue;
    if (isTaskDoneOn(task, today)) continue;

    // The moment already passed while the app was closed (or the cue belongs to
    // an earlier slot today). Still-valid work is re-armed for later today
    // instead of being silently dropped — that drop was why nothing arrived.
    if (fireAt.getTime() <= now.getTime()) {
      if (item.date !== today) continue;
      const slot = catchupSlot(now, settings);
      if (!slot) continue;
      fireAt = slot;
    }

    // Ordinary reminders: quiet hours + breathing room after activity.
    if (isOrdinaryType(item.type)) {
      if (isQuietHours(fireAt, settings)) continue;
      const recentActivity = Math.min(
        minutesSince(s.notificationMeta.lastMeaningfulActivityAt, now),
        minutesSince(s.notificationMeta.lastTaskCompletionAt, now),
      );
      if (recentActivity < settings.completionCooldownMinutes) continue;
    }

    const body =
      item.type === "next_task"
        ? task.nextAction
          ? `Next: ${task.nextAction}`
          : notificationMessage(item, task.title)
        : notificationMessage(item, task.title);

    records.push({
      id: nativeIdForKey(`${item.taskId}:${item.type}:${item.date}`),
      key: `${item.taskId}:${item.type}:${item.date}`,
      title: task.title,
      body,
      at: fireAt,
    });
  }

  /* Day-level ordinary nudge. */
  // The planner answers "does today deserve a reminder, and from when?" — a
  // question whose answer does not depend on whether the app happens to be open
  // at this instant (see planDayReminder for why that distinction mattered).
  const decisionCtx: DecisionContext = {
    now,
    tasks: s.tasks,
    logs: s.logs,
    sections: s.sections,
    settings,
    lastNotificationAt: s.notificationMeta.lastNotificationAt,
    lastMeaningfulActivityAt: s.notificationMeta.lastMeaningfulActivityAt,
    lastTaskCompletionAt: s.notificationMeta.lastTaskCompletionAt,
    lastInteractionAt: s.notificationMeta.lastInteractionAt,
    lastReminderByTask: s.notificationMeta.lastReminderByTask,
  };
  const plan = planDayReminder(decisionCtx);

  let ordinaryAt: Date | null = null;
  // Priority deliberately does not gate this. An overdue or due-today task is
  // exactly the case that must still reach the user when the app is closed, and
  // the in-app queue cannot cover it: its cue is stamped "delivered" the moment
  // its time has passed while the app is open, so it is no longer a native
  // candidate. The day plan is the one alarm per day that always gets armed.
  if (plan.eligible && plan.earliest && plan.task) {
    // Keep the previously agreed moment so it stays put across syncs, but move
    // it forward when reality (new activity, a delivered notification) has
    // invalidated it. A plan from another day is simply stale.
    const stored = storedOrdinary?.date === today ? new Date(storedOrdinary.at) : null;
    const storedValid = stored && Number.isFinite(stored.getTime()) ? stored : null;
    ordinaryAt =
      storedValid && storedValid.getTime() > plan.earliest.getTime()
        ? storedValid
        : plan.earliest;

    if (ordinaryAt.getTime() > now.getTime() && !isQuietHours(ordinaryAt, settings)) {
      records.push({
        id: nativeIdForKey(`ordinary:${today}`),
        key: `ordinary:${today}`,
        title: plan.task.title,
        body: plan.message ?? "You still have planned work waiting.",
        at: ordinaryAt,
      });
    } else {
      ordinaryAt = null;
    }
  }

  return { records: records.sort((a, b) => a.at.getTime() - b.at.getTime()), ordinaryAt };
}

const devLog = (msg: string, data?: unknown) => {
  if (process.env.NODE_ENV !== "production") {
    console.debug(`[notifications] ${msg}`, data ?? "");
  }
};

/* ------------------------------------------------------------------ */
/* Focus (Pomodoro) helpers                                            */
/* ------------------------------------------------------------------ */

/**
 * Credit finished focus time to the task.
 *
 * Routed through the ordinary `logTime` action on purpose: a Pomodoro is a way
 * of working on a task, not a parallel accounting system, so the minutes land
 * in the same `logs` table and flow into performance, streaks and remaining
 * time exactly like hand-logged time.
 */
function bankFocusTime(
  get: GetFn,
  session: FocusSession,
  settings: FocusSettings,
  now: number,
): void {
  const minutes = focusMinutesWorked(session, settings, now);
  if (minutes <= 0) return;
  devLog("focus banked", { taskId: session.taskId, minutes, date: session.date });
  // Logged against the day the work actually happened, so a session that ran
  // past midnight does not credit yesterday's effort to today.
  get().logTime(session.taskId, minutes, session.date);
}

/** Stable alarm id per session + phase, so re-arming never stacks alarms. */
function focusAlarmId(session: FocusSession): number {
  return nativeIdForKey(`focus:${session.id}:${session.phase}`);
}

/**
 * Hand the phase's end to Android.
 *
 * This is the reason the timer survives the screen locking: the transition is
 * an `AlarmManager` alarm, not a JavaScript timer, so it fires even if the
 * WebView has been suspended for the whole phase.
 */
async function armFocusAlarm(session: FocusSession, settings: FocusSettings): Promise<void> {
  if (!nativeAvailable() || session.status !== "running") return;
  const remaining = remainingMs(session, settings);
  const at = new Date(Date.now() + remaining);
  if (at.getTime() <= Date.now() + 1000) return;
  await ensureChannel();
  await scheduleRecords([
    {
      id: focusAlarmId(session),
      key: `focus:${session.id}:${session.phase}`,
      title: session.phase === "focus" ? "Focus complete" : "Break over",
      body:
        session.phase === "focus"
          ? "Nice work. Step away for a moment."
          : "Ready for the next focus session?",
      at,
    },
  ]);
}

/**
 * End any session belonging to `taskId`, banking its focus time first.
 *
 * Used when the task is completed or deleted out from under a running timer:
 * the session must not outlive its task, and the minutes already spent are
 * still the user's.
 */
function endFocusForTask(get: GetFn, set: SetFn, taskId: string): void {
  const s = get();
  const session = s.focusSession;
  if (!session || session.taskId !== taskId) return;
  bankFocusTime(get, session, { ...s.focusSettings, focusMinutes: session.focusMinutes }, Date.now());
  void disarmFocusAlarm(session);
  void writeMetaValue("focusSession", null);
  set({ focusSession: null, focusScreenOpen: false });
}

async function disarmFocusAlarm(session: FocusSession): Promise<void> {
  if (!nativeAvailable()) return;
  await cancelNative([focusAlarmId(session)]);
}

/**
 * Tell the user a phase ended.
 *
 * On a native platform Android's own alarm is the delivery mechanism, so this
 * only fills the gap on the web build — announcing it twice would be noise.
 */
function showFocusTransition(finished: FocusPhase, next: FocusPhase): void {
  if (finished === "focus" || next === "focus") {
    playFocusTransitionSound(next);
  }
  if (nativeAvailable()) return;
  const title = finished === "focus" ? "Focus complete" : "Break over";
  const body =
    finished === "focus"
      ? `${phaseLabel(next)} — step away for a moment.`
      : `${phaseLabel(next)} — ready when you are.`;
  void showWebNotification(title, { body });
}

/** Plain-English answer to "why did (or didn't) today get a reminder?". */
export interface DecisionDiagnostics {
  eligible: boolean;
  reason: string;
  explanation: string;
  /** Task the nudge would point at, when there is one. */
  taskTitle: string | null;
  /** When today's nudge is set to fire, or null when none is planned. */
  plannedAt: string | null;
  /** Stable alarm id for the planned nudge — the id Android holds. */
  scheduledId: number | null;
  pendingNativeCount: number;
  nextPendingAt: string | null;
}

const REASON_COPY: Record<string, string> = {
  notifications_disabled: "Task reminders are switched off for this app.",
  no_tasks: "Nothing is scheduled for today.",
  all_done: "Everything planned for today is done.",
  no_next_step: "There is no open task worth a nudge.",
  already_notified: "This task was already reminded about today.",
  quiet_hours: "Quiet hours leave no room left today.",
  normal_remaining: "Planned work is still outstanding.",
  next_action: "An open task carries a next action.",
  overdue_task: "A task is overdue.",
  special_task: "A task is due today.",
  high_duration: "A large task is still outstanding.",
  global_cooldown: "Waiting out the notification cooldown.",
  recent_activity: "Backing off after recent activity.",
  no_gap_yet: "Waiting for enough of a gap since the last activity.",
};

/**
 * Describe the day's notification plan from the live state.
 *
 * It deliberately recomputes the plan (rather than reading the persisted one)
 * so the report stays truthful even before the next sync runs.
 */
function describeDayPlan(
  s: MomentumState,
  native: NativeDiagnostics,
): DecisionDiagnostics {
  const now = new Date();
  const plan = planDayReminder({
    now,
    tasks: s.tasks,
    logs: s.logs,
    sections: s.sections,
    settings: s.notificationSettings,
    lastNotificationAt: s.notificationMeta.lastNotificationAt,
    lastMeaningfulActivityAt: s.notificationMeta.lastMeaningfulActivityAt,
    lastTaskCompletionAt: s.notificationMeta.lastTaskCompletionAt,
    lastInteractionAt: s.notificationMeta.lastInteractionAt,
    lastReminderByTask: s.notificationMeta.lastReminderByTask,
  });

  const pending = [...native.pending]
    .filter((p) => p.at)
    .sort((a, b) => (a.at! < b.at! ? -1 : 1));
  const scheduled = plan.eligible && plan.earliest
    ? nativeIdForKey(`ordinary:${dateKey(now)}`)
    : null;

  return {
    eligible: plan.eligible,
    reason: plan.reason,
    explanation: REASON_COPY[plan.reason] ?? plan.reason,
    taskTitle: plan.task?.title ?? null,
    plannedAt: plan.earliest ? plan.earliest.toISOString() : null,
    scheduledId: scheduled,
    pendingNativeCount: native.pendingCount,
    nextPendingAt: pending[0]?.at ?? null,
  };
}

/**
 * Trigger a one-time welcome notification as soon as the user grants notification permissions.
 */
async function triggerWelcomeNotificationOnce(): Promise<void> {
  try {
    const alreadySent = await readMetaValue<boolean>("welcomeNotificationSent");
    if (!alreadySent) {
      await writeMetaValue("welcomeNotificationSent", true);
      await sendWelcomeNotification();
    }
  } catch (err) {
    console.warn("Momentum: failed to trigger welcome notification", err);
  }
}

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

  // Focus state lives in meta (no schema change) and is repaired against the
  // wall clock on load, so a session interrupted by a process kill or a reboot
  // resumes with the right amount of time left instead of a frozen counter.
  const storedFocus = await readMetaValue<FocusSession>("focusSession");
  const focusSession = normalizeSession(storedFocus);
  const focusSettings = clampFocusSettings(
    await readMetaValue<Partial<FocusSettings>>("focusSettings"),
  );

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
    focusSession,
    focusSettings,
  });

  // An interrupted session is re-armed against the clock (and re-scheduled with
  // Android if it is still running), so the alarm can never be left behind.
  if (focusSession) {
    const sessionSettings = focusSession
      ? { ...focusSettings, focusMinutes: focusSession.focusMinutes }
      : focusSettings;
    if (focusSession.date !== today || isPhaseComplete(focusSession, sessionSettings)) {
      // Settle it now: either its clock already ran out while the app was
      // closed, or it belongs to an earlier day and must not keep running.
      void get().syncFocus();
    } else if (focusSession.status === "running") {
      void armFocusAlarm(focusSession, sessionSettings);
    }
  }

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
      if (granted === "granted") {
        void triggerWelcomeNotificationOnce();
      }
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
  notificationDecision: null,
  lastTestNotification: null,
  focusSession: null,
  focusScreenOpen: false,
  focusSettings: DEFAULT_FOCUS_SETTINGS,
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
    endFocusForTask(get, set, id);
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

    // Completing the task ends any focus session on it. Banked first, so the
    // minutes worked are never thrown away with the session.
    if (done) endFocusForTask(get, set, id);

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

    // Everything that just crossed into "delivered" — used both to record the
    // per-task dedupe stamp and to post web notifications.
    const newlyDelivered = [
      ...updates.filter(
        (u) =>
          u.status === "delivered" &&
          s.notifications.find((x) => x.id === u.id)?.status !== "delivered",
      ),
      ...stamped.filter((d) => d.status === "delivered"),
    ];

    // Remember what the user was just told about, so one task never attracts
    // two reminders on the same day. Persisted, so it survives a restart.
    if (newlyDelivered.length > 0) {
      const iso = new Date().toISOString();
      const byTask = { ...(s.notificationMeta.lastReminderByTask ?? {}) };
      for (const n of newlyDelivered) byTask[n.taskId] = iso;
      const meta = { ...get().notificationMeta, lastReminderByTask: byTask };
      void writeMetaValue("lastReminderByTask", byTask);
      set({ notificationMeta: meta });
    }

    // On web environments, show external browser notifications for newly delivered cues
    if (!nativeAvailable()) {
      for (const n of newlyDelivered) {
        const task = s.tasks.find((t) => t.id === n.taskId);
        if (task) {
          const body =
            n.type === "next_task"
              ? task.nextAction
                ? `Next: ${task.nextAction}`
                : notificationMessage(n, task.title)
              : notificationMessage(n, task.title);
          void showWebNotification(task.title, { body });
        }
      }
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

    const storedOrdinary =
      (await readMetaValue<OrdinaryPlan>("ordinaryReminderPlan")) ?? null;
    const { records, ordinaryAt } = buildNativeSchedule(get, now, storedOrdinary);
    const nextRecords = records.slice(0, 12); // keep the meaningful few

    // Anchor today's nudge so it fires at the same moment no matter how often
    // the app is opened. This is what turns "the app happened to be open" into
    // "Android will wake up and tell the user".
    if (ordinaryAt) {
      const plan: OrdinaryPlan = { date: dateKey(now), at: ordinaryAt.toISOString() };
      if (storedOrdinary?.date !== plan.date || storedOrdinary?.at !== plan.at) {
        await writeMetaValue("ordinaryReminderPlan", plan);
      }
    } else if (storedOrdinary && storedOrdinary.date !== dateKey(now)) {
      await writeMetaValue("ordinaryReminderPlan", null);
    }

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

  /* ------------------------------- Focus ------------------------------ */

  startFocus: (taskId, focusMinutes) => {
    const s = get();
    const task = s.tasks.find((t) => t.id === taskId);
    // Pomodoro is a way of working on *timed* tasks. Completion-based work has
    // no minutes to fill, so it stays a simple pending → done toggle.
    if (!task || !isTimedTask(task) || isTaskDone(task)) return;
    const now = Date.now();
    const selectedMinutes = focusMinutes === undefined
      ? s.focusSettings.focusMinutes
      : Math.max(1, Math.min(120, Math.round(focusMinutes)));
    const blocksInSession = Math.max(1, Math.ceil(remainingMinutesOf(task) / selectedMinutes));
    const session = startSession(taskId, now, uid(), selectedMinutes, blocksInSession);
    primeFocusSound();
    void writeMetaValue("focusSession", session);
    // Starting a block takes over the screen: a Pomodoro is a mode, not a widget.
    set({ focusSession: session, focusScreenOpen: true });
    void armFocusAlarm(session, { ...s.focusSettings, focusMinutes: session.focusMinutes });
    devLog("focus started", { taskId, phase: session.phase });
  },

  pauseFocus: () => {
    const session = get().focusSession;
    if (!session || session.status === "paused") return;
    const next = pauseSession(session, Date.now());
    void writeMetaValue("focusSession", next);
    set({ focusSession: next });
    // A held clock must not fire a "focus finished" alarm.
    void disarmFocusAlarm(session);
  },

  resumeFocus: () => {
    const s = get();
    const session = s.focusSession;
    if (!session || session.status === "running") return;
    const next = resumeSession(session, Date.now());
    void writeMetaValue("focusSession", next);
    set({ focusSession: next });
    void armFocusAlarm(next, { ...s.focusSettings, focusMinutes: session.focusMinutes });
  },

  stopFocus: () => {
    const s = get();
    const session = s.focusSession;
    if (!session) return;
    const now = Date.now();
    // Bank the work before tearing the session down — stopping early must
    // never throw away minutes the user actually spent.
    const sessionSettings = { ...s.focusSettings, focusMinutes: session.focusMinutes };
    bankFocusTime(get, session, sessionSettings, now);
    void disarmFocusAlarm(session);
    void writeMetaValue("focusSession", null);
    set({ focusSession: null, focusScreenOpen: false });
    devLog("focus stopped");
  },

  skipFocusPhase: () => {
    const s = get();
    const session = s.focusSession;
    if (!session) return;
    const now = Date.now();
    const sessionSettings = { ...s.focusSettings, focusMinutes: session.focusMinutes };
    bankFocusTime(get, session, sessionSettings, now);
    void disarmFocusAlarm(session);
    const next = advancePhase({ ...session, status: "running" }, sessionSettings, now);
    void writeMetaValue("focusSession", next);
    set({ focusSession: next });
    void armFocusAlarm(next, sessionSettings);
  },

  /**
   * Reconcile the session with the wall clock.
   *
   * The UI calls this on a display tick, but correctness does not depend on
   * that cadence: a phase that finished while the app was suspended is banked
   * and advanced the first time this runs afterwards.
   */
  syncFocus: () => {
    const s = get();
    const session = s.focusSession;
    if (!session) return;
    const now = Date.now();
    // A session dated yesterday is stale — it must not silently keep running.
    if (session.date !== todayKey()) {
      // Crossed midnight. Bank the work against the day it happened and end the
      // session — silently carrying it into a new day would inflate the wrong
      // day's performance and confuse the block count.
      bankFocusTime(get, session, { ...s.focusSettings, focusMinutes: session.focusMinutes }, now);
      void disarmFocusAlarm(session);
      void writeMetaValue("focusSession", null);
      set({ focusSession: null, focusScreenOpen: false });
      devLog("focus session ended at day boundary", { date: session.date });
      return;
    }
    if (session.status !== "running") return;
    const sessionSettings = { ...s.focusSettings, focusMinutes: session.focusMinutes };
    if (!isPhaseComplete(session, sessionSettings, now)) return;

    const finished = session.phase;
    bankFocusTime(get, session, sessionSettings, now);
    void disarmFocusAlarm(session);
    // Advance past the completed phase — both focus and breaks roll forward, so
    // a finished break drops the user back into a fresh focus phase.
    const next = advancePhase(session, sessionSettings, now);
    void writeMetaValue("focusSession", next);
    set({ focusSession: next });
    void armFocusAlarm(next, sessionSettings);
    void showFocusTransition(finished, next.phase);
  },

  setFocusSettings: (patch) => {
    const next = clampFocusSettings({ ...get().focusSettings, ...patch });
    void writeMetaValue("focusSettings", next);
    set({ focusSettings: next });
  },

  openFocusScreen: () => {
    if (!get().focusSession) return;
    set({ focusScreenOpen: true });
  },

  minimizeFocusScreen: () => set({ focusScreenOpen: false }),

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
      // Rebuild the task queue before arming native alarms. This matters when
      // permission is granted for the first time: assigned tasks may not have
      // existed in the queue when boot initially ran without permission.
      await get().syncNotifications();
      await get().syncNativeNotifications();
      void triggerWelcomeNotificationOnce();
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
   * what Android actually has queued, plus the *decision* behind the day's
   * nudge. Diagnostics only — never a gate.
   *
   * This exists so "why did I not get a notification?" has an answer that is
   * read rather than guessed at.
   */
  refreshNotificationDiagnostics: async () => {
    const diagnostics = await getNativeDiagnostics();
    set({ notificationDiagnostics: diagnostics });
    if (diagnostics.permission !== get().notificationPermission) {
      set({ notificationPermission: diagnostics.permission });
      await writeMetaValue("notificationPermissionState", diagnostics.permission);
    }
    set({ notificationDecision: describeDayPlan(get(), diagnostics) });
  },

  requestExactAlarmAccess: async () => {
    await openExactAlarmSettings();
    await get().refreshNotificationDiagnostics();
    // Precision changed, so the pending alarms are rebuilt with the new mode.
    await get().syncNativeNotifications();
  },

  /**
   * Force a rebuild of the native alarm queue and report the outcome.
   *
   * Android\u2019s queue is the thing that actually wakes the device, so being
   * able to say "here is what is armed, and why" is the difference between
   * debugging notifications and guessing at them.
   */
  rescheduleNotifications: async () => {
    await get().syncNotifications();
    await get().syncNativeNotifications();
    await get().refreshNotificationDiagnostics();
    return get().notificationDecision;
  },

  refreshNotificationPermission: async () => {
    const permission = await checkPermission();
    await writeMetaValue("notificationPermissionState", permission);
    set({ notificationPermission: permission });
    if (permission === "granted") {
      await get().syncNotifications();
      await get().syncNativeNotifications();
      void triggerWelcomeNotificationOnce();
    }
    await get().refreshNotificationDiagnostics();
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