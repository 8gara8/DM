# Claude Code Handoff — DM Dashboard Rebuild

**Date:** 2026-06-06 · **Repo:** github.com/8gara8/DM

This briefing transfers the dashboard-redesign work to Claude Code. Read it fully before
touching code; it corrects assumptions a fresh agent would otherwise make from the repo alone.

---

## 0. Kickoff prompt (paste this into Claude Code)

> Read CLAUDE-CODE-HANDOFF.md, REBUILD_PLAN.md, and DASHBOARD-REDESIGN-SPEC.md before doing
> anything. We are replacing the Phase 3 hero+rails dashboard with the card-grid design in
> demark-redesign.html. Follow REBUILD_PLAN.md §3 exactly: one branch + one PR per item,
> starting with PR 0 (docs) then PR 1 (Phase 4 salvage). After opening each PR, STOP and wait —
> I run a Codex review on every PR; address its P1/P2/P3 comments on the same PR before starting
> the next one. Never commit directly to main (except PR 0 if I say so). Verify locally before
> every push: pnpm typecheck && pnpm lint && pnpm build && pnpm vitest.

## 1. Where to run

Run Claude Code in a **fresh clone of github.com/8gara8/DM on `main`** — NOT in this
DeMark mirror folder. The mirror's working tree is the legacy Python state plus stale `phaseN/`
staging folders; `main` on GitHub is the only source of truth for the TS app.

Copy these four files from the mirror into the clone first (PR 0 below):

| File | Destination in repo |
|---|---|
| `CLAUDE-CODE-HANDOFF.md` | `docs/HANDOFF.md` |
| `REBUILD_PLAN.md` | `docs/REBUILD_PLAN.md` |
| `DASHBOARD-REDESIGN-SPEC.md` | `docs/DASHBOARD-REDESIGN-SPEC.md` |
| `demark-redesign.html` | `docs/demark-redesign.html` |

## 2. Ground truth (verified 2026-06-06 against GitHub + Vercel)

- `main` = `2ded659` — **Phase 3 only** (data layer + scan + hero/rails dashboard). Nothing
  merged since 2026-04-27. Vercel production (`dm` project) runs this same commit.
- `phase-4` branch = `ff69c48` — ticker detail + charts + hero history. Built, previews green,
  **never merged**. Treat as a file source for PR 1, never merge it as a branch.
- TD Combo, composite (9-13-9 etc.), backtest **engine** code already landed on main in Phase 3
  (`src/engine/`), but Combo has no test coverage and the backtest *materialization pipeline*
  (`signal_hit_rates` population) does not exist.
- The repo's `SPEC.md` §9 phase plan is **superseded for the dashboard** by
  `docs/REBUILD_PLAN.md` + `docs/DASHBOARD-REDESIGN-SPEC.md`. Engine behavior sections of
  `SPEC.md` and `DeMark_Technical_Specification.md` remain authoritative.

## 3. The direction change (why the dashboard work restarts)

The Phase 3 layout (Hero + 3 rails + confluence dots + 0–100 ranking surfaces) is rejected.
The replacement is a card-grid: one `SignalCard` per ticker (verdict sentence → bias meter →
D/W/M/Y strip → DeMark module → levels → indicator strip → edge footer), a summary bar with
state-count filters, urgency sort with group separators, and a compact scan-mode toggle.
`docs/demark-redesign.html` is the **pixel reference** — open it in a browser; it is fully
interactive and renders from sample data shaped exactly like the §4 `TickerSignal` contract.

Consequences a fresh agent must respect:

- **Retired at PR 4:** `Hero`, `RailSection`, `ConfluenceDots`, `HitRatePill`,
  `RankingFactorsExpander`, `Sparkline`, the hero translation templates as a dashboard
  centerpiece, and the old composer payload.
- **Never merging:** `hero-history.ts` wiring from the phase-4 branch (`recordTodaysHero`,
  `daysAsHeroFor`). The `hero_history` table stays dormant in the schema for now.
- **Bias meter** is DeMark-derived (spec Addendum A3). Do not resurrect the blended score.
- **New contract field:** `TimeframeSignal.eventDate` (drives NEW badge + signal age).

## 4. Workflow rules (non-negotiable)

1. One PR at a time, in REBUILD_PLAN.md §3 order. Branch from fresh `main` each time.
2. After opening a PR: **stop**. The user runs Codex review. Codex comments tagged P1/P2/P3 are
   load-bearing — fix them in follow-up commits on the same PR before the next PR begins.
3. Before every push: `pnpm typecheck && pnpm lint && pnpm build && pnpm vitest` all green.
   ESLint warnings break `next build` in this repo — treat warnings as errors.
4. Preserve the Codex fixes already on main, especially in `src/server/dashboard.ts`
   (`inArray` in `loadStates`, watchlist-scoping in `loadRecentlyPrinted`) and the
   `signal_states` PK including `direction`. PR 1 must not touch `dashboard.ts` at all.
5. Schema changes go through drizzle-kit regeneration, mirroring how Phase 3 handled it.

## 5. PR sequence (detail in docs/REBUILD_PLAN.md §3)

- **PR 0 — docs:** add the four files under `docs/`. No code. Fast review.
- **PR 1 — Phase 4 salvage:** `/ticker/[symbol]`, `/api/bars/[symbol]`, `TickerChart`,
  `SignalTimeline`, `BacktestPanel` placeholder + tests, cherry-picked from `phase-4`
  (`ff69c48`), minus hero-history, zero `dashboard.ts` changes. Note: that branch's chart uses
  lightweight-charts v4 API (`addCandlestickSeries`) — keep v4 pinned or migrate to v5
  deliberately, not accidentally.
- **PR 2 — Combo test coverage:** unit tests + canonical fixtures + combo translation templates.
- **PR 3 — `TickerSignal` composer + API** (`src/server/ticker-signal.ts`), per spec §4 + §6.1,
  `eventDate` from signal_events, edge/indicators emitted empty. Old composer untouched.
- **PR 4 — UI rebuild:** mockup → React components, `page.tsx` flips, old components retired.
  Acceptance = visual parity with `docs/demark-redesign.html`.
- **PR 5 — backtest materialization:** populate `signal_hit_rates` (no-lookahead:
  `entryBar = firstKnownAtDate + 1`), real `EdgeStats`, real `BacktestPanel`.
- **PR 6 — indicator engine:** `src/indicators/` (RSI, MACD, EMA, BB, ADX, Ichimoku, W%R,
  Donchian, VWAP-proxy, ATR), §6.5 tone rules, momentum conflict + `Mom n↑ n↓`.

## 6. Known traps

- `phase5/pr1/` and other `phaseN/` folders in the old mirror are **stale staging artifacts** —
  superseded by this handoff. If their content disagrees with REBUILD_PLAN.md, the plan wins.
- The redesign spec's original §9 merge notes assumed wrong phase numbering and a Python engine —
  corrected in its Addendum A4. The engine is TypeScript.
- The 30s per-user dashboard cache in `dashboard.ts` — the new composer (PR 3) needs equivalent
  caching or scans will hammer libSQL.
- Yahoo provider: keep the cached client pattern (`yahoo-finance2` v3, single client per
  provider instance) — regression history on PR #3.
