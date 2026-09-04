"use client";

import { cn } from "@/lib/utils";
import type { Task } from "@/lib/types";
import { formatMinutes } from "@/lib/format";
import { parseKey } from "@/lib/date";
import { isTaskDone, isTaskOpen } from "@/lib/task-state";
import { CheckboxBox } from "@/components/ui/checkbox";

function dueChip(task: Task) {
  if (!task.dueDate) return null;
  const today = new Date();
  const todayKey = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, "0"),
    String(today.getDate()).padStart(2, "0"),
  ].join("-");

  const d = parseKey(task.dueDate);
  const overdue = task.dueDate < todayKey;
  const todayDue = task.dueDate === todayKey;
  const soon =
    task.dueDate > todayKey &&
    task.dueDate <=
      (() => {
        const t = new Date();
        t.setDate(t.getDate() + 3);
        return [
          t.getFullYear(),
          String(t.getMonth() + 1).padStart(2, "0"),
          String(t.getDate()).padStart(2, "0"),
        ].join("-");
      })();

  const tone = overdue
    ? "text-destructive"
    : todayDue || soon
      ? "text-signal"
      : "text-muted-foreground";

  let text: string;
  if (overdue) {
    text = `Overdue · ${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
  } else if (todayDue) {
    text = "Due today";
  } else if (soon) {
    text = `Due ${d.toLocaleDateString("en-US", { weekday: "short" })}`;
  } else {
    text = `Due ${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
  }

  return (
    <span
      className={cn(
        "shrink-0 rounded border border-current/25 bg-current/[0.04] px-1 py-px font-mono text-[10px] font-medium tnum",
        tone,
      )}
    >
      {text}
    </span>
  );
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
}: {
  task: Task;
  onOpen?: (t: Task) => void;
  onToggle?: (t: Task) => void;
  /** Overrides the default remaining-minutes label (e.g. "1h" planned). */
  rightLabel?: string;
}) {
  const clickable = Boolean(onOpen);
  const done = isTaskDone(task);
  const active = isTaskOpen(task);
  const showNext = Boolean(task.nextAction) && active;
  const descriptionLine = task.description?.split("\n").find((l) => l.trim()) ?? null;
  const secondary = active
    ? showNext
      ? task.nextAction
      : descriptionLine
    : null;

  const progressPct = done
    ? 1
    : task.estimatedMinutes > 0
      ? Math.max(
          0,
          Math.min(
            1,
            (task.estimatedMinutes - task.remainingMinutes) / task.estimatedMinutes,
          ),
        )
      : 0;

  const row = (
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
        "group flex w-full items-start gap-3 px-4 py-[11px] text-left transition-colors duration-150",
        clickable &&
          "cursor-pointer hover:bg-muted/45 focus-visible:outline-none focus-visible:bg-muted/45",
      )}
    >
      {onToggle && (
        <button
          type="button"
          role="checkbox"
          aria-checked={done}
          aria-label={done ? `Reopen ${task.title}` : `Complete ${task.title}`}
          onClick={(e) => {
            e.stopPropagation();
            onToggle(task);
          }}
          className="mt-px rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
        >
          <CheckboxBox checked={done} />
        </button>
      )}

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span
            className={cn(
              "truncate text-[13.5px] font-medium transition-colors",
              done
                ? "text-muted-foreground/70 line-through decoration-muted-foreground/50"
                : "text-foreground",
            )}
          >
            {task.title}
          </span>
          {priorityMark(task)}
          {dueChip(task)}
        </div>
        {secondary && (
          <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            {showNext && (
              <span aria-hidden className="font-mono text-signal">
                →
              </span>
            )}
            <span className="truncate">{secondary}</span>
          </p>
        )}
      </div>

      <div className="flex shrink-0 flex-col items-end pt-0.5">
        {task.estimatedMinutes > 0 ? (
          <>
            <span
              className={cn(
                "font-mono text-[12.5px] tnum",
                done
                  ? "text-muted-foreground/60 line-through decoration-muted-foreground/40"
                  : "text-foreground/85",
              )}
            >
              {rightLabel ??
                (done
                  ? formatMinutes(task.estimatedMinutes)
                  : formatMinutes(task.remainingMinutes))}
            </span>
            <span className="mt-[7px] h-[3px] w-9 overflow-hidden rounded-full bg-muted">
              <span
                className={cn(
                  "block h-full rounded-full transition-[width] duration-500",
                  done ? "bg-success/70" : "bg-primary/80",
                )}
                style={{ width: `${Math.round(progressPct * 100)}%` }}
              />
            </span>
          </>
        ) : null}
      </div>
    </div>
  );

  return row;
}
