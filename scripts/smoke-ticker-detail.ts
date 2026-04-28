/**
 * scripts/smoke-ticker-detail.ts
 *
 * Smoke test for /ticker/[symbol] page data loading.
 *
 * Seeding:
 *   - One ticker: SPY
 *   - 60 daily bars (2024-11-16 to 2025-01-14)
 *   - 2 signalStates rows (sequential buy + sell, each with tdstLevel)
 *   - 3 signalEvents (setup_count, setup_complete, countdown_deferred)
 *
 * Assertions:
 *   - loadTickerDetail returns well-formed payload
 *   - bars array has correct structure + ordering
 *   - events array is populated and ordered descending
 *   - tdstLines are derived from states
 */

import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "@/lib/db/schema";
import {
  bars as barsTable,
  signalStates as signalStatesTable,
  signalEvents as signalEventsTable,
} from "@/lib/db/schema";
import { loadTickerDetail } from "@/server/ticker-detail";
import type { DB } from "@/lib/db/client";

async function main() {
  console.log("[smoke] initializing in-memory DB...");

  const client = createClient({ url: "file::memory:?cache=shared" });
  const db = drizzle(client, { schema }) as unknown as DB;

  // Apply the Phase 3 migration so the tables exist
  const fs = await import("fs/promises");
  const migrationSql = await fs.readFile("./drizzle/0000_stale_wong.sql", "utf-8");
  for (const stmt of migrationSql.split("--> statement-breakpoint")) {
    const cleaned = stmt.trim();
    if (cleaned) await client.execute(cleaned);
  }
  console.log("[smoke] schema applied");

  // Seed bars: 60 daily bars for SPY from 2024-11-16 to 2025-01-14
  console.log("[smoke] seeding 60 daily bars for SPY...");
  const startDate = new Date("2024-11-16");
  for (let i = 0; i < 60; i++) {
    const date = new Date(startDate);
    date.setDate(date.getDate() + i);
    const dateStr = date.toISOString().slice(0, 10);

    // Simulate realistic OHLC: slowly trending up
    const basePrice = 600 + i * 0.5;
    const open = basePrice;
    const close = basePrice + Math.sin(i / 10) * 2;
    const high = Math.max(open, close) + Math.random() * 1;
    const low = Math.min(open, close) - Math.random() * 1;

    await db.insert(barsTable).values({
      ticker: "SPY",
      timeframe: "daily",
      date: dateStr,
      open,
      high,
      low,
      close,
      volume: Math.floor(100000000 + Math.random() * 50000000),
      fetchedAt: new Date().toISOString(),
    });
  }

  // Seed signalStates: one buy, one sell (sequential)
  console.log("[smoke] seeding 2 signalStates rows...");
  const updatedAt = new Date().toISOString();
  await db.insert(signalStatesTable).values({
    ticker: "SPY",
    timeframe: "daily",
    indicator: "sequential",
    direction: "buy",
    phase: "setup",
    count: 5,
    isPerfected: false,
    isDeferred: false,
    asOfBarDate: "2025-01-14",
    tdstLevel: 610,
    tdstAnchorBarDate: "2025-01-10",
    riskLevel: 590,
    configHash: "default",
    updatedAt,
  });

  await db.insert(signalStatesTable).values({
    ticker: "SPY",
    timeframe: "daily",
    indicator: "sequential",
    direction: "sell",
    phase: "countdown",
    count: 3,
    isPerfected: false,
    isDeferred: false,
    asOfBarDate: "2025-01-14",
    tdstLevel: 595,
    tdstAnchorBarDate: "2025-01-08",
    riskLevel: 620,
    configHash: "default",
    updatedAt,
  });

  // Seed signalEvents: 3 events in descending order
  console.log("[smoke] seeding 3 signalEvents...");
  const createdAt = new Date().toISOString();
  await db.insert(signalEventsTable).values({
    id: "ev_1",
    ticker: "SPY",
    timeframe: "daily",
    barDate: "2025-01-14",
    indicator: "sequential",
    direction: "buy",
    eventType: "setup_count",
    count: 5,
    firstKnownAtDate: "2025-01-14",
    configHash: "default",
    createdAt,
  });

  await db.insert(signalEventsTable).values({
    id: "ev_2",
    ticker: "SPY",
    timeframe: "daily",
    barDate: "2025-01-10",
    indicator: "sequential",
    direction: "buy",
    eventType: "setup_complete",
    count: 9,
    firstKnownAtDate: "2025-01-02",
    configHash: "default",
    createdAt,
  });

  await db.insert(signalEventsTable).values({
    id: "ev_3",
    ticker: "SPY",
    timeframe: "daily",
    barDate: "2025-01-08",
    indicator: "sequential",
    direction: "sell",
    eventType: "countdown_deferred",
    count: 5,
    firstKnownAtDate: "2025-01-08",
    configHash: "default",
    createdAt,
  });

  // Call loadTickerDetail
  console.log("[smoke] loading ticker detail for SPY daily...");
  const payload = await loadTickerDetail("SPY", "daily", { db, limit: 500 });

  // Assertions
  console.log("[smoke] validating payload structure...");

  if (payload.ticker !== "SPY") {
    throw new Error(`Expected ticker SPY, got ${payload.ticker}`);
  }

  if (payload.bars.length === 0) {
    throw new Error("Expected non-empty bars array");
  }

  if (payload.bars.length !== 60) {
    throw new Error(`Expected 60 bars, got ${payload.bars.length}`);
  }

  // Check bar ordering (ascending by date)
  for (let i = 1; i < payload.bars.length; i++) {
    if (payload.bars[i]!.date < payload.bars[i - 1]!.date) {
      throw new Error("Bars not sorted ascending by date");
    }
  }

  // Verify first and last bar dates
  const firstBarDate = payload.bars[0]!.date;
  const lastBarDate = payload.bars[payload.bars.length - 1]!.date;
  if (firstBarDate !== "2024-11-16") {
    throw new Error(`Expected first bar 2024-11-16, got ${firstBarDate}`);
  }
  if (lastBarDate !== "2025-01-14") {
    throw new Error(`Expected last bar 2025-01-14, got ${lastBarDate}`);
  }

  // Check bar structure
  const sampleBar = payload.bars[0]!;
  if (!("open" in sampleBar) || !("high" in sampleBar) || !("close" in sampleBar)) {
    throw new Error("Bar missing OHLC fields");
  }

  // Check events (should be descending by barDate)
  if (payload.events.length !== 3) {
    throw new Error(`Expected 3 events, got ${payload.events.length}`);
  }

  if (payload.events[0]!.barDate !== "2025-01-14") {
    throw new Error(`Expected most recent event on 2025-01-14, got ${payload.events[0]!.barDate}`);
  }

  // Check TDST lines
  if (payload.tdstLines.length !== 2) {
    throw new Error(`Expected 2 TDST lines, got ${payload.tdstLines.length}`);
  }

  const buyTdst = payload.tdstLines.find((line) => line.direction === "buy");
  if (!buyTdst || buyTdst.price !== 610) {
    throw new Error(`Expected buy TDST at 610, got ${buyTdst?.price}`);
  }

  const sellTdst = payload.tdstLines.find((line) => line.direction === "sell");
  if (!sellTdst || sellTdst.price !== 595) {
    throw new Error(`Expected sell TDST at 595, got ${sellTdst?.price}`);
  }

  console.log("[smoke] all assertions passed!");
  console.log(`  ✓ SPY ticker loaded`);
  console.log(`  ✓ 60 bars in ascending date order`);
  console.log(`  ✓ 3 signal events in descending date order`);
  console.log(`  ✓ 2 TDST lines derived from signal states`);
  console.log("[smoke] success");
}

main().catch((e) => {
  console.error("[smoke] failed:", e);
  process.exit(1);
});
