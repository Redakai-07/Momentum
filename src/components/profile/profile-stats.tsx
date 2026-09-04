"use client";

import { Activity, Flame, Timer } from "lucide-react";
import type { DayRec, DayAggregate } from "@/lib/performance";
import type { Task, TimeLog } from "@/lib/types";
import { formatMinutes } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PROFILE } from "@/lib/types";

export function StatTile({
  icon,
  label,
  value,
  sub,
  tone = "default",
}: {
  icon?: React.ReactNode;
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: "default" | "signal";
}) {
  return (
    <div className="rounded-xl border border-border bg-card/60 px-4 py-3.5">
      <div className="flex items-center gap-1.5">
        {icon}
        <p className="font-mono text-[9.5px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          {label}
        </p>
      </div>
      <p
        className={cn(
          "mt-1.5 tnum text-[26px] font-semibold leading-none tracking-tight",
          tone === "signal" ? "text-signal" : "text-foreground",
        )}
      >
        {value}
      </p>
      {sub && <p className="mt-1.5 text-xs leading-snug text-muted-foreground">{sub}</p>}
    </div>
  );
}

export function TodayTile({ rec }: { rec: DayRec }) {
  const rest = rec.plannedMinutes === 0;
  const pct = rec.percentage;
  const met = pct !== null && pct >= PROFILE.streakThreshold * 100;
  return (
    <StatTile
      icon={<Timer className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.75} />}
      label="Today"
      tone={!rest && pct !== null && !met ? "signal" : "default"}
      value={rest ? "—" : `${pct}%`}
      sub={
        rest
          ? "Nothing planned — rest day."
          : met
            ? `Streak-safe · ${formatMinutes(rec.completedMinutes)} of ${formatMinutes(rec.plannedMinutes)} done`
            : `${formatMinutes(rec.completedMinutes)} of ${formatMinutes(rec.plannedMinutes)} — keep going to hold the streak`
      }
    />
  );
}

export function StreakTile({
  current,
  best,
}: {
  current: number;
  best: number;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="rounded-xl border border-signal/30 bg-signal-soft/50 px-4 py-3.5">
        <div className="flex items-center gap-1.5">
          <Flame className="h-3.5 w-3.5 text-signal" fill="currentColor" strokeWidth={0} />
          <p className="font-mono text-[9.5px] font-medium uppercase tracking-[0.18em] text-signal-foreground/90">
            Current
          </p>
        </div>
        <p className="mt-1.5 tnum text-[26px] font-semibold leading-none tracking-tight text-signal-foreground">
          {current}
        </p>
        <p className="mt-1.5 text-[11px] text-signal-foreground/75">
          ≥{Math.round(PROFILE.streakThreshold * 100)}% keeps it alive
        </p>
      </div>
      <div className="rounded-xl border border-border bg-card/60 px-4 py-3.5">
        <p className="font-mono text-[9.5px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Best
        </p>
        <p className="mt-1.5 tnum text-[26px] font-semibold leading-none tracking-tight text-foreground">
          {best}
        </p>
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          {best >= current && best > 0 ? `${best - current} day${best - current === 1 ? "" : "s"} to beat` : "all-time record"}
        </p>
      </div>
    </div>
  );
}

export function FocusTile({ agg }: { agg: DayAggregate }) {
  const total = formatMinutes(agg.completedMinutes);
  const [h, rest] = total.split(" ");
  return (
    <StatTile
      icon={<Activity className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.75} />}
      label="Focus · last 30 days"
      value={h}
      sub={
        <>
          {rest ?? "0m"} of{" "}
          <span className="tnum">{formatMinutes(agg.plannedMinutes)}</span> planned —
          weighted performance{" "}
          <span className="tnum">{agg.percentage ?? "—"}%</span>
        </>
      }
    />
  );
}

export function ActivityFeed({
  logs,
  tasks,
}: {
  logs: TimeLog[];
  tasks: Task[];
}) {
  const titleOf = new Map(tasks.map((t) => [t.id, t.title]));
  const sorted = [...logs]
    .sort((a, b) => (a.date === b.date ? b.minutes - a.minutes : a.date < b.date ? 1 : -1))
    .slice(0, 12);

  if (sorted.length === 0) {
    return (
      <p className="py-6 text-center text-xs text-muted-foreground">
        No activity logged yet — the first log starts the record.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-border/60">
      {sorted.map((l) => {
        const d = new Date(l.date + "T12:00:00");
        const title = titleOf.get(l.taskId);
        return (
          <li key={l.id} className="flex items-center gap-3 py-2">
            <span className="w-9 shrink-0 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
              {d.toLocaleDateString("en-US", { weekday: "short" })}
            </span>
            <span className="min-w-0 flex-1 truncate text-[13px] text-foreground/90">
              {title ?? "Deleted task"}
            </span>
            <span className="shrink-0 font-mono text-[11.5px] tnum text-muted-foreground">
              +{formatMinutes(l.minutes)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
