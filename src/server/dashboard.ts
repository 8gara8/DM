/**
 * Dashboard composer — the hot path behind `GET /api/dashboard`.
 *
 * Joins watchlist + signal_states + signal_events + bars + (placeholder)
 * hit rates and produces the JSON contract from SPEC §5. Cache the
 * composed payload for ~30s per user keyed on (lastScanAt + watchlist hash).
 *
 * Phase 3: hit rates always `null` — the `signal_hit_rates` materialization
 * is populated by Phase 5's backtest pipeline. The component contract
 * (`HitRatePill`) handles `null` uniformly so this won't break.
 */

import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db as defaultDb, type DB } from "@/lib/db/client";
import {
  alerts as alertsTable,
  bars as barsTable,
  scanRuns,
  signalEvents as signalEventsTable,
  signalStates as signalStatesTable,
  watchlistTickers,
} from "@/lib/db/schema";
import type {
  Bar,
  Direction,
  Indicator,
  Timeframe,
} from "@/engine/types";
import {
  HERO_THRESHOLD_DEFAULT,
  heroThreshold,
  isImminent,
  rankSignals,
  explainFactors,
  type SignalStateLite,
  type RankedSignal,
} from "./ranking";
import { translate, type TranslationInput } from "@/lib/translations";
import type {
  ConfluenceCell,
  ConfluencePayload,
  DashboardData,
  DashboardMeta,
  DistanceMarker,
  HeroPayload,
  PrimaryBadge,
  SparklineMarker,
  SparklinePayload,
  TickerTile,
} from "@/lib/dashboard-types";

// ── Caching ──────────────────────────────────────────────────────────────
type CacheEntry = { payload: DashboardData; cachedAt: number; key: string };
const composerCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 30_000;

// ── Types ────────────────────────────────────────────────────────────────
const SPARKLINE_LOOKBACK: Record<Timeframe, number> = {
  daily: 60,
  weekly: 30,
  monthly: 24,
  yearly: 10,
};
const SPARKLINE_LABEL: Record<Timeframe, string> = {
  daily: "60D",
  weekly: "30W",
  monthly: "24M",
  yearly: "10Y",
};

// ── Public ───────────────────────────────────────────────────────────────

export async function composeDashboardPayload(
  userId: string,
  opts: { db?: DB; bypassCache?: boolean } = {},
): Promise<DashboardData> {
  const db = opts.db ?? defaultDb;

  const meta = await loadMeta(db);
  const cacheKey = `${userId}|${meta.lastScanAt ?? "never"}|${meta.watchlistCount}`;

  if (!opts.bypassCache) {
    const cached = composerCache.get(userId);
    if (
      cached &&
      cached.key === cacheKey &&
      Date.now() - cached.cachedAt < CACHE_TTL_MS
    ) {
      return cached.payload;
    }
  }

  const tickers = await loadActiveTickers(db);

  if (tickers.length === 0) {
    const empty: DashboardData = {
      hero: { type: "empty-watchlist" },
      rails: { justPrinted: [], imminent: [], watching: [] },
      meta,
    };
    composerCache.set(userId, { payload: empty, cachedAt: Date.now(), key: cacheKey });
    return empty;
  }

  // Pull all signal states for the watchlist
  const states = await loadStates(db, tickers);

  // Rank everything and bucket into rails
  const ranked = rankSignals({ states: states.states, hitRates: new Map() });
  const heroRanked = ranked[0];
  const heroScore = heroRanked?.score ?? 0;
  const usingHero =
    heroRanked != null && heroScore >= heroThreshold();

  // Tile builders need bars for sparklines (last N per ticker × timeframe).
  const tilesByTicker = new Map<string, TickerTile>();
  for (const t of tickers) {
    const tile = await buildTickerTile(
      db,
      t.ticker,
      t.tags,
      states.byTicker.get(t.ticker) ?? [],
      ranked,
      meta.lastScanAt ?? new Date().toISOString(),
    );
    if (tile) tilesByTicker.set(t.ticker, tile);
  }

  // Just-printed: any ticker whose latest setup_complete / countdown_complete
  // / signal_9_13_9 event has barDate >= mostRecentScan.startedAt. Restricted
  // to the current watchlist so accumulated signal_events from removed
  // tickers don't bleed into today's rail.
  const recentlyPrintedSet = await loadRecentlyPrinted(
    db,
    meta.lastScanAt,
    tickers.map((t) => t.ticker),
  );

  const justPrinted: TickerTile[] = [];
  const imminent: TickerTile[] = [];
  const watching: TickerTile[] = [];
  for (const tile of tilesByTicker.values()) {
    const tickerStates = states.byTicker.get(tile.ticker) ?? [];
    if (recentlyPrintedSet.has(tile.ticker)) {
      justPrinted.push(tile);
    } else if (tickerStates.some(isImminent)) {
      imminent.push(tile);
    } else {
      watching.push(tile);
    }
  }

  // Sort rails by rank desc
  for (const rail of [justPrinted, imminent, watching]) {
    rail.sort((a, b) => b.rank - a.rank);
  }

  // Build hero
  const hero: HeroPayload = usingHero
    ? buildSignalHero(heroRanked, tilesByTicker, ranked, states)
    : await buildNothingNotableHero(db, tilesByTicker, ranked);

  const payload: DashboardData = {
    hero,
    rails: { justPrinted, imminent, watching },
    meta: {
      ...meta,
      activeCount: states.activeCount,
      imminentCount: imminent.length,
      justPrintedCount: justPrinted.length,
    },
  };

  composerCache.set(userId, { payload, cachedAt: Date.now(), key: cacheKey });
  return payload;
}

export function clearDashboardCacheFor(userId: string): void {
  composerCache.delete(userId);
}

// ── Internals ────────────────────────────────────────────────────────────

async function loadMeta(db: DB): Promise<DashboardMeta> {
  const [lastScan] = await db
    .select()
    .from(scanRuns)
    .orderBy(desc(scanRuns.startedAt))
    .limit(1);
  const [tickerCount] = await db
    .select({ c: sql<number>`COUNT(*)` })
    .from(watchlistTickers)
    .where(eq(watchlistTickers.isActive, true));
  // alerts in the last 24h
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const [alertCount] = await db
    .select({ c: sql<number>`COUNT(*)` })
    .from(alertsTable)
    .where(gte(alertsTable.createdAt, since));

  return {
    watchlistCount: tickerCount?.c ?? 0,
    activeCount: 0, // computed in composer
    imminentCount: 0,
    justPrintedCount: 0,
    alerts24h: alertCount?.c ?? 0,
    lastScanAt: lastScan?.startedAt ?? null,
    lastScanTrigger: (lastScan?.trigger as DashboardMeta["lastScanTrigger"]) ?? null,
  };
}

async function loadActiveTickers(
  db: DB,
): Promise<{ ticker: string; tags: string[] }[]> {
  const rows = await db
    .select({
      ticker: watchlistTickers.ticker,
      tags: watchlistTickers.tags,
    })
    .from(watchlistTickers)
    .where(eq(watchlistTickers.isActive, true));
  // Dedup if any cross-watchlist duplicates
  const seen = new Map<string, string[]>();
  for (const r of rows) {
    if (!seen.has(r.ticker)) seen.set(r.ticker, r.tags ?? []);
  }
  return [...seen.entries()].map(([ticker, tags]) => ({ ticker, tags }));
}

interface StatesBundle {
  states: SignalStateLite[];
  byTicker: Map<string, SignalStateLite[]>;
  activeCount: number;
}

async function loadStates(db: DB, tickers: { ticker: string }[]): Promise<StatesBundle> {
  if (tickers.length === 0) {
    return { states: [], byTicker: new Map(), activeCount: 0 };
  }
  const tickerSet = tickers.map((t) => t.ticker);
  const rows = await db
    .select()
    .from(signalStatesTable)
    .where(inArray(signalStatesTable.ticker, tickerSet));
  const states: SignalStateLite[] = rows.map((r) => ({
    ticker: r.ticker,
    timeframe: r.timeframe as Timeframe,
    indicator: r.indicator as Indicator,
    direction: r.direction as Direction | null,
    phase: r.phase as "none" | "setup" | "countdown",
    count: r.count,
    isPerfected: !!r.isPerfected,
    isDeferred: !!r.isDeferred,
    asOfBarDate: r.asOfBarDate,
  }));
  const byTicker = new Map<string, SignalStateLite[]>();
  for (const s of states) {
    const arr = byTicker.get(s.ticker);
    if (arr) arr.push(s);
    else byTicker.set(s.ticker, [s]);
  }
  let activeCount = 0;
  for (const s of states) if (s.phase !== "none" && s.count > 0) activeCount += 1;
  return { states, byTicker, activeCount };
}

async function loadRecentlyPrinted(
  db: DB,
  since: string | null,
  watchlistSymbols: string[],
): Promise<Set<string>> {
  if (!since || watchlistSymbols.length === 0) return new Set();
  const rows = await db
    .select({ ticker: signalEventsTable.ticker })
    .from(signalEventsTable)
    .where(
      and(
        inArray(signalEventsTable.ticker, watchlistSymbols),
        sql`${signalEventsTable.eventType} IN ('setup_complete','countdown_complete','signal_9_13_9')`,
        gte(signalEventsTable.barDate, since.slice(0, 10)),
      ),
    );
  return new Set(rows.map((r) => r.ticker));
}

async function buildTickerTile(
  db: DB,
  ticker: string,
  tags: string[],
  states: SignalStateLite[],
  ranked: RankedSignal[],
  lastScanAt: string,
): Promise<TickerTile | null> {
  // Pick the primary badge: highest-ranked state for this ticker, or the
  // most recent state if nothing ranked.
  const tickerRanked = ranked.filter((r) => r.ticker === ticker);
  const primary = tickerRanked[0] ?? null;

  const primaryStateTimeframe: Timeframe = primary?.timeframe ?? "daily";
  const sparkBars = await loadRecentBars(
    db,
    ticker,
    primaryStateTimeframe,
    SPARKLINE_LOOKBACK[primaryStateTimeframe],
  );
  if (sparkBars.length === 0) return null;

  const lastBar = sparkBars[sparkBars.length - 1]!;
  const prevClose = sparkBars.length >= 2 ? sparkBars[sparkBars.length - 2]!.close : lastBar.close;
  const changePct = prevClose > 0 ? (lastBar.close - prevClose) / prevClose : 0;

  // Build markers from recent setup_count / setup_complete events on the
  // primary timeframe (last N bars only)
  const sparkline: SparklinePayload = {
    bars: sparkBars,
    markers: await loadSparklineMarkers(db, ticker, primaryStateTimeframe, sparkBars[0]!.date),
    lookbackLabel: SPARKLINE_LABEL[primaryStateTimeframe],
  };

  // Confluence row: one cell per timeframe — the most informative active
  // state in that timeframe (any direction; sequential or combo)
  const confluence: ConfluencePayload = {
    daily: pickConfluence(states, "daily"),
    weekly: pickConfluence(states, "weekly"),
    monthly: pickConfluence(states, "monthly"),
    yearly: pickConfluence(states, "yearly"),
  };

  // primaryBadge: derived from `primary` (ranked) OR fallback to first
  // active state by max(count) if nothing is ranked
  const fallback = states.find((s) => s.phase !== "none" && s.count > 0);
  const badgeSource = primary ?? fallback ?? states[0];
  const primaryBadge: PrimaryBadge = badgeSource
    ? {
        direction: badgeSource.direction,
        indicator: badgeSource.indicator,
        phase: badgeSource.phase as PrimaryBadge["phase"],
        count: badgeSource.count,
        max: (badgeSource.phase === "countdown" ? 13 : 9) as 9 | 13,
        isPerfected: !!(badgeSource as SignalStateLite).isPerfected,
        isDeferred: !!(badgeSource as SignalStateLite).isDeferred,
        isQualified: false,
        timeframe: badgeSource.timeframe,
      }
    : {
        direction: null,
        indicator: "sequential",
        phase: "none",
        count: 0,
        max: 9,
        isPerfected: false,
        isDeferred: false,
        isQualified: false,
        timeframe: primaryStateTimeframe,
      };

  // TDST / Risk levels for the primary tracker
  const tdstAndRisk = await loadTdstAndRisk(
    db,
    ticker,
    primaryStateTimeframe,
    primaryBadge.indicator,
    primaryBadge.direction,
    lastBar.close,
  );

  return {
    ticker,
    price: lastBar.close,
    changePct,
    tags,
    primaryBadge,
    sparkline,
    confluence,
    tdst: tdstAndRisk.tdst,
    risk: tdstAndRisk.risk,
    hitRate: null, // Phase 5 will populate
    rank: primary?.score ?? 0,
    status: "default",
    lastScanAt,
  };
}

function pickConfluence(
  states: SignalStateLite[],
  tf: Timeframe,
): ConfluenceCell | null {
  // Among states for this timeframe, pick the one with highest count
  // (and prefer countdown over setup)
  const candidates = states.filter(
    (s) => s.timeframe === tf && s.phase !== "none" && s.count > 0 && s.direction != null,
  );
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    if (a.phase !== b.phase) return a.phase === "countdown" ? -1 : 1;
    return b.count - a.count;
  });
  const c = candidates[0]!;
  return {
    direction: c.direction!,
    indicator: c.indicator,
    count: c.count,
    max: c.phase === "countdown" ? 13 : 9,
    isPerfected: c.isPerfected,
    isDeferred: c.isDeferred,
  };
}

async function loadRecentBars(
  db: DB,
  ticker: string,
  tf: Timeframe,
  limit: number,
): Promise<Bar[]> {
  const rows = await db
    .select()
    .from(barsTable)
    .where(and(eq(barsTable.ticker, ticker), eq(barsTable.timeframe, tf)))
    .orderBy(desc(barsTable.date))
    .limit(limit);
  return rows
    .map((r) => ({
      date: r.date,
      open: r.open,
      high: r.high,
      low: r.low,
      close: r.close,
      volume: r.volume ?? undefined,
    }))
    .reverse();
}

async function loadSparklineMarkers(
  db: DB,
  ticker: string,
  tf: Timeframe,
  sinceBarDate: string,
): Promise<SparklineMarker[]> {
  const rows = await db
    .select()
    .from(signalEventsTable)
    .where(
      and(
        eq(signalEventsTable.ticker, ticker),
        eq(signalEventsTable.timeframe, tf),
        sql`${signalEventsTable.eventType} IN ('setup_count','setup_complete','setup_perfected','countdown_complete','countdown_qualified','signal_9_13_9','setup_recycle','countdown_deferred')`,
        gte(signalEventsTable.barDate, sinceBarDate),
      ),
    );
  const markers: SparklineMarker[] = [];
  for (const r of rows) {
    const tone =
      r.eventType === "signal_9_13_9"
        ? r.direction === "buy"
          ? "buy-13"
          : "sell-13"
        : r.eventType === "countdown_complete" || r.eventType === "countdown_qualified"
          ? r.direction === "buy"
            ? "buy-13"
            : "sell-13"
          : r.eventType === "setup_perfected"
            ? r.direction === "buy"
              ? "buy-perfected"
              : "sell-perfected"
            : r.eventType === "countdown_deferred"
              ? "deferred"
              : r.eventType === "setup_recycle"
                ? "recycle"
                : r.direction === "buy"
                  ? "buy"
                  : "sell";
    const text =
      r.eventType === "countdown_deferred"
        ? "+"
        : r.eventType === "setup_recycle"
          ? "R"
          : r.eventType === "signal_9_13_9"
            ? "9-13-9"
            : r.count != null
              ? String(r.count)
              : r.eventType === "setup_complete"
                ? "9"
                : r.eventType === "countdown_complete"
                  ? "13"
                  : "•";
    markers.push({ barDate: r.barDate, text, tone });
  }
  return markers;
}

async function loadTdstAndRisk(
  db: DB,
  ticker: string,
  tf: Timeframe,
  indicator: Indicator,
  direction: Direction | null,
  lastClose: number,
): Promise<{ tdst?: DistanceMarker; risk?: DistanceMarker }> {
  if (!direction) return {};
  const rows = await db
    .select({ tdstLevel: signalStatesTable.tdstLevel, riskLevel: signalStatesTable.riskLevel })
    .from(signalStatesTable)
    .where(
      and(
        eq(signalStatesTable.ticker, ticker),
        eq(signalStatesTable.timeframe, tf),
        eq(signalStatesTable.indicator, indicator),
        eq(signalStatesTable.direction, direction),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return {};
  const out: { tdst?: DistanceMarker; risk?: DistanceMarker } = {};
  if (row.tdstLevel != null && lastClose > 0) {
    out.tdst = makeDistance(row.tdstLevel, lastClose);
  }
  if (row.riskLevel != null && lastClose > 0) {
    out.risk = makeDistance(row.riskLevel, lastClose);
  }
  return out;
}

function makeDistance(level: number, lastClose: number): DistanceMarker {
  const diff = (level - lastClose) / lastClose;
  return {
    price: level,
    distancePct: diff,
    side: level >= lastClose ? "above" : "below",
  };
}

function buildSignalHero(
  ranked: RankedSignal,
  tilesByTicker: Map<string, TickerTile>,
  allRanked: RankedSignal[],
  states: StatesBundle,
): HeroPayload {
  const tile = tilesByTicker.get(ranked.ticker);
  // Build TranslationInput
  const otherStates = (states.byTicker.get(ranked.ticker) ?? []).filter(
    (s) => s.timeframe !== ranked.timeframe && s.direction === ranked.direction && s.phase !== "none" && s.count > 0,
  );
  const translationInput: TranslationInput = {
    primary: {
      direction: ranked.direction,
      indicator: ranked.indicator,
      phase: ranked.phase,
      count: ranked.count,
      max: ranked.max,
      timeframe: ranked.timeframe,
      isPerfected: !!(states.byTicker.get(ranked.ticker) ?? []).find(
        (s) =>
          s.timeframe === ranked.timeframe &&
          s.indicator === ranked.indicator &&
          s.direction === ranked.direction,
      )?.isPerfected,
      isQualified: false,
      isDeferred: !!(states.byTicker.get(ranked.ticker) ?? []).find(
        (s) =>
          s.timeframe === ranked.timeframe &&
          s.indicator === ranked.indicator &&
          s.direction === ranked.direction,
      )?.isDeferred,
      isJust9_13_9: false,
    },
    confluence: otherStates.map((s) => ({
      direction: s.direction!,
      indicator: s.indicator,
      phase: s.phase as "setup" | "countdown",
      count: s.count,
      max: (s.phase === "countdown" ? 13 : 9) as 9 | 13,
      timeframe: s.timeframe,
    })),
  };
  const t = translate(translationInput);
  const factors = explainFactors(ranked);

  return {
    type: "signal",
    ticker: ranked.ticker,
    price: tile?.price ?? 0,
    changePct: tile?.changePct ?? 0,
    timeframe: ranked.timeframe,
    indicator: ranked.indicator,
    direction: ranked.direction,
    badge: badgeText(ranked, translationInput.primary.isPerfected),
    sparkline: tile?.sparkline ?? { bars: [], markers: [], lookbackLabel: "—" },
    translation: t.text,
    translationTemplateId: t.templateId,
    tdst: tile?.tdst,
    risk: tile?.risk,
    hitRate: null,
    rankingScore: Math.round(ranked.score * 10) / 10,
    rankingFactors: factors,
    approaching: null,
  };
}

async function buildNothingNotableHero(
  db: DB,
  tilesByTicker: Map<string, TickerTile>,
  ranked: RankedSignal[],
): Promise<HeroPayload> {
  // Top 3 watchlist tickers approaching threshold (count >= 5)
  const approaching = ranked
    .filter((r) => r.count >= 5)
    .slice(0, 3)
    .map((r) => tilesByTicker.get(r.ticker))
    .filter((t): t is TickerTile => t != null);

  // Last hot signal (most recent setup_complete / countdown_complete event)
  const lastHotRows = await db
    .select()
    .from(signalEventsTable)
    .where(sql`${signalEventsTable.eventType} IN ('setup_complete','countdown_complete','signal_9_13_9')`)
    .orderBy(desc(signalEventsTable.barDate))
    .limit(1);
  const lastHot = lastHotRows[0]
    ? {
        ticker: lastHotRows[0].ticker,
        direction: (lastHotRows[0].direction ?? "buy") as Direction,
        indicator: lastHotRows[0].indicator as Indicator,
        timeframe: lastHotRows[0].timeframe as Timeframe,
        eventType: lastHotRows[0].eventType,
        daysAgo: daysBetween(lastHotRows[0].barDate, new Date().toISOString().slice(0, 10)),
      }
    : null;

  return {
    type: "nothing-notable",
    approaching,
    lastHotSignal: lastHot,
  };
}

function badgeText(r: RankedSignal, isPerfected: boolean): string {
  const dir = r.direction === "buy" ? "Buy" : "Sell";
  const word = r.phase === "setup" ? "Setup" : "Countdown";
  const perfTag = isPerfected ? " perfected" : "";
  return `${dir} ${word} ${r.count}/${r.max}${perfTag}`;
}

function daysBetween(a: string, b: string): number {
  const ad = new Date(a).getTime();
  const bd = new Date(b).getTime();
  return Math.max(0, Math.round((bd - ad) / (24 * 3600_000)));
}

export const HERO_THRESHOLD = HERO_THRESHOLD_DEFAULT;
