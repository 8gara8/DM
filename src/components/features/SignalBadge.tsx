import { cn } from "@/lib/utils";
import type { Direction, Indicator, Phase, Timeframe } from "@/engine/types";

interface SignalBadgeProps {
  direction: Direction | null;
  phase: Phase;
  indicator: Indicator;
  count: number;
  max: 9 | 13;
  timeframe?: Timeframe;
  isPerfected?: boolean;
  isQualified?: boolean;
  isDeferred?: boolean;
  className?: string;
}

export function SignalBadge({
  direction,
  phase,
  indicator,
  count,
  max,
  timeframe,
  isPerfected,
  isQualified,
  isDeferred,
  className,
}: SignalBadgeProps) {
  if (phase === "none" || !direction) return null;
  const isBuy = direction === "buy";
  const arrow = isBuy ? "▲" : "▼";
  const indicatorLetter = indicator === "sequential" ? "S" : "C";
  const completed = count === max;
  const colorClass = isBuy
    ? completed
      ? "bg-buy text-bg"
      : "bg-buy-dim text-buy"
    : completed
      ? "bg-sell text-bg"
      : "bg-sell-dim text-sell";
  const tag = isPerfected || isQualified ? "✓" : isDeferred ? "+" : null;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-mono text-xs",
        colorClass,
        className,
      )}
      aria-label={`${direction} ${phase} ${count} of ${max}${isPerfected ? " perfected" : ""}${timeframe ? ` ${timeframe}` : ""}`}
    >
      <span aria-hidden="true">{arrow}</span>
      <span aria-hidden="true">{indicatorLetter}</span>
      <span>
        {count}/{max}
      </span>
      {tag && <span aria-hidden="true">{tag}</span>}
      {timeframe && <span className="ml-0.5 text-[10px] opacity-80">{timeframe}</span>}
    </span>
  );
}
