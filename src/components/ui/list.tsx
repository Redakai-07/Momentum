import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A quiet grouping container for lists.
 *
 * A hairline border and nothing else — separation between rows is carried by
 * a divider the caller adds, never by a boxed, shadowed card.
 */
export function ListShell({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-border/70 bg-card",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * Friendly nothing-here-yet panel.
 *
 * No halo, no shadow — a single restrained glyph over two lines of type is
 * enough to give an empty screen a focal point.
 *
 * The glyph reads as a distinct mark rather than a generic UI icon: a short
 * rule above it and generous tracking make the block feel composed.
 */
export function EmptyState({
  icon,
  title,
  body,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  body?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "anim-fade-in flex flex-col items-center justify-center gap-2.5 px-6 py-12 text-center",
        className,
      )}
    >
      {icon && (
        <span className="mb-1 grid h-11 w-11 place-items-center rounded-lg border border-border/70 text-muted-foreground/80">
          {icon}
        </span>
      )}
      <p className="text-[14.5px] font-semibold tracking-tight text-foreground">{title}</p>
      {body && (
        <p className="max-w-xs text-[13px] leading-relaxed text-muted-foreground">{body}</p>
      )}
      {action && <div className="mt-2.5">{action}</div>}
    </div>
  );
}

export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="skeleton h-[52px] rounded-xl border border-border/60 bg-muted/40"
          style={{ animationDelay: `${i * 70}ms` }}
        />
      ))}
    </div>
  );
}
