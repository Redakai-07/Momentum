"use client";

import { useEffect, useRef } from "react";
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

const stackRef: { current: ModalStackEntry[] } = { current: [] };
const listenersRef: { current: Set<(count: number) => void> } = { current: new Set() };

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
 * Id of the topmost entry, or null when nothing is stacked.
 *
 * Lets an overlay tell whether it is the one the user is actually looking at.
 * A layered overlay (a full-screen mode opened from inside a sheet) must not
 * interpret one Escape press as dismissing every layer at once.
 */
export function topModalId(): string | null {
  return stackRef.current[stackRef.current.length - 1]?.id ?? null;
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
 * The ONE authoritative back-navigation policy.
 *
 * Momentum's top-level destinations (Home, Calendar, Hobby & Notes, Profile)
 * are peer tabs, not a navigation stack. Switching between them must not grow
 * browser history, so the tab links navigate with `replace` (see app-shell)
 * and this handler never walks history to move between them.
 *
 * Priority, in order:
 *   1. an open modal / sheet / dialog closes and consumes the press;
 *   2. otherwise the `appBack` callback decides an in-app move (a child screen
 *      returns to its parent; a non-Home tab returns to Home) and returns true
 *      when it handled the press;
 *   3. otherwise (already Home, nothing open) the press falls through to the
 *      platform, which minimises/exits the app.
 *
 * `appBack` is read through a ref so the latest pathname/router is always used
 * without re-subscribing the native listener.
 */
export function useAndroidBackButton(appBack: () => boolean): void {
  const mountedRef = useRef(false);
  const appBackRef = useRef(appBack);
  useEffect(() => {
    appBackRef.current = appBack;
  }, [appBack]);

  useEffect(() => {
    mountedRef.current = true;
    let capBackButton: Promise<{ remove: () => void }> | null = null;

    // Capacitor native back button (Android physical back, iOS edge-swipe).
    // Attaching a listener suppresses the WebView's default back action, so we
    // must drive everything explicitly.
    if (typeof App !== "undefined" && App.addListener) {
      capBackButton = App.addListener("backButton", async () => {
        if (!mountedRef.current) return;
        // 1. A modal/sheet/dialog owns the press.
        if (modalStackDepth() > 0) {
          popModal();
          return;
        }
        // 2. In-app move (child → parent, or tab → Home).
        if (appBackRef.current()) return;
        // 3. Root: let Android put the app in the background (exit behaviour).
        await App.minimizeApp();
      });
    }

    // Browser history pop (desktop, PWA, or Capacitor's WebView history).
    // Only an open overlay is intercepted — otherwise the browser's own history
    // handling stays in charge, since tabs no longer add history entries.
    const onPopState = () => {
      if (!mountedRef.current) return;
      if (modalStackDepth() > 0) {
        popModal();
        if (typeof window !== "undefined") {
          // Restore an entry so the next back press is not swallowed.
          try {
            window.history.pushState(null, "", window.location.pathname);
          } catch {
            // pushState can throw in some restricted environments — ignore.
          }
        }
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
