import { desc, sql } from "drizzle-orm";
import { auth } from "@/server/auth";
import { db } from "@/lib/db/client";
import { alerts } from "@/lib/db/schema";
import { err, ok, withErrors } from "@/lib/api";

export const GET = withErrors(async (req) => {
  const session = await auth();
  if (!session?.user?.id) return err("UNAUTHENTICATED", "sign in required", 401);
  const u = new URL(req.url);
  const unreadOnly = u.searchParams.get("unreadOnly") === "true";
  const limit = Math.min(200, Math.max(1, parseInt(u.searchParams.get("limit") ?? "50", 10)));
  const offset = Math.max(0, parseInt(u.searchParams.get("offset") ?? "0", 10));
  const userId = session.user.id;
  const rows = await db
    .select()
    .from(alerts)
    .orderBy(desc(alerts.createdAt))
    .limit(limit + offset);
  const filtered = unreadOnly
    ? rows.filter((r) => !(r.readBy ?? []).includes(userId))
    : rows;
  const total = await db.select({ c: sql<number>`COUNT(*)` }).from(alerts);
  return ok({
    alerts: filtered.slice(offset, offset + limit),
    total: total[0]?.c ?? 0,
    limit,
    offset,
  });
});
