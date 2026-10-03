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
        "transition-[background-color,border-color,transform] duration-200",
        checked
          ? "border-primary bg-primary text-primary-foreground"
          : "border-foreground/30 bg-transparent group-hover/check:border-foreground/55",
        className,
      )}
    >
      {checked && (
        <Check className="anim-check h-3 w-3" strokeWidth={3} />
      )}
    </span>
  );
}
