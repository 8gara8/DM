/**
 * SignalTimeline — Server Component displaying a vertical list of signal events.
 *
 * Most recent first. Each row:
 *   - monospaced date
 *   - indicator + direction icon (S/C, ▲/▼)
 *   - event-type label (e.g., "Setup 7", "Countdown complete")
 *   - optional badge (perfected, qualified, deferred)
 *
 * Row is a "use client" sub-component so it can dispatch dm:focus-bar events
 * on click to scroll the TickerChart.
 */

export type SignalEvent = {
  id: string;
  ticker: string;
  timeframe: string;
  barDate: string;
  indicator: string;
  direction: "buy" | "sell" | null;
  eventType: string;
  count: number | null;
  firstKnownAtDate: string;
  createdAt: string;
};

interface SignalTimelineProps {
  events: SignalEvent[];
}

/**
 * Client sub-component for each row so it can dispatch custom events.
 */
function TimelineRow({ event }: { event: SignalEvent }) {
  const handleClick = () => {
    // Dispatch custom event for TickerChart to consume
    const customEvent = new CustomEvent("dm:focus-bar", {
      detail: { barDate: event.barDate },
    });
    window.dispatchEvent(customEvent);
  };

  // Format date
  const date = new Date(event.barDate);
  const dateStr = date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  // Determine indicator letter
  const indicator = event.indicator === "sequential" ? "S" : "C";

  // Direction arrow (skip if null — price_flip events don't display direction)
  const hasDirection = event.direction !== null;
  const arrow = event.direction === "buy" ? "▲" : "▼";
  const arrowColor = event.direction === "buy" ? "text-buy" : "text-sell";

  // Event type label
  let eventLabel = "";
  if (event.eventType === "setup_count") {
    eventLabel = `Setup ${event.count ?? "?"}`;
  } else if (event.eventType === "setup_complete") {
    eventLabel = "Setup complete";
  } else if (event.eventType === "countdown_complete") {
    eventLabel = `Countdown ${event.count ?? "13"}`;
  } else if (event.eventType === "signal_9_13_9") {
    eventLabel = "Signal 9-13-9";
  } else if (event.eventType === "countdown_deferred") {
    eventLabel = "Countdown deferred";
  } else if (event.eventType === "price_flip") {
    eventLabel = "Price flip";
  }

  return (
    <button
      onClick={handleClick}
      className="block w-full text-left px-3 py-2 hover:bg-surface-hover rounded transition-colors"
      title={`Focus on ${dateStr}`}
    >
      <div className="flex items-center gap-2 text-sm">
        <span className="font-mono text-text-dim min-w-fit">{dateStr}</span>

        <span className="flex items-center gap-1 font-semibold">
          <span className="text-text">{indicator}</span>
          {hasDirection && <span className={arrowColor}>{arrow}</span>}
        </span>

        <span className="text-text flex-1">{eventLabel}</span>

        {event.eventType === "setup_perfected" && (
          <span className="px-2 py-0.5 text-xs rounded bg-buy-dim text-buy font-medium">
            perfected
          </span>
        )}
        {event.eventType === "countdown_qualified" && (
          <span className="px-2 py-0.5 text-xs rounded bg-buy-dim text-buy font-medium">
            qualified
          </span>
        )}
        {event.eventType === "countdown_deferred" && (
          <span className="px-2 py-0.5 text-xs rounded bg-warning/10 text-warning font-medium">
            deferred
          </span>
        )}
      </div>
    </button>
  );
}

export function SignalTimeline({ events }: SignalTimelineProps) {
  if (events.length === 0) {
    return (
      <div className="p-4 text-center text-text-dim italic text-sm">
        No events recorded for this ticker × timeframe yet.
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {events.map((event) => (
        <TimelineRow key={`${event.barDate}-${event.eventType}-${event.indicator}-${event.direction}`} event={event} />
      ))}
    </div>
  );
}
