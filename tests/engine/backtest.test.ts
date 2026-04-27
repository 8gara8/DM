import { describe, expect, it } from "vitest";
import { computeSignalBacktest } from "../../src/engine/backtest";
import { fromCloses, makeBars } from "./_helpers";

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

describe("computeSignalBacktest entry pricing", () => {
  it("returns are measured from entry bar's OPEN, not its close", () => {
    // Bar 0: signal day, close = 100.
    // Bar 1 (entry): open 105, close 110 — opening gap of +5.
    // Bar 2: close = 110.
    // Bar 6 (entry+5): close = 130.
    // Buy returnAt5 should equal (130 - 105) / 105 ≈ 0.2381,
    // NOT (130 - 110) / 110 ≈ 0.1818 which would result from
    // basing returns on the entry bar's CLOSE.
    const bars = makeBars("2024-01-01", [
      [100, 100, 100, 100], // 0 — signal day
      [105, 112, 105, 110], // 1 — entry (open 105 — gap up)
      [110, 115, 109, 110], // 2
      [110, 120, 110, 115], // 3
      [115, 125, 115, 120], // 4
      [120, 130, 120, 125], // 5
      [125, 135, 125, 130], // 6 — entry + 5
    ]);
    const r = computeSignalBacktest(bars, {
      barDate: bars[0]!.date,
      firstKnownAtDate: bars[0]!.date,
      direction: "buy",
    });
    expect(r.entryBarIndex).toBe(1);
    expect(r.returnAt5).toBeCloseTo((130 - 105) / 105, 6);
    // MFE includes the entry bar's own high (112) which is above open 105 → 0.0667
    expect(r.maxFavorableExcursion).toBeGreaterThanOrEqual((135 - 105) / 105 - 1e-9);
  });

  it("Sell return is measured against entry open as the cost basis", () => {
    const bars = makeBars("2024-01-01", [
      [100, 100, 100, 100], // 0
      [95, 95, 90, 92], //    1 — entry, open 95 (gap down)
      [92, 92, 88, 90], //    2
      [90, 90, 85, 88], //    3
      [88, 88, 80, 82], //    4
      [82, 82, 78, 80], //    5
      [80, 80, 75, 78], //    6 — entry + 5
    ]);
    const r = computeSignalBacktest(bars, {
      barDate: bars[0]!.date,
      firstKnownAtDate: bars[0]!.date,
      direction: "sell",
    });
    expect(r.entryBarIndex).toBe(1);
    // Sell return = (entryOpen - exitClose)/entryOpen = (95 - 78)/95
    expect(r.returnAt5).toBeCloseTo((95 - 78) / 95, 6);
  });
});
