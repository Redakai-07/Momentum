import { RECOVERY_RULES } from "./config";
import { todayKey } from "./date";
import { isRestDay, type DayRec } from "./performance";
import type { DayKind } from "./types";

/**
 * Day classification:
 * - `inactive` — nothing planned (always neutral; a rest day never breaks a streak)
 * - `normal`   — a real working day (regardless of the outcome)
 * - `recovery` — a missed working day that was *earned*: recent consistency
 *   protects the streak without pretending the day was productive.
 */
export function dayKindOf(r: DayRec): DayKind {
  if (r.kind === "inactive" || r.kind === "recovery") return r.kind;
  if (isRestDay(r)) return "inactive";
  return "normal";
}

export const isRecoveryDay = (r: DayRec): boolean => r.kind === "recovery";
export const isInactiveDay = (r: DayRec): boolean => dayKindOf(r) === "inactive";

/** A day that neither extends nor breaks the streak. */
export const isNeutralDay = (r: DayRec): boolean =>
  isInactiveDay(r) || isRecoveryDay(r);

/**
 * Marks earned recovery days on a chronological series of day records.
 *
 * Rules (see RECOVERY_RULES): a day that had planned work but fell below the
 * performance threshold may be flagged as a recovery day when the preceding
 * window contains enough qualifying days, no other failed day, and the month's
 * recovery budget is not spent. Today is never pre-classified — a partial day
 * is in progress, not failed.
 */
export function applyRecoveryKinds(rows: DayRec[], today: string = todayKey()): DayRec[] {
  const rules = RECOVERY_RULES;
  const thresholdPct = rules.minimumPerformanceThreshold * 100;
  const result = rows.map((r) => ({ ...r }));

  let monthUsed = 0;
  let lastMonthKey = "";

  for (let i = 0; i < result.length; i++) {
    const r = result[i];
    if (r.date >= today) {
      r.kind = isRestDay(r) ? "inactive" : "normal";
      continue;
    }
    if (r.percentage === null || r.plannedMinutes <= 0) {
      r.kind = "inactive";
      continue;
    }

    const monthKey = r.date.slice(0, 7);
    if (monthKey !== lastMonthKey) {
      lastMonthKey = monthKey;
      // Count recoveries already used in this month from processed rows.
      monthUsed = result.slice(0, i).filter((x) => x.kind === "recovery" && x.date.slice(0, 7) === monthKey).length;
    }

    const failed = r.percentage < thresholdPct;

    // Window over the previous calendar days (only real working days count).
    const windowStartMs = new Date(r.date + "T12:00:00").getTime() - rules.lookbackWindowDays * 86_400_000;
    let good = 0;
    let badInWindow = false;
    for (let j = i - 1; j >= 0; j--) {
      const p = result[j];
      if (new Date(p.date + "T12:00:00").getTime() < windowStartMs) break;
      if (p.kind === "recovery" || p.kind === "inactive") continue; // neutral
      if ((p.percentage ?? 0) >= thresholdPct) good += 1;
      else badInWindow = true;
    }

    const qualifies =
      failed &&
      good >= rules.minimumConsistencyDays &&
      !badInWindow &&
      monthUsed < rules.maximumRecoveryDaysPerMonth;

    if (qualifies) {
      r.kind = "recovery";
      monthUsed += 1;
    } else {
      r.kind = "normal";
    }
  }

  return result;
}

/** Month buckets (YYYY-MM) already used within `rows`. */
export function usedRecoveries(rows: DayRec[], month: string): number {
  return rows.filter(
    (r) => r.date.slice(0, 7) === month && r.kind === "recovery",
  ).length;
}

export function recoveryCopy(kind: DayKind): string | null {
  switch (kind) {
    case "recovery":
      return "You needed that break — your consistency is still intact.";
    case "inactive":
      return null;
    case "normal":
      return null;
  }
}
