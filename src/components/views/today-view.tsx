"use client";

import { useMemo, useState } from "react";
import { ArrowRight, Flame, Plus, SunMedium } from "lucide-react";
import { PageFrame } from "@/components/layout/page-frame";
import { useNow } from "@/lib/hooks";
import { useStore } from "@/lib/store";
import { breakdownForDay } from "@/lib/schedule";
import { workloadForTasks, currentStreak, liveDayRec, type DayRec } from "@/lib/performance";
import { dateKey } from "@/lib/date";
import { PROFILE } from "@/lib/types";
import { formatMinutes, greetingForHour } from "@/lib/format";
import { scheduleSummary } from "@/lib/labels";
import { ListShell, EmptyState, ListSkeleton } from "@/components/ui/list";
import { Button } from "@/components/ui/button";
import { TaskRow } from "@/components/tasks/task-row";
import { TaskDetailModal } from "@/components/tasks/task-detail";
import { TaskFormModal } from "@/components/tasks/task-form";
import { SpecialTaskBanner } from "@/components/dashboard/special-task-banner";
import { WorkloadBar } from "@/components/dashboard/workload-bar";

function StreakPill({ streak }: { streak: number | null }) {
  return (
    <div
      className="flex items-center gap-2.5 rounded-lg border border-signal/25 bg-signal-soft/60 px-3 py-2"
      title={`Current streak · best ${PROFILE.bestStreak} days`}
    >
      <Flame className="h-4 w-4 text-signal" fill="currentColor" strokeWidth={0} />
      <span className="tnum text-[15px] font-semibold leading-none text-signal-foreground">
        {streak ?? "—"}
      </span>
      <span className="hidden font-mono text-[9.5px] font-medium uppercase tracking-[0.14em] text-signal-foreground/80 sm:block">
        day streak
      </span>
    </div>
  );
}

function GroupSection({
  title,
  icon,
  sub,
  tasks,
  onOpen,
  onToggle,
  onAdd,
}: {
  title: string;
  icon?: string;
  sub?: string;
  tasks: import("@/lib/types").Task[];
  onOpen: (t: import("@/lib/types").Task) => void;
  onToggle: (t: import("@/lib/types").Task) => void;
  onAdd: () => void;
}) {
  const open = tasks.filter((t) => !t.completed).length;
  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between gap-3 px-0.5">
        <div className="flex min-w-0 items-baseline gap-2">
          {icon && <span className="text-[13px] leading-none">{icon}</span>}
          <h2 className="text-[13px] font-semibold tracking-tight text-foreground">
            {title}
          </h2>
          <span className="font-mono text-[10.5px] tnum text-muted-foreground">
            {open > 0 ? `${open} left` : "done"}
          </span>
          {sub && (
            <span className="hidden truncate font-mono text-[10.5px] text-muted-foreground/70 sm:block">
              · {sub}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onAdd}
          aria-label={`Add a task to ${title}`}
          className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      </div>
      <ListShell>
        {tasks.map((t) => (
          <TaskRow key={t.id} task={t} onOpen={onOpen} onToggle={onToggle} />
        ))}
      </ListShell>
    </section>
  );
}

export function TodayView() {
  const now = useNow();
  const tasks = useStore((s) => s.tasks);
  const sections = useStore((s) => s.sections);
  const logs = useStore((s) => s.logs);
  const history = useStore((s) => s.history);
  const toggleTask = useStore((s) => s.toggleTask);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [formSection, setFormSection] = useState<
    "daily" | "remainder" | "occasional" | `custom:${string}`
  >("daily");

  const derived = useMemo(() => {
    if (!now) return null;
    const key = dateKey(now);
    const breakdown = breakdownForDay(tasks, sections, key);
    const workload = workloadForTasks(tasks, key);

    const live = liveDayRec(tasks, logs, key);
    const recs: DayRec[] = history.map((h) => ({
      date: h.date,
      plannedMinutes: h.plannedMinutes,
      completedMinutes: h.completedMinutes,
      percentage: h.percentage,
    }));
    const streak = currentStreak([...recs, live], key);

    const nextActions = [...breakdown.specials, ...breakdown.groups.flatMap((g) => g.tasks)]
      .filter((t) => !t.completed && t.nextAction)
      .slice(0, 4);

    return { key, breakdown, workload, streak, nextActions };
  }, [now, tasks, sections, logs, history]);

  const openTask = (id: string) => setSelectedId(id);

  return (
    <PageFrame>
      {!now || !derived ? (
        <div className="space-y-6">
          <div className="space-y-2">
            <div className="h-3 w-40 animate-pulse rounded bg-muted/60" />
            <div className="h-8 w-72 animate-pulse rounded bg-muted/60" />
          </div>
          <ListSkeleton rows={5} />
        </div>
      ) : (
        <>
          <div className="mb-7 flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
            <div className="min-w-0">
              <p className="mb-1.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                {now.toLocaleDateString("en-US", {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                })}
              </p>
              <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-foreground sm:text-[30px]">
                {greetingForHour(now.getHours())}
                <span className="text-muted-foreground">,</span> {PROFILE.name}
              </h1>
            </div>
            <div className="flex items-center gap-2">
              <StreakPill streak={derived.streak} />
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  setFormSection("daily");
                  setFormOpen(true);
                }}
                className="h-8"
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={2.2} />
                <span className="hidden sm:inline">New</span>
              </Button>
            </div>
          </div>

          {derived.breakdown.specials.length > 0 && (
            <div className="mb-6">
              <SpecialTaskBanner
                tasks={derived.breakdown.specials}
                onOpen={(t) => openTask(t.id)}
              />
            </div>
          )}

          <div className="space-y-6">
            {derived.breakdown.groups.length > 0 ? (
              derived.breakdown.groups.map((g) => (
                <GroupSection
                  key={g.id}
                  title={g.title}
                  icon={g.icon}
                  sub={g.tasks[0]?.schedule ? scheduleSummary(g.tasks[0].schedule) : undefined}
                  tasks={g.tasks}
                  onOpen={(t) => openTask(t.id)}
                  onToggle={(t) => toggleTask(t.id)}
                  onAdd={() => {
                    setFormSection(
                      g.id === "builtin-daily" ? "daily" : (`custom:${g.id}` as const),
                    );
                    setFormOpen(true);
                  }}
                />
              ))
            ) : (
              <EmptyState
                icon={<SunMedium className="h-4.5 w-4.5" strokeWidth={1.5} />}
                title="Nothing scheduled for today"
                body={
                  tasks.length === 0
                    ? "Seed data hasn't loaded — refresh to see your workspace."
                    : "Add a daily routine or pick a remainder task to get moving."
                }
                action={
                  <Button
                    variant="soft"
                    size="sm"
                    onClick={() => {
                      setFormSection("daily");
                      setFormOpen(true);
                    }}
                  >
                    <Plus className="h-3.5 w-3.5" /> New task
                  </Button>
                }
              />
            )}

            <WorkloadBar
              planned={derived.workload.planned}
              remaining={derived.workload.remaining}
              doneCount={derived.breakdown.specialsDone.length + derived.breakdown.groups.reduce(
                (s, g) => s + g.tasks.filter((t) => t.completed).length,
                0,
              )}
              totalCount={derived.workload.count}
            />

            {derived.nextActions.length > 0 && (
              <section>
                <p className="mb-2 px-0.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                  Next actions
                </p>
                <ListShell>
                  {derived.nextActions.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => openTask(t.id)}
                      className="group flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted/45 focus-visible:outline-none focus-visible:bg-muted/45"
                    >
                      <ArrowRight
                        className="h-3.5 w-3.5 shrink-0 text-signal"
                        strokeWidth={2.2}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px]">
                          <span className="font-medium text-foreground">{t.title}</span>
                          <span className="text-muted-foreground"> · {t.nextAction}</span>
                        </span>
                      </span>
                      {t.estimatedMinutes > 0 && (
                        <span className="shrink-0 font-mono text-[11.5px] tnum text-muted-foreground">
                          {formatMinutes(t.remainingMinutes)}
                        </span>
                      )}
                    </button>
                  ))}
                </ListShell>
              </section>
            )}

            <div className="flex justify-center pb-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setFormSection("daily");
                  setFormOpen(true);
                }}
              >
                <Plus className="h-3.5 w-3.5" /> Add task
              </Button>
            </div>
          </div>
        </>
      )}

      <TaskDetailModal taskId={selectedId} onClose={() => setSelectedId(null)} />
      <TaskFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        defaultSection={formSection}
      />
    </PageFrame>
  );
}
