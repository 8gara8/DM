/**
 * Snapshot helpers — serialize/restore are wrappers around `DeMarkEngine`
 * static methods, kept here so callers that only want to manipulate the
 * snapshot blob (e.g. the scan orchestrator persisting it to the DB)
 * don't have to import the whole engine.
 */

import type { EngineSnapshot } from "./types";

export function isSnapshotCompatible(
  snapshot: EngineSnapshot,
  configHash: string,
): boolean {
  return snapshot.configHash === configHash;
}

export function emptySnapshot(configHash: string): EngineSnapshot {
  return {
    configHash,
    asOfBarDate: "",
    asOfBarIndex: -1,
    trackers: [],
    flipState: { lastBarIndex: -1 },
  };
}
