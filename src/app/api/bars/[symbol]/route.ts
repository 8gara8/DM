/**
 * GET /api/bars/:symbol — OHLCV for a ticker, used by TickerChart.
 *
 * Query params:
 *   - tf (timeframe): "daily" | "weekly" | "monthly" | "yearly", default "daily"
 *   - limit: max bars to return, default 500, max 2000
 *   - refresh: if "1", force refetch from provider even if cache exists
 *
 * Auth: requires Auth.js session (401 if missing).
 *
 * Staleness check: if no bars OR newest bar's fetchedAt is older than
 *   - 24h for daily
 *   - 7d for weekly
 *   - 30d for monthly
 *   - 365d for yearly
 * then call the DataProvider to refetch + upsert. Without ?refresh=1, we
 * return stale cache with a stale: true flag rather than block on refetch
 * (the API route timeout is typically 10s; a fresh provider call can exceed it).
 * The ?refresh=1 opt-in forces the refetch synchronously for those who want it.
 */

import { desc, eq, and } from "drizzle-orm";
import { auth } from "@/server/auth";
import { db } from "@/lib/db/client";
import { bars as barsTable } from "@/lib/db/schema";
import { err, ok, withErrors } from "@/lib/api";
import type { Bar } from "@/engine/types";
import { getDataProvider } from "@/data/provider";
import { resample } from "@/data/resample";

type TF = "daily" | "weekly" | "monthly" | "yearly";

const STALE_THRESHOLDS: Record<TF, number> = {
  daily: 24 * 60 * 60 * 1000,      // 24h
  weekly: 7 * 24 * 60 * 60 * 1000,  // 7d
  monthly: 30 * 24 * 60 * 60 * 1000, // 30d
  yearly: 365 * 24 * 60 * 60 * 1000, // 365d
};

function isValidTimeframe(tf: string): tf is TF {
  return ["daily", "weekly", "monthly", "yearly"].includes(tf);
}

export const GET = withErrors(async (req, ctx) => {
  // Auth check
  const session = await auth();
  if (!session?.user?.id) {
    return err("UNAUTHENTICATED", "sign in required", 401);
  }

  // Parse query params
  const u = new URL(req.url);
  const tfParam = u.searchParams.get("tf") ?? "daily";
  const limitParam = Math.min(2000, Math.max(1, parseInt(u.searchParams.get("limit") ?? "500", 10)));
  const refreshParam = u.searchParams.get("refresh") === "1";

  // Validate timeframe
  if (!isValidTimeframe(tfParam)) {
    return err("BAD_REQUEST", `invalid timeframe: ${tfParam}`, 400);
  }

  // Extract symbol from Next.js dynamic route params
  const params = (await ctx?.params) as { symbol?: string };
  const symbol = params?.symbol?.toUpperCase();

  // Validate symbol format (basic check)
  if (!symbol || !/^[A-Z][A-Z0-9.\-]{0,9}$/.test(symbol)) {
    return err("BAD_REQUEST", `invalid symbol: ${symbol}`, 400);
  }

  // Load the most-recent `limit` cached bars: order descending + limit, then
  // reverse to ascending. Ascending-then-limit would return the OLDEST rows,
  // so the staleness check and chart would use stale data for long-history
  // tickers even when fresh bars exist.
  let cachedBars = (
    await db
      .select()
      .from(barsTable)
      .where(
        and(eq(barsTable.ticker, symbol), eq(barsTable.timeframe, tfParam)),
      )
      .orderBy(desc(barsTable.date))
      .limit(limitParam)
  ).reverse();

  // Check staleness
  const now = Date.now();
  const threshold = STALE_THRESHOLDS[tfParam];
  let isStale = cachedBars.length === 0;

  if (!isStale && cachedBars.length > 0) {
    const newestBar = cachedBars[cachedBars.length - 1]!;
    const fetchedAt = newestBar.fetchedAt ? new Date(newestBar.fetchedAt).getTime() : 0;
    isStale = now - fetchedAt > threshold;
  }

  // ?refresh=1 forces a synchronous refetch even when the cache is fresh (per
  // the route contract above); without it we never block on the provider and
  // just return cache (with a stale flag when applicable).
  if (refreshParam) {
    try {
      const provider = getDataProvider();
      const freshDailyBars = await provider.fetchDailyBars(symbol);

      if (freshDailyBars.length > 0) {
        // Resample if needed
        const resampled =
          tfParam === "daily"
            ? freshDailyBars
            : resample(freshDailyBars, tfParam);

        // Upsert into the bars table
        const fetchedAtNow = new Date().toISOString();
        for (const bar of resampled) {
          await db
            .insert(barsTable)
            .values({
              ticker: symbol,
              timeframe: tfParam,
              date: bar.date,
              open: bar.open,
              high: bar.high,
              low: bar.low,
              close: bar.close,
              volume: bar.volume,
              fetchedAt: fetchedAtNow,
            })
            .onConflictDoUpdate({
              target: [barsTable.ticker, barsTable.timeframe, barsTable.date],
              set: {
                open: bar.open,
                high: bar.high,
                low: bar.low,
                close: bar.close,
                volume: bar.volume,
                fetchedAt: fetchedAtNow,
              },
            });
        }

        // Reload bars post-upsert (most-recent first, then reverse to ascending)
        cachedBars = (
          await db
            .select()
            .from(barsTable)
            .where(
              and(
                eq(barsTable.ticker, symbol),
                eq(barsTable.timeframe, tfParam),
              ),
            )
            .orderBy(desc(barsTable.date))
            .limit(limitParam)
        ).reverse();

        isStale = false;
      }
    } catch (e) {
      console.warn(`[bars route] refetch failed for ${symbol}:`, e);
      // Fall through: return stale cache with stale flag
    }
  }

  // Map bar rows to narrow Bar shape
  const mappedBars: Bar[] = cachedBars.map((row) => ({
    date: row.date,
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    volume: row.volume ?? undefined,
  }));

  // Build response
  const response: {
    ticker: string;
    timeframe: TF;
    bars: Bar[];
    stale?: boolean;
  } = {
    ticker: symbol,
    timeframe: tfParam,
    bars: mappedBars,
  };

  if (isStale && cachedBars.length > 0) {
    response.stale = true;
  }

  return ok(response);
});
