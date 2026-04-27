/**
 * Parity check between the TS engine and a small set of fixtures.
 *
 * v1 ships with smoke fixtures only — the full canonical / legacy /
 * external fixture corpus described in SPEC.md §9 Phase 2 Task 9 lands as
 * Phase 2 work continues. This script reads any `tests/engine/fixtures/​**​/*.bars.csv`
 * file and compares the engine's per-bar annotations against the matching
 * `*.expected.json` file.
 *
 * Exit 0 = parity. Exit 1 = divergence (with a unified-style diff to stderr).
 */

import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { DeMarkEngine } from "../src/engine";
import type { Bar } from "../src/engine/types";

const FIXTURE_ROOT = join(process.cwd(), "tests/engine/fixtures");

interface FixtureMatch {
  name: string;
  barsCsv: string;
  expectedJson: string;
}

function findFixtures(root: string): FixtureMatch[] {
  if (!existsSync(root)) return [];
  const out: FixtureMatch[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const s = statSync(full);
      if (s.isDirectory()) {
        walk(full);
        continue;
      }
      if (entry.endsWith(".bars.csv")) {
        const base = full.slice(0, -".bars.csv".length);
        const expected = `${base}.expected.json`;
        if (existsSync(expected)) {
          out.push({ name: base.slice(root.length + 1), barsCsv: full, expectedJson: expected });
        }
      }
    }
  };
  walk(root);
  return out;
}

function parseBars(csv: string): Bar[] {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length === 0) return [];
  const header = lines[0]!.split(",").map((h) => h.trim());
  const idx = (k: string) => header.indexOf(k);
  const di = idx("date");
  const oi = idx("open");
  const hi = idx("high");
  const li = idx("low");
  const ci = idx("close");
  const vi = idx("volume");
  if (di < 0 || oi < 0 || hi < 0 || li < 0 || ci < 0) {
    throw new Error("CSV missing required headers (date, open, high, low, close)");
  }
  return lines.slice(1).map((line) => {
    const cols = line.split(",");
    return {
      date: cols[di]!,
      open: Number(cols[oi]),
      high: Number(cols[hi]),
      low: Number(cols[li]),
      close: Number(cols[ci]),
      volume: vi >= 0 && cols[vi] != null ? Number(cols[vi]) : undefined,
    };
  });
}

interface ExpectedFixture {
  events?: Array<Record<string, unknown>>;
  // Other diffable shapes can be added as the corpus grows.
}

function diffEvents(actual: ReturnType<DeMarkEngine["run"]>["events"], expected: ExpectedFixture): string[] {
  const errors: string[] = [];
  if (!expected.events) return errors;
  const projected = actual.map((e) => ({
    eventType: e.eventType,
    direction: e.direction,
    indicator: e.indicator,
    count: e.count,
    barDate: e.barDate,
  }));
  if (projected.length !== expected.events.length) {
    errors.push(`event count mismatch: actual=${projected.length} expected=${expected.events.length}`);
  }
  const n = Math.min(projected.length, expected.events.length);
  for (let i = 0; i < n; i++) {
    const a = projected[i]!;
    const e = expected.events[i]!;
    for (const key of Object.keys(e)) {
      if ((a as Record<string, unknown>)[key] !== e[key]) {
        errors.push(
          `event #${i} mismatch on key ${key}: actual=${JSON.stringify(
            (a as Record<string, unknown>)[key],
          )} expected=${JSON.stringify(e[key])}`,
        );
      }
    }
  }
  return errors;
}

function main() {
  const fixtures = findFixtures(FIXTURE_ROOT);
  if (fixtures.length === 0) {
    console.log("ℹ no fixtures present yet — parity check is a no-op for v1 smoke");
    process.exit(0);
  }
  let failed = 0;
  for (const f of fixtures) {
    const bars = parseBars(readFileSync(f.barsCsv, "utf8"));
    const expected = JSON.parse(readFileSync(f.expectedJson, "utf8")) as ExpectedFixture;
    const engine = new DeMarkEngine();
    const result = engine.run(bars);
    const errors = diffEvents(result.events, expected);
    if (errors.length === 0) {
      console.log(`✓ ${f.name}`);
    } else {
      failed++;
      console.error(`✗ ${f.name}`);
      for (const e of errors) console.error(`  ${e}`);
    }
  }
  if (failed > 0) {
    console.error(`\n${failed} fixture(s) failed`);
    process.exit(1);
  }
  console.log(`\nAll ${fixtures.length} fixtures passed.`);
  process.exit(0);
}

main();
