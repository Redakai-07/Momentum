/** Weekday index, matching Date#getDay(): 0 = Sunday … 6 = Saturday. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type ScheduleType = "daily" | "weekly" | "custom";

export interface Schedule {
  type: ScheduleType;
  /** Weekdays the task recurs on (weekly/custom). Monday-first when rendered. */
  days?: Weekday[];
  /** Local "HH:MM" 24h. */
  startTime?: string;
  endTime?: string;
}

export type SectionKind = "daily" | "remainder" | "occasional" | "custom";

export type Priority = "low" | "medium" | "high";

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
  /** Total time this task is planned to take, in minutes. */
  estimatedMinutes: number;
  /** What is left today / for this instance, in minutes. */
  remainingMinutes: number;
  description?: string;
  /** Concrete next step — turns vague tasks into actionable ones. */
  nextAction?: string;
  /** YYYY-MM-DD (local). Tasks with a due date surface as Special Tasks. */
  dueDate?: string;
  priority?: Priority;
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

/**
 * Personal settings that are not user-configurable.
 * `streakThreshold` is the percentage required on a day for the streak to
 * survive — see lib/config.ts for the recovery-day rules.
 *
 * The display name is user-configurable (Profile → Settings) and persists in
 * the meta table; this constant is only the initial fallback.
 */
export const DEFAULT_PROFILE_NAME = "Venkatesh";

export const PROFILE = {
  streakThreshold: 0.7,
} as const;
