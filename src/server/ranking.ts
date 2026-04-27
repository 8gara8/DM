/**
 * Hero ranking — see SPEC.md Appendix D.1.
 *
 * Pure function: takes signal states + recent events + hit-rate stats and
 * returns a ranked list. The dashboard composer picks the top score (and
 * checks against `HERO_THRESHOLD`) to decide whether to render a hero or
 * the soft "nothing-notable" variant.
 *
 * No DB or framework imports — kept pure for unit testing.
 */

import type { Direction, Indicator, Timeframe } from "@/engine/types";
import type { HitRateStat } from "@/lib/dashboard-types";

export type SignalStateLite = {
  ticker: string;
  timeframe: Timeframe;
  indicator: Indicator;
  direction: Direction | null;
  phase: "none" | "setup" | "countdown";
  count: number;
  isPerfected: boolean;
  isDeferred: boolean;
  asOfBarDate: string;
};

export type SignalEventLite = {
  ticker: string;
  timeframe: Timeframe;
  indicator: Indicator;
  direction: Direction | null;
  eventType: string;
  barDate: string;
  count: number | null;
};

export type HitRateKey = string; // `${ticker}|${timeframe}|${indicator}|${signalType}`

export const hitRateKey = (
  ticker: string,
  timeframe: Timeframe,
  indicator: Indicator,
  signalType: string,
): HitRateKey => `${ticker}|${timeframe}|${indicator}|${signalType}`;

export type RankedSignal = {
  ticker: string;
  timeframe: Timeframe;
  indicator: Indicator;
  direction: Direction;
  count: number;
  max: 9 | 13;
  phase: "setup" | "countdown";
  asOfBarDate: string;
  // Score breakdown
  score: number;
  imminence: number;
  confluence: number;
  credibility: number;
  tfWeight: number;
  recencyDecay: number;
  sameDirOtherTfCount: number;
  hitRate: HitRateStat | null;
};

const TF_WEIGHT: Record<Timeframe, number> = {
  daily: 1.0,
  weekly: 1.4,
  monthly: 1.6,
  yearly: 1.8,
};

const phaseMax = (phase: "setup" | "countdown"): 9 | 13 =>
  phase === "setup" ? 9 : 13;

export interface RankSignalsArgs {
  states: SignalStateLite[];
  events?: SignalEventLite[];
  hitRates: Map<HitRateKey, HitRateStat>;
  /** Per (ticker, timeframe, indicator) — how many days this combo has been hero. Default 0. */
  daysAsHeroFor?: (ticker: string, timeframe: Timeframe, indicator: Indicator) => number;
}

export function rankSignals({
  states,
  hitRates,
  daysAsHeroFor,
}: RankSignalsArgs): RankedSignal[] {
  const active = states.filter(
    (s) => s.phase !== "none" && s.direction !== null && s.count > 0,
  );
  // Index active states by ticker for confluence lookups
  const byTicker = new Map<string, SignalStateLite[]>();
  for (const s of active) {
    const arr = byTicker.get(s.ticker);
    if (arr) arr.push(s);
    else byTicker.set(s.ticker, [s]);
  }

  const ranked: RankedSignal[] = [];

  for (const s of active) {
    const phase = s.phase as "setup" | "countdown";
    const max = phaseMax(phase);
    const direction = s.direction!;
    const others = byTicker.get(s.ticker)!.filter(
      (other) =>
        other !== s &&
        other.direction === direction &&
        other.timeframe !== s.timeframe,
    );
    const sameDirOtherTfCount = others.length;

    const hitRate =
      hitRates.get(
        hitRateKey(
          s.ticker,
          s.timeframe,
          s.indicator,
          phase === "setup" ? "setup_complete" : "countdown_complete",
        ),
      ) ?? null;

    const imminence = (s.count / max) * 100;
    const confluence = 1 + 0.4 * sameDirOtherTfCount;
    const hr = hitRate?.hits != null && hitRate.n > 0 ? hitRate.hits / hitRate.n : null;
    const credibility = 1 + 0.3 * ((hr ?? 0.5) - 0.5);
    const tfWeight = TF_WEIGHT[s.timeframe];
    const days =
      daysAsHeroFor?.(s.ticker, s.timeframe, s.indicator) ?? 0;
    const recencyDecay = Math.max(0, 1.0 - 0.1 * days);
    const score =
      imminence * confluence * credibility * tfWeight * recencyDecay;

    ranked.push({
      ticker: s.ticker,
      timeframe: s.timeframe,
      indicator: s.indicator,
      direction,
      phase,
      count: s.count,
      max,
      asOfBarDate: s.asOfBarDate,
      score,
      imminence,
      confluence,
      credibility,
      tfWeight,
      recencyDecay,
      sameDirOtherTfCount,
      hitRate,
    });
  }

  // Tiebreakers per Appendix D.1: confluence count, then asOfBarDate, then ticker
  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.sameDirOtherTfCount !== a.sameDirOtherTfCount)
      return b.sameDirOtherTfCount - a.sameDirOtherTfCount;
    if (a.asOfBarDate !== b.asOfBarDate)
      return b.asOfBarDate.localeCompare(a.asOfBarDate);
    return a.ticker.localeCompare(b.ticker);
  });

  return ranked;
}

/**
 * Imminent rail = active states at count >= 7 (setup) or count >= 11 (countdown).
 * Returns the original state list, not the ranked decoration.
 */
export function isImminent(s: SignalStateLite): boolean {
  if (s.phase === "setup" && s.count >= 7) return true;
  if (s.phase === "countdown" && s.count >= 11) return true;
  return false;
}

export function explainFactors(r: RankedSignal): { label: string; contribution: number }[] {
  const out: { label: string; contribution: number }[] = [];
  out.push({
    label: `Imminent (count ${r.count} of ${r.max})`,
    contribution: r.imminence * r.tfWeight,
  });
  if (r.sameDirOtherTfCount > 0) {
    out.push({
      label: `Confluence on ${r.sameDirOtherTfCount} other timeframe${r.sameDirOtherTfCount > 1 ? "s" : ""}`,
      contribution: r.imminence * (r.confluence - 1) * r.tfWeight,
    });
  }
  if (r.hitRate && r.hitRate.n >= 5) {
    const hr = r.hitRate.hits / r.hitRate.n;
    out.push({
      label: `Track record ${r.hitRate.hits}/${r.hitRate.n} prior ${r.hitRate.signalType}s`,
      contribution: r.imminence * (1 + 0.3 * (hr - 0.5)) * r.tfWeight - r.imminence * r.tfWeight,
    });
  }
  out.push({
    label: `${r.timeframe} timeframe weight (${r.tfWeight.toFixed(1)}x)`,
    contribution: r.imminence * (r.tfWeight - 1.0),
  });
  if (r.recencyDecay < 1) {
    out.push({
      label: `Recency decay`,
      contribution: -r.imminence * r.tfWeight * (1 - r.recencyDecay),
    });
  }
  // Round for display
  return out.map((f) => ({ label: f.label, contribution: Math.round(f.contribution * 10) / 10 }));
}

export const HERO_THRESHOLD_DEFAULT = 25.0;

export function heroThreshold(): number {
  const env = process.env.HERO_THRESHOLD;
  const v = env ? parseFloat(env) : NaN;
  return Number.isFinite(v) && v > 0 ? v : HERO_THRESHOLD_DEFAULT;
}
