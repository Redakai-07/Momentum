"use client";

import { useEffect, useRef, useState } from "react";

/**
 * True only after the component has mounted on the client. The update is
 * scheduled asynchronously so the first server/client renders match.
 *
 * Deliberately a timer rather than requestAnimationFrame: rAF only fires when
 * the page is actually being painted, so a backgrounded or non-compositing
 * WebView (energy saver, headless capture, some Android WebViews during
 * startup) would leave every screen that gates on this stuck on its skeleton.
 */
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setMounted(true), 0);
    return () => window.clearTimeout(id);
  }, []);
  return mounted;
}

/**
 * Current time, refreshed periodically so day boundaries roll over.
 * Returns null until mounted to keep SSR output deterministic.
 */
export function useNow(intervalMs = 30_000): Date | null {
  const [now, setNow] = useState<Date | null>(null);
  const intervalRef = useRef<number | null>(null);

  useEffect(() => {
    const start = window.setTimeout(() => {
      setNow(new Date());
      intervalRef.current = window.setInterval(() => setNow(new Date()), intervalMs);
    }, 0);
    return () => {
      window.clearTimeout(start);
      if (intervalRef.current !== null) window.clearInterval(intervalRef.current);
    };
  }, [intervalMs]);

  return now;
}

/**
 * A once-a-second clock, used only while a focus session needs a live
 * countdown. Returns null until mounted so SSR stays deterministic.
 *
 * This is presentation cadence, not timekeeping: the session's elapsed time is
 * derived from timestamps, so a missed tick (backgrounded WebView, throttled
 * timer) costs nothing but a stale digit.
 */
export function useSecondTick(enabled: boolean): number | null {
  const [tick, setTick] = useState<number | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const start = window.setTimeout(() => {
      setTick(Date.now());
    }, 0);
    const id = window.setInterval(() => setTick(Date.now()), 1000);
    return () => {
      window.clearTimeout(start);
      window.clearInterval(id);
    };
  }, [enabled]);

  return tick;
}
