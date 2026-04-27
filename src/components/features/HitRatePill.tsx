import { cn } from "@/lib/utils";
import type { HitRateStat } from "@/lib/dashboard-types";

interface HitRatePillProps {
  stat: HitRateStat | null;
  ticker?: string;
  timeframe?: string;
}

export function HitRatePill({ stat, ticker, timeframe }: HitRatePillProps) {
  if (stat === null) {
    return (
      <span
        className="text-text-dim font-mono text-xs"
        title="Thin sample (fewer than 5 prior signals on this ticker × timeframe × indicator)"
      >
        —
      </span>
    );
  }
  const hr = stat.n > 0 ? stat.hits / stat.n : 0;
  const colorClass = stat.smallSample
    ? "text-warning"
    : hr >= 0.6
      ? "text-buy"
      : hr >= 0.4
        ? "text-warning"
        : "text-sell";
  const label = `${stat.signalType.replace(/_/g, " ")}s`;
  const tooltip = `% of prior ${stat.indicator} ${stat.signalType} events on ${ticker ?? "this ticker"} × ${timeframe ?? stat.horizon} with ${stat.indicator === "sequential" ? "favorable return" : "favorable return"} at ${stat.horizon}, before any stop logic.`;
  return (
    <span className={cn("font-mono text-xs", colorClass)} title={tooltip}>
      {stat.hits}/{stat.n} prior {label} right
      {stat.smallSample && (
        <span title={`Small sample (n=${stat.n})`} aria-label={`Small sample (n=${stat.n})`}>
          {" *"}
        </span>
      )}
    </span>
  );
}
