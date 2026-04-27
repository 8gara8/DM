/**
 * TD Sequential state machine.
 *
 * Implements per `DeMark_Technical_Specification.md` and
 * `demark_indicator_tech_spec_GPT.md`:
 *   - Setup count (9) gated on a confirmed Price Flip.
 *   - Setup perfection (with optional late perfection).
 *   - Countdown count (13) using `c[i] ≤ l[i-2]` (Buy) / `c[i] ≥ h[i-2]` (Sell).
 *   - 13-vs-8 deferral (default ON for Sequential): when count 12 is
 *     reached but the 13-vs-8 rule fails, mark `+` and continue searching.
 *   - Cancellation by opposing Setup or TDST violation.
 *   - Recycle (extension count or range ratio).
 *   - Risk Level computation on completed 13.
 *
 * Public surface is via `DeMarkEngine` in `index.ts`. This file exports
 * the per-direction tracker the engine spawns one of per side.
 */

import type {
  Bar,
  BarAnnotation,
  Direction,
  DirectionalSnapshot,
  SignalEvent,
} from "./types";
import type { EngineConfig } from "./config";
import { setupStartsHere } from "./flip";
import { isPerfected, isLatePerfected } from "./perfection";
import { calcTdstLevel, tdstBreached, trueHigh, trueLow } from "./tdst";
import { calcRiskLevel, riskBreached } from "./risk";
import { calcSetupRange } from "./recycle";

export class SequentialTracker {
  readonly direction: Direction;
  readonly config: EngineConfig;

  setupCount = 0;
  setupBar1Index: number | null = null;
  setupBar1Date: string | null = null;
  /** Bar 9 of the most recent COMPLETED Setup. Persists past in-progress resets. */
  setupBar9Index: number | null = null;
  setupBar9Date: string | null = null;
  setupCompleted = false;
  setupPerfected = false;
  setupPerfectionPending = false;
  /** Bar indices for every counted setup bar (length 9 once complete). */
  setupBarIndices: number[] = [];
  /**
   * Frozen copy of `setupBarIndices` captured when the Setup completed.
   * Used by the late-perfection lookahead and by recycle range math —
   * survives resets of the in-progress Setup count.
   */
  completedSetupBarIndices: number[] = [];
  /** Pre-completion bar 1 of an in-progress recycling-eligible new setup. */
  newSetupBar1Index: number | null = null;
  newSetupBar9Index: number | null = null;
  /** Range of the prior completed Setup, used for range-ratio recycling. */
  priorSetupRange: number | null = null;
  /** How far past 9 the Setup has extended (for the extension recycle rule). */
  setupExtensionCount = 0;

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
  barsSince9: number | null = null;
  barsSince13: number | null = null;

  recycledThisBar = false;
  /**
   * Latched to `true` when a recycle fires on this Setup, cleared when a
   * fresh in-progress count starts (count 0 → 1) or when the countdown
   * is cancelled. Prevents the same recycle trigger from firing on every
   * bar of an extended count once threshold is crossed.
   */
  recycledThisSetup = false;

  constructor(direction: Direction, config: EngineConfig) {
    this.direction = direction;
    this.config = config;
  }

  toSnapshot(): DirectionalSnapshot {
    return {
      direction: this.direction,
      indicator: "sequential",
      setupCount: this.setupCount,
      setupBar1Index: this.setupBar1Index,
      setupBar1Date: this.setupBar1Date,
      setupBar9Index: this.setupBar9Index,
      setupBar9Date: this.setupBar9Date,
      setupCompleted: this.setupCompleted,
      setupPerfected: this.setupPerfected,
      setupPerfectionPending: this.setupPerfectionPending,
      setupBarIndices: [...this.setupBarIndices],
      completedSetupBarIndices: [...this.completedSetupBarIndices],
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
      barsSince9: this.barsSince9,
      barsSince13: this.barsSince13,
      setupExtensionCount: this.setupExtensionCount,
      priorSetupRange: this.priorSetupRange,
      recycledThisBar: this.recycledThisBar,
    };
  }

  static fromSnapshot(snap: DirectionalSnapshot, config: EngineConfig): SequentialTracker {
    const t = new SequentialTracker(snap.direction, config);
    t.setupCount = snap.setupCount;
    t.setupBar1Index = snap.setupBar1Index;
    t.setupBar1Date = snap.setupBar1Date;
    t.setupBar9Index = snap.setupBar9Index;
    t.setupBar9Date = snap.setupBar9Date;
    t.setupCompleted = snap.setupCompleted;
    t.setupPerfected = snap.setupPerfected;
    t.setupPerfectionPending = snap.setupPerfectionPending;
    t.setupBarIndices = [...snap.setupBarIndices];
    t.completedSetupBarIndices = [...(snap.completedSetupBarIndices ?? [])];
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
    t.barsSince9 = snap.barsSince9;
    t.barsSince13 = snap.barsSince13;
    t.setupExtensionCount = snap.setupExtensionCount;
    t.priorSetupRange = snap.priorSetupRange;
    t.recycledThisBar = snap.recycledThisBar;
    return t;
  }

  /**
   * Reset only the in-progress Setup count. Do NOT clear the
   * completed-Setup anchor (`setupBar9Index`, `setupCompleted`,
   * `completedSetupBarIndices`, etc.) — an active Countdown depends on
   * those staying intact across bars where the in-progress count breaks.
   *
   * Use `clearCompletedSetup()` only when a NEW Setup completes (it
   * supersedes the old one) or when the Countdown is cancelled.
   */
  resetSetup(): void {
    this.setupCount = 0;
    this.setupBar1Index = null;
    this.setupBar1Date = null;
    this.setupBarIndices = [];
    this.setupExtensionCount = 0;
    // A new in-progress count is allowed to recycle again.
    this.recycledThisSetup = false;
  }

  clearCompletedSetup(): void {
    this.setupBar9Index = null;
    this.setupBar9Date = null;
    this.setupCompleted = false;
    this.setupPerfected = false;
    this.setupPerfectionPending = false;
    this.completedSetupBarIndices = [];
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
    this.riskLevel = null;
    this.recycledThisSetup = false;
  }

  /**
   * Step 3: update Setup tracker for bar `i`.
   * Returns the events emitted (`setup_count`, `setup_complete`,
   * `setup_perfected`, `price_flip`).
   */
  stepSetup(bars: Bar[], i: number): SignalEvent[] {
    const events: SignalEvent[] = [];
    const cfg = this.config;
    const dir = this.direction;
    const date = bars[i]!.date;

    // Did a Setup count occur on this bar?
    const lookbackOK = (() => {
      if (i < cfg.setup.lookback) return false;
      const ci = bars[i]!.close;
      const cBack = bars[i - cfg.setup.lookback]!.close;
      return dir === "buy"
        ? cfg.setup.strict
          ? ci < cBack
          : ci <= cBack
        : cfg.setup.strict
          ? ci > cBack
          : ci >= cBack;
    })();

    if (!lookbackOK) {
      // Equality or opposite side — Setup count breaks unless strict=false.
      this.resetSetup();
      // Late perfection still applies to bars that broke the count, as
      // long as we're inside the configured lookahead window after
      // count 9. This is exactly the case the lookahead is designed for.
      events.push(...this.tryLatePerfection(bars, i));
      return events;
    }

    if (this.setupCount === 0) {
      // Need a confirmed price flip in this direction (bar i-1 was the
      // first close that violated the lookback — but we keep it simple:
      // detect on the present bar).
      if (
        cfg.setup.requirePriceFlip &&
        !setupStartsHere(bars, i, dir, {
          lookback: cfg.setup.lookback,
          strict: cfg.setup.strict,
          requirePriceFlip: true,
        })
      ) {
        return events;
      }
      this.setupCount = 1;
      this.setupBar1Index = i;
      this.setupBar1Date = date;
      this.setupBarIndices = [i];
      events.push({
        indicator: "sequential",
        eventType: "price_flip",
        direction: dir,
        count: 1,
        barDate: date,
        firstKnownAtDate: date,
        configHash: cfg.configHash,
        meta: { side: dir === "buy" ? "bearish" : "bullish" },
      });
    } else if (this.setupCount < cfg.setup.length) {
      this.setupCount += 1;
      this.setupBarIndices.push(i);
    } else {
      // Setup is already complete (>=9). Track extension for recycle rule.
      if (cfg.setup.allowExtensionBeyond9) {
        this.setupCount += 1;
        this.setupBarIndices.push(i);
        this.setupExtensionCount = this.setupCount - cfg.setup.length;
      }
    }

    events.push({
      indicator: "sequential",
      eventType: "setup_count",
      direction: dir,
      count: this.setupCount,
      barDate: date,
      firstKnownAtDate: date,
      configHash: cfg.configHash,
    });

    if (this.setupCount === cfg.setup.length) {
      // A new Setup completion overrides any prior completed-Setup anchor.
      this.setupBar9Index = i;
      this.setupBar9Date = date;
      this.setupCompleted = true;
      // Freeze the bar indices that defined this Setup so the late-
      // perfection lookahead and recycle range math survive future resets
      // of the in-progress count.
      this.completedSetupBarIndices = [...this.setupBarIndices];
      events.push({
        indicator: "sequential",
        eventType: "setup_complete",
        direction: dir,
        count: cfg.setup.length,
        barDate: date,
        firstKnownAtDate: date,
        configHash: cfg.configHash,
      });
      // Step 5: perfection check (initial; lookahead handled below)
      const perfNow = isPerfected(
        bars,
        this.completedSetupBarIndices,
        dir,
        cfg.setup.perfection.mode,
      );
      this.setupPerfected = perfNow;
      this.setupPerfectionPending = !perfNow && cfg.setup.perfection.lookaheadBars > 0;
      if (perfNow) {
        events.push({
          indicator: "sequential",
          eventType: "setup_perfected",
          direction: dir,
          count: cfg.setup.length,
          barDate: date,
          firstKnownAtDate: date,
          configHash: cfg.configHash,
        });
      }
    } else {
      events.push(...this.tryLatePerfection(bars, i));
    }

    return events;
  }

  /**
   * Late-perfection check, factored out so it runs both when the in-progress
   * count continues AND when the count breaks (which is in fact the more
   * common case the lookahead is designed for — the Setup printed 9, then
   * a reversal bar broke the next count, then a swing bar within
   * `lookaheadBars` retroactively confirms perfection).
   */
  private tryLatePerfection(bars: Bar[], i: number): SignalEvent[] {
    const events: SignalEvent[] = [];
    const cfg = this.config;
    if (!this.setupPerfectionPending) return events;
    if (this.setupBar9Index == null) return events;

    const barsSince = i - this.setupBar9Index;
    if (barsSince > cfg.setup.perfection.lookaheadBars) {
      this.setupPerfectionPending = false;
      return events;
    }

    if (
      isLatePerfected(
        bars,
        this.completedSetupBarIndices,
        this.direction,
        i,
        cfg.setup.perfection.mode,
      )
    ) {
      this.setupPerfected = true;
      this.setupPerfectionPending = false;
      events.push({
        indicator: "sequential",
        eventType: "setup_perfected",
        direction: this.direction,
        count: cfg.setup.length,
        barDate: bars[this.setupBar9Index]!.date,
        firstKnownAtDate: bars[i]!.date,
        configHash: cfg.configHash,
        meta: { late: true, lookaheadBars: barsSince },
      });
    }
    return events;
  }

  /** Step 6: drop the TDST level for a freshly completed Setup. */
  applyNewTdst(bars: Bar[]): void {
    if (
      this.setupBar1Index == null ||
      this.setupBar9Index == null ||
      !this.setupCompleted
    ) {
      return;
    }
    const level = calcTdstLevel(
      bars,
      this.direction,
      this.setupBar1Index,
      this.setupBar9Index,
      this.config.tdst.anchor,
    );
    this.tdstLevel = level;
    this.tdstAnchorBarDate = bars[this.setupBar1Index]!.date;
  }

  /** Step 7: cancel countdown if the opposing Setup completes or TDST breaches. */
  evaluateCancellation(
    bars: Bar[],
    i: number,
    opposingSetupCompletedThisBar: boolean,
  ): SignalEvent[] {
    const events: SignalEvent[] = [];
    if (!this.countdownActive) return events;
    const cfg = this.config.sequential.cancellation;
    const date = bars[i]!.date;
    const dir = this.direction;

    if (cfg.opposingSetupEnabled && opposingSetupCompletedThisBar) {
      events.push({
        indicator: "sequential",
        eventType: "countdown_cancel",
        direction: dir,
        count: this.countdownCount,
        barDate: date,
        firstKnownAtDate: date,
        configHash: this.config.configHash,
        meta: { reason: "opposing_setup" },
      });
      this.resetCountdown();
      return events;
    }

    // Modern public TDST cancellation test: Buy Countdown cancels if
    // `trueLow > buyTdstResistance` (the entire bar lifts above the
    // resistance, not just the close). The relevant level is OUR own
    // direction's TDST level — there's no opposing-level dependency.
    if (cfg.tdstViolationEnabled) {
      if (this.tdstLevel != null) {
        const breached = tdstBreached(
          bars,
          i,
          dir,
          this.tdstLevel,
          this.config.tdst.breakoutTest,
        );
        if (breached) {
          events.push({
            indicator: "sequential",
            eventType: "tdst_breach",
            direction: dir,
            count: this.countdownCount,
            barDate: date,
            firstKnownAtDate: date,
            configHash: this.config.configHash,
            meta: { level: this.tdstLevel, test: this.config.tdst.breakoutTest },
          });
          events.push({
            indicator: "sequential",
            eventType: "countdown_cancel",
            direction: dir,
            count: this.countdownCount,
            barDate: date,
            firstKnownAtDate: date,
            configHash: this.config.configHash,
            meta: { reason: "tdst_violation" },
          });
          this.resetCountdown();
        }
      }
    }
    return events;
  }

  /** Step 8: activate Countdown after Setup 9 if not already active. */
  activateCountdown(): void {
    if (!this.setupCompleted) return;
    if (this.countdownActive) return;
    this.countdownActive = true;
    this.countdownCount = 0;
    this.countdownBarIndices = [];
    this.countdownBar8Close = null;
    this.countdownDeferred = false;
    this.countdownComplete = false;
    this.countdownQualified = false;
  }

  /** Step 10: increment Countdown for bar i if it qualifies. */
  stepCountdown(bars: Bar[], i: number): SignalEvent[] {
    const events: SignalEvent[] = [];
    if (!this.countdownActive) return events;
    // Once 13 has printed, the Countdown is finished. Do NOT increment
    // past 13 — caps at countdownLength. Recycle / cancellation will
    // reset countdownActive when the engine wants a fresh tracker.
    if (this.countdownComplete) return events;
    if (this.setupBar9Index == null || i <= this.setupBar9Index) return events;

    const cfg = this.config.sequential;
    const dir = this.direction;
    const date = bars[i]!.date;
    const ci = bars[i]!.close;

    if (i < cfg.countdownLookback) return events;

    const baseQualifies =
      dir === "buy"
        ? cfg.inclusive
          ? ci <= bars[i - cfg.countdownLookback]!.low
          : ci < bars[i - cfg.countdownLookback]!.low
        : cfg.inclusive
          ? ci >= bars[i - cfg.countdownLookback]!.high
          : ci > bars[i - cfg.countdownLookback]!.high;

    if (!baseQualifies) return events;

    // 13-vs-8 deferral check: if we're at count 12 and this bar would print
    // count 13, also require the 13-vs-8 rule. Otherwise mark deferred and
    // do NOT increment the count.
    if (
      cfg.deferral.lastVs8Enabled &&
      this.countdownCount === cfg.countdownLength - 1 &&
      this.countdownBar8Close != null
    ) {
      const passes13vs8 =
        dir === "buy"
          ? bars[i]!.low <= this.countdownBar8Close
          : bars[i]!.high >= this.countdownBar8Close;
      if (!passes13vs8) {
        this.countdownDeferred = true;
        events.push({
          indicator: "sequential",
          eventType: "countdown_deferred",
          direction: dir,
          count: cfg.countdownLength,
          barDate: date,
          firstKnownAtDate: date,
          configHash: this.config.configHash,
          meta: { bar8Close: this.countdownBar8Close },
        });
        return events;
      }
    }

    this.countdownCount += 1;
    this.countdownBarIndices.push(i);
    if (this.countdownCount === 8) {
      this.countdownBar8Close = ci;
    }
    events.push({
      indicator: "sequential",
      eventType: "countdown_count",
      direction: dir,
      count: this.countdownCount,
      barDate: date,
      firstKnownAtDate: date,
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
            ? ci <= this.countdownBar8Close
            : ci >= this.countdownBar8Close;
      this.countdownQualified = qualified;
      events.push({
        indicator: "sequential",
        eventType: "countdown_complete",
        direction: dir,
        count: cfg.countdownLength,
        barDate: date,
        firstKnownAtDate: date,
        configHash: this.config.configHash,
      });
      if (qualified) {
        events.push({
          indicator: "sequential",
          eventType: "countdown_qualified",
          direction: dir,
          count: cfg.countdownLength,
          barDate: date,
          firstKnownAtDate: date,
          configHash: this.config.configHash,
        });
      }
      this.barsSince13 = 0;
    }
    return events;
  }

  /**
   * Step 12: recycle if conditions are met.
   * `setupCompletedThisBar` is the engine's signal that a new Setup
   * COMPLETED on this bar (count just hit `setup.length`), which is the
   * only context the range-ratio trigger is well-defined in. The
   * extension trigger fires when the in-progress count crosses the
   * configured threshold.
   *
   * We also guard against firing the same recycle event repeatedly while
   * the count keeps extending past the threshold via `recycledThisSetup`,
   * which is cleared when a new Setup count starts (`setupCount` going 0→1)
   * or when the countdown is cancelled.
   */
  evaluateRecycle(bars: Bar[], i: number, setupCompletedThisBar: boolean): SignalEvent[] {
    const events: SignalEvent[] = [];
    const cfg = this.config.sequential.recycle;
    if (!cfg.enabled) return events;
    if (!this.countdownActive) return events;
    if (this.recycledThisSetup) return events;
    if (this.setupBar1Index == null || this.setupBar9Index == null) return events;

    let trigger: "extension" | "range_ratio" | null = null;
    let newRange: number | null = null;

    // Extension trigger: in-progress same-direction Setup count has
    // crossed the threshold (modern default: 22).
    if (this.setupCount >= cfg.setupCountThreshold) {
      trigger = "extension";
    } else if (setupCompletedThisBar && this.priorSetupRange != null) {
      // Range-ratio trigger: a NEW Setup just completed (overlapping the
      // active Countdown). Compare its range to the prior Setup's range.
      newRange = calcSetupRange(bars, this.setupBar1Index, this.setupBar9Index);
      if (this.priorSetupRange > 0) {
        const ratio = newRange / this.priorSetupRange;
        if (ratio >= cfg.rangeRatioMin && ratio <= cfg.rangeRatioMax) {
          trigger = "range_ratio";
        }
      }
    }

    if (trigger == null) return events;

    // Stamp the event with the bar currently being processed.
    const date = bars[i]!.date;
    events.push({
      indicator: "sequential",
      eventType: "setup_recycle",
      direction: this.direction,
      count: this.setupCount,
      barDate: date,
      firstKnownAtDate: date,
      configHash: this.config.configHash,
      meta: {
        trigger,
        priorSetupRange: this.priorSetupRange,
        newSetupRange: newRange,
      },
    });

    this.recycledThisBar = true;
    this.recycledThisSetup = true;
    if (cfg.behavior === "reset_to_new_setup") {
      this.resetCountdown();
      // Keep the current Setup as the "new" anchor for the recycled run.
      this.activateCountdown();
    }
    return events;
  }

  /** Step 13: produce the Risk Level for a freshly completed 13. */
  applyRiskLevel(bars: Bar[]): void {
    if (!this.config.riskLevel.enabled) return;
    if (
      !this.countdownComplete ||
      this.setupBar1Index == null ||
      this.countdownBar13Index == null
    ) {
      return;
    }
    if (!this.config.riskLevel.generateOnCountdown13) return;
    this.riskLevel = calcRiskLevel(
      bars,
      this.direction,
      this.setupBar1Index,
      this.countdownBar13Index,
      this.config.riskLevel.multiplier,
    );
  }

  /** Step 14: emit risk_level_breach if the latest bar broke the level. */
  checkRiskBreach(bars: Bar[], i: number): SignalEvent[] {
    const events: SignalEvent[] = [];
    if (this.riskLevel == null) return events;
    if (riskBreached(bars, i, this.direction, this.riskLevel)) {
      events.push({
        indicator: "sequential",
        eventType: "risk_level_breach",
        direction: this.direction,
        count: this.config.sequential.countdownLength,
        barDate: bars[i]!.date,
        firstKnownAtDate: bars[i]!.date,
        configHash: this.config.configHash,
        meta: { level: this.riskLevel },
      });
      this.riskLevel = null; // one-shot
    }
    return events;
  }

  /** Build the BarAnnotation for the most recent step. */
  toAnnotation(date: string): BarAnnotation {
    return {
      date,
      indicator: "sequential",
      setupDirection: this.setupCount > 0 ? this.direction : null,
      setupCount: this.setupCount,
      setupPerfected: this.setupPerfected,
      // Read the persistent flag — `setupCount` may exceed `setup.length`
      // when extension is allowed, but the Setup is still completed.
      setupCompleted: this.setupCompleted,
      countdownDirection: this.countdownActive ? this.direction : null,
      countdownCount: this.countdownCount,
      countdownQualified: this.countdownQualified,
      countdownCompleted: this.countdownComplete,
      countdownDeferred: this.countdownDeferred,
      tdstLevel: this.tdstLevel,
      tdstDirection: this.tdstLevel != null ? this.direction : null,
      riskLevel: this.riskLevel,
      recycled: this.recycledThisBar,
    };
  }
}

// Re-exports of helpers used by tests.
export { trueHigh, trueLow };
