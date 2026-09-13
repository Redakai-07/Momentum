import { formatMinutes } from "@/lib/format";

/**
 * "Today's progress" — completed time vs planned time with a subtle bar.
 * 42m / 2h 15m — the whole story, nothing else.
 *
 * Only time-based work is charted: completion-based tasks carry no minutes, so
 * `planned` excludes them (the caller hides the bar when it reaches 0).
 */
export function WorkloadBar({
  planned,
  remaining,
  untimedCount = 0,
}: {
  planned: number;
  remaining: number;
  /** Completion-based tasks today — shown as context, never as minutes. */
  untimedCount?: number;
}) {
  const done = Math.max(0, planned - remaining);
  const pct = planned > 0 ? Math.min(100, Math.max(0, (done / planned) * 100)) : 0;
  return (
    <div>
      <p className="font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
        Today&apos;s progress
      </p>
      <p className="mt-1 flex items-baseline gap-1.5">
        <span className="tnum text-xl font-semibold tracking-tight text-foreground">
          {formatMinutes(done)}
        </span>
        <span className="tnum text-[13px] text-muted-foreground">
          / {formatMinutes(planned)}
        </span>
        {untimedCount > 0 && (
          <span className="ml-1 font-mono text-[11px] text-muted-foreground/80">
            +{untimedCount} to-do{untimedCount === 1 ? "" : "s"}
          </span>
        )}
      </p>
      <div
        role="progressbar"
        aria-label="Today's progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        className="mt-2.5 h-0.75 overflow-hidden rounded-full bg-muted"
      >
        <div
          className="h-full rounded-full bg-primary/75 transition-[width] duration-700 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
