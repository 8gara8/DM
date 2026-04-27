/**
 * Risk Level (post-13 stop / invalidation level).
 *
 * Per `DeMark_Technical_Specification.md` §3.3 / §8.7.
 *
 *   Buy 13:  L  = bar with lowest true low across the Setup→13 process
 *            risk = trueLow(L) − trueRange(L) * multiplier
 *   Sell 13: H  = bar with highest true high across the same window
 *            risk = trueHigh(H) + trueRange(H) * multiplier
 *
 * Window: ALL bars from Setup bar 1 through Countdown bar 13 inclusive,
 * including bars that didn't get a count (`countdown_process_including_unnumbered`).
 */

import type { Bar, Direction } from "./types";
import { trueHigh, trueLow, trueRange } from "./tdst";

export function calcRiskLevel(
  bars: Bar[],
  direction: Direction,
  windowStartIdx: number,
  windowEndIdx: number,
  multiplier = 1.0,
): number {
  if (direction === "buy") {
    let lowestIdx = windowStartIdx;
    let lowestVal = trueLow(bars, windowStartIdx);
    for (let i = windowStartIdx + 1; i <= windowEndIdx; i++) {
      const v = trueLow(bars, i);
      if (v < lowestVal) {
        lowestVal = v;
        lowestIdx = i;
      }
    }
    return trueLow(bars, lowestIdx) - trueRange(bars, lowestIdx) * multiplier;
  }
  let highestIdx = windowStartIdx;
  let highestVal = trueHigh(bars, windowStartIdx);
  for (let i = windowStartIdx + 1; i <= windowEndIdx; i++) {
    const v = trueHigh(bars, i);
    if (v > highestVal) {
      highestVal = v;
      highestIdx = i;
    }
  }
  return trueHigh(bars, highestIdx) + trueRange(bars, highestIdx) * multiplier;
}

/** True if `bars[i]` breaches the risk level for `direction`. */
export function riskBreached(
  bars: Bar[],
  i: number,
  direction: Direction,
  riskLevel: number,
): boolean {
  return direction === "buy"
    ? trueLow(bars, i) < riskLevel
    : trueHigh(bars, i) > riskLevel;
}
