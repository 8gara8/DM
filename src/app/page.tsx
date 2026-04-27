import Link from "next/link";
import { auth, signIn } from "@/server/auth";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Hero } from "@/components/features/Hero";
import { RailSection } from "@/components/features/RailSection";
import { DashboardActions } from "@/components/features/DashboardActions";
import { composeDashboardPayload } from "@/server/dashboard";

export const dynamic = "force-dynamic";

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

  const data = await composeDashboardPayload(session.user.id ?? "anonymous");
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-base font-medium text-text">Dashboard</h1>
        <DashboardActions />
      </div>
      <Hero hero={data.hero} />
      <RailSection
        label="Just printed today"
        description="Setups completed or 13s qualified during today's scan."
        tiles={data.rails.justPrinted}
      />
      <RailSection
        label="Imminent"
        description="Setup ≥ 7 or Countdown ≥ 11 — within 1–2 bars of completion."
        tiles={data.rails.imminent}
        maxVisible={6}
      />
      <RailSection
        label="Watching"
        description="Watchlist tickers with no imminent activity."
        tiles={data.rails.watching}
        variant="compact"
      />
    </div>
  );
}
