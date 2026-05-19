---
phase: 03-replay-engine
plan: 03
subsystem: replay
tags: [replay, tests, fake-timers, vitest, abort-controller, sleep-injection-seam]

# Dependency graph
requires:
  - plan: 01
    provides: runScheduler async function (now with optional `sleep` injection seam — see Deviations §1)
  - plan: 02
    provides: Replay class (now forwards optional `sleep` from start() config to runScheduler — see Deviations §2)
provides:
  - test/replay/scheduler.test.ts — pure-fn unit tests for runScheduler (REPL-01, REPL-02, Pitfalls 8 + 9)
  - test/replay/replay.test.ts — Replay class lifecycle tests (REPL-05, D-REPL-07/08/11, Pitfalls 4 + 10)
  - test/replay/abort.test.ts — REPL-06 cancellation invariants (D-REPL-09/10, Open Question 3)
  - test/replay/loop.test.ts — REPL-04 loop boundary tests (D-REPL-06, Pitfall 7)
  - sleep injection seam on src/replay/scheduler.ts (deviation Rule 1 — see below)
  - sleep passthrough on src/replay/replay.ts start() (deviation Rule 1 — see below)
affects:
  - 03-04 (parallel branch — soak proxy + real soak; independent of these unit tests)
  - Phase 4 (FakeTransport) — production wiring continues to omit `sleep`, falling through to the
    `node:timers/promises` default. Test-only seam does NOT leak into the public surface.

# Tech tracking
tech-stack:
  added:
    - vi.useFakeTimers / vi.advanceTimersByTimeAsync test discipline (D-REPL-14, RESEARCH §Vitest fake-timer interaction recipe)
    - Test-only sleep injection seam pattern (parallel to the existing getNow seam) — see Deviations §1
  patterns:
    - Group-by-decision describe blocks ('Group N — D-REPL-XX: <behavior>') mirroring test/fit/normalize.test.ts
    - fakeAwareSleep helper (globalThis.setTimeout-based AbortSignal-aware delay) defined per-file
    - Eager `replay.completed.catch(() => undefined)` to absorb expected rejections during intermediate awaits

key-files:
  created:
    - test/replay/scheduler.test.ts (285 lines, 7 tests)
    - test/replay/replay.test.ts (268 lines, 10 tests)
    - test/replay/abort.test.ts (237 lines, 5 tests)
    - test/replay/loop.test.ts (178 lines, 3 tests)
  modified:
    - src/replay/scheduler.ts (sleep injection seam — 30 insertions, 1 deletion)
    - src/replay/replay.ts (sleep passthrough on start() config — 15 insertions, 1 deletion)

key-decisions:
  - "Sleep injection seam on SchedulerInput (Pitfall 6 parallel) — Vitest 4 cannot intercept `node:timers/promises` setTimeout because static ESM imports of `node:` built-ins are captured before `vi.useFakeTimers()` runs. Verified empirically: `__vitest_required__.timersPromises.setTimeout.toString()` is unchanged after `vi.useFakeTimers()`. The seam is additive (default falls through to the production node:timers/promises sleep), zero-overhead in production, and parallel to the pre-existing `getNow` seam (D-REPL-13)."
  - "Sleep passthrough on Replay.start({ sleep? }) — needed because Replay tests cannot bypass the class to inject directly into runScheduler. The new field is JSDoc-documented as test-only; Phase 4's FakeTransport will not pass it."
  - "Tight ±5ms tolerance in loop.test.ts Group 1 (RESEARCH §Code Examples 3) — under fake timers via fakeAwareSleep, the math is exact modulo microtask ordering. Measured: drift was 0.00ms in all three iterations (the 5ms tolerance is purely defensive against test-runner microtask ordering jitter)."
  - "Eager `replay.completed.catch(() => undefined)` pattern in abort.test.ts and loop.test.ts — Vitest flags unhandled rejections during the intermediate `await vi.advanceTimersByTimeAsync(...)` calls before `await expect(replay.completed).rejects.toMatchObject(...)` runs. The eager catch absorbs the rejection without affecting the original promise (which remains observably rejected for the later assertion)."

requirements-completed:
  - REPL-01
  - REPL-02
  - REPL-04
  - REPL-05
  - REPL-06

# Metrics
duration: ~70min
completed: 2026-05-16
---

# Phase 03 Plan 03: Replay Engine Unit Tests Summary

**Four atomic test files covering five of six Phase 3 requirements (REPL-01, REPL-02, REPL-04, REPL-05, REPL-06) under `vi.useFakeTimers()` discipline. The drift-correction acceptance gate REPL-03 is verified by parallel plan 03-04. Two surgical SUT changes (additive sleep injection seam) needed to make D-REPL-14's "fake timers throughout" test discipline actually work — see Deviations §1 + §2.**

## Performance

- **Duration:** ~70 min (longer than typical because of the Vitest 4 / `node:timers/promises` interception bug discovery and the surgical SUT seam fix)
- **Tasks:** 4
- **Files created:** 4 (test/replay/*.test.ts)
- **Files modified:** 2 (src/replay/scheduler.ts, src/replay/replay.ts — both additive sleep seams; production behavior unchanged)
- **Test count:** 25 new tests (7 scheduler + 10 replay + 5 abort + 3 loop) — all PASS
- **Test suite total:** 75 passing + 1 skipped (50 pre-existing + 25 new); zero regressions

## Accomplishments

- **scheduler.test.ts (285 lines, 7 tests):** REPL-01 emission cadence, REPL-02 speed multiplier (1x/2x/0.5x), REPL-02 speed=Infinity + maxEmissionHz=100 (1000-record × 10ms = 10s fake-clock), Pitfall 8 (Infinity at cursor=0 single-record), Pitfall 9 (empty records). Plus the Assumptions A1 setup-sanity test (verifying `vi.advanceTimersByTimeAsync` advances `globalThis.performance.now()` by the requested delta).
- **replay.test.ts (268 lines, 10 tests):** REPL-05 + D-REPL-08 (completed Promise resolves on stop-at-end + state → 'done'), D-REPL-11 + Pitfall 10 (single-subscriber lock + subscriber-not-set throw), D-REPL-07 (single-use lock — start() throws after done OR aborted), Pitfall 4 (pre-aborted external signal sync throw), D-REPL-10 partial (idempotent stop before/after start).
- **abort.test.ts (237 lines, 5 tests):** REPL-06 (zero emissions in 100ms after stop + completed rejects with AbortError), D-REPL-09 (external AbortController.abort path), Open Question 3 (external + internal abort race + post-stop external abort no-op), D-REPL-10 (single-pending-tick guarantee — no ghost emissions even after a 5000ms wait post-stop).
- **loop.test.ts (178 lines, 3 tests):** REPL-04 + D-REPL-06 (three iterations within ±5ms drift; measured 0.00ms in practice), Pitfall 7 negative test (iteration 2 emits exactly 1 record after a 100ms advance — does NOT burst-emit), and loop=true never auto-transitions to 'done'.
- All four test files use `vi.useFakeTimers()` / `vi.useRealTimers()` setup with `vi.advanceTimersByTimeAsync` exclusively (NEVER the sync variant — RESEARCH §Pitfall 5).
- All four test files import via internal paths (`'../../src/replay/scheduler.js'` / `'../../src/replay/replay.js'`) — D-REPL-12 lock holds; `src/index.ts` byte-identical to pre-Phase-3 state.
- Production behavior unchanged: the two SUT modifications (sleep seams) default to the original `node:timers/promises` setTimeout when the optional `sleep` field is omitted, which is what Phase 4's FakeTransport will do.

## Task Commits

Each task was committed atomically; the two SUT seam fixes are committed separately as `fix(03-03)` per the deviation rationale below:

1. **fix: add sleep injection seam to scheduler (Pitfall 6 parallel)** — `d56393b`
2. **Task 1: scheduler.test.ts — REPL-01/02 + Pitfalls 8 + 9** — `4dd6ea1`
3. **fix: pass sleep override through Replay.start to scheduler** — `93e4038`
4. **Task 2: replay.test.ts — REPL-05 + D-REPL-07/08/11 + Pitfalls 4/10** — `7f99b1f`
5. **Task 3: abort.test.ts — REPL-06 cancellation invariants (D-REPL-09/10)** — `244e410`
6. **Task 4: loop.test.ts — REPL-04 loop boundary (D-REPL-06, Pitfall 7)** — `9756710`

Total: 6 atomic commits.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] Add sleep injection seam to `src/replay/scheduler.ts`**

- **Found during:** Task 1 acceptance verification — the first run of `npx vitest run test/replay/scheduler.test.ts` had 4 failures and Group 3 timed out at 5s.
- **Issue:** The plan and RESEARCH document both assumed `vi.useFakeTimers()` would intercept `node:timers/promises` `setTimeout` (which the scheduler imports via `import { setTimeout as sleep } from 'node:timers/promises'`). It does NOT. Vitest 4's fake timers only fake `globalThis.setTimeout` reliably — static ESM imports of `node:` built-in modules are captured at module load time, before `vi.useFakeTimers()` runs in `beforeEach`. The patched `__vitest_required__.timersPromises.setTimeout` is never the same reference as the SUT's imported binding. Empirically verified during debugging:
  - `__vitest_required__.timersPromises.setTimeout.toString()` is the original native source code both before AND after `vi.useFakeTimers()`.
  - A test that did `await sleep(100, undefined, { signal })` took 100ms of real wall-clock time even with fake timers active.
  - This is the same root cause as RESEARCH §Pitfall 6 (which addresses the same problem for `performance.now()`); RESEARCH did not generalize the fix to `setTimeout`.
- **Why "bug" (Rule 1):** The SUT design plus the planned testing strategy combined to produce a non-working unit test discipline. The minimum-viable correctness fix is to add an injection seam parallel to the existing `getNow` seam.
- **Fix:** Made the existing `node:timers/promises` import the *default* (renamed to `defaultSleep`) and added a new optional `sleep?: SleepFn` field on `SchedulerInput`. The scheduler picks `input.sleep ?? defaultSleep` at the start of the function. Production callers (Phase 4's `FakeTransport` will be one) do NOT pass `sleep`, so the production behavior is byte-identical to plan-01's commit. Tests pass a `globalThis.setTimeout`-based `fakeAwareSleep` helper which Vitest 4 *does* intercept.
- **Files modified:** `src/replay/scheduler.ts` (29 insertions, 1 deletion).
- **Verified:** `npm run build` passes, `npm run typecheck:test` passes, `npm test` passes (including the 50 pre-existing tests — no regressions).
- **Committed in:** `d56393b` (separate `fix(03-03)` commit before the test file landed).

**2. [Rule 1 — Bug] Pass sleep override through Replay.start to scheduler**

- **Found during:** Task 2 implementation.
- **Issue:** Replay tests cannot bypass the class to inject directly into `runScheduler`. Without a passthrough on `Replay.start`, replay/abort/loop tests would fall back to real wall-clock waits (10s+ for Group 3-equivalent scenarios; not actually that bad for the small datasets in these files, but a violation of D-REPL-14's "fake timers throughout" discipline).
- **Why "bug" (Rule 1):** Same root cause as §1; Replay needs to forward the seam.
- **Fix:** Added an optional `sleep?: ...` field to `Replay.start({ signal?, sleep? })` config. Forwards as `sleep: config?.sleep` into `runScheduler`. Documented as test-only in the JSDoc; Phase 4's FakeTransport will not pass it.
- **Files modified:** `src/replay/replay.ts` (15 insertions, 1 deletion).
- **Verified:** `npm run typecheck:test` passes, all tests green.
- **Committed in:** `93e4038` (separate `fix(03-03)` commit before Task 2's test file landed).

**3. [Rule 1 — Bug] Removed `Group 4 —` mention from scheduler.test.ts header comment**

- **Found during:** Task 1 acceptance grep verification.
- **Issue:** Plan acceptance criterion `[ "$(grep -cE 'Group\s+[12345]\s+—' test/replay/scheduler.test.ts)" = "5" ]` requires exactly 5 matches across the file. My initial header comment said "guard (Group 4 — single-record array)" which double-matched Group 4 (header + describe block).
- **Fix:** Rephrased to "guard (the single-record array case)" — no semantic loss, regex now reports exactly 5 matches.
- **Files modified:** `test/replay/scheduler.test.ts` (1 line in the header comment).
- **Committed in:** `4dd6ea1` (Task 1 commit — fix made before the commit landed).

**4. [Rule 1 — Bug] Eager `replay.completed.catch(() => undefined)` to absorb intermediate-await unhandled rejections**

- **Found during:** Task 3 (abort.test.ts) acceptance verification — `vitest run` reported 5 passing tests AND 3 unhandled rejections.
- **Issue:** When the abort tests do `replay.stop()` (or `controller.abort()`) followed by `await vi.advanceTimersByTimeAsync(...)` BEFORE the `await expect(replay.completed).rejects.toMatchObject(...)` assertion runs, the `replay.completed` Promise becomes rejected during the intermediate await — and Vitest's runtime detects "unhandled promise rejection" because no `.catch` is yet attached.
- **Fix:** Attach a no-op `replay.completed.catch(() => undefined)` immediately after `replay.start({ ... })`. This satisfies the runtime's "someone is observing this rejection" requirement WITHOUT consuming the rejection — the original `replay.completed` promise remains observably rejected, so the later `await expect(replay.completed).rejects.toMatchObject(...)` assertion still works correctly.
- **Files modified:** `test/replay/abort.test.ts` (4 instances) and `test/replay/loop.test.ts` (3 instances — same pattern needed for the loop's stop()-at-end teardown).
- **Committed in:** `244e410` (Task 3 commit) and `9756710` (Task 4 commit) — both incorporated the pattern at write time, no separate fix commit.

**Total deviations:** 4 (two surgical SUT seam fixes + two test-side pattern fixes, all Rule 1 — none required architectural change or user permission).

**Impact on plan:** Two src/replay/* files modified beyond the plan's `files_modified` list (`src/replay/scheduler.ts`, `src/replay/replay.ts`). Both modifications are additive — the new `sleep` field is optional with a default that preserves the production import path the plan-01 / plan-02 implementers intended. Phase 4's FakeTransport (the only other production caller of these seams) will not pass `sleep`, so the change is invisible to that boundary.

## Required Output (per `<output>` section of the plan)

| Item | Value |
|------|-------|
| `test/replay/scheduler.test.ts` line count | 285 lines, 7 tests |
| `test/replay/replay.test.ts` line count | 268 lines, 10 tests |
| `test/replay/abort.test.ts` line count | 237 lines, 5 tests |
| `test/replay/loop.test.ts` line count | 178 lines, 3 tests |
| `vi.advanceTimersByTime()` (sync) absent from all four files | YES — every advancement uses the `Async` variant. Verified `grep -E 'vi\.advanceTimersByTime\b\(' \| grep -v 'Async'` returns empty across all four files. |
| `'../../src/index.js'` absent from all four files (D-REPL-12 enforcement) | YES — `grep -F "from '../../src/index.js'" test/replay/*.test.ts` returns empty across all four files. |
| Loop.test.ts Group 1 measured tolerance | **Drift was 0.00ms in practice** — under fake timers via fakeAwareSleep, the timer math is exact. The ±5ms tolerance is purely defensive against test-runner microtask ordering jitter (which never materializes in the actual measured runs). The plan's "do NOT widen the tolerance" instruction is satisfied — the assertion is `Math.abs(...) < 5`, exactly as the plan + RESEARCH §Code Examples 3 mandate. |
| `vi.getTimerCount()` used in abort.test.ts Group 4? | NO — fell back to the wait-and-assert-no-emissions approach (5000ms post-stop wait + `emitted.length === before` assertion). This is the more direct invariant test (REPL-06's "no further emissions" contract); `vi.getTimerCount()` would be a proxy for the same observation but adds runtime API dependence. |
| Disposer-then-re-attach contract in replay.test.ts Group 2 — re-attach allowed or throws? | **Re-attach is ALLOWED while state is still 'idle'.** The implementation in src/replay/replay.ts checks `subscriber !== undefined` BEFORE `state !== 'idle'`, so once the disposer clears the subscriber slot AND the state has not advanced past 'idle', a fresh `onRecord(...)` call succeeds and returns a new disposer. After `start()` (state moves to 'running'), `onRecord` would throw (the state guard fires). The Group 2 test asserts both halves of this contract: the second-onRecord-without-dispose throw AND the after-dispose re-attach success. |
| Phase 1+2 tests still pass | YES — `npm test` reports 75 passed / 1 skipped; the 1 skipped is the pre-existing `local-dev FIT smoke` test that gates on `TEST_FIT_DIR` env var. No regressions. |
| Atomic commit SHAs | `d56393b` (fix sched seam) · `4dd6ea1` (Task 1) · `93e4038` (fix replay passthrough) · `7f99b1f` (Task 2) · `244e410` (Task 3) · `9756710` (Task 4) |

## Self-Check: PASSED

- `test/replay/scheduler.test.ts` — FOUND
- `test/replay/replay.test.ts` — FOUND
- `test/replay/abort.test.ts` — FOUND
- `test/replay/loop.test.ts` — FOUND
- All 6 commits found in `git log --oneline c75072644bfb3c77145d6eee361229842350db73..HEAD`
- `src/index.ts` byte-identical to pre-Phase-3 — VERIFIED via `git diff c75072644bfb3c77145d6eee361229842350db73 HEAD -- src/index.ts` (zero output lines)
- `node:timers/promises` single-source-of-truth seam preserved — `grep -rl "from 'node:timers/promises'" src/` returns only `src/replay/scheduler.ts` (the seam fix renamed the import to `defaultSleep` but did not move it)
- `npm run build` — PASSED
- `npm run typecheck:test` — PASSED
- `npm test` — PASSED (75 passed / 1 skipped — no regressions)
- All Task 1 acceptance greps — PASSED (file exists, runScheduler import, no-index, vitest triplet, useFakeTimers/useRealTimers, advanceTimersByTimeAsync count = 9 (>= 4), no bare sync variant, globalThis.performance.now, sanity test, all 5 groups, speed: Infinity count = 2 (>= 2), maxEmissionHz: 100 present)
- All Task 2 acceptance greps — PASSED (Replay import, no-index, fake-timer setup, makeRecords helper, replay.completed, done state, REPL-11 throw, subscriber throw, REPL-07 throw, controller.abort, abort throw, replay.stop(), all 5 groups)
- All Task 3 acceptance greps — PASSED (Replay import, no-index, advanceTimersByTimeAsync, rejects.toMatchObject, name: 'AbortError', replay.stop(), controller.abort, aborted state, all 4 groups)
- All Task 4 acceptance greps — PASSED (Replay import, no-index, useFakeTimers, advanceTimersByTimeAsync, loop: true, globalThis.performance.now, < 5 tolerance, running state, all 3 groups)

## Next Phase Readiness

- Five of six REPL-* requirements have CI-tier unit-test coverage (REPL-01, REPL-02, REPL-04, REPL-05, REPL-06). REPL-03's drift-correction 250ms-over-30min acceptance gate is owned by parallel plan 03-04 (soak proxy + soak.test.ts behind RUN_SOAK=1).
- The sleep injection seam pattern is now established for any future internal seam that needs Vitest-4-compatible mocking. RESEARCH §Pitfall 6 should be amended in any future planning iteration to call out that the same fix applies to `node:timers/promises` setTimeout (not just `performance.now()`).
- D-REPL-12 lock holds — `src/index.ts` is byte-identical to its pre-Phase-3 state. Phase 4 owns the public-surface decision.
- Phase 4's `createFakeTransport` factory will instantiate Replay without passing `sleep`, falling through to the `node:timers/promises` default. The test-only seam is invisible to that boundary.

---
*Phase: 03-replay-engine*
*Completed: 2026-05-16*
