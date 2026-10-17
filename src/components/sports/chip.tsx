import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function Chip({ active, className, ...props }: ComponentProps<"button"> & { active?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold transition-all active:scale-95",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-white/10 bg-surface-2 text-muted-foreground hover:border-white/20 hover:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function ChipRow({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4 pb-1", className)} {...props} />;
}
