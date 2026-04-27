import { describe, expect, it } from "vitest";
import { evaluateRecycle } from "../../src/engine/recycle";

describe("evaluateRecycle", () => {
  it("triggers extension when count reaches threshold", () => {
    expect(
      evaluateRecycle({
        setupExtensionCount: 22,
        countThreshold: 22,
        priorRange: 10,
        newRange: 9,
        rangeRatioMin: 1.0,
        rangeRatioMax: 2.0,
      }),
    ).toBe("extension");
  });

  it("triggers range_ratio when new range is in [min,max]× prior", () => {
    expect(
      evaluateRecycle({
        setupExtensionCount: 9,
        countThreshold: 22,
        priorRange: 10,
        newRange: 15,
        rangeRatioMin: 1.0,
        rangeRatioMax: 2.0,
      }),
    ).toBe("range_ratio");
  });

  it("returns null when ratio falls outside the band", () => {
    expect(
      evaluateRecycle({
        setupExtensionCount: 9,
        countThreshold: 22,
        priorRange: 10,
        newRange: 22,
        rangeRatioMin: 1.0,
        rangeRatioMax: 2.0,
      }),
    ).toBeNull();
  });

  it("returns null with no prior range", () => {
    expect(
      evaluateRecycle({
        setupExtensionCount: 9,
        countThreshold: 22,
        priorRange: null,
        newRange: 10,
        rangeRatioMin: 1.0,
        rangeRatioMax: 2.0,
      }),
    ).toBeNull();
  });
});
