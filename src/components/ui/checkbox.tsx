import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export function CheckboxBox({
  checked,
  className,
}: {
  checked: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex h-[19px] w-[19px] shrink-0 items-center justify-center rounded-[6px] border",
        "transition-[background-color,border-color,box-shadow,transform] duration-200",
        checked
          ? "border-primary bg-primary text-primary-foreground shadow-[0_2px_8px_-2px_hsl(var(--primary)/0.6)]"
          : // Subtle inward shadow makes the empty box read as a real target.
            "border-foreground/25 bg-transparent shadow-[inset_0_1px_2px_hsl(var(--foreground)/0.05)] group-hover/check:border-foreground/45",
        className,
      )}
    >
      {checked && (
        <Check className="anim-check h-3 w-3" strokeWidth={3.5} />
      )}
    </span>
  );
}
