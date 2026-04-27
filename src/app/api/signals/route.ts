import { sql } from "drizzle-orm";
import { auth } from "@/server/auth";
import { db } from "@/lib/db/client";
import { signalStates } from "@/lib/db/schema";
import { err, ok, withErrors } from "@/lib/api";

export const GET = withErrors(async (req) => {
  const session = await auth();
  if (!session?.user?.id) return err("UNAUTHENTICATED", "sign in required", 401);
  const u = new URL(req.url);
  const phaseMin = u.searchParams.get("phaseMin");
  const countMinRaw = u.searchParams.get("countMin");
  const countMin = countMinRaw ? parseInt(countMinRaw, 10) : 0;
  const conditions: string[] = [];
  if (phaseMin === "setup") conditions.push(`phase IN ('setup','countdown')`);
  if (phaseMin === "countdown") conditions.push(`phase = 'countdown'`);
  if (countMin > 0) conditions.push(`count >= ${countMin}`);
  const where = conditions.length ? sql.raw(`WHERE ${conditions.join(" AND ")}`) : sql.raw("");
  const rows = await db.all(
    sql`SELECT * FROM ${signalStates} ${where} ORDER BY count DESC LIMIT 200`,
  );
  return ok({ signals: rows });
});
