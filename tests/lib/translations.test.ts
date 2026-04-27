import { describe, expect, it } from "vitest";
import {
  translate,
  tplPerfected9WithImminent13OtherTf,
  tplPerfected9NoConfluence,
  tplQualified13,
  tplJust9_13_9,
  tplImminent13,
  tplDeferred13,
  tplImminent9,
  tplMultiTfConfluence,
  tplCancelledRecently,
  tplRecycled,
  tplRiskBreach,
  tplLapsed13,
  type TranslationInput,
} from "@/lib/translations";

const base = (overrides: Partial<TranslationInput["primary"]> = {}): TranslationInput => ({
  primary: {
    direction: "buy",
    indicator: "sequential",
    phase: "setup",
    count: 9,
    max: 9,
    timeframe: "weekly",
    isPerfected: true,
    isQualified: false,
    isDeferred: false,
    isJust9_13_9: false,
    ...overrides,
  },
  confluence: [],
});

describe("translation templates", () => {
  it("perfected-9-with-imminent-13-other-tf renders the canonical sentence", () => {
    const i = base();
    i.confluence = [
      {
        direction: "buy",
        indicator: "sequential",
        phase: "countdown",
        count: 11,
        max: 13,
        timeframe: "daily",
      },
    ];
    const r = tplPerfected9WithImminent13OtherTf(i);
    expect(r).not.toBeNull();
    expect(r!.templateId).toBe("perfected-9-with-imminent-13-other-tf");
    expect(r!.text).toBe(
      "Buy Setup 9 perfected on the weekly with a Buy Countdown 11/13 building on the daily — reversal pressure stacked across both timeframes.",
    );
  });

  it("perfected-9-no-confluence renders single-tf reversal sentence", () => {
    const r = tplPerfected9NoConfluence(base());
    expect(r).not.toBeNull();
    expect(r!.templateId).toBe("perfected-9-no-confluence");
    expect(r!.text).toBe("Buy Setup 9 perfected on the weekly — single-timeframe reversal signal.");
  });

  it("qualified-13 fires when phase=countdown & count=13 & qualified", () => {
    const i = base({ phase: "countdown", count: 13, max: 13, isQualified: true, isPerfected: false });
    const r = tplQualified13(i);
    expect(r).not.toBeNull();
    expect(r!.text).toContain("Buy Countdown 13 just qualified on the weekly");
  });

  it("imminent-13 fires for countdown 11/13 and 12/13", () => {
    for (const c of [11, 12]) {
      const i = base({ phase: "countdown", count: c, max: 13, isPerfected: false });
      const r = tplImminent13(i);
      expect(r).not.toBeNull();
      expect(r!.text).toContain(`Countdown ${c}/13`);
    }
  });

  it("deferred-13 wins over imminent-13 when both could match", () => {
    const i = base({ phase: "countdown", count: 12, max: 13, isDeferred: true, isPerfected: false });
    expect(tplDeferred13(i)).not.toBeNull();
    expect(tplDeferred13(i)!.text).toContain("awaiting a bar that satisfies both rules");
  });

  it("imminent-9 fires for setup 7/9 and 8/9", () => {
    for (const c of [7, 8]) {
      const i = base({ count: c, isPerfected: false });
      const r = tplImminent9(i);
      expect(r).not.toBeNull();
      expect(r!.text).toContain(`Setup at ${c}/9`);
    }
  });

  it("9-13-9 composite has highest priority", () => {
    const i = base({ isJust9_13_9: true });
    const r = tplJust9_13_9(i);
    expect(r).not.toBeNull();
    expect(r!.text).toContain("9-13-9 composite on the weekly — premium reversal pattern.");
  });

  it("multi-tf-confluence triggers when other timeframes share direction", () => {
    const i = base({ phase: "setup", count: 5, isPerfected: false });
    i.confluence = [
      {
        direction: "buy",
        indicator: "sequential",
        phase: "setup",
        count: 4,
        max: 9,
        timeframe: "daily",
      },
    ];
    const r = tplMultiTfConfluence(i);
    expect(r).not.toBeNull();
    expect(r!.text).toContain("stacked across weekly and daily");
  });

  it("cancelled-recently includes reason", () => {
    const i: TranslationInput = {
      ...base({ phase: "countdown", count: 9, max: 13, isPerfected: false }),
      cancelReason: "TDST violation",
    };
    const r = tplCancelledRecently(i);
    expect(r).not.toBeNull();
    expect(r!.text).toContain("TDST violation");
  });

  it("recycled fires when isRecycled", () => {
    const i: TranslationInput = { ...base(), isRecycled: true };
    const r = tplRecycled(i);
    expect(r).not.toBeNull();
    expect(r!.text).toContain("Setup recycled on the weekly");
  });

  it("risk-breach fires when isRiskBreach", () => {
    const i: TranslationInput = { ...base(), isRiskBreach: true };
    const r = tplRiskBreach(i);
    expect(r).not.toBeNull();
    expect(r!.text).toContain("invalidated by Risk Level breach");
  });

  it("lapsed-13 fires when 13 is >=12 bars old", () => {
    const i: TranslationInput = {
      ...base({ phase: "countdown", count: 13, max: 13, isPerfected: false }),
      barsSince13: 14,
    };
    const r = tplLapsed13(i);
    expect(r).not.toBeNull();
    expect(r!.text).toContain("14 bars ago");
  });

  it("translate() prefers higher-priority templates", () => {
    // 9-13-9 should beat perfected-9
    const r = translate(base({ isJust9_13_9: true }));
    expect(r.templateId).toBe("9-13-9-composite");
  });

  it("translate() falls back to generic factual when nothing matches", () => {
    const r = translate({
      primary: {
        direction: "buy",
        indicator: "sequential",
        phase: "setup",
        count: 3,
        max: 9,
        timeframe: "monthly",
        isPerfected: false,
        isQualified: false,
        isDeferred: false,
        isJust9_13_9: false,
      },
      confluence: [],
    });
    expect(r.templateId).toBe("generic-factual");
    expect(r.text).toBe("Buy Setup 3/9 on monthly.");
  });

  it("all templates produce sentences ≤ 25 words and ending in '.'", () => {
    const ins: TranslationInput[] = [
      base(),
      base({ phase: "countdown", count: 13, max: 13, isQualified: true, isPerfected: false }),
      base({ phase: "countdown", count: 11, max: 13, isPerfected: false }),
      { ...base({ isJust9_13_9: true }) },
    ];
    for (const i of ins) {
      const r = translate(i);
      expect(r.text.endsWith(".")).toBe(true);
      expect(r.text.split(/\s+/).length).toBeLessThanOrEqual(25);
      expect(r.text).not.toContain("!");
      expect(r.text.toLowerCase()).not.toMatch(/\b(you|we|i)\b/);
    }
  });

  it("HitRatePill contract — 'stacked' is reserved for confluence templates", () => {
    // Generic factual must not contain "stacked"
    const r = translate({
      primary: {
        direction: "sell",
        indicator: "combo",
        phase: "setup",
        count: 4,
        max: 9,
        timeframe: "daily",
        isPerfected: false,
        isQualified: false,
        isDeferred: false,
        isJust9_13_9: false,
      },
      confluence: [],
    });
    expect(r.text.toLowerCase()).not.toContain("stacked");
  });
});
