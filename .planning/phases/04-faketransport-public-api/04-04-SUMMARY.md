---
phase: 04
plan: 04
subsystem: transport
tags: [test, fake-transport, unit, fake-timers, public-surface]
requires: [03]
provides: [fake-transport-unit-coverage, fan-out-regression-test, microtask-boundary-test, reset-semantics-test, disconnect-quiet-test]
affects: [test/transport/]
tech-stack:
  added: []
  patterns:
    - public-surface-imports-only (../../src/index.js — validates Phase 4 D-API-07 export shape end-to-end)
    - vi.useFakeTimers + fakeAwareSleep seam (D-API-24 — Plan 04-01 helper consumed via factory options.sleep)
    - await once(transport, 'complete') under fake timers (Pattern TR4 — 04-RESEARCH §Code Example 5)
    - encode-once-fan-out-many DataView identity assertion (D-API-09 + Pattern 5)
    - per-handler try/catch isolation behavior assertion (D-API-10)
    - sendResistance microtask-boundary observable-after-await (PITFALLS.md §12)
    - disconnect-then-100ms-quiet regression (REPL-06 + CR-01 mirror of test/replay/abort.test.ts:100-113)
    - reset-preserves-subscribers + recycles-replay (D-API-14)
key-files:
  created:
    - test/transport/fake-transport.test.ts
  modified: []
decisions:
  - D-API-04 verified — synchronous factory, deferred FIT load, returns full FakeTransport surface (Group 1, Group 3)
  - D-API-05 verified — { records: [...] } fast path (every group)
  - D-API-06 verified — synchronous validation throws on speed === 0/-1/NaN and maxEmissionHz === 0; defaults applied (Group 2)
  - D-API-09 verified — Set fan-out, insertion-order, same DataView reference shared across subscribers, disposer deletes (Group 4)
  - D-API-10 verified — throwing handler does NOT abort fan-out OR prevent 'complete' (Group 5)
  - D-API-11 verified — composed EventEmitter; on/off/once pass-throughs (Group 9)
  - D-API-12 verified — 'complete' fires on natural completion only; NOT on disconnect-mid-stream (Group 3, Group 7)
  - D-API-13 verified at type level — literal 'complete' overloads via public-surface imports (compile-clean)
  - D-API-14 verified — reset clears resistance log, preserves subscribers, recycles replay across two lifecycles (Group 8)
  - D-API-15 verified — reset() returns Promise<void> (Group 8)
  - D-API-16/17 verified — received.resistance starts as []; ReadonlyArray<number> at type level (Group 1, Group 6, Group 8)
  - D-API-20 verified — power/cadence collapse exercised with default-undefined records (Group 6 byte-snapshot test)
  - D-API-21 verified — emitted DataView byteLength === 6 (Flags + Cadence + Power; no speed) (Group 3)
metrics:
  duration: ~10min
  completed: 2026-05-16
  tasks: 1
  tests_added: 25
  test_groups: 10
  test_loc: 462
---

# Phase 4 Plan 04: createFakeTransport Unit Tests Summary

Unit-test suite for the `createFakeTransport` factory landed in Plan 04-03. Targets the `{ records: [...] }` source variant (D-API-05 fast path) so the entire suite runs under `vi.useFakeTimers()` in ~7ms; the `{ path }` and `{ buffer }` integration paths are Plan 04-05's responsibility (against `test/fixtures/fit/basic.fit`), and Plan 04-06 covers `publint` + `attw` against the built artifact.

## Files Created / Modified

| File                                       | Status  | LOC | Role                                            |
| ------------------------------------------ | ------- | --- | ----------------------------------------------- |
| `test/transport/fake-transport.test.ts`    | created | 462 | Factory unit tests — 10 describe groups, 25 its |

`test/_helpers/fake-aware-sleep.ts` was already lifted in Plan 04-01; this plan consumes it via the factory's test-only `options.sleep` seam (D-API-24). No source files modified.

## Public-Surface Validation

Every import in the new test file resolves through `../../src/index.js` — NOT through internal paths. This is the Phase 4 D-API-07 export-shape end-to-end check: if a future plan accidentally drops `createFakeTransport`, `FakeTransport`, or `RideRecord` from `src/index.ts`, this test file fails to compile.

```typescript
import { createFakeTransport } from '../../src/index.js';
import type { FakeTransport, RideRecord } from '../../src/index.js';
import { fakeAwareSleep } from '../_helpers/fake-aware-sleep.js';
```

Acceptance grep `grep -n "from '\.\./\.\./src/transport" test/transport/fake-transport.test.ts` returns **zero matches** (T-04-04-02 mitigated).

## Verification Results

All `<verification>` checks from the plan pass:

| Check                                                                                     | Result                |
| ----------------------------------------------------------------------------------------- | --------------------- |
| `tsc --noEmit -p tsconfig.test.json`                                                      | exit 0                |
| `npm test -- test/transport/fake-transport.test.ts`                                       | 25 passed / 0 failed  |
| `npm test` (full suite — regression check)                                                | 102 passed, 2 skipped |
| `grep -E "advanceTimersByTime[^A]" test/transport/fake-transport.test.ts`                 | **clean** (T-04-04-01 mitigated) |
| `grep -n "from '\.\./\.\./src/transport" test/transport/fake-transport.test.ts`           | **clean** (T-04-04-02 mitigated) |
| `grep -c "describe(" test/transport/fake-transport.test.ts`                               | 10 (≥ 9 required)     |
| `grep -n "await once(transport, 'complete')\|await complete[12P]" test/...`               | 10 sites              |

Sync `advanceTimersByTime` is ZERO matches — only `advanceTimersByTimeAsync` is used (Phase 3 RESEARCH §Pitfall 5 / 04-RESEARCH §Pitfall 4 discipline upheld).

## Coverage Map: D-API-XX → Test Groups

| Decision    | Test Group(s)                                                           |
| ----------- | ----------------------------------------------------------------------- |
| D-API-04    | Group 1 (sync factory shape), Group 3 (deferred connect+lifecycle)      |
| D-API-05    | Every group (`{ records }` fast path is the universal source variant)   |
| D-API-06    | Group 2 (5 tests — speed=0/-1/NaN throws; maxEmissionHz=0 throws; defaults applied) |
| D-API-09    | Group 4 (3 tests — Set fan-out, disposer, mid-fan-out self-removal)     |
| D-API-10    | Group 5 (2 tests — throwing handler isolation; 'complete' still fires)  |
| D-API-11    | Group 9 (composed EE — on/off/once pass-throughs)                       |
| D-API-12    | Group 3 ('complete' on natural end); Group 7 ('complete' NOT on disconnect-mid-stream) |
| D-API-13    | Public-surface imports compile-clean — literal 'complete' overload narrowing verified at type-check |
| D-API-14    | Group 8 (reset clears resistance, preserves subscribers, recycles replay across two lifecycles) |
| D-API-15    | Group 8 (`reset()` returns Promise<void>)                               |
| D-API-16/17 | Group 1 (`received.resistance` starts `[]`); Group 6 (ordering + ReadonlyArray<number>); Group 8 (cleared by reset) |
| D-API-20    | Group 6 byte-snapshot test exercises `rec.power ?? 0` / `rec.cadence ?? 0` collapse |
| D-API-21    | Group 3 asserts `byteLength === 6` for every emission (Flags + Cadence + Power; speed omitted) |

## Pitfall Coverage

| Pitfall                                                  | Test                                                          |
| -------------------------------------------------------- | ------------------------------------------------------------- |
| 04-RESEARCH §1 — sendResistance microtask boundary       | Group 6 — `await sendResistance(g)` then immediately observe `received.resistance` |
| 04-RESEARCH §3 — handler removes self mid-fan-out        | Group 4 — Set iteration semantics test                        |
| 04-RESEARCH §6 — disconnect resolves AFTER scheduler unwinds | Group 7 — "zero emissions in 100ms after disconnect"     |
| 04-RESEARCH §8 — subscriber throw isolation              | Group 5 — throwing handler does NOT starve other subscribers  |
| Phase 3 RESEARCH §Pitfall 5 — fake-timer sync variant ban | Acceptance grep returns zero matches; only `advanceTimersByTimeAsync` used |
| Phase 3 RESEARCH §Pitfall 6 — module-import-binding capture | `fakeAwareSleep` injected via factory `options.sleep`     |

## Requirements Addressed

- **API-01** — `createFakeTransport(config)` returns the `FakeTransport` shape; factory is synchronous; Promise-returning lifecycle methods (Group 1, Group 3).
- **API-02** — `ITrainerTransport` reachable as a TypeScript type via `../../src/index.js` (compile-clean — TS surface validated end-to-end).
- **API-03** — `onData` returns a disposer; multi-subscriber fan-out shares the SAME `DataView` reference; disposer removes from the Set (Group 4).
- **API-04** — `sendResistance(grade)` records the grade in `received.resistance` after a microtask boundary; ordering preserved across sequential awaits; echo-only (does NOT mutate emitted bytes) (Group 6).
- **API-05** — `received.resistance` is `ReadonlyArray<number>` typed; backed by an internal `number[]`; `[]` initially; cleared by `reset()` (Group 1, Group 6, Group 8).
- **API-06** — `reset()` returns `Promise<void>`; clears resistance log; preserves subscribers; allows a second `connect()` against a fresh `Replay` (Group 8 — verified across two full lifecycles).

## Threat Mitigations

- **T-04-04-01 (Tampering — silent sync-variant timer)** — **MITIGATED**. Acceptance grep `grep -E "advanceTimersByTime[^A]" test/transport/fake-transport.test.ts` returns zero matches; preamble cites Phase 3 RESEARCH §Pitfall 5 + 04-RESEARCH §Pitfall 4.
- **T-04-04-02 (Tampering — bypass public surface)** — **MITIGATED**. All imports go through `../../src/index.js`; no `from '../../src/transport/'` matches.
- **T-04-04-03 (Information Disclosure — debuglog assertions)** — **ACCEPTED**. Tests do NOT assert on debuglog output; subscriber-throws test verifies BEHAVIOR (handler2 still received emissions), NOT log lines.

## Deviations from Plan

**One Rule 1 (auto-fix) deviation — encoder flag-bit value correction:**

**1. [Rule 1 — Bug] Initial flags-byte expectation off by one bit (0x44 → 0x45)**
- **Found during:** First `npm test` run on the Group 6 byte-snapshot test.
- **Issue:** The plan's behavior description for the byte-snapshot assertion noted "power+cadence values matching the input records" but did not specify the expected Flags byte. My first draft computed `bit 2 (cadence-present) | bit 6 (power-present) = 0x44`, missing bit 0 (the INVERTED MoreData/speed-absent bit per `src/ftms/indoor-bike-data.ts:99-101` and PITFALLS.md §1). The correct value with speed omitted is `0x44 | 0x01 = 0x45`.
- **Fix:** Read `src/ftms/indoor-bike-data.ts` `buildFlags` body (lines 111-116) to confirm the inverted-bit-0 semantics (`record.speed === undefined ? 1 : 0`). Updated assertion to `[0x45, 0x00, 0x00, 0x00, 0x00, 0x00]` and clarified the inline comment to cite PITFALLS.md §1.
- **Files modified:** `test/transport/fake-transport.test.ts` (one line + one comment update before commit)
- **Commit:** Single atomic commit `25b4af3` (fix landed pre-commit; no separate fix commit).

No other deviations. Pattern TR1–TR7 mirrored exactly per `04-PATTERNS.md`.

## Authentication Gates

None.

## Self-Check: PASSED

- `test/transport/fake-transport.test.ts` — FOUND (462 LOC, 10 describe groups, 25 tests)
- Commit `25b4af3` (test(04-04): add unit tests for createFakeTransport factory) — FOUND in `git log`
- `tsc --noEmit -p tsconfig.test.json` — exit 0
- `npm test -- test/transport/fake-transport.test.ts` — 25/25 passing
- `npm test` (full regression) — 102 passed, 2 skipped (zero new failures; +25 tests vs Plan 04-03 baseline of 77 passed)
- All public-surface imports verified (`../../src/index.js` only; no internal-path leaks)
- Sync-variant `advanceTimersByTime` grep returns zero matches
- `fakeAwareSleep` consumed from `test/_helpers/fake-aware-sleep.js` (Plan 04-01 lift)
