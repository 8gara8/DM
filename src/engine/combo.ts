/**
 * TD Combo Countdown.
 *
 * Combo's distinguishing trait: the Countdown can begin counting from
 * Setup bar 1, not bar 9 — making the earliest possible 13 = Setup bar 13.
 * However, Combo counts that print BEFORE Setup completion are only
 * "knowable" once Setup 9 prints, so every Combo signal event must set
 * `firstKnownAtDate = setupCompleteBarDate` (≥ `barDate`). Backtests gate
 * on `firstKnownAtDate` to avoid look-ahead bias.
 *
 * Versions:
 *   - `conservative_public` — strict 4-rule for all 13 counts.
 *   - `standard_public` (v1 default) — strict 4-rule for counts 1–10,
 *     Sequential rule (`c[i] ≤ l[i-2]` / `c[i] ≥ h[i-2]`) for counts
 *     11–12–13.
 *   - `aggressive_public` — looser base condition `l[i] ≤ l[i-2]`
 *     (Buy) / `h[i] ≥ h[i-2]` (Sell).
 *
 * The implementation runs a "candidate count" pass over the entire
 * Setup→present window each time Setup completes, so Combo retroactively
 * activates with `firstKnownAtDate = setupCompleteBarDate`. Once active,
 * subsequent bars feed `stepCountdown` like Sequential.
 */

import type {
  Bar,
  BarAnnotation,
  Direction,
  DirectionalSnapshot,
  SignalEvent,
} from "./types";
import type { ComboVersion, EngineConfig } from "./config";
import { trueHigh, trueLow, tdstBreached } from "./tdst";

export class ComboTracker {
  readonly direction: Direction;
  readonly config: EngineConfig;

  /** Mirror of Sequential's setup state, but Combo also keeps Combo-specific fields. */
  setupBar1Index: number | null = null;
  setupBar9Index: number | null = null;
  setupBar9Date: string | null = null;
  setupCompleted = false;

  countdownActive = false;
  countdownCount = 0;
  countdownBarIndices: number[] = [];
  countdownBar8Close: number | null = null;
  countdownDeferred = false;
  countdownComplete = false;
  countdownQualified = false;
  countdownBar13Index: number | null = null;
  countdownBar13Date: string | null = null;

  tdstLevel: number | null = null;
  tdstAnchorBarDate: string | null = null;
  riskLevel: number | null = null;
  /** firstKnownAt for retroactive counts in Setup bars 1..8. */
  firstKnownAtOverride: string | null = null;

  constructor(direction: Direction, config: EngineConfig) {
    this.direction = direction;
    this.config = config;
  }

  resetCountdown(): void {
    this.countdownActive = false;
    this.countdownCount = 0;
    this.countdownBarIndices = [];
    this.countdownBar8Close = null;
    this.countdownDeferred = false;
    this.countdownComplete = false;
    this.countdownQualified = false;
    this.countdownBar13Index = null;
    this.countdownBar13Date = null;
    this.firstKnownAtOverride = null;
  }

  /**
   * Setup-side handoff: when the Sequential setup completes, snapshot the
   * relevant indices so Combo can run its retroactive pass.
   */
  syncSetupComplete(bar1Idx: number, bar9Idx: number, bar9Date: string): void {
    this.setupBar1Index = bar1Idx;
    this.setupBar9Index = bar9Idx;
    this.setupBar9Date = bar9Date;
    this.setupCompleted = true;
  }

  /**
   * Activate Combo by retroactively walking Setup bar 1..bar 9 and
   * emitting `countdown_count` events for every qualifying bar.
   * `firstKnownAtDate` for these events = the date Setup completed.
   */
  activateRetroactively(bars: Bar[]): SignalEvent[] {
    if (!this.setupCompleted || this.setupBar1Index == null || this.setupBar9Index == null) {
      return [];
    }
    if (this.countdownActive) return [];
    this.countdownActive = true;
    this.firstKnownAtOverride = this.setupBar9Date;

    const events: SignalEvent[] = [];
    for (let i = this.setupBar1Index; i <= this.setupBar9Index; i++) {
      const ev = this.tryCountAtBar(bars, i, /* isRetroactive */ true);
      events.push(...ev);
      if (this.countdownComplete) break;
    }
    return events;
  }

  /** Single-bar count test using the configured Combo variant. */
  private comboCountQualifies(bars: Bar[], i: number, count: number, version: ComboVersion): boolean {
    if (i < this.config.combo.countdownLookback) return false;
    const dir = this.direction;
    const ci = bars[i]!.close;
    const li = bars[i]!.low;
    const hi = bars[i]!.high;
    const lookback = this.config.combo.countdownLookback;
    const lLb = bars[i - lookback]!.low;
    const hLb = bars[i - lookback]!.high;

    const baseSequential =
      dir === "buy" ? ci <= lLb : ci >= hLb;

    if (version === "aggressive_public") {
      return dir === "buy" ? li <= lLb : hi >= hLb;
    }
    if (version === "standard_public" && count >= 11) {
      return baseSequential;
    }
    // conservative + first 10 of standard: full 4-rule
    if (i < 1) return false;
    const cPrev = bars[i - 1]!.close;
    const lPrev = bars[i - 1]!.low;
    const hPrev = bars[i - 1]!.high;
    const prevCountIdx = this.countdownBarIndices.length
      ? this.countdownBarIndices[this.countdownBarIndices.length - 1]!
      : null;
    const cPrevCount = prevCountIdx != null ? bars[prevCountIdx]!.close : Number.NaN;

    if (dir === "buy") {
      return (
        baseSequential &&
        li < lPrev &&
        ci < cPrev &&
        (prevCountIdx == null || ci < cPrevCount)
      );
    }
    return (
      baseSequential &&
      hi > hPrev &&
      ci > cPrev &&
      (prevCountIdx == null || ci > cPrevCount)
    );
  }

  private tryCountAtBar(bars: Bar[], i: number, isRetroactive: boolean): SignalEvent[] {
    const events: SignalEvent[] = [];
    if (!this.countdownActive) return events;
    const cfg = this.config.combo;
    const dir = this.direction;

    if (this.countdownComplete) return events;

    const candidateCount = this.countdownCount + 1;
    const passes = this.comboCountQualifies(bars, i, candidateCount, cfg.version);
    if (!passes) return events;

    const date = bars[i]!.date;
    const firstKnownAt =
      isRetroactive && this.firstKnownAtOverride
        ? this.firstKnownAtOverride
        : date;

    // Optional 13-vs-8 deferral (off by default for Combo)
    if (
      cfg.deferral.lastVs8Enabled &&
      this.countdownCount === cfg.countdownLength - 1 &&
      this.countdownBar8Close != null
    ) {
      const ok =
        dir === "buy"
          ? bars[i]!.low <= this.countdownBar8Close
          : bars[i]!.high >= this.countdownBar8Close;
      if (!ok) {
        this.countdownDeferred = true;
        events.push({
          indicator: "combo",
          eventType: "countdown_deferred",
          direction: dir,
          count: cfg.countdownLength,
          barDate: date,
          firstKnownAtDate: firstKnownAt,
          configHash: this.config.configHash,
          meta: { bar8Close: this.countdownBar8Close },
        });
        return events;
      }
    }

    this.countdownCount += 1;
    this.countdownBarIndices.push(i);
    if (this.countdownCount === 8) {
      this.countdownBar8Close = bars[i]!.close;
    }

    events.push({
      indicator: "combo",
      eventType: "countdown_count",
      direction: dir,
      count: this.countdownCount,
      barDate: date,
      firstKnownAtDate: firstKnownAt,
      configHash: this.config.configHash,
    });

    if (this.countdownCount === cfg.countdownLength) {
      this.countdownComplete = true;
      this.countdownBar13Index = i;
      this.countdownBar13Date = date;
      const qualified =
        this.countdownBar8Close == null
          ? true
          : dir === "buy"
            ? bars[i]!.close <= this.countdownBar8Close
            : bars[i]!.close >= this.countdownBar8Close;
      this.countdownQualified = qualified;
      events.push({
        indicator: "combo",
        eventType: "countdown_complete",
        direction: dir,
        count: cfg.countdownLength,
        barDate: date,
        firstKnownAtDate: firstKnownAt,
        configHash: this.config.configHash,
      });
      if (qualified) {
        events.push({
          indicator: "combo",
          eventType: "countdown_qualified",
          direction: dir,
          count: cfg.countdownLength,
          barDate: date,
          firstKnownAtDate: firstKnownAt,
          configHash: this.config.configHash,
        });
      }
    }

    return events;
  }

  /** Forward-walking step (post-Setup-9 bars). */
  stepCountdown(bars: Bar[], i: number): SignalEvent[] {
    if (!this.countdownActive) return [];
    if (this.setupBar9Index == null || i <= this.setupBar9Index) return [];
    return this.tryCountAtBar(bars, i, /* retroactive */ false);
  }

  evaluateCancellation(
    bars: Bar[],
    i: number,
    opposingSetupCompletedThisBar: boolean,
  ): SignalEvent[] {
    const events: SignalEvent[] = [];
    if (!this.countdownActive) return events;
    const cfg = this.config.combo.cancellation;
    const date = bars[i]!.date;
    if (cfg.opposingSetupEnabled && opposingSetupCompletedThisBar) {
      events.push({
        indicator: "combo",
        eventType: "countdown_cancel",
        direction: this.direction,
        count: this.countdownCount,
        barDate: date,
        firstKnownAtDate: date,
        configHash: this.config.configHash,
        meta: { reason: "opposing_setup" },
      });
      this.resetCountdown();
      return events;
    }
    if (cfg.tdstViolationEnabled && this.tdstLevel != null) {
      const breached = tdstBreached(
        bars,
        i,
        this.direction,
        this.tdstLevel,
        this.config.tdst.breakoutTest,
      );
      if (breached) {
        events.push({
          indicator: "combo",
          eventType: "tdst_breach",
          direction: this.direction,
          count: this.countdownCount,
          barDate: date,
          firstKnownAtDate: date,
          configHash: this.config.configHash,
          meta: { level: this.tdstLevel, test: this.config.tdst.breakoutTest },
        });
        events.push({
          indicator: "combo",
          eventType: "countdown_cancel",
          direction: this.direction,
          count: this.countdownCount,
          barDate: date,
          firstKnownAtDate: date,
          configHash: this.config.configHash,
          meta: { reason: "tdst_violation" },
        });
        this.resetCountdown();
      }
    }
    return events;
  }

  toSnapshot(): DirectionalSnapshot {
    return {
      direction: this.direction,
      indicator: "combo",
      setupCount: 0,
      setupBar1Index: this.setupBar1Index,
      setupBar1Date: null,
      setupBar9Index: this.setupBar9Index,
      setupBar9Date: this.setupBar9Date,
      setupCompleted: this.setupCompleted,
      setupPerfected: false,
      setupPerfectionPending: false,
      setupBarIndices: [],
      completedSetupBarIndices: [],
      countdownActive: this.countdownActive,
      countdownCount: this.countdownCount,
      countdownBarIndices: [...this.countdownBarIndices],
      countdownBar8Close: this.countdownBar8Close,
      countdownDeferred: this.countdownDeferred,
      countdownComplete: this.countdownComplete,
      countdownQualified: this.countdownQualified,
      countdownBar13Index: this.countdownBar13Index,
      countdownBar13Date: this.countdownBar13Date,
      tdstLevel: this.tdstLevel,
      tdstAnchorBarDate: this.tdstAnchorBarDate,
      riskLevel: this.riskLevel,
      barsSince9: null,
      barsSince13: null,
      setupExtensionCount: 0,
      priorSetupRange: null,
      recycledThisBar: false,
    };
  }

  static fromSnapshot(snap: DirectionalSnapshot, config: EngineConfig): ComboTracker {
    const t = new ComboTracker(snap.direction, config);
    t.setupBar1Index = snap.setupBar1Index;
    t.setupBar9Index = snap.setupBar9Index;
    t.setupBar9Date = snap.setupBar9Date;
    t.setupCompleted = snap.setupCompleted;
    t.countdownActive = snap.countdownActive;
    t.countdownCount = snap.countdownCount;
    t.countdownBarIndices = [...snap.countdownBarIndices];
    t.countdownBar8Close = snap.countdownBar8Close;
    t.countdownDeferred = snap.countdownDeferred;
    t.countdownComplete = snap.countdownComplete;
    t.countdownQualified = snap.countdownQualified;
    t.countdownBar13Index = snap.countdownBar13Index;
    t.countdownBar13Date = snap.countdownBar13Date;
    t.tdstLevel = snap.tdstLevel;
    t.tdstAnchorBarDate = snap.tdstAnchorBarDate;
    t.riskLevel = snap.riskLevel;
    return t;
  }

  toAnnotation(date: string): BarAnnotation {
    return {
      date,
      indicator: "combo",
      setupDirection: null,
      setupCount: 0,
      setupPerfected: false,
      setupCompleted: false,
      countdownDirection: this.countdownActive ? this.direction : null,
      countdownCount: this.countdownCount,
      countdownQualified: this.countdownQualified,
      countdownCompleted: this.countdownComplete,
      countdownDeferred: this.countdownDeferred,
      tdstLevel: this.tdstLevel,
      tdstDirection: this.tdstLevel != null ? this.direction : null,
      riskLevel: this.riskLevel,
      recycled: false,
    };
  }
}

// trueHigh / trueLow imported for parity with the Sequential file's exports
export { trueHigh, trueLow };
