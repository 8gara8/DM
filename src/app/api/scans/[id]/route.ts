import { auth } from "@/server/auth";
import { err, ok, withErrors } from "@/lib/api";
import { scanRunById } from "@/server/scan";
import { db } from "@/lib/db/client";

export const GET = withErrors(async (_req, ctx) => {
  const session = await auth();
  if (!session?.user?.id) return err("UNAUTHENTICATED", "sign in required", 401);
  const params = (await ctx?.params) as { id?: string };
  const id = params?.id;
  if (!id) return err("BAD_REQUEST", "missing scan id", 400);
  const row = await scanRunById(db, id);
  if (!row) return err("NOT_FOUND", `scan ${id} not found`, 404);
  return ok(row);
});
