"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import type { Task } from "@/lib/types";
import { formatMinutes } from "@/lib/format";
import { loggedTodayForTask, useStore } from "@/lib/store";
import { Button } from "@/components/ui/button";

const QUICK = [
  { label: "+15m", minutes: 15 },
  { label: "+30m", minutes: 30 },
  { label: "+1h", minutes: 60 },
];

export function TimeLogControl({ task }: { task: Task }) {
  const logTime = useStore((s) => s.logTime);
  const logs = useStore((s) => s.logs);
  const [custom, setCustom] = useState("");

  const loggedToday = loggedTodayForTask(logs, task.id);
  const remaining = task.remainingMinutes;

  if (task.completed) {
    return (
      <div className="rounded-lg border border-border/70 bg-muted/35 px-3.5 py-3">
        <p className="text-[13px] text-muted-foreground">
          Completed — nothing left to log today.{" "}
          <span className="font-mono text-xs tnum">
            {formatMinutes(task.estimatedMinutes)} planned
          </span>
        </p>
      </div>
    );
  }

  const applyCustom = () => {
    const v = Number(custom);
    if (Number.isFinite(v) && v > 0) {
      logTime(task.id, v);
      setCustom("");
    }
  };

  return (
    <div className="rounded-xl border border-border/70 bg-muted/30 p-3.5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            Log time
          </p>
          <p className="mt-1 flex items-baseline gap-1.5">
            <span className="tnum text-2xl font-semibold tracking-tight text-foreground">
              {formatMinutes(remaining)}
            </span>
            <span className="text-xs text-muted-foreground">
              remaining of {formatMinutes(task.estimatedMinutes)}
            </span>
          </p>
          {loggedToday > 0 && (
            <p className="mt-0.5 font-mono text-[11px] tnum text-success">
              +{formatMinutes(loggedToday)} logged today
            </p>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {QUICK.map((q) => (
            <Button
              key={q.minutes}
              variant="outline"
              size="sm"
              onClick={() => logTime(task.id, q.minutes)}
              className="font-mono tnum"
            >
              {q.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="mt-3 flex items-center gap-1.5 border-t border-border/60 pt-3">
        <Plus className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={2} />
        <input
          type="number"
          min={1}
          placeholder="Custom"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") applyCustom();
          }}
          aria-label="Custom minutes to log"
          className="h-7 w-24 rounded-md border border-input bg-card px-2 font-mono text-xs tnum focus:outline-none focus:ring-2 focus:ring-ring/60"
        />
        <span className="font-mono text-[11px] text-muted-foreground">min</span>
        <Button
          variant="soft"
          size="sm"
          onClick={applyCustom}
          disabled={!custom}
          className="ml-auto"
        >
          Log
        </Button>
      </div>
    </div>
  );
}
