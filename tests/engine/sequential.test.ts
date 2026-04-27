import { describe, expect, it } from "vitest";
import { DeMarkEngine, resolveConfig } from "../../src/engine";
import { fromCloses, makeBars } from "./_helpers";

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

describe("Sequential TDST cancellation", () => {
  it("cancels an active Buy Countdown when own TDST resistance breaches, even without an opposing TDST", () => {
    // Build a Buy Setup completion at bar 13, then append a bar whose
    // close clearly exceeds the Buy TDST resistance. Use the close
    // breakout test for an unambiguous one-bar breach (true_range test
    // would also work but requires the prior close to lift first).
    const cfg = resolveConfig({
      tdst: { anchor: "extreme_of_setup", breakoutTest: "close", persistAcrossCountdowns: true },
    });
    const setupCloses = [
      110, 111, 112, 113, 114, 109, 108, 107, 106, 105, 104, 103, 102, 101,
    ];
    const setupBars = setupCloses.map((c, i) => ({
      date: `2024-01-${String(i + 1).padStart(2, "0")}`,
      open: c,
      high: c + 0.5,
      low: c - 0.5,
      close: c,
    }));
    const engine = new DeMarkEngine(cfg);
    const r1 = engine.run(setupBars);
    const setupComplete = r1.events.find(
      (e) => e.eventType === "setup_complete" && e.direction === "buy",
    );
    expect(setupComplete).toBeDefined();

    const breachBar = {
      date: "2024-01-15",
      open: 200,
      high: 210,
      low: 199,
      close: 205,
    };
    const r2 = engine.process(setupBars.concat([breachBar]), setupBars.length);
    const cancel = r2.events.find(
      (e) => e.eventType === "countdown_cancel" && e.direction === "buy",
    );
    const breach = r2.events.find(
      (e) => e.eventType === "tdst_breach" && e.direction === "buy",
    );
    expect(breach).toBeDefined();
    expect(cancel).toBeDefined();
    expect(cancel?.meta?.reason).toBe("tdst_violation");
  });
});

describe("Sequential countdown survives in-progress Setup resets", () => {
  it("countdown still ticks on a post-9 bar that breaks the lookback rule then resumes", () => {
    // Build a Buy Setup that completes at bar 13 (closes index 0..13).
    const setupBars = makeBars("2024-01-01", [
      [110, 110.5, 109.5, 110], // bar 0 — 5-bar pre-flip ramp
      [111, 111.5, 110.5, 111],
      [112, 112.5, 111.5, 112],
      [113, 113.5, 112.5, 113],
      [114, 114.5, 113.5, 114],
      [109, 109.5, 108.5, 109], // bar 5 — bearish flip (count 1)
      [108, 108.5, 107.5, 108], // count 2
      [107, 107.5, 106.5, 107], // count 3
      [106, 106.5, 105.5, 106], // count 4
      [105, 105.5, 104.5, 105], // count 5
      [104, 104.5, 103.5, 104], // count 6
      [103, 103.5, 102.5, 103], // count 7
      [102, 102.5, 101.5, 102], // count 8
      [101, 101.5, 100.5, 101], // count 9 — Setup completes here
    ]);

    // Now append bars that:
    //  - bar 14: lookback fails (close 110 NOT < bar 10's close 104)
    //  - bar 15: a Buy Countdown qualifies (close ≤ low 2 ago)
    //
    // Bar 13's low is 100.5; its close is 101. We want bar 15's close to
    // be ≤ bar 13's low (100.5). bar 14 has close 110, low 109.5. bar 15
    // close 100, low 99.5 — close 100 ≤ bar 13's low 100.5 → Countdown 1.
    const postBars = makeBars("2024-01-15", [
      [110, 110.5, 109.5, 110], // bar 14 — lookback fails (resets in-progress Setup)
      [100, 100.5, 99.5, 100], //  bar 15 — close 100 ≤ bar 13 low 100.5 → buy countdown count 1
    ]);
    const all = setupBars.concat(postBars);
    const engine = new DeMarkEngine();
    const { events } = engine.run(all);

    // Sanity: Setup completed
    expect(
      events.find((e) => e.eventType === "setup_complete" && e.direction === "buy"),
    ).toBeDefined();

    // The Sequential countdown must NOT be permanently frozen by the
    // bar 14 in-progress Setup reset. (Combo's retroactive counts are
    // separate — filter to indicator=sequential.)
    const buySeqCountdownCounts = events.filter(
      (e) =>
        e.eventType === "countdown_count" &&
        e.direction === "buy" &&
        e.indicator === "sequential",
    );
    expect(buySeqCountdownCounts.length).toBeGreaterThanOrEqual(1);
    expect(buySeqCountdownCounts[0]?.barDate).toBe(all[15]!.date);
  });
});

describe("Sequential countdown caps at 13", () => {
  it("does not emit count 14+ on bars after countdown_complete", () => {
    // 14 bars to set up + complete a Buy Setup, then a long stretch of
    // bars with close ≤ low 2 ago to drive the Countdown to 13 and beyond.
    // We use simple monotone closes 100..40 so every post-setup bar
    // qualifies for the Buy Countdown rule.
    const closes: number[] = [];
    // Pre-flip ramp: 5 bars rising
    for (let i = 0; i < 5; i++) closes.push(110 + i);
    // 9 bars decreasing for the Setup
    for (let i = 0; i < 9; i++) closes.push(109 - i);
    // 30 bars further decreasing — every bar should qualify for the
    // countdown until 13 prints, then NOTHING further should print.
    for (let i = 0; i < 30; i++) closes.push(100 - i);
    const bars = fromCloses(closes);
    const engine = new DeMarkEngine();
    const { events } = engine.run(bars);
    const buySeqCounts = events.filter(
      (e) =>
        e.eventType === "countdown_count" &&
        e.direction === "buy" &&
        e.indicator === "sequential",
    );
    // The maximum count emitted must be exactly 13, never higher.
    const maxCount = Math.max(...buySeqCounts.map((e) => e.count!));
    expect(maxCount).toBe(13);
    // Exactly one count_13 event.
    const count13 = buySeqCounts.filter((e) => e.count === 13);
    expect(count13).toHaveLength(1);
  });
});

describe("Sequential setup_recycle uses current bar date", () => {
  it("recycle event's barDate is the bar processed, not the last bar of history", () => {
    // Build a 22-bar Buy Setup extension to trigger the count-22
    // recycle, plus extra trailing bars so the recycle bar is NOT the
    // last bar of the array. 5-bar pre-ramp + 22 strict-decreasing
    // closes + 5 trailing flat bars.
    const closes: number[] = [];
    for (let i = 0; i < 5; i++) closes.push(110 + i);
    for (let i = 0; i < 22; i++) closes.push(109 - i);
    for (let i = 0; i < 5; i++) closes.push(50);
    const bars = fromCloses(closes);
    const engine = new DeMarkEngine();
    let recycleEvent: { barDate: string } | undefined;
    let recycleProcessedAt: string | undefined;
    for (let i = 0; i < bars.length; i++) {
      const r = engine.process(bars, i);
      const ev = r.events.find((e) => e.eventType === "setup_recycle");
      if (ev) {
        recycleEvent = { barDate: ev.barDate };
        recycleProcessedAt = bars[i]!.date;
        break;
      }
    }
    expect(recycleEvent).toBeDefined();
    expect(recycleEvent!.barDate).toBe(recycleProcessedAt);
    expect(recycleEvent!.barDate).not.toBe(bars[bars.length - 1]!.date);
  });
});

describe("Sequential late-perfection on broken-lookback bars", () => {
  it("emits setup_perfected late when a swing bar within lookaheadBars confirms after the count breaks", () => {
    // A Buy Setup that completes WITHOUT immediate perfection: bars 8 and
    // 9's lows do NOT undercut min(bar 6 low, bar 7 low). Then a bar
    // within the lookahead window has a low that DOES undercut — a real
    // late-perfection trigger.
    //
    // Build:
    //   bars 0-4: pre-flip ramp (closes 110..114, lows match)
    //   bars 5-13 (Setup count 1..9): closes 109..101, lows
    //     idx 5: low 108  (count 1)
    //     idx 6: low 107  (2)
    //     idx 7: low 106  (3)
    //     idx 8: low 105  (4)
    //     idx 9: low 104  (5)
    //     idx 10: low 90  (6 — bar 6: low 90)
    //     idx 11: low 91  (7 — bar 7: low 91)
    //     idx 12: low 95  (8 — bar 8: low 95, NOT below min(90,91))
    //     idx 13: low 96  (9 — bar 9: low 96, NOT below min(90,91))
    //   bar 14: lookback fails (close 105 NOT < bar 10 close 104) → break
    //           but bar 14's low = 85 → DOES undercut min(90, 91) → late perfection
    const bars = makeBars("2024-01-01", [
      [110, 110, 109, 110],
      [111, 111, 110, 111],
      [112, 112, 111, 112],
      [113, 113, 112, 113],
      [114, 114, 113, 114],
      [109, 109, 108, 109], // count 1
      [108, 108, 107, 108], // 2
      [107, 107, 106, 107], // 3
      [106, 106, 105, 106], // 4
      [105, 105, 104, 105], // 5
      [104, 104, 90, 104], //  6 — low 90
      [103, 103, 91, 103], //  7 — low 91
      [102, 102, 95, 102], //  8 — low 95
      [101, 101, 96, 101], //  9 — low 96 → NOT initially perfected
      [105, 105, 85, 105], //  bar 14 — count breaks but low 85 perfects late
    ]);
    const engine = new DeMarkEngine();
    const { events } = engine.run(bars);

    const perfections = events.filter(
      (e) => e.eventType === "setup_perfected" && e.direction === "buy",
    );
    expect(perfections).toHaveLength(1);
    // Late perfection metadata
    expect(perfections[0]?.meta?.late).toBe(true);
    // The event's firstKnownAtDate is the bar that confirmed it, not bar 9.
    expect(perfections[0]?.firstKnownAtDate).toBe(bars[14]!.date);
    expect(perfections[0]?.barDate).toBe(bars[13]!.date);
  });
});

describe("Sequential annotation persists setupCompleted across extension", () => {
  it("setupCompleted stays true on extension bars (count 10, 11, ...)", () => {
    // Run a Setup that extends past 9.
    const closes: number[] = [];
    for (let i = 0; i < 5; i++) closes.push(110 + i);
    for (let i = 0; i < 12; i++) closes.push(109 - i); // 12 strictly-decreasing closes
    const bars = fromCloses(closes);
    const engine = new DeMarkEngine();
    const { annotations } = engine.run(bars);

    // Find the Setup-9 bar: count goes 1..9 on bars 5..13.
    const buySeqAnnotations = annotations.filter(
      (a) => a.indicator === "sequential" && a.setupDirection === "buy",
    );
    // The annotation at the bar of count 9 should report setupCompleted.
    const a9 = buySeqAnnotations.find((a) => a.setupCount === 9);
    expect(a9?.setupCompleted).toBe(true);
    // And annotations at counts 10, 11, 12 should ALSO report setupCompleted
    // (the Setup is still completed; we're just extending past 9).
    for (const c of [10, 11, 12]) {
      const a = buySeqAnnotations.find((x) => x.setupCount === c);
      expect(a, `expected annotation with setupCount=${c}`).toBeDefined();
      expect(a?.setupCompleted, `setupCompleted should remain true at extension count ${c}`).toBe(
        true,
      );
    }
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
