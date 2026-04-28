/**
 * BacktestPanel — Server Component placeholder for Phase 5.
 *
 * Props:
 *   - ticker: the ticker symbol
 *   - timeframe: one of daily/weekly/monthly/yearly
 *   - indicator: "sequential" | "combo"
 *
 * For Phase 4, this renders a simple Card with a placeholder message.
 * Phase 5 will populate this with real backtest stats (hit rate, returns, etc.).
 */

import type { Timeframe } from "@/engine/types";
import { Card } from "@/components/ui/Card";

interface BacktestPanelProps {
  ticker: string;
  timeframe: Timeframe;
  indicator: "sequential" | "combo";
}

export function BacktestPanel({
  ticker,
  timeframe,
  indicator,
}: BacktestPanelProps) {
  return (
    <Card className="p-4">
      <h3 className="text-sm font-semibold text-text mb-2">Backtest</h3>
      <p className="text-sm text-text-muted">
        Coming in Phase 5 — fixed-horizon return + MFE per signal.
      </p>
      <p className="text-xs text-text-dim mt-2">
        {ticker} × {timeframe} × {indicator}
      </p>
    </Card>
  );
}
