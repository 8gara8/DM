import { auth } from "@/server/auth";
import { composeDashboardPayload } from "@/server/dashboard";
import { err, ok, withErrors } from "@/lib/api";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const GET = withErrors(async () => {
  const session = await auth();
  if (!session?.user?.id) return err("UNAUTHENTICATED", "sign in required", 401);
  const data = await composeDashboardPayload(session.user.id);
  return ok(data);
});
