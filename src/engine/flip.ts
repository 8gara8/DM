/**
 * TD Price Flip detection.
 *
 *   Bullish Price Flip:  c[i] > c[i-4]  AND  c[i-1] < c[i-5]
 *   Bearish Price Flip:  c[i] < c[i-4]  AND  c[i-1] > c[i-5]
 *
 * Per `DeMark_Technical_Specification.md` §2.3 / §3.1.1.
 *
 * Strict inequality matches the canonical Perl text and the modern public
 * defaults (see `EngineConfig.setup.strict`). When `strict === false`,
 * equality is treated as a continuation of the prior side rather than a
 * reset — useful for academic variants but not v1.
 */

import type { Bar, Direction } from "./types";

export interface PriceFlipResult {
  /** "buy" means a Bearish flip preceding a Buy Setup. */
  flip: Direction | null;
}

export function detectPriceFlip(bars: Bar[], i: number, strict = true): PriceFlipResult {
  if (i < 5) return { flip: null };
  const ci = bars[i]!.close;
  const ciPrev = bars[i - 1]!.close;
  const c4 = bars[i - 4]!.close;
  const c5 = bars[i - 5]!.close;

  const cmpGt = strict ? (a: number, b: number) => a > b : (a: number, b: number) => a >= b;
  const cmpLt = strict ? (a: number, b: number) => a < b : (a: number, b: number) => a <= b;

  // Bearish flip → precedes a Buy Setup
  if (cmpLt(ci, c4) && cmpGt(ciPrev, c5)) return { flip: "buy" };
  // Bullish flip → precedes a Sell Setup
  if (cmpGt(ci, c4) && cmpLt(ciPrev, c5)) return { flip: "sell" };
  return { flip: null };
}

/**
 * Convenience: would a Setup count of `direction` actually start at this
 * bar given (a) the lookback rule and (b) the price-flip gate?
 */
export function setupStartsHere(
  bars: Bar[],
  i: number,
  direction: Direction,
  options: { lookback: number; strict: boolean; requirePriceFlip: boolean },
): boolean {
  const { lookback, strict, requirePriceFlip } = options;
  if (i < lookback) return false;
  const ci = bars[i]!.close;
  const cBack = bars[i - lookback]!.close;
  const lookbackOK =
    direction === "buy"
      ? strict
        ? ci < cBack
        : ci <= cBack
      : strict
        ? ci > cBack
        : ci >= cBack;
  if (!lookbackOK) return false;
  if (!requirePriceFlip) return true;
  return detectPriceFlip(bars, i, strict).flip === direction;
}
