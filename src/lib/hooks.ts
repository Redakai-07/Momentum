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
