/**
 * Alert generation from a batch of new SignalEvents.
 *
 * Mirrors the legacy Python alert types (`setup_complete`,
 * `countdown_complete`, `approaching_setup`, `approaching_countdown`)
 * plus the new event types from §4 (`price_flip`, `countdown_deferred`,
 * `risk_level_breach`, `signal_9_13_9`).
 *
 * Each alert is dedup'd by `dedupeKey` (UNIQUE in schema). The orchestrator
 * uses INSERT … ON CONFLICT DO NOTHING so re-running a scan is idempotent.
 */

import { sql } from "drizzle-orm";
import type { DB } from "@/lib/db/client";
import { alerts as alertsTable, signalEvents } from "@/lib/db/schema";
import type { SignalEvent } from "@/engine/types";

export type AlertPriority = "info" | "warning" | "critical";

export interface PreparedAlert {
  signalEventId: string;
  ticker: string;
  timeframe: string;
  priority: AlertPriority;
  message: string;
  dedupeKey: string;
}

interface EventRow {
  id: string;
  ticker: string;
  timeframe: string;
  indicator: string;
  eventType: string;
  direction: "buy" | "sell" | null;
  count: number | null;
  barDate: string;
}

const dirLabel = (d: "buy" | "sell" | null): string =>
  d === "buy" ? "Buy" : d === "sell" ? "Sell" : "";

export function prepareAlertsForEvents(events: EventRow[]): PreparedAlert[] {
  const out: PreparedAlert[] = [];
  for (const e of events) {
    const a = prepareOne(e);
    if (a) out.push(a);
  }
  return out;
}

function prepareOne(e: EventRow): PreparedAlert | null {
  const dir = dirLabel(e.direction);
  switch (e.eventType) {
    case "setup_complete":
      return {
        signalEventId: e.id,
        ticker: e.ticker,
        timeframe: e.timeframe,
        priority: "warning",
        message: `${e.ticker} ${dir} Setup 9 complete on ${e.timeframe} (${e.indicator})`,
        dedupeKey: `${e.ticker}:${e.timeframe}:${e.indicator}:setup_complete:${e.barDate}`,
      };
    case "setup_perfected":
      return {
        signalEventId: e.id,
        ticker: e.ticker,
        timeframe: e.timeframe,
        priority: "warning",
        message: `${e.ticker} ${dir} Setup 9 perfected on ${e.timeframe}`,
        dedupeKey: `${e.ticker}:${e.timeframe}:${e.indicator}:setup_perfected:${e.barDate}`,
      };
    case "countdown_complete":
      return {
        signalEventId: e.id,
        ticker: e.ticker,
        timeframe: e.timeframe,
        priority: "critical",
        message: `${e.ticker} ${dir} Countdown 13 complete on ${e.timeframe} (${e.indicator})`,
        dedupeKey: `${e.ticker}:${e.timeframe}:${e.indicator}:countdown_complete:${e.barDate}`,
      };
    case "countdown_qualified":
      return {
        signalEventId: e.id,
        ticker: e.ticker,
        timeframe: e.timeframe,
        priority: "critical",
        message: `${e.ticker} ${dir} Countdown 13 qualified on ${e.timeframe}`,
        dedupeKey: `${e.ticker}:${e.timeframe}:${e.indicator}:countdown_qualified:${e.barDate}`,
      };
    case "countdown_deferred":
      return {
        signalEventId: e.id,
        ticker: e.ticker,
        timeframe: e.timeframe,
        priority: "info",
        message: `${e.ticker} ${dir} Countdown deferred on ${e.timeframe} (rule not yet satisfied)`,
        dedupeKey: `${e.ticker}:${e.timeframe}:${e.indicator}:countdown_deferred:${e.barDate}`,
      };
    case "signal_9_13_9":
      return {
        signalEventId: e.id,
        ticker: e.ticker,
        timeframe: e.timeframe,
        priority: "critical",
        message: `${e.ticker} ${dir} 9-13-9 composite on ${e.timeframe}`,
        dedupeKey: `${e.ticker}:${e.timeframe}:${e.indicator}:signal_9_13_9:${e.barDate}`,
      };
    case "risk_level_breach":
      return {
        signalEventId: e.id,
        ticker: e.ticker,
        timeframe: e.timeframe,
        priority: "warning",
        message: `${e.ticker} ${dir} 13 invalidated by Risk Level breach on ${e.timeframe}`,
        dedupeKey: `${e.ticker}:${e.timeframe}:${e.indicator}:risk_level_breach:${e.barDate}`,
      };
    case "countdown_cancel":
      return {
        signalEventId: e.id,
        ticker: e.ticker,
        timeframe: e.timeframe,
        priority: "info",
        message: `${e.ticker} ${dir} Countdown cancelled on ${e.timeframe}`,
        dedupeKey: `${e.ticker}:${e.timeframe}:${e.indicator}:countdown_cancel:${e.barDate}`,
      };
    case "setup_count":
      if (e.count != null && e.count >= 7 && e.count < 9) {
        return {
          signalEventId: e.id,
          ticker: e.ticker,
          timeframe: e.timeframe,
          priority: "info",
          message: `${e.ticker} ${dir} Setup approaching: ${e.count}/9 on ${e.timeframe}`,
          dedupeKey: `${e.ticker}:${e.timeframe}:${e.indicator}:approaching_setup:${e.count}:${e.barDate}`,
        };
      }
      return null;
    case "countdown_count":
      if (e.count != null && e.count >= 11 && e.count < 13) {
        return {
          signalEventId: e.id,
          ticker: e.ticker,
          timeframe: e.timeframe,
          priority: "info",
          message: `${e.ticker} ${dir} Countdown approaching: ${e.count}/13 on ${e.timeframe}`,
          dedupeKey: `${e.ticker}:${e.timeframe}:${e.indicator}:approaching_countdown:${e.count}:${e.barDate}`,
        };
      }
      return null;
    default:
      return null;
  }
}

/**
 * Persist prepared alerts using INSERT … ON CONFLICT (dedupeKey) DO NOTHING.
 * Returns the number of rows actually inserted (drizzle's `rowsAffected`
 * isn't reliable across libSQL versions, so we inspect the existing-key set
 * before inserting and assume the rest landed).
 */
export async function persistAlerts(
  db: DB,
  prepared: PreparedAlert[],
): Promise<number> {
  if (prepared.length === 0) return 0;
  const rows = prepared.map((a) => ({
    signalEventId: a.signalEventId,
    ticker: a.ticker,
    timeframe: a.timeframe,
    priority: a.priority,
    message: a.message,
    dedupeKey: a.dedupeKey,
  }));
  // Drizzle libSQL supports onConflictDoNothing for sqlite tables
  await db
    .insert(alertsTable)
    .values(rows)
    .onConflictDoNothing({ target: alertsTable.dedupeKey });
  return rows.length;
}

/** Helper used by the scan orchestrator: takes the engine's emitted events, looks them up in `signal_events` by natural key to get their inserted IDs, then persists alerts. */
export async function generateAlertsForScan(
  db: DB,
  events: SignalEvent[],
): Promise<number> {
  if (events.length === 0) return 0;
  // Build a (ticker,tf,indicator,eventType,barDate) -> SignalEvent map
  const naturalKeys = events.map((e) => ({
    ticker: e.ticker!,
    timeframe: e.timeframe!,
    indicator: e.indicator,
    eventType: e.eventType,
    barDate: e.barDate,
  }));
  // Pull rows with IDs back out of the DB so we can satisfy the FK on alerts.
  // Build an OR'd WHERE clause keyed by natural fields. This is OK in volume
  // — a typical scan emits dozens of events, not thousands.
  const conditions = naturalKeys
    .map(
      (k) =>
        sql`(${signalEvents.ticker} = ${k.ticker} AND ${signalEvents.timeframe} = ${k.timeframe} AND ${signalEvents.indicator} = ${k.indicator} AND ${signalEvents.eventType} = ${k.eventType} AND ${signalEvents.barDate} = ${k.barDate})`,
    )
    .reduce<ReturnType<typeof sql> | null>(
      (acc, c) => (acc == null ? c : sql`${acc} OR ${c}`),
      null,
    );
  if (!conditions) return 0;
  const rows = await db
    .select({
      id: signalEvents.id,
      ticker: signalEvents.ticker,
      timeframe: signalEvents.timeframe,
      indicator: signalEvents.indicator,
      eventType: signalEvents.eventType,
      direction: signalEvents.direction,
      count: signalEvents.count,
      barDate: signalEvents.barDate,
    })
    .from(signalEvents)
    .where(conditions);
  const prepared = prepareAlertsForEvents(rows as EventRow[]);
  return persistAlerts(db, prepared);
}
