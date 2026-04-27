/**
 * Engine config — modern public-source defaults (`official_current_approx`).
 *
 * Extra preset variants live in `src/engine/presets.ts` and merge on top
 * of this default. The resolved config produces a deterministic
 * `configHash` (computed in `hashConfig`) that travels with every emitted
 * event so a stored event is only meaningful in tandem with the config
 * that produced it. See SPEC.md Appendix B + E.
 */

import { createHash } from "node:crypto";

export type SetupPerfectionMode = "strict" | "inclusive";
export type TdstAnchor = "extreme_of_setup" | "bar_1" | "bar_before_1";
export type TdstBreakoutTest = "true_range" | "close";
export type RecycleBehavior = "reset_to_new_setup" | "mark_R_only";
export type ComboVersion = "conservative_public" | "standard_public" | "aggressive_public";
export type EpsilonMode = "tick_aware" | "absolute" | "relative";

export interface EngineConfig {
  preset: string;

  setup: {
    length: number;
    lookback: number;
    strict: boolean;
    requirePriceFlip: boolean;
    allowExtensionBeyond9: boolean;
    perfection: {
      enabled: boolean;
      mode: SetupPerfectionMode;
      lookaheadBars: number;
    };
  };

  tdst: {
    anchor: TdstAnchor;
    breakoutTest: TdstBreakoutTest;
    persistAcrossCountdowns: boolean;
  };

  sequential: {
    countdownLength: number;
    countdownLookback: number;
    inclusive: boolean;
    startScan: "setup_bar_9";
    terminationCountValue: "close" | "open";
    intersection: { enabled: boolean };
    deferral: { lastVs8Enabled: boolean; eightVs5Enabled: boolean };
    cancellation: { opposingSetupEnabled: boolean; tdstViolationEnabled: boolean };
    recycle: {
      enabled: boolean;
      setupCountThreshold: number;
      rangeRatioMin: number;
      rangeRatioMax: number;
      behavior: RecycleBehavior;
    };
    twelveBarRulePostThirteen: boolean;
    fourBarRulePostNine: boolean;
  };

  combo: {
    version: ComboVersion;
    countdownLength: number;
    countdownLookback: number;
    startScan: "setup_bar_1";
    deferral: { lastVs8Enabled: boolean };
    cancellation: { opposingSetupEnabled: boolean; tdstViolationEnabled: boolean };
    recycle: { enabled: boolean; setupCountThreshold: number };
  };

  aggressive: { enabled: boolean };

  riskLevel: {
    enabled: boolean;
    generateOnSetup9: boolean;
    generateOnCountdown13: boolean;
    multiplier: number;
    processWindow: "countdown_process_including_unnumbered";
  };

  output: {
    emitEvents: boolean;
    emitBarAnnotations: boolean;
    includeFirstKnownAt: boolean;
  };

  data: {
    requireAdjustedOhlc: boolean;
    imputeMissingBars: boolean;
    epsilon: { mode: EpsilonMode; multiplier: number };
  };

  configHash: string;
}

export const DEFAULT_ENGINE_CONFIG: EngineConfig = {
  preset: "official_current_approx",

  setup: {
    length: 9,
    lookback: 4,
    strict: true,
    requirePriceFlip: true,
    allowExtensionBeyond9: true,
    perfection: {
      enabled: true,
      mode: "strict",
      lookaheadBars: 4,
    },
  },

  tdst: {
    anchor: "extreme_of_setup",
    breakoutTest: "true_range",
    persistAcrossCountdowns: true,
  },

  sequential: {
    countdownLength: 13,
    countdownLookback: 2,
    inclusive: true,
    startScan: "setup_bar_9",
    terminationCountValue: "close",
    intersection: { enabled: false },
    deferral: { lastVs8Enabled: true, eightVs5Enabled: false },
    cancellation: { opposingSetupEnabled: true, tdstViolationEnabled: true },
    recycle: {
      enabled: true,
      setupCountThreshold: 22,
      rangeRatioMin: 1.0,
      rangeRatioMax: 2.0,
      behavior: "reset_to_new_setup",
    },
    twelveBarRulePostThirteen: true,
    fourBarRulePostNine: true,
  },

  combo: {
    version: "standard_public",
    countdownLength: 13,
    countdownLookback: 2,
    startScan: "setup_bar_1",
    deferral: { lastVs8Enabled: false },
    cancellation: { opposingSetupEnabled: true, tdstViolationEnabled: true },
    recycle: { enabled: true, setupCountThreshold: 22 },
  },

  aggressive: { enabled: false },

  riskLevel: {
    enabled: true,
    generateOnSetup9: true,
    generateOnCountdown13: true,
    multiplier: 1.0,
    processWindow: "countdown_process_including_unnumbered",
  },

  output: {
    emitEvents: true,
    emitBarAnnotations: true,
    includeFirstKnownAt: true,
  },

  data: {
    requireAdjustedOhlc: true,
    imputeMissingBars: false,
    epsilon: { mode: "tick_aware", multiplier: 0.5 },
  },

  configHash: "",
};

/**
 * Hash everything but `configHash` itself. Stable JSON serialization with
 * sorted keys so two equivalent configs produce identical hashes.
 */
export function hashConfig(config: EngineConfig): string {
  const sortKeys = (val: unknown): unknown => {
    if (Array.isArray(val)) return val.map(sortKeys);
    if (val && typeof val === "object") {
      const obj = val as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(obj).sort()) {
        if (k === "configHash") continue;
        out[k] = sortKeys(obj[k]);
      }
      return out;
    }
    return val;
  };
  const json = JSON.stringify(sortKeys(config));
  return createHash("sha256").update(json).digest("hex");
}

/** Produce a config with `configHash` populated. */
export function resolveConfig(partial: Partial<EngineConfig> = {}): EngineConfig {
  const merged: EngineConfig = {
    ...DEFAULT_ENGINE_CONFIG,
    ...partial,
    setup: { ...DEFAULT_ENGINE_CONFIG.setup, ...(partial.setup ?? {}) },
    tdst: { ...DEFAULT_ENGINE_CONFIG.tdst, ...(partial.tdst ?? {}) },
    sequential: {
      ...DEFAULT_ENGINE_CONFIG.sequential,
      ...(partial.sequential ?? {}),
    },
    combo: { ...DEFAULT_ENGINE_CONFIG.combo, ...(partial.combo ?? {}) },
    aggressive: { ...DEFAULT_ENGINE_CONFIG.aggressive, ...(partial.aggressive ?? {}) },
    riskLevel: { ...DEFAULT_ENGINE_CONFIG.riskLevel, ...(partial.riskLevel ?? {}) },
    output: { ...DEFAULT_ENGINE_CONFIG.output, ...(partial.output ?? {}) },
    data: { ...DEFAULT_ENGINE_CONFIG.data, ...(partial.data ?? {}) },
    configHash: "",
  };
  merged.configHash = hashConfig(merged);
  return merged;
}
