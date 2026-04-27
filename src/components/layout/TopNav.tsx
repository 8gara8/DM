import Link from "next/link";
import { relativeTimeFrom } from "@/lib/time";

interface TopNavProps {
  user?: { name?: string | null; email?: string | null; image?: string | null };
  meta?: {
    watchlistCount: number;
    activeCount: number;
    imminentCount: number;
    lastScanAt?: string | null;
  };
}

export function TopNav({ user, meta }: TopNavProps) {
  return (
    <header className="sticky top-0 z-40 border-b border-border-subtle bg-surface">
      <div className="mx-auto flex h-12 max-w-screen-xl items-center gap-6 px-4">
        <Link href="/" className="font-mono text-sm font-medium text-text">
          DM
        </Link>
        <nav className="flex items-center gap-4 text-sm text-text-muted">
          <Link href="/" className="hover:text-text">
            Dashboard
          </Link>
          <Link href="/alerts" className="hover:text-text">
            Alerts
          </Link>
          <Link href="/scans" className="hover:text-text">
            Scans
          </Link>
        </nav>
        <div className="ml-auto flex items-center gap-4 text-xs text-text-muted">
          {meta && (
            <span className="hidden font-mono lg:inline">
              {meta.watchlistCount} tickers · {meta.activeCount} active ·{" "}
              {meta.imminentCount} imminent
              {meta.lastScanAt
                ? ` · scanned ${relativeTimeFrom(meta.lastScanAt)} ago`
                : ""}
            </span>
          )}
          {user?.email && (
            <Link
              href="/settings"
              className="font-mono text-text-muted hover:text-text"
            >
              {user.email}
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
