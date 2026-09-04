"use client";

import type { Weekday } from "@/lib/types";
import { WEEKDAYS_MON_FIRST } from "@/lib/date";
import { cn } from "@/lib/utils";

export function DayChips({
  value,
  onChange,
  single = false,
}: {
  value: Weekday[];
  onChange: (d: Weekday[]) => void;
  single?: boolean;
}) {
  const days: { label: string; idx: Weekday }[] = WEEKDAYS_MON_FIRST.map((label, i) => ({
    label,
    idx: ((i + 1) % 7) as Weekday,
  }));
  return (
    <div className="flex flex-wrap gap-1">
      {days.map((d) => {
        const active = value.includes(d.idx);
        return (
          <button
            key={d.idx}
            type="button"
            aria-pressed={active}
            onClick={() =>
              onChange(
                single
                  ? [d.idx]
                  : active
                    ? value.filter((x) => x !== d.idx)
                    : [...value, d.idx],
              )
            }
            className={cn(
              "flex h-8 w-9 items-center justify-center rounded-md border font-mono text-[11px] font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70",
              active
                ? "border-primary bg-primary text-primary-foreground"
                : "border-input bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            {d.label}
          </button>
        );
      })}
    </div>
  );
}
