import { and, desc, eq, gte, sql } from "drizzle-orm";
import { auth } from "@/server/auth";
import { db } from "@/lib/db/client";
import { signalEvents } from "@/lib/db/schema";
import { err, ok, withErrors } from "@/lib/api";

export const GET = withErrors(async (req) => {
  const session = await auth();
  if (!session?.user?.id) return err("UNAUTHENTICATED", "sign in required", 401);
  const u = new URL(req.url);
  const ticker = u.searchParams.get("ticker");
  const timeframe = u.searchParams.get("timeframe");
  const indicator = u.searchParams.get("indicator");
  const eventType = u.searchParams.get("eventType");
  const since = u.searchParams.get("since");
  const limit = Math.min(500, Math.max(1, parseInt(u.searchParams.get("limit") ?? "50", 10)));
  const conds = [] as ReturnType<typeof eq>[];
  if (ticker) conds.push(eq(signalEvents.ticker, ticker.toUpperCase()));
  if (timeframe) conds.push(eq(signalEvents.timeframe, timeframe));
  if (indicator) conds.push(eq(signalEvents.indicator, indicator));
  if (eventType) conds.push(eq(signalEvents.eventType, eventType));
  if (since) conds.push(gte(signalEvents.barDate, since));
  const where = conds.length > 0 ? and(...conds) : undefined;
  const rows = await db
    .select()
    .from(signalEvents)
    .where(where as never)
    .orderBy(desc(signalEvents.barDate))
    .limit(limit);
  const totalRows = await db.select({ c: sql<number>`COUNT(*)` }).from(signalEvents).where(where as never);
  return ok({ events: rows, total: totalRows[0]?.c ?? 0, limit });
});
