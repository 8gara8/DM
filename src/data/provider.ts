/**
 * DataProvider interface + yahoo-finance2 implementation.
 *
 * Bars are returned with split/dividend-adjusted OHLC (the engine config
 * `data.requireAdjustedOhlc` is `true`). Provider impls are responsible
 * for applying adjustments before returning.
 */

import type { Bar } from "@/engine/types";

export interface DataProvider {
  /**
   * Fetch daily bars. If `fromDate` is supplied, only bars on or after
   * that date are returned. Implementations may always return the full
   * history if it's cheap; the caller will dedupe by date.
   */
  fetchDailyBars(ticker: string, fromDate?: string): Promise<Bar[]>;
}

export class YahooFinance2Provider implements DataProvider {
  private clientPromise: Promise<
    InstanceType<(typeof import("yahoo-finance2"))["default"]>
  > | null = null;

  private getClient() {
    if (!this.clientPromise) {
      this.clientPromise = import("yahoo-finance2").then(
        (m) => new m.default(),
      );
    }
    return this.clientPromise;
  }

  async fetchDailyBars(ticker: string, fromDate?: string): Promise<Bar[]> {
    const yf = await this.getClient();
    const period1 = fromDate ?? "2000-01-01";
    const result = await yf.chart(ticker, {
      period1,
      interval: "1d",
    });
    const bars: Bar[] = [];
    for (const q of result.quotes) {
      if (
        q.open == null ||
        q.high == null ||
        q.low == null ||
        q.close == null ||
        q.date == null
      )
        continue;
      const d = q.date instanceof Date ? q.date : new Date(q.date);
      bars.push({
        date: d.toISOString().slice(0, 10),
        open: q.open,
        high: q.high,
        low: q.low,
        close: q.close,
        volume: q.volume ?? undefined,
      });
    }
    return bars;
  }
}

let cachedProvider: DataProvider | null = null;
export function getDataProvider(): DataProvider {
  if (cachedProvider) return cachedProvider;
  const choice = process.env.DATA_PROVIDER ?? "yahoo";
  if (choice === "yahoo") {
    cachedProvider = new YahooFinance2Provider();
    return cachedProvider;
  }
  throw new Error(`Unsupported DATA_PROVIDER: ${choice}`);
}
