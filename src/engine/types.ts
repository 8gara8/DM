/**
 * Public types for the DeMark engine.
 *
 * Pure data — no Next/React/DOM imports allowed in this file or anywhere
 * under src/engine/. The engine is intentionally framework-free so it can
 * be tested in isolation and reused on the server.
 */

export type Direction = "buy" | "sell";

export type Phase = "none" | "setup" | "countdown";

export type Indicator = "sequential" | "combo";

export type Timeframe = "daily" | "weekly" | "monthly" | "yearly";

export interface Bar {
  date: string; // ISO YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export type EventType =
  | "price_flip"
  | "setup_count"
  | "setup_complete"
  | "setup_perfected"
  | "countdown_count"
  | "countdown_deferred"
  | "countdown_complete"
  | "countdown_qualified"
  | "tdst_breach"
  | "risk_level_breach"
  | "setup_recycle"
  | "countdown_cancel"
  | "signal_9_13_9";

export interface SignalEvent {
  ticker?: string;
  timeframe?: Timeframe;
  indicator: Indicator;
  eventType: EventType;
  direction: Direction | null;
  count: number | null;
  /** The bar this event happened on (YYYY-MM-DD). */
  barDate: string;
  /**
   * Bar AFTER which this event was knowable. Equal to `barDate` for Setup
   * events and Sequential Countdown events. For Combo events that print
   * inside Setup bars 1..8, this is the date of Setup bar 9.
   */
  firstKnownAtDate: string;
  configHash: string;
  meta?: Record<string, unknown>;
}

export interface BarAnnotation {
  date: string;
  setupDirection: Direction | null;
  setupCount: number;
  setupPerfected: boolean;
  setupCompleted: boolean;
  countdownDirection: Direction | null;
  countdownCount: number;
  countdownQualified: boolean;
  countdownCompleted: boolean;
  countdownDeferred: boolean;
  tdstLevel: number | null;
  tdstDirection: Direction | null;
  riskLevel: number | null;
  recycled: boolean;
  /**
   * Indicator producing this annotation. The engine emits one annotation
   * per bar per (direction, indicator) tracker, but the public bar-stream
   * is the union: the canonical SignalState read by the dashboard joins
   * by indicator.
   */
  indicator: Indicator;
}

/**
 * Serialized state for a single (direction, indicator) tracker. The engine
 * stores TWO of these per indicator (buy + sell) so that opposing tracks
 * can run in parallel.
 */
export interface DirectionalSnapshot {
  direction: Direction;
  indicator: Indicator;

  // Setup
  setupCount: number;
  setupBar1Index: number | null;
  setupBar1Date: string | null;
  setupBar9Index: number | null;
  setupBar9Date: string | null;
  setupCompleted: boolean;
  setupPerfected: boolean;
  setupPerfectionPending: boolean;
  /** Bar indices of every counted setup bar — for late-perfection lookahead. */
  setupBarIndices: number[];

  // Countdown
  countdownActive: boolean;
  countdownCount: number;
  countdownBarIndices: number[];
  countdownBar8Close: number | null;
  countdownDeferred: boolean;
  countdownComplete: boolean;
  countdownQualified: boolean;
  countdownBar13Index: number | null;
  countdownBar13Date: string | null;

  // TDST
  tdstLevel: number | null;
  tdstAnchorBarDate: string | null;

  // Risk
  riskLevel: number | null;

  // Bookkeeping for the 4-bar / 12-bar response rules
  barsSince9: number | null;
  barsSince13: number | null;

  // Recycle bookkeeping
  setupExtensionCount: number;
  priorSetupRange: number | null;
  recycledThisBar: boolean;
}

/** Top-level snapshot bundle for an entire engine instance. */
export interface EngineSnapshot {
  configHash: string;
  asOfBarDate: string;
  asOfBarIndex: number;
  /** flat list keyed by direction+indicator. */
  trackers: DirectionalSnapshot[];
  /** Last close for each direction's price-flip detector. */
  flipState: { lastBarIndex: number };
}

export type Tone =
  | "buy"
  | "sell"
  | "buy-perfected"
  | "sell-perfected"
  | "buy-13"
  | "sell-13"
  | "deferred"
  | "recycle";
