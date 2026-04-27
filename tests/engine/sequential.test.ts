import { describe, expect, it } from "vitest";
import { DeMarkEngine, resolveConfig } from "../../src/engine";
import { fromCloses } from "./_helpers";

describe("Sequential setup completion", () => {
  it("completes a Buy Setup at count 9 with a confirmed bearish flip", () => {
    // First 5 bars set up the flip (rising), then 9 strictly-decreasing
    // closes versus 4 bars earlier.
    // To make c[i] < c[i-4] hold for 9 consecutive bars, we need a
    // monotonically decreasing tail of length 9 with each value lower than
    // the corresponding bar 4 ago.
    //
    // We build: [110, 111, 112, 113, 114, 109, 108, 107, 106, 105, 104, 103, 102, 101]
    //  - bar 5 close=109 < bar 1 close=111 ✓ AND bar 4 close=114 > bar 0 close=110 → bearish flip
    //  - From bar 5 onwards each close is < close 4 ago.
    const closes = [110, 111, 112, 113, 114, 109, 108, 107, 106, 105, 104, 103, 102, 101];
    const bars = fromCloses(closes);
    const engine = new DeMarkEngine();
    const { events, annotations } = engine.run(bars);

    const setupComplete = events.find(
      (e) => e.eventType === "setup_complete" && e.direction === "buy",
    );
    expect(setupComplete).toBeDefined();
    expect(setupComplete?.barDate).toBe(bars[13]!.date);

    // Last bar's buy-sequential annotation should report count 9 completed
    const lastBuy = annotations.filter(
      (a) => a.indicator === "sequential" && a.setupDirection === "buy",
    );
    expect(lastBuy.at(-1)?.setupCount).toBe(9);
    expect(lastBuy.at(-1)?.setupCompleted).toBe(true);
  });

  it("completes a Sell Setup at count 9", () => {
    // Mirror: [100, 99, 98, 97, 96, 101, 102, 103, 104, 105, 106, 107, 108, 109]
    //  bar 5 close=101 > bar 1 close=99   ✓
    //  bar 4 close=96 < bar 0 close=100   ✓ → bullish flip
    const closes = [100, 99, 98, 97, 96, 101, 102, 103, 104, 105, 106, 107, 108, 109];
    const bars = fromCloses(closes);
    const engine = new DeMarkEngine();
    const { events } = engine.run(bars);
    const setupComplete = events.find(
      (e) => e.eventType === "setup_complete" && e.direction === "sell",
    );
    expect(setupComplete).toBeDefined();
    expect(setupComplete?.barDate).toBe(bars[13]!.date);
  });

  it("requires a bearish price flip — no flip → no Setup", () => {
    // Without the rising tail before the decline, no bearish flip prints,
    // so the Buy Setup never starts.
    const closes = [100, 99, 98, 97, 96, 95, 94, 93, 92, 91, 90, 89, 88, 87];
    const bars = fromCloses(closes);
    const engine = new DeMarkEngine();
    const { events } = engine.run(bars);
    expect(events.find((e) => e.eventType === "setup_complete")).toBeUndefined();
  });

  it("can disable price-flip gating via config", () => {
    const closes = [100, 99, 98, 97, 96, 95, 94, 93, 92, 91, 90, 89, 88, 87];
    const bars = fromCloses(closes);
    const cfg = resolveConfig({
      setup: {
        length: 9,
        lookback: 4,
        strict: true,
        requirePriceFlip: false,
        allowExtensionBeyond9: true,
        perfection: { enabled: true, mode: "strict", lookaheadBars: 4 },
      },
    });
    const engine = new DeMarkEngine(cfg);
    const { events } = engine.run(bars);
    const sc = events.find(
      (e) => e.eventType === "setup_complete" && e.direction === "buy",
    );
    expect(sc).toBeDefined();
  });

  it("emits setup_count for every bar in the run", () => {
    const closes = [110, 111, 112, 113, 114, 109, 108, 107, 106, 105, 104, 103, 102, 101];
    const bars = fromCloses(closes);
    const engine = new DeMarkEngine();
    const { events } = engine.run(bars);
    const buyCounts = events.filter(
      (e) => e.eventType === "setup_count" && e.direction === "buy",
    );
    expect(buyCounts.map((e) => e.count)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});

describe("Sequential invariants", () => {
  it("setup count cannot jump by more than 1 per bar", () => {
    const closes = [110, 111, 112, 113, 114, 109, 108, 107, 106, 105, 104, 103, 102, 101];
    const engine = new DeMarkEngine();
    const { events } = engine.run(fromCloses(closes));
    const buyCounts = events
      .filter((e) => e.eventType === "setup_count" && e.direction === "buy")
      .map((e) => e.count!);
    for (let i = 1; i < buyCounts.length; i++) {
      expect(buyCounts[i]! - buyCounts[i - 1]!).toBeLessThanOrEqual(1);
    }
  });

  it("buy and sell setup counts never both increment on the same bar", () => {
    // With strict inequality, only one side can fire on any given bar.
    const closes = [110, 111, 112, 113, 114, 109, 108, 107, 106, 105];
    const engine = new DeMarkEngine();
    const { events } = engine.run(fromCloses(closes));
    const byBar = new Map<string, Set<string>>();
    for (const e of events) {
      if (e.eventType !== "setup_count") continue;
      const set = byBar.get(e.barDate) ?? new Set<string>();
      set.add(e.direction!);
      byBar.set(e.barDate, set);
    }
    for (const set of byBar.values()) {
      expect(set.size).toBeLessThanOrEqual(1);
    }
  });
});
