"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  ChevronRight,
  CircleCheck,
  Flame,
  Layers,
  ListChecks,
  Plus,
  Sparkles,
  Timer,
} from "lucide-react";
import { PageFrame } from "@/components/layout/page-frame";
import { useNow } from "@/lib/hooks";
import { useStore } from "@/lib/store";
import { breakdownForDay } from "@/lib/schedule";
import { workloadForTasks, currentStreak, liveDayRec, type DayRec } from "@/lib/performance";
import { addDays, dateKey } from "@/lib/date";
import { greetingForHour, formatMinutes } from "@/lib/format";
import { scheduleSummary } from "@/lib/labels";
import { isTimedTask, remainingMinutesOf } from "@/lib/duration";
import { ListShell, ListSkeleton } from "@/components/ui/list";
import { Button } from "@/components/ui/button";
import { ProgressRing } from "@/components/ui/progress-ring";
import { TaskRow } from "@/components/tasks/task-row";
import { TaskDetailModal } from "@/components/tasks/task-detail";
import { TaskFormModal } from "@/components/tasks/task-form";
import { SpecialTaskBanner } from "@/components/dashboard/special-task-banner";
import { WorkloadBar } from "@/components/dashboard/workload-bar";
import { RemindersStrip } from "@/components/dashboard/reminders-strip";
import type { Task } from "@/lib/types";
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

/**
 * The hero answers one question before anything else: what is worth doing now?
 *
 * The ring carries the day's completion; the copy underneath prefers the
 * concrete next task over an abstract summary.
 */
function TodayHero({
  now,
  profileName,
  streak,
  planned,
  remaining,
  untimedCount,
  openTotal,
  doneTotal,
  upNext,
  onOpen,
  onToggle,
}: {
  now: Date;
  profileName: string;
  streak: number | null;
  planned: number;
  remaining: number;
  untimedCount: number;
  openTotal: number;
  doneTotal: number;
  upNext: Task | null;
  onOpen: (t: Task) => void;
  onToggle: (t: Task) => void;
}) {
  const done = Math.max(0, planned - remaining);
  const pct = planned > 0 ? Math.min(100, Math.round((done / planned) * 100)) : null;
  const allDone = openTotal === 0 && doneTotal > 0;

  return (
    <section className="surface anim-fade-up relative mb-6 overflow-hidden rounded-2xl p-5">
      <span
        aria-hidden
        className="pointer-events-none absolute -right-12 -top-14 h-40 w-40 rounded-full bg-primary/15 blur-3xl"
      />
      <span
        aria-hidden
        className="pointer-events-none absolute -bottom-16 -left-10 h-32 w-32 rounded-full bg-signal/10 blur-3xl"
      />

      <div className="relative flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="font-mono text-[10.5px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            {now.toLocaleDateString("en-US", {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}
          </p>
          <h1 className="mt-1.5 text-[23px] font-semibold leading-tight tracking-tight text-foreground sm:text-[27px]">
            {greetingForHour(now.getHours())}
            <span className="text-muted-foreground">,</span> {profileName}
          </h1>

          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <StreakPill streak={streak} />
            {planned > 0 && (
              <span className="flex items-center gap-1.5 rounded-full border border-border bg-card/70 px-2.5 py-1 font-mono text-[11px] tnum text-muted-foreground">
                <Timer className="h-3 w-3" strokeWidth={2} />
                {formatMinutes(done)} / {formatMinutes(planned)}
              </span>
            )}
            {untimedCount > 0 && (
              <span className="flex items-center gap-1.5 rounded-full border border-border bg-card/70 px-2.5 py-1 font-mono text-[11px] tnum text-muted-foreground">
                <CircleCheck className="h-3 w-3" strokeWidth={2} />
                {untimedCount} to-do{untimedCount === 1 ? "" : "s"}
              </span>
            )}
          </div>
        </div>

        <ProgressRing
          value={pct}
          size={78}
          stroke={7}
          className="anim-ring-in mt-0.5"
          label={
            pct === null
              ? "Nothing time-based planned today"
              : `Today ${pct} percent of planned time complete`
          }
        >
          <div className="text-center leading-none">
            <div className="tnum text-[18px] font-semibold text-foreground">
              {pct === null ? "—" : pct}
              {pct !== null && <span className="text-[10px] text-muted-foreground">%</span>}
            </div>
            <div className="mt-0.5 font-mono text-[8px] uppercase tracking-[0.14em] text-muted-foreground">
              {pct === null ? "rest" : "done"}
            </div>
          </div>
        </ProgressRing>
      </div>

      {/* Up next — the single most useful thing on this screen. */}
      {openTotal > 0 && upNext && (
        <div className="relative mt-4 border-t border-border/70 pt-3.5">
          <p className="mb-2 font-mono text-[9.5px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Up next
          </p>
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-semibold tracking-tight text-foreground">
                {upNext.title}
              </p>
              {upNext.nextAction ? (
                <p className="mt-1 flex items-start gap-1.5 text-[13px] leading-relaxed text-muted-foreground">
                  <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" strokeWidth={2.2} />
                  <span className="min-w-0">{upNext.nextAction}</span>
                </p>
              ) : (
                <p className="mt-1 text-[13px] text-muted-foreground">
                  {isTimedTask(upNext)
                    ? `${formatMinutes(remainingMinutesOf(upNext))} remaining`
                    : "Completion-based — no duration needed."}
                </p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {isTimedTask(upNext) && (
                <Button variant="soft" size="sm" onClick={() => onOpen(upNext)}>
                  Open
                </Button>
              )}
              <Button
                variant="primary"
                size="sm"
                onClick={() => onToggle(upNext)}
                aria-label={`Complete ${upNext.title}`}
              >
                Done
              </Button>
            </div>
          </div>
        </div>
      )}

      {allDone && (
        <div className="relative mt-4 flex items-center gap-2 border-t border-border/70 pt-3.5 text-[13px] text-muted-foreground">
          <CircleCheck className="h-4 w-4 shrink-0 text-success" strokeWidth={2} />
          Everything planned for today is done. Nicely held.
        </div>
      )}
    </section>
  );
}

function GroupSection({
  title,
  sub,
  tasks,
  totalTasks,
  accent,
  onOpen,
  onToggle,
  onAdd,
}: {
  title: string;
  sub?: string;
  tasks: Task[];
  totalTasks: number;
  /** Optional accent hue for custom sections, so they read as distinct. */
  accent?: string;
  onOpen: (t: Task) => void;
  onToggle: (t: Task) => void;
  onAdd: () => void;
}) {
  const open = tasks.filter((t) => t.status === "active").length;
  const doneCount = tasks.filter((t) => t.status === "completed").length;
  const statusLabel =
    open > 0
      ? `${open} left`
      : tasks.length > 0
        ? "done"
        : totalTasks > 0
          ? "not scheduled"
          : "empty";

  return (
    <section className="anim-rise-in">
      <div className="mb-1.5 flex items-baseline justify-between gap-3 px-0.5">
        <div className="flex min-w-0 items-baseline gap-2">
          {accent && (
            <span
              aria-hidden
              className="h-1.5 w-1.5 shrink-0 self-center rounded-full"
              style={{ backgroundColor: accent }}
            />
          )}
          <h2 className="truncate text-[13px] font-semibold tracking-tight text-foreground">
            {title}
          </h2>
          <span
            className={cn(
              "font-mono text-[10.5px] tnum",
              doneCount > 0 && open === 0 ? "text-success" : "text-muted-foreground",
            )}
          >
            {statusLabel}
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
          className="press flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
        >
          <Plus className="h-4 w-4" strokeWidth={2} />
        </button>
      </div>
      {tasks.length === 0 ? (
        <div className="surface rounded-2xl px-4 py-4 text-center text-[13px] text-muted-foreground">
          {totalTasks > 0 ? "No tasks scheduled for today." : "No tasks yet — tap + to add one."}
        </div>
      ) : (
        <ListShell className="divide-y divide-border/60">
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
    const workload = workloadForTasks(tasks, key, sections);

    const live = liveDayRec(tasks, logs, key, sections);
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

    // "Up next": the first active task in section order, preferring one that
    // carries an explicit next action — that is the most actionable thing.
    const activeTasks = breakdown.groups.flatMap((g) =>
      g.tasks.filter((t) => t.status === "active"),
    );
    const upNext =
      activeTasks.find((t) => t.nextAction && t.nextAction.trim().length > 0) ??
      activeTasks[0] ??
      null;

    return {
      key,
      breakdown,
      workload,
      streak,
      recoveryYesterday,
      openTotal,
      doneTotal,
      upNext,
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
          <div className="space-y-2.5">
            <div className="skeleton h-3 w-40 rounded bg-muted/60" />
            <div className="skeleton h-8 w-72 rounded bg-muted/60" />
            <div className="skeleton h-24 rounded-2xl bg-muted/40" />
          </div>
          <ListSkeleton rows={5} />
        </div>
      ) : (
        <>
          {derived.isEmpty ? (
            <>
              <div className="mb-6">
                <p className="font-mono text-[10.5px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  {now.toLocaleDateString("en-US", {
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                  })}
                </p>
                <h1 className="mt-1.5 text-[23px] font-semibold leading-tight tracking-tight text-foreground sm:text-[27px]">
                  {greetingForHour(now.getHours())}
                  <span className="text-muted-foreground">,</span> {profileName}
                </h1>
              </div>
              <div className="surface rounded-2xl pt-6">
                <div className="flex flex-col items-center gap-3 px-6 pb-2 text-center">
                  <span className="grid h-14 w-14 place-items-center rounded-2xl border border-border bg-muted/40 text-muted-foreground">
                    <Sparkles className="h-6 w-6" strokeWidth={1.5} />
                  </span>
                  <div>
                    <p className="text-[15px] font-semibold tracking-tight text-foreground">
                      Nothing planned yet
                    </p>
                    <p className="mx-auto mt-1 max-w-xs text-[13px] leading-relaxed text-muted-foreground">
                      Add one thing you want to make progress on today. Small and specific
                      beats big and vague.
                    </p>
                  </div>
                  <Button variant="primary" size="md" onClick={() => openForm("daily")}>
                    <Plus className="h-4 w-4" strokeWidth={2.2} /> Add task
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <>
              <TodayHero
                now={now}
                profileName={profileName}
                streak={derived.streak}
                planned={derived.workload.planned}
                remaining={derived.workload.remaining}
                untimedCount={derived.workload.untimedCount}
                openTotal={derived.openTotal}
                doneTotal={derived.doneTotal}
                upNext={derived.upNext}
                onOpen={(t) => openTask(t.id)}
                onToggle={(t) => toggleTask(t.id)}
              />

              {derived.recoveryYesterday && (
                <p className="mb-5 -mt-2 flex items-center gap-2 text-[12.5px] text-muted-foreground">
                  <span className="h-1 w-1 rounded-full bg-success" />
                  Yesterday counted as a recovery day — your consistency is still intact.
                </p>
              )}

              <div className="space-y-6">
                {derived.breakdown.specials.length > 0 && (
                  <SpecialTaskBanner
                    tasks={derived.breakdown.specials}
                    onOpen={(t) => openTask(t.id)}
                  />
                )}

                <RemindersStrip />

                {/* A day of completion-based tasks only has no minutes to chart. */}
                {derived.workload.planned > 0 && (
                  <WorkloadBar
                    planned={derived.workload.planned}
                    remaining={derived.workload.remaining}
                    untimedCount={derived.workload.untimedCount}
                  />
                )}

                {derived.breakdown.groups.map((g) => {
                  const isCustom = g.id !== "builtin-daily";
                  const section = isCustom ? sections.find((s) => s.id === g.id) : undefined;
                  return (
                    <GroupSection
                      key={g.id}
                      title={g.title}
                      sub={g.tasks[0]?.schedule ? scheduleSummary(g.tasks[0].schedule) : undefined}
                      tasks={g.tasks}
                      accent={
                        section
                          ? section.icon
                            ? undefined
                            : "hsl(var(--primary) / 0.75)"
                          : undefined
                      }
                      totalTasks={tasks.filter((task) =>
                        g.id === "builtin-daily"
                          ? task.section === "daily"
                          : task.section === "custom" && task.customSectionId === g.id,
                      ).length}
                      onOpen={(t) => openTask(t.id)}
                      onToggle={(t) => toggleTask(t.id)}
                      onAdd={() =>
                        openForm(g.id === "builtin-daily" ? "daily" : (`custom:${g.id}` as const))
                      }
                    />
                  );
                })}

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
            </>
          )}

          {/* Other lists — quiet links below the day's work */}
          <div className="mt-7 space-y-2 border-t border-border/70 pt-4">
            <Link
              href="/remainder"
              className="flex items-center gap-3 rounded-lg px-1 py-2 text-[14px] transition-colors hover:bg-muted/40"
            >
              <ListChecks className="h-4 w-4 text-muted-foreground" strokeWidth={1.75} />
              <span className="flex-1 font-medium text-foreground">Reminder</span>
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
              <Link
                key={section.id}
                href={`/section?sectionId=${encodeURIComponent(section.id)}`}
                className="flex items-center gap-3 rounded-lg px-1 py-2 text-[14px] transition-colors hover:bg-muted/40"
              >
                <Layers className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
                <span className="min-w-0 flex-1 wrap-break-word font-medium text-foreground">
                  {section.icon ? `${section.icon} ` : ""}
                  {section.name}
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50" strokeWidth={2} />
              </Link>
            ))}
            <p className="px-1 pt-1 text-xs leading-relaxed text-muted-foreground/80">
              Reminder holds tasks that need finishing. Occasional is your someday list.
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
