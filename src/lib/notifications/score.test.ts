import { describe, expect, it } from "vitest";
import { computeReminderScore, messageForKind, ORDINARY_MIN_SCORE } from "./score";
import { planDayReminder, dayWorkState, type DecisionContext } from "./decision";
import type { NotificationSettings } from "./types";
import type { Task, TimeLog } from "../types";

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

describe("computeReminderScore", () => {
  it("is deterministic for identical contexts", () => {
    const a = computeReminderScore({
      ctx: ctx(),
      state: dayWorkState(ctx()),
      target: ctx().tasks[0],
      alreadyNotified: false,
    });
    const b = computeReminderScore({
      ctx: ctx(),
      state: dayWorkState(ctx()),
      target: ctx().tasks[0],
      alreadyNotified: false,
    });
    expect(a).toEqual(b);
  });

  it("scores an ordinary idle day above the threshold", () => {
    const c = ctx();
    const s = computeReminderScore({
      ctx: c,
      state: dayWorkState(c),
      target: c.tasks[0],
      alreadyNotified: false,
    });
    expect(s.score).toBeGreaterThanOrEqual(ORDINARY_MIN_SCORE);
    expect(s.kind).toBe("streak_protection");
  });

  it("rates overdue work as urgent", () => {
    const c = ctx({
      tasks: [
        T({
          id: "form",
          title: "Submit form",
          section: "remainder",
          schedule: undefined,
          dueDate: "2026-03-09",
        }),
      ],
    });
    const s = computeReminderScore({
      ctx: c,
      state: dayWorkState(c),
      target: c.tasks[0],
      alreadyNotified: false,
    });
    expect(s.factors.urgency).toBeGreaterThan(0);
    expect(s.kind).toBe("overdue");
  });

  it("penalises recent activity and a fresh notification", () => {
    const c = ctx({
      lastMeaningfulActivityAt: at(14, 50).toISOString(),
      lastNotificationAt: at(14, 45).toISOString(),
    });
    const s = computeReminderScore({
      ctx: c,
      state: dayWorkState(c),
      target: c.tasks[0],
      alreadyNotified: false,
    });
    expect(s.factors.recentActivity).toBeGreaterThan(0);
    expect(s.factors.cooldownPenalty).toBeGreaterThan(0);
    // Transient penalties lower the raw score…
    expect(s.score).toBeLessThan(100);
    // …but never leak into the persistent score that gates scheduling.
    expect(s.persistentScore).toBe(s.score - s.factors.recentActivity - s.factors.cooldownPenalty);
    expect(s.persistentScore).toBeGreaterThanOrEqual(ORDINARY_MIN_SCORE);
  });

  it("penalises an already-reminded task", () => {
    const c = ctx();
    const s = computeReminderScore({
      ctx: c,
      state: dayWorkState(c),
      target: c.tasks[0],
      alreadyNotified: true,
    });
    expect(s.factors.dismissalPenalty).toBeGreaterThan(0);
  });

  it("classifies an unworked evening as an evening check-in", () => {
    const c = ctx({ now: at(19, 30) });
    const s = computeReminderScore({
      ctx: c,
      state: dayWorkState(c),
      target: c.tasks[0],
      alreadyNotified: false,
    });
    expect(s.kind).toBe("evening_check_in");
  });

  it("classifies a day with progress as remaining work", () => {
    const c = ctx({ logs: [L("dsa", 20)] });
    const s = computeReminderScore({
      ctx: c,
      state: dayWorkState(c),
      target: c.tasks[0],
      alreadyNotified: false,
    });
    expect(s.kind).toBe("remaining_work");
  });
});

describe("messageForKind", () => {
  it("never guilt-trips", () => {
    for (const kind of [
      "due",
      "overdue",
      "next_action",
      "evening_check_in",
      "streak_protection",
      "remaining_work",
    ] as const) {
      const msg = messageForKind(kind, { title: "DSA" }, 80);
      expect(msg.toLowerCase()).not.toContain("failed");
      expect(msg.toLowerCase()).not.toContain("you have not");
    }
  });

  it("reports concrete remaining time", () => {
    expect(messageForKind("remaining_work", { title: "DSA" }, 80)).toContain("1h 20m");
    expect(messageForKind("remaining_work", { title: "DSA" }, 55)).toContain("55m");
  });

  it("prefers the explicit next action", () => {
    expect(messageForKind("next_action", { title: "DSA", nextAction: "Binary Search practice" }, 0)).toBe(
      "Next: Binary Search practice",
    );
  });
});

describe("planDayReminder × score integration", () => {
  it("evening with unworked plan plans an evening check-in message", () => {
    const plan = planDayReminder(ctx({ now: at(19, 0) }));
    expect(plan.eligible).toBe(true);
    expect(plan.kind).toBe("evening_check_in");
    expect(plan.message).toContain("still time");
    expect(plan.message).toContain("60 minutes");
  });

  it("a day with progress plans remaining-work copy", () => {
    const plan = planDayReminder(ctx({ logs: [L("dsa", 40)] }));
    expect(plan.eligible).toBe(true);
    expect(plan.kind).toBe("remaining_work");
    expect(plan.message).toContain("planned for today");
  });

  it("exposes the score for diagnostics", () => {
    const plan = planDayReminder(ctx());
    expect(plan.score).toBeGreaterThan(0);
    expect(plan.kind).toBe("streak_protection");
  });
});
