"use client";

/**
 * TickerChart — Client Component using lightweight-charts to render
 * candlestick OHLC + TDST lines + TD Signal markers.
 *
 * Props:
 *   - bars: OHLCV array for the candlesticks
 *   - events: SignalEvent rows to derive markers from
 *   - tdstLines: { price, from, to?, direction } for horizontal price lines
 *   - height?: override the default responsive height
 *
 * Behavior:
 *   - On mount: create chart with candlestick series + TDST price lines
 *   - Markers: derive from events; setup_count → below/above-bar marker with
 *     the count as text; setup_complete/countdown_complete → stronger marker
 *     with count or event-specific text (9, 13, etc.); countdown_deferred → "+"
 *   - Responsive: full width, ~60vh on desktop, 320px on mobile
 *   - Window event listener: dm:focus-bar → scroll timeScale to that barDate
 *   - Cleanup: call chart.remove() on unmount
 *
 * Built against lightweight-charts ^4.2.0. v5 changed addCandlestickSeries → addSeries(CandlestickSeries, …)
 * and moved setMarkers into the createSeriesMarkers plugin — migrate when bumping the dep.
 */

import { useEffect, useRef } from "react";
import type { Bar } from "@/engine/types";

export type SignalEvent = {
  id: string;
  ticker: string;
  timeframe: string;
  barDate: string;
  indicator: string;
  direction: "buy" | "sell" | null;
  eventType: string;
  count: number | null;
  isPerfected: boolean;
  isQualified: boolean;
  firstKnownAtDate: string;
  createdAt: string;
};

interface TickerChartProps {
  bars: Bar[];
  events: SignalEvent[];
  tdstLines: {
    price: number;
    from: string;
    to?: string;
    direction: "buy" | "sell";
  }[];
  height?: number | string;
}

/**
 * Derive markers from signal events.
 * Returns an array of lightweight-charts Marker objects.
 * Skips events with null direction (price_flip events don't need markers).
 */
function deriveMarkers(events: SignalEvent[]) {
  const markers = [];

  for (const ev of events) {
    // Skip events with null direction — price_flip events don't draw markers
    if (ev.direction === null) continue;

    let text = "";
    let position: "aboveBar" | "belowBar" = "belowBar";
    const shape: "circle" | "square" = "circle";
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
      const color = getComputedStyle(document.documentElement).getPropertyValue(
        `--${ev.direction}`,
      ).trim();

      markers.push({
        time: ev.barDate,
        position,
        text,
        color: color || (ev.direction === "buy" ? "#3fb950" : "#f85149"),
        shape,
        size: size === "large" ? 2 : 1,
      });
    }
  }

  return markers;
}

export function TickerChart({
  bars,
  events,
  tdstLines,
  height,
}: TickerChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<any>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (!containerRef.current || bars.length === 0) return;

    // Reset cancelled flag for this effect run
    cancelledRef.current = false;

    // Map bars to candlestick data synchronously (needed before async import)
    const candleData = bars.map((b) => ({
      time: b.date,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
    }));

    // Define cleanup function (will be returned synchronously)
    let handleFocusBar: ((evt: Event) => void) | null = null;

    // Dynamically import lightweight-charts
    (async () => {
      if (cancelledRef.current) return;

      try {
        const { createChart } = await import("lightweight-charts");

        if (cancelledRef.current) return;

        // Get CSS variables for theming
        const computedStyle = getComputedStyle(document.documentElement);
        const surface = computedStyle.getPropertyValue("--surface").trim() || "#161b22";
        const text = computedStyle.getPropertyValue("--text").trim() || "#e6edf3";
        const textDim = computedStyle.getPropertyValue("--text-dim").trim() || "#484f58";
        const borderSubtle =
          computedStyle.getPropertyValue("--border-subtle").trim() || "#21262d";

        const chart = createChart(containerRef.current!, {
          layout: {
            background: { color: surface },
            textColor: text,
          },
          grid: {
            vertLines: { color: borderSubtle },
            horzLines: { color: borderSubtle },
          },
          timeScale: {
            timeVisible: true,
            secondsVisible: false,
          },
          rightPriceScale: {
            textColor: textDim,
            scaleMargins: {
              top: 0.1,
              bottom: 0.2,
            },
          },
        });

        if (cancelledRef.current) {
          chart.remove();
          return;
        }

        // Add candlestick series
        const candleSeries = chart.addCandlestickSeries({
          upColor: "#3fb950",
          downColor: "#f85149",
          wickUpColor: "#3fb950",
          wickDownColor: "#f85149",
          borderUpColor: "#3fb950",
          borderDownColor: "#f85149",
        });

        candleSeries.setData(candleData);

        // Add TDST lines
        for (const line of tdstLines) {
          const color =
            line.direction === "buy"
              ? getComputedStyle(document.documentElement)
                  .getPropertyValue("--buy")
                  .trim() || "#3fb950"
              : getComputedStyle(document.documentElement)
                  .getPropertyValue("--sell")
                  .trim() || "#f85149";

          candleSeries.createPriceLine({
            price: line.price,
            color,
            lineWidth: 2,
            lineStyle: 2, // dashed
            axisLabelVisible: true,
            title: `TDST ${line.direction}`,
          });
        }

        // Add markers for signal events
        const markers = deriveMarkers(events);
        candleSeries.setMarkers(markers);

        // Fit content
        chart.timeScale().fitContent();

        // Store reference for cleanup + focus event
        chartRef.current = chart;

        // Set up focus bar listener
        handleFocusBar = (evt: Event) => {
          const customEvt = evt as CustomEvent<{ barDate: string }>;
          if (customEvt.detail?.barDate && chart.timeScale()) {
            try {
              chart.timeScale().scrollToPosition(
                candleData.findIndex((d) => d.time === customEvt.detail.barDate),
                false,
              );
            } catch {
              // Bar not found or invalid position, silently skip
            }
          }
        };

        if (!cancelledRef.current) {
          window.addEventListener("dm:focus-bar", handleFocusBar);
        }
      } catch (e) {
        console.error("[TickerChart] failed to initialize:", e);
      }
    })();

    // Cleanup runs synchronously when effect unmounts
    return () => {
      cancelledRef.current = true;

      if (handleFocusBar) {
        window.removeEventListener("dm:focus-bar", handleFocusBar);
      }

      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
    };
  }, [bars, events, tdstLines]);

  const containerHeight = height ?? "min(60vh, 600px)";

  return (
    <div
      ref={containerRef}
      className="w-full border border-border-subtle rounded-md bg-surface"
      style={{
        height: typeof containerHeight === "number" ? `${containerHeight}px` : containerHeight,
      }}
    />
  );
}
