"use client";

import { useMemo, useState } from "react";
import {
  Award,
  BadgeCheck,
  BarChart3,
  Bell,
  BellRing,
  Layers,
  Settings2,
  ShieldCheck,
} from "lucide-react";
import { PageFrame } from "@/components/layout/page-frame";
import { useMounted, useNow } from "@/lib/hooks";
import { useStore } from "@/lib/store";
import { dateKey, addDays, startOfWeek, MONTHS_SHORT } from "@/lib/date";
import { PROFILE, type DailyPerformance } from "@/lib/types";
import {
  liveDayRec,
  currentStreak,
  longestStreak,
  aggregate,
  rawTotals,
  isNeutralRec,
  weeklyAggregate,
  monthlyAggregate,
  yearlyAggregate,
  type DayRec,
} from "@/lib/performance";
import { usedRecoveries } from "@/lib/activity";
import { RECOVERY_RULES, COOLDOWN_OPTIONS } from "@/lib/config";
import {
  Panel,
  WeeklyRows,
  DailyChart,
  AnnualBars,
  type MonthBucket,
} from "@/components/profile/performance-viz";
import {
  ActivityFeed,
  FocusTile,
  StreakTile,
  TodayTile,
} from "@/components/profile/profile-stats";
import { CustomSectionManager } from "@/components/profile/custom-section-manager";
import { TaskDetailModal } from "@/components/tasks/task-detail";
import { Segmented } from "@/components/ui/segmented";
import { ListShell, EmptyState, ListSkeleton } from "@/components/ui/list";
import { Chip } from "@/components/ui/typography";
import { useTheme, type Theme } from "@/components/theme/theme-provider";
import { formatMinutes } from "@/lib/format";
import { cn } from "@/lib/utils";

type Tab = "overview" | "accomplishments" | "settings";

const dateLabel = (key: string) => {
  const d = new Date(key + "T12:00:00");
  return `${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`;
};

function historyRec(h: DailyPerformance): DayRec {
  return {
    date: h.date,
    plannedMinutes: h.plannedMinutes,
    completedMinutes: h.completedMinutes,
    percentage: h.percentage,
    kind: h.kind,
  };
}

function monthYearLabel(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function ToggleRow({
  checked,
  onChange,
  label,
  sub,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  sub?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <div>
        <p className="text-[13.5px] font-medium text-foreground">{label}</p>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative h-5 w-9 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70",
          checked ? "bg-primary" : "bg-muted",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-4 w-4 rounded-full bg-card shadow-soft transition-transform",
            checked ? "translate-x-[18px]" : "translate-x-0.5",
          )}
        />
      </button>
    </div>
  );
}

export function ProfileView() {
  const mounted = useMounted();
  const ready = useStore((s) => s.ready);
  const now = useNow();
  const [tab, setTab] = useState<Tab>("overview");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const tasks = useStore((s) => s.tasks);
  const logs = useStore((s) => s.logs);
  const history = useStore((s) => s.history);
  const notificationSettings = useStore((s) => s.notificationSettings);
  const setNotificationSettings = useStore((s) => s.setNotificationSettings);
  const { theme, setTheme } = useTheme();

  const today = useMemo(() => (mounted && now ? dateKey(now) : null), [mounted, now]);

  const data = useMemo(() => {
    if (!today || !now) return null;
    const hist: DayRec[] = history.map(historyRec);
    const live = liveDayRec(tasks, logs, today);
    const all: DayRec[] = [...hist, live];
    const byKey = new Map(all.map((r) => [r.date, r]));
    const get = (key: string): DayRec =>
      byKey.get(key) ?? { date: key, plannedMinutes: 0, completedMinutes: 0, percentage: null };

    // This calendar week, Monday first (future days marked pending).
    const monday = startOfWeek(now);
    const weekRows: (DayRec & { pending?: boolean })[] = [];
    for (let i = 0; i < 7; i++) {
      const d = addDays(monday, i);
      const key = dateKey(d);
      weekRows.push(
        key <= today
          ? { ...get(key), pending: false }
          : { ...get(key), pending: true },
      );
    }

    const last30 = all.filter((r) => r.date > addDaysKey(today, -30) && r.date <= today);

    const weekly = weeklyAggregate(all, today);
    const monthly = monthlyAggregate(all, today);
    const yearly = yearlyAggregate(all, today);
    const roll30 = aggregate(last30);
    const totals30 = rawTotals(last30);
    const streak = currentStreak(all, today);
    const best = Math.max(longestStreak(hist), streak);

    const chart: DayRec[] = [];
    for (let i = 29; i >= 0; i--) chart.push(get(addDaysKey(today, -i)));

    const buckets: MonthBucket[] = [];
    for (let m = 0; m < 12; m++) {
      const d = new Date(now.getFullYear(), now.getMonth() - (11 - m), 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const recs = all.filter((r) => r.date.slice(0, 7) === key);
      const agg = aggregate(recs);
      buckets.push({ key, label: dateLabel(`${key}-01`), percentage: agg.percentage, planned: agg.plannedMinutes });
    }

    return { live, weekRows, weekly, monthly, yearly, roll30, totals30, streak, best, chart, buckets, all };
  }, [today, history, tasks, logs, now]);

  const todayRec = data?.live;
  const doneCount30 = data
    ? data.all
        .filter((r) => r.date >= addDaysKey(today!, -30) && !isNeutralRec(r) && r.completedMinutes > 0)
        .length
    : 0;

  const accomplishments = useMemo(
    () =>
      tasks
        .filter((t) => t.status === "accomplished")
        .sort((a, b) => ((b.accomplishedAt ?? "") < (a.accomplishedAt ?? "") ? -1 : 1)),
    [tasks],
  );

  const loggedByTask = useMemo(() => {
    const map = new Map<string, number>();
    for (const l of logs) map.set(l.taskId, (map.get(l.taskId) ?? 0) + l.minutes);
    return map;
  }, [logs]);

  const monthRecoveries = data && today ? usedRecoveries(data.all, today.slice(0, 7)) : 0;

  return (
    <PageFrame wide>
      <div className="mb-7 flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div>
          <p className="mb-1.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Personal report
          </p>
          <h1 className="flex items-center gap-3 text-[26px] font-semibold leading-tight tracking-tight sm:text-[30px]">
            {PROFILE.name}
            <span className="mt-0.5 hidden h-2 w-2 rounded-full bg-success sm:block" />
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Building momentum since{" "}
            {new Date(PROFILE.joined + "T12:00:00").toLocaleDateString("en-US", {
              month: "long",
              year: "numeric",
            })}
          </p>
        </div>
        <Segmented<Tab>
          options={[
            { value: "overview", label: "Overview" },
            { value: "accomplishments", label: "Accomplishments" },
            { value: "settings", label: "Settings" },
          ]}
          value={tab}
          onChange={setTab}
        />
      </div>

      {!mounted || !ready || !data || !todayRec ? (
        <ListSkeleton rows={6} />
      ) : tab === "overview" ? (
        /* ----------------------------- Overview ----------------------------- */
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-w-0 space-y-5">
            <Panel
              eyebrow="This week"
              title="Daily performance"
              right={
                <span className="font-mono text-xs tnum text-muted-foreground">
                  threshold {Math.round(PROFILE.streakThreshold * 100)}%
                </span>
              }
            >
              <WeeklyRows recs={data.weekRows} />
            </Panel>

            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "Week", agg: data.weekly },
                { label: "Month", agg: data.monthly },
                { label: "Year", agg: data.yearly },
              ].map((x) => (
                <div key={x.label} className="rounded-xl border border-border bg-card/60 px-3.5 py-3">
                  <p className="font-mono text-[9.5px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                    {x.label}
                  </p>
                  <p className="mt-1.5 tnum text-xl font-semibold tracking-tight text-foreground">
                    {x.agg.percentage === null ? "—" : `${x.agg.percentage}%`}
                  </p>
                  <p className="mt-1 truncate text-[11px] text-muted-foreground">
                    {formatMinutes(x.agg.completedMinutes)} of{" "}
                    {formatMinutes(x.agg.plannedMinutes)}
                  </p>
                </div>
              ))}
            </div>

            <Panel eyebrow="Last 30 days" title="Performance trend">
              <DailyChart recs={data.chart} />
            </Panel>

            <Panel eyebrow="Annual" title="Performance by month">
              <AnnualBars buckets={data.buckets} />
            </Panel>
          </div>

          <div className="min-w-0 space-y-4">
            <TodayTile rec={todayRec} />
            <StreakTile current={data.streak} best={data.best} />
            <FocusTile agg={data.totals30} percentage={data.roll30.percentage} />
            <div className="rounded-xl border border-border bg-card/60 px-4 py-3.5">
              <div className="flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.75} />
                <p className="font-mono text-[9.5px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                  Active days · last 30
                </p>
              </div>
              <p className="mt-1.5 tnum text-[26px] font-semibold leading-none tracking-tight text-foreground">
                {doneCount30}
                <span className="ml-1 text-sm font-normal text-muted-foreground">/ 30</span>
              </p>
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                Days with logged work that counts toward your record.
              </p>
            </div>
            <div className="rounded-xl border border-border bg-card/60 px-4 py-3.5">
              <p className="font-mono text-[9.5px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                Recovery days · this month
              </p>
              <p className="mt-1.5 tnum text-[26px] font-semibold leading-none tracking-tight text-foreground">
                {monthRecoveries}
                <span className="ml-1 text-sm font-normal text-muted-foreground">
                  / {RECOVERY_RULES.maximumRecoveryDaysPerMonth} allowed
                </span>
              </p>
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                Earned by {RECOVERY_RULES.minimumConsistencyDays} good days, then a missed day
                keeps your streak.
              </p>
            </div>
            <Panel eyebrow="Activity" title="Recent logs" className="p-0 sm:p-0">
              <div className="max-h-72 overflow-y-auto px-4 py-2">
                <ActivityFeed logs={logs} tasks={tasks} />
              </div>
            </Panel>
          </div>
        </div>
      ) : tab === "accomplishments" ? (
        /* ------------------------- Accomplishments -------------------------- */
        <div className="max-w-[680px]">
          <div className="mb-3 flex items-center gap-2 px-0.5">
            <Award className="h-4 w-4 text-success" strokeWidth={1.75} />
            <h2 className="text-sm font-semibold tracking-tight text-foreground">
              Accomplishments
            </h2>
            <span className="font-mono text-[10.5px] tnum text-muted-foreground">
              {accomplishments.length} completed goal{accomplishments.length === 1 ? "" : "s"}
            </span>
          </div>

          {accomplishments.length === 0 ? (
            <EmptyState
              icon={<Award className="h-4 w-4" strokeWidth={1.5} />}
              title="No accomplishments yet"
              body="When a daily routine or a remainder goal is truly finished — DSA prep, a course, a long project — accomplish it from the task details and it will be kept here as history."
            />
          ) : (
            <ListShell>
              {accomplishments.map((t) => {
                const logged = loggedByTask.get(t.id) ?? 0;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setSelectedId(t.id)}
                    className="flex w-full items-center gap-3.5 px-4 py-3.5 text-left transition-colors hover:bg-muted/45 focus-visible:outline-none focus-visible:bg-muted/45"
                  >
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-success/30 bg-success/5 text-success">
                      <BadgeCheck className="h-4 w-4" strokeWidth={2} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-medium text-foreground">
                        {t.title}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                        {t.section === "daily" ? "Daily" : "Remainder"} · accomplished{" "}
                        {monthYearLabel(t.accomplishedAt)}
                        {logged > 0 && (
                          <>
                            {" "}
                            · <span className="tnum">{formatMinutes(logged)}</span> logged
                          </>
                        )}
                      </span>
                    </span>
                    <Chip tone="neutral" className="hidden sm:inline-flex">
                      {dateLabel((t.accomplishedAt ?? "").slice(0, 10))}
                    </Chip>
                  </button>
                );
              })}
            </ListShell>
          )}
          <p className="mt-3 px-0.5 text-xs leading-relaxed text-muted-foreground">
            Accomplished goals are removed from your active lists but keep their description,
            estimate and every logged minute — a quiet record of work you actually finished.
          </p>
        </div>
      ) : (
        /* ------------------------------ Settings ----------------------------- */
        <div className="max-w-[680px] space-y-6">
          <section>
            <div className="mb-2 flex items-center gap-2">
              <Settings2 className="h-4 w-4 text-muted-foreground" strokeWidth={1.75} />
              <h2 className="text-sm font-semibold tracking-tight text-foreground">Appearance</h2>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card/60 px-4 py-3.5">
              <div>
                <p className="text-[13.5px] font-medium text-foreground">Theme</p>
                <p className="text-xs text-muted-foreground">Calm by default — pick what feels right.</p>
              </div>
              <Segmented<Theme>
                options={[
                  { value: "light", label: "Light" },
                  { value: "dark", label: "Dark" },
                  { value: "system", label: "System" },
                ]}
                value={theme}
                onChange={setTheme}
              />
            </div>
          </section>

          <section>
            <div className="mb-2 flex items-center gap-2">
              <BellRing className="h-4 w-4 text-muted-foreground" strokeWidth={1.75} />
              <h2 className="text-sm font-semibold tracking-tight text-foreground">
                Reminders
              </h2>
            </div>
            <div className="divide-y divide-border/60 rounded-xl border border-border bg-card/60 px-4">
              <ToggleRow
                checked={notificationSettings.enabled}
                onChange={(v) => setNotificationSettings({ enabled: v })}
                label="Task reminders"
                sub="Context-aware nudges — never twice, never during a cooldown."
              />
              <ToggleRow
                checked={notificationSettings.taskReminders}
                onChange={(v) => setNotificationSettings({ taskReminders: v })}
                label="Scheduled task cues"
                sub="Start + wrap-up reminders for daily routines."
              />
              <ToggleRow
                checked={notificationSettings.specialTaskReminders}
                onChange={(v) => setNotificationSettings({ specialTaskReminders: v })}
                label="Special task reminders"
                sub="A morning nudge for tasks due today."
              />
              <ToggleRow
                checked={notificationSettings.overdueReminders}
                onChange={(v) => setNotificationSettings({ overdueReminders: v })}
                label="Overdue reminders"
                sub="One quiet check each morning for overdue work."
              />
              <div className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                <div>
                  <p className="text-[13.5px] font-medium text-foreground">Quiet period after a task</p>
                  <p className="text-xs text-muted-foreground">
                    No new nudges until this long after you complete something.
                  </p>
                </div>
                <Segmented
                  className="[&>button]:w-auto"
                  options={COOLDOWN_OPTIONS.map((o) => ({
                    value: String(o.value),
                    label: o.label,
                  }))}
                  value={String(notificationSettings.cooldownMinutes)}
                  onChange={(v) => setNotificationSettings({ cooldownMinutes: Number(v) })}
                />
              </div>
              <p className="py-3 text-xs leading-relaxed text-muted-foreground">
                <Bell className="mr-1 inline h-3 w-3" />
                Reminders are scheduled locally on this device. Native push will hook into
                this queue when the app ships as a PWA/mobile app — no engine changes needed.
              </p>
            </div>
          </section>

          <section className="space-y-2">
            <div className="flex items-center gap-2 px-0.5">
              <Layers className="h-4 w-4 text-muted-foreground" strokeWidth={1.75} />
              <h2 className="text-sm font-semibold tracking-tight text-foreground">
                Sections
              </h2>
            </div>
            <CustomSectionManager />
          </section>

          <section className="rounded-xl border border-dashed border-border px-4 py-4">
            <p className="flex items-center gap-2 text-[13px] font-medium text-foreground">
              <BarChart3 className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.75} />
              Streak &amp; recovery rules
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              A normal day keeps your streak at{" "}
              <span className="tnum font-mono text-foreground/80">
                {Math.round(PROFILE.streakThreshold * 100)}%
              </span>{" "}
              of planned time. Rest days (nothing planned) are neutral. If you miss a day
              after{" "}
              <span className="tnum font-mono text-foreground/80">
                {RECOVERY_RULES.minimumConsistencyDays}
              </span>{" "}
              qualifying days, it counts as a recovery day instead of a break — up to{" "}
              <span className="tnum font-mono text-foreground/80">
                {RECOVERY_RULES.maximumRecoveryDaysPerMonth}
              </span>{" "}
              per month. Recovery days protect consistency without counting as productive.
            </p>
          </section>

          <p className="pb-2 text-center font-mono text-[10.5px] uppercase tracking-[0.16em] text-muted-foreground/70">
            Momentum · local-first · your data never leaves this device
          </p>
        </div>
      )}

      <TaskDetailModal taskId={selectedId} onClose={() => setSelectedId(null)} />
    </PageFrame>
  );
}

function addDaysKey(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(y, m - 1, d + days);
  return dateKey(dt);
}
