# Dashboard Redesign — UI Spec

> **Scope.** This documents the **presentation layer only** — card layout, the engine→UI data
> contract, design tokens, and signal-state rules. It is meant to be merged in as the
> *Dashboard / UI* section of the existing build spec. It deliberately does **not** restate
> stack, data pipeline, SQLite schema, scheduling, or deployment — those live in the prior spec
> and are unchanged.
>
> **Status of fields.** Items marked `[example]` are inferred from reference screenshots.
> Items marked `[spec]` come from our own build spec (composites, recycling, perfection,
> four timeframes). Items marked `[TBD]` need a decision — see §8.

---

## 1. Design Principles

These five rules drive every layout decision below. When in doubt, defer to them.

1. **The DeMark event is the headline.** This is a DeMark monitor, so the TD event (a completed
   13, an approaching 13, a perfected Setup 9) is the verdict — not a generic 0–100 score buried
   under indicators.
2. **Color = signal, nothing else.** Surfaces are neutral. Red/green/amber are reserved for
   directional signal state. If everything is colored, nothing reads.
3. **One verdict, one scale.** Collapse the competing scores (0–100 circle, per-signal score,
   Buy/Sell-out-of-100) into a single **bias meter** (sell ↔ buy). Position encodes strength.
4. **Surface conflict, don't hide it.** When DeMark disagrees with momentum or a higher
   timeframe, show it explicitly (⚠ chip). The disagreement *is* the decision.
5. **Confidence is visible.** A signal with a weak/unproven backtest must *look* weak. Edge
   styling degrades for low sample size or negative expectancy.
6. **Progressive disclosure.** Default card is scannable. Full indicator set, per-stock weights,
   and raw countdown rows live behind a tap.

---

## 2. Information Hierarchy (top → bottom inside a card)

| Tier | Element | Question it answers |
|------|---------|---------------------|
| 1 | Identity + price | What is this, where, how much |
| 2 | Verdict + bias meter | What's the signal and how strong |
| 3 | Timeframe strip | Does the signal hold across D/W/M/Y |
| 4 | Context chips | Regime + any conflict |
| 5 | DeMark module | *Why* — Sequential, Combo, composites, recycling |
| 6 | Levels | Where are stop / TDST |
| 7 | Indicator strip | Supporting reads (muted) |
| 8 | Edge footer | Is this signal historically worth taking |

---

## 3. Design Tokens

Drop-in CSS variables (already used in the mockup; keep them as the single source of truth).

```css
:root{
  /* surfaces */
  --bg:#0a0d12; --panel:#11151c; --panel-2:#151a23;
  --line:#212834; --line-soft:#1a212b;
  /* text */
  --text:#e9eef4; --muted:#8a94a3; --faint:#5b6470;
  /* signal */
  --buy:#34c98a;  --buy-dim:#1d6b4d;
  --sell:#f25b53; --sell-dim:#7a322e;
  --warn:#eaa83c; --warn-dim:#7a5a1f;
  --slate:#71808f; --info:#5c9fe6;
  /* type */
  --mono:'IBM Plex Mono', ui-monospace, monospace;   /* labels, all numbers */
  --sans:'IBM Plex Sans', -apple-system, sans-serif; /* names, verdict words */
}
```

**Typography rules.** All numerics (price, levels, counts, %) use `--mono` with tabular figures
so columns align. Micro-labels are `--mono`, uppercase, `letter-spacing:.08–.12em`. Verdict words
and company names are `--sans` 600.

**Spacing.** Card padding `16–18px`. Vertical rhythm between modules `13–14px`. Module separators
are `1px solid var(--line-soft)`, never a heavy rule.

**Card accent.** 3px left strip, colored by `CardState` (§6). This is the only always-on color.

---

## 4. Data Contract (engine → UI)

This is the contract the dashboard renders against. The engine should emit one `TickerSignal`
per ticker per scan. **This is the most important section to merge** — it's the interface between
the Python engine output and the Next.js dashboard.

```ts
type Direction = "buy" | "sell" | "none";
type CardState = "sell" | "buy" | "approaching" | "watch" | "neutral";
type Timeframe = "daily" | "weekly" | "monthly" | "yearly";

interface SetupState {            // count to 9
  direction: Direction;
  count: number;                  // 0–9
  complete: boolean;
  perfected: boolean;             // [spec] perfection condition met
}

interface CountdownState {        // count to 13
  count: number;                  // 0–13
  complete: boolean;
  qualified: boolean;             // [spec] bar-13 qualification flag
}

interface DemarkMethod {          // one per method: Sequential, Combo
  direction: Direction;          // dominant direction of this method
  setup: SetupState;
  countdown: CountdownState;
}

interface CompositePattern {      // [spec]
  type: "9-13" | "13-9-13" | "9-13-9";
  direction: Direction;
  complete: boolean;
}

interface RecyclingEvent {        // [spec]
  occurred: boolean;
  atBar: number | null;           // where the recycle happened
}

interface TimeframeSignal {
  timeframe: Timeframe;
  state: CardState;
  bias: number;                   // -100 (sell) .. +100 (buy), drives the meter
  sequential: DemarkMethod;
  combo: DemarkMethod;
  composites: CompositePattern[]; // [spec] may be empty
  recycling: RecyclingEvent;      // [spec]
  tdst: { kind: "support" | "resistance"; value: number };
  risk: number | null;            // stop level if a signal is active
  eventDate: string | null;       // [addendum A1] date current state was produced
}

interface Indicator {
  key: "RSI"|"MACD"|"EMA"|"BB"|"ADX"|"Ichi"|"W%R"|"Don"|"VWAP"|"ATR";
  value: string;                  // display-ready, e.g. "48", "↓", "-1.2%"
  tone: "bull" | "bear" | "neutral";  // engine decides; UI just tints (§6)
}

interface EdgeStats {
  winRate: number;                // 0–100
  avgReturn: number;              // %
  profitFactor: number;
  sampleSize: number;
  lookback: string;               // "15yr" | "1yr"
  validated: boolean;             // out-of-sample / walk-forward confirmed
}

interface TickerSignal {
  symbol: string;                 // "GC=F"
  exchange: string;               // "US" | "HK" ...
  name: string;                   // "Gold Futures · Apr 26"
  price: number;
  changeAbs: number;
  changePct: number;

  primaryTimeframe: Timeframe;    // which tf the headline reflects (usually daily)
  verdict: {
    state: CardState;
    label: string;                // "Sell — exhaustion confirmed"
    arrow: "↑" | "↓" | "·";
    why: string;                  // one sentence, plain language
  };

  timeframes: Record<Timeframe, TimeframeSignal>;
  indicators: Indicator[];        // from primaryTimeframe
  regime: { trending: boolean; adx: number };
  edge: EdgeStats;
  updated: string;                // ISO date
}
```

---

## 5. Card Component Anatomy

Each sub-component, its data binding, and its rules. (React/TS; `Card` is a client component so
the bias meter and disclosure interactions work without a round-trip.)

### 5.1 Header
- Binds `symbol`, `exchange`, `name`, `price`, `changeAbs`, `changePct`.
- Symbol in `--mono` 700. Exchange as a 1px bordered chip. Day change tinted up/down.

### 5.2 Verdict block
- Binds `verdict`. Arrow + label in the state color; `why` below in `--text` with the
  qualifying clause in `--muted`.
- Label is a *sentence*, not a code: "Sell — 1 bar from 2nd confirm", not "SEQ 12/13".

### 5.3 Bias meter
- Binds `timeframes[primaryTimeframe].bias`.
- Horizontal track with sell→neutral→buy gradient, center tick, marker at `50 + bias/2` %.
- Marker color = `CardState`. Replaces all three legacy scores. See §8 for which value feeds `bias`.

### 5.4 Timeframe strip `[spec]`
- Binds the four `timeframes[*].state`.
- Four compact cells **D / W / M / Y**, each a colored dot + the most advanced count on that tf
  (e.g. `W ● 13✓`). Lets the trader confirm alignment at a glance — a daily sell that's also a
  weekly sell is far stronger than one fighting the weekly.
- Tapping a cell re-renders the DeMark module (§5.6) for that timeframe.

### 5.5 Context chips
- Binds `regime` and cross-signal conflict (§6.3).
- Chips: regime (`Trending`/`Range-bound` + ADX), and a `⚠ conflict` chip when present.

### 5.6 DeMark module (the core)
Two method rows (Sequential, Combo), plus composite/recycling callouts.

- **Each method row** binds a `DemarkMethod`:
  - Setup chip: `Setup Buy 9 ✓ ·perf` — tinted by direction when complete, perfection appended.
  - Countdown: a **13-segment micro-bar** (discrete, not a smooth bar — DeMark counts are
    discrete and the trader thinks in counts). Filled segments = `count`; completed 13 gets an
    inset highlight; approaching state is amber.
  - State tag: `Sell 13 ✓`, `12/13 ⚠`, `Building 5/13`, or `—`.
- **Composite callout** `[spec]`: when `composites[]` non-empty, a single line per pattern,
  e.g. `Composite 13-9-13 ✓ (sell)`. High visual priority — composites are stronger than a lone 13.
- **Recycling callout** `[spec]`: when `recycling.occurred`, an amber note
  `↻ Countdown recycled at bar 8` — this *invalidates* a maturing count and the trader must know.
- Raw 1–13 numbered grid is **removed from default view**; available behind a "count detail" tap.

### 5.7 Levels
- Binds `tdst` and `risk` for the active timeframe. Two cells, `--mono`.
- `TDST support`/`TDST resistance` auto-labels by `tdst.kind`. `Risk / stop` only shown when
  `risk != null` (i.e. an active signal exists).

### 5.8 Indicator strip
- Binds `indicators[]`. Compact wrap of `KEY value` chips. Tint **only** `tone: bull|bear`;
  neutral stays muted. Default shows the directional ones; full set behind "all indicators" tap.

### 5.9 Edge footer
- Binds `edge`. One line: `92% win · +4.21% avg · PF 33.9 (12 trades) [validated]`.
- Confidence styling per §6.4. Per-stock weight breakdown is **cut** from the card (optional tap).
- `updated` date right-aligned, faint.

---

## 6. Signal-State Logic

### 6.1 `CardState` derivation (drives accent + meter marker)
Evaluated on `primaryTimeframe`, in priority order:

1. Any **completed sell** countdown/composite → `sell`
2. Any sell countdown at **12/13** (one bar away) and not yet complete → `approaching`
3. Any **completed buy** setup/countdown/composite → `buy`
4. A buy **count building** but nothing complete → `watch`
5. Otherwise → `neutral`

> Note: a card can be both "has a completed combo sell" and "sequential approaching". Resolve to
> the **most actionable** state (`sell` outranks `approaching`) but surface the approaching detail
> in the verdict `why`.

### 6.2 "Approaching" threshold
- Countdown `count == 12` (of 13) → amber. Optionally also Setup `count == 8` (of 9) for an
  earlier heads-up `[TBD]` — default off to avoid noise.

### 6.3 Conflict detection → `⚠ conflict` chip
Raise when the primary-timeframe DeMark direction opposes:
- a higher timeframe's state (e.g. daily `sell` vs weekly `buy`), **or**
- the dominant momentum read (EMA/MACD agreement against the signal).
For **buy exhaustion** signals, oversold momentum (W%R < −80, RSI < 30) is *confirming*, not
conflicting — do not flag it.

### 6.4 Edge confidence styling
- `validated && profitFactor ≥ 1.5` → normal weight + green `validated` badge.
- `sampleSize < 5` **or** `avgReturn < 0` → muted text, win-rate tinted `--sell`. (This is why
  SMIC's `0% / 1 signal / 1yr` reads as untrustworthy.)

### 6.5 Indicator tint (engine sets `tone`, examples)
`MACD ↑/↓` → bull/bear · `EMA Bull/Bear` → bull/bear · `VWAP` sign → bull/bear ·
`W%R < −80` bull, `> −20` bear · `Ichi Above/Below` → bull/bear · `RSI` only at extremes ·
`BB/ADX/Don/ATR` → neutral unless extreme.

---

## 7. Watchlist & Layout

- **Summary bar** (top): counts by state — `2 actionable · 1 approaching · 1 forming · 1 watch`.
  Answers "is anything worth my attention today" before scanning. Counts link-filter the grid.
- **Sort order:** by urgency — `sell`/`approaching` first, then `buy`, then `watch`, then
  `neutral`; ties broken by `|bias|` descending. (Daily check should front-load the actionable.)
- **Grid:** `repeat(auto-fill, minmax(390px, 1fr))`, 18px gap. One column on mobile (matches the
  HK card screenshot width ~360–440px).
- **Stale state:** if `updated` is older than the last expected 06:00 Taipei scan, badge the card
  `stale` (faint amber) so a failed data pull is obvious.
- **Empty/loading:** skeleton card with shimmer; never a blank grid.

---

## 8. Gaps Requiring a Decision

> **Resolved 2026-06-06 — see Addendum A3.**

1. **Which value feeds `bias`?** `[TBD]` The mockup derives the meter from the **DeMark** read.
   If the canonical number is the blended confluence score, point `bias` at that field instead.
   Pick one and make it authoritative — the old design's problem was three.
2. **Composite display priority** `[spec]` Confirm the three patterns we track (9-13, 13-9-13,
   9-13-9) and whether a completed composite should *override* the verdict label vs. a lone 13.
3. **Recycling semantics** `[spec]` Confirm whether a recycle resets `count` to 0 in the engine
   (UI shows the reset) or keeps the prior count with a flag (UI shows `↻` over the old bar).
4. **Monthly / yearly availability** `[spec]` The strip assumes all four timeframes are computed.
   If M/Y are sparse for newer tickers, define the "insufficient history" cell state.
5. **Perfection on Combo** `[example]` Reference data showed perfection on Sequential setup only.
   Confirm whether Combo setups carry a perfection flag in our engine.

---

## 9. Merge Notes

- This file maps 1:1 onto the existing spec's **Phase 1 (web dashboard MVP)** UI work; the
  composite/recycling/timeframe items align with **Phase 2**.
- The `TickerSignal` interface (§4) should become the engine's documented output schema — wire
  the Python serializer to emit exactly these fields so the dashboard needs no adapter layer.
- Reference implementation of §3, §5, §6 is the redesign mockup (`demark-redesign.html`).

---

## Addendum — 2026-06-06 (post-mockup review)

### A1. Contract change
`TimeframeSignal` gains **`eventDate: string | null`** — the date the current state was produced
(latest state-changing signal_event for that ticker/timeframe). Drives the NEW badge and signal
age. Already reflected in §4 above.

### A2. Trader-readability additions (implemented in `demark-redesign.html`)
1. **NEW badge + signal age** — `NEW` chip (info blue, deliberately not a signal color) when
   `eventDate` equals the last scan date; otherwise `Nd ago` faint in the verdict head.
2. **% distance on levels** — TDST and risk cells append signed distance from current price.
3. **Scan mode** — density toggle; one compact row per ticker (symbol · verdict · bias ·
   D/W/M/Y dots · win% · age). Row tap opens the card. Summary bar filters both views.
4. **S/C notation in the timeframe strip** — `C13✓` vs `S9` disambiguates countdown from setup counts.
5. **Dominant-method emphasis** — the non-dominant method row renders at 50% opacity.
6. **Momentum net read** — indicator strip leads with `Mom n↑ n↓`; chips become the detail.
7. **Group separators** — faint labeled rules (Sell signals / Approaching / Buy signals /
   Building / Quiet) make the urgency sort legible in both views.

### A3. §8 decisions resolved
- **8.1 bias source:** DeMark-derived. Authoritative; the blended confluence score is retired
  from the UI.
- **8.2 composites:** the three patterns are confirmed (engine: `src/engine/composite.ts`); a
  completed composite **overrides** the verdict label over a lone 13.
- **8.3 recycling:** engine default is `reset_to_new_setup` (see `src/engine/recycle.ts`) → UI
  shows the reset count + `↻ recycled at bar N` callout. The `mark_R_only` config renders `↻`
  over the intact bar.
- **8.4 M/Y availability:** resampling (`src/data/resample.ts`) always computes all four
  timeframes; a timeframe with insufficient bars renders a neutral-dimmed `·` cell.
- **8.5 perfection:** perfection is a property of the *Setup* (`src/engine/perfection.ts`),
  which Sequential and Combo share — the flag renders identically on both method rows.

### A4. Correction to §9 Merge Notes
The repo's `SPEC.md` numbers phases differently than this document assumed: the dashboard is
**Phase 3** (synthesis layout), ticker detail is Phase 4, Combo/backtest is Phase 5. This file
replaces the Phase 3 hero + rails layout sections of `SPEC.md`. Build sequencing lives in
`REBUILD_PLAN.md`. The engine is TypeScript (`src/engine/`), not Python — the §9 reference to a
"Python serializer" is stale; the composer is `src/server/ticker-signal.ts` (Plan PR 3).
