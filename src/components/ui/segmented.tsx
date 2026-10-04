import { cn } from "@/lib/utils";

export interface SegmentedOption<T extends string> {
  value: T;
  label: React.ReactNode;
  title?: string;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className,
  size = "md",
  fill = false,
}: {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
  size?: "sm" | "md";
  /**
   * Fill the available width with equal-width options, and stop wrapping.
   * Used for primary tab bars, where a wrapped stack reads as a list of wide
   * boxes rather than a control.
   */
  fill?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      className={cn(
        "flex items-center gap-0.5 rounded-lg bg-muted p-0.5",
        fill ? "w-full sm:w-auto" : "flex-wrap",
        className,
      )}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            title={o.title}
            onClick={() => onChange(o.value)}
            className={cn(
              "rounded-[7px] font-medium transition-all duration-150",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70",
              fill
                ? "min-w-0 flex-1 truncate whitespace-nowrap px-1 py-1.5 text-center text-[11px] sm:flex-none sm:px-2.5 sm:text-[13px]"
                : size === "sm"
                  ? "px-2 py-1 text-xs"
                  : "px-2.5 py-1.5 text-[13px]",
              active
                ? "bg-card text-foreground shadow-soft"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
