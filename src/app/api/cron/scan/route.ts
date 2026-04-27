/**
 * Cron entry point. Vercel attaches `Authorization: Bearer ${CRON_SECRET}`
 * automatically when the cron is configured; we double-check the header.
 *
 * Behavior is identical to a `POST /api/scan` with no filters but with
 * `trigger: "cron"`.
 */
import { err, ok, withErrors } from "@/lib/api";
import { runScan } from "@/server/scan";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5min for scans across the watchlist

export const POST = withErrors(async (req) => {
  const auth = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return err("UNAUTHENTICATED", "missing or invalid cron secret", 401);
  }
  const result = await runScan({ trigger: "cron", triggeredBy: null });
  return ok(result);
});

export async function GET() {
  return new Response(
    JSON.stringify({ data: null, error: { code: "METHOD_NOT_ALLOWED", message: "POST only" } }),
    { status: 405, headers: { "content-type": "application/json" } },
  );
}
