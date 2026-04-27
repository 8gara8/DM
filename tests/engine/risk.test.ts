import { describe, expect, it } from "vitest";
import { calcRiskLevel, riskBreached } from "../../src/engine/risk";
import { makeBars } from "./_helpers";

describe("calcRiskLevel", () => {
  it("Buy 13 risk = trueLow(L) - trueRange(L) where L is lowest true low in window", () => {
    // Window: 5 bars; bar idx 2 has the lowest true low = 5, with range from 5 to 10 → 5.
    const bars = makeBars("2024-01-01", [
      [10, 12, 9, 11],
      [11, 13, 10, 12],
      [12, 12, 5, 10], // ← lowest true low here = 5; trueHigh = 12
      [10, 11, 9, 10],
      [10, 11, 9, 10],
    ]);
    // trueLow(2) = 5; trueRange(2) = 12 - 5 = 7; risk = 5 - 7 = -2
    const risk = calcRiskLevel(bars, "buy", 0, 4);
    expect(risk).toBe(-2);
  });

  it("Sell 13 risk = trueHigh(H) + trueRange(H)", () => {
    const bars = makeBars("2024-01-01", [
      [10, 12, 9, 11],
      [11, 20, 10, 12], // highest true high = 20; trueLow = min(10, prev close 11) = 10; range = 10
      [12, 13, 5, 10],
      [10, 11, 9, 10],
    ]);
    const risk = calcRiskLevel(bars, "sell", 0, 3);
    expect(risk).toBe(30); // 20 + 10
  });

  it("riskBreached fires when bar's trueLow drops below the level", () => {
    const bars = makeBars("2024-01-01", [
      [10, 12, 9, 11],
      [10, 11, 5, 10],
    ]);
    expect(riskBreached(bars, 1, "buy", 6)).toBe(true);
    expect(riskBreached(bars, 1, "buy", 4)).toBe(false);
  });
});
