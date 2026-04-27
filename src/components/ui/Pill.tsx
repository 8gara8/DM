import { cn } from "@/lib/utils";
import type { HTMLAttributes } from "react";

export function Pill({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      {...props}
      className={cn(
        "inline-flex items-center rounded-full bg-surface-hover px-2 py-0.5 text-xs text-text-muted",
        className,
      )}
    />
  );
}
