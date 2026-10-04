import { describe, expect, it } from "vitest";
import type { CustomSection } from "./types";
import {
  buildTaskInput,
  canContinue,
  defaultWizardState,
  durationMinutes,
  durationSummary,
  isRecurringKey,
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
 * - creation never asks about reminders, priority or next action — those are
 *   not the user's decisions to make while capturing a task,
 * - Back never loses data (state is immutable across step computation).
 */

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
    expect(steps).toEqual(["what", "where", "time", "details"]);
  });

  it("never asks for a custom section's schedule — the section owns it", () => {
    const steps = wizardSteps(state({ sectionKey: "custom:sec-research" }));
    expect(steps).not.toContain("when");
    expect(steps).toEqual(["what", "where", "time", "details"]);
  });

  it("asks one-off work for a date, because nothing else defines one", () => {
    expect(wizardSteps(state({ sectionKey: "remainder" }))).toContain("when");
    expect(wizardSteps(state({ sectionKey: "occasional" }))).toContain("when");
    expect(wizardSteps(state({ sectionKey: "remainder" }))).toEqual([
      "what",
      "where",
      "when",
      "time",
      "details",
    ]);
  });

  it("never asks about reminders, priority or next action", () => {
    const steps = wizardSteps(state({ sectionKey: "remainder" }));
    expect(steps).not.toContain("reminder");
    expect(steps).not.toContain("next");
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
/* No configuration during creation                                    */
/* ------------------------------------------------------------------ */

describe("creation configures nothing the planner should decide", () => {
  it("sets no reminder, no priority and no next action", () => {
    const input = buildTaskInput(state({ title: "Practice Binary Search", mins: "30" }));
    expect(input.notifyTime).toBeUndefined();
    expect(input.remindAt).toBeUndefined();
    expect(input.priority).toBeUndefined();
    expect(input.nextAction).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */
/* Submission — one test per creation case in the spec                 */
/* ------------------------------------------------------------------ */

describe("buildTaskInput — every creation case", () => {
  it("Daily task", () => {
    const input = buildTaskInput(
      state({ title: "Practice Binary Search", hours: "0", mins: "30" }),
    );
    expect(input).toMatchObject({
      title: "Practice Binary Search",
      section: "daily",
      estimatedMinutes: 30,
    });
    expect(input.customSectionId).toBeUndefined();
  });

  it("Reminder task", () => {
    const input = buildTaskInput(
      state({ sectionKey: "remainder", title: "Call grandma", dueDate: "2026-09-16" }),
    );
    expect(input.section).toBe("remainder");
    expect(input.dueDate).toBe("2026-09-16");
    expect(input.estimatedMinutes).toBeNull();
  });

  it("Occasional task", () => {
    const input = buildTaskInput(state({ sectionKey: "occasional", title: "Plan trip" }));
    expect(input.section).toBe("occasional");
    expect(input.dueDate).toBeUndefined();
  });

  it("Custom section task", () => {
    const input = buildTaskInput(
      state({ sectionKey: "custom:sec-research", title: "Read paper" }),
    );
    expect(input.section).toBe("custom");
    expect(input.customSectionId).toBe("sec-research");
  });

  it("Durationless task", () => {
    expect(buildTaskInput(state({ title: "Meditate" })).estimatedMinutes).toBeNull();
  });

  it("Timed task", () => {
    expect(
      buildTaskInput(state({ title: "Workout", hours: "1", mins: "30" })).estimatedMinutes,
    ).toBe(90);
  });

  it("Task with description", () => {
    const input = buildTaskInput(state({ title: "Read", description: "  Chapters 1–3  " }));
    expect(input.description).toBe("Chapters 1–3");
  });

  it("Task with skipped optional fields — omitted, not empty", () => {
    const input = buildTaskInput(state({ title: "Just a title" }));
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

  it("builds a compact review with no reminder, priority or next action", () => {
    const lines = summaryLines(
      state({
        title: "Practice Binary Search",
        hours: "0",
        mins: "30",
        description: "Chapter 3",
      }),
      SECTIONS,
    );
    expect(lines.map((l) => `${l.label}: ${l.value}`)).toEqual([
      "Section: Daily",
      "Time: 30m",
      "Notes: Chapter 3",
    ]);
    expect(lines.map((l) => l.label)).not.toContain("Reminder");
    expect(lines.map((l) => l.label)).not.toContain("Priority");
    expect(lines.map((l) => l.label)).not.toContain("Next action");
  });
});
