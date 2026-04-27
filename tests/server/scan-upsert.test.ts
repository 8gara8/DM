import { describe, expect, it } from "vitest";
import { signalStates } from "@/lib/db/schema";
import { getTableConfig } from "drizzle-orm/sqlite-core";

describe("signalStates schema (Codex P1)", () => {
  it("primary key includes direction so buy + sell snapshots can co-exist", () => {
    const cfg = getTableConfig(signalStates);
    const pkCols = cfg.primaryKeys[0]?.columns.map((c) => c.name).sort();
    expect(pkCols).toEqual(["direction", "indicator", "ticker", "timeframe"]);
  });
  it("direction is NOT NULL (so it can be in the PK)", () => {
    const cfg = getTableConfig(signalStates);
    const direction = cfg.columns.find((c) => c.name === "direction");
    expect(direction).toBeDefined();
    expect(direction!.notNull).toBe(true);
  });
});
