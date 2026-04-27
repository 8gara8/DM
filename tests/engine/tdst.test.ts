import { describe, expect, it } from "vitest";
import { calcTdstLevel, trueHigh, trueLow, tdstBreached } from "../../src/engine/tdst";
import { makeBars } from "./_helpers";

describe("trueHigh / trueLow", () => {
  it("uses prior close when more extreme than current high/low (gaps)", () => {
    const bars = makeBars("2024-01-01", [
      [10, 12, 9, 11], // close 11
      [8, 10, 7, 9], //   gap-down: prior close 11 > today's high 10
    ]);
    expect(trueHigh(bars, 1)).toBe(11);
    expect(trueLow(bars, 1)).toBe(7);
  });
});

describe("TDST anchoring", () => {
  // A 9-bar Setup window where bar 1 has high=20, but bars 4-5 push higher.
  const bars9 = makeBars("2024-01-01", [
    [19, 20, 18, 19], // bar 1 (idx 0)
    [19, 21, 18, 20],
    [20, 22, 19, 21],
    [21, 23, 20, 22],
    [22, 25, 21, 24], // highest true high
    [24, 24, 22, 23],
    [23, 24, 22, 23],
    [23, 23, 22, 23],
    [23, 24, 22, 23], // bar 9 (idx 8)
  ]);

  it("extreme_of_setup picks highest true high across the 9 Setup bars", () => {
    const level = calcTdstLevel(bars9, "buy", 0, 8, "extreme_of_setup");
    expect(level).toBe(25);
  });

  it("bar_1 picks the count-1 bar's true high", () => {
    const level = calcTdstLevel(bars9, "buy", 0, 8, "bar_1");
    expect(level).toBe(20);
  });

  it("bar_before_1 picks the bar BEFORE count 1 (legacy variant)", () => {
    const padded = [{ date: "2023-12-31", open: 18, high: 20, low: 17, close: 19 }, ...bars9];
    const level = calcTdstLevel(padded, "buy", 1, 9, "bar_before_1");
    expect(level).toBe(20);
  });
});

describe("TDST breakout test", () => {
  const bars = makeBars("2024-01-01", [
    [10, 12, 9, 11],
    [12, 16, 12, 14], // close 14, true_low = min(12, prior close 11) = 11 — does NOT breach 10
    [13, 15, 13, 14], // close 14, true_low = min(13, 14) = 13 — DOES breach 10
  ]);

  it("close test fires when close exceeds resistance", () => {
    expect(tdstBreached(bars, 1, "buy", 10, "close")).toBe(true);
  });

  it("true_range test requires entire bar to lift above resistance", () => {
    // bar 1: trueLow = 11 > 10 → breach
    expect(tdstBreached(bars, 1, "buy", 10, "true_range")).toBe(true);
    // bar 2: trueLow = 13 > 10 → breach
    expect(tdstBreached(bars, 2, "buy", 10, "true_range")).toBe(true);
    // bar 0: trueLow = 9 < 10 → NO breach
    expect(tdstBreached(bars, 0, "buy", 10, "true_range")).toBe(false);
  });
});
