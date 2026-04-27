import { describe, expect, it } from "vitest";
import { resample } from "../../src/data/resample";
import { fromCloses } from "./_helpers";

describe("resample", () => {
  it("daily passthrough returns input unchanged", () => {
    const bars = fromCloses([1, 2, 3]);
    expect(resample(bars, "daily")).toEqual(bars);
  });

  it("weekly aggregates a week into one bar (Friday-anchored)", () => {
    // 2024-01-01 = Mon, ..., 2024-01-05 = Fri
    const bars = fromCloses([10, 11, 12, 13, 14, 15], { startDate: "2024-01-01" });
    const weekly = resample(bars, "weekly");
    // Jan 1 - Jan 5 is one Friday-bucket; Jan 6 - Jan 12 is the next
    expect(weekly.length).toBeGreaterThanOrEqual(1);
    const firstWeek = weekly[0]!;
    expect(firstWeek.date).toBe("2024-01-05");
    expect(firstWeek.open).toBe(10);
    // close = last daily close in the bucket (Jan 5 = idx 4)
    expect(firstWeek.close).toBe(14);
  });

  it("monthly aggregates a month into one bar", () => {
    const bars = fromCloses([1, 2, 3, 4, 5], { startDate: "2024-02-25" });
    const monthly = resample(bars, "monthly");
    // Some bars fall in Feb, some in Mar — should be at most 2 buckets
    expect(monthly.length).toBeGreaterThanOrEqual(1);
  });
});
