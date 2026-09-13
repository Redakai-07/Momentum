import { formatMinutes } from "@/lib/format";
import { ProgressRing } from "@/components/ui/progress-ring";
import { cn } from "@/lib/utils";

/**
 * "Today's progress" — completed time vs planned time.
 *
 * Leads with a ring so the day's completion is legible at a glance, with the
 * exact minutes underneath. Only time-based work is charted: completion-based
 * tasks carry no minutes, so `planned` excludes them (the caller hides this
 * block when it reaches 0).
 */
export function WorkloadBar({
  planned,
  remaining,
  untimedCount = 0,
  className,
}: {
  planned: number;
  remaining: number;
  /** Completion-based tasks today — shown as context, never as minutes. */
  untimedCount?: number;
  className?: string;
}) {
  const done = Math.max(0, planned - remaining);
  const pct = planned > 0 ? Math.min(100, Math.max(0, (done / planned) * 100)) : 0;
  const complete = pct >= 100;

  return (
    <div
      className={cn(
        "surface flex items-center gap-4 rounded-2xl px-4 py-3.5",
        className,
      )}
    >
      <ProgressRing
        value={pct}
        size={58}
        stroke={6}
        label={`Today ${Math.round(pct)} percent complete`}
      >
        <span className="tnum text-[15px] font-semibold leading-none text-foreground">
          {Math.round(pct)}
          <span className="text-[10px] text-muted-foreground">%</span>
        </span>
      </ProgressRing>

      <div className="min-w-0 flex-1">
        <p className="font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Today&apos;s progress
        </p>
        <p className="mt-1 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
          <span className="tnum text-[19px] font-semibold leading-none tracking-tight text-foreground">
            {formatMinutes(done)}
          </span>
          <span className="tnum text-[12.5px] text-muted-foreground">
            of {formatMinutes(planned)}
          </span>
          {untimedCount > 0 && (
            <span className="font-mono text-[11px] text-muted-foreground/80">
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
          className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"
        >
          <div
            className={cn(
              "anim-fill h-full rounded-full",
              complete ? "bg-success" : "bg-primary",
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
        {remaining > 0 && (
          <p className="mt-1.5 text-[11.5px] text-muted-foreground">
            <span className="tnum font-medium text-foreground/80">
              {formatMinutes(remaining)}
            </span>{" "}
            left to reach today&apos;s plan
          </p>
        )}
      </div>
    </div>
  );
}
