import { desc, sql, type SQL } from "drizzle-orm";
import { auth } from "@/server/auth";
import { db } from "@/lib/db/client";
import { alerts } from "@/lib/db/schema";
import { err, ok, withErrors } from "@/lib/api";

/**
 * Recent alerts for the dashboard / /alerts page.
 *
 * `unreadOnly=true` filters in SQL via `json_each` against `readBy`, so
 * pagination + total are consistent with the filter (the pre-fix
 * implementation paginated all alerts and filtered in memory, which
 * dropped unread alerts when read alerts dominated the page window and
 * also reported the wrong `total`).
 */
export const GET = withErrors(async (req) => {
  const session = await auth();
  if (!session?.user?.id) return err("UNAUTHENTICATED", "sign in required", 401);
  const u = new URL(req.url);
  const unreadOnly = u.searchParams.get("unreadOnly") === "true";
  const limit = Math.min(200, Math.max(1, parseInt(u.searchParams.get("limit") ?? "50", 10)));
  const offset = Math.max(0, parseInt(u.searchParams.get("offset") ?? "0", 10));
  const userId = session.user.id;

  // For "unread by THIS user" we check that userId is NOT present in the
  // JSON `readBy` array. `json_each` is the libSQL/SQLite-correct way to
  // walk a JSON array predicate.
  const where: SQL | undefined = unreadOnly
    ? sql`NOT EXISTS (SELECT 1 FROM json_each(coalesce(${alerts.readBy}, '[]')) WHERE value = ${userId})`
    : undefined;

  const baseQuery = db.select().from(alerts);
  const rowsQuery = where ? baseQuery.where(where) : baseQuery;
  const rows = await rowsQuery
    .orderBy(desc(alerts.createdAt))
    .limit(limit)
    .offset(offset);

  const totalQuery = db.select({ c: sql<number>`COUNT(*)` }).from(alerts);
  const totalRows = where ? await totalQuery.where(where) : await totalQuery;
  const total = totalRows[0]?.c ?? 0;

  return ok({ alerts: rows, total, limit, offset, unreadOnly });
});
