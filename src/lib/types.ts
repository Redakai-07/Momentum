/** Weekday index, matching Date#getDay(): 0 = Sunday … 6 = Saturday. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type ScheduleType = "daily" | "weekly" | "custom" | "monthly-date" | "monthly-weekday";

export type MonthOccurrence = "first" | "second" | "third" | "fourth" | "last";

export interface Schedule {
  type: ScheduleType;
  /** Weekdays the task recurs on (weekly/custom). Monday-first when rendered. */
  days?: Weekday[];
  /** Day of month for monthly-date schedules. Invalid dates are skipped. */
  dayOfMonth?: number | "last";
  /** Weekday position for monthly-weekday schedules. */
  occurrence?: MonthOccurrence;
  /** Weekday for monthly-weekday schedules. */
  weekday?: Weekday;
  /** Local "HH:MM" 24h. */
  startTime?: string;
  endTime?: string;
}

export type SectionKind = "daily" | "remainder" | "occasional" | "custom";

export type Priority = "low" | "medium" | "high";

/**
 * Planned duration of a task, in minutes.
 *
 * Momentum has two kinds of task:
 *
 * - **time-based** (`estimatedMinutes > 0`) — Daily and custom-section work
 *   where planned/completed/remaining minutes matter. These contribute to the
 *   time-based daily performance.
 * - **completion-based** (`estimatedMinutes === null`) — Reminder and
 *   Occasional items where a duration is meaningless ("Submit scholarship
 *   form"). These are tracked purely by completion state and never contribute
 *   planned or completed minutes, so they can never distort performance.
 */
export type TaskDuration = number | null;

/**
 * Lifecycle of a task.
 * - `active`      still part of your daily/backlog work
 * - `completed`   finished (day-level for recurring tasks, permanent for one-offs)
 * - `accomplished`permanently retired goal — kept as history, hidden from lists
 */
export type TaskStatus = "active" | "completed" | "accomplished";

export interface Task {
  id: string;
  title: string;
  section: SectionKind;
  customSectionId?: string;
  /**
   * Planned time for this task in minutes, or `null` for completion-based
   * work (see {@link TaskDuration}). Legacy rows may still carry `undefined`
   * or `0`; use the helpers in lib/duration.ts rather than reading this
   * directly.
   */
  estimatedMinutes: TaskDuration;
  /** What is left today / for this instance, in minutes (always 0 when untimed). */
  remainingMinutes: number;
  description?: string;
  /** Concrete next step — turns vague tasks into actionable ones. */
  nextAction?: string;
  /** YYYY-MM-DD (local). Tasks with a due date surface as Special Tasks. */
  dueDate?: string;
  priority?: Priority;
  /** Legacy per-task schedule. New tasks inherit their section schedule. */
  schedule?: Schedule;
  status: TaskStatus;
  createdAt: string;
  completedAt?: string;
  /** Set when the task was permanently converted into an accomplishment. */
  accomplishedAt?: string;
}

export interface TimeLog {
  id: string;
  taskId: string;
  minutes: number;
  /** YYYY-MM-DD (local). */
  date: string;
}

/** How a calendar day is treated by the performance system. */
export type DayKind = "normal" | "recovery" | "inactive";

export interface DailyPerformance {
  /** YYYY-MM-DD (local). */
  date: string;
  plannedMinutes: number;
  completedMinutes: number;
  /** 0–100, or null when the day had no planned activity ("rest day"). */
  percentage: number | null;
  /**
   * Classification of the day.
   * - normal    counted normally
   * - recovery  an earned, limited day where a missed day did not break the streak
   * - inactive  nothing planned (neutral)
   */
  kind?: DayKind;
}

export interface CustomSection {
  id: string;
  name: string;
  icon?: string;
  schedule: Schedule;
  createdAt: string;
}

/* ------------------------------------------------------------------ */
/* Hobby & Notes — a separate, optional space                          */
/* ------------------------------------------------------------------ */

/**
 * Accent hues available to a hobby card.
 *
 * Deliberately a small, curated set rather than a free colour picker: each one
 * has hand-tuned light/dark variants in globals.css so hobby cards always keep
 * readable contrast, whatever theme the user picked.
 */
export type HobbyAccent =
  | "teal"
  | "blue"
  | "purple"
  | "green"
  | "orange"
  | "red"
  | "pink"
  | "sand";

/**
 * An interest or personal area — a category, not a task.
 *
 * Hobbies deliberately carry no schedule, due date, completion or streak:
 * they exist to group notes and give the personal side of Momentum a home.
 */
export interface Hobby {
  id: string;
  name: string;
  description?: string;
  /** Emoji or short glyph shown on the hobby card. */
  icon?: string;
  /** Optional visual identity for the card. */
  accent?: HobbyAccent;
  createdAt: string;
  updatedAt: string;
}

/**
 * A lightweight personal note.
 *
 * Notes are intentionally plain: a title, free text, and an optional hobby to
 * belong to. They never enter the task, scheduling, performance or streak
 * systems.
 */
export interface Note {
  id: string;
  /** Optional hobby association — notes may also stand alone. */
  hobbyId?: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Personal settings that are not user-configurable.
 * `streakThreshold` is the percentage required on a day for the streak to
 * survive — see lib/config.ts for the recovery-day rules.
 *
 * The display name is user-configurable (Profile → Settings) and persists in
 * the meta table; this constant is only the initial fallback.
 */
export const DEFAULT_PROFILE_NAME = "User";

export const PROFILE = {
  streakThreshold: 0.7,
} as const;
