import { describe, expect, it } from "vitest";
import type { CustomSection } from "./types";
import {
  buildTaskInput,
  canContinue,
  defaultWizardState,
  durationMinutes,
  durationSummary,
  isRecurringKey,
  reminderAtFor,
  reminderNotifyTime,
  reminderSummary,
  scheduleContextFor,
  sectionOptions,
  summaryLines,
  toLocalInput,
  wizardSteps,
  type SectionKey,
  type WizardState,
} from "./task-wizard";

/**
 * The creation flow's product rules:
 *
 * - the wizard asks only what the chosen type cannot answer for itself,
 * - optional means optional (skip → omitted, never empty),
 * - recurring and one-shot reminders are mutually exclusive,
 * - Back never loses data (state is immutable across step computation).
 */

const NOW = new Date(2026, 8, 14, 10, 0); // Monday 2026-09-14, local

const SECTIONS: CustomSection[] = [
  {
    id: "sec-research",
    name: "Research",
    schedule: { type: "weekly", days: [1], startTime: "19:00" },
    createdAt: "2026-01-01T09:00:00.000Z",
  },
];

const state = (patch: Partial<WizardState> = {}): WizardState => ({
  ...defaultWizardState("daily"),
  ...patch,
});

/* ------------------------------------------------------------------ */
/* Smart step reduction                                                */
/* ------------------------------------------------------------------ */

describe("wizardSteps", () => {
  it("never asks Daily tasks when they repeat — the answer is known", () => {
    const steps = wizardSteps(state({ sectionKey: "daily" }));
    expect(steps).not.toContain("when");
    expect(steps).toHaveLength(6);
  });

  it("never asks for a custom section's schedule — the section owns it", () => {
    const steps = wizardSteps(state({ sectionKey: "custom:sec-research" }));
    expect(steps).not.toContain("when");
    expect(steps).toEqual([
      "what",
      "where",
      "time",
      "next",
      "reminder",
      "details",
    ]);
  });

  it("asks one-off work for a date, because nothing else defines one", () => {
    expect(wizardSteps(state({ sectionKey: "remainder" }))).toContain("when");
    expect(wizardSteps(state({ sectionKey: "occasional" }))).toContain("when");
    expect(wizardSteps(state({ sectionKey: "remainder" }))).toHaveLength(7);
  });

  it("keeps the same state object while steps change (Back never loses data)", () => {
    const before = state({ sectionKey: "remainder", title: "Call grandma", hours: "1" });
    const after = { ...before, sectionKey: "daily" as SectionKey };
    expect(wizardSteps(after)).not.toContain("when");
    expect(after.title).toBe("Call grandma");
    expect(after.hours).toBe("1");
  });
});

/* ------------------------------------------------------------------ */
/* Where                                                               */
/* ------------------------------------------------------------------ */

describe("sectionOptions", () => {
  it("offers only custom sections that actually exist", () => {
    expect(sectionOptions([]).map((o) => o.key)).toEqual([
      "daily",
      "remainder",
      "occasional",
    ]);
    expect(sectionOptions(SECTIONS).map((o) => o.key)).toContain("custom:sec-research");
  });

  it("explains the choice, including the section's own schedule", () => {
    const custom = sectionOptions(SECTIONS).find((o) => o.key === "custom:sec-research");
    expect(custom?.hint).toContain("Every week on Mon");
    expect(scheduleContextFor("custom:sec-research", SECTIONS)).toBe("Every week on Mon");
    expect(scheduleContextFor("daily", SECTIONS)).toBe("Every day");
  });
});

/* ------------------------------------------------------------------ */
/* Time                                                                */
/* ------------------------------------------------------------------ */

describe("duration", () => {
  it("supports timed tasks", () => {
    expect(durationMinutes(state({ hours: "1", mins: "30" }))).toBe(90);
    expect(durationMinutes(state({ mins: "15" }))).toBe(15);
    expect(durationSummary(state({ hours: "1" }))).toBe("1h");
  });

  it("supports durationless tasks — skipping is never a fake 0", () => {
    expect(durationMinutes(state())).toBeNull();
    expect(durationSummary(state())).toBe("No duration");
  });

  it("never forces duration for Reminder or Occasional work", () => {
    expect(durationMinutes(state({ sectionKey: "remainder" }))).toBeNull();
    expect(durationMinutes(state({ sectionKey: "occasional" }))).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Reminders                                                           */
/* ------------------------------------------------------------------ */

describe("reminders", () => {
  it("creates no reminder when the user skipped the step", () => {
    const input = buildTaskInput(state(), NOW);
    expect(input.notifyTime).toBeUndefined();
    expect(input.remindAt).toBeUndefined();
  });

  it("gives recurring work a time, and never a one-shot moment", () => {
    const input = buildTaskInput(
      state({ reminderOn: true, reminderTime: "19:30" }),
      NOW,
    );
    expect(input.notifyTime).toBe("19:30");
    expect(input.remindAt).toBeUndefined(); // no duplicate channel
    expect(reminderNotifyTime(state({ reminderOn: true }))).toBe("09:00");
  });

  it("gives one-off work a moment, and never a recurring time", () => {
    const input = buildTaskInput(
      state({ sectionKey: "remainder", reminderOn: true, reminderPreset: "today7" }),
      NOW,
    );
    expect(input.remindAt).toBe(new Date(2026, 8, 14, 19, 0).toISOString());
    expect(input.notifyTime).toBeUndefined();
    expect(input.remindAt).toBeDefined();
  });

  it("offers today 7 PM / tomorrow 9 AM / custom presets", () => {
    expect(reminderAtFor(state({ sectionKey: "occasional", reminderOn: true, reminderPreset: "today7" }), NOW)).toBe(
      new Date(2026, 8, 14, 19, 0).toISOString(),
    );
    expect(
      reminderAtFor(
        state({ sectionKey: "occasional", reminderOn: true, reminderPreset: "tomorrow9" }),
        NOW,
      ),
    ).toBe(new Date(2026, 8, 15, 9, 0).toISOString());

    const custom = state({
      sectionKey: "occasional",
      reminderOn: true,
      reminderPreset: "custom",
      reminderCustom: "2026-09-20T14:30",
    });
    expect(reminderAtFor(custom, NOW)).toBe(new Date(2026, 8, 20, 14, 30).toISOString());
  });

  it("blocks continuing when a custom reminder has no valid moment", () => {
    const broken = state({
      sectionKey: "remainder",
      reminderOn: true,
      reminderPreset: "custom",
      reminderCustom: "",
    });
    expect(canContinue(broken, "reminder")).toBe(false);
    expect(canContinue(state({ sectionKey: "remainder", reminderOn: true }), "reminder")).toBe(
      true,
    );
  });

  it("summarises the reminder in plain language", () => {
    expect(reminderSummary(state())).toBe("None");
    expect(reminderSummary(state({ reminderOn: true }))).toBe("Every day at 09:00");
    expect(
      reminderSummary(
        state({ sectionKey: "remainder", reminderOn: true, reminderPreset: "today7" }),
        NOW,
      ),
    ).toBe("Today at 7:00 PM");
  });
});

/* ------------------------------------------------------------------ */
/* Submission — one test per creation case in the spec                 */
/* ------------------------------------------------------------------ */

describe("buildTaskInput — every creation case", () => {
  it("Daily task", () => {
    const input = buildTaskInput(
      state({ title: "Practice Binary Search", hours: "0", mins: "30" }),
      NOW,
    );
    expect(input).toMatchObject({
      title: "Practice Binary Search",
      section: "daily",
      estimatedMinutes: 30,
      priority: "medium",
    });
    expect(input.customSectionId).toBeUndefined();
  });

  it("Reminder task", () => {
    const input = buildTaskInput(
      state({ sectionKey: "remainder", title: "Call grandma", dueDate: "2026-09-16" }),
      NOW,
    );
    expect(input.section).toBe("remainder");
    expect(input.dueDate).toBe("2026-09-16");
    expect(input.estimatedMinutes).toBeNull();
  });

  it("Occasional task", () => {
    const input = buildTaskInput(
      state({ sectionKey: "occasional", title: "Plan trip" }),
      NOW,
    );
    expect(input.section).toBe("occasional");
    expect(input.dueDate).toBeUndefined();
  });

  it("Custom section task", () => {
    const input = buildTaskInput(
      state({ sectionKey: "custom:sec-research", title: "Read paper" }),
      NOW,
    );
    expect(input.section).toBe("custom");
    expect(input.customSectionId).toBe("sec-research");
  });

  it("Durationless task", () => {
    expect(buildTaskInput(state({ title: "Meditate" }), NOW).estimatedMinutes).toBeNull();
  });

  it("Timed task", () => {
    expect(
      buildTaskInput(state({ title: "Workout", hours: "1", mins: "30" }), NOW)
        .estimatedMinutes,
    ).toBe(90);
  });

  it("Task with description", () => {
    const input = buildTaskInput(
      state({ title: "Read", description: "  Chapters 1–3  " }),
      NOW,
    );
    expect(input.description).toBe("Chapters 1–3");
  });

  it("Task with Next Action — preserved verbatim", () => {
    const input = buildTaskInput(
      state({ title: "DSA", nextAction: "Open LeetCode and solve the first problem." }),
      NOW,
    );
    expect(input.nextAction).toBe("Open LeetCode and solve the first problem.");
  });

  it("Task with skipped optional fields — omitted, not empty", () => {
    const input = buildTaskInput(state({ title: "Just a title" }), NOW);
    expect(input.description).toBeUndefined();
    expect(input.nextAction).toBeUndefined();
    expect(input.dueDate).toBeUndefined();
    expect(input.notifyTime).toBeUndefined();
    expect(input.remindAt).toBeUndefined();
    expect(input.estimatedMinutes).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Guard rails                                                          */
/* ------------------------------------------------------------------ */

describe("guard rails", () => {
  it("requires a title before leaving step 1", () => {
    expect(canContinue(state({ title: "   " }), "what")).toBe(false);
    expect(canContinue(state({ title: "DSA" }), "what")).toBe(true);
    expect(canContinue(state(), "time")).toBe(true);
  });

  it("recognises recurring vs one-off sections", () => {
    expect(isRecurringKey("daily")).toBe(true);
    expect(isRecurringKey("custom:x")).toBe(true);
    expect(isRecurringKey("remainder")).toBe(false);
    expect(isRecurringKey("occasional")).toBe(false);
  });

  it("round-trips ISO timestamps for datetime-local inputs", () => {
    const iso = new Date(2026, 8, 14, 19, 0).toISOString();
    expect(toLocalInput(iso)).toBe("2026-09-14T19:00");
    expect(toLocalInput(undefined)).toBe("");
    expect(toLocalInput("not-a-date")).toBe("");
  });

  it("builds a compact review instead of repeating the whole form", () => {
    const lines = summaryLines(
      state({
        title: "Practice Binary Search",
        hours: "0",
        mins: "30",
        nextAction: "Solve problem 1",
      }),
      SECTIONS,
      NOW,
    );
    expect(lines.map((l) => `${l.label}: ${l.value}`)).toEqual([
      "Section: Daily",
      "Time: 30m",
      "Next action: Solve problem 1",
      "Reminder: None",
    ]);
  });
});
