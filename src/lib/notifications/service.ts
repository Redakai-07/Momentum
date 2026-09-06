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
 * On the web/PWA this is a no-op: Momentum's in-app reminder strip covers
 * browsers, and Capacitor delivers on native platforms only.
 */

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

export function nativeAvailable(): boolean {
  if (typeof window === "undefined") return false;
  return Capacitor.isNativePlatform();
}

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

/** Stable 31-bit id derived from a logical key (same key → same id). */
export function nativeIdForKey(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 0x7fffffff;
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
): Promise<void> {
  if (!nativeAvailable() || typeof navigator === "undefined") return;

  const prior = tracked.map((t) => t.id);
  if (prior.length > 0) {
    try {
      await LocalNotifications.cancel({ notifications: prior.map((id) => ({ id })) });
    } catch {
      /* best effort */
    }
  }

  const future = next.filter((n) => n.at.getTime() > Date.now() + 30_000);
  const nowKeys = new Set<string>();
  const deduped: NativeNotifRecord[] = [];
  for (const n of future) {
    if (nowKeys.has(n.key)) continue; // never twice the same logical reminder
    nowKeys.add(n.key);
    deduped.push(n);
  }

  if (deduped.length === 0) return;

  const notifications: LocalNotificationSchema[] = deduped.map((n) => ({
    id: n.id,
    title: n.title,
    body: n.body,
    schedule: { at: n.at, allowWhileIdle: false },
    // Grouped under "Momentum" so Android doesn't stack open notifications.
    channelId: "momentum-reminders",
  }));

  try {
    await LocalNotifications.schedule({ notifications });
  } catch (err) {
    console.error("Momentum: failed to schedule local notifications:", err);
  }
}

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
      // The scheduled time is the best available timestamp for the record.
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
    recv?.then((l) => l.remove());
    act?.then((l) => l.remove());
  };
}

/** Android channel for grouped notifications (idempotent, safe to call). */
export async function ensureChannel(): Promise<void> {
  if (!nativeAvailable()) return;
  try {
    await LocalNotifications.createChannel({
      id: "momentum-reminders",
      name: "Momentum reminders",
      description: "Task cues and progress nudges from Momentum",
      importance: 4,
      visibility: 1,
      vibration: true,
      sound: undefined,
    });
  } catch {
    /* channel may already exist — fine */
  }
}

/** Schedule a short-lived native notification for development verification. */
export async function sendTestNotification(): Promise<boolean> {
  if (!nativeAvailable()) return false;
  await ensureChannel();
  try {
    await LocalNotifications.schedule({
      notifications: [{
        id: nativeIdForKey(`test:${Date.now()}`),
        title: "Momentum",
        body: "This is a test notification.",
        schedule: { at: new Date(Date.now() + 1_000), allowWhileIdle: true },
        channelId: "momentum-reminders",
      }],
    });
    return true;
  } catch (err) {
    console.error("Momentum: failed to schedule test notification:", err);
    return false;
  }
}