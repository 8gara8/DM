/**
 * Fixed-horizon backtest stats.
 *
 * Per SPEC.md §9 Phase 5 + Appendix D.3 the no-lookahead policy is:
 *   - Entry bar MUST satisfy `entryBar > firstKnownAtDate` (i.e. enter on
 *     the next bar's open after the event was knowable).
 *   - For Sequential / Setup events, `firstKnownAtDate === barDate`, so
 *     the earliest entry is the bar after the event.
 *   - For Combo events that printed inside Setup bars 1..8, the earliest
 *     entry is the bar AFTER Setup bar 9.
 *
 * Returns are measured at +5 / +13 / +21 bars from the entry bar. MFE
 * is the max favorable excursion across the same window.
 */

import type { Bar, Direction } from "./types";

export interface BacktestSignalInput {
  /** Date the signal printed on (e.g. completed Setup or Countdown). */
  barDate: string;
  /**
   * The bar after which the signal became KNOWN. For Sequential events
   * this equals `barDate`. For Combo events that printed early in the
   * Setup, it is `setupCompleteBarDate`.
   */
  firstKnownAtDate: string;
  direction: Direction;
}

export interface BacktestSignalOutput {
  barDate: string;
  firstKnownAtDate: string;
  direction: Direction;
  entryBarDate: string | null;
  entryBarIndex: number | null;
  returnAt5: number | null;
  returnAt13: number | null;
  returnAt21: number | null;
  maxFavorableExcursion: number | null;
  /** True if a configured stop (RiskLevel) was breached in the window. */
  stopped: boolean;
}

function findIndexByDate(bars: Bar[], date: string): number {
  for (let i = 0; i < bars.length; i++) {
    if (bars[i]!.date === date) return i;
  }
  return -1;
}

function pctReturn(direction: Direction, entryPrice: number, exitPrice: number): number {
  if (direction === "buy") return (exitPrice - entryPrice) / entryPrice;
  return (entryPrice - exitPrice) / entryPrice;
}

export function computeSignalBacktest(
  bars: Bar[],
  signal: BacktestSignalInput,
  options: { stopLevel?: number } = {},
): BacktestSignalOutput {
  const out: BacktestSignalOutput = {
    barDate: signal.barDate,
    firstKnownAtDate: signal.firstKnownAtDate,
    direction: signal.direction,
    entryBarDate: null,
    entryBarIndex: null,
    returnAt5: null,
    returnAt13: null,
    returnAt21: null,
    maxFavorableExcursion: null,
    stopped: false,
  };

  const knownAtIdx = findIndexByDate(bars, signal.firstKnownAtDate);
  if (knownAtIdx < 0) return out;
  const entryIdx = knownAtIdx + 1;
  if (entryIdx >= bars.length) return out;

  // Per the no-lookahead policy: enter at the OPEN of the bar after
  // firstKnownAt — not at any close. Using close would make returns
  // ignore opening gaps.
  const entryOpen = bars[entryIdx]!.open;
  out.entryBarIndex = entryIdx;
  out.entryBarDate = bars[entryIdx]!.date;

  const horizons: Array<[number, "returnAt5" | "returnAt13" | "returnAt21"]> = [
    [5, "returnAt5"],
    [13, "returnAt13"],
    [21, "returnAt21"],
  ];

  let mfe = 0;
  for (let k = 0; k <= 21 && entryIdx + k < bars.length; k++) {
    const idx = entryIdx + k;
    const px =
      signal.direction === "buy" ? bars[idx]!.high : bars[idx]!.low;
    const r = pctReturn(signal.direction, entryOpen, px);
    if (r > mfe) mfe = r;
    if (options.stopLevel != null && k > 0) {
      const stopHit =
        signal.direction === "buy"
          ? bars[idx]!.low <= options.stopLevel
          : bars[idx]!.high >= options.stopLevel;
      if (stopHit) {
        out.stopped = true;
        break;
      }
    }
  }
  out.maxFavorableExcursion = mfe;

  for (const [n, key] of horizons) {
    const targetIdx = entryIdx + n;
    if (targetIdx >= bars.length) continue;
    out[key] = pctReturn(signal.direction, entryOpen, bars[targetIdx]!.close);
  }

  return out;
}

export interface AggregateStats {
  count: number;
  hitRateAt13: number | null;
  avgReturnAt13: number | null;
  winLossRatio: number | null;
}

export function aggregateBacktest(rows: BacktestSignalOutput[]): AggregateStats {
  const withR13 = rows.filter((r) => r.returnAt13 != null);
  if (withR13.length === 0) {
    return { count: rows.length, hitRateAt13: null, avgReturnAt13: null, winLossRatio: null };
  }
  const hits = withR13.filter((r) => (r.returnAt13 ?? 0) > 0).length;
  const sum = withR13.reduce((a, r) => a + (r.returnAt13 ?? 0), 0);
  const avgWin =
    withR13.filter((r) => (r.returnAt13 ?? 0) > 0).reduce((a, r) => a + (r.returnAt13 ?? 0), 0) /
    Math.max(1, hits);
  const losses = withR13.filter((r) => (r.returnAt13 ?? 0) <= 0);
  const avgLoss =
    losses.reduce((a, r) => a + Math.abs(r.returnAt13 ?? 0), 0) /
    Math.max(1, losses.length);
  return {
    count: rows.length,
    hitRateAt13: hits / withR13.length,
    avgReturnAt13: sum / withR13.length,
    winLossRatio: avgLoss > 0 ? avgWin / avgLoss : null,
  };
}
