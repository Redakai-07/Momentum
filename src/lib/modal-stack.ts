"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { App } from "@capacitor/app";

/**
 * Lightweight modal-stack tracker for Android back-button handling.
 *
 * The Momentum app renders modals (Create Task, Task Detail) as React
 * portals over the current page. On Android, the physical back button
 * should close the topmost modal first — only when no modal is open should
 * the back button perform normal navigation (browser history pop or app
 * minimize).
 *
 * This module exposes a small set of hooks + a context provider that any
 * "modal-like" overlay can use to push/pop itself onto a stack. The
 * AppShell subscribes to the stack and intercepts back events.
 */

export interface ModalStackEntry {
  /** Unique id for the entry (used for dedup). */
  id: string;
  /** Human-readable label (for logging only). */
  label: string;
  /** Called when the entry should be dismissed. */
  dismiss: () => void;
}

let stackRef: { current: ModalStackEntry[] } = { current: [] };
let listenersRef: { current: Set<(count: number) => void> } = { current: new Set() };

function notify() {
  for (const l of listenersRef.current) l(stackRef.current.length);
}

/** Register a listener that fires whenever the stack depth changes. */
export function subscribeModalStack(fn: (count: number) => void): () => void {
  listenersRef.current.add(fn);
  fn(stackRef.current.length);
  return () => {
    listenersRef.current.delete(fn);
  };
}

/** Push a modal entry onto the stack. */
export function pushModal(entry: ModalStackEntry): void {
  // Replace an existing entry with the same id (e.g. re-opening the same modal)
  // so re-opening a modal that was previously closed doesn't duplicate it.
  const idx = stackRef.current.findIndex((e) => e.id === entry.id);
  if (idx >= 0) stackRef.current[idx] = entry;
  else stackRef.current.push(entry);
  notify();
}

/** Pop the topmost entry and call its dismiss handler. */
export function popModal(): boolean {
  const entry = stackRef.current.pop();
  if (entry) entry.dismiss();
  notify();
  return Boolean(entry);
}

/** Pop a specific entry by id (without calling dismiss). */
export function removeModal(id: string): void {
  const idx = stackRef.current.findIndex((e) => e.id === id);
  if (idx >= 0) {
    stackRef.current.splice(idx, 1);
    notify();
  }
}

/** Current depth of the modal stack. */
export function modalStackDepth(): number {
  return stackRef.current.length;
}

/**
 * Hook that a modal component calls to register/unregister itself.
 */
export function useModalStack(id: string, label: string, dismiss: () => void, open: boolean) {
  useEffect(() => {
    if (open) pushModal({ id, label, dismiss });
    else removeModal(id);
    return () => removeModal(id);
  }, [id, label, open, dismiss]);
}

/**
 * Hook installed at the app shell level. Intercepts the Android back button
 * ( Capacitor `backbutton` event) and the browser's history pop, closing the
 * topmost modal when one is open.
 */
export function useAndroidBackButton(): void {
  const mountedRef = useRef(false);

  // Try to subscribe to Capacitor backbutton if available (Android/iOS).
  useEffect(() => {
    mountedRef.current = true;
    let capBackButton: Promise<{ remove: () => void }> | null = null;

    // Capacitor native back button (Android physical back, iOS edge-swipe).
    // When a listener is attached the WebView's default back action is suppressed,
    // so we must drive it explicitly: close the topmost modal when one is open,
    // otherwise delegate to Capacitor (goBack / minimize).
    if (typeof App !== "undefined" && App.addListener) {
      capBackButton = App.addListener("backButton", async ({ canGoBack }) => {
        if (!mountedRef.current) return;
        if (modalStackDepth() > 0) {
          popModal();
          return;
        }
        // No modal open — navigate browser history, or minimize at the root.
        if (canGoBack && typeof window !== "undefined") window.history.back();
        else await App.minimizeApp();
      });
    }

    // Browser history pop (desktop, PWA, or Capacitor's WebView history).
    // On desktop/PWA the browser back button fires popstate; when a modal is
    // open we close it instead of navigating away. We restore a history entry so
    // the next back press continues to navigate normally.
    const onPopState = () => {
      if (!mountedRef.current) return;
      if (modalStackDepth() > 0) {
        popModal();
        if (typeof window !== "undefined") {
          // Push the current pathname back so the browser still has a history
          // entry to pop on the next back press (avoids a trapped modal).
          try {
            window.history.pushState(null, "", window.location.pathname);
          } catch {
            // pushState can throw in some restricted environments — ignore.
          }
        }
        return;
      }
    };

    if (typeof window !== "undefined") {
      window.addEventListener("popstate", onPopState);
    }

    return () => {
      mountedRef.current = false;
      void capBackButton?.then((listener) => listener.remove());
      window.removeEventListener("popstate", onPopState);
    };
  }, []);
}
