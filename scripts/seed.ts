/**
 * Seed the local dev DB with a default watchlist and the owner user.
 * Idempotent — safe to re-run.
 *
 *   pnpm seed
 */

import "dotenv/config";
import { db } from "../src/lib/db/client";
import { users, watchlists, watchlistTickers } from "../src/lib/db/schema";
import { eq } from "drizzle-orm";
import { newId } from "../src/lib/ids";

async function main() {
  const ownerEmail = process.env.OWNER_EMAIL?.toLowerCase();
  if (!ownerEmail) {
    console.error("OWNER_EMAIL is required to seed (set it in .env or env vars)");
    process.exit(1);
  }

  const existingUser = await db.query.users.findFirst({
    where: eq(users.email, ownerEmail),
  });
  let ownerId: string;
  if (existingUser) {
    ownerId = existingUser.id;
    console.log(`✓ Owner user already exists: ${ownerEmail}`);
  } else {
    ownerId = newId();
    await db.insert(users).values({ id: ownerId, email: ownerEmail });
    console.log(`✓ Created owner user: ${ownerEmail}`);
  }

  const wlId = "wl_default";
  const existingWl = await db.query.watchlists.findFirst({
    where: eq(watchlists.id, wlId),
  });
  if (!existingWl) {
    await db.insert(watchlists).values({ id: wlId, name: "Crew Watchlist" });
    console.log("✓ Created default watchlist");
  } else {
    console.log("✓ Default watchlist already exists");
  }

  const seeds = [
    { ticker: "SPY", tags: ["index"] },
    { ticker: "QQQ", tags: ["index"] },
    { ticker: "BTC-USD", tags: ["crypto"] },
  ];
  for (const s of seeds) {
    await db
      .insert(watchlistTickers)
      .values({
        watchlistId: wlId,
        ticker: s.ticker,
        tags: s.tags,
        addedBy: ownerId,
        isActive: true,
      })
      .onConflictDoNothing();
  }
  console.log(`✓ Seeded ${seeds.length} watchlist tickers`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
