import { cn } from "@/lib/utils";
import type { InputHTMLAttributes } from "react";

export function Input({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        "h-9 w-full rounded-md border border-border bg-bg px-3 text-sm text-text placeholder:text-text-dim",
        "focus:border-accent focus:outline-none",
        className,
      )}
    />
  );
}
