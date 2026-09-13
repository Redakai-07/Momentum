import { Capacitor } from "@capacitor/core";
import {
  LocalNotifications,
  type LocalNotificationSchema,
  type PermissionStatus,
} from "@capacitor/local-notifications";

/**
 * Thin wrapper around Capacitor Local Notifications.
 *
 * This module ONLY talks to the native layer — it decides nothing. The
 * decision engine (./decision.ts) answers "should a notification happen?",
 * the in-app queue (./engine.ts) manages reminders, and this service just
 * delivers them as real Android/iOS notifications, fully offline.
 *
 * ## Why alarms are scheduled as *inexact* by default
 *
 * Capacitor's plugin defaults `isExactNotification` to `true`. On Android 12+
 * that makes `schedule()` refuse to schedule whenever the app lacks the
 * special `SCHEDULE_EXACT_ALARM` access, and instead launch the system
 * "Alarms & reminders" screen — so no notification is ever posted. Since
 * Android 14 that access is *denied by default* for apps targeting API 33+,
 * which meant Momentum scheduled nothing at all.
 *
 * Momentum therefore asks for inexact alarms, which need no special access and
 * are delivered reliably by `AlarmManager` (within a short system-defined
 * window). If the user has already granted exact-alarm access we upgrade to
 * exact for sharper timing — but delivery never depends on it.
 */

const CHANNEL_ID = "momentum-reminders";
const CHANNEL_NAME = "Momentum reminders";
const CHANNEL_DESCRIPTION = "Task cues and progress nudges from Momentum";

/** How far ahead a notification may bypass Doze (Android caps this at 9 min/idle). */
const IDLE_WINDOW_MS = 60 * 60_000;

export interface NativeNotifSpec {
  /** Stable positive integer id — must fit in a 32-bit signed int. */
  id: number;
  title: string;
  body: string;
  /** When the notification should fire (future Date). */
  at: Date;
}

export interface NativeNotifRecord extends NativeNotifSpec {
  /** Logical dedupe identity, e.g. "task:dsa:start:2026-03-11". */
  key: string;
}

export type ExactAlarmState = "granted" | "denied" | "unknown";

/** Result of a native scheduling attempt — never silently swallowed. */
export interface ScheduleOutcome {
  scheduled: number;
  /** Non-fatal plugin warning (e.g. downgraded to an inexact alarm). */
  warning?: string;
  /** Fatal error message when the platform refused the call. */
  error?: string;
}

export function nativeAvailable(): boolean {
  if (typeof window === "undefined") return false;
  return Capacitor.isNativePlatform();
}

/* ------------------------------------------------------------------ */
/* Permission                                                          */
/* ------------------------------------------------------------------ */

/** Check the current permission state (no dialogs). */
export async function checkPermission(): Promise<PermissionStatus["display"]> {
  if (!nativeAvailable()) return "granted"; // web never blocks
  try {
    const p = await LocalNotifications.checkPermissions();
    return p.display;
  } catch {
    return "denied";
  }
}

/** Ask for notification permission (Android shows the system dialog). */
export async function requestPermission(): Promise<PermissionStatus["display"]> {
  if (!nativeAvailable()) return "granted";
  try {
    const p = await LocalNotifications.requestPermissions();
    return p.display;
  } catch {
    return "denied";
  }
}

/** Whether the OS will actually show Momentum notifications right now. */
export async function notificationsEnabled(): Promise<boolean> {
  return (await checkPermission()) === "granted";
}

/* ------------------------------------------------------------------ */
/* Exact-alarm setting (Android 12+) — an optimisation, never a gate    */
/* ------------------------------------------------------------------ */

let exactAlarmState: ExactAlarmState = "unknown";

/** Re-read the system exact-alarm setting (cheap, local, shows no dialog). */
export async function refreshExactAlarmState(): Promise<ExactAlarmState> {
  if (!nativeAvailable()) {
    exactAlarmState = "granted";
    return exactAlarmState;
  }
  try {
    const res = await LocalNotifications.checkExactNotificationSetting();
    exactAlarmState = res.exact_alarm === "granted" ? "granted" : "denied";
  } catch {
    exactAlarmState = "unknown";
  }
  return exactAlarmState;
}

export function exactAlarmStateCached(): ExactAlarmState {
  return exactAlarmState;
}

/**
 * Open the system "Alarms & reminders" screen so the user can grant precise
 * timing. Delivery works without it — this only sharpens the schedule.
 */
export async function requestExactAlarmAccess(): Promise<ExactAlarmState> {
  if (!nativeAvailable()) return "granted";
  try {
    const res = await LocalNotifications.changeExactNotificationSetting();
    exactAlarmState = res.exact_alarm === "granted" ? "granted" : "denied";
  } catch {
    /* user may have cancelled — fall through to a fresh read */
    await refreshExactAlarmState();
  }
  return exactAlarmState;
}

/* ------------------------------------------------------------------ */
/* Channel                                                             */
/* ------------------------------------------------------------------ */

let channelReady = false;

/**
 * Ensure the Android notification channel exists. Idempotent and memoised so
 * every scheduling path can simply await it. Android channels are immutable
 * after creation — a channel created by an older build keeps its original
 * importance, which is why diagnostics surface what the OS reports.
 */
export async function ensureChannel(): Promise<boolean> {
  if (!nativeAvailable()) return false;
  if (channelReady) return true;
  try {
    await LocalNotifications.createChannel({
      id: CHANNEL_ID,
      name: CHANNEL_NAME,
      description: CHANNEL_DESCRIPTION,
      importance: 4, // IMPORTANCE_HIGH — heads-up + sound
      visibility: 1, // VISIBILITY_PUBLIC — show on the lock screen
      vibration: true,
      lights: true,
    });
    channelReady = true;
    return true;
  } catch (err) {
    console.error("Momentum: failed to create the notification channel:", err);
    return false;
  }
}

export function channelId(): string {
  return CHANNEL_ID;
}

/* ------------------------------------------------------------------ */
/* Scheduling                                                          */
/* ------------------------------------------------------------------ */

/** Stable 31-bit id derived from a logical key (same key → same id). */
export function nativeIdForKey(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 0x7fffffff;
}

/**
 * Map an internal record onto the Capacitor notification schema.
 *
 * Exported (and parameterised) so the delivery-critical settings are covered
 * by tests: `isExactNotification` must stay `false` unless the user has
 * *already* granted exact-alarm access. Leaving the plugin default (`true`)
 * makes Android 12+ divert `schedule()` into the system "Alarms & reminders"
 * screen instead of posting the notification — the bug this guards.
 */
export function notificationSchema(
  n: NativeNotifRecord,
  exact: ExactAlarmState = exactAlarmState,
  now: number = Date.now(),
): LocalNotificationSchema {
  return {
    id: n.id,
    title: n.title,
    body: n.body,
    schedule: {
      at: n.at,
      // Bypass Doze only for imminent reminders; further-out alarms ride the
      // normal window so Android's once-per-9-minutes idle cap never delays them.
      allowWhileIdle: n.at.getTime() - now < IDLE_WINDOW_MS,
    },
    channelId: CHANNEL_ID,
    // Exact only when the user already granted it — otherwise inexact, which
    // is always delivered and never triggers the "Alarms & reminders" detour.
    isExactNotification: exact === "granted",
    isExactMandatory: false,
  };
}

/** Schedule a batch of records. Awaits the channel so delivery can't race it. */
export async function scheduleRecords(records: NativeNotifRecord[]): Promise<ScheduleOutcome> {
  if (!nativeAvailable()) return { scheduled: 0, error: "not a native platform" };
  if (records.length === 0) return { scheduled: 0 };

  await ensureChannel();

  // Only schedule notifications that are still meaningfully in the future.
  const future = records.filter((n) => n.at.getTime() > Date.now() + 30_000);
  if (future.length === 0) return { scheduled: 0 };

  try {
    const res = await LocalNotifications.schedule({
      notifications: future.map((n) => notificationSchema(n)),
    });
    return {
      scheduled: res.notifications?.length ?? future.length,
      warning: res.warning?.message,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Momentum: failed to schedule local notifications:", err);
    return { scheduled: 0, error: message };
  }
}

/** Cancel a set of previously scheduled notifications by id. */
export async function cancelNative(ids: number[]): Promise<void> {
  if (!nativeAvailable() || ids.length === 0) return;
  try {
    await LocalNotifications.cancel({ notifications: ids.map((id) => ({ id })) });
  } catch {
    /* plugin may not be registered on web — ignore */
  }
}

/** Replace the scheduled set: cancel what is tracked, then schedule `next`. */
export async function resyncNative(
  tracked: NativeNotifRecord[],
  next: NativeNotifRecord[],
): Promise<ScheduleOutcome> {
  if (!nativeAvailable()) return { scheduled: 0 };
  await cancelNative(tracked.map((t) => t.id));

  const nowKeys = new Set<string>();
  const deduped: NativeNotifRecord[] = [];
  for (const n of next) {
    if (nowKeys.has(n.key)) continue; // never twice the same logical reminder
    nowKeys.add(n.key);
    deduped.push(n);
  }

  return scheduleRecords(deduped);
}

/* ------------------------------------------------------------------ */
/* Diagnostics                                                         */
/* ------------------------------------------------------------------ */

export interface PendingNotificationInfo {
  id: number;
  title: string;
  body: string;
  at?: string;
}

export interface NativeDiagnostics {
  platform: "native" | "web";
  channelId: string;
  channelReady: boolean;
  channelRegistered: boolean;
  permission: string;
  exactAlarm: ExactAlarmState;
  pending: PendingNotificationInfo[];
  pendingCount: number;
}

/**
 * Development aid: a truthful snapshot of the notification pipeline, so a
 * missing notification can be explained instead of guessed at.
 */
export async function getNativeDiagnostics(): Promise<NativeDiagnostics> {
  const diag: NativeDiagnostics = {
    platform: nativeAvailable() ? "native" : "web",
    channelId: CHANNEL_ID,
    channelReady,
    channelRegistered: false,
    permission: "granted",
    exactAlarm: exactAlarmState,
    pending: [],
    pendingCount: 0,
  };
  if (!nativeAvailable()) return diag;

  await ensureChannel();
  diag.channelReady = channelReady;
  diag.permission = await checkPermission();
  diag.exactAlarm = await refreshExactAlarmState();

  try {
    const channels = await LocalNotifications.listChannels();
    diag.channelRegistered = channels.channels.some((c) => c.id === CHANNEL_ID);
  } catch {
    /* listChannels can be unavailable — leave it as unknown/false */
  }

  try {
    const res = await LocalNotifications.getPending();
    diag.pending = res.notifications.map((n) => ({
      id: n.id,
      title: n.title ?? "",
      body: n.body ?? "",
      at: n.schedule?.at ? new Date(n.schedule.at).toISOString() : undefined,
    }));
    diag.pendingCount = diag.pending.length;
  } catch {
    /* best effort */
  }

  return diag;
}

/* ------------------------------------------------------------------ */
/* Delivery listeners                                                  */
/* ------------------------------------------------------------------ */

/** Register native delivery listeners; returns an unsubscribe function. */
export function onNativeNotification(
  handlers: {
    received?: (record: NativeNotifRecord) => void;
    acted?: (record: NativeNotifRecord) => void;
  },
): () => void {
  if (!nativeAvailable() || typeof window === "undefined") return () => {};

  const recv = LocalNotifications.addListener("localNotificationReceived", (n) => {
    handlers.received?.({
      id: n.id,
      title: n.title ?? "",
      body: n.body ?? "",
      at: n.schedule?.at ? new Date(n.schedule.at) : new Date(),
      key: `${n.title}-${n.id}`,
    });
  });
  const act = LocalNotifications.addListener("localNotificationActionPerformed", (n) => {
    const record: NativeNotifRecord = {
      id: n.notification.id,
      title: n.notification.title ?? "",
      body: n.notification.body ?? "",
      at: n.notification.schedule?.at ? new Date(n.notification.schedule.at) : new Date(),
      key: `${n.notification.title}-${n.notification.id}`,
    };
    handlers.acted?.(record);
  });

  return () => {
    void recv?.then((l) => l.remove());
    void act?.then((l) => l.remove());
  };
}

/* ------------------------------------------------------------------ */
/* Test notification                                                   */
/* ------------------------------------------------------------------ */

/** Seconds between tapping "Test notification" and the alarm firing. */
export const TEST_NOTIFICATION_DELAY_SECONDS = 15;

export interface TestNotificationResult {
  ok: boolean;
  reason?: "unsupported" | "permission" | "error";
  /** Human copy safe to show directly in the settings UI. */
  message: string;
  id?: number;
  fireAt?: string;
  warning?: string;
  error?: string;
}

/**
 * Schedule a short-lived native notification so delivery can be verified
 * outside the app. Uses the exact same scheduling path as real reminders —
 * if this arrives, reminders will too.
 */
export async function sendTestNotification(
  delaySeconds: number = TEST_NOTIFICATION_DELAY_SECONDS,
): Promise<TestNotificationResult> {
  if (!nativeAvailable()) {
    return {
      ok: false,
      reason: "unsupported",
      message: "Native notifications are only available in the Android/iOS app.",
    };
  }

  const permission = await checkPermission();
  if (permission !== "granted") {
    return {
      ok: false,
      reason: "permission",
      message:
        "Notifications are blocked for Momentum. Enable them in Android settings → Apps → Momentum → Notifications, then try again.",
    };
  }

  await ensureChannel();
  await refreshExactAlarmState();

  const fireAt = new Date(Date.now() + delaySeconds * 1000);
  const key = `test:${fireAt.getTime()}`;
  const id = nativeIdForKey(key);

  const outcome = await scheduleRecords([
    { id, key, title: "Momentum", body: "This is a test notification.", at: fireAt },
  ]);

  if (outcome.error) {
    return {
      ok: false,
      reason: "error",
      id,
      fireAt: fireAt.toISOString(),
      error: outcome.error,
      message: `Android rejected the notification: ${outcome.error}`,
    };
  }

  return {
    ok: true,
    id,
    fireAt: fireAt.toISOString(),
    warning: outcome.warning,
    message: `Scheduled for ${delaySeconds}s from now. Background Momentum or lock the screen, then check the Android notification shade.`,
  };
}
