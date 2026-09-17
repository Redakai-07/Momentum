import { describe, expect, it } from "vitest";
import {
  planDayReminder,
  dayWorkState,
  nextOutsideQuiet,
  REMINDER_LEAD_MINUTES,
  type DecisionContext,
} from "./decision";
import type { NotificationSettings } from "./types";
import type { Task, TimeLog } from "../types";

/**
 * Regression coverage for the bug that made task reminders never arrive.
 *
 * The old scheduler gated a *future* native alarm on `shouldNotify()`, a
 * *present-moment* decision whose "idle gap" is measured from
 * `lastInteractionAt`. Because that timestamp is refreshed on every app open,
 * resume and task change — i.e. at exactly the moments the scheduler runs —
 * the gap was ~0 whenever a decision was taken, the reminder was suppressed,
 * and nothing was queued before the app closed. Test 1 below is that exact
 * scenario, and it is the reason these tests exist.
 */

const TODAY_KEY = "2026-03-11"; // Wednesday

const at = (h: number, m = 0): Date => new Date(2026, 2, 11, h, m);

const baseSettings: NotificationSettings = {
  enabled: true,
  cooldownMinutes: 60,
  completionCooldownMinutes: 30,
  taskReminders: true,
  specialTaskReminders: true,
  overdueReminders: true,
  quietHoursEnabled: true,
  quietStart: "22:30",
  quietEnd: "07:00",
  morningHour: 9,
  snoozeMinutes: 30,
};

const T = (o: Partial<Task> & { id: string; title: string }): Task => ({
  section: "daily",
  estimatedMinutes: 60,
  remainingMinutes: 60,
  status: "active",
  schedule: { type: "daily" },
  createdAt: "2026-01-01T09:00:00.000Z",
  ...o,
});

const L = (taskId: string, minutes: number, date = TODAY_KEY): TimeLog => ({
  id: `${taskId}-${minutes}-${date}`,
  taskId,
  minutes,
  date,
});

const ctx = (o: Partial<DecisionContext> = {}): DecisionContext => ({
  now: at(15, 0),
  tasks: [T({ id: "dsa", title: "DSA Practice" })],
  logs: [],
  settings: baseSettings,
  ...o,
});

describe("planDayReminder — planning a whole day, not a single moment", () => {
  it("1. REGRESSION: a fresh app open (interaction gap ≈ 0) still plans today's alarm", () => {
    // Exactly what boot hands the scheduler: the user just opened the app, so
    // "time since last interaction" is zero. The old gating called this
    // "no_gap_yet" and scheduled nothing at all.
    const plan = planDayReminder(
      ctx({
        now: at(15, 0),
        lastInteractionAt: at(15, 0).toISOString(),
      }),
    );

    expect(plan.eligible).toBe(true);
    expect(plan.earliest).not.toBeNull();
    // Fires later today, off the app-open moment, so it survives the user
    // closing the app a minute later.
    expect(plan.earliest!.getHours()).toBeGreaterThanOrEqual(15);
    expect(plan.earliest!.getTime()).toBeGreaterThan(at(15, 0).getTime());
  });

  it("2. points the nudge at today's pending work", () => {
    const plan = planDayReminder(ctx());
    expect(plan.eligible).toBe(true);
    expect(plan.task?.id).toBe("dsa");
    expect(plan.reason).toBe("normal_remaining");
    expect(plan.message).toContain("Keep your streak alive");
  });

  it("3. no tasks at all → nothing planned", () => {
    const plan = planDayReminder(ctx({ tasks: [] }));
    expect(plan.eligible).toBe(false);
    expect(plan.reason).toBe("no_tasks");
    expect(plan.earliest).toBeNull();
  });

  it("4. everything done today → nothing planned", () => {
    const plan = planDayReminder(
      ctx({
        tasks: [
          T({
            id: "dsa",
            title: "DSA",
            remainingMinutes: 0,
            status: "completed",
            // Finished *today* — so today is genuinely satisfied.
            completedAt: at(10, 0).toISOString(),
          }),
        ],
        logs: [L("dsa", 60)],
      }),
    );
    expect(plan.eligible).toBe(false);
    expect(plan.reason).toBe("all_done");
  });

  it("5. a completion pushed in yesterday does not satisfy today", () => {
    // Yesterday's progress must not make today read as done — the recurring
    // task is pending again.
    const plan = planDayReminder(
      ctx({
        logs: [L("dsa", 60, "2026-03-10")],
      }),
    );
    expect(plan.eligible).toBe(true);
  });

  it("6. disables cleanly when reminders are switched off", () => {
    const plan = planDayReminder(
      ctx({ settings: { ...baseSettings, enabled: false } }),
    );
    expect(plan.eligible).toBe(false);
    expect(plan.reason).toBe("notifications_disabled");
  });

  it("7. never before the lead time has elapsed", () => {
    const now = at(15, 0);
    const plan = planDayReminder(ctx({ now }));
    const leadMs = REMINDER_LEAD_MINUTES * 60_000;
    expect(plan.earliest!.getTime()).toBeGreaterThanOrEqual(
      now.getTime() + leadMs,
    );
  });

  it("8. waits for the breathing room after real work", () => {
    const now = at(15, 0);
    const plan = planDayReminder(
      ctx({ now, lastMeaningfulActivityAt: at(14, 45).toISOString() }),
    );
    // 30-minute breath from 14:45 → no earlier than 15:15.
    expect(plan.earliest!.getTime()).toBeGreaterThanOrEqual(at(15, 15).getTime());
  });

  it("9. waits out the global cooldown after a delivered notification", () => {
    const now = at(15, 0);
    const plan = planDayReminder(
      ctx({ now, lastNotificationAt: at(14, 30).toISOString() }),
    );
    // 60-minute cooldown from 14:30 → no earlier than 15:30.
    expect(plan.earliest!.getTime()).toBeGreaterThanOrEqual(at(15, 30).getTime());
  });

  it("10. drops the cooldown for overdue work", () => {
    const now = at(15, 0);
    const plan = planDayReminder(
      ctx({
        now,
        tasks: [
          T({
            id: "form",
            title: "Submit form",
            section: "remainder",
            schedule: undefined,
            dueDate: "2026-03-09",
          }),
        ],
        lastNotificationAt: at(14, 55).toISOString(),
      }),
    );
    expect(plan.eligible).toBe(true);
    expect(plan.priority).toBe("high");
    expect(plan.reason).toBe("overdue_task");
    // High-priority work is not held back by the ordinary cooldown.
    expect(plan.earliest!.getTime()).toBeLessThan(at(15, 55).getTime());
  });

  it("11. due today is urgent too", () => {
    const plan = planDayReminder(
      ctx({
        tasks: [
          T({
            id: "form",
            title: "Submit form",
            section: "remainder",
            schedule: undefined,
            dueDate: TODAY_KEY,
          }),
        ],
      }),
    );
    expect(plan.priority).toBe("high");
    expect(plan.reason).toBe("special_task");
  });

  it("12. slots land outside quiet hours instead of inside them", () => {
    const plan = planDayReminder(ctx({ now: at(22, 20) }));
    // 22:20 + 30min would be 22:50, inside the 22:30–07:00 window, which has
    // no room left today — so the day is honestly reported as having no slot.
    expect(plan.eligible).toBe(true);
    expect(plan.earliest).toBeNull();
  });

  it("13. a quiet-hours slot that fits earlier today is still usable", () => {
    const plan = planDayReminder(ctx({ now: at(20, 0) }));
    expect(plan.earliest).not.toBeNull();
    expect(plan.earliest!.getHours()).toBeLessThan(22);
    expect(plan.earliest!.getHours()).toBeGreaterThanOrEqual(20);
  });

  it("14. refuses to plan twice for the same task on the same day", () => {
    const plan = planDayReminder(
      ctx({
        lastReminderByTask: { dsa: `${TODAY_KEY}T19:00:00.000Z` },
      }),
    );
    expect(plan.eligible).toBe(false);
    expect(plan.reason).toBe("already_notified");
  });

  it("15. a reminder from a previous day does not block today", () => {
    const plan = planDayReminder(
      ctx({ lastReminderByTask: { dsa: "2026-03-10T19:00:00.000Z" } }),
    );
    expect(plan.eligible).toBe(true);
  });

  it("16. prefers the concrete next action as the message", () => {
    const plan = planDayReminder(
      ctx({
        tasks: [T({ id: "dsa", title: "DSA", nextAction: "Solve two graph problems" })],
      }),
    );
    expect(plan.message).toBe("Next: Solve two graph problems");
    expect(plan.reason).toBe("next_action");
  });

  it("17. a durationless task due today still plans a nudge", () => {
    // Completion-based work has no minutes to weigh, but it is real work — and
    // it must never be mistaken for "nothing planned".
    const plan = planDayReminder(
      ctx({
        tasks: [
          T({
            id: "form",
            title: "Submit form",
            section: "remainder",
            schedule: undefined,
            estimatedMinutes: null,
            remainingMinutes: 0,
            dueDate: TODAY_KEY,
          }),
        ],
      }),
    );
    expect(plan.eligible).toBe(true);
    expect(plan.task?.id).toBe("form");
  });

  it("18. an undated one-off stays out of the reminder engine", () => {
    // Preserved behaviour: Reminder/Occasional work reaches the engine through
    // its due date, so an undated someday-item never generates a nudge.
    const plan = planDayReminder(
      ctx({
        tasks: [
          T({
            id: "form",
            title: "Submit form",
            section: "remainder",
            schedule: undefined,
            estimatedMinutes: null,
            remainingMinutes: 0,
          }),
        ],
      }),
    );
    expect(plan.eligible).toBe(false);
    expect(plan.reason).toBe("no_tasks");
  });
});

describe("dayWorkState", () => {
  it("reports remaining minutes from today's timed work only", () => {
    const state = dayWorkState(
      ctx({
        tasks: [
          // DSA already carries the reduced remainder logging 20 minutes left.
          T({ id: "dsa", title: "DSA", estimatedMinutes: 60, remainingMinutes: 40 }),
          T({ id: "ml", title: "ML", estimatedMinutes: 60, remainingMinutes: 60 }),
        ],
        logs: [L("dsa", 20)],
      }),
    );
    expect(state.key).toBe(TODAY_KEY);
    expect(state.hasTasks).toBe(true);
    expect(state.hasProgress).toBe(true);
    // 40 outstanding on DSA + 60 on ML.
    expect(state.remainingMinutes).toBe(100);
    expect(state.open.map((t) => t.id)).toEqual(["dsa", "ml"]);
  });

  it("keeps a partially logged task open", () => {
    const state = dayWorkState(
      ctx({
        tasks: [T({ id: "dsa", title: "DSA", remainingMinutes: 60 })],
        logs: [L("dsa", 20)],
      }),
    );
    expect(state.open.map((t) => t.id)).toEqual(["dsa"]);
  });
});

describe("nextOutsideQuiet", () => {
  it("leaves a non-quiet moment alone", () => {
    expect(nextOutsideQuiet(baseSettings, at(15, 0)).getTime()).toBe(
      at(15, 0).getTime(),
    );
  });

  it("walks a quiet moment out to the far side of the window", () => {
    const moved = nextOutsideQuiet(baseSettings, at(23, 0));
    // 23:00 is inside quiet hours; the next 15-minute step lands after 07:00.
    expect(moved.getHours()).toBeGreaterThanOrEqual(7);
    expect(moved.getHours()).toBeLessThan(22);
  });

  it("suppresses nothing when quiet hours are disabled", () => {
    const open: NotificationSettings = { ...baseSettings, quietHoursEnabled: false };
    expect(nextOutsideQuiet(open, at(23, 0)).getTime()).toBe(at(23, 0).getTime());
  });
});
