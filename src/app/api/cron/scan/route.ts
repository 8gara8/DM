import { NextResponse } from "next/server";

/**
 * Cron stub. Phase 3 wires this to the real scan orchestrator. For now
 * we authenticate the bearer token and return 200 so Vercel's scheduler
 * can be wired up immediately.
 */
export async function POST(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json(
      { data: null, error: { code: "UNAUTHENTICATED", message: "missing or invalid cron secret" } },
      { status: 401 },
    );
  }
  return NextResponse.json({ data: { scanRunId: null, note: "phase-1 stub" } });
}

export async function GET() {
  return NextResponse.json(
    { data: null, error: { code: "METHOD_NOT_ALLOWED", message: "POST only" } },
    { status: 405 },
  );
}
