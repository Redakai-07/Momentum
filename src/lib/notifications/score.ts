/**
 * Deterministic Reminder Score — the single place where reminder weights live.
 *
 * Pure rules, no machine learning. `planDayReminder` consumes the score to
 * (a) gate ordinary reminders behind a meaningful-interest threshold and
 * (b) pick the message variant that matches *why* the user is being nudged.
 *
 * Tune the weights here; every consumer follows automatically.
 */

import { isQuietHours, minutesSince, type DecisionContext, type DayWorkState } from "./decision";

/** Documented weights. Every factor is clamped to 0..weight. */
export const REMINDER_WEIGHTS = {
  /** Overdue or due-today work. */
  urgency: 40,
  /** Outstanding planned minutes (saturates at 120 min). */
  remainingWork: 25,
  /** Time since the last meaningful activity (saturates at 4 h). */
  inactivity: 20,
  /** A due date within 1–3 days. */
  dueSoon: 15,
  /** The target task carries an explicit next action. */
  nextAction: 10,
  /** The task's scheduled window is relevant right now. */
  scheduleRelevance: 10,
  /* Penalties — subtracted. */
  /** The user worked recently. */
  recentActivity: 35,
  /** A notification was delivered recently. */
  cooldownPenalty: 25,
  /** The user dismissed a reminder recently. */
  dismissalPenalty: 20,
  /** Inside quiet hours (ordinary reminders never fire there anyway). */
  quietHoursPenalty: 100,
} as const;

/**
 * Ordinary (non-due, non-overdue) reminders need at least this much *persistent*
 * interest. Deliberately low: the genuine anti-spam work (activity breathing
 * room, cooldowns, per-task dedupe) is enforced by deferring the fire time and
 * cancelling stale plans, never by refusing to schedule — a refusal here would
 * leave nothing pending once the user closed the app, and no reminder could
 * ever fire again. The gate only filters days with essentially no reason to
 * interrupt (no work left, nothing scheduled, no next action).
 */
export const ORDINARY_MIN_SCORE = 15;

/** Minutes of inactivity at which the inactivity factor is fully earned. */
const INACTIVITY_SATURATION_MIN = 240;
/** Minutes of remaining work at which the remaining-work factor is fully earned. */
const REMAINING_SATURATION_MIN = 120;

export type ReminderKind =
  | "due"
  | "overdue"
  | "next_action"
  | "evening_check_in"
  | "streak_protection"
  | "remaining_work";

export interface ScoreInput {
  ctx: DecisionContext;
  state: DayWorkState;
  /** The task the reminder would point at. */
  target: { id: string; title: string; nextAction?: string; dueDate?: string } | null;
  /** Whether the day's reminder was already delivered for this task. */
  alreadyNotified: boolean;
}

export interface ReminderScore {
  score: number;
  /**
   * The score with *transient* penalties (recent activity, cooldown, quiet
   * hours) removed. Those are enforced by deferring the fire time, never by
   * cancelling the plan — otherwise "worked, then closed the app" would leave
   * nothing scheduled and no reminder could ever fire later.
   */
  persistentScore: number;
  factors: Record<keyof typeof REMINDER_WEIGHTS, number>;
  kind: ReminderKind;
}

const clampF = (v: number, max: number) => Math.max(0, Math.min(max, v));

/**
 * Compute the day's reminder score. Deterministic: identical context in,
 * identical score out.
 */
export function computeReminderScore(input: ScoreInput): ReminderScore {
  const { ctx, state, target } = input;
  const w = REMINDER_WEIGHTS;
  const key = state.key;
  const now = ctx.now;

  const isOverdue = Boolean(target?.dueDate && target.dueDate < key);
  const isDueToday = Boolean(target?.dueDate && target.dueDate === key);
  const isDueSoon = Boolean(
    target?.dueDate &&
      target.dueDate > key &&
      (new Date(target.dueDate + "T12:00:00").getTime() -
        new Date(key + "T12:00:00").getTime()) /
        86_400_000 <=
        3,
  );

  const sinceActivity = Math.min(
    minutesSince(ctx.lastMeaningfulActivityAt, now),
    minutesSince(ctx.lastTaskCompletionAt, now),
  );

  const factors = {
    urgency: isOverdue || isDueToday ? w.urgency : 0,
    remainingWork: clampF(
      state.remainingMinutes / REMAINING_SATURATION_MIN,
      1,
    ) * w.remainingWork,
    inactivity:
      Number.isFinite(sinceActivity) && sinceActivity > 0
        ? clampF(sinceActivity / INACTIVITY_SATURATION_MIN, 1) * w.inactivity
        : // A user who has not been seen today is treated as maximally idle.
          w.inactivity,
    dueSoon: isDueSoon ? w.dueSoon : 0,
    nextAction: target?.nextAction ? w.nextAction : 0,
    scheduleRelevance: w.scheduleRelevance,
    recentActivity:
      Number.isFinite(sinceActivity) &&
      sinceActivity < 30
        ? w.recentActivity
        : 0,
    cooldownPenalty:
      minutesSince(ctx.lastNotificationAt, now) < ctx.settings.cooldownMinutes
        ? w.cooldownPenalty
        : 0,
    dismissalPenalty: input.alreadyNotified ? w.dismissalPenalty : 0,
    quietHoursPenalty: isQuietHours(now, ctx.settings) ? w.quietHoursPenalty : 0,
  };

  // All factors are already clamped to their weight, so the score is a sum.
  const score = Object.values(factors).reduce((a, b) => a + b, 0);
  const persistentScore =
    score - factors.recentActivity - factors.cooldownPenalty - factors.quietHoursPenalty;

  const hour = now.getHours();
  let kind: ReminderKind;
  if (isOverdue) kind = "overdue";
  else if (isDueToday) kind = "due";
  else if (target?.nextAction) kind = "next_action";
  else if (hour >= 18 && !state.hasProgress) kind = "evening_check_in";
  else if (!state.hasProgress) kind = "streak_protection";
  else kind = "remaining_work";

  return { score, persistentScore, factors, kind };
}

/**
 * Human notification copy for a score kind. Calm, supportive, never guilty —
 * grounded in the day's actual remaining work.
 */
export function messageForKind(
  kind: ReminderKind,
  target: { title: string; nextAction?: string } | null,
  remainingMinutes: number,
): string {
  switch (kind) {
    case "overdue":
    case "due":
      return `Keep your streak alive — ${target?.title ?? "your work"} is still waiting.`;
    case "next_action":
      return target?.nextAction ? `Next: ${target.nextAction}` : `Ready for ${target?.title ?? "the next step"}?`;
    case "evening_check_in": {
      const mins = remainingMinutes > 0 ? ` ${remainingMinutes} minutes planned.` : "";
      return `There's still time to make progress today.${mins}`;
    }
    case "streak_protection":
      return `Keep your streak alive — ${target?.title ?? "your work"} is ready when you are.`;
    case "remaining_work": {
      const h = Math.floor(remainingMinutes / 60);
      const m = remainingMinutes % 60;
      const label = h > 0 ? `${h}h${m > 0 ? ` ${m}m` : ""}` : `${m}m`;
      return `You still have ${label} planned for today. A small session can keep your momentum going.`;
    }
  }
}
