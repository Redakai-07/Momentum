"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRight, Flame, Layers, ListChecks, Plus, Sparkles } from "lucide-react";
import { PageFrame } from "@/components/layout/page-frame";
import { useNow } from "@/lib/hooks";
import { useStore } from "@/lib/store";
import { breakdownForDay } from "@/lib/schedule";
import { workloadForTasks, currentStreak, liveDayRec, type DayRec } from "@/lib/performance";
import { addDays, dateKey } from "@/lib/date";
import { greetingForHour } from "@/lib/format";
import { scheduleSummary } from "@/lib/labels";
import { ListShell, EmptyState, ListSkeleton } from "@/components/ui/list";
import { Button } from "@/components/ui/button";
import { TaskRow } from "@/components/tasks/task-row";
import { TaskDetailModal } from "@/components/tasks/task-detail";
import { TaskFormModal } from "@/components/tasks/task-form";
import { SpecialTaskBanner } from "@/components/dashboard/special-task-banner";
import { WorkloadBar } from "@/components/dashboard/workload-bar";
import { RemindersStrip } from "@/components/dashboard/reminders-strip";
import { cn } from "@/lib/utils";

function StreakPill({ streak }: { streak: number | null }) {
  return (
    <Link
      href="/profile"
      className="flex items-center gap-1.5 rounded-full border border-signal/25 bg-signal-soft/50 px-2.5 py-1 transition-colors hover:border-signal/40"
      aria-label={`${streak ?? 0} day streak — view performance`}
    >
      <Flame className="h-3.5 w-3.5 text-signal" fill="currentColor" strokeWidth={0} />
      <span className="tnum text-[13px] font-semibold leading-none text-signal-foreground">
        {streak ?? "—"}
      </span>
    </Link>
  );
}

function GroupSection({
  title,
  sub,
  tasks,
  onOpen,
  onToggle,
  onAdd,
}: {
  title: string;
  sub?: string;
  tasks: import("@/lib/types").Task[];
  onOpen: (t: import("@/lib/types").Task) => void;
  onToggle: (t: import("@/lib/types").Task) => void;
  onAdd: () => void;
}) {
  const open = tasks.filter((t) => t.status === "active").length;
  return (
    <section>
      <div className="mb-1 flex items-baseline justify-between gap-3 px-0.5">
        <div className="flex min-w-0 items-baseline gap-2">
          <h2 className="text-[13px] font-semibold tracking-tight text-foreground">
            {title}
          </h2>
          <span className="font-mono text-[10.5px] tnum text-muted-foreground">
            {open > 0 ? `${open} left` : open === 0 && tasks.length > 0 ? "done" : "empty"}
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
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
        >
          <Plus className="h-4 w-4" strokeWidth={2} />
        </button>
      </div>
      {tasks.length === 0 ? (
        <div className="px-4 py-4 text-center text-[13px] text-muted-foreground">
          No tasks yet — tap + to add one.
        </div>
      ) : (
        <ListShell>
          {tasks.map((t) => (
            <TaskRow key={t.id} task={t} onOpen={onOpen} onToggle={onToggle} />
          ))}
        </ListShell>
      )}
    </section>
  );
}

export function TodayView() {
  const ready = useStore((s) => s.ready);
  const now = useNow();
  const tasks = useStore((s) => s.tasks);

  const sections = useStore((s) => s.sections);
  const logs = useStore((s) => s.logs);
  const history = useStore((s) => s.history);
  const toggleTask = useStore((s) => s.toggleTask);
  const profileName = useStore((s) => s.profileName);

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
    // Keep the stored kind (recovery/inactive) — a recovery day must not
    // break the streak, and rest days must stay neutral.
    const recs: DayRec[] = history.map((h) => ({
      date: h.date,
      plannedMinutes: h.plannedMinutes,
      completedMinutes: h.completedMinutes,
      percentage: h.percentage,
      kind: h.kind,
    }));
    const streak = currentStreak([...recs, live], key);

    const yesterdayKey = dateKey(addDays(now, -1));
    const recoveryYesterday = history.some(
      (h) => h.date === yesterdayKey && h.kind === "recovery",
    );

    const openTotal = breakdown.groups.reduce(
      (s, g) => s + g.tasks.filter((t) => t.status === "active").length,
      0,
    );
    const doneTotal = breakdown.groups.reduce(
      (s, g) => s + g.tasks.filter((t) => t.status === "completed").length,
      0,
    );

    return {
      key,
      breakdown,
      workload,
      streak,
      recoveryYesterday,
      openTotal,
      doneTotal,
      isEmpty:
        openTotal === 0 &&
        doneTotal === 0 &&
        breakdown.specials.length === 0 &&
        breakdown.groups.length === 0,
    };
  }, [now, tasks, sections, logs, history]);

  const openTask = (id: string) => setSelectedId(id);

  const openForm = (section: "daily" | "remainder" | "occasional" | `custom:${string}`) => {
    setFormSection(section);
    setFormOpen(true);
  };

  return (
    <PageFrame>
      {!ready || !now || !derived ? (
        <div className="space-y-6">
          <div className="space-y-2">
            <div className="h-3 w-40 animate-pulse rounded bg-muted/60" />
            <div className="h-8 w-72 animate-pulse rounded bg-muted/60" />
          </div>
          <ListSkeleton rows={5} />
        </div>
      ) : (
        <>
          {/* Greeting + date + streak */}
          <div className="mb-6 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-[24px] font-semibold leading-tight tracking-tight text-foreground sm:text-[28px]">
                {greetingForHour(now.getHours())}
                <span className="text-muted-foreground">,</span> {profileName}
              </h1>
              <p className="mt-1 font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                {now.toLocaleDateString("en-US", {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                })}
              </p>
            </div>
            <div className="pt-1">
              <StreakPill streak={derived.streak} />
            </div>
          </div>

          {derived.recoveryYesterday && (
            <p className="-mt-2 mb-5 flex items-center gap-2 text-[12.5px] text-muted-foreground">
              <span className="h-1 w-1 rounded-full bg-success" />
              Yesterday counted as a recovery day — your consistency is still intact.
            </p>
          )}

          {/* First run / nothing planned — calm and intentional */}
          {derived.isEmpty ? (
            <div className="pt-10">
              <EmptyState
                title="Nothing planned yet"
                body="Add something you want to make progress on."
                className="py-8"
                action={
                  <Button variant="primary" size="md" onClick={() => openForm("daily")}>
                    <Plus className="h-4 w-4" strokeWidth={2.2} /> Add task
                  </Button>
                }
              />
            </div>
          ) : (
            <div className="space-y-6">
              {derived.breakdown.specials.length > 0 && (
                <SpecialTaskBanner
                  tasks={derived.breakdown.specials}
                  onOpen={(t) => openTask(t.id)}
                />
              )}

              <RemindersStrip />

              <div className="px-0.5">
                <WorkloadBar
                  planned={derived.workload.planned}
                  remaining={derived.workload.remaining}
                />
              </div>

              {derived.breakdown.groups.map((g) => (
                <GroupSection
                  key={g.id}
                  title={g.title}
                  sub={g.tasks[0]?.schedule ? scheduleSummary(g.tasks[0].schedule) : undefined}
                  tasks={g.tasks}
                  onOpen={(t) => openTask(t.id)}
                  onToggle={(t) => toggleTask(t.id)}
                  onAdd={() =>
                    openForm(g.id === "builtin-daily" ? "daily" : (`custom:${g.id}` as const))
                  }
                />
              ))}

              <div className="flex justify-center pb-1">
                <Button
                  variant="outline"
                  size="md"
                  onClick={() => openForm("daily")}
                  className="rounded-full px-5"
                >
                  <Plus className="h-4 w-4" strokeWidth={2} /> Add task
                </Button>
              </div>
            </div>
          )}

          {/* Other lists — quiet links below the day's work */}
          <div className="mt-7 space-y-2 border-t border-border/70 pt-4">
            <Link
              href="/remainder"
              className={cn(
                "flex items-center gap-3 rounded-lg px-1 py-2 text-[14px] transition-colors hover:bg-muted/40",
              )}
            >
              <ListChecks className="h-4 w-4 text-muted-foreground" strokeWidth={1.75} />
              <span className="flex-1 font-medium text-foreground">Remainder</span>
              <ChevronRight className="h-4 w-4 text-muted-foreground/50" strokeWidth={2} />
            </Link>
            <Link
              href="/occasional"
              className="flex items-center gap-3 rounded-lg px-1 py-2 text-[14px] transition-colors hover:bg-muted/40"
            >
              <Sparkles className="h-4 w-4 text-muted-foreground" strokeWidth={1.75} />
              <span className="flex-1 font-medium text-foreground">Occasional</span>
              <ChevronRight className="h-4 w-4 text-muted-foreground/50" strokeWidth={2} />
            </Link>
            {sections.map((section) => (
              <div key={section.id} className="flex items-center gap-3 rounded-lg px-1 py-2 text-[14px]">
                <Layers className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
                <span className="min-w-0 flex-1 break-words font-medium text-foreground">
                  {section.icon ? `${section.icon} ` : ""}{section.name}
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50" strokeWidth={2} />
              </div>
            ))}
            <p className="px-1 pt-1 text-xs leading-relaxed text-muted-foreground/80">
              Remainder holds tasks that need finishing. Occasional is your someday list.
            </p>
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
