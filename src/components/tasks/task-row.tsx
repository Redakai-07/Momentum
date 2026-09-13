"use client";

import { cn } from "@/lib/utils";
import type { Task } from "@/lib/types";
import { formatMinutes } from "@/lib/format";
import { parseKey } from "@/lib/date";
import { isTaskDone } from "@/lib/task-state";
import {
  completedMinutesOf,
  isTimedTask,
  plannedMinutesOf,
  remainingMinutesOf,
  taskProgress,
} from "@/lib/duration";
import { CheckboxBox } from "@/components/ui/checkbox";

/** Short due label, or null when there is no date worth surfacing. */
function dueHint(task: Task): { text: string; tone: "overdue" | "signal" } | null {
  if (!task.dueDate) return null;
  const t = new Date();
  const todayKey = [
    t.getFullYear(),
    String(t.getMonth() + 1).padStart(2, "0"),
    String(t.getDate()).padStart(2, "0"),
  ].join("-");

  if (task.dueDate < todayKey) {
    const d = parseKey(task.dueDate);
    return {
      text: `Overdue · ${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`,
      tone: "overdue",
    };
  }
  if (task.dueDate === todayKey) return { text: "Due today", tone: "signal" };
  return null;
}

function priorityMark(task: Task) {
  if (!task.priority || task.priority === "medium" || isTaskDone(task)) return null;
  return (
    <span
      className={cn(
        "h-1.5 w-1.5 shrink-0 rounded-full",
        task.priority === "high" ? "bg-signal" : "bg-muted-foreground/50",
      )}
      title={task.priority === "high" ? "High priority" : "Low priority"}
    />
  );
}

export function TaskRow({
  task,
  onOpen,
  onToggle,
  rightLabel,
  scheduledOnly = false,
}: {
  task: Task;
  onOpen?: (t: Task) => void;
  onToggle?: (t: Task) => void;
  /** Overrides the default remaining-minutes label (e.g. "1h" planned). */
  rightLabel?: string;
  /** Show the assignment and planned duration without live completion state. */
  scheduledOnly?: boolean;
}) {
  const clickable = Boolean(onOpen);
  const done = !scheduledOnly && isTaskDone(task);
  const hint = scheduledOnly || done ? null : dueHint(task);
  // Completion-based tasks show no duration line at all — never "0m remaining".
  const timed = isTimedTask(task);
  const showMeta = (scheduledOnly || !done) && (timed || Boolean(hint));

  // Progress is only meaningful for timed work that is part-way through.
  const timed_ = timed && !done && !scheduledOnly;
  const progress = timed_ ? taskProgress(task) : null;
  const started = timed_ && completedMinutesOf(task) > 0;
  const completed = timed_ ? completedMinutesOf(task) : 0;

  return (
    <div
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      aria-label={clickable ? `${task.title} — open details` : undefined}
      onClick={clickable ? () => onOpen?.(task) : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onOpen?.(task);
              }
            }
          : undefined
      }
      className={cn(
        "group relative flex w-full min-w-0 items-start gap-3 px-4 py-3 text-left",
        "transition-colors duration-150",
        clickable &&
          "cursor-pointer hover:bg-muted/45 focus-visible:bg-muted/45 focus-visible:outline-none",
        // A quiet left accent once there is logged time, so in-progress work
        // stands out from untouched rows without adding noise.
        started && "before:absolute before:inset-y-2.5 before:left-0 before:w-[2px] before:rounded-full before:bg-primary/50",
      )}
    >
      {onToggle && !scheduledOnly && (
        <button
          type="button"
          role="checkbox"
          aria-checked={done}
          aria-label={done ? `Reopen ${task.title}` : `Complete ${task.title}`}
          onClick={(e) => {
            e.stopPropagation();
            onToggle(task);
          }}
          className="group/check -ml-0.5 shrink-0 rounded p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
        >
          <CheckboxBox checked={done} />
        </button>
      )}

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-x-2 gap-y-0.5">
          <span
            className={cn(
              "break-words text-[14.5px] font-medium tracking-tight transition-colors duration-200",
              done
                ? "text-muted-foreground/70 line-through decoration-muted-foreground/50"
                : "text-foreground",
            )}
          >
            {task.title}
          </span>
          {priorityMark(task)}
        </div>

        {showMeta && (
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[11.5px] tnum text-muted-foreground">
            {timed &&
              (rightLabel ??
                (scheduledOnly
                  ? `${formatMinutes(plannedMinutesOf(task))} planned`
                  : `${formatMinutes(remainingMinutesOf(task))} remaining`))}
            {hint && (
              <span
                className={cn(
                  "font-medium",
                  hint.tone === "overdue" ? "text-destructive" : "text-signal",
                )}
              >
                {hint.text}
              </span>
            )}
          </p>
        )}

        {/* Time progress — replaces the abstract minutes with something the eye
            can read instantly. Only shown once work has actually started. */}
        {timed_ && started && progress !== null && (
          <div className="mt-2 flex items-center gap-2">
            <div
              className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-label={`${task.title} time progress`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress}
            >
              <div
                className={cn(
                  "h-full rounded-full transition-[width] duration-700 ease-out",
                  progress >= 100 ? "bg-success" : "bg-primary/80",
                )}
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="shrink-0 font-mono text-[10.5px] tnum text-muted-foreground/90">
              {formatMinutes(completed)}/{formatMinutes(
                completed + remainingMinutesOf(task),
              )}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
