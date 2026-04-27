import { describe, expect, it } from "vitest";
import {
  rankSignals,
  isImminent,
  hitRateKey,
  HERO_THRESHOLD_DEFAULT,
} from "@/server/ranking";
import type { SignalStateLite } from "@/server/ranking";
import type { HitRateStat } from "@/lib/dashboard-types";

const state = (over: Partial<SignalStateLite> = {}): SignalStateLite => ({
  ticker: "AAPL",
  timeframe: "weekly",
  indicator: "sequential",
  direction: "buy",
  phase: "setup",
  count: 9,
  isPerfected: true,
  isDeferred: false,
  asOfBarDate: "2026-04-25",
  ...over,
});

describe("ranking", () => {
  it("imminence + tfWeight produce the expected score for a clean weekly 9", () => {
    const r = rankSignals({ states: [state()], hitRates: new Map() });
    expect(r).toHaveLength(1);
    // 100 * 1.0 (no confluence) * 1.0 (default hr) * 1.4 (weekly) * 1.0 (no decay) = 140
    expect(r[0]!.score).toBeCloseTo(140, 5);
  });

  it("confluence bumps the score by 0.4 per other timeframe with same direction", () => {
    const r = rankSignals({
      states: [
        state(),
        state({ timeframe: "daily", count: 7, isPerfected: false }),
      ],
      hitRates: new Map(),
    });
    // Top should be the weekly 9 with +0.4 confluence bonus
    const top = r[0]!;
    expect(top.timeframe).toBe("weekly");
    expect(top.confluence).toBeCloseTo(1.4, 5);
    expect(top.score).toBeCloseTo(100 * 1.4 * 1.0 * 1.4, 5);
  });

  it("credibility scales 0.85..1.15 around hit rate 0.5", () => {
    const hr: HitRateStat = {
      n: 10,
      hits: 8,
      horizon: "+13w",
      indicator: "sequential",
      signalType: "setup_complete",
      avgReturnPct: 0.05,
      smallSample: false,
    };
    const map = new Map();
    map.set(hitRateKey("AAPL", "weekly", "sequential", "setup_complete"), hr);
    const r = rankSignals({ states: [state()], hitRates: map });
    expect(r[0]!.credibility).toBeCloseTo(1 + 0.3 * (0.8 - 0.5), 5);
  });

  it("isImminent: setup count >= 7 or countdown count >= 11", () => {
    expect(isImminent(state({ phase: "setup", count: 6 }))).toBe(false);
    expect(isImminent(state({ phase: "setup", count: 7 }))).toBe(true);
    expect(isImminent(state({ phase: "countdown", count: 10 }))).toBe(false);
    expect(isImminent(state({ phase: "countdown", count: 11 }))).toBe(true);
  });

  it("HERO_THRESHOLD default is 25", () => {
    expect(HERO_THRESHOLD_DEFAULT).toBe(25);
  });

  it("recencyDecay: 10% per day until floor at 0", () => {
    const r = rankSignals({
      states: [state()],
      hitRates: new Map(),
      daysAsHeroFor: () => 3,
    });
    expect(r[0]!.recencyDecay).toBeCloseTo(0.7, 5);
    expect(r[0]!.score).toBeCloseTo(100 * 1.0 * 1.0 * 1.4 * 0.7, 5);
  });
});
