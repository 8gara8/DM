import { describe, expect, it } from "vitest";
import { detectPriceFlip } from "../../src/engine/flip";
import { fromCloses } from "./_helpers";

describe("price flip", () => {
  it("returns null when fewer than 6 bars", () => {
    const bars = fromCloses([10, 10, 10, 10, 10]);
    expect(detectPriceFlip(bars, 4).flip).toBeNull();
  });

  it("detects bearish flip preceding a Buy Setup", () => {
    // c[5] < c[1]  AND  c[4] > c[0]
    // closes: [100, 99, 98, 97, 102, 90]
    //          0    1   2   3   4    5
    // c[5]=90 < c[1]=99 ✓   c[4]=102 > c[0]=100 ✓ → buy flip
    const bars = fromCloses([100, 99, 98, 97, 102, 90]);
    expect(detectPriceFlip(bars, 5).flip).toBe("buy");
  });

  it("detects bullish flip preceding a Sell Setup", () => {
    // c[5] > c[1] and c[4] < c[0]
    const bars = fromCloses([100, 101, 102, 103, 99, 110]);
    expect(detectPriceFlip(bars, 5).flip).toBe("sell");
  });

  it("returns null when neither side qualifies", () => {
    const bars = fromCloses([100, 100, 100, 100, 100, 100]);
    expect(detectPriceFlip(bars, 5).flip).toBeNull();
  });
});
