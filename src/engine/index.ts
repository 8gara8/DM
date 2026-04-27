/**
 * Public DeMark engine entrypoint.
 *
 * Composes the per-direction Sequential and Combo trackers and the 9-13-9
 * composite detector behind a single `process()` method. Exposes
 * `serialize()` / `restore()` so a scan can resume from the last bar
 * without recomputing 5 years of history.
 *
 * Per-bar processing order (load-bearing — see SPEC.md §9 Phase 2 Task 8.5,
 * which mirrors `demark_indicator_tech_spec_GPT.md` §13.2):
 *   1. append/validate completed bar
 *   2. compute trueHigh / trueLow / trueRange (implicit; helpers do this)
 *   3. update Buy + Sell Setup trackers
 *   4. emit Setup counts and completed-9 events (handled inside step 3)
 *   5. compute Setup perfection status (handled inside step 3)
 *   6. create/update TDST levels from newly completed Setups
 *   7. cancel active Countdowns if opposing Setup or TDST violation
 *   8. activate newly eligible Sequential Countdowns
 *   9. activate / reconstruct newly eligible Combo Countdowns (firstKnownAt = today)
 *  10. update existing Sequential Countdowns for current bar
 *  11. update existing Combo Countdowns for current bar
 *  12. check recycling conditions
 *  13. generate risk levels for newly completed 9s/13s
 *  14. update 4-bar / 12-bar response metrics
 *  15. emit bar-annotation snapshot
 */

import type {
  Bar,
  BarAnnotation,
  EngineSnapshot,
  SignalEvent,
} from "./types";
import {
  DEFAULT_ENGINE_CONFIG,
  type EngineConfig,
  resolveConfig,
} from "./config";
import { SequentialTracker } from "./sequential";
import { ComboTracker } from "./combo";
import { CompositeDetector } from "./composite";
import { calcSetupRange } from "./recycle";
import { detectPriceFlip } from "./flip";

export interface ProcessResult {
  events: SignalEvent[];
  /**
   * One annotation per (direction, indicator) tracker. Consumers join by
   * indicator and pick whichever tracker has the active count.
   */
  annotations: BarAnnotation[];
}

export class DeMarkEngine {
  readonly config: EngineConfig;

  private buySeq: SequentialTracker;
  private sellSeq: SequentialTracker;
  private buyCombo: ComboTracker;
  private sellCombo: ComboTracker;
  private composite: CompositeDetector;

  private lastBarIndex = -1;

  constructor(partialConfig: Partial<EngineConfig> = {}) {
    this.config =
      partialConfig.configHash && partialConfig.configHash.length > 0
        ? (partialConfig as EngineConfig)
        : resolveConfig(partialConfig);
    this.buySeq = new SequentialTracker("buy", this.config);
    this.sellSeq = new SequentialTracker("sell", this.config);
    this.buyCombo = new ComboTracker("buy", this.config);
    this.sellCombo = new ComboTracker("sell", this.config);
    this.composite = new CompositeDetector(this.config);
  }

  /**
   * Process bar at index `i` of the `bars` array. Bars MUST be ordered
   * ascending by date and `i === this.lastBarIndex + 1` for incremental
   * resume to be valid.
   */
  process(bars: Bar[], i: number): ProcessResult {
    if (i !== this.lastBarIndex + 1) {
      throw new Error(
        `DeMarkEngine.process: expected bar index ${this.lastBarIndex + 1}, got ${i}`,
      );
    }
    if (i < 0 || i >= bars.length) {
      throw new Error(`DeMarkEngine.process: out-of-bounds index ${i}`);
    }
    const bar = bars[i]!;
    const events: SignalEvent[] = [];

    // Reset per-bar transient flags
    this.buySeq.recycledThisBar = false;
    this.sellSeq.recycledThisBar = false;

    // Step 3+4+5: update both Setup directions. Process in a stable order
    // (buy first) to preserve determinism.
    const buyWasSetupCompletedBefore = this.buySeq.setupCompleted;
    const sellWasSetupCompletedBefore = this.sellSeq.setupCompleted;

    events.push(...this.buySeq.stepSetup(bars, i));
    events.push(...this.sellSeq.stepSetup(bars, i));

    const buySetupCompletedThisBar =
      this.buySeq.setupCompleted &&
      !buyWasSetupCompletedBefore &&
      this.buySeq.setupBar9Index === i;
    const sellSetupCompletedThisBar =
      this.sellSeq.setupCompleted &&
      !sellWasSetupCompletedBefore &&
      this.sellSeq.setupBar9Index === i;

    // Step 6: TDST level for newly completed Setups. (priorSetupRange is
    // updated AFTER the recycle step in step 12, so the recycle's range
    // ratio compares the new Setup against the PREVIOUS one.)
    if (buySetupCompletedThisBar) {
      this.buySeq.applyNewTdst(bars);
      this.buyCombo.tdstLevel = this.buySeq.tdstLevel;
      this.buyCombo.tdstAnchorBarDate = this.buySeq.tdstAnchorBarDate;
    }
    if (sellSetupCompletedThisBar) {
      this.sellSeq.applyNewTdst(bars);
      this.sellCombo.tdstLevel = this.sellSeq.tdstLevel;
      this.sellCombo.tdstAnchorBarDate = this.sellSeq.tdstAnchorBarDate;
    }

    // Composite: 9-13-9 setup completion check (resolves any open watchers)
    if (buySetupCompletedThisBar) {
      events.push(...this.composite.onSetupComplete("buy", bar.date));
    }
    if (sellSetupCompletedThisBar) {
      events.push(...this.composite.onSetupComplete("sell", bar.date));
      this.composite.onOpposingSetupComplete("buy");
    }
    if (buySetupCompletedThisBar) {
      this.composite.onOpposingSetupComplete("sell");
    }
    // Composite price-flip tracking (for the trailing 9 confirmation)
    const flip = detectPriceFlip(bars, i, this.config.setup.strict).flip;
    if (flip) this.composite.onSameDirectionFlip(flip);

    // Step 7: cancellation
    events.push(
      ...this.buySeq.evaluateCancellation(bars, i, sellSetupCompletedThisBar),
    );
    events.push(
      ...this.sellSeq.evaluateCancellation(bars, i, buySetupCompletedThisBar),
    );
    events.push(
      ...this.buyCombo.evaluateCancellation(bars, i, sellSetupCompletedThisBar),
    );
    events.push(
      ...this.sellCombo.evaluateCancellation(bars, i, buySetupCompletedThisBar),
    );

    // Step 8: activate Sequential Countdowns
    if (buySetupCompletedThisBar) this.buySeq.activateCountdown();
    if (sellSetupCompletedThisBar) this.sellSeq.activateCountdown();

    // Step 9: activate / retroactively reconstruct Combo Countdowns
    if (buySetupCompletedThisBar) {
      this.buyCombo.syncSetupComplete(
        this.buySeq.setupBar1Index!,
        this.buySeq.setupBar9Index!,
        bar.date,
      );
      events.push(...this.buyCombo.activateRetroactively(bars));
    }
    if (sellSetupCompletedThisBar) {
      this.sellCombo.syncSetupComplete(
        this.sellSeq.setupBar1Index!,
        this.sellSeq.setupBar9Index!,
        bar.date,
      );
      events.push(...this.sellCombo.activateRetroactively(bars));
    }

    // Step 10: existing Sequential Countdowns step forward
    events.push(...this.buySeq.stepCountdown(bars, i));
    events.push(...this.sellSeq.stepCountdown(bars, i));

    // Step 11: existing Combo Countdowns step forward
    events.push(...this.buyCombo.stepCountdown(bars, i));
    events.push(...this.sellCombo.stepCountdown(bars, i));

    // Composite: register completed 13s
    if (this.buySeq.countdownComplete && this.buySeq.countdownBar13Index === i) {
      this.composite.onCountdownComplete("buy", bar.date);
    }
    if (this.sellSeq.countdownComplete && this.sellSeq.countdownBar13Index === i) {
      this.composite.onCountdownComplete("sell", bar.date);
    }

    // Step 12: recycling. Then update `priorSetupRange` for next time —
    // doing it here (after evaluateRecycle) ensures the range-ratio
    // trigger compares THIS new Setup's range against the PREVIOUS
    // completed Setup, not against itself.
    events.push(...this.buySeq.evaluateRecycle(bars, i, buySetupCompletedThisBar));
    events.push(...this.sellSeq.evaluateRecycle(bars, i, sellSetupCompletedThisBar));
    if (
      buySetupCompletedThisBar &&
      this.buySeq.setupBar1Index != null &&
      this.buySeq.setupBar9Index != null
    ) {
      this.buySeq.priorSetupRange = calcSetupRange(
        bars,
        this.buySeq.setupBar1Index,
        this.buySeq.setupBar9Index,
      );
    }
    if (
      sellSetupCompletedThisBar &&
      this.sellSeq.setupBar1Index != null &&
      this.sellSeq.setupBar9Index != null
    ) {
      this.sellSeq.priorSetupRange = calcSetupRange(
        bars,
        this.sellSeq.setupBar1Index,
        this.sellSeq.setupBar9Index,
      );
    }

    // Step 13: risk levels for newly completed 13s
    if (this.buySeq.countdownComplete && this.buySeq.countdownBar13Index === i) {
      this.buySeq.applyRiskLevel(bars);
    }
    if (this.sellSeq.countdownComplete && this.sellSeq.countdownBar13Index === i) {
      this.sellSeq.applyRiskLevel(bars);
    }

    // Step 14: 4-bar / 12-bar response metrics + risk-breach checks
    if (this.config.sequential.fourBarRulePostNine) {
      if (this.buySeq.setupBar9Index != null) {
        this.buySeq.barsSince9 = i - this.buySeq.setupBar9Index;
      }
      if (this.sellSeq.setupBar9Index != null) {
        this.sellSeq.barsSince9 = i - this.sellSeq.setupBar9Index;
      }
    }
    if (this.config.sequential.twelveBarRulePostThirteen) {
      if (this.buySeq.countdownBar13Index != null) {
        this.buySeq.barsSince13 = i - this.buySeq.countdownBar13Index;
      }
      if (this.sellSeq.countdownBar13Index != null) {
        this.sellSeq.barsSince13 = i - this.sellSeq.countdownBar13Index;
      }
    }
    events.push(...this.buySeq.checkRiskBreach(bars, i));
    events.push(...this.sellSeq.checkRiskBreach(bars, i));

    // Step 15: bar annotations
    const annotations: BarAnnotation[] = [
      this.buySeq.toAnnotation(bar.date),
      this.sellSeq.toAnnotation(bar.date),
      this.buyCombo.toAnnotation(bar.date),
      this.sellCombo.toAnnotation(bar.date),
    ];

    this.lastBarIndex = i;

    return { events, annotations };
  }

  /**
   * Run the engine over an entire bar series in one call. Returns the
   * concatenated event list and the per-bar annotation list (4 entries
   * per bar — one per (direction × indicator) tracker).
   */
  run(bars: Bar[]): ProcessResult {
    const events: SignalEvent[] = [];
    const annotations: BarAnnotation[] = [];
    for (let i = 0; i < bars.length; i++) {
      const r = this.process(bars, i);
      events.push(...r.events);
      annotations.push(...r.annotations);
    }
    return { events, annotations };
  }

  serialize(): EngineSnapshot {
    if (this.lastBarIndex < 0) {
      return {
        configHash: this.config.configHash,
        asOfBarDate: "",
        asOfBarIndex: -1,
        trackers: [],
        compositeWatchers: [],
        flipState: { lastBarIndex: -1 },
      };
    }
    return {
      configHash: this.config.configHash,
      asOfBarDate: "", // filled by caller from bars[lastBarIndex].date
      asOfBarIndex: this.lastBarIndex,
      trackers: [
        this.buySeq.toSnapshot(),
        this.sellSeq.toSnapshot(),
        this.buyCombo.toSnapshot(),
        this.sellCombo.toSnapshot(),
      ],
      compositeWatchers: this.composite.snapshot(),
      flipState: { lastBarIndex: this.lastBarIndex },
    };
  }

  static restore(
    snapshot: EngineSnapshot,
    configOrPartial: Partial<EngineConfig> = DEFAULT_ENGINE_CONFIG,
  ): DeMarkEngine {
    const cfg =
      configOrPartial.configHash && configOrPartial.configHash.length > 0
        ? (configOrPartial as EngineConfig)
        : resolveConfig(configOrPartial);
    if (cfg.configHash !== snapshot.configHash) {
      throw new Error(
        `DeMarkEngine.restore: configHash mismatch (snapshot=${snapshot.configHash} resolved=${cfg.configHash})`,
      );
    }
    const engine = new DeMarkEngine(cfg);
    for (const t of snapshot.trackers) {
      if (t.indicator === "sequential" && t.direction === "buy") {
        engine.buySeq = SequentialTracker.fromSnapshot(t, cfg);
      } else if (t.indicator === "sequential" && t.direction === "sell") {
        engine.sellSeq = SequentialTracker.fromSnapshot(t, cfg);
      } else if (t.indicator === "combo" && t.direction === "buy") {
        engine.buyCombo = ComboTracker.fromSnapshot(t, cfg);
      } else if (t.indicator === "combo" && t.direction === "sell") {
        engine.sellCombo = ComboTracker.fromSnapshot(t, cfg);
      }
    }
    if (snapshot.compositeWatchers && snapshot.compositeWatchers.length > 0) {
      engine.composite.restore(snapshot.compositeWatchers);
    }
    engine.lastBarIndex = snapshot.asOfBarIndex;
    return engine;
  }
}

export type { EngineConfig } from "./config";
export { DEFAULT_ENGINE_CONFIG, resolveConfig, hashConfig } from "./config";
export type {
  Bar,
  BarAnnotation,
  Direction,
  Indicator,
  Phase,
  SignalEvent,
  EventType,
  EngineSnapshot,
  DirectionalSnapshot,
  CompositeWatcherSnapshot,
  Timeframe,
} from "./types";
