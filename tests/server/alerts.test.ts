import { describe, expect, it } from "vitest";
import { prepareAlertsForEvents } from "@/server/alerts";

describe("alert preparation", () => {
  it("setup_complete -> warning", () => {
    const a = prepareAlertsForEvents([
      {
        id: "x",
        ticker: "AAPL",
        timeframe: "weekly",
        indicator: "sequential",
        eventType: "setup_complete",
        direction: "buy",
        count: 9,
        barDate: "2026-04-25",
      },
    ]);
    expect(a).toHaveLength(1);
    expect(a[0]!.priority).toBe("warning");
    expect(a[0]!.dedupeKey).toBe("AAPL:weekly:sequential:setup_complete:2026-04-25");
  });

  it("countdown_complete -> critical", () => {
    const a = prepareAlertsForEvents([
      {
        id: "y",
        ticker: "MSFT",
        timeframe: "daily",
        indicator: "sequential",
        eventType: "countdown_complete",
        direction: "sell",
        count: 13,
        barDate: "2026-04-26",
      },
    ]);
    expect(a[0]!.priority).toBe("critical");
  });

  it("approaching_setup fires at count 7/8 only", () => {
    const a = prepareAlertsForEvents([
      {
        id: "z",
        ticker: "GOOG",
        timeframe: "weekly",
        indicator: "sequential",
        eventType: "setup_count",
        direction: "buy",
        count: 6,
        barDate: "d",
      },
    ]);
    expect(a).toHaveLength(0);
    const a2 = prepareAlertsForEvents([
      {
        id: "z",
        ticker: "GOOG",
        timeframe: "weekly",
        indicator: "sequential",
        eventType: "setup_count",
        direction: "buy",
        count: 7,
        barDate: "d",
      },
    ]);
    expect(a2).toHaveLength(1);
    expect(a2[0]!.priority).toBe("info");
  });

  it("price_flip alerts are NOT generated (too noisy)", () => {
    const a = prepareAlertsForEvents([
      {
        id: "w",
        ticker: "T",
        timeframe: "daily",
        indicator: "sequential",
        eventType: "price_flip",
        direction: "buy",
        count: null,
        barDate: "d",
      },
    ]);
    expect(a).toHaveLength(0);
  });
});
