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
        "flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border transition-colors duration-150",
        checked
          ? "border-primary bg-primary text-primary-foreground"
          : "border-foreground/25 bg-transparent",
        className,
      )}
    >
      {checked && <Check className="h-3 w-3" strokeWidth={3.5} />}
    </span>
  );
}
