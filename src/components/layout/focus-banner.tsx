"use client";

import { Maximize2, Pause, Play, Timer } from "lucide-react";
import { useStore } from "@/lib/store";
import { useFocusEngine } from "@/components/focus/use-focus-engine";
import { formatClock, phaseLabel, remainingMs, targetMs } from "@/lib/focus";
import { cn } from "@/lib/utils";

/**
 * The way back into a running focus session.
 *
 * Focus mode occupies the whole screen; minimising it hides the timer without
 * pausing it. This is the thread back — and the `Maximise` affordance makes
 * that obvious rather than leaving the user to guess that the row is clickable.
 *
 * Deliberately quiet: one line, no card, no shadow.
 */
export function FocusBanner() {
  const session = useStore((s) => s.focusSession);
  const screenOpen = useStore((s) => s.focusScreenOpen);
  const settings = useStore((s) => s.focusSettings);
  const openFocusScreen = useStore((s) => s.openFocusScreen);
  const pauseFocus = useStore((s) => s.pauseFocus);
  const resumeFocus = useStore((s) => s.resumeFocus);
  const taskTitle = useStore((s) =>
    s.focusSession ? (s.tasks.find((t) => t.id === s.focusSession!.taskId)?.title ?? "") : "",
  );

  const tick = useFocusEngine();

  // Nothing to point at while focus mode is already on screen.
  if (!session || screenOpen) return null;

  const remaining =
    tick === null
      ? targetMs(session.phase, settings)
      : remainingMs(session, settings, tick);
  const focus = session.phase === "focus";
  const running = session.status === "running";

  return (
    <div
      className={cn(
        "anim-fade-in mb-4 flex items-center gap-3 rounded-xl border px-3 py-2",
        focus ? "border-primary/25 bg-primary/5" : "border-success/25 bg-success/5",
      )}
      role="status"
    >
      <Timer
        className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
        strokeWidth={2}
      />
      <button
        type="button"
        onClick={openFocusScreen}
        aria-label={`Open focus mode — ${phaseLabel(session.phase)} for ${taskTitle}`}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
      >
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-foreground">
          {phaseLabel(session.phase)}
          {taskTitle ? <span className="text-muted-foreground"> · {taskTitle}</span> : null}
        </span>
        <span className="shrink-0 font-mono text-[13px] font-semibold tnum text-foreground">
          {formatClock(remaining)}
        </span>
        <Maximize2 className="h-3 w-3 shrink-0 text-muted-foreground" strokeWidth={2} />
      </button>
      <button
        type="button"
        aria-label={running ? "Pause focus session" : "Resume focus session"}
        onClick={() => (running ? pauseFocus() : resumeFocus())}
        className="shrink-0 rounded-md border border-border px-1.5 py-1 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
      >
        {running ? (
          <Pause className="h-3 w-3" strokeWidth={2} />
        ) : (
          <Play className="h-3 w-3" strokeWidth={2} />
        )}
      </button>
    </div>
  );
}
