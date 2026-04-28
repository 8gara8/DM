/**
 * Hero history tracking — wires daysAsHero decay into the ranking system.
 *
 * Schema (from phase3/drizzle/0000_stale_wong.sql, table `hero_history`):
 *   userId, date (YYYY-MM-DD), ticker, timeframe, indicator
 *   PK (userId, date) — at most one hero per user per day
 *   ticker / timeframe / indicator are NOT NULL, so we don't record "no hero today"
 *   rows; absence of a row implicitly resets the streak.
 *
 * Responsibilities:
 *   1. recordTodaysHero(): upsert when there IS a hero; no-op when null.
 *   2. daysAsHeroFor(): pre-load the last ~30 rows for a user and return
 *      a synchronous (ticker, tf, indicator) → number lookup that counts
 *      consecutive prior days (ending yesterday) the same hero held.
 *      A gap (no row) or a different (ticker, tf, indicator) breaks the streak.
 *
 * Phase 3 left this as a known gap. This module makes it minimal + surgical.
 */

import { eq, desc } from "drizzle-orm";
import type { DB } from "@/lib/db/client";
import { heroHistory } from "@/lib/db/schema";
import type { Indicator, Timeframe } from "@/engine/types";

export interface HeroIdentifier {
  ticker: string;
  timeframe: Timeframe;
  indicator: Indicator;
}

/**
 * Upsert today's hero into hero_history. No-op when hero is null
 * (the schema doesn't permit null ticker; missing rows == "no hero").
 */
export async function recordTodaysHero(
  db: DB,
  userId: string,
  hero: HeroIdentifier | null,
  today: string,
): Promise<void> {
  if (hero === null) return;
  await db
    .insert(heroHistory)
    .values({
      userId,
      date: today,
      ticker: hero.ticker,
      timeframe: hero.timeframe,
      indicator: hero.indicator,
    })
    .onConflictDoUpdate({
      target: [heroHistory.userId, heroHistory.date],
      set: {
        ticker: hero.ticker,
        timeframe: hero.timeframe,
        indicator: hero.indicator,
      },
    });
}

/**
 * Load the last ~30 days of hero_history for a user and return a sync
 * lookup that counts consecutive days the hero was the same
 * (ticker, tf, indicator), ending yesterday.
 *
 * Used by rankSignals to compute recencyDecay = max(0, 1 - 0.1 * days).
 */
export async function daysAsHeroFor(
  db: DB,
  userId: string,
  today: string,
): Promise<(ticker: string, timeframe: Timeframe, indicator: Indicator) => number> {
  const rows = await db
    .select()
    .from(heroHistory)
    .where(eq(heroHistory.userId, userId))
    .orderBy(desc(heroHistory.date))
    .limit(30);

  // dateStr → hero record
  const heroByDate = new Map<
    string,
    { ticker: string; timeframe: string; indicator: string }
  >();
  for (const row of rows) {
    heroByDate.set(row.date, {
      ticker: row.ticker,
      timeframe: row.timeframe,
      indicator: row.indicator,
    });
  }

  return (ticker: string, timeframe: Timeframe, indicator: Indicator): number => {
    let count = 0;
    // walk back from yesterday
    const cursor = new Date(today + "T00:00:00Z");
    cursor.setUTCDate(cursor.getUTCDate() - 1);

    while (count < 30) {
      const dateStr = cursor.toISOString().split("T")[0]!;
      const stored = heroByDate.get(dateStr);
      if (
        !stored ||
        stored.ticker !== ticker ||
        stored.timeframe !== timeframe ||
        stored.indicator !== indicator
      ) {
        break;
      }
      count += 1;
      cursor.setUTCDate(cursor.getUTCDate() - 1);
    }
    return count;
  };
}
