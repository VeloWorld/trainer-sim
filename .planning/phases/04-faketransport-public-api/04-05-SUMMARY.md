---
phase: 04
plan: 05
subsystem: transport
tags: [test, fake-transport, integration, fit-fixture, path-buffer, error-bubble]
requires: [03]
provides: [path-buffer-integration-coverage, fit-error-bubble-binding-test, api-04-fit-driven-binding-test]
affects: [test/transport/]
tech-stack:
  added: []
  patterns:
    - byte-snapshot-helper (per-emission Uint8Array copy — 04-RESEARCH §Pattern 5: shared DataView ref across subscribers)
    - fixture-resolved-via-fileURLToPath (Pattern TPB1 from 04-PATTERNS.md)
    - fakeAwareSleep-injected-via-factory-options (D-API-24 — Vitest 4 fake-timer cooperation)
    - public-surface-only-imports (T-04-05-02 — no `src/transport/` direct imports)
    - parity-via-toEqual (path-vs-buffer byte-stream identity)
key-files:
  created:
    - test/transport/path-and-buffer.test.ts
  modified: []
decisions:
  - D-API-04 binding test added (FitLoadError + ENOENT both bubble unchanged through connect())
  - D-API-05 binding test added (path and buffer source variants produce identical byte streams)
  - D-API-22 honored (test lives at test/transport/path-and-buffer.test.ts)
  - D-API-23 honored (no new fixtures — basic.fit reused from Phase 2 corpus)
  - API-04 binding test added (sendResistance is echo-only against the FIT-driven path; first-5 byte snapshot identical to baseline)
metrics:
  duration: ~3min
  completed: 2026-05-16
---

# Phase 4 Plan 05: Path/Buffer Source-Variant Integration Tests Summary

Integration test suite at `test/transport/path-and-buffer.test.ts` exercising the FakeTransport factory's `{ path }` and `{ buffer }` source variants end-to-end against the Phase 2 fixture `basic.fit` (443 records, 7 minutes, ROUVY clean 1Hz, 28 zero-power records). This is the only Phase 4 test that drives the FIT load path — Plan 04-04 covers the `{ records }` fast path, Plan 04-06 validates only the published artifact.

## Files Created / Modified

| File                                       | Status  | LOC | Role                                                         |
| ------------------------------------------ | ------- | --- | ------------------------------------------------------------ |
| `test/transport/path-and-buffer.test.ts`   | created | 232 | Integration tests — path/buffer parity, FitLoadError bubble, ENOENT bubble, API-04 echo-only against FIT-driven path |

No source files modified — this is a pure test-only plan that consumes the Phase 4 surface delivered by Plan 04-03.

## Test Inventory

5 tests across 4 `describe` groups (one per group in the plan's `<action>`):

| Group | Test | Binding Decision / Requirement |
| ----- | ---- | ------------------------------ |
| 1     | `{ path }` variant emits 440-445 records of 6 bytes each under fake timers | D-API-05 + API-01 (path variant) |
| 2     | `{ path }` and `{ buffer }` produce byte-for-byte identical emission streams | D-API-05 + API-01 (buffer variant + parity) |
| 3 (a) | Corrupt buffer → `connect()` rejects with `instanceof FitLoadError` | D-API-04 (FitLoadError bubbles unchanged) |
| 3 (b) | Nonexistent path → `connect()` rejects with `/ENOENT/i` AND `not.toBeInstanceOf(FitLoadError)` | D-API-04 (filesystem errors NOT wrapped) |
| 4     | `sendResistance` during fixture replay → first-5-emission byte snapshots equal baseline; `received.resistance` captures `[0.10, 0.20, 0.30]` in order | API-04 (echo-only against FIT-driven path) |

## Verification Results

| Check                                                                                       | Result                                |
| ------------------------------------------------------------------------------------------- | ------------------------------------- |
| `npx tsc --noEmit -p tsconfig.test.json`                                                    | exit 0                                |
| `npm test -- test/transport/path-and-buffer.test.ts`                                        | 5 passed / 5                          |
| `npm test` (full regression suite)                                                          | 82 passed / 84 (2 intentional skips)  |
| `grep -E "advanceTimersByTime[^A]" test/transport/path-and-buffer.test.ts`                  | 0 matches (T-04-05-01 mitigated)      |
| `grep -n "from '\.\./\.\./src/transport" test/transport/path-and-buffer.test.ts`            | 0 matches (T-04-05-02 mitigated)      |
| `grep -c "from '\.\./\.\./src/index\.js'" test/transport/path-and-buffer.test.ts`           | 1 (public-surface import only)        |
| `grep -c "from '\.\./_helpers/fake-aware-sleep\.js'" test/transport/path-and-buffer.test.ts`| 1                                     |
| `grep -c "advanceTimersByTimeAsync\(" test/transport/path-and-buffer.test.ts`               | 5 (one async-advance per test)        |
| File contains `expect(fromBufferBytes).toEqual(fromPathBytes)` parity assertion             | yes (line 135)                        |
| File contains `await expect(...).rejects.toBeInstanceOf(FitLoadError)`                      | yes (line 161)                        |
| File contains `/ENOENT|no such file/i` regex in a `.rejects.toThrow(...)` call              | yes (line 174)                        |
| File contains snapshot helper for byte-comparison (`new Uint8Array(dv.buffer.slice(...))`)  | yes (lines 66-69)                     |

## Path/Buffer Parity Assertion Outcome

**Outcome: identical.** Group 2's `expect(fromBufferBytes).toEqual(fromPathBytes)` passes — the `{ path }` and `{ buffer }` source variants produce byte-for-byte identical emission streams when run with the same `speed: Infinity, maxEmissionHz: 1000` config against `basic.fit`. This is the binding D-API-05 + API-01 assertion (parity at the transport-emission layer), and it inherits Phase 2 D-FIT-07's parity at the loader layer (`loadFitFromPath` and `loadFitFromBuffer` produce identical `RideRecord[]`).

The byte-snapshot helper (`snapshot(dv: DataView): Uint8Array`) is required because the encoder shares ONE `DataView` reference across all fan-out subscribers per emission tick (04-RESEARCH §Pattern 5); without copying the bytes at emission time, `expect(buf2).toEqual(buf1)` would compare references to the same allocation in the same run and trivially pass without proving anything cross-run.

## FitLoadError Bubble Assertion Outcome

**Outcome: bubbles unchanged.** Group 3 has two binding tests:

1. **Corrupt buffer → `FitLoadError`.** A 50-byte zero-filled `Uint8Array` is passed as `{ buffer: corrupt }`. The Phase 2 loader's header-magic / header-length validation throws an `InvalidFitHeaderError` (concrete subclass of `FitLoadError`). The test asserts against the abstract base via `rejects.toBeInstanceOf(FitLoadError)` — the specific subclass is loader-implementation detail and not part of D-API-04's contract. The binding contract is that whatever the loader threw lands in `connect()`'s rejection unchanged (NOT wrapped in a transport-layer error).

2. **Nonexistent path → plain Node `Error`.** A `{ path: '/nonexistent/path/file.fit' }` triggers `fs.readFile`'s `ENOENT`. The test asserts both that the message matches `/ENOENT|no such file/i` AND that the rejection is `not.toBeInstanceOf(FitLoadError)`. Phase 2's contract (`loader.ts:261-265` docstring) deliberately does NOT wrap filesystem errors in `FitLoadError` — they describe filesystem failures, not FIT-format failures. FakeTransport inherits this behavior through `connect()`'s direct delegation to `loadFitFromPath`.

Both assertions pass — `FitLoadError` bubbles, and `ENOENT` bubbles separately, and they are distinguishable at the rejection site.

## API-04 Echo-Only Assertion Outcome

**Outcome: replay stays faithful.** Group 4 runs the same `basic.fit` fixture twice — once as a baseline (no `sendResistance` calls) and once with three `sendResistance(grade)` calls (`0.10`, `0.20`, `0.30`) interleaved with the replay. The first 5 emitted byte sequences are snapshotted in both runs, then asserted equal: `expect(echo).toEqual(baseline)`. Additionally, `t2.received.resistance` is asserted to equal `[0.10, 0.20, 0.30]` (the log captured all three calls in order).

Both assertions pass. `sendResistance` is observably echo-only against the FIT-driven path: it appends to `received.resistance` and does NOT mutate any emitted byte. This is the binding API-04 verification at the integration layer (Plan 04-04 covers the unit-level `{ records }` fast path; this plan covers the FIT-driven path).

## Requirements Addressed

| Requirement | Coverage                                                                                                                                                       |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **API-01**  | Factory works across path / buffer / records variants. **Path + buffer end-to-end against `basic.fit`** (Groups 1 + 2); records variant covered in Plan 04-04. |
| **API-04**  | `sendResistance` is echo-only against the FIT-driven path (Group 4 — first-5-byte snapshot equality with baseline + `received.resistance` ordering).           |

## Implemented Decisions

- **D-API-04** — synchronous factory + deferred FIT load. Binding test: `connect()` carries both `FitLoadError` (FIT-format failures) and `ENOENT`-style errors (filesystem failures) unchanged in its Promise rejection. Neither is wrapped or translated by FakeTransport.
- **D-API-05** — `config.source` discriminated union: `{ path }` (Group 1, Group 4 baseline + echo, Group 3b) and `{ buffer }` (Group 2, Group 3a) both exercised end-to-end. Parity assertion (Group 2) proves the union variants produce identical observable behavior at the transport-emission layer.
- **D-API-20** — per-record `rec.power ?? 0` / `rec.cadence ?? 0` collapse: implicit in the path/buffer parity assertion. `basic.fit` has 28 zero-power records; both runs route them through the same encoder call with the same collapse, producing identical bytes.
- **D-API-22** — test layout under `test/transport/`. Confirmed: `test/transport/path-and-buffer.test.ts`.
- **D-API-23** — no new fixtures. Confirmed: only `test/fixtures/fit/basic.fit` is referenced (Phase 2 corpus, committed since plan 02-02).

## Threat Mitigations

- **T-04-05-01 (Tampering — silent sync `vi.advanceTimersByTime`)** — **MITIGATED**. Acceptance grep `grep -E "advanceTimersByTime[^A]" test/transport/path-and-buffer.test.ts` returns zero matches; only the `*Async` form is used (5 call sites).
- **T-04-05-02 (Tampering — bypass public surface)** — **MITIGATED**. Acceptance grep `grep -n "from '\.\./\.\./src/transport"` returns zero matches; the file imports `createFakeTransport` and `FitLoadError` exclusively from `../../src/index.js`.
- **T-04-05-03 (Information Disclosure — basic.fit rider identity)** — **ACCEPTED** per Phase 2 fixture provenance (`test/fixtures/fit/README.md`): `basic.fit` is a ROUVY-generated indoor-trainer FIT with no GPS, scrubbed timestamps, cleared device serials, cleared `user_profile`. No PII surface added by Phase 4.
- **T-04-05-04 (DoS — `vi.advanceTimersByTimeAsync(60_000)` starves CPU)** — **ACCEPTED** per Phase 3 precedent. The scheduler's clamped delay (`max(0, 1000 / maxEmissionHz)`) guarantees forward progress; Phase 3's `test/replay/replay.test.ts` Group 1 already proves this pattern works under Vitest 4. Confirmed empirically: full file runs in 160ms wall-clock (5 tests with 60s of fake time each).

## Deviations from Plan

**One Rule 3 (auto-fix blocking issue) deviation worth noting:**

**1. [Rule 3 — Acceptance-grep guard] Rephrased a regex-citing comment to satisfy the literal acceptance grep**
- **Found during:** Task 1 verification — running `grep -E "advanceTimersByTime[^A]" test/transport/path-and-buffer.test.ts` initially returned 2 matches.
- **Issue:** The plan's acceptance grep is intentionally strict (it's the T-04-05-01 mitigation — defends against silent regression to the sync fake-timer-advance variant). The 2 matches were inside prose comments where I cited the rule itself by quoting `vi.advanceTimersByTime` and the literal regex pattern; both quotes were inside `// ...` comments. The grep is regex-based and cannot distinguish quoted-prose from a real call site, so any literal occurrence of the token causes the gate to fail.
- **Fix:** Rephrased the citation to refer to "the synchronous fake-timer-advance variant" / "always the *Async form" without quoting the literal API name. Same semantic content, same decision-citation depth, satisfies the grep. Real call sites of `advanceTimersByTimeAsync(` (5 of them) are unaffected since the regex `advanceTimersByTime[^A]` requires a non-`A` character after the prefix.
- **Files modified:** `test/transport/path-and-buffer.test.ts`
- **Commit:** included in `43d2b39` (Task 1 — single commit).

This is the same posture Plan 04-03 took for the BLE-token-in-JSDoc grep (per its SUMMARY): when a phase's defensive grep is intentionally strict, prose that cites the rule must avoid the literal forbidden token.

No other deviations. Plan executed exactly as written.

## Authentication Gates

None.

## Self-Check: PASSED

- `test/transport/path-and-buffer.test.ts` — FOUND (232 lines)
- `test/fixtures/fit/basic.fit` — FOUND (Phase 2 fixture, unchanged)
- `test/_helpers/fake-aware-sleep.ts` — FOUND (Plan 04-01 deliverable, unchanged)
- Commit `43d2b39` (test: add { path } / { buffer } source-variant integration tests) — FOUND in `git log`
- Acceptance grep `grep -E "advanceTimersByTime[^A]"` — 0 matches (passes)
- Acceptance grep `grep -n "from '\.\./\.\./src/transport"` — 0 matches (passes)
- `npx tsc --noEmit -p tsconfig.test.json` — exit 0
- `npm test -- test/transport/path-and-buffer.test.ts` — 5 passed / 5
- `npm test` (full regression) — 82 passed / 84 (2 intentional skips, +5 over the 77 baseline before this plan)
