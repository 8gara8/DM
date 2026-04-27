/**
 * Setup perfection check.
 *
 *   Buy Setup is perfected if  min(l[8], l[9]) ≤ min(l[6], l[7])
 *   Sell Setup is perfected if max(h[8], h[9]) ≥ max(h[6], h[7])
 *
 * (`l[k]` here means "low of Setup count k", i.e. the bar where Setup
 * count = k printed.)
 *
 * "Late perfection" (lookahead): if perfection fails on bar 9, the engine
 * may continue to check up to `lookaheadBars` forward bars. If any of them
 * extends below (Buy) / above (Sell) the bar-6/7 floor without breaking
 * the Setup count, perfection retroactively flips to true.
 *
 * Strict mode uses `<` / `>`. Inclusive mode uses `≤` / `≥` — matches the
 * canonical Perl text.
 */

import type { Bar, Direction } from "./types";
import type { SetupPerfectionMode } from "./config";

export function isPerfected(
  bars: Bar[],
  setupBarIndices: number[],
  direction: Direction,
  mode: SetupPerfectionMode = "strict",
): boolean {
  if (setupBarIndices.length < 9) return false;
  const idx6 = setupBarIndices[5]!;
  const idx7 = setupBarIndices[6]!;
  const idx8 = setupBarIndices[7]!;
  const idx9 = setupBarIndices[8]!;
  if (direction === "buy") {
    const minL89 = Math.min(bars[idx8]!.low, bars[idx9]!.low);
    const minL67 = Math.min(bars[idx6]!.low, bars[idx7]!.low);
    return mode === "strict" ? minL89 < minL67 : minL89 <= minL67;
  }
  const maxH89 = Math.max(bars[idx8]!.high, bars[idx9]!.high);
  const maxH67 = Math.max(bars[idx6]!.high, bars[idx7]!.high);
  return mode === "strict" ? maxH89 > maxH67 : maxH89 >= maxH67;
}

/**
 * Late-perfection check. Look at any bar after Setup completion (up to
 * `lookaheadBars` forward) and ask: did its extreme break the bar-6/7
 * floor while no opposing Setup or recycle has occurred? If so,
 * perfection becomes true retroactively.
 */
export function isLatePerfected(
  bars: Bar[],
  setupBarIndices: number[],
  direction: Direction,
  forwardBarIndex: number,
  mode: SetupPerfectionMode = "strict",
): boolean {
  if (setupBarIndices.length < 9) return false;
  const idx6 = setupBarIndices[5]!;
  const idx7 = setupBarIndices[6]!;
  if (direction === "buy") {
    const lookahead = bars[forwardBarIndex]!.low;
    const minL67 = Math.min(bars[idx6]!.low, bars[idx7]!.low);
    return mode === "strict" ? lookahead < minL67 : lookahead <= minL67;
  }
  const lookahead = bars[forwardBarIndex]!.high;
  const maxH67 = Math.max(bars[idx6]!.high, bars[idx7]!.high);
  return mode === "strict" ? lookahead > maxH67 : lookahead >= maxH67;
}
