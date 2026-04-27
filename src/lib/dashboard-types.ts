/**
 * Shared dashboard payload types — the contract between the composer
 * (`src/server/dashboard.ts`) and the React Server Components on `/`.
 *
 * Mirror SPEC.md §5 GET /api/dashboard exactly. Component props in
 * `src/components/features/*` import directly from this file so the
 * compiler enforces the contract at the boundary.
 */

import type {
  Bar,
  Direction,
  Indicator,
  Phase,
  Timeframe,
  Tone,
} from "@/engine/types";

export type SparklineMarker = {
  barDate: string;
  text: string;
  tone: Tone;
};

export type SparklinePayload = {
  bars: Bar[];
  markers: SparklineMarker[];
  lookbackLabel: string;
};

export type ConfluenceCell = {
  direction: Direction;
  indicator: Indicator;
  count: number;
  max: 9 | 13;
  isPerfected: boolean;
  isDeferred: boolean;
};

export type ConfluencePayload = {
  daily: ConfluenceCell | null;
  weekly: ConfluenceCell | null;
  monthly: ConfluenceCell | null;
  yearly: ConfluenceCell | null;
};

export type HitRateStat = {
  n: number;
  hits: number;
  horizon: string; // "+13d" | "+13w" | "+13m" | "+13y"
  indicator: Indicator;
  signalType: "setup_complete" | "countdown_complete" | "signal_9_13_9";
  avgReturnPct: number;
  smallSample: boolean;
};

export type DistanceMarker = {
  price: number;
  distancePct: number;
  side: "above" | "below";
};

export type PrimaryBadge = {
  direction: Direction | null;
  indicator: Indicator;
  phase: Phase;
  count: number;
  max: 9 | 13;
  isPerfected: boolean;
  isDeferred: boolean;
  isQualified: boolean;
  timeframe: Timeframe;
};

export type TileStatus =
  | "default"
  | "scanning"
  | "error"
  | "cancelled"
  | "lapsed"
  | "empty";

export type TickerTile = {
  ticker: string;
  price: number;
  changePct: number;
  tags: string[];
  primaryBadge: PrimaryBadge;
  sparkline: SparklinePayload;
  confluence: ConfluencePayload;
  tdst?: DistanceMarker;
  risk?: DistanceMarker;
  hitRate: HitRateStat | null;
  rank: number;
  status: TileStatus;
  errorMessage?: string;
  lastScanAt: string;
};

export type RankingFactor = {
  label: string;
  contribution: number;
};

export type HeroSignalPayload = {
  type: "signal";
  ticker: string;
  price: number;
  changePct: number;
  timeframe: Timeframe;
  indicator: Indicator;
  direction: Direction;
  badge: string;
  sparkline: SparklinePayload;
  translation: string;
  translationTemplateId: string;
  tdst?: DistanceMarker;
  risk?: DistanceMarker;
  hitRate: HitRateStat | null;
  rankingScore: number;
  rankingFactors: RankingFactor[];
  approaching: null;
};

export type HeroNothingNotablePayload = {
  type: "nothing-notable";
  approaching: TickerTile[];
  lastHotSignal?: {
    ticker: string;
    direction: Direction;
    indicator: Indicator;
    timeframe: Timeframe;
    eventType: string;
    daysAgo: number;
  } | null;
};

export type HeroEmptyWatchlistPayload = { type: "empty-watchlist" };
export type HeroLoadingPayload = { type: "loading" };

export type HeroPayload =
  | HeroSignalPayload
  | HeroNothingNotablePayload
  | HeroEmptyWatchlistPayload
  | HeroLoadingPayload;

export type DashboardMeta = {
  watchlistCount: number;
  activeCount: number;
  imminentCount: number;
  justPrintedCount: number;
  alerts24h: number;
  lastScanAt: string | null;
  lastScanTrigger: "cron" | "manual" | "add-ticker" | null;
};

export type DashboardData = {
  hero: HeroPayload;
  rails: {
    justPrinted: TickerTile[];
    imminent: TickerTile[];
    watching: TickerTile[];
  };
  meta: DashboardMeta;
};

export type DashboardResponse = { data: DashboardData; error: null };
