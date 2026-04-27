# DM Engine

Pure-TypeScript DeMark Sequential + Combo + 9-13-9 engine. No Next/React/DOM
imports anywhere under `src/engine/`. Importable by tests, scripts, and
the server alike.

## Public surface

```ts
import { DeMarkEngine, resolveConfig } from "@/engine";

const engine = new DeMarkEngine();           // default = official_current_approx
const { events, annotations } = engine.run(bars);

// Incremental resume
const snap = engine.serialize();             // store this in signalStates.engineStateJson
const resumed = DeMarkEngine.restore(snap);  // throws if configHash differs
```

## Determinism

Every emitted `SignalEvent` includes `configHash`. The hash is derived from
the resolved `EngineConfig` (`hashConfig(config)` in `config.ts`) so a
stored event is meaningless without the config it was produced under, and
`DeMarkEngine.restore` rejects mismatched snapshots.

## Departures from the legacy Python (`legacy/demark/engine/sequential.py`)

The legacy is **not** an oracle for the following — see SPEC.md §9 Phase 2:

1. **Price Flip gating** — legacy starts a Setup as soon as
   `c[i] < c[i-4]` (Buy) without requiring a confirmed Bearish Price
   Flip. The engine here gates on the flip per
   `DeMark_Technical_Specification.md` §3.1.1. (Configurable via
   `setup.requirePriceFlip`.)
2. **13-vs-8 deferral** — legacy treats this as a one-shot pass/fail at
   count 13. The engine here uses the canonical "+" deferral marker and
   continues searching forward.
3. **TDST anchoring** — legacy uses the `bar_before_1` anchor (the bar
   BEFORE Setup count 1). This is wrong both vs. the canonical Perl text
   (`bar_1`) and the modern public DeMARK convention
   (`extreme_of_setup`). Default is `extreme_of_setup`.
4. **TDST cancellation test** — legacy uses close-only. Modern public
   DeMARK uses the true_range test (entire bar lifts above the level).
   Default is `true_range`; legacy variant available via
   `tdst.breakoutTest: "close"`.
5. **Risk Level** — legacy doesn't compute one. The engine here does, per
   `DeMark_Technical_Specification.md` §3.3 / §8.7.
6. **9-13-9 composite** — not in legacy. Implemented here.
7. **Recycling** — legacy recycles only on opposing/same setup completion.
   The engine here implements both the count-22 extension trigger and
   the 100–200% range-ratio trigger.

## Per-bar processing order

The order is load-bearing — cancellation MUST run before activation,
recycling MUST run after countdown updates. The 15 numbered steps live
in `DeMarkEngine.process` in `index.ts` with comments referencing
`demark_indicator_tech_spec_GPT.md` §13.2 and SPEC.md §9 Phase 2 Task 8.5.
