import { auth } from "@/server/auth";
import { err, ok, withErrors } from "@/lib/api";
import { recentScans } from "@/server/scan";
import { db } from "@/lib/db/client";

export const GET = withErrors(async (req) => {
  const session = await auth();
  if (!session?.user?.id) return err("UNAUTHENTICATED", "sign in required", 401);
  const u = new URL(req.url);
  const limit = clamp(parseInt(u.searchParams.get("limit") ?? "20", 10), 1, 100);
  const offset = Math.max(0, parseInt(u.searchParams.get("offset") ?? "0", 10));
  const { rows, total } = await recentScans(db, limit, offset);
  return ok({ scans: rows, total, limit, offset });
});

function clamp(n: number, lo: number, hi: number): number {
  if (Number.isNaN(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}
