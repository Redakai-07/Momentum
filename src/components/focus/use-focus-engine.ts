"use client";

import { useEffect } from "react";
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

  useEffect(() => {
    if (!session) return;
    // Settle immediately: the app may have been closed across the whole phase.
    syncFocus();
    // A paused clock needs no ticker — nothing changes while it is held.
    if (!running) return;

    const id = window.setInterval(() => syncFocus(), 1000);
    const onVisible = () => syncFocus();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [session, running, syncFocus]);

  return tick;
}
