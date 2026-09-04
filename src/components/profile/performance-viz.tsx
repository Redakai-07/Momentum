"use client";

import type { ReactNode } from "react";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import type { DayRec } from "@/lib/performance";
import { MONTHS_SHORT, WEEKDAYS_MON_FIRST } from "@/lib/date";
import { cn } from "@/lib/utils";
import { PROFILE } from "@/lib/types";

const THRESHOLD = PROFILE.streakThreshold * 100;
const passColor = "bg-primary/75";
const failColor = "bg-signal/70";

/* ------------------------------------------------------------------ */
/* THIS WEEK — horizontal day bars                                     */
/* ------------------------------------------------------------------ */

export type WeeklyRec = DayRec & { pending?: boolean };

export function WeeklyRows({ recs }: { recs: WeeklyRec[] }) {
  // recs arrive Monday-first; map weekday labels by date.
  const rows = recs.map((r) => {
    const d = new Date(r.date + "T12:00:00");
    const idx = WEEKDAYS_MON_FIRST[(d.getDay() + 6) % 7];
    return { ...r, label: idx };
  });

  return (
    <div className="space-y-2.5">
      {rows.map((r) => {
        const rest = r.percentage === null || r.plannedMinutes === 0;
        const recovery = r.kind === "recovery";
        const pending = r.pending === true;
        const pct = r.percentage ?? 0;
        const ok = pct >= THRESHOLD;
        return (
          <div
            key={r.date}
            title={recovery ? "Recovery day — streak protected, not counted as productive" : undefined}
            className="flex items-center gap-3"
          >
            <span
              className={cn(
                "w-9 shrink-0 font-mono text-[10.5px] font-medium uppercase tracking-wider",
                pending ? "text-muted-foreground/35" : "text-muted-foreground",
              )}
            >
              {r.label}
            </span>
            <div className="h-[7px] flex-1 overflow-hidden rounded-[3px] bg-muted">
              <div
                className={cn(
                  "h-full rounded-[3px] transition-[width] duration-500",
                  pending || rest || recovery ? "" : ok ? passColor : failColor,
                )}
                style={{
                  width:
                    pending || rest || recovery
                      ? "0%"
                      : `${Math.max(2, Math.min(100, pct))}%`,
                }}
              />
            </div>
            <span
              className={cn(
                "w-11 shrink-0 text-right font-mono text-[11.5px] tnum",
                pending
                  ? "text-muted-foreground/30"
                  : rest
                    ? "text-muted-foreground/60"
                    : recovery
                      ? "text-success/80"
                      : ok
                        ? "text-foreground/85"
                        : "text-signal",
              )}
            >
              {pending ? "—" : rest ? "rest" : recovery ? "rec" : `${pct}%`}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* LAST 30 DAYS — thin area chart                                      */
/* ------------------------------------------------------------------ */

function ChartTip(props: unknown) {
  const { active, payload, label } = (props ?? {}) as {
    active?: boolean;
    payload?: Array<{ value?: number | null | string; payload?: { kind?: string } }>;
    label?: string | number;
  };
  if (!active || !payload?.length) return null;
  const v = payload[0]?.value;
  const kind = payload[0]?.payload?.kind;
  const d = new Date(String(label) + "T12:00:00");
  return (
    <div className="rounded-lg border border-border bg-popover px-2.5 py-1.5 text-xs shadow-soft">
      <p className="font-medium text-foreground">
        {d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
      </p>
      <p className="mt-0.5 font-mono tnum text-muted-foreground">
        {kind === "recovery"
          ? "recovery day"
          : v === null || v === undefined
            ? "rest day"
            : `${v}%`}
      </p>
    </div>
  );
}

export function DailyChart({ recs }: { recs: DayRec[] }) {

  const data = recs.map((r) => ({ date: r.date, pct: r.percentage, kind: r.kind }));
  return (
    <div className="h-[150px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="perf-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.22} />
              <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <Tooltip
            content={ChartTip}
            cursor={{ stroke: "hsl(var(--border))", strokeWidth: 1 }}
          />
          <Area
            type="monotone"
            dataKey="pct"
            stroke="hsl(var(--primary))"
            strokeWidth={1.5}
            fill="url(#perf-fill)"
            connectNulls={false}
            dot={false}
            activeDot={{ r: 3, strokeWidth: 0, fill: "hsl(var(--primary))" }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* ANNUAL — twelve quiet columns                                       */
/* ------------------------------------------------------------------ */

export interface MonthBucket {
  key: string; // "2026-09"
  label: string;
  percentage: number | null;
  planned: number;
}

export function AnnualBars({ buckets }: { buckets: MonthBucket[] }) {
  const maxCols = 12;
  const shown = buckets.slice(-maxCols);
  const maxPct = Math.max(
    ...shown.map((b) => (b.percentage === null ? 0 : b.percentage)),
    1,
  );
  return (
    <div className="flex h-[104px] items-end gap-2 sm:gap-2.5">
      {shown.map((b) => {
        const rest = b.percentage === null || b.planned === 0;

        const ok = (b.percentage ?? 0) >= THRESHOLD;
        const h = rest ? 0 : Math.max(6, ((b.percentage ?? 0) / maxPct) * 100);
        return (
          <div key={b.key} className="group flex h-full flex-1 flex-col justify-end">
            <span className="mb-1 text-center font-mono text-[10px] tnum text-muted-foreground/80 opacity-0 transition-opacity group-hover:opacity-100">
              {rest ? "—" : `${b.percentage}%`}
            </span>
            <div
              title={rest ? `${b.label}: rest` : `${b.label}: ${b.percentage}%`}
              className={cn(
                "w-full rounded-t-[3px] transition-colors",
                rest
                  ? "h-[3px] bg-muted/80"
                  : ok
                    ? passColor
                    : failColor,
              )}
              style={rest ? undefined : { height: `${h}%` }}
            />
            <span className="mt-1.5 text-center font-mono text-[9.5px] uppercase text-muted-foreground/80">
              {b.label.slice(0, 3)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Shared card shell                                                   */
/* ------------------------------------------------------------------ */

export function Panel({
  eyebrow,
  title,
  right,
  children,
  className,
}: {
  eyebrow?: string;
  title?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-xl border border-border bg-card/60 p-4 sm:p-5", className)}>
      <div className="mb-3.5 flex items-baseline justify-between gap-3">
        <div>
          {eyebrow && (
            <p className="font-mono text-[9.5px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              {eyebrow}
            </p>
          )}
          {title && (
            <h3 className="mt-0.5 text-sm font-semibold tracking-tight text-foreground">
              {title}
            </h3>
          )}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

export { MONTHS_SHORT };
