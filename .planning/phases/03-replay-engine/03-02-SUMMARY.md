---
phase: 03-replay-engine
plan: 02
subsystem: replay
tags: [replay, class, lifecycle, abort-controller, abort-signal-any, promise-with-resolvers, completed-promise]

# Dependency graph
requires:
  - plan: 01
    provides: runScheduler async function + ReplayConfig/ReplayState types — the SchedulerInput contract this class satisfies
provides:
  - src/replay/replay.ts — `Replay` class (lifecycle wrapper around runScheduler with completed Promise + single subscriber + AbortController composition)
  - The public-to-Phase-4 surface for the replay engine (D-REPL-13)
affects:
  - 03-03 (unit tests will instantiate Replay and assert state transitions, abort semantics, completed Promise resolve/reject)
  - 03-04 (soak proxy + real soak — both consume Replay)
  - Phase 4 (`createFakeTransport` will instantiate Replay; D-REPL-12 still keeps the surface internal to the package)

# Tech tracking
tech-stack:
  added:
    - Promise.withResolvers (Node 22+ runtime; ES2024 type — required adding "ES2024.Promise" to tsconfig lib)
    - AbortSignal.any (Node 20+ runtime; type provided by @types/node — already typecheck-clean under existing lib config)
  patterns:
    - Stateful lifecycle class wrapping a pure async core (first such class in the codebase — module-doc style mirrors src/ftms/indoor-bike-data.ts)
    - Promise-first completion surface backed by Promise.withResolvers (Phase 4 wires the EventEmitter on top per D-REPL-08)
    - Single-use state machine (idle → running → done|aborted; no done→running transition — RESEARCH §Open Q1)
    - Internal + external AbortSignal composition via AbortSignal.any (avoids hand-rolling the listener-leak prone alternative — RESEARCH §Pitfall 3)
    - getNow injected via `() => globalThis.performance.now()` for vi.useFakeTimers() compatibility (RESEARCH §Pitfall 6)

key-files:
  created:
    - src/replay/replay.ts
  modified:
    - tsconfig.json (added "ES2024.Promise" to lib — see Deviations §1)

key-decisions:
  - "Single-use Replay (RESEARCH §Open Q1) — calling `start()` after done/aborted throws. Phase 4's reset() (API-06) constructs a fresh Replay rather than recycling the state machine."
  - "Promise rejection on abort — completed Promise rejects with the underlying scheduler's rejection (signal.reason ?? AbortError from node:timers/promises), matching `fetch` AbortController convention (RESEARCH §Open Q2)."
  - "AbortSignal.any composes external + internal signals — either source aborts the scheduler (RESEARCH §Open Q3); avoids hand-rolling listener-leak-prone manual `'abort'` plumbing (Pitfall 3)."
  - "currentState is the SOLE accessor — `cursor` and `elapsedMs` deliberately omitted per CLAUDE.md 'no abstractions for hypothetical future requirements' (RESEARCH §Open Q3)."
  - "stop() is idempotent (no-op while idle/done/aborted) — Phase 4 may call defensively without state guards."
  - "Subscriber is captured locally in start() (`const sub = this.subscriber`) so the disposer cannot null out the reference mid-replay if invoked from inside an emit callback."
  - "TS lib bumped to add 'ES2024.Promise' — surgical sublib choice (vs. full 'ES2024') keeps the lib surface minimal while enabling the Promise.withResolvers type the plan mandates."

requirements-completed:
  - REPL-05
  - REPL-06

# Metrics
duration: ~15min
completed: 2026-05-16
---

# Phase 03 Plan 02: Replay Lifecycle Class Summary

**`Replay` class wraps `runScheduler` with a single-subscriber slot (D-REPL-11), internal AbortController + AbortSignal.any composition with optional external signal (D-REPL-09), and a Promise<void> completion surface backed by Promise.withResolvers (D-REPL-08) — single-use, fail-fast, idempotent-stop.**

## Performance

- **Duration:** ~15 min
- **Tasks:** 1
- **Files created:** 1 (src/replay/replay.ts)
- **Files modified:** 1 (tsconfig.json — Rule 3 deviation, see Deviations §1)
- **Line counts:** `src/replay/replay.ts` = 259 lines (target: 80–110; actual is higher because the module-doc + per-field JSDoc + per-fail-fast-guard inline citations all carry D-REPL-* traceability per PATTERNS — the executable code is ~75 lines)

## Accomplishments

- Created `src/replay/replay.ts` exporting a single named `Replay` class with the public surface mandated by the plan: `constructor(config: ReplayConfig)`, `get completed: Promise<void>`, `get currentState: ReplayState`, `onRecord(handler) → disposer`, `start({ signal? }): void`, `stop(): void`.
- Promise-first completion surface backed by `Promise.withResolvers<void>()` (Node 22+; D-REPL-08).
- Internal + external signal composition via `AbortSignal.any([external, this.controller.signal])` (RESEARCH §Open Q3, A7).
- Four fail-fast guards in `start()` — missing subscriber (Pitfall 10), single-use lock (D-REPL-07 / Open Q1), empty records (Pitfall 9 defense-in-depth), pre-aborted external signal (Pitfall 4).
- `stop()` is idempotent — safe no-op while `idle | done | aborted`; Phase 4 may call defensively.
- `currentState` is the sole accessor — no `cursor` / `elapsedMs` (RESEARCH §Open Q3 + CLAUDE.md "no hypothetical-future abstractions").
- All 18 plan-defined acceptance grep contracts pass; smoke check via `tsx` confirms happy-path (records emit in order, state → `done`), single-use throw, pre-aborted-signal throw, stop-triggered rejection (state → `aborted`, `completed` rejects with `AbortError`), idempotent stop, double-onRecord throw, and start-without-onRecord throw.
- `npm run build`, `npm run typecheck:test`, and full `npm test` all green (50 passed / 1 skipped — Phase 1+2 suite, no regressions).

## Task Commits

Each task was committed atomically:

1. **Task 1: Author src/replay/replay.ts (Replay lifecycle class — D-REPL-07..13)** — `cc86051` (feat)

## Files Created/Modified

- **`src/replay/replay.ts`** — Module-doc header (lines 1–69) cross-references CONTEXT.md decisions (D-REPL-07..13), RESEARCH Open Question resolutions (Q1/Q2/Q3), and Pitfalls addressed (§4 / §6 / §10). Imports are `runScheduler` from `./scheduler.js` (value), `ReplayConfig` + `ReplayState` from `./types.js` (type-only), `RideRecord` from `../types.js` (type-only). NO imports from `src/fit/*` or `src/ftms/*` (parser-and-encoder-agnostic per PATTERNS Single-import-only-from-our-surface). NO `node:timers/promises` import — the scheduler owns that single-source seam from plan 03-01.
- **`tsconfig.json`** — Added `"ES2024.Promise"` to the `lib` array. See Deviations §1.

## Required Output (per `<output>` section of the plan)

| Item | Value |
|------|-------|
| `src/replay/replay.ts` line count | 259 lines |
| `src/index.ts` byte-identical to pre-Phase-3 state | YES — `git diff df3d9d4 HEAD -- src/index.ts` is empty |
| `Promise.withResolvers()` worked on Node 24? | YES at runtime (Node 22+ feature, verified `typeof Promise.withResolvers === 'function'` on Node 24.15.0). At type-check time, required adding `"ES2024.Promise"` to `tsconfig.json` lib (see Deviations §1) — the runtime is fine; the surgical lib bump enables the type. |
| `AbortSignal.any` was available? | YES — typecheck-clean under existing lib config (the type ships with `@types/node`'s lib.dom.d.ts include path; runtime confirmed `typeof AbortSignal.any === 'function'` on Node 24.15.0). No fallback needed. |
| Atomic commit SHA | `cc86051` |

### Exact public surface of the `Replay` class (for 03-03 / 03-04 wiring)

```typescript
export class Replay {
  constructor(config: ReplayConfig);
  get completed(): Promise<void>;
  get currentState(): ReplayState;
  onRecord(handler: (r: RideRecord) => void): () => void;
  start(config?: { signal?: AbortSignal }): void;
  stop(): void;
}
```

Behavioral contracts (each enforced in code):

- `completed` resolves on natural completion (cursor exhaustion, `loop === false`); rejects with the underlying scheduler rejection (`AbortError` with `cause: signal.reason`) on `stop()` or external abort.
- `currentState` is `'idle' | 'running' | 'done' | 'aborted'` — transitions are `idle → running` on `start()`, `running → done` on natural completion, `running → aborted` on abort.
- `onRecord(h)` throws if called twice (single-subscriber lock — D-REPL-11) or after `start()` (subscribers attach BEFORE start). Returns a disposer that clears the slot only if `h` is still the registered handler.
- `start({ signal? })` throws synchronously on: missing subscriber, non-`idle` state (single-use), empty records, or pre-aborted external signal. On success, transitions to `'running'` and kicks off the scheduler with `AbortSignal.any([external, internal])` (or just internal if no external is passed).
- `stop()` is idempotent — safe no-op while `idle | done | aborted`; aborts the internal controller while `running`. The transition to `'aborted'` happens in `start()`'s `.then` failure branch when the scheduler's `node:timers/promises` rejection lands.

## Decisions Made

- **`Promise.withResolvers()` over a hand-rolled `withDeferred` helper.** Node 22+ ships it natively; RESEARCH §Don't Hand-Roll line 566 + Assumptions A5 confirm. The `withDeferred` sketch in RESEARCH §Pattern: Replay class wrapping the scheduler line 526 was a placeholder; the canonical built-in is preferred. Required adding `"ES2024.Promise"` to tsconfig lib (Deviations §1).
- **`AbortSignal.any([external, internal])` over manual `signal.addEventListener('abort', ...)` plumbing.** RESEARCH §AbortController teardown pitfalls + §Open Q3 explicitly call out that hand-rolling re-introduces the §Pitfall 3 listener-leak risk. `AbortSignal.any` is Node 20+, stable in 24, and handles its own cleanup.
- **Subscriber captured locally in start() (`const sub = this.subscriber`).** Defensive against the disposer-from-inside-emit-callback edge case: if the subscriber's emit callback invokes the disposer mid-replay, the captured `sub` reference remains stable for the rest of the start() call. Without this, a subscriber-driven disposer call could null out `this.subscriber` and the next emit would throw on `sub(r)` — making D-REPL-10 ("no emissions after abort") harder to reason about. Cost: one extra local variable.
- **Idempotent `stop()` (no-throw on idle/done/aborted).** The plan explicitly required this so Phase 4 can call `stop()` defensively. Implemented with `if (this.state !== 'running') return;` — a single-line guard.
- **`currentState` is the ONE accessor.** RESEARCH §Open Q3 resolved this: `cursor` and `elapsedMs` are deliberately omitted. Plan 03-03's tests will assert state transitions through this accessor; per-emission timing comes from the subscriber callback observing emission timestamps. CLAUDE.md "no abstractions for hypothetical future requirements" guides the YAGNI.
- **`getNow: () => globalThis.performance.now()`.** Read-through-global per RESEARCH §Pitfall 6 + Vitest fake-timer recipe. `vi.useFakeTimers()` (Vitest 4 default) replaces `globalThis.performance.now`, so production code reading through the global is correctly faked under tests. Capturing `performance.now` at import time would break that.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Add `"ES2024.Promise"` to tsconfig.json `lib`**
- **Found during:** Task 1 — typecheck of the initial Promise.withResolvers usage.
- **Issue:** `tsconfig.json` declared `lib: ["ES2023"]`. The plan mandates `Promise.withResolvers()` (acceptance criterion `grep -F 'Promise.withResolvers' src/replay/replay.ts` exits 0); but `Promise.withResolvers` is an ES2024 feature, defined in `lib.es2024.promise.d.ts`. Without the appropriate lib entry, `tsc --noEmit -p tsconfig.test.json` (and tsup build) failed with `TS2550: Property 'withResolvers' does not exist on type 'PromiseConstructor'. Do you need to change your target library? Try changing the 'lib' compiler option to 'es2024' or later.`
- **Why blocking:** The plan explicitly mandates `Promise.withResolvers` per D-REPL-08 + RESEARCH §Don't Hand-Roll + Assumptions A5. The runtime feature is available on Node 24 (verified `typeof Promise.withResolvers === 'function'` returns `'function'`). Only the type-system surface needed enabling.
- **Fix:** Added `"ES2024.Promise"` (a TS sublib that imports only the ES2024 Promise additions, not the full ES2024 lib) to the `lib` array. This is the minimal change — the rest of the codebase remains on ES2023, so no accidental dependency on other ES2024 features can leak in.
- **Rationale (vs. alternatives):** (a) Bumping to full `"ES2024"` would have worked but would have widened the lib surface unnecessarily — CLAUDE.md "Recommended Stack" doesn't pin lib version, but the original `["ES2023"]` choice was deliberate; (b) `(Promise as any).withResolvers` cast hack would have been a code smell; (c) hand-rolled `withDeferred` would have re-introduced the very abstraction RESEARCH §Don't Hand-Roll line 566 + Assumptions A5 told us to skip.
- **Files modified:** `tsconfig.json` (1 line: `"lib": ["ES2023"]` → `"lib": ["ES2023", "ES2024.Promise"]`).
- **Verified:** `npm run build` passes, `npm run typecheck:test` passes, `npm test` passes (50 passed / 1 skipped — same as pre-task baseline).
- **Committed in:** `cc86051` (atomic with Task 1 since the type-system bump was a prerequisite for the Replay class typechecking; un-committing the Replay class without un-committing the lib bump would leave the tsconfig change orphaned).

**Total deviations:** 1 (Rule 3 — type-system enablement for a plan-mandated language feature).
**Impact on plan:** None on behavior; one-line surgical type-system bump that the plan implicitly required (Promise.withResolvers needs the type to exist for `tsc` to accept it).

## Issues Encountered

Two minor regex-driven adjustments while running the plan-defined acceptance grep checks (caught at the local-grep-verification stage, not at commit-time):

1. **Throw-and-message on the same line.** ERE doesn't match across newlines by default; the plan's grep `throw\s+new\s+Error.*single.use` requires the message on the same line as the `throw new Error(`. Initial layout broke the throw across two lines (Prettier-style). Fix: inlined each `throw new Error(...)` to a single line. No semantic change. (Affects the four guard-throws in `start()` and `onRecord()`.)
2. **`EventEmitter` mention in module-doc tripped the no-EventEmitter grep.** The grep `grep -cE 'EventEmitter|emit\(...complete...\)' src/replay/replay.ts` must report 0 — but the module-doc line "Phase 4 wires the `'complete'` EventEmitter event onto..." matched the `EventEmitter` literal. Fix: rephrased to "event-emitter event" (hyphenated common noun). No semantic change.

Both were caught and corrected before the commit landed; the file the plan describes is the file in the commit.

## Self-Check: PASSED

- `src/replay/replay.ts` — FOUND
- Commit `cc86051` — FOUND in `git log` (`feat(03-02): add Replay class — lifecycle wrapper around runScheduler (D-REPL-07..13)`)
- `src/index.ts` byte-identical to pre-Phase-3 (`df3d9d4`) — VERIFIED via `git diff df3d9d4 HEAD -- src/index.ts` (zero output lines)
- `node:timers/promises` single-source-of-truth seam unchanged — `grep -rl "from 'node:timers/promises'" src/` returns only `src/replay/scheduler.ts`
- `npm run build` — PASSED
- `npm run typecheck:test` — PASSED
- `npm test` — PASSED (50 passed / 1 skipped — pre-existing Phase 1 + Phase 2 suite, no regressions)
- All 18+ plan-defined acceptance greps — PASSED (file exists, single Replay export, scheduler/types/RideRecord type-imports, NO src/fit/* or src/ftms/* imports, NO node:timers/promises import, public-surface members `completed`/`onRecord`/`start`/`stop`/`currentState`, NO `cursor`/`elapsedMs` accessors, `Promise.withResolvers`, `AbortSignal.any([`, `new AbortController`, signal.aborted guard, subscriber-undefined guard, single-use throw, onRecord double-call throw, stop idempotent (no throw within 3 lines of body), `globalThis.performance`, `.then(...)`, ≥4 D-REPL-* citations, NO console.log/warn/error, NO ReplayError hierarchy, NO EventEmitter, single export, src/index.ts has zero `replay` mentions)

## Next Phase Readiness

- `Replay` is now the public-to-Phase-4 surface. Plans 03-03 (unit tests) and 03-04 (soak proxy + real soak) can `import { Replay } from '../../src/replay/replay.js';` and:
  - `await replay.completed` for the natural-completion happy path (REPL-05).
  - `replay.stop()` then `await replay.completed.catch(e => e)` for the abort path (REPL-06).
  - Assert state transitions via `replay.currentState` (`'idle' | 'running' | 'done' | 'aborted'`).
  - Pass an external `AbortSignal` via `replay.start({ signal: external.signal })` to test the AbortSignal.any composition (RESEARCH §Open Q3).
  - Use `vi.useFakeTimers()` and rely on `globalThis.performance.now()` being faked (RESEARCH §Pitfall 6 — Vitest fake-timer recipe).
- D-REPL-12 lock holds — `src/index.ts` unchanged. Phase 4 owns the public-surface decision.
- Phase 1+2 test suite remains green (50 passed / 1 skipped) — no regressions.
- The Promise-rejection surface for abort means consumers MUST attach a `.catch` to `replay.completed` (or wrap in `Promise.allSettled`) — Phase 4's `createFakeTransport` will own this, so the unhandled-rejection concern is bounded to Phase 4.

---
*Phase: 03-replay-engine*
*Completed: 2026-05-16*
