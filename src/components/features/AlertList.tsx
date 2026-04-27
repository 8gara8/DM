import Link from "next/link";
import { relativeTimeFrom } from "@/lib/time";
import { Pill } from "@/components/ui/Pill";

export interface AlertRow {
  id: string;
  ticker: string;
  timeframe: string;
  priority: "info" | "warning" | "critical";
  message: string;
  createdAt: string;
}

interface AlertListProps {
  alerts: AlertRow[];
  variant?: "compact" | "full";
}

const PRIORITY_TONE: Record<AlertRow["priority"], string> = {
  info: "text-text-muted",
  warning: "text-warning",
  critical: "text-critical",
};

export function AlertList({ alerts, variant = "compact" }: AlertListProps) {
  if (alerts.length === 0) {
    return <p className="text-xs text-text-dim">No alerts.</p>;
  }
  return (
    <ul className="divide-y divide-border-subtle">
      {alerts.map((a) => (
        <li key={a.id} className="py-2">
          <Link
            href={`/ticker/${a.ticker}?tf=${a.timeframe}`}
            className="flex items-baseline justify-between gap-3 hover:text-text"
          >
            <div className="flex items-baseline gap-2 min-w-0">
              <span className={`font-mono text-xs ${PRIORITY_TONE[a.priority]}`}>
                {a.priority.toUpperCase()}
              </span>
              <span className="text-sm text-text truncate">{a.message}</span>
              {variant === "full" && (
                <Pill className="text-[10px] px-1.5 py-0">{a.timeframe}</Pill>
              )}
            </div>
            <span className="font-mono text-[11px] text-text-dim">
              {relativeTimeFrom(a.createdAt)}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
