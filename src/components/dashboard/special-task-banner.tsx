"use client";

import { useEffect, useState } from "react";
import { ArrowRight, Star } from "lucide-react";
import type { Task } from "@/lib/types";
import { formatMinutes } from "@/lib/format";
import { cn } from "@/lib/utils";

function SpecialCard({
  task,
  onOpen,
}: {
  task: Task;
  onOpen: (t: Task) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(task)}
      className="anim-fade-up group flex w-full items-center gap-3.5 px-4 py-3.5 text-left transition-colors hover:bg-muted/30 focus-visible:outline-none"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-signal-soft text-signal">
        <Star className="h-[17px] w-[17px]" fill="currentColor" strokeWidth={0} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-mono text-[9.5px] font-medium uppercase tracking-[0.18em] text-signal">
          Special task · due today
        </span>
        <span className="mt-0.5 block truncate text-[14.5px] font-semibold tracking-tight text-foreground">
          {task.title}
        </span>
        {task.nextAction && (
          <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            <ArrowRight className="h-3 w-3 shrink-0 text-signal" strokeWidth={2.2} />
            <span className="truncate">{task.nextAction}</span>
          </span>
        )}
      </span>
      {task.estimatedMinutes > 0 && (
        <span className="shrink-0 font-mono text-[13px] tnum text-foreground/85">
          {formatMinutes(task.estimatedMinutes)}
        </span>
      )}
      <ArrowRight
        className="hidden shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5 sm:block"
        strokeWidth={1.75}
      />
    </button>
  );
}

export function SpecialTaskBanner({
  tasks,
  onOpen,
}: {
  tasks: Task[];
  onOpen: (t: Task) => void;
}) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (tasks.length < 2) return;
    const id = window.setInterval(
      () => setIndex((i) => (i + 1) % tasks.length),
      4500,
    );
    return () => window.clearInterval(id);
  }, [tasks.length]);

  if (tasks.length === 0) return null;
  // Clamp so a shrinking list never leaves the index out of range.
  const current = tasks[Math.min(index, tasks.length - 1)];

  return (
    <div className="overflow-hidden rounded-xl border border-signal/35 bg-card shadow-soft">
      <div key={current.id}>
        <SpecialCard task={current} onOpen={onOpen} />
      </div>
      {tasks.length > 1 && (
        <div
          className="flex items-center justify-center gap-1 pb-2.5"
          aria-label={`${tasks.length} special tasks, showing ${index + 1} of ${tasks.length}`}
        >
          {tasks.map((t, i) => (
            <button
              key={t.id}
              type="button"
              aria-label={`Show special task: ${t.title}`}
              onClick={() => setIndex(i)}
              className="group flex h-5 w-5 items-center justify-center rounded-full"
            >
              <span
                className={cn(
                  "h-1 rounded-full transition-all duration-300 group-hover:bg-muted-foreground/50",
                  i === index ? "w-4 bg-signal/70" : "w-1 bg-muted-foreground/25",
                )}
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
