"use client";

import { useRef, useState, type PointerEvent } from "react";
import { Maximize2, Minus, Pause, Play, Plus, Square, Timer } from "lucide-react";
import type { Task } from "@/lib/types";
import { useStore } from "@/lib/store";
import { formatClock, phaseLabel, remainingMs, targetMs } from "@/lib/focus";
import { isTimedTask, remainingMinutesOf } from "@/lib/duration";
import { isTaskDone } from "@/lib/task-state";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
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
  const [chooserOpen, setChooserOpen] = useState(false);
  const [selectedMinutes, setSelectedMinutes] = useState(25);
  const dialRef = useRef<HTMLDivElement>(null);
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
  const sessionSettings = mine
    ? { ...settings, focusMinutes: mine.focusMinutes }
    : settings;
  const done = isTaskDone(task);
  const other = session && session.taskId !== task.id ? session : null;
  const taskMinutesLeft = remainingMinutesOf(task);
  const maxMinutes = Math.max(1, taskMinutesLeft);
  const dialRatio = maxMinutes === 1 ? 1 : (selectedMinutes - 1) / (maxMinutes - 1);

  const setMinutesFromPointer = (clientX: number, clientY: number) => {
    const dial = dialRef.current;
    if (!dial) return;
    const bounds = dial.getBoundingClientRect();
    const angle = Math.atan2(
      clientY - (bounds.top + bounds.height / 2),
      clientX - (bounds.left + bounds.width / 2),
    );
    const ratio = (angle + Math.PI / 2 + Math.PI * 2) % (Math.PI * 2) / (Math.PI * 2);
    setSelectedMinutes(Math.max(1, Math.min(maxMinutes, Math.round(1 + ratio * (maxMinutes - 1)))));
  };

  const handleDialPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    setMinutesFromPointer(event.clientX, event.clientY);
  };

  const handleDialPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      setMinutesFromPointer(event.clientX, event.clientY);
    }
  };

  /* A session is live for THIS task — status + way back in. */
  if (mine) {
    const remaining =
      tick === null ? targetMs(mine.phase, sessionSettings) : remainingMs(mine, sessionSettings, tick);
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
              : "Choose a block length before the timer starts. Logged time counts toward the task."}
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
            onClick={() => {
              setSelectedMinutes(Math.min(25, maxMinutes));
              setChooserOpen(true);
            }}
          >
            <Play className="h-3.5 w-3.5" /> Start focus
          </Button>
        )}
      </div>
      <Modal
        open={chooserOpen}
        onClose={() => setChooserOpen(false)}
        eyebrow="Focus session"
        title="How long is this block?"
        className="sm:max-w-md"
      >
        <div className="text-center">
          <div
            ref={dialRef}
            role="slider"
            aria-label="Focus block duration"
            aria-valuemin={1}
            aria-valuemax={maxMinutes}
            aria-valuenow={selectedMinutes}
            tabIndex={0}
            onPointerDown={handleDialPointerDown}
            onPointerMove={handleDialPointerMove}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
                event.preventDefault();
                setSelectedMinutes((minutes) => Math.max(1, minutes - 1));
              }
              if (event.key === "ArrowRight" || event.key === "ArrowUp") {
                event.preventDefault();
                setSelectedMinutes((minutes) => Math.min(maxMinutes, minutes + 1));
              }
            }}
            className="relative mx-auto h-64 w-64 cursor-grab touch-none rounded-full border border-border bg-card shadow-inner active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            {Array.from({ length: 40 }).map((_, index) => {
              const angle = index * 9;
              const active = index / 39 <= dialRatio;
              const major = index % 5 === 0;
              return (
                <span
                  key={angle}
                  aria-hidden
                  className={`absolute left-1/2 top-1/2 origin-center rounded-full transition-colors duration-100 ${active ? "bg-primary" : "bg-muted-foreground/35"}`}
                  style={{
                    width: major ? 3 : 2,
                    height: major ? 18 : 10,
                    transform: `translate(-50%, -50%) rotate(${angle}deg) translateY(-110px)`,
                  }}
                />
              );
            })}
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="font-mono text-5xl font-semibold tracking-tight text-foreground tnum">
                {selectedMinutes}
              </span>
              <span className="mt-1 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                minutes
              </span>
            </div>
            <input
              type="range"
              min={1}
              max={maxMinutes}
              step={1}
              value={selectedMinutes}
              onChange={(e) => setSelectedMinutes(Number(e.target.value))}
              aria-label={`Focus block length, up to ${maxMinutes} minutes`}
              className="sr-only"
            />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">of {taskMinutesLeft} minutes remaining</p>
          <p className="mx-auto mt-3 max-w-xs text-[12px] leading-relaxed text-muted-foreground">
            Keep your phone sound on. A short sound will tell you when it is time to take a break.
          </p>
        </div>

        <div className="mt-2 flex items-center justify-center gap-5">
          <button
            type="button"
            aria-label="Decrease focus duration by one minute"
            disabled={selectedMinutes <= 1}
            onClick={() => setSelectedMinutes((minutes) => Math.max(1, minutes - 1))}
            className="grid h-10 w-10 place-items-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-35"
          >
            <Minus className="h-4 w-4" />
          </button>
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            1 minute steps
          </span>
          <button
            type="button"
            aria-label="Increase focus duration by one minute"
            disabled={selectedMinutes >= maxMinutes}
            onClick={() => setSelectedMinutes((minutes) => Math.min(maxMinutes, minutes + 1))}
            className="grid h-10 w-10 place-items-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-35"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-6 flex justify-end gap-2 border-t border-border/60 pt-4">
          <Button variant="ghost" onClick={() => setChooserOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              setChooserOpen(false);
              startFocus(task.id, selectedMinutes);
              openFocusScreen();
            }}
          >
            <Play className="h-3.5 w-3.5" /> Start {selectedMinutes}m block
          </Button>
        </div>
      </Modal>
    </div>
  );
}
