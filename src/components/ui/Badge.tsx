import { cn } from "@/lib/utils";
import type { HTMLAttributes } from "react";

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: "neutral" | "buy" | "sell" | "warning" | "critical";
}

export function Badge({ tone = "neutral", className, ...props }: BadgeProps) {
  const toneClass =
    tone === "buy"
      ? "bg-buy-dim text-buy"
      : tone === "sell"
        ? "bg-sell-dim text-sell"
        : tone === "warning"
          ? "text-warning"
          : tone === "critical"
            ? "text-critical"
            : "bg-surface-hover text-text-muted";
  return (
    <span
      {...props}
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-mono",
        toneClass,
        className,
      )}
    />
  );
}
