/**
 * Hero translation registry.
 *
 * Each template is a pure function from a `TranslationInput` to either
 * `null` (precondition didn't match) or `{ text, templateId }`. Templates
 * are tried in priority order; the first match wins. If none match, fall
 * back to a generic factual sentence so the hero is never empty.
 *
 * Reserved-word dictionary (per SPEC.md Appendix D.2):
 *   - "stacked"   → confluence templates only
 *   - "perfected" → perfected-9 templates only
 *   - "premium"   → 9-13-9 composite only
 *
 * Sentences are at most 25 words, third-person register, end in period.
 * Each template ships with a unit test in `tests/lib/translations.test.ts`.
 */

import type { Direction, Indicator, Timeframe } from "@/engine/types";

export interface TranslationInput {
  /** Top-line signal in the hero. */
  primary: {
    direction: Direction;
    indicator: Indicator;
    phase: "setup" | "countdown";
    count: number;
    max: 9 | 13;
    timeframe: Timeframe;
    isPerfected: boolean;
    isQualified: boolean;
    isDeferred: boolean;
    isJust9_13_9: boolean;
  };
  /** Other-timeframe signals on the same ticker that point the same way. */
  confluence: Array<{
    direction: Direction;
    indicator: Indicator;
    phase: "setup" | "countdown";
    count: number;
    max: 9 | 13;
    timeframe: Timeframe;
  }>;
  /** Most recent cancellation reason, if the hero is a cancellation. */
  cancelReason?: string;
  /** Bars elapsed since the most recent 13 (for lapsed-13). */
  barsSince13?: number;
  /** Recycled this scan? */
  isRecycled?: boolean;
  /** Risk-level breach? */
  isRiskBreach?: boolean;
}

export type TranslationResult = { text: string; templateId: string };
export type Template = (input: TranslationInput) => TranslationResult | null;

const dirLabel = (d: Direction): string => (d === "buy" ? "Buy" : "Sell");
const tfLabel = (t: Timeframe): string => t;

function findSameDirOtherTfConfluence(input: TranslationInput) {
  return input.confluence.filter(
    (c) => c.direction === input.primary.direction && c.timeframe !== input.primary.timeframe,
  );
}

// ── Templates (priority order) ────────────────────────────────────────────

export const tplPerfected9WithImminent13OtherTf: Template = (i) => {
  const p = i.primary;
  if (!(p.phase === "setup" && p.count === 9 && p.isPerfected)) return null;
  const conf = findSameDirOtherTfConfluence(i).find(
    (c) => c.phase === "countdown" && c.count >= 11 && c.max === 13,
  );
  if (!conf) return null;
  const dir = dirLabel(p.direction);
  return {
    templateId: "perfected-9-with-imminent-13-other-tf",
    text: `${dir} Setup 9 perfected on the ${tfLabel(p.timeframe)} with a ${dir} Countdown ${conf.count}/13 building on the ${tfLabel(conf.timeframe)} — reversal pressure stacked across both timeframes.`,
  };
};

export const tplPerfected9NoConfluence: Template = (i) => {
  const p = i.primary;
  if (!(p.phase === "setup" && p.count === 9 && p.isPerfected)) return null;
  if (findSameDirOtherTfConfluence(i).length > 0) return null;
  const dir = dirLabel(p.direction);
  return {
    templateId: "perfected-9-no-confluence",
    text: `${dir} Setup 9 perfected on the ${tfLabel(p.timeframe)} — single-timeframe reversal signal.`,
  };
};

export const tplQualified13: Template = (i) => {
  const p = i.primary;
  if (!(p.phase === "countdown" && p.count === 13 && p.isQualified)) return null;
  const dir = dirLabel(p.direction);
  return {
    templateId: "qualified-13",
    text: `${dir} Countdown 13 just qualified on the ${tfLabel(p.timeframe)} — primary reversal signal printed.`,
  };
};

export const tplJust9_13_9: Template = (i) => {
  if (!i.primary.isJust9_13_9) return null;
  return {
    templateId: "9-13-9-composite",
    text: `9-13-9 composite on the ${tfLabel(i.primary.timeframe)} — premium reversal pattern.`,
  };
};

export const tplImminent13: Template = (i) => {
  const p = i.primary;
  if (!(p.phase === "countdown" && p.count >= 11 && p.count < 13)) return null;
  const dir = dirLabel(p.direction);
  return {
    templateId: "imminent-13",
    text: `${dir} Countdown ${p.count}/13 on the ${tfLabel(p.timeframe)} — 1 to 2 bars from completion.`,
  };
};

export const tplDeferred13: Template = (i) => {
  const p = i.primary;
  if (!(p.phase === "countdown" && p.count >= 12 && p.isDeferred)) return null;
  const dir = dirLabel(p.direction);
  return {
    templateId: "deferred-13",
    text: `${dir} Countdown at ${p.count}+ on the ${tfLabel(p.timeframe)} — awaiting a bar that satisfies both rules.`,
  };
};

export const tplImminent9: Template = (i) => {
  const p = i.primary;
  if (!(p.phase === "setup" && p.count >= 7 && p.count < 9)) return null;
  const dir = dirLabel(p.direction);
  return {
    templateId: "imminent-9",
    text: `${dir} Setup at ${p.count}/9 on the ${tfLabel(p.timeframe)} — 1 to 2 bars from completion.`,
  };
};

export const tplMultiTfConfluence: Template = (i) => {
  const others = findSameDirOtherTfConfluence(i);
  if (others.length === 0) return null;
  const dir = dirLabel(i.primary.direction);
  const tf1 = tfLabel(i.primary.timeframe);
  const tf2 = tfLabel(others[0]!.timeframe);
  return {
    templateId: "multi-tf-confluence",
    text: `${dir} signal stacked across ${tf1} and ${tf2} — both timeframes pointing the same direction.`,
  };
};

export const tplCancelledRecently: Template = (i) => {
  const p = i.primary;
  if (!i.cancelReason) return null;
  const dir = dirLabel(p.direction);
  return {
    templateId: "cancelled-recently",
    text: `${dir} Countdown ${p.count}/13 cancelled on the ${tfLabel(p.timeframe)} (${i.cancelReason}).`,
  };
};

export const tplRecycled: Template = (i) => {
  if (!i.isRecycled) return null;
  const dir = dirLabel(i.primary.direction);
  return {
    templateId: "recycled",
    text: `${dir} Setup recycled on the ${tfLabel(i.primary.timeframe)} — momentum still extending.`,
  };
};

export const tplRiskBreach: Template = (i) => {
  if (!i.isRiskBreach) return null;
  const dir = dirLabel(i.primary.direction);
  return {
    templateId: "risk-breach",
    text: `${dir} 13 invalidated by Risk Level breach on the ${tfLabel(i.primary.timeframe)}.`,
  };
};

export const tplLapsed13: Template = (i) => {
  const p = i.primary;
  if (!(p.phase === "countdown" && p.count === 13)) return null;
  if (i.barsSince13 == null || i.barsSince13 < 12) return null;
  const dir = dirLabel(p.direction);
  return {
    templateId: "lapsed-13",
    text: `${dir} 13 from ${i.barsSince13} bars ago on the ${tfLabel(p.timeframe)} — no reversal yet.`,
  };
};

const TEMPLATES: Template[] = [
  // High-information first
  tplJust9_13_9,
  tplRiskBreach,
  tplCancelledRecently,
  tplQualified13,
  tplPerfected9WithImminent13OtherTf,
  tplPerfected9NoConfluence,
  tplDeferred13,
  tplImminent13,
  tplLapsed13,
  tplImminent9,
  tplRecycled,
  tplMultiTfConfluence,
];

function genericFactual(i: TranslationInput): TranslationResult {
  const p = i.primary;
  return {
    templateId: "generic-factual",
    text: `${dirLabel(p.direction)} ${p.phase === "setup" ? "Setup" : "Countdown"} ${p.count}/${p.max} on ${tfLabel(p.timeframe)}.`,
  };
}

export function translate(input: TranslationInput): TranslationResult {
  for (const tpl of TEMPLATES) {
    const r = tpl(input);
    if (r) return r;
  }
  return genericFactual(input);
}

export const _internal = { TEMPLATES, genericFactual };
