/**
 * Momentum's ONE authoritative back-navigation policy.
 *
 * The top-level destinations (Home, Calendar, Hobby & Notes, Profile) are peer
 * tabs, not a navigation stack. Switching between them uses `replace`, so
 * history never accumulates a tab stack and Back can never walk
 * Profile → Calendar → Home.
 *
 * Given the current modal depth and pathname, Back resolves to exactly one of:
 *
 *   1. `pop_modal`     — a modal/sheet/dialog is open; close it and consume the
 *                        press (never navigate away).
 *   2. `replace_home`  — no overlay, and we are not Home (a child screen like
 *                        `/section`, or any non-Home tab); return to Home.
 *   3. `exit`          — already Home with nothing open; let the platform exit.
 *
 * Kept pure so the rule is trivially testable and there is only one copy of it.
 */

export type BackAction = "pop_modal" | "replace_home" | "exit";

export const HOME_PATH = "/";

/** Normalise a pathname for comparison ("/profile/" → "/profile"). */
function normalize(pathname: string): string {
  if (!pathname) return HOME_PATH;
  const trimmed = pathname.replace(/\/+$/, "");
  return trimmed === "" ? HOME_PATH : trimmed;
}

export function resolveBackAction(modalDepth: number, pathname: string): BackAction {
  if (modalDepth > 0) return "pop_modal";
  return normalize(pathname) === HOME_PATH ? "exit" : "replace_home";
}
