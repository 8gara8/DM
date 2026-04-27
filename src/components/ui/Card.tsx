import { cn } from "@/lib/utils";
import type { HTMLAttributes } from "react";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      className={cn(
        "bg-surface border border-border-subtle rounded-lg p-4",
        className,
      )}
    />
  );
}
