/**
 * Smoke test: seed minimal data and run composeDashboardPayload against it.
 * Run with: pnpm tsx scripts/smoke-dashboard.ts
 */
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "../src/lib/db/schema";
import { composeDashboardPayload, clearDashboardCacheFor } from "../src/server/dashboard";

async function main() {
  // Use an in-memory database
  const client = createClient({ url: "file::memory:?cache=shared" });
  const db = drizzle(client, { schema });

  // Apply the migration
  const fs = await import("fs/promises");
  // Resolve the latest 0000 migration dynamically — drizzle-kit names it
  // (e.g. 0000_stale_wong.sql, 0000_concerned_purifiers.sql) based on
  // schema state, so don't hardcode the random suffix.
  const migrationFile = (await fs.readdir("./drizzle"))
    .filter((f) => /^0000_.*\.sql$/.test(f))
    .sort()[0];
  if (!migrationFile) throw new Error("no 0000_*.sql migration found in drizzle/");
  const migrationSql = await fs.readFile(`./drizzle/${migrationFile}`, "utf-8");
  for (const stmt of migrationSql.split("--> statement-breakpoint")) {
    const cleaned = stmt.trim();
    if (cleaned) await client.execute(cleaned);
  }
  console.log("✓ schema applied");

  // Seed user + watchlist + ticker
  await db.insert(schema.users).values({
    id: "u_test",
    email: "test@example.com",
    name: "Test User",
  });
  await db.insert(schema.watchlists).values({ id: "w_default", name: "default" });
  await db.insert(schema.watchlistTickers).values({
    watchlistId: "w_default",
    ticker: "AAPL",
    tags: ["megacap"],
    addedBy: "u_test",
    isActive: true,
  });
  await db.insert(schema.watchlistTickers).values({
    watchlistId: "w_default",
    ticker: "MSFT",
    tags: [],
    addedBy: "u_test",
    isActive: true,
  });

  // Seed a few bars for AAPL on weekly + signal_states + signal_events
  const today = "2026-04-25";
  for (let i = 0; i < 10; i++) {
    const d = new Date(2026, 1, 1);
    d.setDate(d.getDate() + i * 7);
    await db.insert(schema.bars).values({
      ticker: "AAPL",
      timeframe: "weekly",
      date: d.toISOString().slice(0, 10),
      open: 170 + i,
      high: 175 + i,
      low: 168 + i,
      close: 172 + i,
      fetchedAt: new Date().toISOString(),
    });
  }
  await db.insert(schema.signalStates).values({
    ticker: "AAPL",
    timeframe: "weekly",
    indicator: "sequential",
    direction: "buy",
    phase: "setup",
    count: 9,
    isPerfected: true,
    isDeferred: false,
    configHash: "deadbeef",
    asOfBarDate: today,
    updatedAt: new Date().toISOString(),
  });
  await db.insert(schema.signalEvents).values({
    ticker: "AAPL",
    timeframe: "weekly",
    indicator: "sequential",
    eventType: "setup_complete",
    direction: "buy",
    count: 9,
    barDate: today,
    firstKnownAtDate: today,
    configHash: "deadbeef",
  });
  await db.insert(schema.scanRuns).values({
    trigger: "manual",
    triggeredBy: "u_test",
    startedAt: today + "T00:00:00Z",
    finishedAt: today + "T00:00:01Z",
    tickersAttempted: 2,
    tickersSucceeded: 2,
  });

  console.log("✓ data seeded");

  clearDashboardCacheFor("u_test");
  const payload = await composeDashboardPayload("u_test", { db, bypassCache: true });
  console.log("\n=== HERO ===");
  console.log(JSON.stringify(payload.hero, null, 2));
  console.log("\n=== RAILS ===");
  console.log(
    `justPrinted=${payload.rails.justPrinted.length} imminent=${payload.rails.imminent.length} watching=${payload.rails.watching.length}`,
  );
  console.log("\n=== META ===");
  console.log(JSON.stringify(payload.meta, null, 2));

  // Hard assertions
  if (payload.hero.type !== "signal") throw new Error("expected hero.type=signal");
  if (payload.hero.ticker !== "AAPL") throw new Error("expected AAPL hero");
  if (!payload.hero.translation.includes("Buy Setup 9 perfected"))
    throw new Error("translation missing perfected sentence");
  if (payload.rails.justPrinted.length === 0)
    throw new Error("expected AAPL in justPrinted (today's setup_complete)");
  console.log("\n✅ smoke test passed");
}

main().catch((e) => {
  console.error("❌", e);
  process.exit(1);
});
