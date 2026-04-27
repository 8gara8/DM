import Link from "next/link";
import { auth, signIn } from "@/server/auth";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) {
    return (
      <div className="mx-auto max-w-md py-16">
        <Card>
          <h1 className="mb-2 text-lg font-medium">Sign in</h1>
          <p className="mb-4 text-sm text-text-muted">
            DM is private to a small crew. Sign in with Google; if your email
            isn&apos;t on the allowlist you&apos;ll be redirected to{" "}
            <Link href="/access-denied" className="text-accent">
              /access-denied
            </Link>
            .
          </p>
          <form
            action={async () => {
              "use server";
              await signIn("google");
            }}
          >
            <Button type="submit">Sign in with Google</Button>
          </form>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <h1 className="mb-1 text-base font-medium">Watchlist is empty.</h1>
        <p className="text-sm text-text-muted">
          Phase 1 dashboard placeholder. The hero / rails layout lands in
          Phase 3 once the scan pipeline is wired to live data.
        </p>
      </Card>
    </div>
  );
}
