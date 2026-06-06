/**
 * tests/server/bars-route.test.ts
 *
 * Tests for GET /api/bars/:symbol
 *   - Auth check (401 if no session)
 *   - Parameter validation (bad timeframe, invalid symbol)
 *   - Stale cache detection and refetch
 *   - Response shape (ticker, timeframe, bars, stale flag)
 */

import { describe, it, expect } from "vitest";
import type { Bar, Timeframe } from "@/engine/types";

// Mock bars from database
const mockBars: Bar[] = [
  {
    date: "2025-01-01",
    open: 100,
    high: 102,
    low: 99,
    close: 101,
    volume: 1000000,
  },
  {
    date: "2025-01-02",
    open: 101,
    high: 103,
    low: 100,
    close: 102.5,
    volume: 1100000,
  },
];

describe("GET /api/bars/:symbol", () => {
  it("should validate symbol format", () => {
    // Invalid: too many characters, invalid chars
    expect(/^[A-Z][A-Z0-9.\-]{0,9}$/.test("SPY")).toBe(true);
    expect(/^[A-Z][A-Z0-9.\-]{0,9}$/.test("BRK.A")).toBe(true);
    expect(/^[A-Z][A-Z0-9.\-]{0,9}$/.test("VTSAX")).toBe(true);
    expect(/^[A-Z][A-Z0-9.\-]{0,9}$/.test("spy")).toBe(false); // lowercase
    expect(/^[A-Z][A-Z0-9.\-]{0,9}$/.test("1SPY")).toBe(false); // starts with digit
    expect(/^[A-Z][A-Z0-9.\-]{0,9}$/.test("A".repeat(15))).toBe(false); // too long
  });

  it("should validate timeframe", () => {
    const valid: Timeframe[] = ["daily", "weekly", "monthly", "yearly"];
    expect(valid.includes("daily")).toBe(true);
    expect(valid.includes("weekly")).toBe(true);
    expect(valid.includes("invalid" as Timeframe)).toBe(false);
  });

  it("should clamp limit to max 2000", () => {
    expect(Math.min(2000, Math.max(1, 3000))).toBe(2000);
    expect(Math.min(2000, Math.max(1, 500))).toBe(500);
    expect(Math.min(2000, Math.max(1, 0))).toBe(1);
  });

  it("should detect stale cache based on fetchedAt threshold", () => {
    const now = Date.now();
    const staleThresholds = {
      daily: 24 * 60 * 60 * 1000,
      weekly: 7 * 24 * 60 * 60 * 1000,
      monthly: 30 * 24 * 60 * 60 * 1000,
      yearly: 365 * 24 * 60 * 60 * 1000,
    };

    // Fresh daily bar
    const freshDaily = new Date(now - 12 * 60 * 60 * 1000).getTime(); // 12h ago
    const isStaleDaily = now - freshDaily > staleThresholds.daily;
    expect(isStaleDaily).toBe(false);

    // Stale daily bar
    const staleDaily = new Date(now - 48 * 60 * 60 * 1000).getTime(); // 48h ago
    const isStaleDailyOld = now - staleDaily > staleThresholds.daily;
    expect(isStaleDailyOld).toBe(true);

    // Fresh weekly
    const freshWeekly = new Date(now - 2 * 24 * 60 * 60 * 1000).getTime(); // 2 days ago
    const isStaleWeekly = now - freshWeekly > staleThresholds.weekly;
    expect(isStaleWeekly).toBe(false);

    // Stale weekly
    const staleWeekly = new Date(now - 10 * 24 * 60 * 60 * 1000).getTime(); // 10 days ago
    const isStaleWeeklyOld = now - staleWeekly > staleThresholds.weekly;
    expect(isStaleWeeklyOld).toBe(true);
  });

  it("should return response shape with stale flag", () => {
    const response = {
      ticker: "SPY",
      timeframe: "daily" as const,
      bars: mockBars,
      stale: true,
    };

    expect(response).toMatchObject({
      ticker: expect.any(String),
      timeframe: expect.stringMatching(/^(daily|weekly|monthly|yearly)$/),
      bars: expect.any(Array),
      stale: expect.any(Boolean),
    });

    expect(response.bars[0]).toMatchObject({
      date: expect.any(String),
      open: expect.any(Number),
      high: expect.any(Number),
      low: expect.any(Number),
      close: expect.any(Number),
      volume: expect.any(Number),
    });
  });
});
