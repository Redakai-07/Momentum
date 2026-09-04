"use client";

import { useEffect } from "react";

/**
 * Registers the app-shell service worker so the app works offline after the
 * first visit. Only runs in secure contexts (https or localhost), where
 * service workers are available.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (location.protocol !== "https:" && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") {
      return;
    }
    let active = true;
    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => {
        if (active) console.debug("Momentum: service worker registered", reg.scope);
      })
      .catch((err) => {
        // Never block the app on a failed registration.
        console.warn("Momentum: service worker registration failed", err);
      });
    return () => {
      active = false;
    };
  }, []);

  return null;
}
