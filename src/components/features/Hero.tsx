import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Pill } from "@/components/ui/Pill";
import { Sparkline } from "./Sparkline";
import { HitRatePill } from "./HitRatePill";
import { TickerCard } from "./TickerCard";
import { RankingFactorsExpander } from "./RankingFactorsExpander";
import { formatPercent, formatPrice } from "@/lib/format";
import type { HeroPayload } from "@/lib/dashboard-types";

interface HeroProps {
  hero: HeroPayload;
}

export function Hero({ hero }: HeroProps) {
  if (hero.type === "loading") {
    return (
      <Card className="h-48 animate-pulse">
        <div className="h-4 w-24 rounded bg-surface-hover" />
      </Card>
    );
  }
  if (hero.type === "empty-watchlist") {
    return (
      <Card className="text-center py-10">
        <h1 className="text-base font-medium text-text">Watchlist is empty.</h1>
        <p className="mt-1 text-sm text-text-muted">
          Add your first ticker to start tracking signals.
        </p>
      </Card>
    );
  }
  if (hero.type === "nothing-notable") {
    return (
      <Card className="bg-surface-hover">
        <div className="flex items-baseline justify-between">
          <h1 className="text-base font-medium text-text">
            Nothing notable on your watchlist today.
          </h1>
          {hero.lastHotSignal && (
            <span className="text-xs text-text-muted">
              Last hot signal: {hero.lastHotSignal.ticker} {hero.lastHotSignal.direction}{" "}
              {hero.lastHotSignal.eventType.replace(/_/g, " ")} {hero.lastHotSignal.timeframe},{" "}
              {hero.lastHotSignal.daysAgo}d ago
            </span>
          )}
        </div>
        {hero.approaching.length > 0 && (
          <div className="mt-3">
            <p className="text-xs uppercase tracking-wider text-text-muted">Approaching</p>
            <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
              {hero.approaching.slice(0, 3).map((tile) => (
                <TickerCard key={tile.ticker} tile={tile} variant="compact" />
              ))}
            </div>
          </div>
        )}
      </Card>
    );
  }
  // signal
  const trendClass = hero.changePct >= 0 ? "text-buy" : "text-sell";
  return (
    <Link
      href={`/ticker/${hero.ticker}?tf=${hero.timeframe}`}
      className="block hover:no-underline"
    >
      <Card className="hover:bg-surface-hover transition-colors">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
          <div className="flex-1">
            <div className="flex items-baseline gap-3">
              <span className="font-mono text-2xl font-medium text-text">{hero.ticker}</span>
              <span className="font-mono text-sm text-text-muted">
                {formatPrice(hero.price)}{" "}
                <span className={trendClass}>{formatPercent(hero.changePct)}</span>
              </span>
              <Pill className="px-2 py-0.5 text-xs">{hero.timeframe}</Pill>
              <span
                className={
                  hero.direction === "buy"
                    ? "rounded-md bg-buy text-bg px-2 py-0.5 text-xs font-mono"
                    : "rounded-md bg-sell text-bg px-2 py-0.5 text-xs font-mono"
                }
              >
                {hero.badge}
              </span>
            </div>
            <p className="mt-3 text-base italic text-text">
              <span className="not-italic text-[10px] uppercase tracking-wider text-text-muted mr-2">
                summary
              </span>
              {hero.translation}
            </p>
            <div className="mt-3 flex items-center gap-4 text-xs font-mono text-text-muted">
              {hero.tdst && (
                <span>
                  TDST {formatPrice(hero.tdst.price)} ({formatPercent(hero.tdst.distancePct)})
                </span>
              )}
              {hero.risk && (
                <span>
                  Risk {formatPrice(hero.risk.price)} ({formatPercent(hero.risk.distancePct)})
                </span>
              )}
              <HitRatePill stat={hero.hitRate} ticker={hero.ticker} timeframe={hero.timeframe} />
              <span>score {hero.rankingScore.toFixed(1)}</span>
            </div>
            <RankingFactorsExpander factors={hero.rankingFactors} />
          </div>
          <div className="lg:w-1/2">
            <Sparkline
              bars={hero.sparkline.bars}
              markers={hero.sparkline.markers}
              lookbackLabel={hero.sparkline.lookbackLabel}
              ariaLabel={`${hero.sparkline.lookbackLabel} price line for ${hero.ticker}`}
              height={80}
            />
          </div>
        </div>
      </Card>
    </Link>
  );
}
