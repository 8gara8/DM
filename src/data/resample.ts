/**
 * Daily → weekly / monthly / yearly resampling.
 *
 * Boundaries:
 *   - weekly = ISO week ending Friday (W-FRI)
 *   - monthly = month-end (ME)
 *   - yearly = year-end (YE)
 *
 * Each output bar is the OHLCV aggregate of all daily bars within the
 * window. The window's date is its last bar's date.
 */

import type { Bar, Timeframe } from "@/engine/types";

function fridayOf(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  // 0=Sun..6=Sat in JS; we want Friday = 5
  const dow = d.getUTCDay();
  const diff = (5 - dow + 7) % 7;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

function lastDayOfMonth(date: Date): string {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  const last = new Date(Date.UTC(y, m + 1, 0));
  return last.toISOString().slice(0, 10);
}

function lastDayOfYear(date: Date): string {
  const y = date.getUTCFullYear();
  return new Date(Date.UTC(y, 11, 31)).toISOString().slice(0, 10);
}

function bucketKey(barDate: string, tf: Timeframe): string {
  const d = new Date(`${barDate}T00:00:00Z`);
  if (tf === "weekly") return fridayOf(d);
  if (tf === "monthly") return lastDayOfMonth(d);
  if (tf === "yearly") return lastDayOfYear(d);
  return barDate;
}

export function resample(daily: Bar[], tf: Timeframe): Bar[] {
  if (tf === "daily") return daily;
  const buckets = new Map<string, Bar[]>();
  for (const bar of daily) {
    const key = bucketKey(bar.date, tf);
    const arr = buckets.get(key);
    if (arr) arr.push(bar);
    else buckets.set(key, [bar]);
  }
  const out: Bar[] = [];
  const sortedKeys = [...buckets.keys()].sort();
  for (const key of sortedKeys) {
    const bars = buckets.get(key)!;
    const open = bars[0]!.open;
    const close = bars[bars.length - 1]!.close;
    let high = bars[0]!.high;
    let low = bars[0]!.low;
    let volume = 0;
    for (const b of bars) {
      if (b.high > high) high = b.high;
      if (b.low < low) low = b.low;
      volume += b.volume ?? 0;
    }
    out.push({ date: key, open, high, low, close, volume });
  }
  return out;
}
