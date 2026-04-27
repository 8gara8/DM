# DM

Small-crew DeMark signal monitor. Tracks TD Sequential + TD Combo across
daily / weekly / monthly / yearly bars on a shared watchlist.

> Public-source DeMark-style approximation. Not a licensed DeMARK product.
> "DeMARK" / "TD" / the indicator names are trademarks of their respective owners.

## Status

Phase 1 + Phase 2 of `SPEC.md` are in:

- ✅ Next.js 15 + TypeScript + Tailwind v4 scaffolding
- ✅ Drizzle schema (Turso/libSQL) + Auth.js v5 (Google + allowlist)
- ✅ Pure-TS DeMark engine: TD Sequential, TD Combo (V1/V2/aggressive),
      TDST, perfection (with late-perfection lookahead), 13-vs-8 deferral,
      TDST/opposing-Setup cancellation, recycling (count-22 + range-ratio),
      Risk Level, 9-13-9 composite, `serialize()`/`restore()` with
      `configHash`, no-lookahead-aware backtest helper
- ✅ 34 vitest unit tests covering flip / setup / perfection / TDST /
      recycle / risk / snapshot round-trip / backtest / resample
- ✅ `parity-check.ts` script (fixture corpus to be filled in)
- ✅ Page shells for `/`, `/access-denied`, `/alerts`, `/scans`,
      `/api/auth/[...nextauth]`, `/api/cron/scan`
- ⏳ Phases 3–6 (data layer, scan pipeline, ticker detail, charts,
      Combo backtest, polish) per `SPEC.md`

The Phase-1 Python codebase has been preserved verbatim under `legacy/`
per `SPEC.md` §9. Don't edit it.

## Run locally

```bash
pnpm install
cp .env.example .env.local         # then fill in Auth + Turso + ALLOWED_EMAILS
pnpm seed                          # one-time: seeds owner user + default watchlist
pnpm dev
```

## Test / lint / build

```bash
pnpm typecheck   # strict TS
pnpm test        # vitest unit + property tests
pnpm parity      # engine fixture parity
pnpm build       # next build
```

## Layout

```
src/
├── app/             # Next.js App Router pages + API routes
├── components/      # ui/, layout/, features/
├── engine/          # Pure-TS DeMark engine (no Next/React imports)
├── data/            # provider + resample
├── server/          # auth, scan orchestrator (Phase 3)
├── lib/             # db, time, ids, format, utils
└── styles/          # globals.css (design tokens)
tests/engine/        # vitest fixtures + property tests
scripts/             # parity-check.ts, seed.ts
legacy/              # Phase-1 Python — read-only
```

See `SPEC.md` for the full build plan, `src/engine/README.md` for engine
docs (incl. departures from the legacy Python).
