# DM — SPEC.md

> Technical build specification for Claude Code. Self-contained — everything needed to build the project from a clean repo is in this file.

**Version:** 1.3
**Design Doc:** `DESIGN_DOC.md` (same repo)
**Canonical rule references:** `DeMark_Technical_Specification.md` and `demark_indicator_tech_spec_GPT.md` (both in this repo). The two specs agree on the 9/13 architecture and the major events, but diverge on several implementation details (TDST anchoring, modern vs legacy cancellation tests, recycle thresholds, perfection strictness). For v1 we ship the **modern public-source defaults** (`official_current_approx` preset) and architect the engine config so legacy and academic presets can be added without refactor. See Appendix B for the full config + Appendix E for the preset variants.
**Legal/IP note:** "DeMARK", "TD", and the indicator names are trademarked. This engine implements a public-source DeMark-style approximation, not a licensed DeMARK product. All chart legends, marketing copy, and the engine README must reflect this.
**Date:** 2026-04-27

---

## 1. Project Overview

DM is a small-crew DeMark signal monitor. It watches a shared watchlist of tickers across daily / weekly / monthly / yearly bars, runs Tom DeMark's Sequential and Combo indicators against them, and surfaces what's setting up via a daily-check-in dashboard, annotated candlestick charts, and per-ticker backtest stats. Auth.js + Google + a small env-var allowlist gates access. A Vercel Cron triggers the daily scan; the same scan endpoint powers a manual "Scan now" button.

- **Repo:** github.com/8gara8/DM
- **Primary domain:** TBD (use Vercel preview URL until the user assigns one)
- **Key features (v1):** authenticated dashboard, multi-timeframe TD Sequential + TD Combo engine, candlestick charts with TD bar labels and TDST lines, signal event history, fixed-horizon backtest stats, scheduled + manual scans, in-app alerts.

This is a **full rewrite** replacing the existing Python/Flask Phase-1 codebase in this repo. Preserve the existing files in a `legacy/` directory at the start of Phase 1; do not edit them.

---

## 2. Stack

| Layer | Choice | Why |
|-------|--------|-----|
| Framework | Next.js 15 App Router | Vercel-native; Server Components for data-heavy dashboard; Route Handlers for the API. |
| Language | TypeScript (strict) | One language end-to-end; shared types between engine, API, and frontend. |
| Styling | Tailwind CSS v4 | Matches existing GitHub-dark aesthetic via custom CSS vars; zero runtime cost. |
| Database | Turso (libSQL) | User's stated preference; SQLite-compatible; Vercel-friendly. |
| ORM | Drizzle ORM | Best Turso/libSQL integration; SQL-first; type-safe; zero magic. |
| Auth | Auth.js v5 (NextAuth) + Google provider | Smallest viable auth surface; allowlist via env var, no user-management UI. |
| Charts | TradingView Lightweight Charts (`lightweight-charts` npm) | Free, fast, supports markers and price lines for TD numerals + TDST. |
| Data provider | `yahoo-finance2` npm package | Closest behavioral match to Phase-1's `yfinance`. Behind a `DataProvider` interface so it's swappable. |
| Hosting | Vercel | First-party Auth.js, Cron, env management; matches user's default stack. |
| Scheduler | Vercel Cron (daily) + same endpoint for manual triggers | One scan endpoint, two triggers — no drift. |
| Package manager | pnpm | Fast, disk-efficient, Vercel-supported. |
| Testing | Vitest + Playwright | Vitest for engine parity + unit tests; Playwright for one happy-path E2E. |
| Validation | Zod | Request/response schemas for API routes. |
| Date handling | `date-fns` + `date-fns-tz` | For Asia/Taipei boundary math on the cron + bar resampling. |

### Key Dependencies (package.json excerpt)

```json
{
  "dependencies": {
    "next": "^15.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "next-auth": "^5.0.0",
    "@auth/drizzle-adapter": "^1.0.0",
    "drizzle-orm": "^0.36.0",
    "@libsql/client": "^0.14.0",
    "yahoo-finance2": "^2.13.0",
    "lightweight-charts": "^4.2.0",
    "zod": "^3.23.0",
    "date-fns": "^4.0.0",
    "date-fns-tz": "^3.0.0",
    "nanoid": "^5.0.0",
    "clsx": "^2.1.0",
    "tailwind-merge": "^2.5.0"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "@types/node": "^22.0.0",
    "@types/react": "^19.0.0",
    "tailwindcss": "^4.0.0",
    "@tailwindcss/postcss": "^4.0.0",
    "drizzle-kit": "^0.28.0",
    "vitest": "^2.1.0",
    "@playwright/test": "^1.48.0",
    "tsx": "^4.19.0",
    "eslint": "^9.0.0",
    "eslint-config-next": "^15.0.0"
  }
}
```

---

## 3. Repo Layout

```
dm/
├── legacy/                          # Phase-1 Python code preserved verbatim — never edit
├── public/
│   └── favicon.svg
├── src/
│   ├── app/
│   │   ├── layout.tsx               # Root layout (TopNav, fonts, globals)
│   │   ├── page.tsx                 # Dashboard (Server Component)
│   │   ├── access-denied/page.tsx   # Allowlist rejection page
│   │   ├── ticker/[symbol]/page.tsx # Ticker detail (chart + signals + backtest)
│   │   ├── alerts/page.tsx          # Full alert log
│   │   ├── scans/page.tsx           # Scan run history
│   │   ├── settings/page.tsx        # User preferences
│   │   ├── api/
│   │   │   ├── auth/[...nextauth]/route.ts
│   │   │   ├── tickers/route.ts                  # GET, POST
│   │   │   ├── tickers/[symbol]/route.ts         # DELETE
│   │   │   ├── scan/route.ts                     # POST — manual trigger
│   │   │   ├── scans/route.ts                    # GET — list scan runs
│   │   │   ├── scans/[id]/route.ts               # GET — scan run progress
│   │   │   ├── signals/route.ts                  # GET — current signal states
│   │   │   ├── signals/events/route.ts           # GET — signal event history
│   │   │   ├── alerts/route.ts                   # GET, PATCH (mark read)
│   │   │   ├── bars/[symbol]/route.ts            # GET — OHLCV for chart
│   │   │   ├── backtest/[symbol]/route.ts        # GET — backtest stats per ticker
│   │   │   └── cron/scan/route.ts                # POST — Vercel Cron entrypoint
│   │   └── (marketing)/
│   │       └── page.tsx             # Public landing page (sign-in CTA)
│   ├── components/
│   │   ├── ui/                      # Primitives: Button, Card, Badge, Modal, Input, Tabs
│   │   ├── layout/                  # TopNav, PageContainer
│   │   └── features/
│   │       ├── Hero.tsx                 # "Today's Big One" hero card
│   │       ├── RailSection.tsx          # Just Printed / Imminent / Watching rail wrapper
│   │       ├── TickerCard.tsx           # Redesigned tile (sparkline + dots + hit rate)
│   │       ├── Sparkline.tsx            # Mini chart with count numerals on bars
│   │       ├── ConfluenceDots.tsx       # D/W/M/Y dot row
│   │       ├── HitRatePill.tsx          # Honest, sample-size-aware track record stat
│   │       ├── SignalBadge.tsx
│   │       ├── TickerChart.tsx          # Client Component (uses lightweight-charts)
│   │       ├── SignalTimeline.tsx
│   │       ├── BacktestPanel.tsx
│   │       ├── AlertList.tsx
│   │       ├── ScanButton.tsx           # Client Component
│   │       └── AddTickerModal.tsx       # Client Component
│   ├── engine/                      # Pure-TS DeMark engine — no Next/React imports
│   │   ├── types.ts                 # Direction, Phase, Bar, BarAnnotation, DirectionalSnapshot, Event types
│   │   ├── config.ts                # DEFAULT_ENGINE_CONFIG (see Appendix B)
│   │   ├── flip.ts                  # Bullish/bearish Price Flip detection
│   │   ├── sequential.ts            # TD Sequential state machine
│   │   ├── combo.ts                 # TD Combo V1 + V2 state machine
│   │   ├── tdst.ts                  # TDST level math (canonical bar_1 anchor by default)
│   │   ├── recycle.ts               # 18-bar + size-ratio recycling
│   │   ├── risk.ts                  # Risk Level computation per §3.3
│   │   ├── composite.ts             # 9-13-9 detection
│   │   ├── backtest.ts              # Fixed-horizon return + MFE
│   │   ├── snapshot.ts              # serialize() / restore() for incremental resume
│   │   ├── README.md                # Engine docs incl. departures from legacy Python
│   │   └── index.ts                 # Public exports (DeMarkEngine class)
│   ├── data/
│   │   ├── provider.ts              # DataProvider interface + yahoo-finance2 impl
│   │   └── resample.ts              # Daily → weekly/monthly/yearly aggregation
│   ├── server/
│   │   ├── scan.ts                  # Scan orchestrator: fetch → engine → persist
│   │   ├── alerts.ts                # SignalEvent → Alert generation
│   │   ├── ranking.ts               # Hero ranking score + rail bucketing (Just Printed / Imminent / Watching)
│   │   ├── dashboard.ts             # Composes the /api/dashboard payload (hero + rails + meta)
│   │   └── auth.ts                  # Auth.js config + allowlist callback
│   ├── lib/
│   │   ├── db/
│   │   │   ├── client.ts            # Drizzle client (Turso connection)
│   │   │   ├── schema.ts            # All tables
│   │   │   └── queries.ts           # Common query helpers
│   │   ├── time.ts                  # Asia/Taipei boundary helpers
│   │   ├── ids.ts                   # nanoid wrapper
│   │   ├── translations.ts          # Rule-based translation template registry (~12 templates) for hero sentences
│   │   ├── format.ts                # Adaptive price/percent formatting (penny stocks vs mega caps)
│   │   └── utils.ts                 # cn(), small helpers
│   └── styles/
│       └── globals.css              # Tailwind + CSS custom properties (design tokens)
├── tests/
│   ├── engine/
│   │   ├── sequential.test.ts       # Ports legacy/tests/test_sequential.py
│   │   ├── combo.test.ts
│   │   └── tdst.test.ts
│   ├── server/
│   │   └── scan.test.ts
│   └── e2e/
│       └── dashboard.spec.ts        # Playwright happy-path
├── scripts/
│   ├── parity-check.ts              # Runs the TS engine on the same fixtures as the Python tests and asserts identical output
│   └── seed.ts                      # Seeds a default watchlist locally
├── drizzle/
│   └── (generated migrations)
├── DESIGN_DOC.md
├── SPEC.md                          # This file
├── REDESIGN_NOTES.md                # Read-only notes from the audit phase
├── package.json
├── tsconfig.json
├── tailwind.config.ts
├── next.config.ts
├── drizzle.config.ts
├── vercel.json                      # Cron config
├── .env.example
└── .github/workflows/ci.yml
```

---

## 4. Data Schemas

All tables live in `src/lib/db/schema.ts` using Drizzle's `sqliteTable`. IDs are `nanoid(16)` strings. Timestamps stored as ISO 8601 text. Booleans as `integer { mode: "boolean" }`.

### users (Auth.js standard table)

```typescript
export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name"),
  image: text("image"),
  emailVerified: text("emailVerified"),
  createdAt: text("createdAt").notNull().$defaultFn(() => new Date().toISOString()),
});
```

Auth.js's standard `accounts`, `sessions`, `verificationTokens` tables also exist (see Drizzle adapter docs).

### watchlists

```typescript
export const watchlists = sqliteTable("watchlists", {
  id: text("id").primaryKey().$defaultFn(() => nanoid(16)),
  name: text("name").notNull(),
  createdAt: text("createdAt").notNull().$defaultFn(() => new Date().toISOString()),
});
```

v1 ships with a single seed row named "Crew Watchlist". Schema supports many.

### watchlistTickers

```typescript
export const watchlistTickers = sqliteTable("watchlist_tickers", {
  watchlistId: text("watchlistId").notNull().references(() => watchlists.id),
  ticker: text("ticker").notNull(),                // uppercase, validated
  tags: text("tags", { mode: "json" }).$type<string[]>().default([]),
  addedBy: text("addedBy").notNull().references(() => users.id),
  addedAt: text("addedAt").notNull().$defaultFn(() => new Date().toISOString()),
  isActive: integer("isActive", { mode: "boolean" }).notNull().default(true),
}, (t) => ({
  pk: primaryKey({ columns: [t.watchlistId, t.ticker] }),
}));
```

**Validation:** ticker matches `/^[A-Z][A-Z0-9.\-]{0,9}$/`.

### bars (price cache — actually used this time)

```typescript
export const bars = sqliteTable("bars", {
  ticker: text("ticker").notNull(),
  timeframe: text("timeframe", { enum: ["daily","weekly","monthly","yearly"] }).notNull(),
  date: text("date").notNull(),                    // YYYY-MM-DD
  open: real("open").notNull(),
  high: real("high").notNull(),
  low: real("low").notNull(),
  close: real("close").notNull(),
  volume: real("volume"),
  fetchedAt: text("fetchedAt").notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.ticker, t.timeframe, t.date] }),
  byTicker: index("bars_ticker_tf").on(t.ticker, t.timeframe),
}));
```

### signalStates (latest state per ticker × timeframe × indicator)

```typescript
export const signalStates = sqliteTable("signal_states", {
  ticker: text("ticker").notNull(),
  timeframe: text("timeframe", { enum: ["daily","weekly","monthly","yearly"] }).notNull(),
  indicator: text("indicator", { enum: ["sequential","combo"] }).notNull(),
  direction: text("direction", { enum: ["buy","sell"] }),
  phase: text("phase", { enum: ["none","setup","countdown"] }).notNull().default("none"),
  count: integer("count").notNull().default(0),
  isPerfected: integer("isPerfected", { mode: "boolean" }).notNull().default(false),
  isDeferred: integer("isDeferred", { mode: "boolean" }).notNull().default(false), // 12 reached but 13-vs-8 failed; engine awaits qualifying bar
  countdownBar8Close: real("countdownBar8Close"),
  tdstLevel: real("tdstLevel"),
  tdstAnchorBarDate: text("tdstAnchorBarDate"),
  riskLevel: real("riskLevel"),                    // post-13 stop / invalidation
  barsSince9: integer("barsSince9"),               // informational; supports the 4-bar response rule after Setup 9
  barsSince13: integer("barsSince13"),             // informational; supports the 12-bar response rule after Countdown 13
  configHash: text("configHash").notNull(),        // SHA-256 of engine config; mismatched states are recomputed on next scan
  engineStateJson: text("engineStateJson", { mode: "json" }).$type<DirectionalSnapshot>(),  // serialized full state for incremental resume
  asOfBarDate: text("asOfBarDate").notNull(),
  updatedAt: text("updatedAt").notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.ticker, t.timeframe, t.indicator] }),
}));
```

`engineStateJson` carries the full `DirectionalSnapshot` (Setup count, count-9 bar index, Countdown bar indices, count-8 close, deferred flag, etc.) so the next scan can resume from the last bar instead of recomputing 5 years of history. Engine exposes `serialize()` / `restore()` per `DeMark_Technical_Specification.md` §8.10.

### signalEvents (immutable event log — the new bit)

```typescript
export const signalEvents = sqliteTable("signal_events", {
  id: text("id").primaryKey().$defaultFn(() => nanoid(16)),
  ticker: text("ticker").notNull(),
  timeframe: text("timeframe").notNull(),
  indicator: text("indicator").notNull(),
  eventType: text("eventType", { enum: [
    "price_flip",                    // bullish or bearish flip preceding a Setup
    "setup_count","setup_complete","setup_perfected",
    "countdown_count","countdown_deferred",  // deferred = "+" marker; 12 reached, 13-vs-8 failed
    "countdown_complete","countdown_qualified",
    "tdst_breach","risk_level_breach",
    "setup_recycle","countdown_cancel",
    "signal_9_13_9"                  // composite premium reversal pattern
  ] }).notNull(),
  direction: text("direction", { enum: ["buy","sell"] }),
  count: integer("count"),
  barDate: text("barDate").notNull(),               // YYYY-MM-DD — the bar this event happened on
  firstKnownAtDate: text("firstKnownAtDate").notNull(),
                                                    // YYYY-MM-DD — the bar AFTER which this event was knowable. Equal to barDate for Setup events
                                                    // and for Sequential Countdown events. For Combo events that print on Setup bars 1..8, this is
                                                    // the date of Setup bar 9 (the bar that confirmed the Setup, retroactively activating Combo counts).
                                                    // ANY backtest must satisfy entry_bar > firstKnownAt to avoid look-ahead bias.
  configHash: text("configHash").notNull(),         // SHA-256 of the engine config that produced this event; events with mismatched hashes are recomputed
  meta: text("meta", { mode: "json" }).$type<Record<string, unknown>>(),
  createdAt: text("createdAt").notNull().$defaultFn(() => new Date().toISOString()),
}, (t) => ({
  byTickerTf: index("signal_events_ticker_tf").on(t.ticker, t.timeframe),
  byBarDate: index("signal_events_bar_date").on(t.barDate),
  byFirstKnown: index("signal_events_first_known").on(t.firstKnownAtDate),
}));
```

A scan rewrites `signalStates` (upsert) but only **inserts** new `signalEvents` for events that haven't been recorded for that `(ticker, timeframe, indicator, eventType, barDate)` combination. Use a UNIQUE constraint on the natural key, or check-before-insert.

### alerts

```typescript
export const alerts = sqliteTable("alerts", {
  id: text("id").primaryKey().$defaultFn(() => nanoid(16)),
  signalEventId: text("signalEventId").notNull().references(() => signalEvents.id),
  ticker: text("ticker").notNull(),
  timeframe: text("timeframe").notNull(),
  priority: text("priority", { enum: ["info","warning","critical"] }).notNull(),
  message: text("message").notNull(),
  dedupeKey: text("dedupeKey").notNull().unique(),
  createdAt: text("createdAt").notNull().$defaultFn(() => new Date().toISOString()),
  readBy: text("readBy", { mode: "json" }).$type<string[]>().default([]),
});
```

### signalHitRates (materialization for fast HitRatePill reads)

Populated in Phase 5 by the backtest pipeline. Read-only from the dashboard composer's perspective.

```typescript
export const signalHitRates = sqliteTable("signal_hit_rates", {
  ticker: text("ticker").notNull(),
  timeframe: text("timeframe").notNull(),
  indicator: text("indicator").notNull(),
  signalType: text("signalType", { enum: ["setup_complete","countdown_complete","signal_9_13_9"] }).notNull(),
  n: integer("n").notNull(),
  hits: integer("hits").notNull(),
  avgReturnPct: real("avgReturnPct"),
  horizon: text("horizon").notNull(),                      // "+13d" | "+13w" | "+13m" | "+13y"
  lastComputedAt: text("lastComputedAt").notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.ticker, t.timeframe, t.indicator, t.signalType] }),
}));
```

### heroHistory (per-user tracking for hero recency-decay)

```typescript
export const heroHistory = sqliteTable("hero_history", {
  userId: text("userId").notNull().references(() => users.id),
  date: text("date").notNull(),                            // YYYY-MM-DD in user's timezone
  ticker: text("ticker").notNull(),
  timeframe: text("timeframe").notNull(),
  indicator: text("indicator").notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.userId, t.date] }),
}));
```

One row per user per day capturing whatever was the hero. The ranking function reads the prior `daysAsHero` consecutive days for the same `(ticker, timeframe, indicator)` to apply the recency decay. Reset implicitly when a different signal becomes hero.

### scanRuns

```typescript
export const scanRuns = sqliteTable("scan_runs", {
  id: text("id").primaryKey().$defaultFn(() => nanoid(16)),
  trigger: text("trigger", { enum: ["cron","manual","add-ticker"] }).notNull(),
  triggeredBy: text("triggeredBy").references(() => users.id),
  startedAt: text("startedAt").notNull().$defaultFn(() => new Date().toISOString()),
  finishedAt: text("finishedAt"),
  tickersAttempted: integer("tickersAttempted").notNull().default(0),
  tickersSucceeded: integer("tickersSucceeded").notNull().default(0),
  errors: text("errors", { mode: "json" }).$type<Array<{ ticker: string; message: string }>>().default([]),
});
```

### Example seed row (`scripts/seed.ts`)

```json
{
  "watchlists": [{ "id": "wl_default", "name": "Crew Watchlist" }],
  "watchlistTickers": [
    { "watchlistId": "wl_default", "ticker": "SPY", "tags": ["index"], "addedBy": "<seed-user>", "isActive": true },
    { "watchlistId": "wl_default", "ticker": "QQQ", "tags": ["index"], "addedBy": "<seed-user>", "isActive": true },
    { "watchlistId": "wl_default", "ticker": "BTC-USD", "tags": ["crypto"], "addedBy": "<seed-user>", "isActive": true }
  ]
}
```

---

## 5. API Routes

All API routes are Next.js Route Handlers under `src/app/api/`. All non-cron routes require an authenticated session (Auth.js middleware). The `/api/cron/scan` route is gated by a `CRON_SECRET` header check instead.

Common response envelope:
```json
{ "data": <payload>, "error": null }    // 2xx
{ "data": null, "error": { "code": "...", "message": "..." } }  // 4xx/5xx
```

### `GET /api/dashboard`
The single endpoint that backs the dashboard view. Composes hero + rails + meta in one round-trip so the Server Component on `/` only fetches once.
**Response:**
```json
{
  "data": {
    "hero": {
      "type": "signal" | "nothing-notable" | "empty-watchlist" | "loading",
      "ticker": "AAPL",
      "price": 179.20,
      "changePct": 0.012,
      "timeframe": "weekly",
      "indicator": "sequential",
      "direction": "buy",
      "badge": "Buy 9 perfected",
      "sparkline": { "bars": [Bar...], "markers": [{ "barDate": "...", "text": "9", "tone": "buy-perfected" }] },
      "translation": "Buy Setup 9 perfected on the weekly with a Buy Countdown 11/13 building on the daily — reversal pressure stacked across both timeframes.",
      "translationTemplateId": "perfected-9-with-imminent-13-other-tf",
      "tdst": { "price": 184.10, "distancePct": 0.027, "side": "above" },
      "risk": { "price": 172.40, "distancePct": -0.038, "side": "below" },
      "hitRate": { "n": 6, "hits": 5, "horizon": "+13w", "indicator": "sequential", "signalType": "setup_complete", "smallSample": true },
      "rankingScore": 87.4,
      "rankingFactors": [
        { "label": "Imminent (count 9 of 9)", "contribution": 32.0 },
        { "label": "Confluence on daily (Buy 11/13)", "contribution": 22.4 },
        { "label": "Track record 5/6 prior 9s", "contribution": 18.0 },
        { "label": "Weekly timeframe weight", "contribution": 15.0 }
      ],
      "approaching": null
    },
    "rails": {
      "justPrinted": [TickerTile...],
      "imminent": [TickerTile...],
      "watching": [TickerTile...]
    },
    "meta": {
      "watchlistCount": 12,
      "activeCount": 7,
      "imminentCount": 3,
      "justPrintedCount": 1,
      "alerts24h": 4,
      "lastScanAt": "2026-04-27T22:01:14Z",
      "lastScanTrigger": "cron"
    }
  }
}
```
When `type === "nothing-notable"`, the hero payload also includes `approaching: TickerTile[]` (top 3 watchlist tickers approaching threshold) so the soft-hero variant has its data inline.
`TickerTile` shape:
```ts
type TickerTile = {
  ticker: string;
  price: number;
  changePct: number;
  tags: string[];
  primaryBadge: { direction, indicator, count, max, isPerfected, isDeferred, timeframe };
  sparkline: { bars: Bar[]; markers: SparklineMarker[]; lookbackLabel: string }; // e.g. "30W"
  confluence: { daily: ConfluenceCell | null; weekly: ConfluenceCell | null; monthly: ConfluenceCell | null; yearly: ConfluenceCell | null };
  tdst?: { price, distancePct, side };
  risk?: { price, distancePct, side };
  hitRate?: HitRateStat;     // null when n < 5; smallSample flag when 5 <= n < 10
  rank: number;              // ranking score within the rail
  status: "default" | "scanning" | "error" | "cancelled" | "lapsed" | "empty";
  errorMessage?: string;
  lastScanAt: string;
};
type ConfluenceCell = { direction: "buy" | "sell"; indicator: "sequential" | "combo"; count: number; max: 9 | 13; isPerfected: boolean; isDeferred: boolean };
```
**Performance:** the route is the hot path; cache the `dashboard.ts` composer output for ~30s per user when the underlying data hasn't changed (key on `lastScanAt` + watchlist hash).
**Errors:** standard envelope.

### `GET /api/tickers`
Returns watchlist tickers with current top-line state. Used by `AddTickerModal` and admin views — not by the dashboard (which uses `/api/dashboard`).
**Response:** `{ data: { ticker, tags, addedAt, lastScanAt, signals: { daily?: SignalStateLite, weekly?: ..., monthly?: ..., yearly?: ... } }[] }`

### `POST /api/tickers`
Add a ticker; enqueues an immediate scan.
**Body:** `{ ticker: string, tags?: string[] }`
**Validation (Zod):** `ticker.toUpperCase().match(/^[A-Z][A-Z0-9.\-]{0,9}$/)`; `tags` max 5 items.
**Response (201):** `{ data: { ticker, scanRunId } }`
**Errors:** 400 (invalid), 409 (already in watchlist).

### `DELETE /api/tickers/:symbol`
Soft-delete (sets `isActive = false`). **Response:** `{ data: { ticker, removed: true } }`.

### `POST /api/scan`
Trigger a manual scan. **Body:** `{ tickers?: string[], timeframes?: TF[] }` (omit both = scan everything). **Response (202):** `{ data: { scanRunId } }`. Implementation: create `scanRuns` row, fan out work via `Promise.all` over tickers × timeframes (capped concurrency, e.g. 4).

### `GET /api/scans`
List recent scan runs (paginated). **Query:** `limit=20`, `offset=0`. **Response:** `{ data: ScanRun[], total }`.

### `GET /api/scans/:id`
Get one scan run's progress + errors. Used by `ScanButton` for progress polling. **Response:** `{ data: ScanRun }`.

### `GET /api/signals`
Current signal states for the watchlist. **Query:** `phaseMin?` (e.g. `setup`), `countMin?` (filter to interesting). **Response:** `{ data: SignalState[] }`.

### `GET /api/signals/events`
Signal event history. **Query:** `ticker?`, `timeframe?`, `indicator?`, `eventType?`, `since?`, `limit=50`. **Response:** `{ data: SignalEvent[], total }`.

### `GET /api/alerts`
Recent alerts. **Query:** `unreadOnly=false`, `limit=50`, `offset=0`. **Response:** `{ data: Alert[], total }`.

### `PATCH /api/alerts/:id`
Mark read/unread for the current user. **Body:** `{ read: boolean }`. **Response:** `{ data: Alert }`.

### `GET /api/bars/:symbol`
OHLCV for a ticker (used by `TickerChart`). **Query:** `tf=daily`, `limit=500`. Always returns from the `bars` cache. **Response:** `{ data: { ticker, timeframe, bars: Bar[] } }`. If cache is empty/stale (>24h for daily; >7d for weekly), refetch from provider before responding.

### `GET /api/backtest/:symbol`
Per-ticker fixed-horizon backtest stats. **Query:** `tf=daily`, `indicator=sequential`. **Response:**
```json
{
  "data": {
    "ticker": "AAPL",
    "timeframe": "daily",
    "indicator": "sequential",
    "signals": [
      {
        "barDate": "2025-08-14",
        "eventType": "setup_complete",
        "direction": "buy",
        "isPerfected": true,
        "returnAt5": 0.014,
        "returnAt13": 0.032,
        "returnAt21": 0.041,
        "maxFavorableExcursion": 0.058
      }
    ],
    "aggregate": {
      "count": 8,
      "hitRateAt13": 0.625,
      "avgReturnAt13": 0.018,
      "winLossRatio": 1.42
    }
  }
}
```

### `POST /api/cron/scan`
**Auth:** Header `Authorization: Bearer <CRON_SECRET>`.
**Body:** ignored.
**Behavior:** Identical to a `/api/scan` call with no filters, but `trigger: "cron"`.
**Response:** `{ data: { scanRunId } }`.

### Errors

| Code | When |
|------|------|
| `UNAUTHENTICATED` | 401 — no Auth.js session |
| `FORBIDDEN` | 403 — email not in `ALLOWED_EMAILS` |
| `BAD_REQUEST` | 400 — Zod validation failed |
| `NOT_FOUND` | 404 — ticker / scan / alert id missing |
| `CONFLICT` | 409 — ticker already in watchlist |
| `PROVIDER_ERROR` | 502 — yahoo-finance2 fetch failed |
| `INTERNAL` | 500 |

---

## 6. Component Specs

All UI components are TS + Tailwind. Server Components by default; only the ones below marked **Client** are `"use client"`. State management: React state for local; `swr` (or `useEffect` + `fetch`) for client-side polling on `ScanButton`. No global state library needed in v1.

### TopNav

**File:** `src/components/layout/TopNav.tsx` (Server Component; passes session + dashboard meta as props)

```typescript
interface TopNavProps {
  user: { name: string; email: string; image?: string };
  meta?: {
    watchlistCount: number;
    activeCount: number;
    imminentCount: number;
    lastScanAt: string;
  };
}
```

Layout: logo (left), nav (`Dashboard`, `Alerts`, `Scans`), spacer, **meta-strip** rendering `{watchlistCount} tickers · {activeCount} active · {imminentCount} imminent · scanned {relativeTime(lastScanAt)} ago` (each segment a clickable `<Link>` filtering or routing appropriately), avatar dropdown (sign out, settings). On `<lg` viewports the meta-strip collapses into the avatar dropdown menu. Tailwind: `sticky top-0 z-40 bg-[var(--surface)] border-b border-[var(--border-subtle)]`.

### Hero

**File:** `src/components/features/Hero.tsx` (Server Component for the data path; embeds a small `"use client"` `RankingFactorsExpander` for the "Why this one?" interaction)

```typescript
interface HeroProps {
  hero: DashboardResponse["data"]["hero"];   // see /api/dashboard schema in §5
}
```

Renders one of four variants based on `hero.type`:
- `"signal"` — full hero with sparkline, badge, translation sentence, meta strip. Translation sentence is rendered with `class="font-style-italic text-[var(--text)]"` and a small `summary` label so users can tell interpretation from raw data.
- `"nothing-notable"` — soft variant: lighter background, `Nothing notable on your watchlist today.` headline; `approaching` array rendered as a horizontal pill list ("AAPL Buy 6/9 daily" × 3); plus a one-line "Last hot signal: GOOGL Sell 9 daily, 3 days ago."
- `"empty-watchlist"` — single CTA "Add your first ticker to start." that opens `AddTickerModal`.
- `"loading"` — skeleton with shimmer.

The "Why this one?" expander reveals `rankingFactors` as a small ranked list with each factor's numeric contribution. Nothing else interactive. The whole hero is wrapped in `<Link href={"/ticker/" + hero.ticker + "?tf=" + hero.timeframe}>` for the signal variant.

### RailSection

**File:** `src/components/features/RailSection.tsx` (Server Component)

```typescript
interface RailSectionProps {
  label: string;                             // "Just printed today" | "Imminent" | "Watching"
  description?: string;                      // optional helper line
  tiles: TickerTile[];
  maxVisible?: number;                       // default: Infinity for Watching, 6 for Imminent, Infinity for Just Printed
  emptyBehavior?: "hide" | "show-empty";     // default: "hide"
  moreLink?: string;                         // when overflow, link to /imminent or similar
}
```

Renders the section label (lowercased letter-spacing tracking), description if present, and a responsive grid of `TickerCard`s. Grid columns: `repeat(auto-fill, minmax(260px, 1fr))` capped at 4. If `tiles.length === 0` and `emptyBehavior === "hide"`, return `null` (no header rendered). If `tiles.length > maxVisible`, render the first `maxVisible` and a "+N more →" link.

### TickerCard (redesigned)

**File:** `src/components/features/TickerCard.tsx` (Server Component)

```typescript
interface TickerCardProps {
  tile: TickerTile;                           // see /api/dashboard schema in §5
  variant?: "default" | "compact";            // compact = used in Watching rail; smaller sparkline, no inline hit rate
}
```

Layout in DOM order (matters for screen readers):
1. Header row: ticker (mono, 15px, weight 500), price + change% (mono, 11px, secondary).
2. `<SignalBadge />` for `tile.primaryBadge`.
3. `<Sparkline bars={tile.sparkline.bars} markers={tile.sparkline.markers} lookbackLabel={tile.sparkline.lookbackLabel} aria-label="..." />`.
4. `<ConfluenceDots confluence={tile.confluence} />`.
5. Meta strip (default variant only): TDST distance % | Risk distance % | `<HitRatePill stat={tile.hitRate} />`.
6. If `tile.status === "cancelled"` or `"lapsed"`: small explanation chip below the sparkline.

Wrap entire card in `<Link href={"/ticker/" + tile.ticker + "?tf=" + tile.primaryBadge.timeframe}>`. Status variants render skeleton (scanning), red-dotted error tooltip (error), or the muted-with-strikethrough badge (cancelled / lapsed).

### Sparkline

**File:** `src/components/features/Sparkline.tsx` (Server Component; renders pure SVG)

```typescript
interface SparklineProps {
  bars: Bar[];                                // close prices used for the line
  markers: { barDate: string; text: string; tone: "buy" | "sell" | "buy-perfected" | "sell-perfected" | "buy-13" | "sell-13" | "deferred" | "recycle" }[];
  lookbackLabel: string;                      // e.g. "30D", "60W"
  height?: number;                            // default 40 in tile, 80 in hero
  width?: number;                             // default 100% (parent constrained)
  ariaLabel: string;                          // required for a11y; e.g. "60-week price line for AAPL ending today, current count Buy 9"
}
```

Renders an SVG line from the closes; for each marker, place the text centered above (sell tones) or below (buy tones) the corresponding bar in the closes path, with size 9px for non-completion counts and 13px for `*-perfected`, `buy-13`, and `sell-13` tones. Deferred markers render as `+`; recycle markers as `R`. Use `var(--buy)` / `var(--sell)` for fills.

The lookback label sits in the top-left corner at 9px in `var(--text-dim)`. `role="img"` on the outer SVG with `<title>` containing the `ariaLabel` for screen readers.

### ConfluenceDots

**File:** `src/components/features/ConfluenceDots.tsx` (Server Component)

```typescript
interface ConfluenceDotsProps {
  confluence: {
    daily: ConfluenceCell | null;
    weekly: ConfluenceCell | null;
    monthly: ConfluenceCell | null;
    yearly: ConfluenceCell | null;
  };
  size?: "sm" | "md";                          // sm for compact rail tiles; md default
}
```

Renders a horizontal row of four dots labeled D / W / M / Y. Empty state = thin grey ring (`stroke="var(--border-subtle)"`, no fill). Active state = filled disc with the count number inside in mono. Dot diameters in `md`: D=16, W=18, M=20, Y=22; in `sm`: D=12, W=14, M=16, Y=18.

The component itself is presentational. Tooltip content for each dot is rendered as a `<title>` child of the SVG circle so it works without JS. The DOM also includes a visually-hidden text alternative summarizing the confluence ("Daily Sell 7 of 9; Weekly no signal; Monthly no signal; Yearly no signal.") for screen readers.

### HitRatePill

**File:** `src/components/features/HitRatePill.tsx` (Server Component)

```typescript
interface HitRatePillProps {
  stat: HitRateStat | null;                    // null for "no prior signals" or n < 5
}

type HitRateStat = {
  n: number;                                   // sample size
  hits: number;                                // count of "right"
  horizon: string;                             // "+13w" | "+13d" | "+13m" depending on timeframe
  indicator: "sequential" | "combo";
  signalType: "setup_complete" | "countdown_complete" | "signal_9_13_9";
  avgReturnPct: number;
  smallSample: boolean;                        // true when 5 <= n < 10
};
```

Rendering rules (these are the contract — implementer must follow exactly):
- If `stat === null` → render an em-dash `—` with tooltip `"Thin sample (fewer than 5 prior signals on this ticker × timeframe × indicator)"`. Color: `var(--text-dim)`.
- If `stat.smallSample` → render `{hits}/{n} prior {indicator} {signalType-label}s right *` with the trailing asterisk; tooltip: `"Small sample (n=${n})"`. Color: amber.
- Otherwise → render `{hits}/{n} prior … right`. Color tier: ≥60% `var(--buy)`, 40-59% `var(--warning)`, <40% `var(--sell)`.
- Hover always reveals the full definition: `"% of prior {indicator} {signalType} events on {ticker} × {timeframe} with {return condition} at {horizon}, before any stop logic."`

The component must NEVER render a percentage when `stat === null` and must NEVER render without the asterisk when `smallSample`. Add a unit test that fails if these contracts are broken.

### SignalBadge

**File:** `src/components/features/SignalBadge.tsx`

```typescript
interface SignalBadgeProps {
  direction: "buy" | "sell" | null;
  phase: "none" | "setup" | "countdown";
  indicator: "sequential" | "combo";
  count: number;
  max: 9 | 13;
  timeframe?: TF;                              // when shown, append " daily/weekly/..."
  isPerfected?: boolean;
  isQualified?: boolean;
  isDeferred?: boolean;
}
```

Renders nothing for `phase === "none"`. Otherwise: pill with arrow shape (▲ for Buy, ▼ for Sell) + indicator letter (S / C) + count "7/9" + optional ✓ (perfected/qualified) or `+` (deferred), and optional timeframe suffix. Direction is encoded by both arrow shape and color so red-green color blindness doesn't lose the signal.

### SignalBadge

**File:** `src/components/features/SignalBadge.tsx`

```typescript
interface SignalBadgeProps {
  direction: "buy" | "sell" | null;
  phase: "none" | "setup" | "countdown";
  count: number;
  isPerfected?: boolean;
  isQualified?: boolean;
}
```

Renders nothing for `phase === "none"`. Otherwise: pill with directional arrow + text `Buy 7/9` or `Sell 13/13 ✓`. Uses `--buy` / `--sell` background on dim alpha; full-saturation when count === max.

### TickerChart **Client**

**File:** `src/components/features/TickerChart.tsx`

```typescript
interface TickerChartProps {
  bars: Bar[];                    // OHLCV
  events: SignalEvent[];          // For markers
  tdstLines: { price: number; from: string; to?: string; direction: "buy" | "sell" }[];
  height?: number;
}
```

Mounts `lightweight-charts`. Adds:
- `addCandlestickSeries` for OHLC
- `addLineSeries` (or price-line per series) for each TDST level (color = `--buy`/`--sell`)
- `setMarkers` for TD numerals: each `setup_count` event becomes a marker with `position: "belowBar"` (buy) or `"aboveBar"` (sell), `text: count.toString()`, color matching direction. Completed `setup_complete` and `countdown_complete` events get a stronger marker (text `"9"` or `"13"` with a circle shape).
- Disposes the chart on unmount.

Responsive: chart container is `100% × min(60vh, 600px)` on desktop; `320px` on mobile.

### SignalTimeline

**File:** `src/components/features/SignalTimeline.tsx` (Server Component)

```typescript
interface SignalTimelineProps {
  events: SignalEvent[];
}
```

Vertical list, most recent first. Each row: date (mono), indicator+direction icon, event-type label, perfected/qualified badge, click → emits a custom event consumed by `TickerChart` to scroll to that bar.

### BacktestPanel

**File:** `src/components/features/BacktestPanel.tsx` (Server Component)

```typescript
interface BacktestPanelProps {
  ticker: string;
  timeframe: TF;
  indicator: "sequential" | "combo";
  data: BacktestResponse;
}
```

Header card with aggregate stats. Below: sortable table. Sorting is a `"use client"` sub-component, but the data is fetched server-side.

### AlertList

**File:** `src/components/features/AlertList.tsx`

```typescript
interface AlertListProps {
  alerts: Alert[];
  variant?: "compact" | "full";
  onMarkRead?: (id: string) => void;   // when present, makes it a Client Component
}
```

### ScanButton **Client**

**File:** `src/components/features/ScanButton.tsx`

```typescript
interface ScanButtonProps {
  scope?: "all" | { ticker: string };
  label?: string;
}
```

State: `idle` | `running { runId, progress: { done, total }, errors }` | `error { message }`. On click → `POST /api/scan` → poll `GET /api/scans/:id` every 1.5s until `finishedAt` is set → call `router.refresh()` on completion.

### AddTickerModal **Client**

**File:** `src/components/features/AddTickerModal.tsx`

```typescript
interface AddTickerModalProps {
  open: boolean;
  onClose: () => void;
  onAdded: (ticker: string) => void;
}
```

Inline Zod validation. POSTs to `/api/tickers`, calls `onAdded` + closes on success.

### UI Primitives

`src/components/ui/` contains: `Button`, `Card`, `Badge`, `Input`, `Modal`, `Tabs`, `Skeleton`, `Spinner`, `Pill`. Each is a thin wrapper over a `<div>`/`<button>` with cva-style variants and Tailwind classes.

---

## 7. Build Scripts

### `scripts/parity-check.ts`

**Purpose:** Run the TS engine on the same fixtures the legacy Python tests use; fail if any per-bar annotation diverges. The single most important guarantee that the rewrite is faithful.
**Runs:** locally + in CI on every PR.
**Input:** Fixture CSVs in `tests/engine/fixtures/` (committed). Each fixture is a small OHLCV slice + an expected per-bar annotation JSON.
**Output:** Exits 0 on parity, 1 on divergence with a unified diff.
**Invocation:**

```bash
pnpm tsx scripts/parity-check.ts
```

The fixtures are seeded by extracting the cases from `legacy/tests/test_sequential.py` once at the start of Phase 2. Each fixture file: `tests/engine/fixtures/<name>.{bars.csv,expected.json}`.

### `scripts/seed.ts`

**Purpose:** Seed local dev DB with default watchlist and the user record matching `OWNER_EMAIL`.
**Invocation:** `pnpm tsx scripts/seed.ts`.

### package.json scripts

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test",
    "parity": "tsx scripts/parity-check.ts",
    "seed": "tsx scripts/seed.ts",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "db:studio": "drizzle-kit studio"
  }
}
```

---

## 8. Deployment

### Platform: Vercel

Connect the GitHub repo. Production branch: `main`. Preview deploys on every PR.

### Environment Variables

| Variable | Description | Where |
|----------|-------------|-------|
| `TURSO_DATABASE_URL` | libSQL URL | Turso dashboard |
| `TURSO_AUTH_TOKEN` | libSQL auth token | Turso dashboard |
| `AUTH_SECRET` | Auth.js JWT signing secret | `openssl rand -base64 32` |
| `AUTH_URL` | Canonical app URL | e.g. `https://dm.vercel.app` |
| `AUTH_GOOGLE_ID` | OAuth client id | Google Cloud Console |
| `AUTH_GOOGLE_SECRET` | OAuth client secret | Google Cloud Console |
| `ALLOWED_EMAILS` | CSV of allowlisted Google emails | Set manually per env |
| `OWNER_EMAIL` | Email used by `scripts/seed.ts` | Set manually |
| `CRON_SECRET` | Bearer token for `/api/cron/scan` | `openssl rand -hex 24` |
| `DATA_PROVIDER` | `yahoo` (default) — future-proofing | Set manually |

`.env.example` ships in the repo with every var present and a comment but no values.

### `vercel.json`

```json
{
  "crons": [
    { "path": "/api/cron/scan", "schedule": "0 22 * * *" }
  ]
}
```

`0 22 * * *` UTC = 06:00 Asia/Taipei. The cron handler verifies `Authorization: Bearer ${CRON_SECRET}` (Vercel sends this automatically when configured, plus we double-check).

### Custom Domain

TBD. When the user picks a domain, point a CNAME at `cname.vercel-dns.com` and add it under Vercel project settings. Update `AUTH_URL`.

### CI/CD: GitHub Actions

```yaml
# .github/workflows/ci.yml
name: CI
on:
  push:
    branches: [main]
  pull_request:
jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm lint
      - run: pnpm test
      - run: pnpm parity
```

Vercel handles deploy on push to `main`.

---

## 9. Phased Build Plan

Each phase ends with a runnable, testable milestone.

### Phase 1 — Foundation (Auth, DB, Empty Dashboard)

**Goal:** A signed-in user can land on an empty dashboard, deployed on Vercel, with a working DB.

**Tasks:**
1. Move existing Python code to `legacy/`. Don't edit it.
2. Initialize Next.js 15 + TS + Tailwind v4 + ESLint with `pnpm`.
3. Add Drizzle + Turso. Create `src/lib/db/schema.ts` with all tables from §4. Generate first migration.
4. Configure Auth.js v5 with Google provider. Implement allowlist callback in `src/server/auth.ts`: reject sign-in if email not in `ALLOWED_EMAILS`. Redirect rejected users to `/access-denied`.
5. Build `TopNav`, `StatRow`, page shells (`/`, `/access-denied`, marketing landing). All return placeholder data.
6. Implement design tokens in `src/styles/globals.css` per the design doc.
7. Add UI primitives (`Button`, `Card`, `Badge`, `Modal`, `Input`, `Tabs`, `Skeleton`, `Pill`).
8. Wire `vercel.json` (cron stub returning 200), `.env.example`, GitHub Actions CI.
9. Ship `scripts/seed.ts`. Run it locally.
10. Deploy to Vercel preview. Confirm sign-in works for an allowlisted email.

**Milestone:** Allowlisted user signs in with Google, lands on dashboard showing zero stats and "Watchlist is empty." Database has the seeded watchlist row. CI runs typecheck + lint on PRs.

---

### Phase 2 — Engine Port (Sequential)

**Goal:** A canonical-spec-conformant TD Sequential engine in TypeScript. Where the legacy Python is canonical (Setup count detection, perfection check, basic Countdown comparison), we match it byte-for-byte. Where the legacy is non-canonical, we **deliberately depart** and document the change.

**Tasks:**
1. Read `legacy/demark/engine/sequential.py` and `legacy/demark/engine/tdst.py`. Port to `src/engine/sequential.ts` and `src/engine/tdst.ts`. Mirror types and dataclass shapes as TS interfaces.
2. Implement Price Flip detection (`src/engine/flip.ts`). **Gate Setup start on a confirmed bullish/bearish Price Flip** per `DeMark_Technical_Specification.md` §2.3, §3.1.1. (Legacy Python omits this — known correctness gap.)
3. Implement 13-vs-8 deferral with the "+" marker. When count 12 is reached but `l[bar_13_candidate] > c[bar_8]` (Buy) / `h[bar_13_candidate] < c[bar_8]` (Sell), set `isDeferred = true` and emit a `countdown_deferred` event for that bar. Continue searching forward; print 13 only when a bar satisfies both the standard Countdown rule and the 13-vs-8 rule. (Legacy treats this as a one-shot pass/fail at count 13 — known correctness gap.)
4. Set TDST anchor to **`extreme_of_setup`** per the modern DeMARK / official TradingView convention: TDST resistance for a Buy Setup = highest true high across all 9 Setup bars; TDST support for a Sell Setup = lowest true low across all 9 Setup bars. Make the anchor a config option (`tdst.anchor: "extreme_of_setup" | "bar_1" | "bar_before_1"`), defaulting to `extreme_of_setup`. The `bar_1` option matches the canonical Perl text; `bar_before_1` matches the legacy Python (which is wrong both relative to Perl and to modern DeMARK). Document all three in `src/engine/tdst.ts` doc comment with a clear "default = modern public" callout.
5. Implement Risk Level computation per `DeMark_Technical_Specification.md` §3.3 / §8.7. Emit `risk_level_breach` event when subsequent bars violate it. Store on `signalStates.riskLevel`.
6. Implement recycling per §3.2.5: both 18-bar same-direction extension AND 100–200% size-ratio. Tag the `setup_recycle` event meta with which trigger fired.
7. Implement 9-13-9 composite detection per §3.2.6. Emit `signal_9_13_9` events.
8. Implement engine `serialize()` / `restore()` so a scan can resume from `engineStateJson` instead of re-walking history every run. (See `DeMark_Technical_Specification.md` §8.10.) `serialize()` includes `configHash`; `restore()` rejects snapshots whose hash doesn't match the current engine config — same OHLC + different config = different counts, so a stored snapshot is meaningless without the config it was produced under.
8.5. Implement the deterministic per-bar processing order in `src/engine/index.ts` exactly as listed in `demark_indicator_tech_spec_GPT.md` §13.2:
   1. append/validate completed bar
   2. compute trueHigh / trueLow / trueRange
   3. update Buy + Sell Setup trackers
   4. emit Setup counts and completed-9 events
   5. compute Setup perfection status
   6. create/update TDST levels from newly completed Setups
   7. cancel active Countdowns if opposing Setup or TDST violation occurred
   8. activate newly eligible Sequential Countdowns
   9. activate / reconstruct newly eligible Combo Countdowns (with `firstKnownAt` set to today's bar date)
   10. update existing Sequential Countdowns for current bar
   11. update existing Combo Countdowns for current bar
   12. check recycling conditions
   13. generate risk levels for newly completed 9s/13s
   14. update 4-bar / 12-bar response metrics
   15. emit bar-annotation snapshot
   The order is load-bearing — cancellation MUST run before activation, recycling MUST run after countdown updates. Codify as numbered steps in the engine entrypoint with comments referencing this list.
8.6. **Combo `firstKnownAt` discipline.** When the engine reconstructs Combo counts retroactively from Setup bar 1 (in step 9 above, on the bar Setup completes), every emitted `signalEvent` for Combo MUST set `firstKnownAtDate = setupCompleteBarDate`, even though `barDate` is the earlier bar where the count actually occurred. Any backtest, alert, or hero ranking that consumes Combo events MUST gate on `firstKnownAtDate`, not `barDate`, to avoid look-ahead bias. Sequential events have `firstKnownAtDate === barDate`. Setup events have `firstKnownAtDate === barDate`.
9. **Test fixtures.** Three sources, each in its own directory:
   - **From the legacy Python tests**: extract input bars + expected per-bar annotations into `tests/engine/fixtures/legacy/<name>.{bars.csv,expected.json}`. Use these as parity-with-legacy oracles **only for the bits the legacy gets right**. Mark fixtures that test legacy-buggy behavior (TDST anchoring, deferral, missing Price Flip) with `expected_legacy_buggy: true` and write a parallel `expected_canonical.json` for the new TS engine.
   - **From the canonical specs**: author hand-crafted fixtures for **each of the 28 cases listed in `demark_indicator_tech_spec_GPT.md` §17.1** plus the cases in `DeMark_Technical_Specification.md` §10.1. The 28 GPT cases must be authored verbatim — they form the v1 acceptance bar:
     1. bearish price flip; 2. bullish price flip; 3. Buy Setup completes at 9; 4. Sell Setup completes at 9; 5. Setup interruption resets count; 6. Setup extension beyond 9; 7. Buy perfection on bar 8; 8. Buy perfection on bar 9; 9. late Buy perfection; 10. Sell perfection on bar 8/9; 11. TDST resistance from highest true high with a gap; 12. TDST support from lowest true low with a gap; 13. Sequential Buy count starts on Setup bar 9; 14. Sequential Sell count starts on Setup bar 9; 15. non-consecutive Countdown pauses and resumes; 16. 13-vs-8 deferral emits `+` and does not complete; 17. 8-vs-5 elective deferral; 18. opposing Setup cancellation; 19. TDST violation cancellation; 20. same-direction recycle at count 22; 21. recycle by range ratio; 22. Buy risk level using lowest true low and true range; 23. Sell risk level using highest true high and true range; 24. Combo retrospective counts from Setup bar 1; 25. Combo standard vs conservative divergence; 26. Combo `first_known_at` prevents look-ahead; 27. 12-bar expiration; 28. floating-point equality with tick tolerance.
     Place under `tests/engine/fixtures/canonical/`.
   - **From third-party reference impls**: capture 1–2 fixtures from TradingView's published DeMARK 9-13 script and the `tdsequential` npm package on liquid tickers (SPY, AAPL daily for the last 200 bars). Place under `tests/engine/fixtures/external/`. These are visual-diff oracles for cases where the canonical specs themselves disagree (intersection, recycle thresholds, perfection strictness).
10. Write `tests/engine/{sequential,tdst,flip,recycle,risk}.test.ts` covering the fixtures.
11. Add property-based tests (Vitest's `fast-check` or hand-written) covering the invariants from `demark_indicator_tech_spec_GPT.md` §17.3:
   - Setup count cannot jump by more than 1 per bar.
   - Countdown count cannot exceed 13.
   - Countdown counts are monotonic until cancel or recycle.
   - A completed Countdown has exactly 13 count indices.
   - A deferral marker cannot increment count.
   - A Risk Level exists after every completed 13 when `riskLevel.enabled` is true.
   - Every Combo event satisfies `firstKnownAtDate >= barDate`.
   - Setup counts reset cleanly on rule violation; no orphan counts persist.
   - Buy and Sell state machines never both print a Countdown count on the same bar.
12. Implement `scripts/parity-check.ts`. Add to CI.
13. Achieve green on all three fixture sets. Investigate any divergence; the canonical spec is the oracle when in conflict with the legacy.

**Milestone:** `pnpm parity` exits 0 against canonical, legacy, and external fixtures; engine coverage ≥ 90%; all property tests green.

**Do not move on until parity is solid.** This is the single highest-leverage gate in the build.

---

### Phase 3 — Data Layer + Scan Pipeline + Live Dashboard (synthesis layout)

**Goal:** A real scan runs end-to-end and the dashboard shows real data in the hero + rails layout. Hit-rate fields ship as placeholders (`null` → "—") since the backtest pipeline lands in Phase 5.

**Tasks:**
1. Implement `src/data/provider.ts` with `DataProvider` interface and a `YahooFinance2Provider` impl. Methods: `fetchDailyBars(ticker, fromDate?)` returns `Bar[]`.
2. Implement `src/data/resample.ts` (daily → weekly W-FRI, monthly ME, yearly YE). Match `legacy/demark/data/provider.py` resampling exactly. Add tests.
3. Implement `src/server/scan.ts` — the scan orchestrator. For each (ticker, timeframe): fetch missing bars, write to `bars`, run engine, upsert `signalStates`, **insert new `signalEvents`** (deduped by natural key), run `src/server/alerts.ts` to derive `alerts`.
4. Implement `src/server/alerts.ts` — generate alerts from completed events on the latest bar. Mirror legacy alert types: `setup_complete`, `countdown_complete`, `approaching_setup` (count ≥ 7), `approaching_countdown` (count ≥ 11). Dedupe via `dedupeKey` UNIQUE. Add the new event types from §4: `price_flip`, `countdown_deferred`, `risk_level_breach`, `signal_9_13_9`.
5. Implement API routes: `/api/tickers` (GET, POST), `/api/tickers/:symbol` (DELETE), `/api/scan` (POST), `/api/scans` + `/api/scans/:id`, `/api/signals`, `/api/alerts`.
6. Implement `/api/cron/scan` with `CRON_SECRET` check.
7. Implement `src/server/ranking.ts`. Public function: `rankSignals(states: SignalState[], events: SignalEvent[], hitRates: Map<HitRateKey, HitRateStat>): RankedSignal[]`. Scoring formula:
   ```
   imminence  = (count / max) * 100
   confluence = 1 + 0.4 * (numberOfOtherTimeframesWithSameDirection)
   credibility = 1 + 0.3 * ((hitRate ?? 0.5) - 0.5)        // 0.5 default when unknown so the term has no effect
   tfWeight   = { daily: 1.0, weekly: 1.4, monthly: 1.6, yearly: 1.8 }[timeframe]
   recencyDecay = 1.0 - (0.1 * daysAsHero)                 // 0 floor; reset when ticker drops off the watchlist
   score = imminence * confluence * credibility * tfWeight * recencyDecay
   ```
   Bucket signals into rails:
   - **justPrinted** = signals whose `setup_complete` / `countdown_complete` / `signal_9_13_9` event has `barDate >= mostRecentScan.startedAt` (i.e. printed during this scan or later).
   - **imminent** = active states with `(phase === "setup" && count >= 7) || (phase === "countdown" && count >= 11)`.
   - **watching** = remaining watchlist tickers.
   Hero = highest-scoring signal across all watchlist tickers, OR `nothing-notable` if max score < threshold (default 25.0). For `nothing-notable`, expose top 3 watchlist tickers approaching threshold (count >= 5) as `approaching`.
8. Implement `src/server/dashboard.ts`. Public function: `composeDashboardPayload(userId): DashboardResponse["data"]`. Joins watchlist + signal_states + signal_events + bars + (placeholder) hit rates → returns the JSON shape from §5. Cache for ~30s per user keyed on `(lastScanAt, watchlistHash)`.
9. Implement `src/lib/translations.ts` — registry of ~12 translation templates with named slots. Public function: `translate(hero: HeroPayload): { text: string; templateId: string }`. Each template is a pure function from a structured signal-combo object to a sentence; fall back to a generic factual summary `"<dir> <signalType> <count>/<max> on <timeframe>"` when no template matches. Keys to author for v1:
   - `perfected-9-with-imminent-13-other-tf` — "Buy Setup 9 perfected on the {tf1} with a Buy Countdown {n}/13 building on the {tf2} — reversal pressure stacked across both timeframes."
   - `perfected-9-no-confluence` — "Buy Setup 9 perfected on the {tf} — single-timeframe reversal signal."
   - `imminent-13` — "{dir} Countdown {n}/13 on the {tf} — 1 to 2 bars from completion."
   - `qualified-13` — "{dir} Countdown 13 just qualified on the {tf} — primary reversal signal printed."
   - `9-13-9-composite` — "9-13-9 composite on the {tf} — premium reversal pattern."
   - `imminent-9` — "{dir} Setup at {n}/9 on the {tf} — 1 to 2 bars from completion."
   - `multi-tf-confluence` — "{dir} signal stacked across {tf1} and {tf2} — both timeframes pointing the same direction."
   - `cancelled-recently` — "{dir} Countdown {n}/13 cancelled on the {tf} ({reason})."
   - `recycled` — "{dir} Setup recycled on the {tf} — momentum still extending."
   - `deferred-13` — "{dir} Countdown at 12+ on the {tf} — awaiting a bar that satisfies both rules."
   - `risk-breach` — "{dir} 13 invalidated by Risk Level breach on the {tf}."
   - `lapsed-13` — "{dir} 13 from {n} bars ago on the {tf} — no reversal yet."
   Each template ships with a unit test that asserts the rendered sentence against a fixture signal-combo object.
10. Implement `GET /api/dashboard` route that calls `composeDashboardPayload` for the current user.
11. Implement `src/lib/format.ts` for adaptive price/percent formatting (penny stocks 4dp, normal 2dp, mega caps as "$621.0k" in tile headers / full price in hero).
12. Build the new component set: `Hero`, `RailSection`, `TickerCard` (redesigned), `Sparkline`, `ConfluenceDots`, `HitRatePill`, `SignalBadge`, `AlertList` (compact), `ScanButton`, `AddTickerModal`. Wire dashboard `/` to fetch from `/api/dashboard` via a Server Component.
13. Update `vercel.json` cron to actually run `/api/cron/scan`.
14. **Hit rate placeholder behavior**: the dashboard payload includes `hitRate: null` for every tile and the hero in this phase. `HitRatePill` renders the em-dash + "Thin sample" tooltip uniformly. The contract is correct; only the underlying data is missing until Phase 5.

**Milestone:** Add `SPY` and `QQQ` from the dashboard. Click "Scan all". Watch progress. The dashboard renders with the hero (or "Nothing notable today" depending on signals), three rails grouped by intent, and tiles with sparklines + confluence dots + em-dash hit rates. Trigger the cron locally (`curl -H "Authorization: Bearer $CRON_SECRET" /api/cron/scan`) and verify the same flow runs.

---

### Phase 4 — Ticker Detail + Charts

**Goal:** Click a ticker card → see a candlestick chart with TD numerals, TDST lines, signal timeline, and (placeholder) backtest panel.

**Tasks:**
1. Implement `/api/bars/:symbol` and `/api/signals/events`.
2. Build `TickerChart` (Client Component). Wire `lightweight-charts`. Implement marker placement for `setup_count` and `setup_complete` events; implement TDST horizontal lines per active level.
3. Build `SignalTimeline`.
4. Build `/ticker/[symbol]/page.tsx` (Server Component) that fetches bars + events + state, renders chart + timeline. Add timeframe tab strip.
5. Build a placeholder `BacktestPanel` showing "Coming in Phase 5".
6. Build `/alerts/page.tsx` and `/scans/page.tsx` (full views).

**Milestone:** Open `/ticker/SPY`. See a candlestick chart with bar 1–9 numerals labeled and TDST lines drawn. Switch timeframes. Click a row in `SignalTimeline` and watch the chart focus the bar.

---

### Phase 5 — TD Combo + Backtest

**Goal:** Two indicators feeding the same UI; per-ticker backtest stats are real.

**Tasks:**
1. Implement `src/engine/combo.ts` per `DeMark_Technical_Specification.md` §4. Combo's Countdown begins at Setup bar 1 (not bar 9), making the earliest possible 13 = Setup bar 13. Default to **Version II (relaxed)**: bars 1–10 use the four-condition strict rule, bars 11–12–13 use the Sequential rule (`c[i] ≤ l[i-2]`). Make the variant a config flag (`combo.version: 1 | 2`, default 2). Apply the 13-vs-8 deferral check by default (configurable).
2. Build canonical fixtures for Combo since there are no legacy Python tests. Use `DeMark_Technical_Specification.md` §10.1 as the rule oracle and TradingView's TD Combo script as the visual oracle on 2–3 hand-picked tickers. Commit fixtures under `tests/engine/fixtures/canonical/combo/` and `tests/engine/fixtures/external/combo/`.
3. Wire Combo into the scan orchestrator alongside Sequential. Both indicators run for both directions on every (ticker, timeframe) — four state machines per scan unit.
4. Implement `src/engine/backtest.ts`. For each `setup_complete`, `countdown_complete`, and `signal_9_13_9` event in `signalEvents`, compute returns at +5 / +13 / +21 bars and Max Favorable Excursion using `bars`. Treat Risk Level breach as the implicit stop-out for any forward-looking return computation that crosses it.
   **No-lookahead discipline (mandatory):**
   - Entry bar for any signal MUST satisfy `entryBar > firstKnownAtDate`. Sequential and Setup events have `firstKnownAtDate === barDate` so this is just `entryBar > barDate` (i.e. enter on the next bar's open). Combo events that printed inside Setup bars 1–8 have `firstKnownAtDate === setupCompleteBarDate`, so the earliest possible entry is the bar AFTER Setup 9 — even though the Combo count visually appears earlier on the chart.
   - The backtest function signature must take `firstKnownAtDate` as a required parameter, not derive it from `barDate`.
   - Add a property test that fails if any reported return's entry bar precedes `firstKnownAtDate + 1`.
   - All horizon calculations (`+5`, `+13`, `+21`) are measured from the entry bar, not from the signal bar.
   See `demark_indicator_tech_spec_GPT.md` §14 for the full no-lookahead policy.
5. Implement `/api/backtest/:symbol`. Cache results by `(ticker, tf, indicator)` with a `lastComputedAt`; recompute when new events arrive or when underlying bars are refreshed.
6. **Backfill `/api/dashboard` hit rates from the backtest pipeline.** The composer in `src/server/dashboard.ts` looks up `HitRateStat` per `(ticker, timeframe, indicator, signalType)` from the new `signal_hit_rates` materialization table (see below). The contract from Phase 3 is unchanged — `HitRatePill` already handles `null`, `smallSample`, and full-stat states; only the data source flips from "always null" to "real."
7. Add a `signal_hit_rates` table to the schema with rows keyed `(ticker, timeframe, indicator, signalType)` storing `n`, `hits`, `avgReturnPct`, `horizon`, `lastComputedAt`. Recompute on scan completion.
8. Wire the real `BacktestPanel` on the ticker detail page. Show separate aggregate stats for Sequential vs. Combo, and for perfected vs. non-perfected signals.
9. Add a tab/toggle on `TickerCard` and `TickerChart` to switch between Sequential and Combo display. Charts show both simultaneously when the toggle is set to "Both", with Combo numerals in a different visual style (smaller, italic) so they don't collide with Sequential numerals.

**Milestone:** Ticker detail page shows both Sequential and Combo signals. Backtest panel shows hit rate and average return per indicator and per perfection state. The dashboard hero and tiles now show real `HitRatePill` values (color-coded for credibility, sample-size honest) instead of the em-dash placeholder. CI passes.

---

### Phase 6 — Polish & Operations

**Goal:** Production-ready quality.

**Tasks:**
1. Implement `/settings` (timezone display preference, alert threshold overrides).
2. Implement "mark alert read" via `PATCH /api/alerts/:id`.
3. Empty / error / loading states for every page (skeletons, error boundaries).
4. Stale-data banner on dashboard when last scan > 36 hours.
5. Mobile responsive pass — chart heights, single-column dashboard.
6. Playwright happy-path E2E: sign in (with a test user), see dashboard, open a ticker, see chart, trigger a scan.
7. Update `README.md` with run/deploy instructions.
8. Tag v1.0.

**Milestone:** End-to-end E2E test green. Lighthouse score ≥ 90 on dashboard. v1 released and used for a week without regressions.

---

## 10. Routine Prompts

None for v1. The cron is a deterministic data refresh, not an LLM-driven routine.

---

## Appendix A: Design Tokens (for quick reference)

Copy from `DESIGN_DOC.md` §4 verbatim into `src/styles/globals.css` as `:root` CSS custom properties, then expose to Tailwind via `tailwind.config.ts` `theme.extend.colors` referencing `var(--*)`.

```css
:root {
  --bg: #0d1117;
  --surface: #161b22;
  --surface-hover: #1c2129;
  --border: #30363d;
  --border-subtle: #21262d;
  --text: #e6edf3;
  --text-muted: #8b949e;
  --text-dim: #484f58;
  --accent: #58a6ff;
  --buy: #3fb950;
  --buy-dim: rgba(63,185,80,0.12);
  --sell: #f85149;
  --sell-dim: rgba(248,81,73,0.12);
  --warning: #d29922;
  --critical: #bc8cff;
  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 12px;
}
```

Spacing tokens follow Tailwind defaults (`space-1` = 4px, `space-2` = 8px, etc.).

---

## Appendix B: Engine Config

Engine behavior is governed by an `EngineConfig` object passed at construction. Defaults below are the **`official_current_approx` preset** (modern public DeMARK / TradingView convention). They can be overridden via `src/engine/config.ts` constants or env-var flags. v1 ships only this preset visibly; the structure supports `legacy_perl_approx` and `academic_lissandrin_approx` as future presets without code refactor (see Appendix E).

```typescript
export const DEFAULT_ENGINE_CONFIG = {
  preset: "official_current_approx" as const,

  setup: {
    length: 9,
    lookback: 4,                             // close vs close N bars earlier
    strict: true,                            // strict inequality (identical closes break the count)
    requirePriceFlip: true,                  // canonical Perl + most academic; modern TradingView allows continuous counting (`false`)
    allowExtensionBeyond9: true,             // continue counting past 9 if the rule still holds; needed for recycle range-ratio math
    perfection: {
      enabled: true,
      mode: "strict" as "strict" | "inclusive",  // modern uses strict; legacy Perl uses inclusive
      lookaheadBars: 4,                      // bars after count 9 to allow "late perfection"
    },
  },

  tdst: {
    anchor: "extreme_of_setup" as "extreme_of_setup" | "bar_1" | "bar_before_1",
                                             // modern public default; bar_1 = canonical Perl; bar_before_1 = legacy Python (wrong)
    breakoutTest: "true_range" as "true_range" | "close",
                                             // modern: true_low > resistance (Buy) cancels; legacy: close > resistance
    persistAcrossCountdowns: true,
  },

  sequential: {
    countdownLength: 13,
    countdownLookback: 2,                    // close vs low/high N bars earlier
    inclusive: true,                         // close <= low_2ago (canonical for countdown comparisons)
    startScan: "setup_bar_9" as const,       // Sequential count 1 begins on the bar of Setup 9 (or later)
    terminationCountValue: "close" as "close" | "open",
                                             // for the 13th count's price comparison; default close
    intersection: {
      enabled: false,                        // optional Sequential-only gate; off by default per modern DeMARK
    },
    deferral: {
      lastVs8Enabled: true,                  // 13-vs-8 with "+" marker
      eightVs5Enabled: false,                // optional analogue at count 8; off by default
    },
    cancellation: {
      opposingSetupEnabled: true,
      tdstViolationEnabled: true,
    },
    recycle: {
      enabled: true,
      setupCountThreshold: 22,               // modern public default; legacy Perl = 18
      rangeRatioMin: 1.0,
      rangeRatioMax: 2.0,                    // modern; legacy Perl = 1.618
      behavior: "reset_to_new_setup" as "reset_to_new_setup" | "mark_R_only",
    },
    twelveBarRulePostThirteen: true,         // informational `barsSince13` tracking
    fourBarRulePostNine: true,               // informational `barsSince9` tracking, parallel to 12-bar rule
  },

  combo: {
    version: "standard_public" as "conservative_public" | "standard_public" | "aggressive_public",
                                             // standard = strict 4-rule for counts 1-10, base-only for 11-13
    countdownLength: 13,
    countdownLookback: 2,
    startScan: "setup_bar_1" as const,       // Combo can begin counting at Setup bar 1 (retroactively confirmed at bar 9)
    deferral: {
      lastVs8Enabled: false,                 // off by default per public docs (Sequential-specific)
    },
    cancellation: {
      opposingSetupEnabled: true,
      tdstViolationEnabled: true,
    },
    recycle: {
      enabled: true,
      setupCountThreshold: 22,
    },
  },

  aggressive: {
    enabled: false,                          // out of v1 scope; engine reserves the seam
  },

  riskLevel: {
    enabled: true,
    generateOnSetup9: true,                  // 4-bar response window
    generateOnCountdown13: true,             // 12-bar response window
    multiplier: 1.0,                         // multiple of trueRange added/subtracted from the extreme bar
    processWindow: "countdown_process_including_unnumbered" as const,
                                             // window for finding the extreme: ALL bars from Setup→13, numbered AND unnumbered
  },

  output: {
    emitEvents: true,
    emitBarAnnotations: true,
    includeFirstKnownAt: true,               // critical for Combo to prevent backtest look-ahead bias
  },

  data: {
    requireAdjustedOhlc: true,               // splits/dividends must be pre-applied; equity high/low both adjusted
    imputeMissingBars: false,                // "N bars earlier" is bar-count, not calendar
    epsilon: { mode: "tick_aware", multiplier: 0.5 },
                                             // floating-point tolerance: 0.5 * tickSize, or relative tiny if tickSize unknown
  },

  configHash: "",                            // SHA-256 of the resolved config; computed at engine init; stored on every event + snapshot
} as const;
```

Engine implementations import this object directly. The `configHash` is computed deterministically from the resolved config and embedded in every emitted event, the engine snapshot, and the chart legend, so a stored event is meaningless without the config it was computed under and `restore()` rejects mismatched snapshots.

CLI / API surfaces should not let arbitrary callers override unsafe combinations. Document any deviation from the defaults in `src/engine/README.md`.

---

## Appendix C: Canonical Rule Reference Card

This is a condensed copy of `DeMark_Technical_Specification.md` Appendix A. The full spec is the source of truth; this card is for engine-implementer convenience.

| Phase | Direction | Rule |
|---|---|---|
| Bullish Price Flip | — | `c[i] > c[i-4]` AND `c[i-1] < c[i-5]` |
| Bearish Price Flip | — | `c[i] < c[i-4]` AND `c[i-1] > c[i-5]` |
| Buy Setup count i | Buy | `c[i] < c[i-4]` (consecutive ×9, **gated by Bearish Price Flip at count 1**) |
| Sell Setup count i | Sell | `c[i] > c[i-4]` (consecutive ×9, gated by Bullish Price Flip at count 1) |
| Perfected Buy Setup | Buy | `min(l[8], l[9]) ≤ min(l[6], l[7])` |
| Perfected Sell Setup | Sell | `max(h[8], h[9]) ≥ max(h[6], h[7])` |
| Sequential Buy Countdown count | Buy | `c[i] ≤ l[i-2]` (non-consecutive ×13) |
| Sequential Sell Countdown count | Sell | `c[i] ≥ h[i-2]` (non-consecutive ×13) |
| Sequential 13-vs-8 Buy | Buy | `l[bar_13_candidate] ≤ c[bar_8]` (else mark `+`, defer to next qualifying bar) |
| Sequential 13-vs-8 Sell | Sell | `h[bar_13_candidate] ≥ c[bar_8]` (else mark `+`, defer) |
| Combo V1 Buy Countdown count | Buy | `c[i]≤l[i-2]` AND `l[i]<l[i-1]` AND `c[i]<c[i-1]` AND `c[i]<c[prev_count_bar]` |
| Combo V1 Sell Countdown count | Sell | `c[i]≥h[i-2]` AND `h[i]>h[i-1]` AND `c[i]>c[i-1]` AND `c[i]>c[prev_count_bar]` |
| Combo V2 (default) | both | V1 for counts 1–10, Sequential rule for counts 11–12–13 |
| Aggressive Buy Countdown count | Buy | `l[i] ≤ l[i-2]` *(out of v1 scope)* |
| Aggressive Sell Countdown count | Sell | `h[i] ≥ h[i-2]` *(out of v1 scope)* |
| TDST Buy Resistance | Buy Setup | high of count-1 bar (canonical default; `extreme_of_setup` available via config) |
| TDST Sell Support | Sell Setup | low of count-1 bar |
| Risk Level (Buy 13) | Buy | `trueLow(L) − range(L)` where `L` = bar with lowest true low across Setup→Countdown window |
| Risk Level (Sell 13) | Sell | `trueHigh(H) + range(H)` where `H` = bar with highest true high across the window |
| 9-13-9 Composite (Buy) | Buy | After a completed Buy 13: a fresh Buy Setup completes preceded by a Bullish Price Flip, with no completed Sell Setup intervening |
| 9-13-9 Composite (Sell) | Sell | Mirror |

**Cancellation gates (any of these clears an active Countdown before 13 prints):**
1. Opposite-direction Setup completion.
2. TDST violation (modern public default): Buy Countdown — `trueLow[i] > buyTdstResistance` (the entire bar lifts above the resistance, not just the close); Sell Countdown — `trueHigh[i] < sellTdstSupport`. This is stricter than a close-only test and matches what the modern DeMARK products use. The close-only test is a legacy variant available via `tdst.breakoutTest: "close"`.

**Recycling triggers (during in-progress Countdown, same-direction Setup extends):**
1. Same-direction Setup extends to count **22** (modern public default; legacy Perl text uses 18, available via `recycle.setupCountThreshold: 18`).
2. Overlapping Setup's `(highest true high − lowest true low)` falls in 100–200% of the prior Setup's range. Legacy variant: 100–161.8% (golden-ratio anchored).
The `setup_recycle` event meta records which trigger fired plus the prior and new Setup ranges.

**Edge cases (all explicit defaults — see Appendix B for overrides):**
- Strict inequality on Setup (identical closes break the count).
- Bars are bar-count, not calendar days; missing bars are not imputed.
- OHLC must be split/dividend-adjusted before reaching the engine.

**Departures from the legacy Python codebase (`legacy/`):** documented in `src/engine/README.md` and listed in §9 Phase 2 Task 4. The legacy Python is **not** an oracle for: Price Flip gating, deferral logic, TDST anchoring, Risk Level, 9-13-9, or recycling.

---

## Appendix D: Hero Ranking + Translation Contract

The hero is the single highest-leverage UI affordance — it directly drives what the user looks at first every morning. Its scoring and translation must be deterministic, auditable, and rule-based (no LLM calls in v1) so behavior is debuggable and free.

### D.1 Ranking score

For each active `SignalState` on each (ticker × timeframe × indicator), compute:

```
imminence    = (count / max) * 100                              // 0..100
confluence   = 1 + 0.4 * sameDirOtherTimeframeCount             // 1.0..2.6 (bonus per other timeframe with same-direction signal)
credibility  = 1 + 0.3 * ((hitRate ?? 0.5) - 0.5)               // 0.85..1.15 (penalty if track record < coinflip; bonus if better)
tfWeight     = { daily: 1.0, weekly: 1.4, monthly: 1.6, yearly: 1.8 }[timeframe]
recencyDecay = max(0, 1.0 - 0.1 * daysAsHero)                   // 0..1; decays 10% per day this ticker has been hero

score = imminence * confluence * credibility * tfWeight * recencyDecay
```

Tiebreakers (in order): higher confluence count, more recent `asOfBarDate`, alphabetical ticker.

The hero = the highest-scoring signal across the watchlist. If the top score < `HERO_THRESHOLD` (default 25.0, configurable via env), emit `type: "nothing-notable"`.

`daysAsHero` is tracked in a per-user `hero_history` table with `(userId, ticker, timeframe, indicator, date)`; when a ticker stops being hero for ≥ 1 day, the counter resets.

### D.2 Translation contract

`translate(hero)` returns `{ text, templateId }` from a registry of pure functions in `src/lib/translations.ts`. Templates are tried in priority order; the first that matches its precondition wins. If no template matches, fall back to `genericFactual(hero)` which returns `"<dir> <signalType> <count>/<max> on <timeframe>."`.

Rules:
- No template may reference more than the data fields in the hero payload.
- Each template must have a unit test asserting the rendered sentence against a fixture signal-combo object.
- Sentences are at most 25 words.
- Sentences end with a period. No exclamation points.
- No first or second person ("you", "we", "I"). Third-person factual register only.
- The word "stacked" is reserved for confluence templates; the word "perfected" is reserved for perfected-9 templates; etc. — see `src/lib/translations.ts` for the dictionary.

### D.3 Hit-rate definition (single source of truth)

The hit-rate computation must respect the no-lookahead discipline from §9 Phase 5: returns are measured from `entryBar = firstKnownAtDate + 1`, not from `signalBar`. For Sequential and Setup events the difference is zero; for Combo events that printed inside Setup bars 1–8 the difference is up to 8 bars.



```
hitRate(ticker, timeframe, indicator, signalType)
  = count(events where (close[entryBar + 13] - close[entryBar]) > 0 for Buy
                       (close[entryBar] - close[entryBar + 13]) > 0 for Sell)
  / count(events of that type, before any stop logic)

  where entryBar = bar AFTER firstKnownAtDate
```

Horizon `+13` adapts to the timeframe label (daily → "+13d", weekly → "+13w", monthly → "+13m", yearly → "+13y"). Tooltips on every `HitRatePill` render this definition verbatim with the timeframe substituted.

`smallSample` flag is `true` when 5 ≤ n < 10; `null` is returned when n < 5 (no rate computable). The component contract in §6 is what enforces the on-screen behavior; the data layer just provides the right shape.

---

## Appendix E: Preset variants (architectural seam, v1 ships only the default)

The engine config (Appendix B) is structured so multiple named presets can be selected at engine init without code changes. v1 ships only `official_current_approx`. The other presets are documented here so the seam is real (and so the schema doesn't need to change when we add them).

### E.1 `official_current_approx` (default — v1 ships this)

The Appendix B defaults verbatim. Approximates current public DeMARK / official TradingView behavior. Modern TDST anchoring (extreme of Setup), modern TDST cancellation test (true_range), recycle threshold 22, recycle range 100–200%, perfection strict, 13-vs-8 deferral on, intersection off, 8-vs-5 deferral off.

### E.2 `legacy_perl_approx` (future preset)

Approximates the canonical Jason Perl text and older academic implementations.

```typescript
{
  preset: "legacy_perl_approx",
  setup: { ...defaults, requirePriceFlip: true,
           perfection: { ...defaults.perfection, mode: "inclusive" } },
  tdst: { ...defaults.tdst, anchor: "bar_1", breakoutTest: "close" },
  sequential: { ...defaults.sequential,
                intersection: { enabled: true },
                recycle: { ...defaults.sequential.recycle, setupCountThreshold: 18, rangeRatioMax: 1.618 } },
}
```

### E.3 `academic_lissandrin_approx` (future preset)

Approximates the Lissandrin ETH Zürich thesis parameterization.

```typescript
{
  preset: "academic_lissandrin_approx",
  setup: { ...defaults, length: 9, lookback: 4 },
  sequential: { ...defaults.sequential, countdownLength: 13, countdownLookback: 2 },
  combo: { ...defaults.combo, version: "conservative_public", startScan: "setup_bar_1" },
  aggressive: { ...defaults.aggressive, enabled: true },
}
```

### E.4 Combo-only presets

The `combo.version` field on its own gives three Combo variants without changing the rest of the engine: `conservative_public` (strict 4-rule for all 13 counts), `standard_public` (4-rule for 1–10, base-only for 11–13 — the v1 default), and `aggressive_public` (`L[i] <= L[i-2]` for buys / `H[i] >= H[i-2]` for sells — looser base condition).

### E.5 Adding a preset later

A preset is a `Partial<EngineConfig>` merged onto the default. The `configHash` is computed from the resolved (post-merge) config, so every event tagged with that hash is unambiguous about which preset produced it. To add a preset:

1. Author the partial config in `src/engine/presets.ts` keyed by name.
2. Add the preset name to the `EngineConfig.preset` enum.
3. Add a unit test that resolves and compares against expected fixture output.
4. Surface the preset in the chart legend ("preset: legacy_perl_approx").

No schema changes, no API changes. Adding a preset switcher to the user UI is a separate v2 task.

