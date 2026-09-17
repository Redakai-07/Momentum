"use client";

import { useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Star } from "lucide-react";
import { PageFrame, PageHeader } from "@/components/layout/page-frame";
import { useMounted, useNow } from "@/lib/hooks";
import { useStore } from "@/lib/store";
import { taskOccursOn, tasksForDay } from "@/lib/schedule";
import { MONTHS_FULL, WEEKDAYS_MON_FIRST, dateKey, isSameMonth, monthGrid } from "@/lib/date";
import type { Task } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ListShell, ListSkeleton } from "@/components/ui/list";
import { Button } from "@/components/ui/button";
import { TaskRow } from "@/components/tasks/task-row";
import { TaskDetailModal } from "@/components/tasks/task-detail";

interface CellInfo {
  date: Date;
  key: string;
  openCount: number;
  special: boolean;
}

/**
 * Day marker.
 *
 * A dot on *every* square is what made the month read like a table grid: with
 * a daily task, each cell carried the same mark and the eye saw ruled columns
 * instead of a month. The marker now means "something is scheduled that you
 * have not finished", which is worth noticing, and a completed day simply goes
 * quiet.
 */

export function CalendarView() {
  const mounted = useMounted();
  const ready = useStore((s) => s.ready);
  const now = useNow();
  const tasks = useStore((s) => s.tasks);
  const sections = useStore((s) => s.sections);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const today = mounted && now ? now : null;
  const [viewAnchor, setViewAnchor] = useState<Date | null>(null);
  const [selected, setSelected] = useState<Date | null>(null);
  const view = useMemo(() => viewAnchor ?? (today ?? new Date()), [viewAnchor, today]);

  const cells: CellInfo[] = useMemo(() => {
    const grid = monthGrid(view.getFullYear(), view.getMonth());
    return grid.map((date) => {
      const key = dateKey(date);
      let openCount = 0;
      let special = false;
      for (const task of tasks) {
        if (!taskOccursOn(task, key, sections)) continue;
        // A task cannot be outstanding on a day that predates it. Recurrence
        // itself is untouched — this only stops the calendar from claiming
        // work existed before the user created it.
        if (task.createdAt.slice(0, 10) > key) continue;
        if (task.status === "active") openCount += 1;
        if (task.status === "active" && task.dueDate === key) special = true;
      }
      return { date, key, openCount, special };
    });
  }, [sections, tasks, view]);

  const selectedKey = selected ? dateKey(selected) : today ? dateKey(today) : null;
  const dayTasks: Task[] = useMemo(
    () => (selectedKey ? tasksForDay(tasks, selectedKey, sections) : []),
    [sections, selectedKey, tasks],
  );
  const monthLabel = `${MONTHS_FULL[view.getMonth()]} ${view.getFullYear()}`;
  const canGoPrev = view.getFullYear() > 2020 || view.getMonth() > 0;
  const dayHeading = selectedKey
    ? new Date(`${selectedKey}T12:00:00`).toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
      })
    : "";

  return (
    <PageFrame wide>
      <PageHeader
        eyebrow="Schedule"
        title="Calendar"
        sub="Pick a day to see what is planned."
        aside={
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Previous month"
              disabled={!canGoPrev}
              onClick={() => setViewAnchor(new Date(view.getFullYear(), view.getMonth() - 1, 1))}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="w-[132px] font-medium tnum"
              onClick={() => {
                const current = today ?? new Date();
                setViewAnchor(new Date(current.getFullYear(), current.getMonth(), 1));
                setSelected(current);
              }}
            >
              {monthLabel}
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Next month"
              onClick={() => setViewAnchor(new Date(view.getFullYear(), view.getMonth() + 1, 1))}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        }
      />

      {!mounted || !ready || !today ? (
        <ListSkeleton rows={5} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="surface min-w-0 rounded-2xl px-3 py-5 sm:px-5">
            <div className="grid grid-cols-7">
              {WEEKDAYS_MON_FIRST.map((day) => (
                <div
                  key={day}
                  className="pb-4 text-center font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground/60"
                >
                  {day.slice(0, 1)}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-y-0.5">
              {cells.map((cell) => {
                const inMonth = isSameMonth(cell.date, view);
                const isToday = dateKey(today) === cell.key;
                const isSelected = selectedKey === cell.key;
                return (
                  <button
                    key={cell.key}
                    type="button"
                    aria-label={`${cell.date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}${cell.openCount > 0 ? `, ${cell.openCount} open tasks` : ""}`}
                    aria-pressed={isSelected}
                    onClick={() => {
                      setSelected(cell.date);
                      if (!inMonth) setViewAnchor(new Date(cell.date.getFullYear(), cell.date.getMonth(), 1));
                    }}
                    className="group relative flex min-h-11 min-w-0 items-center justify-center rounded-lg transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                  >
                    {/* Selected reads as a soft ring; today reads as a solid
                        disc. Two states, two shapes, neither shouting. */}
                    {isSelected && !isToday && (
                      <span
                        aria-hidden
                        className="absolute inset-x-1.5 inset-y-0.5 rounded-lg bg-muted"
                      />
                    )}
                    <span
                      className={cn(
                        "relative grid h-7 w-7 place-items-center rounded-full font-mono text-[11.5px] tnum transition-colors",
                        isToday && "bg-primary font-semibold text-primary-foreground",
                        !isToday && isSelected && "font-semibold text-foreground",
                        !isToday && !isSelected && inMonth && "text-foreground/85 group-hover:bg-muted",
                        !inMonth && "text-muted-foreground/30",
                      )}
                    >
                      {cell.date.getDate()}
                    </span>
                    <span aria-hidden className="absolute bottom-0.5 flex items-center gap-1">
                      {cell.special ? (
                        <Star className="h-2.5 w-2.5 text-signal" fill="currentColor" strokeWidth={0} />
                      ) : cell.openCount > 0 ? (
                        <span
                          className={cn(
                            "h-1 w-1 rounded-full",
                            isToday || isSelected ? "bg-primary" : "bg-primary/45",
                          )}
                        />
                      ) : null}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border/50 px-0.5 pt-3 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="h-1 w-1 rounded-full bg-primary/60" /> work left
              </span>
              <span className="flex items-center gap-1.5">
                <Star className="h-2.5 w-2.5 text-signal" fill="currentColor" strokeWidth={0} /> due date
              </span>
            </div>
          </div>

          <aside className="lg:sticky lg:top-8 lg:self-start">
            <div className="mb-2 flex items-center justify-between px-0.5">
              <h2 className="text-sm font-semibold tracking-tight text-foreground">{dayHeading}</h2>
              <Button variant="ghost" size="sm" onClick={() => setSelected(today)} className="font-mono text-[11px] uppercase tracking-wide">Today</Button>
            </div>
            {dayTasks.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border/70 px-4 py-8 text-center">
                <CalendarDays className="mx-auto h-4 w-4 text-muted-foreground/60" strokeWidth={1.5} />
                <p className="mt-2 text-[13px] font-medium text-muted-foreground">No planned activity</p>
                <p className="mt-0.5 text-xs text-muted-foreground/70">A clear day.</p>
              </div>
            ) : (
              <ListShell>{dayTasks.map((task) => <TaskRow key={task.id} task={task} onOpen={(item) => setSelectedId(item.id)} scheduledOnly />)}</ListShell>
            )}
          </aside>
        </div>
      )}

      <TaskDetailModal taskId={selectedId} onClose={() => setSelectedId(null)} showCompleteAction={false} showAccomplishAction={false} showTimeLogControl={false} />
    </PageFrame>
  );
}
