import { cn } from "@/lib/utils";
import type { HTMLAttributes } from "react";

export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      className={cn(
        "animate-pulse rounded-md bg-surface-hover",
        className,
      )}
    />
  );
}
