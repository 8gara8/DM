import { and, eq } from "drizzle-orm";
import { auth } from "@/server/auth";
import { db } from "@/lib/db/client";
import { watchlistTickers } from "@/lib/db/schema";
import { err, ok, withErrors } from "@/lib/api";
import { getOrCreateDefaultWatchlist } from "@/server/scan";
import { clearDashboardCacheFor } from "@/server/dashboard";

export const DELETE = withErrors(async (_req, ctx) => {
  const session = await auth();
  if (!session?.user?.id) return err("UNAUTHENTICATED", "sign in required", 401);
  const params = (await ctx?.params) as { symbol?: string };
  const symbol = params?.symbol?.toUpperCase();
  if (!symbol) return err("BAD_REQUEST", "missing symbol", 400);
  const watchlistId = await getOrCreateDefaultWatchlist(db);
  const existing = await db
    .select()
    .from(watchlistTickers)
    .where(
      and(
        eq(watchlistTickers.watchlistId, watchlistId),
        eq(watchlistTickers.ticker, symbol),
      ),
    )
    .limit(1);
  if (existing.length === 0) return err("NOT_FOUND", `${symbol} not on watchlist`, 404);
  await db
    .update(watchlistTickers)
    .set({ isActive: false })
    .where(
      and(
        eq(watchlistTickers.watchlistId, watchlistId),
        eq(watchlistTickers.ticker, symbol),
      ),
    );
  clearDashboardCacheFor(session.user.id);
  return ok({ ticker: symbol, removed: true });
});
