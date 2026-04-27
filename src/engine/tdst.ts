/**
 * TDST (TD Setup Trend) level math.
 *
 * The two reference specs disagree on the anchor:
 *   - `extreme_of_setup` — modern public DeMARK / TradingView convention.
 *     Buy Setup → resistance = highest true high across all 9 Setup bars.
 *     Sell Setup → support = lowest true low across all 9 Setup bars.
 *     **Default for v1.**
 *   - `bar_1` — canonical Jason Perl text. Anchor = the count-1 bar's
 *     true high (Buy resistance) / true low (Sell support).
 *   - `bar_before_1` — what the legacy Python codebase did. This is wrong
 *     vs. both Perl and modern DeMARK; available only for parity testing.
 *
 * "True high" / "true low" use the previous bar's close when it is more
 * extreme than the current bar's high/low, accounting for gaps. See the
 * canonical specs and `tests/engine/fixtures/canonical/tdst-*.json`.
 */

import type { Bar, Direction } from "./types";
import type { TdstAnchor } from "./config";

export function trueHigh(bars: Bar[], i: number): number {
  if (i === 0) return bars[i]!.high;
  return Math.max(bars[i]!.high, bars[i - 1]!.close);
}

export function trueLow(bars: Bar[], i: number): number {
  if (i === 0) return bars[i]!.low;
  return Math.min(bars[i]!.low, bars[i - 1]!.close);
}

export function trueRange(bars: Bar[], i: number): number {
  return trueHigh(bars, i) - trueLow(bars, i);
}

/**
 * Compute the TDST level for a completed Setup of `direction` whose
 * count-1 bar is at index `bar1Idx` and count-9 bar at `bar9Idx`.
 *
 * For a Buy Setup we return the resistance level (above price); for Sell
 * we return the support level (below price). The caller uses the level to
 * detect cancellation breaches.
 */
export function calcTdstLevel(
  bars: Bar[],
  direction: Direction,
  bar1Idx: number,
  bar9Idx: number,
  anchor: TdstAnchor,
): number {
  if (anchor === "bar_1") {
    return direction === "buy" ? trueHigh(bars, bar1Idx) : trueLow(bars, bar1Idx);
  }
  if (anchor === "bar_before_1") {
    const idx = Math.max(0, bar1Idx - 1);
    return direction === "buy" ? trueHigh(bars, idx) : trueLow(bars, idx);
  }
  // extreme_of_setup
  let extreme: number | null = null;
  for (let i = bar1Idx; i <= bar9Idx; i++) {
    const v = direction === "buy" ? trueHigh(bars, i) : trueLow(bars, i);
    if (extreme === null) {
      extreme = v;
    } else if (direction === "buy" ? v > extreme : v < extreme) {
      extreme = v;
    }
  }
  return extreme!;
}

/**
 * TDST cancellation test. Returns `true` when the Countdown should cancel.
 *   - "true_range" (modern default): Buy cancels if `trueLow > resistance`,
 *      i.e. the entire bar lifts above the resistance.
 *   - "close": Buy cancels if `close > resistance`. Legacy variant.
 */
export function tdstBreached(
  bars: Bar[],
  i: number,
  direction: Direction,
  level: number,
  test: "true_range" | "close",
): boolean {
  if (test === "close") {
    const c = bars[i]!.close;
    return direction === "buy" ? c > level : c < level;
  }
  // true_range
  return direction === "buy" ? trueLow(bars, i) > level : trueHigh(bars, i) < level;
}
