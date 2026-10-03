/**
 * The task-creation wizard — pure logic, no React, no DOM.
 *
 * The wizard is a short conversation ("What? Where? When? How much time? …"),
 * not a database form. This module owns the three rules that make it feel like
 * one:
 *
 * 1. **Steps adapt to the task type.** Daily and custom-section work inherits
 *    its schedule from the section, so the "When?" step disappears entirely.
 *    Only one-off work (Reminder / Occasional) is ever asked for a date.
 * 2. **Optional stays optional.** Every value except the title has a default of
 *    "nothing", and skipped values are omitted from the input rather than
 *    written as empty rows.
 * 3. **Reminder semantics follow the task type.** Recurring tasks get a time
 *    (`notifyTime`, which the reminder planner already respects), one-off tasks
 *    get a single moment (`remindAt`). Never both — no duplicate reminders.
 *
 * Because everything here is pure, the component stays thin and every rule is
 * covered by task-wizard.test.ts.
 */

import { normalizeDuration } from "./duration";
import { formatMinutes } from "./format";
import type { CustomSection, Priority } from "./types";
import type { TaskInput } from "./store";
import { scheduleSummary } from "./labels";

export type SectionKey = "daily" | "remainder" | "occasional" | `custom:${string}`;

export type WizardStep = "what" | "where" | "when" | "time" | "next" | "reminder" | "details";

export type ReminderPreset = "today7" | "tomorrow9" | "custom";

export interface WizardState {
  title: string;
  sectionKey: SectionKey;
  /** "YYYY-MM-DD" for one-off work, or "" when the user skipped it. */
  dueDate: string;
  /** Duration inputs, kept as strings so "empty" is representable. */
  hours: string;
  mins: string;
  nextAction: string;
  reminderOn: boolean;
  /** One-off reminders only: which moment. */
  reminderPreset: ReminderPreset;
  /** datetime-local value for the "custom" preset. */
  reminderCustom: string;
  /** Recurring reminders only: local "HH:MM". */
  reminderTime: string;
  description: string;
  priority: Priority;
}

/* ------------------------------------------------------------------ */
/* Section helpers                                                     */
/* ------------------------------------------------------------------ */

export function sectionKindOf(key: SectionKey): TaskInput["section"] {
  if (key.startsWith("custom:")) return "custom";
  return key as TaskInput["section"];
}

export function customSectionIdOf(key: SectionKey): string | undefined {
  return key.startsWith("custom:") ? key.slice("custom:".length) : undefined;
}

/** Recurring work (daily + custom sections) — its schedule comes from the section. */
export function isRecurringKey(key: SectionKey): boolean {
  return key === "daily" || key.startsWith("custom:");
}

export interface SectionOption {
  key: SectionKey;
  label: string;
  /** The brief explanation the picker shows under the choice. */
  hint: string;
  icon?: string;
}

/**
 * The choices offered in the "Where?" step. Built-in lists are always present;
 * custom sections are only offered when they actually exist.
 */
export function sectionOptions(sections: CustomSection[]): SectionOption[] {
  const options: SectionOption[] = [
    { key: "daily", label: "Daily", hint: "Every day — habits and routines." },
    {
      key: "remainder",
      label: "Reminder",
      hint: "One-off work — a gentle weekly nudge until it's done.",
    },
    {
      key: "occasional",
      label: "Occasional",
      hint: "Someday work — a gentle monthly nudge until it's done.",
    },
  ];
  for (const s of sections) {
    options.push({
      key: `custom:${s.id}`,
      label: s.name,
      icon: s.icon,
      hint: `Runs on this section's schedule: ${scheduleSummary(s.schedule)}.`,
    });
  }
  return options;
}

/** The schedule context shown when a custom section is selected, if any. */
export function scheduleContextFor(
  key: SectionKey,
  sections: CustomSection[],
): string | null {
  if (key === "daily") return "Every day";
  const id = customSectionIdOf(key);
  if (!id) return null;
  const section = sections.find((s) => s.id === id);
  return section ? scheduleSummary(section.schedule) : null;
}

/* ------------------------------------------------------------------ */
/* Steps                                                               */
/* ------------------------------------------------------------------ */

/**
 * The wizard's steps for the current draft — the smart-reduction rule.
 *
 * Daily tasks are every day and custom sections already own their recurrence,
 * so those drafts never see a "When?" question. One-off work is asked for a
 * date because nothing else defines one. Everything after "Where?" is optional
 * and skippable.
 */
export function wizardSteps(state: WizardState): WizardStep[] {
  const steps: WizardStep[] = ["what", "where"];
  if (state.sectionKey === "remainder" || state.sectionKey === "occasional") {
    steps.push("when");
  }
  steps.push("time", "next", "reminder", "details");
  return steps;
}

export function canContinue(state: WizardState, step: WizardStep): boolean {
  if (step === "what") return state.title.trim().length > 0;
  if (step === "reminder" && state.reminderOn && !isRecurringKey(state.sectionKey)) {
    // A one-shot reminder needs a real moment; an unparseable custom value
    // blocks rather than silently dropping the user's request.
    return reminderAtFor(state) !== undefined;
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* Defaults                                                            */
/* ------------------------------------------------------------------ */

export function defaultWizardState(
  sectionKey: SectionKey = "daily",
  dailyReminderTime = "09:00",
): WizardState {
  return {
    title: "",
    sectionKey,
    dueDate: "",
    hours: "",
    mins: "",
    nextAction: "",
    reminderOn: false,
    reminderPreset: "today7",
    reminderCustom: "",
    reminderTime: dailyReminderTime,
    description: "",
    priority: "medium",
  };
}

/* ------------------------------------------------------------------ */
/* Duration                                                            */
/* ------------------------------------------------------------------ */

/** Planned minutes, or null for a durationless task. Never a fake 0. */
export function durationMinutes(state: Pick<WizardState, "hours" | "mins">): number | null {
  const h = Number(state.hours) || 0;
  const m = Number(state.mins) || 0;
  return normalizeDuration(h * 60 + m);
}

export function durationSummary(state: Pick<WizardState, "hours" | "mins">): string {
  const minutes = durationMinutes(state);
  return minutes === null ? "No duration" : formatMinutes(minutes);
}

/* ------------------------------------------------------------------ */
/* Reminders                                                           */
/* ------------------------------------------------------------------ */

export const REMINDER_PRESETS: { id: ReminderPreset; label: string }[] = [
  { id: "today7", label: "Today at 7:00 PM" },
  { id: "tomorrow9", label: "Tomorrow at 9:00 AM" },
  { id: "custom", label: "Custom" },
];

/** "YYYY-MM-DDTHH:mm" (local, what datetime-local inputs want) from an ISO string. */
export function toLocalInput(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localAt(now: Date, dayOffset: number, hour: number, minute = 0): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset, hour, minute);
  return d.toISOString();
}

/**
 * The ISO moment for a one-shot reminder, or undefined when the user does not
 * want one (or picked nothing usable).
 */
export function reminderAtFor(state: WizardState, now: Date = new Date()): string | undefined {
  if (!state.reminderOn) return undefined;
  // Recurring work is reminded through its own time — see reminderNotifyTime.
  if (isRecurringKey(state.sectionKey)) return undefined;
  switch (state.reminderPreset) {
    case "today7":
      return localAt(now, 0, 19);
    case "tomorrow9":
      return localAt(now, 1, 9);
    case "custom": {
      const parsed = new Date(state.reminderCustom);
      return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : undefined;
    }
  }
}

/** The recurring time for daily/custom work, when the user asked for one. */
export function reminderNotifyTime(state: WizardState): string | undefined {
  if (!state.reminderOn || !isRecurringKey(state.sectionKey)) return undefined;
  return state.reminderTime.trim() || undefined;
}

/** Human copy for the review summary. */
export function reminderSummary(state: WizardState, now: Date = new Date()): string {
  if (!state.reminderOn) return "None";
  if (isRecurringKey(state.sectionKey)) {
    return state.reminderTime ? `Every day at ${state.reminderTime}` : "On";
  }
  const at = reminderAtFor(state, now);
  if (!at) return "On";
  const preset = REMINDER_PRESETS.find((p) => p.id === state.reminderPreset);
  if (state.reminderPreset !== "custom" && preset) return preset.label;
  const d = new Date(at);
  return d.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/* ------------------------------------------------------------------ */
/* Summary + submission                                                */
/* ------------------------------------------------------------------ */

export interface SummaryLine {
  label: string;
  value: string;
}

/** The compact review: one line per fact the user actually filled in. */
export function summaryLines(
  state: WizardState,
  sections: CustomSection[],
  now: Date = new Date(),
): SummaryLine[] {
  const lines: SummaryLine[] = [];

  const sectionLabel = state.sectionKey.startsWith("custom:")
    ? sections.find((s) => s.id === customSectionIdOf(state.sectionKey))?.name ?? "Custom"
    : state.sectionKey === "remainder"
      ? "Reminder"
      : state.sectionKey === "occasional"
        ? "Occasional"
        : "Daily";
  lines.push({ label: "Section", value: sectionLabel });

  // Only custom sections need their schedule spelled out — "Daily" already
  // answers itself, and repeating it would be noise.
  if (state.sectionKey.startsWith("custom:")) {
    const schedule = scheduleContextFor(state.sectionKey, sections);
    if (schedule) lines.push({ label: "Schedule", value: schedule });
  }
  if (state.dueDate) lines.push({ label: "Due", value: state.dueDate });

  lines.push({ label: "Time", value: durationSummary(state) });
  if (state.nextAction.trim()) {
    lines.push({ label: "Next action", value: state.nextAction.trim() });
  }
  lines.push({ label: "Reminder", value: reminderSummary(state, now) });
  if (state.description.trim()) {
    lines.push({ label: "Notes", value: state.description.trim() });
  }
  return lines;
}

/**
 * The draft → the store's `TaskInput`.
 *
 * Optional values that were skipped are omitted entirely (undefined), never
 * written as empty strings, so the task model stays clean.
 */
export function buildTaskInput(state: WizardState, now: Date = new Date()): TaskInput {
  const kind = sectionKindOf(state.sectionKey);
  const customSectionId = customSectionIdOf(state.sectionKey);
  const notifyTime = reminderNotifyTime(state);
  const remindAt = reminderAtFor(state, now);

  return {
    title: state.title.trim(),
    section: kind,
    customSectionId: kind === "custom" ? customSectionId : undefined,
    estimatedMinutes: durationMinutes(state),
    description: state.description.trim() || undefined,
    nextAction: state.nextAction.trim() || undefined,
    dueDate: state.dueDate || undefined,
    priority: state.priority,
    // Exactly one reminder channel can be set — never both.
    notifyTime,
    remindAt,
  };
}
