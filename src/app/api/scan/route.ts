import { z } from "zod";
import { auth } from "@/server/auth";
import { err, ok, withErrors } from "@/lib/api";
import { runScan } from "@/server/scan";
import { clearDashboardCacheFor } from "@/server/dashboard";

const Body = z.object({
  tickers: z.array(z.string().min(1).max(10)).optional(),
  timeframes: z
    .array(z.enum(["daily", "weekly", "monthly", "yearly"]))
    .optional(),
});

export const POST = withErrors(async (req) => {
  const session = await auth();
  if (!session?.user?.id) return err("UNAUTHENTICATED", "sign in required", 401);
  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const parsed = Body.safeParse(body);
  if (!parsed.success) return err("BAD_REQUEST", parsed.error.message, 400);
  const result = await runScan({
    tickers: parsed.data.tickers,
    timeframes: parsed.data.timeframes,
    trigger: "manual",
    triggeredBy: session.user.id,
  });
  clearDashboardCacheFor(session.user.id);
  return ok(result, 202);
});
