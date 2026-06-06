/**
 * Data-loading helpers for the /ticker/[symbol] page.
 *
 * Extracted into a separate module so the smoke test and the page can
 * reuse these queries without duplication.
 */

import { desc, eq, and } from "drizzle-orm";
import { db as defaultDb, type DB } from "@/lib/db/client";
import {
  bars as barsTable,
  signalEvents as signalEventsTable,
  signalStates as signalStatesTable,
} from "@/lib/db/schema";
import type { Bar, Timeframe } from "@/engine/types";

export interface TickerDetailPayload {
  ticker: string;
  bars: Bar[];
  events: (typeof signalEventsTable.$inferSelect)[];
  tdstLines: {
    price: number;
    from: string;
    to?: string;
    direction: "buy" | "sell";
  }[];
}

/**
 * Load bars, events, and TDST lines for a ticker × timeframe.
 */
export async function loadTickerDetail(
  symbol: string,
  timeframe: Timeframe,
  opts: { db?: DB; limit?: number } = {},
): Promise<TickerDetailPayload> {
  const db = opts.db ?? defaultDb;
  const limit = opts.limit ?? 500;

  // Load the most-recent `limit` bars: order descending + limit, then reverse
  // to ascending below. Ordering ascending before limiting would return the
  // OLDEST bars and make the page show stale prices for long-history tickers.
  const bars = await db
    .select()
    .from(barsTable)
    .where(
      and(
        eq(barsTable.ticker, symbol),
        eq(barsTable.timeframe, timeframe),
      ),
    )
    .orderBy(desc(barsTable.date))
    .limit(limit);

  // Load events ordered descending (most recent first)
  const events = await db
    .select()
    .from(signalEventsTable)
    .where(
      and(
        eq(signalEventsTable.ticker, symbol),
        eq(signalEventsTable.timeframe, timeframe),
      ),
    )
    .orderBy(desc(signalEventsTable.barDate))
    .limit(200);

  // Load signal states for both indicators, both directions
  const states = await db
    .select()
    .from(signalStatesTable)
    .where(
      and(
        eq(signalStatesTable.ticker, symbol),
        eq(signalStatesTable.timeframe, timeframe),
      ),
    );

  // Build TDST lines from any state with a tdstLevel AND valid direction
  const tdstLines: TickerDetailPayload["tdstLines"] = [];
  for (const state of states) {
    if (state.tdstLevel !== null && state.direction !== null) {
      tdstLines.push({
        price: state.tdstLevel,
        from: state.tdstAnchorBarDate ?? "",
        direction: state.direction,
      });
    }
  }

  // Map bar rows to narrow Bar shape (volume omitted when null). Rows came back
  // newest-first from the query above, so reverse to ascending for display.
  const mappedBars: Bar[] = bars
    .map((row) => ({
      date: row.date,
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close,
      volume: row.volume ?? undefined,
    }))
    .reverse();

  return { ticker: symbol, bars: mappedBars, events, tdstLines };
}
