/**
 * /ticker/[symbol] — Detail page for a single ticker.
 *
 * Shows:
 *   - Header with ticker, price, change%
 *   - Timeframe tab strip (daily/weekly/monthly/yearly)
 *   - TickerChart (candlesticks + TDST + markers)
 *   - 2-column grid: SignalTimeline (left ~⅓) + BacktestPanel (right ~⅔)
 *   - 404 state if no cached bars
 *
 * Auth: redirect to / if no session.
 */

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { TickerChart } from "@/components/features/TickerChart";
import { SignalTimeline } from "@/components/features/SignalTimeline";
import { BacktestPanel } from "@/components/features/BacktestPanel";
import { ScanButton } from "@/components/features/ScanButton";
import { Card } from "@/components/ui/Card";
import { loadTickerDetail } from "@/server/ticker-detail";
import type { Timeframe } from "@/engine/types";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ symbol: string }>;
  searchParams: Promise<{ tf?: string }>;
}

const VALID_TFS: Timeframe[] = ["daily", "weekly", "monthly", "yearly"];

export default async function TickerPage({ params, searchParams }: PageProps) {
  // Auth gate
  const session = await auth();
  if (!session?.user) {
    redirect("/");
  }

  // Parse params
  const { symbol: symbolRaw } = await params;
  const { tf: tfParam } = await searchParams;

  // Validate symbol (basic format check)
  const symbol = symbolRaw.toUpperCase();
  if (!symbol || !/^[A-Z][A-Z0-9.\-]{0,9}$/.test(symbol)) {
    notFound();
  }

  // Validate and default timeframe
  const tf = tfParam && VALID_TFS.includes(tfParam as Timeframe)
    ? (tfParam as Timeframe)
    : "daily";

  // Load data
  try {
    const { bars, events, tdstLines } = await loadTickerDetail(symbol, tf);

    // 404 if no bars
    if (bars.length === 0) {
      return (
        <div className="mx-auto max-w-2xl py-16">
          <Card className="p-6 text-center">
            <h2 className="text-lg font-medium mb-2">No cached bars</h2>
            <p className="text-sm text-text-muted mb-4">
              No price history is cached yet for <strong>{symbol}</strong>.
              Run a scan to fetch the data.
            </p>
            <ScanButton scope={{ ticker: symbol }} label="Scan now" />
          </Card>
        </div>
      );
    }

    // Get current price from latest bar
    const lastBar = bars[bars.length - 1]!;
    const previousBar = bars.length > 1 ? bars[bars.length - 2]! : lastBar;
    const price = lastBar.close;
    const change = price - previousBar.close;
    const changePercent = (change / previousBar.close) * 100;

    // Format price display
    const changeStr = `${change >= 0 ? "+" : ""}${change.toFixed(2)}`;
    const changePercentStr = `${change >= 0 ? "+" : ""}${changePercent.toFixed(2)}%`;
    const changeColor = change >= 0 ? "text-buy" : "text-sell";

    return (
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-baseline justify-between">
          <div>
            <h1 className="text-2xl font-bold text-text">{symbol}</h1>
            <p className="text-sm text-text-muted">
              {price.toLocaleString("en-US", {
                style: "currency",
                currency: "USD",
              })}
              {" "}
              <span className={changeColor}>
                {changeStr} ({changePercentStr})
              </span>
            </p>
          </div>
          <Link href="/" className="text-sm text-accent hover:underline">
            Back to dashboard
          </Link>
        </div>

        {/* Timeframe tabs */}
        <div className="flex gap-2 border-b border-border-subtle">
          {VALID_TFS.map((timeframe) => {
            const isCurrent = timeframe === tf;
            return (
              <Link
                key={timeframe}
                href={`/ticker/${symbol}?tf=${timeframe}`}
                className={`px-3 py-2 text-sm font-medium transition-colors ${
                  isCurrent
                    ? "border-b-2 border-accent text-accent"
                    : "text-text-muted hover:text-text"
                }`}
              >
                {timeframe.charAt(0).toUpperCase() + timeframe.slice(1)}
              </Link>
            );
          })}
        </div>

        {/* Chart */}
        <Card className="p-0 overflow-hidden">
          <TickerChart
            bars={bars}
            events={events}
            tdstLines={tdstLines}
            height="min(60vh, 600px)"
          />
        </Card>

        {/* Timeline + Backtest grid */}
        <div className="grid grid-cols-3 gap-6">
          {/* Timeline: left ~⅓ */}
          <div className="col-span-1">
            <Card className="p-4">
              <h2 className="text-sm font-semibold text-text mb-3">
                Signal Timeline
              </h2>
              <SignalTimeline events={events} />
            </Card>
          </div>

          {/* Backtest: right ~⅔ */}
          <div className="col-span-2">
            <BacktestPanel
              ticker={symbol}
              timeframe={tf}
              indicator="sequential"
            />
          </div>
        </div>
      </div>
    );
  } catch (e) {
    console.error(`[ticker] failed to load ${symbol}:`, e);
    return (
      <div className="mx-auto max-w-2xl py-16">
        <Card className="p-6 text-center bg-red-500/5">
          <h2 className="text-lg font-medium mb-2">Error</h2>
          <p className="text-sm text-text-muted">
            Failed to load ticker data. Please try again.
          </p>
        </Card>
      </div>
    );
  }
}
