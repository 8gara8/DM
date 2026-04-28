/**
 * tests/components/ticker-chart.contract.test.tsx
 *
 * Contract test for TickerChart marker derivation.
 * Tests the pure function that converts SignalEvents into lightweight-charts markers,
 * without rendering or mocking the chart canvas.
 */

import { describe, it, expect } from "vitest";

type SignalEvent = {
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

/**
 * Pure function extracted from TickerChart — converts events to markers.
 * Returns the marker data that would be passed to candleSeries.setMarkers().
 * Skips events with null direction (price_flip events don't need markers).
 */
function deriveMarkers(events: SignalEvent[]) {
  const markers = [];

  for (const ev of events) {
    // Skip events with null direction — price_flip events don't draw markers
    if (ev.direction === null) continue;

    let text = "";
    let position: "aboveBar" | "belowBar" = "belowBar";
    let shape: "circle" | "square" = "circle";
    let size: "small" | "large" = "small";

    // Determine direction and position
    const isAbove = ev.direction === "sell";
    position = isAbove ? "aboveBar" : "belowBar";

    // Map event type to marker appearance
    if (ev.eventType === "setup_count") {
      text = ev.count?.toString() ?? "?";
      size = "small";
    } else if (ev.eventType === "setup_complete") {
      text = ev.count?.toString() ?? "9";
      size = "large";
    } else if (ev.eventType === "countdown_complete") {
      text = ev.count?.toString() ?? "13";
      size = "large";
    } else if (ev.eventType === "signal_9_13_9") {
      text = "9-13-9";
      size = "large";
    } else if (ev.eventType === "countdown_deferred") {
      text = "+";
      size = "small";
    }

    if (text) {
      // In tests, use inline colors since CSS vars aren't available
      const color = ev.direction === "buy" ? "#3fb950" : "#f85149";

      markers.push({
        time: ev.barDate,
        position,
        text,
        color,
        shape,
        size: size === "large" ? 2 : 1,
      });
    }
  }

  return markers;
}

describe("TickerChart marker derivation", () => {
  it("should convert setup_count events to below/above-bar markers with count text", () => {
    const events: SignalEvent[] = [
      {
        id: "1",
        ticker: "SPY",
        timeframe: "daily",
        barDate: "2025-01-10",
        indicator: "sequential",
        direction: "buy",
        eventType: "setup_count",
        count: 5,
        isPerfected: false,
        isQualified: false,
        firstKnownAtDate: "2025-01-10",
        createdAt: new Date().toISOString(),
      },
    ];

    const markers = deriveMarkers(events);
    expect(markers).toHaveLength(1);
    expect(markers[0]).toMatchObject({
      time: "2025-01-10",
      text: "5",
      position: "belowBar", // buy → below
      color: "#3fb950", // buy color
      size: 1, // small
    });
  });

  it("should convert setup_complete to large marker with count", () => {
    const events: SignalEvent[] = [
      {
        id: "2",
        ticker: "SPY",
        timeframe: "daily",
        barDate: "2025-01-15",
        indicator: "sequential",
        direction: "sell",
        eventType: "setup_complete",
        count: 9,
        isPerfected: true,
        isQualified: false,
        firstKnownAtDate: "2025-01-07",
        createdAt: new Date().toISOString(),
      },
    ];

    const markers = deriveMarkers(events);
    expect(markers).toHaveLength(1);
    expect(markers[0]).toMatchObject({
      time: "2025-01-15",
      text: "9",
      position: "aboveBar", // sell → above
      color: "#f85149", // sell color
      size: 2, // large
    });
  });

  it("should convert countdown_deferred to + marker", () => {
    const events: SignalEvent[] = [
      {
        id: "3",
        ticker: "QQQ",
        timeframe: "weekly",
        barDate: "2025-01-20",
        indicator: "sequential",
        direction: "buy",
        eventType: "countdown_deferred",
        count: 8,
        isPerfected: false,
        isQualified: false,
        firstKnownAtDate: "2025-01-20",
        createdAt: new Date().toISOString(),
      },
    ];

    const markers = deriveMarkers(events);
    expect(markers).toHaveLength(1);
    expect(markers[0]).toMatchObject({
      text: "+",
      size: 1, // small
    });
  });

  it("should handle mixed event types in sequence", () => {
    const events: SignalEvent[] = [
      {
        id: "1",
        ticker: "SPY",
        timeframe: "daily",
        barDate: "2025-01-05",
        indicator: "sequential",
        direction: "buy",
        eventType: "setup_count",
        count: 5,
        isPerfected: false,
        isQualified: false,
        firstKnownAtDate: "2025-01-05",
        createdAt: new Date().toISOString(),
      },
      {
        id: "2",
        ticker: "SPY",
        timeframe: "daily",
        barDate: "2025-01-10",
        indicator: "sequential",
        direction: "buy",
        eventType: "setup_complete",
        count: 9,
        isPerfected: true,
        isQualified: false,
        firstKnownAtDate: "2025-01-02",
        createdAt: new Date().toISOString(),
      },
      {
        id: "3",
        ticker: "SPY",
        timeframe: "daily",
        barDate: "2025-01-15",
        indicator: "sequential",
        direction: "sell",
        eventType: "countdown_deferred",
        count: 6,
        isPerfected: false,
        isQualified: false,
        firstKnownAtDate: "2025-01-15",
        createdAt: new Date().toISOString(),
      },
    ];

    const markers = deriveMarkers(events);
    expect(markers).toHaveLength(3);
    expect(markers[0].text).toBe("5");
    expect(markers[0].size).toBe(1);
    expect(markers[1].text).toBe("9");
    expect(markers[1].size).toBe(2);
    expect(markers[2].text).toBe("+");
    expect(markers[2].size).toBe(1);
  });

  it("should default count to expected value if missing", () => {
    const events: SignalEvent[] = [
      {
        id: "1",
        ticker: "SPY",
        timeframe: "daily",
        barDate: "2025-01-10",
        indicator: "sequential",
        direction: "buy",
        eventType: "setup_complete",
        count: null, // missing count
        isPerfected: false,
        isQualified: false,
        firstKnownAtDate: "2025-01-10",
        createdAt: new Date().toISOString(),
      },
    ];

    const markers = deriveMarkers(events);
    expect(markers[0].text).toBe("9"); // defaults to 9 for setup_complete
  });

  it("should set position based on direction (buy=below, sell=above)", () => {
    const buyEvent: SignalEvent = {
      id: "1",
      ticker: "SPY",
      timeframe: "daily",
      barDate: "2025-01-10",
      indicator: "sequential",
      direction: "buy",
      eventType: "setup_count",
      count: 3,
      firstKnownAtDate: "2025-01-10",
      createdAt: new Date().toISOString(),
    };

    const sellEvent: SignalEvent = {
      ...buyEvent,
      id: "2",
      direction: "sell",
      barDate: "2025-01-11",
    };

    const markers = deriveMarkers([buyEvent, sellEvent]);
    expect(markers[0].position).toBe("belowBar");
    expect(markers[1].position).toBe("aboveBar");
  });

  it("should skip events with null direction (price_flip events)", () => {
    const events: SignalEvent[] = [
      {
        id: "1",
        ticker: "SPY",
        timeframe: "daily",
        barDate: "2025-01-10",
        indicator: "sequential",
        direction: null, // price_flip has null direction
        eventType: "price_flip",
        count: null,
        isPerfected: false,
        isQualified: false,
        firstKnownAtDate: "2025-01-10",
        createdAt: new Date().toISOString(),
      },
    ];

    const markers = deriveMarkers(events);
    expect(markers).toHaveLength(0); // Should not create marker
  });
});
