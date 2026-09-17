"use client";

import { useEffect, useRef } from "react";
import { useStore } from "@/lib/store";
import { useSecondTick } from "@/lib/hooks";

/**
 * The single reconciliation loop for a focus session.
 *
 * Every surface that shows a countdown (the full-screen mode, the ambient
 * banner) used to run its own interval. Centralising it means one ticker, one
 * place that can roll a finished phase over, and no risk of two surfaces
 * disagreeing about which phase is on the clock.
 *
 * The returned value is a wall-clock timestamp for *display* only. Correctness
 * never depends on this running: the session's elapsed time is derived from
 * timestamps inside `syncFocus`, so a missing tick costs nothing but a stale
 * digit, and a phase that ended while the app was suspended is banked the first
 * time this runs afterwards.
 */
export function useFocusEngine(): number | null {
  const session = useStore((s) => s.focusSession);
  const syncFocus = useStore((s) => s.syncFocus);
  const running = session?.status === "running";
  const tick = useSecondTick(Boolean(session));
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    if (!session) return;
    // Settle immediately: the app may have been closed across the whole phase.
    syncFocus();
    // A paused clock needs no ticker — nothing changes while it is held.
    if (!running) return;

    const id = window.setInterval(() => syncFocus(), 1000);
    let disposed = false;
    const requestWakeLock = async () => {
      if (!running || !navigator.wakeLock) return;
      try {
        const wakeLock = await navigator.wakeLock.request("screen");
        if (disposed) {
          await wakeLock.release();
          return;
        }
        wakeLockRef.current = wakeLock;
      } catch {
        // Wake Lock is optional and may be denied by the browser or device.
      }
    };
    const onVisible = () => {
      syncFocus();
      if (document.visibilityState === "visible") void requestWakeLock();
    };
    void requestWakeLock();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      disposed = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      const wakeLock = wakeLockRef.current;
      wakeLockRef.current = null;
      if (wakeLock) void wakeLock.release();
    };
  }, [session, running, syncFocus]);

  return tick;
}
