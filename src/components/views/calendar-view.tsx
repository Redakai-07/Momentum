"use client";

import { useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Star } from "lucide-react";
import { PageFrame, PageHeader } from "@/components/layout/page-frame";
import { useMounted, useNow } from "@/lib/hooks";
import { useStore } from "@/lib/store";
import { taskOccursOn, tasksForDay } from "@/lib/schedule";
import {
  MONTHS_FULL,
  WEEKDAYS_MON_FIRST,
  dateKey,
  isSameMonth,
  monthGrid,
} from "@/lib/date";
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

export function CalendarView() {
  const mounted = useMounted();
  const ready = useStore((s) => s.ready);
  const now = useNow();
  const tasks = useStore((s) => s.tasks);
  const toggleTask = useStore((s) => s.toggleTask);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const today = mounted && now ? now : null;
  const [viewAnchor, setViewAnchor] = useState<Date | null>(null);
  const [selected, setSelected] = useState<Date | null>(null);

  const view = useMemo(
    () => viewAnchor ?? (today ?? new Date()),
    [viewAnchor, today],
  );

  const cells: CellInfo[] = useMemo(() => {
    const grid = monthGrid(view.getFullYear(), view.getMonth());
    return grid.map((date) => {
      const key = dateKey(date);
      let openCount = 0;
      let special = false;
      for (const t of tasks) {
        if (!taskOccursOn(t, key)) continue;
        if (t.status === "active") openCount += 1;
        if (t.status === "active" && t.dueDate === key) special = true;
      }
      return { date, key, openCount, special };
    });
  }, [tasks, view]);

  const selectedKey = selected ? dateKey(selected) : today ? dateKey(today) : null;
  const dayTasks: Task[] = useMemo(
    () => (selectedKey ? tasksForDay(tasks, selectedKey) : []),
    [tasks, selectedKey],
  );

  const monthLabel = `${MONTHS_FULL[view.getMonth()]} ${view.getFullYear()}`;
  const canGoPrev = view.getFullYear() > 2020 || view.getMonth() > 0;

  const dayHeading = selectedKey
    ? (() => {
        const d = new Date(selectedKey + "T12:00:00");
        return d.toLocaleDateString("en-US", {
          weekday: "long",
          month: "long",
          day: "numeric",
        });
      })()
    : "";

  return (
    <PageFrame wide>
      <PageHeader
        eyebrow="Schedule"
        title="Calendar"
        sub="Days with tasks carry a small dot. A star marks a due date."
        aside={
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="Previous month"
              disabled={!canGoPrev}
              onClick={() =>
                setViewAnchor(new Date(view.getFullYear(), view.getMonth() - 1, 1))
              }
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="w-[132px] font-medium tnum"
              onClick={() => {
                const t = today ?? new Date();
                setViewAnchor(new Date(t.getFullYear(), t.getMonth(), 1));
                setSelected(t);
              }}
            >
              {monthLabel}
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="Next month"
              onClick={() =>
                setViewAnchor(new Date(view.getFullYear(), view.getMonth() + 1, 1))
              }
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
          <div>
            <div className="grid grid-cols-7 min-w-0">
              {WEEKDAYS_MON_FIRST.map((d) => (
                <div
                  key={d}
                  className="pb-2 text-center font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground"
                >
                  {d}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-px min-w-0 overflow-hidden rounded-xl border border-border bg-muted/70">
              {cells.map((c) => {
                const key = dateKey(c.date);
                const inMonth = isSameMonth(c.date, view);
                const isToday = today ? dateKey(today) === key : false;
                const isSelected = selectedKey === key;
                return (
                  <button
                    key={key}
                    type="button"
                    aria-label={`${c.date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}${c.openCount > 0 ? `, ${c.openCount} open tasks` : ""}`}
                    aria-pressed={isSelected}
                    onClick={() => {
                      setSelected(c.date);
                      if (!isSameMonth(c.date, view)) {
                        setViewAnchor(
                          new Date(c.date.getFullYear(), c.date.getMonth(), 1),
                        );
                      }
                    }}
                    className={cn(
                      "group relative flex h-[52px] flex-col items-center justify-between py-1 transition-colors sm:h-14 lg:h-[62px] min-w-0",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60",
                      !inMonth && "bg-card/40",
                      isSelected
                        ? "bg-primary/[0.07] ring-1 ring-inset ring-primary/50"
                        : "bg-card hover:bg-muted/70",
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-5 min-w-5 items-center justify-center rounded-md px-1 font-mono text-[11px] tnum transition-colors",
                        !inMonth && "text-muted-foreground/40",
                        isToday
                          ? "bg-primary font-semibold text-primary-foreground"
                          : c.openCount > 0
                            ? "text-foreground"
                            : "text-muted-foreground/70",
                      )}
                    >
                      {c.date.getDate()}
                    </span>
                    <span className="flex h-2 items-center gap-[3px]">
                      {c.special ? (
                        <Star
                          className="h-2.5 w-2.5 text-signal"
                          fill="currentColor"
                          strokeWidth={0}
                        />
                      ) : c.openCount > 0 ? (
                        <span
                          className={cn(
                            "h-1.5 w-1.5 rounded-full",
                            isSelected ? "bg-primary" : "bg-primary/60",
                          )}
                        />
                      ) : (
                        <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/0" />
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="mt-3 flex items-center gap-4 px-1 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-primary/60" /> task scheduled
              </span>
              <span className="flex items-center gap-1.5">
                <Star className="h-2.5 w-2.5 text-signal" fill="currentColor" strokeWidth={0} />
                special / due
              </span>
            </div>
          </div>

          <aside className="lg:sticky lg:top-8 lg:self-start">
            <div className="mb-2 flex items-center justify-between px-0.5">
              <h2 className="text-sm font-semibold tracking-tight text-foreground">
                {dayHeading}
              </h2>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelected(today)}
                className="font-mono text-[11px] uppercase tracking-wide"
              >
                Today
              </Button>
            </div>
            {dayTasks.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center">
                <CalendarDays className="mx-auto h-4 w-4 text-muted-foreground/60" strokeWidth={1.5} />
                <p className="mt-2 text-[13px] font-medium text-muted-foreground">
                  No planned activity
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground/70">
                  A clear day.
                </p>
              </div>
            ) : (
              <ListShell>
                {dayTasks.map((t) => (
                  <TaskRow
                    key={t.id}
                    task={t}
                    onOpen={(x) => setSelectedId(x.id)}
                    onToggle={(x) => toggleTask(x.id)}
                  />
                ))}
              </ListShell>
            )}
          </aside>
        </div>
      )}

      <TaskDetailModal taskId={selectedId} onClose={() => setSelectedId(null)} />
    </PageFrame>
  );
}
