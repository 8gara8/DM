import { describe, expect, it } from "vitest";
import { CompositeDetector } from "../../src/engine/composite";
import { resolveConfig } from "../../src/engine/config";

describe("CompositeDetector.onOpposingSetupComplete", () => {
  it("invalidates the watcher matching the passed direction (callers pass the OPPOSING side)", () => {
    const cfg = resolveConfig();
    const c = new CompositeDetector(cfg);
    c.onCountdownComplete("buy", "2024-01-10");
    c.onSameDirectionFlip("buy");

    // A Sell setup completes — callers in index.ts pass "buy" because that's
    // the direction whose watchers should be invalidated. With the BUG
    // (`!==`) we'd invalidate the SELL watcher (none exist) and the Buy
    // watcher would survive, so the next Buy setup_complete would
    // incorrectly emit a 9-13-9.
    c.onOpposingSetupComplete("buy");

    const events = c.onSetupComplete("buy", "2024-01-30");
    expect(events).toHaveLength(0);
  });

  it("emits 9-13-9 when no opposing setup intervenes and a same-direction flip occurred", () => {
    const cfg = resolveConfig();
    const c = new CompositeDetector(cfg);
    c.onCountdownComplete("buy", "2024-01-10");
    c.onSameDirectionFlip("buy");
    const events = c.onSetupComplete("buy", "2024-01-30");
    expect(events).toHaveLength(1);
    expect(events[0]?.eventType).toBe("signal_9_13_9");
  });

  it("does not emit when no same-direction flip has occurred since the 13", () => {
    const cfg = resolveConfig();
    const c = new CompositeDetector(cfg);
    c.onCountdownComplete("sell", "2024-01-10");
    // no flip → no confirmation
    const events = c.onSetupComplete("sell", "2024-01-30");
    expect(events).toHaveLength(0);
  });
});
