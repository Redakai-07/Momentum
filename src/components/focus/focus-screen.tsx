"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { ArrowRight, ChevronDown, Pause, Play, SkipForward, Square } from "lucide-react";
import { useStore } from "@/lib/store";
import { ProgressRing } from "@/components/ui/progress-ring";
import { useModalStack } from "@/lib/modal-stack";
import { useFocusEngine } from "./use-focus-engine";
import { elapsedMs, formatClock, phaseLabel, phaseProgress, remainingMs, targetMs } from "@/lib/focus";
import { isTimedTask, remainingMinutesOf } from "@/lib/duration";
import { formatMinutes } from "@/lib/format";
import { sectionLabel } from "@/lib/labels";
import { cn } from "@/lib/utils";

/**
 * Focus mode — the whole screen.
 *
 * A Pomodoro is a deliberate state, not a widget: showing a 25-minute countdown
 * inside a scrolling task sheet invites the user to keep reading the sheet. So
 * starting a session takes over the app, and everything else is one tap away
 * through the minimise control.
 *
 * Deliberately austere: the clock, the task, the controls, and nothing that
 * competes with them. The session keeps running while minimised, and the
 * ambient banner is the way back in.
 */
export function FocusScreen() {
  const session = useStore((s) => s.focusSession);
  const open = useStore((s) => s.focusScreenOpen);
  const minimize = useStore((s) => s.minimizeFocusScreen);
  const settings = useStore((s) => s.focusSettings);
  const pauseFocus = useStore((s) => s.pauseFocus);
  const resumeFocus = useStore((s) => s.resumeFocus);
  const skipFocusPhase = useStore((s) => s.skipFocusPhase);
  const stopFocus = useStore((s) => s.stopFocus);

  const task = useStore((s) => s.tasks.find((t) => t.id === s.focusSession?.taskId) ?? null);
  const sections = useStore((s) => s.sections);

  const tick = useFocusEngine();
  const visible = open && Boolean(session);

  // Back button / Escape leaves focus mode rather than the app — the session
  // itself is untouched, so this is a dismissal, not a cancel.
  useModalStack("focus-screen", "Focus session", minimize, visible);

  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") minimize();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [visible, minimize]);

  if (!visible || !session || typeof document === "undefined") return null;

  const focus = session.phase === "focus";
  // Before the first tick the phase shows at full length: correct for a just-
  // started block, self-correcting one frame later for a restored one.
  const remaining =
    tick === null
      ? targetMs(session.phase, { ...settings, focusMinutes: session.focusMinutes })
      : remainingMs(session, { ...settings, focusMinutes: session.focusMinutes }, tick);
  const pct =
    tick === null
      ? 0
      : phaseProgress(session, { ...settings, focusMinutes: session.focusMinutes }, tick);
  const blocks = session.blocksInSession ?? settings.sessionsBeforeLongBreak;
  const performed = session.focusDoneToday;
  const cycleBlock = focus
    ? (performed % blocks) + 1
    : performed % blocks || blocks;
  const label = task ? sectionLabel(task, sections) : null;
  const taskMinutesLeft = task
    ? Math.max(
        0,
        remainingMinutesOf(task) -
          (session.phase === "focus"
            ? elapsedMs(session, tick ?? session.updatedAt) / 60_000
            : 0),
      )
    : 0;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${phaseLabel(session.phase)} session${task ? ` for ${task.title}` : ""}`}
      className={cn(
        "anim-fade-in fixed inset-0 z-[60] flex flex-col bg-background",
        // Edge-to-edge stays intact: the surface runs under the status bar and
        // the gesture area, while the content is inset so nothing is clipped.
        "pt-[calc(max(env(safe-area-inset-top),var(--momentum-safe-area-inset-top,0px))+0.75rem)]",
        "pb-[calc(max(env(safe-area-inset-bottom),var(--momentum-safe-area-inset-bottom,0px))+1.25rem)]",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute -top-32 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full blur-3xl",
          focus ? "bg-primary/10" : "bg-success/10",
        )}
      />

      {/* Escape hatch first: a full-screen timer must never feel like a trap. */}
      <div className="relative flex items-center justify-between px-5">
        <button
          type="button"
          onClick={minimize}
          className="flex items-center gap-1.5 rounded-full px-1 py-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          <ChevronDown className="h-4 w-4" strokeWidth={2} />
          Minimise
        </button>
        <span
          className={cn(
            "rounded-full px-2.5 py-1 font-mono text-[10px] font-medium uppercase tracking-[0.16em]",
            focus ? "bg-primary/12 text-primary" : "bg-success/12 text-success",
          )}
        >
          {phaseLabel(session.phase)}
        </span>
      </div>

      <div className="relative flex flex-1 flex-col items-center justify-center gap-7 px-6">
        <div className="max-w-sm text-center">
          {label && (
            <p className="font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              {label.icon ? `${label.icon} ` : ""}
              {label.title}
            </p>
          )}
          <h1 className="mt-1.5 text-balance text-[21px] font-semibold leading-tight tracking-tight text-foreground sm:text-[24px]">
            {task?.title ?? "Focus session"}
          </h1>
        </div>

        <ProgressRing
          value={pct}
          size={248}
          stroke={9}
          className="anim-ring-in"
          trackClassName={focus ? undefined : "stroke-success/20"}
          progressClassName={focus ? undefined : "stroke-success"}
          label={`${formatClock(remaining)} remaining in ${phaseLabel(session.phase).toLowerCase()}`}
        >
          <div className="text-center">
            <div
              className={cn(
                "tnum text-[54px] font-semibold leading-none tracking-tight text-foreground",
                !focus && "text-success",
              )}
              role="timer"
              aria-live="off"
            >
              {formatClock(remaining)}
            </div>
            <div className="mt-2 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              {session.status === "paused" ? "Paused" : focus ? "Focus" : "Break"}
            </div>
          </div>
        </ProgressRing>

        {/* Cadence: how far into today's set of blocks this session is. */}
        <div className="flex flex-col items-center gap-2">
          <div className="flex items-center gap-1.5" aria-hidden>
            {Array.from({ length: blocks }).map((_, i) => (
              <span
                key={i}
                className={cn(
                  "h-1.5 rounded-full transition-all duration-300",
                  i < performed
                    ? "w-5 bg-primary"
                    : i === performed && focus
                      ? "w-5 bg-primary/40"
                      : "w-2 bg-muted",
                )}
              />
            ))}
          </div>
          <p className="font-mono text-[11px] tnum text-muted-foreground">
            Block {cycleBlock} of {blocks} in this cycle
          </p>
        </div>

        {task?.nextAction && (
          <p className="flex max-w-xs items-start gap-1.5 text-center text-[13px] leading-relaxed text-muted-foreground">
            <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" strokeWidth={2.2} />
            <span className="text-balance">{task.nextAction}</span>
          </p>
        )}
      </div>

      <div className="relative flex flex-col items-center gap-3 px-6">
        <div className="flex items-center gap-2">
          {session.status === "running" ? (
            <button
              type="button"
              onClick={pauseFocus}
              className="flex h-14 items-center gap-2 rounded-full bg-primary px-7 text-[15px] font-semibold text-primary-foreground transition-transform duration-150 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
            >
              <Pause className="h-4 w-4" strokeWidth={2.4} /> Pause
            </button>
          ) : (
            <button
              type="button"
              onClick={resumeFocus}
              className="flex h-14 items-center gap-2 rounded-full bg-primary px-7 text-[15px] font-semibold text-primary-foreground transition-transform duration-150 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
            >
              <Play className="h-4 w-4" strokeWidth={2.4} /> Resume
            </button>
          )}
          <button
            type="button"
            onClick={skipFocusPhase}
            aria-label={focus ? "Skip to break" : "Skip break"}
            className="grid h-14 w-14 place-items-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            <SkipForward className="h-4 w-4" strokeWidth={2.2} />
          </button>
          <button
            type="button"
            onClick={stopFocus}
            aria-label="Stop focus session"
            className="grid h-14 w-14 place-items-center rounded-full border border-border text-muted-foreground transition-colors hover:border-destructive/40 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            <Square className="h-3.5 w-3.5" strokeWidth={2.2} />
          </button>
        </div>

        {task && isTimedTask(task) && (
          <p className="font-mono text-[11px] tnum text-muted-foreground">
            {formatMinutes(taskMinutesLeft)} left on this task
          </p>
        )}
      </div>
    </div>,
    document.body,
  );
}
