import Link from "next/link";
import { TickerCard } from "./TickerCard";
import type { TickerTile } from "@/lib/dashboard-types";

interface RailSectionProps {
  label: string;
  description?: string;
  tiles: TickerTile[];
  maxVisible?: number;
  emptyBehavior?: "hide" | "show-empty";
  moreLink?: string;
  variant?: "default" | "compact";
}

export function RailSection({
  label,
  description,
  tiles,
  maxVisible = Infinity,
  emptyBehavior = "hide",
  moreLink,
  variant = "default",
}: RailSectionProps) {
  if (tiles.length === 0 && emptyBehavior === "hide") return null;
  const visible = tiles.slice(0, maxVisible);
  const overflow = Math.max(0, tiles.length - visible.length);
  return (
    <section className="space-y-3">
      <header className="flex items-baseline justify-between">
        <div>
          <h2 className="text-xs uppercase tracking-wider text-text-muted">{label}</h2>
          {description && <p className="mt-0.5 text-xs text-text-dim">{description}</p>}
        </div>
        {tiles.length === 0 && emptyBehavior === "show-empty" && (
          <span className="text-xs text-text-dim">empty</span>
        )}
      </header>
      {visible.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visible.map((tile) => (
            <TickerCard key={tile.ticker} tile={tile} variant={variant} />
          ))}
        </div>
      )}
      {overflow > 0 && moreLink && (
        <Link href={moreLink} className="text-xs text-text-muted hover:text-text">
          +{overflow} more →
        </Link>
      )}
    </section>
  );
}
