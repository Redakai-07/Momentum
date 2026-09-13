"use client";

import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";

/**
 * Subscribe to "the app returned to the foreground" on every platform.
 *
 * On Android the Activity is merely resumed when the user reopens Momentum —
 * the WebView is not reloaded — so anything that must react to a new local
 * calendar day has to hook into resume, not into module load.
 *
 * Returns an unsubscribe function. Safe to call on the web (it degrades to a
 * plain `visibilitychange` listener).
 */
export function onAppResume(handler: () => void): () => void {
  if (typeof window === "undefined") return () => {};

  const onVisible = () => {
    if (document.visibilityState === "visible") handler();
  };
  document.addEventListener("visibilitychange", onVisible);

  let listener: Promise<{ remove: () => void }> | null = null;
  if (Capacitor.isNativePlatform()) {
    try {
      // Call the handler directly: `document.visibilityState` can still read
      // "hidden" at the instant Capacitor emits resume, which would silently
      // skip the day rollover the next morning.
      listener = App.addListener("resume", () => handler());
    } catch {
      listener = null;
    }
  }

  return () => {
    document.removeEventListener("visibilitychange", onVisible);
    void listener?.then((l) => l.remove());
  };
}
