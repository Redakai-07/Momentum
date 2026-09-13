import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A compact circular progress indicator.
 *
 * Used where a percentage is the headline of a tile (day progress, streak
 * consistency). Pure SVG — no canvas, no measurement — so it renders
 * identically on the server and on Android's WebView.
 *
 * `value` is 0–100, or null for "no data yet" (renders an empty track, which
 * is the honest representation of a rest day rather than a misleading 0%).
 */
export function ProgressRing({
  value,
  size = 64,
  stroke = 6,
  className,
  children,
  trackClassName,
  label,
}: {
  value: number | null;
  size?: number;
  stroke?: number;
  className?: string;
  /** Rendered centred inside the ring. */
  children?: ReactNode;
  trackClassName?: string;
  label?: string;
}) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = value === null ? 0 : Math.max(0, Math.min(100, value));
  const offset = circumference * (1 - pct / 100);

  return (
    <div
      className={cn("relative inline-grid shrink-0 place-items-center", className)}
      style={{ width: size, height: size }}
      role="img"
      aria-label={label ?? (value === null ? "No activity" : `${Math.round(pct)} percent`)}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          className={cn("stroke-muted", trackClassName)}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="stroke-primary transition-[stroke-dashoffset] duration-700 ease-out"
        />
      </svg>
      {children && (
        <div className="absolute inset-0 grid place-items-center">{children}</div>
      )}
    </div>
  );
}
