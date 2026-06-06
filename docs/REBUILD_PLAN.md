# Dashboard Rebuild Plan — Phase 5 (revised)

**Date:** 2026-06-06
**Design reference:** `demark-redesign.html` (approved mockup) + `DASHBOARD-REDESIGN-SPEC.md` (incl. addendum)

---

## 1. Where we actually are

| Surface | State |
|---|---|
| GitHub `main` | `2ded659` — Phase 3 only (Apr 27). Nothing merged since. |
| Vercel production | Same commit. The deployed layout = Phase 3 hero + rails. |
| `phase-4` branch | `ff69c48` — built, preview green, **never PR'd, never merged**. |
| `phase5/pr1` bundle | Staged locally (rebased Phase 4 re-merge), PR never opened. |
| Phase 5 PRs 2–4 (old plan) | Never built. |

The redesign **replaces** the hero + rails concept, which retires part of the old Phase 4/5 plan
(hero history, hero translations as the centerpiece, ConfluenceDots, HitRatePill, ranking-as-layout).
This plan supersedes the old Phase 5 PR breakdown.

## 2. Locked decisions

1. **Bias meter source (spec §8.1):** DeMark-derived (Sequential/Combo state), not the blended
   confluence score. One scale, owned by the composer.
2. **Composite override (§8.2):** a completed composite (9-13, 13-9-13, 9-13-9) overrides the
   verdict label over a lone 13.
3. **Recycling (§8.3):** engine default is `reset_to_new_setup` — UI shows the reset count plus
   the `↻ recycled at bar N` callout. (`mark_R_only` config renders ↻ over the intact bar.)
4. **Perfection on Combo (§8.5):** perfection is a property of the *Setup*, which both methods
   share — the perfection flag renders on the setup chip of both rows identically.
5. **M/Y availability (§8.4):** resampling always computes all four timeframes; if a timeframe has
   fewer bars than a Setup needs, the strip cell renders neutral-dimmed `·`.
6. **Contract addition:** `eventDate` on `TimeframeSignal` (date current state was produced) —
   drives the NEW badge and signal age. Sourced from the latest state-changing `signal_event`.
7. **Indicators stay** (RSI, MACD, EMA, BB, ADX, Ichimoku, W%R, Donchian, VWAP, ATR) — new
   engine scope, built last so the cards ship first.
8. **Hero history is dropped.** `recordTodaysHero`/`daysAsHeroFor` never merge; the
   `hero_history` table stays dormant in the schema (harmless) until a cleanup migration.

## 3. PR sequence

Delivery via Claude Code working directly in the repo: one branch + one GitHub PR per item below,
branched from fresh `main`; **stop after opening each PR for Codex review**; address P1–P3 comments
with follow-up commits on the same PR before starting the next. (The old `phase5/prN/` bundle-folder
pattern is retired — it existed for chat-based delivery.)

### PR 1 — Phase 4 salvage (trimmed)
Re-merge the still-wanted Phase 4 work; the cards need a tap-through destination.
- **In:** `/ticker/[symbol]` page, `GET /api/bars/:symbol`, `TickerChart`, `SignalTimeline`,
  `BacktestPanel` placeholder, their tests + smoke script.
- **Out:** `hero-history.ts`, `hero-history.test.ts`, any `dashboard.ts` change — main's
  `dashboard.ts` ships untouched, which removes the old rebase-trap entirely.
- **Source:** cherry-pick files from the `phase-4` branch (`ff69c48`) — do **not** merge the
  branch wholesale; it contains the hero-history wiring and a pre-rebase `dashboard.ts`.

### PR 2 — Combo test coverage
The redesign puts Combo on every card; lock its correctness before the UI leans on it.
- Combo unit tests + canonical fixtures; combo translation templates.
- Pure test/fixture PR — no runtime changes.

### PR 3 — `TickerSignal` composer + API
The engine→UI contract from spec §4 (+ `eventDate`), server-side.
- `src/server/ticker-signal.ts`: per-ticker composer — CardState derivation (§6.1), DeMark-derived
  bias, composite/recycling surfacing, TDST + risk levels, `eventDate` per timeframe.
- Conflict detection (§6.3) ships DeMark-vs-higher-timeframe only; the momentum side activates in PR 6.
- New `GET /api/dashboard` payload (versioned or parallel route); old composer stays until PR 4 flips the page.
- Unit tests pinning §6.1 priority order + bias bounds; smoke script.
- `edge` and `indicators` fields present but null/empty — UI contract complete from day one.

### PR 4 — Dashboard UI rebuild
`demark-redesign.html` becomes React. Visual parity with the mockup is the acceptance test.
- Tokens into `globals.css`; components: `SummaryBar`, `SignalCard` (+ `BiasMeter`,
  `TimeframeStrip`, `DemarkModule`, `LevelCells`, `IndicatorStrip`, `EdgeFooter`), `ScanRow`,
  cards/scan toggle, group separators, urgency sort, NEW/stale badges, % level distances.
- `page.tsx` flips to the new composer. Retire `Hero`, `RailSection`, `ConfluenceDots`,
  `HitRatePill`, `RankingFactorsExpander`, `Sparkline` + old composer path.
- Edge footer and indicator strip render their degraded/absent states.

### PR 5 — Backtest materialization → real edge stats
- `signal_hit_rates` populated per the no-lookahead discipline (`entryBar = firstKnownAtDate + 1`).
- Composer fills `EdgeStats` (win rate, avg return, PF, sample, lookback, validated); confidence
  styling (§6.4) goes live; real `BacktestPanel` replaces the Phase 4 placeholder.

### PR 6 — Indicator engine
- `src/indicators/`: RSI(14), MACD, EMA pair, Bollinger, ADX, Ichimoku, Williams %R, Donchian,
  VWAP (rolling typical-price×volume proxy — true VWAP is intraday; flag in README), ATR.
- Tone rules (§6.5) computed engine-side; `indicators[]` into the composer; momentum-side conflict
  detection + the `Mom n↑ n↓` net read activate.

## 4. Docs
- PR 3 folds `DASHBOARD-REDESIGN-SPEC.md` (+ addendum) into `SPEC.md` as the Dashboard/UI section,
  replacing the hero + rails layout sections; `TickerSignal` becomes the documented engine output schema.

## 5. Out of scope
Phase 6 polish from the original SPEC (alerts UX, cron hardening, ops) — unchanged, follows after PR 6.
