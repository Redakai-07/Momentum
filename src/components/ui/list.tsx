import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Rounded, raised container used for every list on screen. */
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
        "surface overflow-hidden rounded-2xl",
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
 * The icon sits on a soft halo so an empty screen still has a focal point
 * instead of reading as a blank page.
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
        <div className="relative mb-1">
          <span
            aria-hidden
            className="absolute inset-0 -z-10 scale-150 rounded-full bg-primary/10 blur-xl"
          />
          <span className="grid h-12 w-12 place-items-center rounded-2xl border border-border bg-muted/40 text-muted-foreground shadow-soft">
            {icon}
          </span>
        </div>
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
    <div className="space-y-2.5" aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="skeleton h-[54px] rounded-2xl border border-border/70 bg-muted/40"
          style={{ animationDelay: `${i * 70}ms` }}
        />
      ))}
    </div>
  );
}
