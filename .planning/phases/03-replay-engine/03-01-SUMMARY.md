---
phase: 03-replay-engine
plan: 01
subsystem: replay
tags: [replay, scheduler, foundation, types, drift-correction, abort-controller, node-timers-promises]

# Dependency graph
requires:
  - phase: 02-fit-loader-normalization
    provides: RideRecord shape (sorted ascending by timestamp, no exact duplicates, length >= 1) — the iteration target for runScheduler
provides:
  - src/replay/types.ts — internal ReplayConfig + ReplayState types (D-REPL-13 file split)
  - src/replay/scheduler.ts — pure async runScheduler implementing the drift-corrected setTimeout-chain (D-REPL-01..06,09)
  - SchedulerInput contract — the four-config-fields + signal/emit/getNow injection seam that 03-02's Replay class will consume
  - Single-source-of-truth import seam for node:timers/promises in src/ (mirrors D-FIT-08)
affects:
  - 03-02 (Replay class wraps runScheduler with AbortController + completed Promise + single-subscriber slot)
  - 03-03 (unit tests import runScheduler directly — no class instance needed)
  - 03-04 (soak proxy + real soak — both consume the Replay class which wraps this scheduler)
  - Phase 4 (FakeTransport will wrap Replay; D-REPL-12 keeps this surface internal until then)

# Tech tracking
tech-stack:
  added:
    - node:timers/promises (built-in; AbortSignal-aware sleep — RESEARCH §AbortController teardown pitfalls)
    - util.debuglog('trainer-sim:replay') namespace (NODE_DEBUG-gated observability)
  patterns:
    - Pure-async-function scheduler with injected getNow seam (mirrors src/fit/normalize.ts pure-function-with-debuglog pattern)
    - Single-source-of-truth import for the cross-cutting timing dep (mirrors D-FIT-08's parser-import enforcement)
    - Internal-only types module (D-REPL-12 — opposite of src/types.ts which IS publicly re-exported)

key-files:
  created:
    - src/replay/types.ts
    - src/replay/scheduler.ts
  modified: []

key-decisions:
  - "Per-tick recompute Math.max(target - getNow(), minIntervalMs) — D-REPL-02 absolute-target-time + D-REPL-04 Infinity-via-clamp in one expression"
  - "Explicit `speed === Infinity ? 0 : ...` guard for cursor=0 NaN edge (RESEARCH §Pitfall 8) — preferred over the accidental `setTimeout(NaN)` clamp"
  - "Empty-records early return (RESEARCH §Pitfall 9) — defense-in-depth even though Phase 2 throws upstream"
  - "Promise.withResolvers() NOT used here — scheduler is a pure async function, no deferred Promise needed; 03-02 will use it (or a withDeferred helper) inside the Replay class"
  - "SchedulerInput interface lives in scheduler.ts not in types.ts — function signatures stay next to the function (mirrors src/fit/normalize.ts ParsedFitMinimal)"
  - "Compile-time guard `_schedulerInputCoversConfig` — static type-system tripwire that fires if a future plan adds a ReplayConfig field without deciding whether the scheduler also needs it"

patterns-established:
  - "Replay-engine module-doc style: `Implements (per CONTEXT.md):` + bulleted D-REPL-* refs, then `Pitfalls addressed:` numbered §-refs (parallel to src/fit/normalize.ts but adds the pitfall section)"
  - "Conditional debuglog summary on natural-end branch (clampedTicks/totalTicks) — not per-tick — keeps NODE_DEBUG output signal-rich"
  - "AbortSignal-as-required: SchedulerInput.signal is non-optional because cancellation IS the contract, not an opt-in"

requirements-completed:
  - REPL-01
  - REPL-02
  - REPL-03
  - REPL-04
  - REPL-06

# Metrics
duration: ~10min
completed: 2026-05-16
---

# Phase 03 Plan 01: Replay Engine Foundation Summary

**Internal `runScheduler` async function and `ReplayConfig`/`ReplayState` types — drift-corrected setTimeout-chain over `RideRecord[]` with `node:timers/promises` AbortSignal cancellation, ready for 03-02's `Replay` class to wrap.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-05-16T07:10:00Z (approx — guards + reads)
- **Completed:** 2026-05-16T07:20:48Z
- **Tasks:** 2
- **Files modified:** 2 (both created — `src/replay/` directory is new)
- **Line counts:** `src/replay/types.ts` = 91 lines · `src/replay/scheduler.ts` = 231 lines

## Accomplishments

- Created `src/replay/types.ts` with internal `ReplayConfig` (records, speed, loop, maxEmissionHz) and `ReplayState` ('idle' | 'running' | 'done' | 'aborted') interfaces; per-field JSDoc cites D-REPL-04/05/06.
- Created `src/replay/scheduler.ts` exporting a single async `runScheduler(input: SchedulerInput): Promise<void>`. Algorithmic body implements absolute-target-time drift correction (D-REPL-02), maxEmissionHz floor (D-REPL-04/05), loop-boundary re-base (D-REPL-06), AbortSignal cancellation via `node:timers/promises` (D-REPL-09), `speed === Infinity` deterministic guard (Pitfall 8), and empty-records defense-in-depth (Pitfall 9).
- Established single-source-of-truth import seam: `src/replay/scheduler.ts` is the ONLY file in `src/` importing `'node:timers/promises'` — mirrors D-FIT-08's parser-import enforcement and trips a grep check in this plan's acceptance criteria.
- `src/index.ts` byte-identical to its pre-Phase-3 state (D-REPL-12 enforced).

## Task Commits

Each task was committed atomically:

1. **Task 1: Author src/replay/types.ts (ReplayConfig + ReplayState internal interfaces, D-REPL-13)** — `f452c0f` (feat)
2. **Task 2: Author src/replay/scheduler.ts (drift-corrected runScheduler async fn, D-REPL-01..06/09)** — `19ca747` (feat)

## Files Created/Modified

- `src/replay/types.ts` — Internal `ReplayConfig` + `ReplayState` types (Phase 3 only — not re-exported from `src/index.ts` per D-REPL-12). Imports `RideRecord` from `../types.js` via `import type` (verbatimModuleSyntax compliance).
- `src/replay/scheduler.ts` — Pure async drift-corrected scheduler. Imports `setTimeout as sleep` from `'node:timers/promises'`, `debuglog` from `'node:util'`, plus type-only imports of `ReplayConfig` and `RideRecord`. Defines an internal `SchedulerInput` interface (kept inside this file because it is a function signature, not a public-shape type — analog: `ParsedFitMinimal` in `src/fit/normalize.ts`).

## Decisions Made

- **`Promise.withResolvers()` deferred to 03-02.** The scheduler is a stateless pure async function — it has no need for a deferred Promise. The wrapper class in 03-02 will use `Promise.withResolvers()` (Node 22+, verified available in Node 24) for `replay.completed`. RESEARCH §Don't Hand-Roll line 566 + Assumptions A5 confirm availability; no `withDeferred` helper needed at this layer.
- **`SchedulerInput` interface lives in `scheduler.ts`, NOT `types.ts`.** Per PATTERNS lines 130–131 — `SchedulerInput` is a function signature (transient, function-scoped), while `ReplayConfig`/`ReplayState` are public-shape types (used by callers). Mirrors `src/fit/normalize.ts`'s `ParsedFitMinimal` (function-scoped) vs `src/types.ts`'s `RideRecord` (public-shape) split.
- **`signal: AbortSignal` is required, not optional.** Cancellation IS the contract for a long-running async loop — opt-in cancellation would invite the §Pitfall 4 "no cancellation path" antipattern. Plan 03-02's `Replay.start()` always constructs an internal `AbortController`; external signals compose via `AbortSignal.any([...])` per RESEARCH §Open Question 3.
- **Static type-system tripwire (`_schedulerInputCoversConfig`).** A compile-time identity-style assignment that fires if a future plan adds a field to `ReplayConfig` without explicitly deciding whether the scheduler also needs it. Surfaces type-level drift between `ReplayConfig` and `SchedulerInput` at `tsc` time, not at runtime — a low-cost defense against the same class of drift CLAUDE.md flags as "no abstractions for hypothetical future requirements" (this isn't an abstraction; it's a static check).

## Deviations from Plan

None — plan executed exactly as written, with two minor regex-driven adjustments during the acceptance-criteria check:

### Adjustments to satisfy plan-defined grep contracts (not deviations)

**1. Removed two literal `'node:perf_hooks'` strings from comment text (Task 2 — pre-commit grep).**
- **Found during:** Task 2 acceptance verification.
- **Issue:** The plan's grep `grep -cE "from\s+['\"]node:perf_hooks['\"]" src/replay/scheduler.ts` must report 0, but two commentary mentions of the string `from 'node:perf_hooks'` in the JSDoc header matched the regex. The intent of the grep is "this file does not IMPORT from `node:perf_hooks`" — verified true; the comment text was unintentionally tripping the contract.
- **Fix:** Rephrased the two comments to reference "the perf-hooks module" without quoting the literal `from 'node:perf_hooks'` string. No semantic change.
- **Files modified:** `src/replay/scheduler.ts` (lines ~20, ~53).
- **Verification:** Grep now reports 0. Build + typecheck:test + npm test all green.
- **Committed in:** `19ca747` (Task 2 commit — fix made before the commit landed).

**2. Restructured `Math.max` call to inline `target` (Task 2 — pre-commit grep).**
- **Found during:** Task 2 acceptance verification.
- **Issue:** The plan's grep `grep -E 'Math\.max\s*\(.*target' src/replay/scheduler.ts` must match. Initial implementation factored the delay computation into `const rawDelay = target - getNow(); const delay = Math.max(rawDelay, minIntervalMs);` — semantically identical to the canonical RESEARCH §Drift correction code sketch but the regex never sees `target` inside `Math.max`.
- **Fix:** Inlined to `const delay = Math.max(target - getNow(), minIntervalMs);` (now a literal copy of the RESEARCH sketch). The clamp counter retained as a separate `if (target - getNow() < minIntervalMs)` check.
- **Files modified:** `src/replay/scheduler.ts` (Step 4b).
- **Verification:** Grep now matches twice (the inlined Math.max plus the clamp-counter check); behavior unchanged.
- **Committed in:** `19ca747` (Task 2 commit — fix made before the commit landed).

**Total adjustments:** 2 (both satisfying explicit plan-defined grep contracts; neither changed observable behavior).
**Impact on plan:** None — the canonical RESEARCH algorithm is preserved verbatim; the adjustments restored the file to the exact shape the plan's grep contracts expected.

## Issues Encountered

None — both tasks landed on the first commit attempt after the two adjustments above (which were caught at the local-grep-verification stage, not during commit).

## Required Output (per `<output>` section of the plan)

| Item | Value |
|------|-------|
| `src/replay/types.ts` line count | 91 lines |
| `src/replay/scheduler.ts` line count | 231 lines |
| `src/index.ts` byte-identical to pre-Phase-3 state | YES — `git diff df3d9d4 HEAD -- src/index.ts` is empty |
| `src/replay/scheduler.ts` is the SOLE importer of `node:timers/promises` in `src/` | YES — `grep -rl "from 'node:timers/promises'" src/` returns only `src/replay/scheduler.ts` |
| `Promise.withResolvers()` used in this plan? | NO — deferred to 03-02 (the scheduler is stateless; the wrapper class is the right home for the deferred Promise) |
| `withDeferred()` helper introduced? | NO — not needed at this layer |
| Task 1 commit | `f452c0f` |
| Task 2 commit | `19ca747` |

### Exact `SchedulerInput` interface shape (for 03-02 wiring)

```typescript
interface SchedulerInput {
  records: ReadonlyArray<RideRecord>;
  speed: number;
  loop: boolean;
  maxEmissionHz: number;
  signal: AbortSignal;            // REQUIRED — not optional
  emit: (record: RideRecord) => void;   // synchronous
  getNow: () => number;            // monotonic ms; production: () => performance.now()
}
```

03-02's `Replay.start()` will build this by spreading `...this.config` (which is a `ReplayConfig`) and adding `signal`, `emit`, `getNow`. The static `_schedulerInputCoversConfig` tripwire in `scheduler.ts` enforces that `ReplayConfig` covers the four shared fields at compile time.

## Self-Check: PASSED

- `src/replay/types.ts` — FOUND
- `src/replay/scheduler.ts` — FOUND
- Commit `f452c0f` — FOUND in `git log`
- Commit `19ca747` — FOUND in `git log`
- `src/index.ts` byte-identical to pre-Phase-3 — VERIFIED via `git diff df3d9d4 HEAD -- src/index.ts` (empty output)
- `node:timers/promises` single-source-of-truth seam — VERIFIED (`grep -rl ... src/` returns only `src/replay/scheduler.ts`)
- `npm run build` — PASSED
- `npm run typecheck:test` — PASSED
- `npm test` — PASSED (50 passed, 1 skipped — pre-existing Phase 1 + Phase 2 suite, no regressions)

## Next Phase Readiness

- `runScheduler` and `ReplayConfig` ready for plan 03-02's `Replay` class to import directly. The `SchedulerInput` shape is fully documented above so 03-02's planner needs no further codebase exploration.
- Drift-correction algorithmic correctness is in place; the REPL-03 250 ms gate is verifiable in plans 03-04 (soak proxy + real soak) — no algorithmic blockers.
- Single-source-of-truth seam tested by acceptance grep in this plan; future plans editing scheduler.ts will trip the same grep if they accidentally re-import `node:timers/promises` elsewhere.
- D-REPL-12 lock holds — `src/index.ts` unchanged. Phase 4 owns the public-surface decision.

---
*Phase: 03-replay-engine*
*Completed: 2026-05-16*
