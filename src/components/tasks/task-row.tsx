"use client";

import { cn } from "@/lib/utils";
import type { Task } from "@/lib/types";
import { formatMinutes } from "@/lib/format";
import { parseKey } from "@/lib/date";
import { isTaskDone } from "@/lib/task-state";
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
}: {
  task: Task;
  onOpen?: (t: Task) => void;
  onToggle?: (t: Task) => void;
  /** Overrides the default remaining-minutes label (e.g. "1h" planned). */
  rightLabel?: string;
}) {
  const clickable = Boolean(onOpen);
  const done = isTaskDone(task);
  const hint = !done ? dueHint(task) : null;

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
        "group flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-150",
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
          className="-ml-0.5 rounded p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
        >
          <CheckboxBox checked={done} />
        </button>
      )}

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-x-2 gap-y-0.5">
          <span
            className={cn(
              "truncate text-[14.5px] font-medium tracking-tight transition-colors",
              done
                ? "text-muted-foreground/70 line-through decoration-muted-foreground/50"
                : "text-foreground",
            )}
          >
            {task.title}
          </span>
          {priorityMark(task)}
        </div>
        {!done && (
          <p className="mt-0.5 flex items-center gap-2 font-mono text-[11.5px] tnum text-muted-foreground">
            {task.estimatedMinutes > 0 &&
              (rightLabel ??
                `${formatMinutes(task.remainingMinutes)} remaining`)}
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
      </div>
    </div>
  );

  return row;
}
