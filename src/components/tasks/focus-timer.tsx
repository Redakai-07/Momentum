"use client";

import { Maximize2, Pause, Play, Square, Timer } from "lucide-react";
import type { Task } from "@/lib/types";
import { useStore } from "@/lib/store";
import { formatClock, phaseLabel, remainingMs, targetMs } from "@/lib/focus";
import { isTimedTask } from "@/lib/duration";
import { isTaskDone } from "@/lib/task-state";
import { Button } from "@/components/ui/button";
import { useFocusEngine } from "@/components/focus/use-focus-engine";

/**
 * Focus entry point inside a task.
 *
 * This is a launcher, not a second timer: running a block means focus mode owns
 * the screen, so showing a live countdown *here* as well would be two clocks
 * competing for the same job. The row it shows while a session is live is a
 * status line with a way back in.
 */
export function FocusTimer({ task }: { task: Task }) {
  const session = useStore((s) => s.focusSession);
  const settings = useStore((s) => s.focusSettings);
  const startFocus = useStore((s) => s.startFocus);
  const pauseFocus = useStore((s) => s.pauseFocus);
  const resumeFocus = useStore((s) => s.resumeFocus);
  const stopFocus = useStore((s) => s.stopFocus);
  const openFocusScreen = useStore((s) => s.openFocusScreen);

  const tick = useFocusEngine();

  if (!isTimedTask(task)) return null;

  const mine = session?.taskId === task.id ? session : null;
  const done = isTaskDone(task);
  const other = session && session.taskId !== task.id ? session : null;

  /* A session is live for THIS task — status + way back in. */
  if (mine) {
    const remaining =
      tick === null ? targetMs(mine.phase, settings) : remainingMs(mine, settings, tick);
    return (
      <div className="rounded-xl border border-primary/25 bg-primary/5 p-3.5">
        <div className="flex items-center justify-between gap-3">
          <p className="flex items-center gap-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            <Timer className="h-3 w-3" strokeWidth={2} />
            {phaseLabel(mine.phase)}
            {mine.status === "paused" && <span className="text-foreground/70">· paused</span>}
          </p>
          <p className="font-mono text-[13px] font-semibold tnum text-foreground">
            {formatClock(remaining)}
          </p>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <Button size="sm" variant="primary" onClick={openFocusScreen}>
            <Maximize2 className="h-3.5 w-3.5" /> Open focus mode
          </Button>
          {mine.status === "running" ? (
            <Button size="sm" variant="ghost" onClick={pauseFocus}>
              <Pause className="h-3.5 w-3.5" /> Pause
            </Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={resumeFocus}>
              <Play className="h-3.5 w-3.5" /> Resume
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={stopFocus}>
            <Square className="h-3 w-3" /> Stop
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border/70 bg-muted/25 p-3.5">
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
          <Timer className="h-3 w-3" strokeWidth={2} />
          Focus
        </p>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 text-[12.5px] leading-relaxed text-muted-foreground">
          {done
            ? "This task is done for today."
            : other
              ? "Another task already has a focus session running."
              : `Work in ${settings.focusMinutes}-minute blocks. Logged time counts toward the task, same as always.`}
        </p>
        {other ? (
          <Button size="sm" variant="soft" onClick={openFocusScreen}>
            <Maximize2 className="h-3.5 w-3.5" /> Resume session
          </Button>
        ) : (
          <Button
            size="sm"
            variant="soft"
            disabled={done}
            onClick={() => startFocus(task.id)}
          >
            <Play className="h-3.5 w-3.5" /> Start focus
          </Button>
        )}
      </div>
    </div>
  );
}
