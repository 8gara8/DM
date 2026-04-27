import { describe, expect, it } from "vitest";
import { computeSignalBacktest } from "../../src/engine/backtest";
import { fromCloses } from "./_helpers";

describe("computeSignalBacktest no-lookahead discipline", () => {
  it("entry bar is the bar AFTER firstKnownAtDate", () => {
    const bars = fromCloses([100, 100, 100, 100, 105, 110, 115, 120, 125, 130]);
    const signal = {
      barDate: bars[3]!.date, // signal printed on day 3
      firstKnownAtDate: bars[3]!.date,
      direction: "buy" as const,
    };
    const r = computeSignalBacktest(bars, signal);
    expect(r.entryBarIndex).toBe(4);
    expect(r.entryBarDate).toBe(bars[4]!.date);
  });

  it("Combo-style signal entry honors firstKnownAtDate, not barDate", () => {
    const bars = fromCloses([100, 100, 100, 100, 100, 100, 100, 100, 100, 105, 110]);
    const signal = {
      barDate: bars[2]!.date, // visually printed on bar 2 (Combo retroactive)
      firstKnownAtDate: bars[8]!.date, // but only knowable at Setup-9 (bar 8)
      direction: "buy" as const,
    };
    const r = computeSignalBacktest(bars, signal);
    expect(r.entryBarIndex).toBe(9);
  });
});
