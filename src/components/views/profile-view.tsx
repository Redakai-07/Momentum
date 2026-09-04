"use client";

import { useMemo, useState } from "react";
import { BarChart3, Settings2, ShieldCheck } from "lucide-react";
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
  isRestDay,
  type DayAggregate,
  type DayRec,
} from "@/lib/performance";
import { Panel, WeeklyRows, DailyChart, AnnualBars, type MonthBucket } from "@/components/profile/performance-viz";
import { ActivityFeed, FocusTile, StreakTile, TodayTile } from "@/components/profile/profile-stats";
import { CustomSectionManager } from "@/components/profile/custom-section-manager";
import { Segmented } from "@/components/ui/segmented";
import { useTheme, type Theme } from "@/components/theme/theme-provider";
import { formatMinutes } from "@/lib/format";
import { ListSkeleton } from "@/components/ui/list";

type Tab = "overview" | "settings";

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
  };
}

export function ProfileView() {

  const mounted = useMounted();
  const now = useNow();
  const [tab, setTab] = useState<Tab>("overview");

  const tasks = useStore((s) => s.tasks);
  const logs = useStore((s) => s.logs);
  const history = useStore((s) => s.history);

  const { theme, setTheme } = useTheme();

  const today = useMemo(() => (mounted && now ? dateKey(now) : null), [mounted, now]);

  const data = useMemo(() => {
    if (!today) return null;
    const hist: DayRec[] = history.map(historyRec);
    const live = liveDayRec(tasks, logs, today);
    const all: DayRec[] = [...hist, live];
    const byKey = new Map(all.map((r) => [r.date, r]));
    const get = (key: string): DayRec =>
      byKey.get(key) ?? { date: key, plannedMinutes: 0, completedMinutes: 0, percentage: null };

    // This calendar week, Monday first (future days marked pending).
    const monday = startOfWeek(new Date(now!));
    const weekRows: (DayRec & { pending?: boolean })[] = [];
    for (let i = 0; i < 7; i++) {
      const d = addDays(monday, i);
      const key = dateKey(d);
      weekRows.push(key <= today ? { ...get(key), pending: false } : { ...get(key), pending: true });
    }

    const monthKey = today.slice(0, 7);
    const yearKey = today.slice(0, 4);
    const inMonth = all.filter((r) => r.date.slice(0, 7) === monthKey && r.date <= today);
    const inYear = all.filter((r) => r.date.slice(0, 4) === yearKey && r.date <= today);
    const last30 = all.filter((r) => r.date > addDaysKey(today, -30) && r.date <= today);

    const weekly = aggregate(weekRows.filter((r) => !r.pending));
    const monthly = aggregate(inMonth);
    const yearly = aggregate(inYear);
    const roll30 = aggregate(last30);
    const streak = currentStreak(all, today);
    const best = Math.max(longestStreak(hist), streak);

    // Last 30 days for the chart.
    const chart: DayRec[] = [];
    for (let i = 29; i >= 0; i--) chart.push(get(addDaysKey(today, -i)));

    // 12 trailing calendar months for the annual view.
    const buckets: MonthBucket[] = [];
    const anchor = new Date(now!);
    for (let m = 0; m < 12; m++) {
      const d = new Date(anchor.getFullYear(), anchor.getMonth() - (11 - m), 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const recs = all.filter((r) => r.date.slice(0, 7) === key);
      const agg = aggregate(recs);
      buckets.push({
        key,
        label: dateLabel(`${key}-01`),
        percentage: agg.percentage,
        planned: agg.plannedMinutes,
      });
    }

    return {
      live,
      weekRows,
      weekly,
      monthly,
      yearly,
      roll30,
      streak,
      best,
      chart,
      buckets,
      all,
    };
  }, [today, history, tasks, logs, now]);

  const todayRec = data?.live;
  const doneCount30 = data
    ? data.all
        .filter((r) => r.date >= addDaysKey(today!, -30) && !isRestDay(r))
        .reduce((s, r) => s + (r.completedMinutes > 0 ? 1 : 0), 0)
    : 0;

  const rollup = (agg: DayAggregate | null, unit: string) =>
    agg?.percentage === null || !agg
      ? { value: "—", sub: `No planned activity ${unit}` }
      : {
          value: `${agg.percentage}%`,
          sub: `${formatMinutes(agg.completedMinutes)} of ${formatMinutes(agg.plannedMinutes)}`,
        };

  const wk = data ? rollup(data.weekly, "this week") : null;
  const mo = data ? rollup(data.monthly, "this month") : null;
  const yr = data ? rollup(data.yearly, "this year") : null;

  return (
    <PageFrame wide>
      <div className="mb-7 flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div>
          <p className="mb-1.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Personal report
          </p>
          <h1 className="flex items-center gap-3 text-[26px] font-semibold leading-tight tracking-tight sm:text-[30px]">
            {PROFILE.name}
            <span className="mt-0.5 hidden h-2 w-2 rounded-full bg-success sm:block" title="Building consistently" />
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
            { value: "settings", label: "Settings" },
          ]}
          value={tab}
          onChange={setTab}
        />
      </div>

      {!mounted || !data || !todayRec ? (
        <ListSkeleton rows={6} />
      ) : tab === "overview" ? (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
          {/* Left column — the report */}
          <div className="min-w-0 space-y-5">
            <Panel eyebrow="This week" title="Daily performance" right={
              <span className="font-mono text-xs tnum text-muted-foreground">
                threshold {Math.round(PROFILE.streakThreshold * 100)}%
              </span>
            }>
              <WeeklyRows recs={data.weekRows} />
            </Panel>

            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "Week", agg: data.weekly, sub: wk?.sub },
                { label: "Month", agg: data.monthly, sub: mo?.sub },
                { label: "Year", agg: data.yearly, sub: yr?.sub },
              ].map((x) => (
                <div key={x.label} className="rounded-xl border border-border bg-card/60 px-3.5 py-3">
                  <p className="font-mono text-[9.5px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                    {x.label}
                  </p>
                  <p className="mt-1.5 tnum text-xl font-semibold tracking-tight text-foreground">
                    {x.agg.percentage === null ? "—" : `${x.agg.percentage}%`}
                  </p>
                  <p className="mt-1 truncate text-[11px] text-muted-foreground">{x.sub}</p>
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

          {/* Right column — status */}
          <div className="min-w-0 space-y-4">
            <TodayTile rec={todayRec} />
            <StreakTile current={data.streak} best={data.best} />
            <FocusTile agg={data.roll30} />
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
                Days with at least some logged work.
              </p>
            </div>
            <Panel eyebrow="Activity" title="Recent logs" className="p-0 sm:p-0">
              <div className="max-h-72 overflow-y-auto px-4 py-2">
                <ActivityFeed logs={logs} tasks={tasks} />
              </div>
            </Panel>
          </div>
        </div>
      ) : (
        /* ------------------------- Settings ------------------------- */
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

          <section className="space-y-2">
            <CustomSectionManager />
          </section>

          <section className="rounded-xl border border-dashed border-border px-4 py-4">
            <p className="flex items-center gap-2 text-[13px] font-medium text-foreground">
              <BarChart3 className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.75} />
              Streak threshold
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              A day keeps your streak when at least{" "}
              <span className="tnum font-mono text-foreground/80">
                {Math.round(PROFILE.streakThreshold * 100)}%
              </span>{" "}
              of planned time is logged. Rest days (nothing planned) don&apos;t break it.
              Making this configurable is planned for a later release.
            </p>
          </section>

          <p className="pb-2 text-center font-mono text-[10.5px] uppercase tracking-[0.16em] text-muted-foreground/70">
            Momentum · local-first · your data never leaves this device
          </p>
        </div>
      )}
    </PageFrame>
  );
}

function addDaysKey(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(y, m - 1, d + days);
  return dateKey(dt);
}

