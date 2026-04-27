import type { Bar } from "../../src/engine/types";

/**
 * Build a synthetic bar series from a list of close prices.
 * Each bar's open=high=low=close so the lookback rule is the only
 * driver — useful for unit tests that don't need true intraday range.
 *
 * Pass `highOffset` / `lowOffset` to widen the bar around the close (used
 * for perfection tests where we need bar 8/9 to break bar 6/7's low/high).
 */
export function fromCloses(
  closes: number[],
  options: { highOffset?: number; lowOffset?: number; startDate?: string } = {},
): Bar[] {
  const start = options.startDate ?? "2024-01-01";
  const startDate = new Date(`${start}T00:00:00Z`);
  const bars: Bar[] = [];
  for (let i = 0; i < closes.length; i++) {
    const d = new Date(startDate);
    d.setUTCDate(d.getUTCDate() + i);
    const c = closes[i]!;
    bars.push({
      date: d.toISOString().slice(0, 10),
      open: c,
      high: c + (options.highOffset ?? 0),
      low: c - (options.lowOffset ?? 0),
      close: c,
    });
  }
  return bars;
}

/** Build a bar with explicit OHLC values. */
export function bar(date: string, ohlc: [number, number, number, number]): Bar {
  return {
    date,
    open: ohlc[0],
    high: ohlc[1],
    low: ohlc[2],
    close: ohlc[3],
  };
}

/** Build N bars spaced 1 day apart starting at `start`. Each bar's date
 *  is computed automatically; OHLCs come from the supplied array. */
export function makeBars(start: string, ohlcs: Array<[number, number, number, number]>): Bar[] {
  const sd = new Date(`${start}T00:00:00Z`);
  return ohlcs.map((o, i) => {
    const d = new Date(sd);
    d.setUTCDate(d.getUTCDate() + i);
    return bar(d.toISOString().slice(0, 10), o);
  });
}
