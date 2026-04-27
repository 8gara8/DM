import { describe, expect, it } from "vitest";
import { isPerfected } from "../../src/engine/perfection";
import { makeBars } from "./_helpers";

describe("Buy Setup perfection", () => {
  const setupBarIndices = [0, 1, 2, 3, 4, 5, 6, 7, 8];

  it("perfected when bar 8 low breaks bars 6 & 7", () => {
    // lows: idx 5 (bar 6) = 10, idx 6 (bar 7) = 11, idx 7 (bar 8) = 9
    const bars = makeBars("2024-01-01", [
      [20, 21, 19, 20], // bar 1
      [19, 20, 18, 19],
      [18, 19, 17, 18],
      [17, 18, 16, 17],
      [16, 17, 15, 16],
      [15, 16, 10, 15], // bar 6 — low 10
      [14, 15, 11, 14], // bar 7 — low 11
      [13, 14, 9, 13], //  bar 8 — low 9 → perfected
      [12, 13, 12, 12], // bar 9
    ]);
    expect(isPerfected(bars, setupBarIndices, "buy")).toBe(true);
  });

  it("not perfected when neither bar 8 nor bar 9 breaks bars 6 & 7", () => {
    const bars = makeBars("2024-01-01", [
      [20, 21, 19, 20],
      [19, 20, 18, 19],
      [18, 19, 17, 18],
      [17, 18, 16, 17],
      [16, 17, 15, 16],
      [15, 16, 10, 15],
      [14, 15, 11, 14],
      [13, 14, 12, 13], // bar 8 — low 12 (not below min(10, 11) = 10)
      [12, 13, 12, 12], // bar 9 — low 12 (also not below 10)
    ]);
    expect(isPerfected(bars, setupBarIndices, "buy")).toBe(false);
  });

  it("strict mode requires <, inclusive allows ≤", () => {
    // Bar 8 low equals min(bar6, bar7) low.
    const bars = makeBars("2024-01-01", [
      [20, 21, 19, 20],
      [19, 20, 18, 19],
      [18, 19, 17, 18],
      [17, 18, 16, 17],
      [16, 17, 15, 16],
      [15, 16, 10, 15],
      [14, 15, 11, 14],
      [13, 14, 10, 13], // bar 8 low equals 10
      [12, 13, 12, 12],
    ]);
    expect(isPerfected(bars, setupBarIndices, "buy", "strict")).toBe(false);
    expect(isPerfected(bars, setupBarIndices, "buy", "inclusive")).toBe(true);
  });
});
