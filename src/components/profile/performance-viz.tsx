"use client";

import type { ReactNode } from "react";
import type { DayRec } from "@/lib/performance";
import { WEEKDAYS_MON_FIRST } from "@/lib/date";
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
          <div key={r.date} className="flex items-center gap-3">
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