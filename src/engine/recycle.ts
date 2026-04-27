/**
 * Recycling rules (Setup → Countdown reset triggers).
 *
 *   1. Same-direction Setup extends to count `setupCountThreshold`
 *      (modern public default = 22; legacy Perl = 18).
 *   2. The overlapping new Setup's range
 *      `(highest true high − lowest true low)` falls inside
 *      `[rangeRatioMin, rangeRatioMax]` of the prior Setup's range.
 *      Modern: 1.0..2.0. Legacy: 1.0..1.618.
 *
 * The `setup_recycle` event meta records which trigger fired, plus the
 * prior and new Setup ranges. Behavior controlled by
 * `EngineConfig.sequential.recycle.behavior`:
 *   - "reset_to_new_setup" (default) — clear the active Countdown and
 *     restart from the new Setup.
 *   - "mark_R_only" — leave the Countdown intact, just emit the event
 *     and tag the bar.
 */

import type { Bar } from "./types";
import { trueHigh, trueLow } from "./tdst";

export interface SetupRange {
  bar1Idx: number;
  bar9Idx: number;
  range: number;
}

export function calcSetupRange(bars: Bar[], bar1Idx: number, bar9Idx: number): number {
  let hi = trueHigh(bars, bar1Idx);
  let lo = trueLow(bars, bar1Idx);
  for (let i = bar1Idx + 1; i <= bar9Idx; i++) {
    const h = trueHigh(bars, i);
    const l = trueLow(bars, i);
    if (h > hi) hi = h;
    if (l < lo) lo = l;
  }
  return hi - lo;
}

export interface RecycleEvalInput {
  setupExtensionCount: number;
  countThreshold: number;
  priorRange: number | null;
  newRange: number | null;
  rangeRatioMin: number;
  rangeRatioMax: number;
}

export type RecycleTrigger = "extension" | "range_ratio" | null;

export function evaluateRecycle(input: RecycleEvalInput): RecycleTrigger {
  if (input.setupExtensionCount >= input.countThreshold) return "extension";
  if (input.priorRange != null && input.newRange != null && input.priorRange > 0) {
    const ratio = input.newRange / input.priorRange;
    if (ratio >= input.rangeRatioMin && ratio <= input.rangeRatioMax) {
      return "range_ratio";
    }
  }
  return null;
}
