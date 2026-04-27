import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Pill } from "@/components/ui/Pill";
import { Sparkline } from "./Sparkline";
import { ConfluenceDots } from "./ConfluenceDots";
import { HitRatePill } from "./HitRatePill";
import { SignalBadge } from "./SignalBadge";
import { formatPercent, formatPrice } from "@/lib/format";
import type { TickerTile } from "@/lib/dashboard-types";

interface TickerCardProps {
  tile: TickerTile;
  variant?: "default" | "compact";
}

export function TickerCard({ tile, variant = "default" }: TickerCardProps) {
  const compact = variant === "compact";
  const trendClass = tile.changePct >= 0 ? "text-buy" : "text-sell";
  return (
    <Link
      href={`/ticker/${tile.ticker}?tf=${tile.primaryBadge.timeframe}`}
      className="block hover:no-underline"
    >
      <Card className="hover:bg-surface-hover transition-colors">
        <div className="flex items-baseline justify-between gap-2">
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-[15px] font-medium text-text">{tile.ticker}</span>
            {tile.tags.length > 0 && (
              <span className="flex gap-1">
                {tile.tags.slice(0, 2).map((t) => (
                  <Pill key={t} className="text-[10px] px-1.5 py-0">
                    {t}
                  </Pill>
                ))}
              </span>
            )}
          </div>
          <div className="font-mono text-[11px] text-text-muted">
            {formatPrice(tile.price)} <span className={trendClass}>{formatPercent(tile.changePct)}</span>
          </div>
        </div>
        <div className="mt-2">
          <SignalBadge
            direction={tile.primaryBadge.direction}
            phase={tile.primaryBadge.phase}
            indicator={tile.primaryBadge.indicator}
            count={tile.primaryBadge.count}
            max={tile.primaryBadge.max}
            isPerfected={tile.primaryBadge.isPerfected}
            isQualified={tile.primaryBadge.isQualified}
            isDeferred={tile.primaryBadge.isDeferred}
            timeframe={tile.primaryBadge.timeframe}
          />
        </div>
        <div className="mt-3">
          <Sparkline
            bars={tile.sparkline.bars}
            markers={tile.sparkline.markers}
            lookbackLabel={tile.sparkline.lookbackLabel}
            ariaLabel={`${tile.sparkline.lookbackLabel} price line for ${tile.ticker} ending today, current count ${tile.primaryBadge.direction ?? ""} ${tile.primaryBadge.count}`}
            height={compact ? 32 : 40}
          />
        </div>
        <div className="mt-3 flex items-center justify-between">
          <ConfluenceDots confluence={tile.confluence} size={compact ? "sm" : "md"} />
          {!compact && (
            <div className="text-[11px] text-text-muted font-mono flex items-center gap-3">
              {tile.tdst && (
                <span title={`TDST ${formatPrice(tile.tdst.price)}`}>
                  TDST {formatPercent(tile.tdst.distancePct)}
                </span>
              )}
              {tile.risk && (
                <span title={`Risk ${formatPrice(tile.risk.price)}`}>
                  Risk {formatPercent(tile.risk.distancePct)}
                </span>
              )}
              <HitRatePill
                stat={tile.hitRate}
                ticker={tile.ticker}
                timeframe={tile.primaryBadge.timeframe}
              />
            </div>
          )}
        </div>
        {(tile.status === "cancelled" || tile.status === "lapsed") && (
          <div className="mt-2 text-[11px] text-text-muted italic">
            {tile.status === "cancelled" ? "Cancelled" : "Lapsed — no reversal yet"}
          </div>
        )}
      </Card>
    </Link>
  );
}
