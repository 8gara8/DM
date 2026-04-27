import { describe, expect, it } from "vitest";
import { DeMarkEngine, resolveConfig } from "../../src/engine";
import { CompositeDetector } from "../../src/engine/composite";
import { fromCloses } from "./_helpers";

describe("serialize/restore", () => {
  it("produces identical results when split mid-stream", () => {
    const closes = [110, 111, 112, 113, 114, 109, 108, 107, 106, 105, 104, 103, 102, 101];
    const bars = fromCloses(closes);
    const cfg = resolveConfig();

    // Run all in one shot
    const a = new DeMarkEngine(cfg);
    const fullA = a.run(bars);

    // Run first 7, snapshot, restore, run remainder
    const b = new DeMarkEngine(cfg);
    const out1 = { events: [...[]] as any[], annotations: [...[]] as any[] };
    for (let i = 0; i <= 6; i++) {
      const r = b.process(bars, i);
      out1.events.push(...r.events);
      out1.annotations.push(...r.annotations);
    }
    const snap = b.serialize();
    const c = DeMarkEngine.restore(snap, cfg);
    for (let i = 7; i < bars.length; i++) {
      const r = c.process(bars, i);
      out1.events.push(...r.events);
      out1.annotations.push(...r.annotations);
    }
    expect(out1.events.length).toBe(fullA.events.length);
    expect(out1.annotations.length).toBe(fullA.annotations.length);
    // spot check: setup_complete dates match
    const aComplete = fullA.events
      .filter((e) => e.eventType === "setup_complete")
      .map((e) => e.barDate);
    const bComplete = out1.events
      .filter((e) => e.eventType === "setup_complete")
      .map((e) => e.barDate);
    expect(bComplete).toEqual(aComplete);
  });

  it("persists and restores composite watchers (pending 9-13-9 state)", () => {
    const cfg = resolveConfig();
    // Set up a CompositeDetector with a pending watcher and round-trip via
    // an engine snapshot to ensure 9-13-9 candidates survive a resume.
    const engine = new DeMarkEngine(cfg);
    // run a tiny series so lastBarIndex >= 0 (otherwise serialize returns
    // an empty snapshot)
    engine.run(fromCloses([1, 2, 3, 4, 5, 6]));

    // Manually introduce a pending watcher via the composite detector
    const compositeField = engine as unknown as {
      composite: CompositeDetector;
    };
    compositeField.composite.onCountdownComplete("buy", "2024-01-10");
    compositeField.composite.onSameDirectionFlip("buy");

    const snap = engine.serialize();
    expect(snap.compositeWatchers).toHaveLength(1);
    expect(snap.compositeWatchers[0]).toMatchObject({
      direction: "buy",
      thirteenBarDate: "2024-01-10",
      hadConfirmingFlip: true,
    });

    const resumed = DeMarkEngine.restore(snap, cfg);
    const resumedComposite = (resumed as unknown as { composite: CompositeDetector })
      .composite;
    const events = resumedComposite.onSetupComplete("buy", "2024-01-30");
    expect(events).toHaveLength(1);
    expect(events[0]?.eventType).toBe("signal_9_13_9");
  });

  it("rejects snapshot with mismatched configHash", () => {
    const cfgA = resolveConfig();
    const cfgB = resolveConfig({
      tdst: { anchor: "bar_1", breakoutTest: "true_range", persistAcrossCountdowns: true },
    });
    const e = new DeMarkEngine(cfgA);
    e.run(fromCloses([110, 111, 112, 113, 114, 109, 108]));
    const snap = e.serialize();
    expect(() => DeMarkEngine.restore(snap, cfgB)).toThrow(/configHash mismatch/);
  });
});
