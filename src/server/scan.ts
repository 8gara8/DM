/**
 * Scan orchestrator.
 *
 * For each (ticker × timeframe) pair:
 *   1. Fetch missing daily bars from the data provider.
 *   2. Persist new bars to the `bars` cache.
 *   3. Resample (no-op for daily) and feed the resampled bars to a
 *      DeMarkEngine instance restored from the persisted snapshot
 *      (or fresh if no snapshot exists / configHash mismatched).
 *   4. Upsert one row per (ticker, timeframe, indicator) in `signal_states`.
 *   5. Insert new SignalEvents (deduped on natural key by an OR'd
 *      pre-existence query — sqlite has no true upsert across columns).
 *   6. Persist alerts via `generateAlertsForScan`.
 *
 * Concurrency: capped at 4 in-flight tickers per scan to keep us under
 * yahoo-finance2's effective rate limit and Vercel's serverless CPU budget.
 *
 * Resilience: a per-ticker error never aborts the whole scan; the error is
 * appended to `scan_runs.errors` and the scan moves on. Final scan_runs row
 * carries `tickersAttempted` / `tickersSucceeded`.
 */

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db as defaultDb, type DB } from "@/lib/db/client";
import {
  bars as barsTable,
  signalEvents as signalEventsTable,
  signalStates as signalStatesTable,
  scanRuns,
  watchlistTickers,
  watchlists,
} from "@/lib/db/schema";
import { DeMarkEngine } from "@/engine";
import type {
  Bar,
  DirectionalSnapshot,
  EngineSnapshot,
  Indicator,
  SignalEvent,
  Timeframe,
} from "@/engine/types";
import { resolveConfig } from "@/engine/config";
import { resample } from "@/data/resample";
import { getDataProvider } from "@/data/provider";
import { generateAlertsForScan } from "./alerts";

const ALL_TIMEFRAMES: Timeframe[] = ["daily", "weekly", "monthly", "yearly"];
const DEFAULT_CONCURRENCY = 4;

export interface RunScanOptions {
  tickers?: string[];
  timeframes?: Timeframe[];
  trigger: "cron" | "manual" | "add-ticker";
  triggeredBy?: string | null;
  concurrency?: number;
  /** Override DB for tests. */
  db?: DB;
}

export interface ScanResult {
  scanRunId: string;
  tickersAttempted: number;
  tickersSucceeded: number;
  errors: { ticker: string; message: string }[];
}

/** Public entry point. */
export async function runScan(opts: RunScanOptions): Promise<ScanResult> {
  const db = opts.db ?? defaultDb;
  const trigger = opts.trigger;
  const concurrency = opts.concurrency ?? DEFAULT_CONCURRENCY;
  const timeframes = opts.timeframes ?? ALL_TIMEFRAMES;

  const tickers =
    opts.tickers && opts.tickers.length > 0
      ? opts.tickers.map((t) => t.toUpperCase())
      : await listActiveWatchlistTickers(db);

  // Create scan_runs row
  const [run] = await db
    .insert(scanRuns)
    .values({
      trigger,
      triggeredBy: opts.triggeredBy ?? null,
      tickersAttempted: tickers.length,
      tickersSucceeded: 0,
      errors: [],
    })
    .returning({ id: scanRuns.id });
  if (!run) throw new Error("scan: failed to create scan_runs row");
  const scanRunId = run.id;

  const errors: { ticker: string; message: string }[] = [];
  let succeeded = 0;

  // Run with bounded concurrency
  const queue = [...tickers];
  const inFlight: Promise<void>[] = [];
  const startNext = (): void => {
    const t = queue.shift();
    if (!t) return;
    const p = scanOneTicker(db, t, timeframes)
      .then(() => {
        succeeded += 1;
      })
      .catch((e) => {
        const msg = e instanceof Error ? e.message : String(e);
        errors.push({ ticker: t, message: msg });
        console.error(`[scan] ${t} failed:`, msg);
      })
      .finally(() => {
        startNext();
      });
    inFlight.push(p);
  };
  for (let i = 0; i < Math.min(concurrency, queue.length); i++) startNext();
  await Promise.all(inFlight);
  // Drain any tail tasks the recursive startNext spawned
  // (Promise.all on the original list is not enough — it only waits for the first wave)
  // We loop until both queue is empty AND every promise has resolved.
  // The simplest correct approach: serialize the wait.
  while (inFlight.length > 0) {
    const remaining = inFlight.splice(0);
    await Promise.all(remaining);
  }

  await db
    .update(scanRuns)
    .set({
      finishedAt: new Date().toISOString(),
      tickersSucceeded: succeeded,
      errors,
    })
    .where(eq(scanRuns.id, scanRunId));

  return { scanRunId, tickersAttempted: tickers.length, tickersSucceeded: succeeded, errors };
}

async function listActiveWatchlistTickers(db: DB): Promise<string[]> {
  const rows = await db
    .select({ ticker: watchlistTickers.ticker })
    .from(watchlistTickers)
    .where(eq(watchlistTickers.isActive, true));
  return [...new Set(rows.map((r) => r.ticker.toUpperCase()))];
}

/** Scan a single ticker across the requested timeframes. */
export async function scanOneTicker(
  db: DB,
  ticker: string,
  timeframes: Timeframe[],
): Promise<void> {
  const config = resolveConfig({});
  // 1. Determine `fromDate` for the daily fetch — based on the latest
  //    cached daily bar for this ticker. If none, fetch full history.
  const lastDaily = await db
    .select({ date: barsTable.date })
    .from(barsTable)
    .where(and(eq(barsTable.ticker, ticker), eq(barsTable.timeframe, "daily")))
    .orderBy(desc(barsTable.date))
    .limit(1);
  const fromDate = lastDaily[0]?.date;

  // 2. Fetch daily bars
  const provider = getDataProvider();
  const fetched = await provider.fetchDailyBars(ticker, fromDate);
  if (fetched.length === 0 && !fromDate) {
    throw new Error(`provider returned no bars for ${ticker}`);
  }

  // 3. Persist new daily bars (upsert by PK)
  if (fetched.length > 0) {
    const fetchedAt = new Date().toISOString();
    const rows = fetched.map((b) => ({
      ticker,
      timeframe: "daily" as const,
      date: b.date,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
      volume: b.volume ?? null,
      fetchedAt,
    }));
    // Insert in batches (libSQL has parameter limits)
    const BATCH = 200;
    for (let i = 0; i < rows.length; i += BATCH) {
      await db
        .insert(barsTable)
        .values(rows.slice(i, i + BATCH))
        .onConflictDoUpdate({
          target: [barsTable.ticker, barsTable.timeframe, barsTable.date],
          set: {
            open: sql`excluded.open`,
            high: sql`excluded.high`,
            low: sql`excluded.low`,
            close: sql`excluded.close`,
            volume: sql`excluded.volume`,
            fetchedAt: sql`excluded."fetchedAt"`,
          },
        });
    }
  }

  // 4. For each requested timeframe, replay engine and persist state/events.
  // Always pull the FULL bar series for the timeframe — engine snapshots
  // restore in O(1) but we need bars[lastBarIndex+1..] to feed `process()`.
  const allDaily = await db
    .select()
    .from(barsTable)
    .where(and(eq(barsTable.ticker, ticker), eq(barsTable.timeframe, "daily")))
    .orderBy(barsTable.date);
  const dailyBars: Bar[] = allDaily.map((r) => ({
    date: r.date,
    open: r.open,
    high: r.high,
    low: r.low,
    close: r.close,
    volume: r.volume ?? undefined,
  }));

  for (const tf of timeframes) {
    const tfBars = tf === "daily" ? dailyBars : resample(dailyBars, tf);
    if (tfBars.length === 0) continue;

    // Persist resampled bars (skip daily — already persisted above)
    if (tf !== "daily") {
      await persistResampledBars(db, ticker, tf, tfBars);
    }

    // Try to restore engine from any persisted snapshot. We pull the
    // sequential-buy row (any row works — they share the snapshot since
    // we serialize the whole engine at once).
    const stored = await db
      .select({
        engineStateJson: signalStatesTable.engineStateJson,
        configHash: signalStatesTable.configHash,
        asOfBarDate: signalStatesTable.asOfBarDate,
      })
      .from(signalStatesTable)
      .where(
        and(
          eq(signalStatesTable.ticker, ticker),
          eq(signalStatesTable.timeframe, tf),
          eq(signalStatesTable.indicator, "sequential"),
          eq(signalStatesTable.direction, "buy"),
        ),
      )
      .limit(1);
    const storedSnapshotMeta = stored[0] ?? null;

    // We currently only persist DirectionalSnapshot in engineStateJson per
    // (indicator, direction). Building a full EngineSnapshot from 4 rows
    // would require reading composite watchers and flip state we don't
    // store yet. For Phase 3 we take the simple route: replay from scratch
    // each scan. Engine over 5y of daily = ~1250 bars; runtime is low.
    // (When this becomes a hotspot, persist the full EngineSnapshot in a
    // dedicated `engine_snapshots` table keyed by (ticker, tf, configHash).)
    void storedSnapshotMeta;

    const engine = new DeMarkEngine(config);
    const engineEvents: SignalEvent[] = [];
    for (let i = 0; i < tfBars.length; i++) {
      const r = engine.process(tfBars, i);
      // Annotate every event with ticker/timeframe (engine emits without)
      for (const ev of r.events) {
        engineEvents.push({ ...ev, ticker, timeframe: tf });
      }
    }

    // Upsert 4 signal_states rows (sequential×{buy,sell}, combo×{buy,sell})
    const snapshot: EngineSnapshot = engine.serialize();
    const lastBar = tfBars[tfBars.length - 1]!;
    const updatedAt = new Date().toISOString();
    for (const t of snapshot.trackers) {
      await upsertSignalState(db, {
        ticker,
        timeframe: tf,
        snapshot: t,
        configHash: config.configHash,
        asOfBarDate: lastBar.date,
        updatedAt,
      });
    }

    // Insert new signal events (dedup by natural key)
    if (engineEvents.length > 0) {
      await insertNewSignalEvents(db, engineEvents);
      // Generate alerts only for events on the LAST bar
      // (the "right edge" — we don't fire alerts on historical events)
      const lastBarEvents = engineEvents.filter((e) => e.barDate === lastBar.date);
      if (lastBarEvents.length > 0) {
        await generateAlertsForScan(db, lastBarEvents);
      }
    }
  }
}

async function persistResampledBars(
  db: DB,
  ticker: string,
  tf: Timeframe,
  bars: Bar[],
): Promise<void> {
  if (bars.length === 0) return;
  const fetchedAt = new Date().toISOString();
  const rows = bars.map((b) => ({
    ticker,
    timeframe: tf,
    date: b.date,
    open: b.open,
    high: b.high,
    low: b.low,
    close: b.close,
    volume: b.volume ?? null,
    fetchedAt,
  }));
  const BATCH = 200;
  for (let i = 0; i < rows.length; i += BATCH) {
    await db
      .insert(barsTable)
      .values(rows.slice(i, i + BATCH))
      .onConflictDoUpdate({
        target: [barsTable.ticker, barsTable.timeframe, barsTable.date],
        set: {
          open: sql`excluded.open`,
          high: sql`excluded.high`,
          low: sql`excluded.low`,
          close: sql`excluded.close`,
          volume: sql`excluded.volume`,
          fetchedAt: sql`excluded."fetchedAt"`,
        },
      });
  }
}

async function upsertSignalState(
  db: DB,
  args: {
    ticker: string;
    timeframe: Timeframe;
    snapshot: DirectionalSnapshot;
    configHash: string;
    asOfBarDate: string;
    updatedAt: string;
  },
): Promise<void> {
  const s = args.snapshot;
  const phase: "none" | "setup" | "countdown" =
    s.countdownActive || s.countdownComplete
      ? "countdown"
      : s.setupCount > 0 || s.setupCompleted
        ? "setup"
        : "none";
  const count = phase === "countdown" ? s.countdownCount : s.setupCount;

  const row = {
    ticker: args.ticker,
    timeframe: args.timeframe,
    indicator: s.indicator as Indicator,
    direction: s.direction,
    phase,
    count,
    isPerfected: !!s.setupPerfected,
    isDeferred: !!s.countdownDeferred,
    countdownBar8Close: s.countdownBar8Close ?? null,
    tdstLevel: s.tdstLevel ?? null,
    tdstAnchorBarDate: s.tdstAnchorBarDate ?? null,
    riskLevel: s.riskLevel ?? null,
    barsSince9: s.barsSince9 ?? null,
    barsSince13: s.barsSince13 ?? null,
    configHash: args.configHash,
    engineStateJson: s,
    asOfBarDate: args.asOfBarDate,
    updatedAt: args.updatedAt,
  };

  await db
    .insert(signalStatesTable)
    .values(row)
    .onConflictDoUpdate({
      target: [
        signalStatesTable.ticker,
        signalStatesTable.timeframe,
        signalStatesTable.indicator,
      ],
      set: {
        direction: row.direction,
        phase: row.phase,
        count: row.count,
        isPerfected: row.isPerfected,
        isDeferred: row.isDeferred,
        countdownBar8Close: row.countdownBar8Close,
        tdstLevel: row.tdstLevel,
        tdstAnchorBarDate: row.tdstAnchorBarDate,
        riskLevel: row.riskLevel,
        barsSince9: row.barsSince9,
        barsSince13: row.barsSince13,
        configHash: row.configHash,
        engineStateJson: row.engineStateJson,
        asOfBarDate: row.asOfBarDate,
        updatedAt: row.updatedAt,
      },
    });
}

async function insertNewSignalEvents(
  db: DB,
  events: SignalEvent[],
): Promise<void> {
  if (events.length === 0) return;
  // Look up existing natural keys for this ticker so we can skip duplicates.
  // Group by ticker for the IN query.
  const byTicker = new Map<string, SignalEvent[]>();
  for (const e of events) {
    const arr = byTicker.get(e.ticker!);
    if (arr) arr.push(e);
    else byTicker.set(e.ticker!, [e]);
  }
  for (const [ticker, list] of byTicker) {
    const dates = [...new Set(list.map((e) => e.barDate))];
    const existing = await db
      .select({
        ticker: signalEventsTable.ticker,
        timeframe: signalEventsTable.timeframe,
        indicator: signalEventsTable.indicator,
        eventType: signalEventsTable.eventType,
        barDate: signalEventsTable.barDate,
      })
      .from(signalEventsTable)
      .where(
        and(
          eq(signalEventsTable.ticker, ticker),
          inArray(signalEventsTable.barDate, dates),
        ),
      );
    const seen = new Set(
      existing.map(
        (r) => `${r.ticker}|${r.timeframe}|${r.indicator}|${r.eventType}|${r.barDate}`,
      ),
    );
    const rows = list
      .filter(
        (e) =>
          !seen.has(
            `${e.ticker}|${e.timeframe}|${e.indicator}|${e.eventType}|${e.barDate}`,
          ),
      )
      .map((e) => ({
        ticker: e.ticker!,
        timeframe: e.timeframe!,
        indicator: e.indicator,
        eventType: e.eventType,
        direction: e.direction,
        count: e.count,
        barDate: e.barDate,
        firstKnownAtDate: e.firstKnownAtDate,
        configHash: e.configHash,
        meta: e.meta ?? null,
      }));
    if (rows.length === 0) continue;
    const BATCH = 200;
    for (let i = 0; i < rows.length; i += BATCH) {
      await db.insert(signalEventsTable).values(rows.slice(i, i + BATCH));
    }
  }
}

/** Bootstrap the default watchlist if none exists. Used by routes that need a "current watchlist" to attach to. */
export async function getOrCreateDefaultWatchlist(db: DB): Promise<string> {
  const rows = await db.select({ id: watchlists.id }).from(watchlists).limit(1);
  if (rows.length > 0) return rows[0]!.id;
  const [created] = await db
    .insert(watchlists)
    .values({ name: "default" })
    .returning({ id: watchlists.id });
  if (!created) throw new Error("scan: failed to create default watchlist");
  return created.id;
}

/** Recent scan runs, ordered by startedAt desc. */
export async function recentScans(db: DB, limit = 20, offset = 0) {
  const rows = await db
    .select()
    .from(scanRuns)
    .orderBy(desc(scanRuns.startedAt))
    .limit(limit)
    .offset(offset);
  const totalRows = await db.select({ c: sql<number>`COUNT(*)` }).from(scanRuns);
  const total = totalRows[0]?.c ?? 0;
  return { rows, total };
}

export async function scanRunById(db: DB, id: string) {
  const rows = await db.select().from(scanRuns).where(eq(scanRuns.id, id)).limit(1);
  return rows[0] ?? null;
}

export const _internalScan = { ALL_TIMEFRAMES };
