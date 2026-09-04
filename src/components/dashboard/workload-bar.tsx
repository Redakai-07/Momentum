import { formatMinutes } from "@/lib/format";

export function WorkloadBar({
  planned,
  remaining,
  doneCount,
  totalCount,
}: {
  planned: number;
  remaining: number;
  doneCount: number;
  totalCount: number;
}) {
  const pct = planned > 0 ? Math.min(100, Math.max(0, ((planned - remaining) / planned) * 100)) : 0;
  return (
    <div className="rounded-xl border border-border bg-card/60 px-4 py-3.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="flex items-baseline gap-2.5">
          <span className="font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Remaining
          </span>
          <span className="tnum text-lg font-semibold tracking-tight text-foreground">
            {formatMinutes(remaining)}
          </span>
          <span className="font-mono text-[11.5px] tnum text-muted-foreground">
            of {formatMinutes(planned)} planned
          </span>
        </div>
        <span className="font-mono text-[11px] tnum text-muted-foreground">
          {doneCount}/{totalCount} tasks done
        </span>
      </div>
      <div className="mt-2.5 h-[4px] overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary/80 transition-[width] duration-700 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
