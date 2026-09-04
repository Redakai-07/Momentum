import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Eyebrow({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <p
      className={cn(
        "font-mono text-[10.5px] font-medium uppercase tracking-[0.18em] text-muted-foreground",
        className,
      )}
    >
      {children}
    </p>
  );
}

export function Chip({
  children,
  className,
  tone = "neutral",
}: {
  children: ReactNode;
  className?: string;
  tone?: "neutral" | "signal" | "danger" | "success";
}) {
  const tones = {
    neutral: "bg-muted/70 text-muted-foreground",
    signal: "bg-signal-soft text-signal-foreground",
    danger: "bg-destructive/10 text-destructive",
    success: "bg-success/10 text-success",
  } as const;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[11px] font-medium tnum",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
