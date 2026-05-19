---
phase: 03-replay-engine
verified: 2026-05-16T14:30:00Z
status: passed
score: 4/4 must-haves verified
overrides_applied: 0
re_verification:
  previous_status: null
  previous_score: null
  gaps_closed: []
  gaps_remaining: []
  regressions: []
code_review_followups:
  - id: WR-01
    severity: warning
    file: src/replay/scheduler.ts:216-219
    summary: "Math.max(target - getNow(), minIntervalMs) calls getNow() twice; clamp counter biased"
  - id: WR-02
    severity: warning
    file: src/replay/replay.ts:259-272
    summary: "currentState reflects stale 'running' for a microtask after stop() — undocumented async"
  - id: WR-03
    severity: warning
    file: src/replay/replay.ts:159-172,230
    summary: "Disposer returned by onRecord becomes silent no-op once start() captures the subscriber"
  - id: WR-04
    severity: warning
    file: src/replay/replay.ts:86-91
    summary: "private readonly config JSDoc claims 'Frozen at construction' but no Object.freeze applied"
  - id: WR-05
    severity: warning
    file: src/replay/replay.ts:199-218
    summary: "start() does not validate speed/maxEmissionHz finiteness; invalid configs reach scheduler"
  - id: WR-06
    severity: warning
    file: src/replay/scheduler.ts:197-198
    summary: "while (true) with eslint-disable instead of for (;;)"
  - id: IN-01
    severity: info
    file: test/replay/*.test.ts
    summary: "fakeAwareSleep helper duplicated across four files — extract to shared helper"
  - id: IN-02
    severity: info
    file: src/replay/scheduler.ts:148-153
    summary: "_schedulerInputCoversConfig is opaque — prefer satisfies-based static assertion"
  - id: IN-03
    severity: info
    file: test/replay/*.test.ts
    summary: "'Group N — ' describe prefixes are scaffolding noise"
  - id: IN-04
    severity: info
    file: test/replay/soak*.test.ts
    summary: "console.log diagnostics should use console.info or be gated on env"
out_of_scope_edits:
  - file: tsconfig.json
    plan: 03-02
    reason: "Added 'ES2024.Promise' to lib for Promise.withResolvers types (Node 22+ runtime feature)"
    impact: "Type-system only; production behavior unchanged"
  - files: ["src/replay/scheduler.ts", "src/replay/replay.ts"]
    plan: 03-03
    reason: "Added optional sleep? injection seam to work around Vitest 4 + node:timers/promises ESM-binding incompatibility"
    impact: "Additive; default falls through to node:timers/promises in production. Phase 4 will not pass sleep."
---

# Phase 3: Replay Engine Verification Report

**Phase Goal:** Library replays a `RideRecord[]` in real time with configurable speed, loop/stop-at-end behavior, drift-bounded timing, and clean cancellation

**Verified:** 2026-05-16T14:30:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| #   | Truth                                                                                                                                                                                                  | Status     | Evidence                                                                                                                                                                                                                                                                                                                                                                              |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | A 30-minute FIT replayed at `speed=1` ends within 250 ms of the source FIT duration (drift-corrected scheduler verified by long-soak smoke test)                                                       | ✓ VERIFIED | `test/replay/soak.test.ts:71` asserts `expect(Math.abs(elapsed - fitDurationMs)).toBeLessThan(250);` — gated on `RUN_SOAK=1` (D-REPL-15). CI proxy `test/replay/soak-proxy.test.ts` runs every push and passed locally with measured drift = 1.86ms (vs 2000ms tolerance) per 03-04-SUMMARY. Algorithm at `src/replay/scheduler.ts:209-216` implements per-tick recompute (D-REPL-02). |
| 2   | Setting `speed=Infinity` replays as fast as possible without exceeding the configurable max emission-rate cap                                                                                          | ✓ VERIFIED | `src/replay/scheduler.ts:207-216` — `targetSinceStart = speed === Infinity ? 0 : ...; delay = Math.max(target - getNow(), minIntervalMs)`. `test/replay/scheduler.test.ts` Group 3 verifies 1000 records at speed=Infinity, maxEmissionHz=100 → 10s wall-clock. `speed: Infinity` appears 2× in scheduler.test.ts.                                                                     |
| 3   | Default end-of-file behavior stops the replay and emits a `'complete'` event a test can `await`; setting `loop: true` restarts from the first record without drift accumulating across loop boundaries | ✓ VERIFIED | `Replay.completed: Promise<void>` resolves on stop-at-end (`src/replay/replay.ts:248-251`); `test/replay/replay.test.ts` Group 1 asserts `await replay.completed` resolves + state→'done'. Loop boundary re-base at `scheduler.ts:265` (`baseline = getNow()`); `test/replay/loop.test.ts` Group 1 asserts inter-iteration drift `< 5ms` over 3 iterations.                            |
| 4   | After `disconnect()` resolves, no further `onData` callbacks fire (verified by a "wait 100 ms after disconnect, assert zero emissions" test)                                                            | ✓ VERIFIED | `test/replay/abort.test.ts` Group 1 implements zero-emissions-in-100ms-after-stop pattern. Group 5 (CR-01 regression) verifies post-sleep abort window. Scheduler at `scheduler.ts:235-237` has explicit `if (signal.aborted) throw signal.reason` guard between sleep-return and emit. Internal AbortController + AbortSignal.any composition at `replay.ts:220-223`.                |

**Score:** 4/4 truths verified

### Required Artifacts (from PLAN frontmatter)

| Artifact                            | Expected                                                                          | Status     | Details                                                                                                          |
| ----------------------------------- | --------------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------- |
| `src/replay/types.ts`               | Internal ReplayConfig + ReplayState (D-REPL-13)                                   | ✓ VERIFIED | 91 lines (target 25+); exports `ReplayConfig` interface + `ReplayState` union; imports `RideRecord` via `import type` from `../types.js`. Cites D-REPL-04/05/06/12/13. WIRED — imported by scheduler.ts and replay.ts. |
| `src/replay/scheduler.ts`           | Pure async drift-corrected runScheduler                                            | ✓ VERIFIED | 270 lines (target 60+); exports `runScheduler` async function. Imports `setTimeout as defaultSleep` from `node:timers/promises` (line 70). Implements per-tick recompute, loop re-base, Infinity guard, empty-records early return. Cites 8 D-REPL-* references. |
| `src/replay/replay.ts`              | Replay lifecycle class wrapping runScheduler                                       | ✓ VERIFIED | 284 lines (target 80+); exports `Replay` class with `completed` getter, `currentState` getter, `onRecord(handler) → disposer`, `start({ signal?, sleep? })`, `stop()`. Uses `Promise.withResolvers()` (line 125) and `AbortSignal.any([...])` (line 222). |
| `test/replay/scheduler.test.ts`     | runScheduler unit tests (REPL-01, REPL-02, Pitfalls 8 + 9)                          | ✓ VERIFIED | 285 lines, 7 tests + sanity. 5 Group declarations. Uses `vi.useFakeTimers` + `vi.advanceTimersByTimeAsync` (10×). Internal-path import only (D-REPL-12). |
| `test/replay/replay.test.ts`        | Replay class lifecycle tests (REPL-05, D-REPL-07/08/11, Pitfalls 4 + 10)           | ✓ VERIFIED | 268 lines, 10 tests. 5 Groups. `Replay` import from `../../src/replay/replay.js`; no src/index.js import. |
| `test/replay/abort.test.ts`         | REPL-06 cancellation tests + CR-01 regression                                       | ✓ VERIFIED | ~390 lines (1.3KB grew with CR-01 regression); 5 Groups including Group 5 (CR-01 regression at line 238 — race-window test using custom raceSleep). Asserts `name: 'AbortError'` rejections. |
| `test/replay/loop.test.ts`          | REPL-04 loop boundary tests                                                          | ✓ VERIFIED | 178 lines, 3 tests. 3 Groups. Asserts inter-iteration drift `< 5` ms via `globalThis.performance.now()`. Asserts `loop: true` doesn't auto-transition to `'done'`. |
| `test/replay/soak-proxy.test.ts`    | CI-tier drift-correction regression detector                                         | ✓ VERIFIED | 100 lines. Real timers (no `vi.useFakeTimers`). Loads `perf-1hr.fit` via public `loadFitFromBuffer`; constructs Replay via internal path. Asserts elapsed within ±2000ms of 30000ms target. 60s timeout. Locally measured drift = 1.86ms. |
| `test/replay/soak.test.ts`          | Release-tier 30-min real-clock soak (REPL-03 acceptance gate)                       | ✓ VERIFIED | 97 lines. `describe.skipIf(!process.env.RUN_SOAK)` at line 38. Slices fixture by 30-min FIT-relative timestamp delta. Asserts `Math.abs(elapsed - fitDurationMs) < 250`. 32-min per-test timeout. |

### Key Link Verification

| From                                | To                              | Via                                                              | Status   | Details                                                                       |
| ----------------------------------- | ------------------------------- | ---------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------- |
| `src/replay/scheduler.ts`           | `node:timers/promises`          | `import { setTimeout as defaultSleep }` line 70                  | ✓ WIRED  | SOLE importer in `src/` — verified `grep -rl "from 'node:timers/promises'" src/` returns only `src/replay/scheduler.ts`. Single-source seam (mirrors D-FIT-08). |
| `src/replay/scheduler.ts`           | `src/replay/types.ts`           | `import type { ReplayConfig } from './types.js'` line 72         | ✓ WIRED  | Type-only import; `_schedulerInputCoversConfig` static check ensures field coverage at compile time. |
| `src/replay/scheduler.ts`           | `src/types.ts`                  | `import type { RideRecord } from '../types.js'` line 73          | ✓ WIRED  | Type-only RideRecord import; correct relative path with .js extension.        |
| `src/replay/replay.ts`              | `src/replay/scheduler.ts`       | `import { runScheduler } from './scheduler.js'` line 75          | ✓ WIRED  | runScheduler invoked at replay.ts:235 with full SchedulerInput including signal/emit/getNow/sleep. |
| `src/replay/replay.ts`              | `src/replay/types.ts`           | `import type { ReplayConfig, ReplayState } from './types.js'` line 76 | ✓ WIRED  | Both types used: ReplayConfig as constructor param; ReplayState as field type. |
| `src/replay/replay.ts`              | global AbortController + .any   | `new AbortController()` line 220; `AbortSignal.any([...])` line 222 | ✓ WIRED  | Internal controller created in start(); composed with optional external signal via AbortSignal.any. |
| `test/replay/*.test.ts`             | `../../src/replay/replay.js`    | named import of Replay (4 unit-test files + 2 soak files)         | ✓ WIRED  | D-REPL-12 internal-path discipline preserved across all 6 test files.       |
| `test/replay/scheduler.test.ts`     | `../../src/replay/scheduler.js` | named import of runScheduler                                      | ✓ WIRED  | Direct import of pure async function for unit testing.                        |
| `test/replay/soak*.test.ts`         | `../../src/index.js`            | named import of `loadFitFromBuffer` (public Phase 2 surface)      | ✓ WIRED  | Soak tests legitimately use the public loader; internal Replay still imported via internal path. |
| `test/replay/soak.test.ts`          | `process.env.RUN_SOAK`          | `describe.skipIf(!process.env.RUN_SOAK)` line 38                   | ✓ WIRED  | Opt-in gate verified — `npm test` reports 2 skipped (the soak + local FIT smoke). |

### Data-Flow Trace (Level 4)

| Artifact                  | Data Variable          | Source                                                            | Produces Real Data                                                       | Status     |
| ------------------------- | ---------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------ | ---------- |
| `src/replay/scheduler.ts` | `record` (per tick)    | `input.records[cursor]` populated from caller-supplied RideRecord[] | YES — Phase 2 invariant: sorted ascending non-empty array                | ✓ FLOWING  |
| `src/replay/scheduler.ts` | `target` (per tick)    | `baseline + (record.timestamp - firstTs) / speed` computed live   | YES — recomputed every iteration, drift-corrected (D-REPL-02)            | ✓ FLOWING  |
| `src/replay/replay.ts`    | `sub` (subscriber)     | Captured from `this.subscriber` at start() (line 230)              | YES — fail-fast guard at line 207-209 ensures subscriber is set          | ✓ FLOWING  |
| `src/replay/replay.ts`    | `signal`               | AbortSignal.any composite OR internal controller.signal           | YES — either source aborts the scheduler                                  | ✓ FLOWING  |
| `src/replay/replay.ts`    | `completedDeferred`    | `Promise.withResolvers()` in constructor                           | YES — resolved by .then() on success, rejected by .then() on failure     | ✓ FLOWING  |
| `test/replay/soak-proxy.test.ts` | `records`           | `loadFitFromBuffer(readFileSync('perf-1hr.fit'))`                  | YES — 4562 records measured locally; speed = 152.03×                     | ✓ FLOWING  |

All artifacts that render dynamic data (per-tick state, scheduler progress, completion Promise) flow real data — no static returns, no hardcoded empty values, no orphaned props.

### Behavioral Spot-Checks

| Behavior                                                  | Command                                          | Result                                              | Status |
| --------------------------------------------------------- | ------------------------------------------------ | --------------------------------------------------- | ------ |
| Production build succeeds                                 | `npm run build`                                  | ESM 6.54 KB, CJS 6.97 KB, DTS 10.19 KB, exit 0      | ✓ PASS |
| All tests pass (modulo opt-in soak + local FIT)           | `npm test`                                       | 11 files passed + 2 skipped, 77 tests + 2 skipped, exit 0 | ✓ PASS |
| Soak proxy passes locally (~30s wall-clock)                | `npx vitest run test/replay/soak-proxy.test.ts`  | 1 passed, duration 30.11s                            | ✓ PASS |
| Single-source seam preserved (only scheduler.ts imports node:timers/promises) | `grep -rl "from 'node:timers/promises'" src/` | Returns only `src/replay/scheduler.ts`              | ✓ PASS |
| D-REPL-12 internal-only lock holds                         | `grep -c "replay" src/index.ts`                  | Returns 0                                            | ✓ PASS |
| All Phase 3 commits present                                | `git log --oneline | grep <sha>` for 12 SHAs    | All 12 commits found (incl. e4b04a9 CR-01/CR-02 fix)| ✓ PASS |

### Probe Execution

No conventional `scripts/*/tests/probe-*.sh` probes exist in this project. The phase's verification gate is `npm test` + behavioral spot-checks above. PLAN frontmatter does not declare additional probes.

| Probe                           | Command                | Result | Status              |
| ------------------------------- | ---------------------- | ------ | ------------------- |
| n/a — no probes declared/found  | n/a                    | n/a    | SKIPPED (no probes) |

### Requirements Coverage

| Requirement | Source Plan(s)            | Description                                                          | Status      | Evidence                                                                                               |
| ----------- | ------------------------- | -------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------ |
| REPL-01     | 03-01, 03-03              | Real-time emission respecting FIT timestamps                          | ✓ SATISFIED | scheduler.ts per-tick `target = baseline + (record.timestamp - firstTs) / speed`; scheduler.test.ts Group 1 |
| REPL-02     | 03-01, 03-03              | speed multiplier (incl. Infinity) with maxEmissionHz cap              | ✓ SATISFIED | scheduler.ts:207-216 `Math.max(...)` clamp + `speed === Infinity ? 0 : ...` guard; scheduler.test.ts Groups 2/3/4 (speed=Infinity 2× + maxEmissionHz=100) |
| REPL-03     | 03-01, 03-04              | drift-corrected; end within 250 ms of FIT duration over 30-min replay | ✓ SATISFIED | soak.test.ts:71 `expect(Math.abs(elapsed - fitDurationMs)).toBeLessThan(250)` (gated on RUN_SOAK=1); soak-proxy.test.ts CI regression detector (drift = 1.86ms / ±2000ms tolerance) |
| REPL-04     | 03-01, 03-03              | stop-at-end default; loop:true opt-in restarts                        | ✓ SATISFIED | scheduler.ts:265 `baseline = getNow()` re-base on cursor wrap; loop.test.ts Groups 1/2/3 (3 iterations within ±5ms drift; loop=true never auto-transitions to 'done') |
| REPL-05     | 03-02, 03-03              | replay.completed Promise resolves on stop-at-end                      | ✓ SATISFIED | replay.ts:117-126 Promise.withResolvers; replay.ts:248-251 .then resolution; replay.test.ts Group 1 awaits completed + asserts state='done' |
| REPL-06     | 03-01, 03-02, 03-03       | After abort, no further callbacks fire (AbortController + clearTimeout teardown) | ✓ SATISFIED | scheduler.ts:227 `await sleep(delay, undefined, { signal })` AbortSignal-aware; scheduler.ts:235-237 post-sleep abort guard (CR-01 fix); abort.test.ts Groups 1-5 (Group 5 = CR-01 regression) |

**All 6 REPL-* requirements declared in plan frontmatter are SATISFIED.** No orphaned requirements (REQUIREMENTS.md maps exactly REPL-01..REPL-06 to Phase 3, all accounted for).

### Anti-Patterns Found

No blockers and no warnings detected from the anti-pattern scan:

| File                          | Line | Pattern                                | Severity | Impact                                                                       |
| ----------------------------- | ---- | -------------------------------------- | -------- | ---------------------------------------------------------------------------- |
| (none)                        | -    | TBD/FIXME/XXX/TODO/HACK/PLACEHOLDER    | -        | Zero debt markers in any modified Phase 3 source or test file                |
| (none)                        | -    | console.log in production source       | -        | scheduler.ts uses debuglog only; replay.ts is silent on stdout                |
| (none)                        | -    | Stub returns / hardcoded empty data    | -        | All data-flow traces show real data flowing through artifacts                |

The 6 warning-level + 4 info-level findings from `03-REVIEW.md` (WR-01..WR-06, IN-01..IN-04) are recorded as Code Review Followups in the frontmatter `code_review_followups:` array. They are quality issues that do not block goal verification per the user's verification instructions.

### Code Review Followups (from 03-REVIEW.md)

The 6 warnings + 4 info findings flagged in the standard-depth code review remain open. They are tracked in the frontmatter and should be addressed before Phase 4 begins, but they are NOT blockers for Phase 3 goal achievement:

- **WR-01:** scheduler.ts double-getNow() in clamp counter (observability bias only).
- **WR-02:** currentState reflects stale 'running' for one microtask after stop() — async transition not documented on the getter.
- **WR-03:** Disposer returned by onRecord becomes silent no-op once start() has captured the subscriber.
- **WR-04:** `private readonly config` JSDoc claims "Frozen at construction" but no Object.freeze applied.
- **WR-05:** start() does not validate speed/maxEmissionHz finiteness; invalid configs silently misbehave.
- **WR-06:** `while (true)` with eslint-disable comment instead of `for (;;)`.
- **IN-01:** `fakeAwareSleep` test helper duplicated across four test files — extract to shared helper.
- **IN-02:** `_schedulerInputCoversConfig` is opaque — prefer `satisfies`-based static assertion.
- **IN-03:** `Group N — ` describe prefixes are scaffolding noise.
- **IN-04:** soak `console.log` should be `console.info` or env-gated.

The 2 BLOCKERs (CR-01 post-sleep abort race, CR-02 unhandledRejection) were FIXED inline in commit `e4b04a9` with a regression test for CR-01 in `test/replay/abort.test.ts` Group 5 (verified at lines 238-321).

### Out-of-Scope Edits (declared)

Two edits outside the strict `files_modified` list, both with documented rationale and confirmed production-neutral impact:

1. **`tsconfig.json`** (plan 03-02): Added `"ES2024.Promise"` to `lib` array. Required because `Promise.withResolvers()` (Node 22+ runtime feature) needs ES2024 type. Surgical sublib choice (not full ES2024). Production behavior unchanged — type-system only.

2. **`src/replay/scheduler.ts` + `src/replay/replay.ts`** (plan 03-03): Added optional `sleep?: SleepFn` injection seam. Empirically required because Vitest 4 cannot intercept `node:timers/promises` setTimeout (static ESM imports of `node:` built-ins are captured before `vi.useFakeTimers()` runs — verified by 03-03-SUMMARY's `__vitest_required__.timersPromises.setTimeout.toString()` check). The seam is additive: production callers (Phase 4 FakeTransport) omit it and fall through to the `node:timers/promises` default. Parallel to the pre-existing `getNow` seam.

Both edits are documented in their respective SUMMARY.md files and do not violate any locked decision; the single-source-of-truth seam (`src/replay/scheduler.ts` is sole importer of `node:timers/promises` in `src/`) remains intact.

### Human Verification Required

None — Phase 3 is internal (D-REPL-12); no UI, no real-time external service, no visual artifacts. The drift gate (REPL-03) has both an algorithmic regression detector (soak-proxy, runs every CI push) and a release-tier real-clock acceptance gate (soak.test.ts, gated on `RUN_SOAK=1`). Per verification instructions: the 30-min real soak does not need to pass in this run; existence + algorithmic proxy passing are the gates for goal verification.

## Gaps Summary

No gaps. All 4 ROADMAP success criteria are observably true in the codebase:

1. **30-min drift gate (250ms)** — soak.test.ts asserts the literal `< 250` threshold; CI proxy asserts the algorithmic invariant on every push.
2. **speed=Infinity capped by maxEmissionHz** — scheduler.ts implements via `Math.max(target - getNow(), minIntervalMs)` clamp; tested at scheduler.test.ts Groups 3/4.
3. **stop-at-end + loop:true without drift accumulation** — Replay.completed resolves on natural completion; loop boundary re-base at scheduler.ts:265; loop.test.ts asserts `< 5ms` inter-iteration drift over 3 iterations.
4. **No callbacks fire after disconnect()** — AbortSignal-aware sleep in scheduler.ts; post-sleep abort guard (CR-01 fix) at scheduler.ts:235-237; abort.test.ts Groups 1+5 verify the 100ms-zero-emissions invariant AND the post-sleep race window.

The phase honors all 16 D-REPL-* locked decisions, preserves D-REPL-12 (zero replay mentions in `src/index.ts`), maintains the single-source-of-truth seam for `node:timers/promises`, and the full test suite passes (77 + 2 skipped opt-ins).

The 6 warnings + 4 info findings from code review are recorded as followups for future cleanup but are not blockers — they are quality improvements (observability bias, contract documentation, validation hardening, test ergonomics) that the FakeTransport layer (Phase 4) should address before consumers depend on the contracts.

---

_Verified: 2026-05-16T14:30:00Z_
_Verifier: Claude (gsd-verifier)_
