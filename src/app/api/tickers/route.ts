import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { auth } from "@/server/auth";
import { db } from "@/lib/db/client";
import { signalStates, watchlistTickers } from "@/lib/db/schema";
import { err, ok, withErrors } from "@/lib/api";
import { getOrCreateDefaultWatchlist, runScan } from "@/server/scan";
import { clearDashboardCacheFor } from "@/server/dashboard";

const TickerSchema = z.object({
  ticker: z
    .string()
    .min(1)
    .max(10)
    .transform((s) => s.toUpperCase())
    .refine((s) => /^[A-Z][A-Z0-9.\-]{0,9}$/.test(s), "invalid ticker symbol"),
  tags: z.array(z.string().max(20)).max(5).optional(),
});

export const GET = withErrors(async () => {
  const session = await auth();
  if (!session?.user?.id) return err("UNAUTHENTICATED", "sign in required", 401);
  const watchlistId = await getOrCreateDefaultWatchlist(db);
  const rows = await db
    .select()
    .from(watchlistTickers)
    .where(
      and(
        eq(watchlistTickers.watchlistId, watchlistId),
        eq(watchlistTickers.isActive, true),
      ),
    );
  // Pull signal_states for the watchlist tickers
  const states = rows.length
    ? await db
        .select()
        .from(signalStates)
    : [];
  const grouped = new Map<string, typeof states>();
  for (const s of states) {
    const arr = grouped.get(s.ticker) ?? [];
    arr.push(s);
    grouped.set(s.ticker, arr);
  }
  const data = rows.map((r) => {
    const sigs = grouped.get(r.ticker) ?? [];
    const byTf = (tf: string) => {
      const interesting = sigs.filter((s) => s.timeframe === tf && s.phase !== "none" && s.count > 0);
      if (interesting.length === 0) return null;
      const top = interesting.sort((a, b) => b.count - a.count)[0]!;
      return {
        direction: top.direction,
        indicator: top.indicator,
        phase: top.phase,
        count: top.count,
        isPerfected: top.isPerfected,
        isDeferred: top.isDeferred,
      };
    };
    return {
      ticker: r.ticker,
      tags: r.tags ?? [],
      addedAt: r.addedAt,
      lastScanAt: null as string | null,
      signals: {
        daily: byTf("daily"),
        weekly: byTf("weekly"),
        monthly: byTf("monthly"),
        yearly: byTf("yearly"),
      },
    };
  });
  return ok(data);
});

export const POST = withErrors(async (req) => {
  const session = await auth();
  if (!session?.user?.id) return err("UNAUTHENTICATED", "sign in required", 401);
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return err("BAD_REQUEST", "invalid JSON body", 400);
  }
  const parsed = TickerSchema.safeParse(body);
  if (!parsed.success) {
    return err("BAD_REQUEST", parsed.error.issues.map((i) => i.message).join("; "), 400);
  }
  const { ticker, tags = [] } = parsed.data;
  const watchlistId = await getOrCreateDefaultWatchlist(db);

  // Check existing
  const existing = await db
    .select()
    .from(watchlistTickers)
    .where(
      and(
        eq(watchlistTickers.watchlistId, watchlistId),
        eq(watchlistTickers.ticker, ticker),
      ),
    )
    .limit(1);
  if (existing.length > 0) {
    if (existing[0]!.isActive) {
      return err("CONFLICT", `${ticker} is already on the watchlist`, 409);
    }
    // Reactivate
    await db
      .update(watchlistTickers)
      .set({ isActive: true, tags, addedBy: session.user.id })
      .where(
        and(
          eq(watchlistTickers.watchlistId, watchlistId),
          eq(watchlistTickers.ticker, ticker),
        ),
      );
  } else {
    await db.insert(watchlistTickers).values({
      watchlistId,
      ticker,
      tags,
      addedBy: session.user.id,
      isActive: true,
    });
  }
  clearDashboardCacheFor(session.user.id);
  // Fire an add-ticker scan for just this ticker, do not await — return scanRunId
  const result = await runScan({
    tickers: [ticker],
    trigger: "add-ticker",
    triggeredBy: session.user.id,
  });
  return ok({ ticker, scanRunId: result.scanRunId }, 201);
});
