import type { Task } from "./types";

/** Done = finished today's work OR permanently accomplished. */
export const isTaskDone = (t: Task): boolean => t.status !== "active";

/** Finished normally (today's recurring work or a completed one-off). */
export const isTaskCompleted = (t: Task): boolean => t.status === "completed";

/** Permanently retired goal kept as history. */
export const isTaskAccomplished = (t: Task): boolean => t.status === "accomplished";

/** Still part of active work. */
export const isTaskOpen = (t: Task): boolean => t.status === "active";

/** Tasks that can become accomplishments (bucket-list items cannot). */
export const canAccomplish = (t: Task): boolean =>
  (t.section === "daily" || t.section === "remainder") &&
  !isTaskAccomplished(t);

/**
 * Pure transition: permanently retire a goal into an accomplishment.
 * The record is preserved in place (title, section, description, estimate,
 * schedule, next action) — only the lifecycle fields change. Time logs keep
 * referencing the task id, so its history remains intact.
 */
export function toAccomplished(
  task: Task,
  nowIso: string = new Date().toISOString(),
): Task {
  return {
    ...task,
    status: "accomplished",
    accomplishedAt: nowIso,
    completedAt: task.completedAt ?? nowIso,
    remainingMinutes: 0,
  };
}
