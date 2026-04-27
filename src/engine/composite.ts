/**
 * 9-13-9 composite detection.
 *
 * After a completed Buy 13, if a fresh Buy Setup completes preceded by a
 * Bullish Price Flip with no completed Sell Setup intervening, emit a
 * `signal_9_13_9` event. Mirror for Sell.
 */

import type { Direction, SignalEvent } from "./types";
import type { EngineConfig } from "./config";

export interface CompositeWatcher {
  direction: Direction;
  /** date of the completed 13 we are watching for the trailing 9. */
  thirteenBarDate: string;
  /** had any opposing setup_complete arrived since the 13? */
  invalidatedByOpposing: boolean;
  /** had a same-direction price flip occurred since the 13? */
  hadConfirmingFlip: boolean;
}

export class CompositeDetector {
  private watchers: CompositeWatcher[] = [];
  private readonly config: EngineConfig;

  constructor(config: EngineConfig) {
    this.config = config;
  }

  onCountdownComplete(direction: Direction, barDate: string): void {
    this.watchers.push({
      direction,
      thirteenBarDate: barDate,
      invalidatedByOpposing: false,
      hadConfirmingFlip: false,
    });
  }

  /**
   * `direction` here = the side whose pending 9-13-9 watcher should be
   * invalidated (i.e. NOT the side that just completed). Callers in
   * `index.ts` pass the OPPOSING direction explicitly.
   */
  onOpposingSetupComplete(direction: Direction): void {
    for (const w of this.watchers) {
      if (w.direction === direction) w.invalidatedByOpposing = true;
    }
  }

  onSameDirectionFlip(direction: Direction): void {
    for (const w of this.watchers) {
      if (w.direction === direction) w.hadConfirmingFlip = true;
    }
  }

  /**
   * Call when a Setup completes. Returns a `signal_9_13_9` event when this
   * Setup closes out a 9-13-9 sequence.
   */
  onSetupComplete(direction: Direction, barDate: string): SignalEvent[] {
    const events: SignalEvent[] = [];
    const remaining: CompositeWatcher[] = [];
    for (const w of this.watchers) {
      if (w.direction === direction && !w.invalidatedByOpposing && w.hadConfirmingFlip) {
        events.push({
          indicator: "sequential",
          eventType: "signal_9_13_9",
          direction,
          count: 9,
          barDate,
          firstKnownAtDate: barDate,
          configHash: this.config.configHash,
          meta: { precedingThirteenDate: w.thirteenBarDate },
        });
      } else {
        remaining.push(w);
      }
    }
    this.watchers = remaining;
    return events;
  }

  snapshot(): CompositeWatcher[] {
    return this.watchers.map((w) => ({ ...w }));
  }

  restore(watchers: CompositeWatcher[]): void {
    this.watchers = watchers.map((w) => ({ ...w }));
  }
}
