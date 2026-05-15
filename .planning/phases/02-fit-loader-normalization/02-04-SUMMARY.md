---
phase: 02-fit-loader-normalization
plan: 04
subsystem: fit
tags:
  - fit
  - tests
  - loader
  - error-paths
  - perf-gate

# Dependency graph
requires:
  - phase: 02-fit-loader-normalization
    plan: 01
    provides: |
      Public `RideRecord` type (consumed by tests as the asserted return shape);
      `FitLoadError` + 4 concrete leaves authored and re-exported from
      `src/index.ts` so tests can `import {InvalidFitHeaderError, ...} from
      '../../src/index.js'` and use `expect(...).toThrowError(SubclassError)` /
      `expect(e).toBeInstanceOf(FitLoadError)`.
  - phase: 02-fit-loader-normalization
    plan: 02
    provides: |
      Six committed CI fixtures consumed end-to-end by Wave 4 tests:
      basic.fit (FIT-01 parity baseline + truncated/CRC corruption inputs),
      autopause.fit (FIT-04 quirks + D-FIT-02 gap preservation),
      zero-power.fit (D-FIT-01 wire-honest 0), dev-fields-non-shadow.fit
      (FIT-04 quirks + power-presence threshold), shadow.fit (FIT-05 amended
      / D-FIT-10 non-fatal + util.debuglog), perf-1hr.fit (ROADMAP perf gate).
      `test/fixtures/minimal-fit-bytes.ts` byte writers consumed in-test by
      `error-paths.test.ts` group 4 to construct the NoRecordMessagesError
      input — single source of truth shared with `generate-shadow.ts`.
  - phase: 02-fit-loader-normalization
    plan: 03
    provides: |
      `loadFitFromPath` / `loadFitFromBuffer` entry points; header + CRC
      validation that throws `InvalidFitHeaderError` / `FitTruncatedError` /
      `FitCrcError`; `NoRecordMessagesError` thrown when `parsed.records` is
      empty; `detectAndLogShadow` emits `util.debuglog('trainer-sim:fit')`
      messages naming the shadowed standard field. `loadFitFromBuffer` is
      sync (D-FIT-07 — exploits the parser's sync-callback property).
provides:
  - "test/fit/loader.test.ts: FIT-01 path/buffer parity + FIT-04 real-world quirks (autopause / zero-power / dev-fields-non-shadow) + D-FIT-01 wire `0` + D-FIT-02 gap preservation + D-FIT-07 sync invariant — assertions against the public surface only"
  - "test/fit/error-paths.test.ts: each of InvalidFitHeaderError, FitTruncatedError, FitCrcError, NoRecordMessagesError fires on the right corrupt input AND each is `instanceof FitLoadError` (D-FIT-06)"
  - "test/fit/dev-field-shadow.test.ts: shadow.fit loads without throwing AND a subprocess (`npx tsx` + NODE_DEBUG=trainer-sim:fit) captures a stderr message naming `power` (D-FIT-10)"
  - "test/fit/perf.test.ts: ROADMAP <100 ms gate with 2x margin (<50 ms median over 11 timed runs after 3 warm-ups)"
affects:
  - "02-05 (normalize.test.ts + local-dev opt-in suite — orthogonal coverage)"
  - "Phase 3 replay (RideRecord[] contract is now end-to-end-tested)"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "ESM dirname pattern: `const __dirname = dirname(fileURLToPath(import.meta.url))` so test files can resolve fixture paths without depending on transpiler-injected `__dirname`"
    - "Subprocess + NODE_DEBUG capture for util.debuglog assertions: `spawnSync('npx', ['tsx', '-e', program], { env: { ...process.env, NODE_DEBUG: 'trainer-sim:fit' }})` — deterministic, behaviorally faithful, no vi.mock fragility"
    - "11-run median + 3 warm-up perf pattern (RESEARCH §Code Examples Example 7) — visible min/median/max in console.log so a slow-but-passing run is surfaced even when the assertion still passes"
    - "Single-source-of-truth FIT-byte writers: error-paths.test.ts group 4 imports from `test/fixtures/minimal-fit-bytes.js` rather than inlining a CRC table; the same writers produce shadow.fit"

key-files:
  created:
    - "test/fit/loader.test.ts (148 lines, 7 tests — FIT-01/-03/-04/D-FIT-01/-02/-07)"
    - "test/fit/error-paths.test.ts (162 lines, 6 tests — D-FIT-06 four subclasses)"
    - "test/fit/dev-field-shadow.test.ts (97 lines, 3 tests — D-FIT-10 non-fatal)"
    - "test/fit/perf.test.ts (69 lines, 1 test — ROADMAP <100 ms gate)"
  modified: []

key-decisions:
  - "loader.test.ts uses ESM-native `__dirname` derivation via `fileURLToPath(import.meta.url)` rather than relying on transpiler injection — Phase 1's existing test does not read files so there was no precedent; this pattern is now established for any future test that resolves fixture paths"
  - "perf.test.ts NOT marked `.skip` on CI even with the threshold tightened to <50 ms — the perf gate is part of the ROADMAP success criteria; if CI flakes the threshold widens in a follow-up plan"
  - "shadow-debuglog assertion uses subprocess + npx tsx, NOT vi.mock, NOT node --experimental-strip-types: vi.mock would mock the import in the test module rather than the loader's own binding; tsx handles the .js -> .ts import-specifier rewriting that the built-in Node TS stripper does not (per CLAUDE.md)"
  - "error-paths.test.ts group 4 imports byte writers from minimal-fit-bytes.js rather than inlining a CRC table — JSDoc avoids mentioning the literal CRC-table boundary values so the acceptance grep stays clean"

requirements-completed:
  - FIT-01
  - FIT-04
  - FIT-05

# Metrics
duration: ~25min
completed: 2026-05-16
---

# Phase 2 Plan 04: Wave 4 Loader / Error-paths / Shadow / Perf Tests Summary

**Wave 4 ships the test side of FIT-01 / FIT-04 / FIT-05 (amended) and the ROADMAP perf gate: four focused vitest files (~476 LOC total, 17 tests across the four files) covering path/buffer parity, real-world Garmin/Zwift/Wahoo file quirks, the four `FitLoadError` subclasses, the D-FIT-10 shadow non-fatal contract (with subprocess-captured `util.debuglog` evidence), and the <50 ms median parse target.**

## Performance

- **Tasks:** 4 (one test file per task)
- **Files created:** 4 (`test/fit/{loader,error-paths,dev-field-shadow,perf}.test.ts`)
- **Files modified:** 0
- **Total test lines added:** 476
- **Total tests added:** 17 (Phase 1's 17 tests + Wave 4's 17 = 34 total under `npm test`)

## Accomplishments

- **`test/fit/loader.test.ts` (148 lines, 7 tests)**: covers FIT-01 path/buffer parity for `basic.fit` (asserts `loadFitFromPath` and `loadFitFromBuffer` return identical `RideRecord[]` and the count is within 440..445 of the D-FIT-05 mapping 443); every record carries a numeric timestamp (RESEARCH §Pitfall 1/7); first record's timestamp is anchored within +/-1 day of the synthetic 2025-01-01 UTC epoch (D-FIT-05); D-FIT-07 sync invariant (`loadFitFromBuffer` returns a non-Promise, defensive against a future parser switch to async per RESEARCH Assumptions A1); FIT-04 real-world quirks for `autopause.fit` (3170..3175 records + at least one inter-record delta > 60_000 ms — D-FIT-02 gap preservation), `zero-power.fit` (539..543 records + >= 50 records with `power === 0` — D-FIT-01 wire-honesty), `dev-fields-non-shadow.fit` (2499..2503 records + >= 2400 records carrying `power !== undefined`). Imports go through `../../src/index.js` only; T-02-20 enforced by the file's own structure (no `src/fit/loader.ts` import).
- **`test/fit/error-paths.test.ts` (162 lines, 6 tests)**: covers D-FIT-06 — the four `FitLoadError` subclasses thrown on appropriate corrupt input AND each thrown error is `instanceof FitLoadError`. Group 1: empty buffer -> `FitTruncatedError` (boundary case before magic check); 14-byte buffer with magic `'JUNK'` -> `InvalidFitHeaderError`; basic.fit with byte[0] rewritten to 13 -> `InvalidFitHeaderError`. Group 2: basic.fit truncated to header + 100 bytes -> `FitTruncatedError`. Group 3: basic.fit with last CRC byte XOR 0xFF -> `FitCrcError`. Group 4: hand-rolled file_id-only FIT (built via the shared FIT-byte writers from `test/fixtures/minimal-fit-bytes.js`) -> `NoRecordMessagesError`. All buffer mutation done on in-memory `Buffer.from(readFileSync(...))` copies — committed fixture bytes unchanged (`git diff --quiet test/fixtures/fit/` is clean post-suite).
- **`test/fit/dev-field-shadow.test.ts` (97 lines, 3 tests)**: covers D-FIT-10 (FIT-05 amended 2026-05-16 — non-fatal). Test 1 asserts `loadFitFromBuffer(shadow.fit)` does NOT throw and returns >= 1 record with `power !== undefined` (no specific value asserted because D-FIT-10's contract is "whatever the parser produced"). Test 2 spawns `npx tsx -e ...` with `NODE_DEBUG=trainer-sim:fit` and asserts the captured stderr matches both `/developer field shadow/i` and `/power/i`. Test 3 belt-and-braces: `expect.fail('shadow.fit should not throw per D-FIT-10; got error: ' + msg)` if any throw fires, with descriptive message — catches a regression that re-introduces the rejected throw-on-shadow path. File header cites D-FIT-10 lock and explains why RESEARCH §Pattern 3 / Code Examples Example 1 are superseded.
- **`test/fit/perf.test.ts` (69 lines, 1 test)**: covers the ROADMAP <100 ms perf gate. 3 warm-up iterations + 11 timed iterations; sort and pick the 6th element (index 5) as median; `console.log` min/median/max so future regressions are visible in test output even when the assertion still passes. Threshold: `expect(median).toBeLessThan(50)`. NOT marked `.skip` on CI per the ROADMAP success-criteria contract.
- **All 34 tests across the 5 test files pass under `npx vitest run`** (Phase 1's 17 + Wave 4's 17). `npm run typecheck:test` exits 0. `git diff --quiet test/fixtures/fit/` reports clean — no committed fixture bytes mutated by tests.

## Task Commits

Each task was committed atomically on `worktree-agent-af8f365f326e36c2f`:

1. **Task 1: loader.test.ts** — `8aac8a8` (`test(02-04): FIT-01 parity + FIT-04 real-world quirks + sync invariant`)
2. **Task 2: error-paths.test.ts** — `e77187f` (`test(02-04): all four FitLoadError subclasses fire on corrupt input (D-FIT-06)`)
3. **Task 3: dev-field-shadow.test.ts** — `561f53d` (`test(02-04): shadow.fit loads without throwing + emits util.debuglog (D-FIT-10)`)
4. **Task 4: perf.test.ts** — `b2a09ad` (`test(02-04): ROADMAP perf gate -- perf-1hr.fit parses in <50 ms median`)

The orchestrator commits SUMMARY.md (and any shared-file updates) post-merge — this agent does NOT touch STATE.md / ROADMAP.md from inside the worktree.

## Confirmation Items (per plan `<output>`)

- **Test file line counts**:
  - `test/fit/loader.test.ts` — **148 lines, 7 tests** (plan estimate >= 60 — overshot because each FIT-04 fixture got its own `it()` for clarity)
  - `test/fit/error-paths.test.ts` — **162 lines, 6 tests** (plan estimate >= 80 — overshot because the inlined try/catch + `toBeInstanceOf` assertions are written out per subclass for grep-coverage of the four named symbols)
  - `test/fit/dev-field-shadow.test.ts` — **97 lines, 3 tests** (plan estimate >= 40 — overshot because the file header has the long D-FIT-10-supersedes-RESEARCH note)
  - `test/fit/perf.test.ts` — **69 lines, 1 test** (plan estimate >= 30 — overshot because of the methodology JSDoc + visible console.log line)
- **Actual measured median for the perf test on this dev machine**: **median = 10.44 ms** over 11 runs (min = 9.26, max = 11.01). Reference point for plan 02-05 / future phases: ~10 ms is a reasonable steady-state on Apple Silicon for `perf-1hr.fit` (4562 records, 76 min). The 50 ms threshold has ~5x headroom on this machine; CI on slower x86_64 runners should still clear it comfortably (RESEARCH measured 1.85 ms on a synthetic 3600-record file; the real-Garmin file is denser but still well within the gate).
- **Actual measured power-presence count for `dev-fields-non-shadow.fit`**: **2501 of 2501 records carry power (100%)**. The plan's >= 2400 threshold has ~96-record headroom; the threshold did NOT need to be revisited. Future regression that strips power from > 4% of records would be caught.
- **Confirmation that no committed fixture file was mutated**: `git diff --quiet test/fixtures/fit/` exit code = **0** (clean) post-suite. T-02-17 mitigated.
- **dev-field-shadow.test.ts subprocess approach** (`npx tsx`): **worked first try; no fallback needed.** The subprocess exited with status 0; stderr contained the exact debuglog message `TRAINER-SIM:FIT <pid>: developer field shadow detected on standard field power (developer_data_index=0, field_definition_number=0) — fit-file-parser collides developer value onto record.power; returning whatever parser produced (D-FIT-10)`. The test asserts on `/developer field shadow/i` + `/power/i` regex — loose enough to survive minor message-text edits, tight enough to catch a regression that drops the shadow message altogether (T-02-18 accept-disposition).
- **Confirmation that error-paths.test.ts group 4 imported from `test/fixtures/minimal-fit-bytes.ts`**: verified via `grep -E "from\s+['\"]\\.\\./fixtures/minimal-fit-bytes\\.js['\"]" test/fit/error-paths.test.ts` -> 1 match. The literal CRC-16/ARC table boundary values are absent (`grep -cE '0xCC01' test/fit/error-paths.test.ts` = 0, `grep -cE '0x4400' test/fit/error-paths.test.ts` = 0). T-02-25 mitigated.
- **Plan 02-05 owns**: `test/fit/normalize.test.ts` (direct unit tests of the pure `normalize` function for D-FIT-01..03 + D-FIT-09 debuglog) AND the local-dev opt-in test suite (gated on env var, runs against the developer's actual cycling-app exports).

## Decisions Made

All decisions are pre-locked in `02-CONTEXT.md` (D-FIT-01 through D-FIT-10) and Phase 1 conventions. Two execution-time decisions are recorded:

- **ESM `__dirname` derivation** via `dirname(fileURLToPath(import.meta.url))` rather than transpiler-injected `__dirname`. Phase 1's existing test does not read files so no precedent existed; this pattern is now established for any future test that resolves fixture paths.
- **Loose regex assertions on the shadow debuglog message** (`/developer field shadow/i` and `/power/i`) rather than exact-string match. T-02-18 accept-disposition: the message text is owned by `src/fit/loader.ts` and the regex pair gives the loader room to refine wording while still catching a regression that drops the shadow signal altogether.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Tightened JSDoc to satisfy literal-grep acceptance criteria**

- **Found during:** Task 1 (acceptance verification).
- **Issue:** First draft of `test/fit/loader.test.ts` mentioned `TEST_FIT_DIR` once in the file-header JSDoc to flag what's out-of-scope. Plan acceptance criterion is the literal `grep -F 'TEST_FIT_DIR' test/fit/loader.test.ts | wc -l` reports 0 — any occurrence (even in a comment explaining the *separation* from plan 02-05) fails.
- **Fix:** Reworded the out-of-scope bullet from "TEST_FIT_DIR opt-in suite (plan 02-05)" to "the local-dev opt-in suite (plan 02-05)". Intent preserved (future readers still see plan 02-05 owns the local-dev tier); literal token absent.
- **Files modified:** `test/fit/loader.test.ts`.
- **Verification:** `grep -F 'TEST_FIT_DIR' test/fit/loader.test.ts | wc -l` = 0; tests still pass.
- **Committed in:** `8aac8a8` (rewording applied before the commit).

**2. [Rule 1 - Bug] Same-class JSDoc tightening in `test/fit/error-paths.test.ts`**

- **Found during:** Task 2 (acceptance verification).
- **Issue:** First draft mentioned the literal CRC-table boundary values `0xCC01` and `0x4400` once each in JSDoc (explaining what was forbidden). It also mentioned the deliberately-absent typed shadow-error class by literal name once. Plan acceptance greps require all three counts to be 0 in this file.
- **Fix:** Reworded the "Forbidden in this file" JSDoc bullet to describe the constraint without naming the literal hex values OR the absent class. Cross-references to `minimal-fit-bytes.ts` and to D-FIT-10 are preserved.
- **Files modified:** `test/fit/error-paths.test.ts`.
- **Verification:** `grep -cE '0xCC01' test/fit/error-paths.test.ts` = 0; `grep -cE '0x4400' test/fit/error-paths.test.ts` = 0; `grep -cF 'DeveloperFieldShadowError' test/fit/error-paths.test.ts` = 0; tests still pass.
- **Committed in:** `e77187f`.

**3. [Rule 1 - Bug] Same-class JSDoc tightening in `test/fit/dev-field-shadow.test.ts`**

- **Found during:** Task 3 (acceptance verification).
- **Issue:** First draft mentioned `experimental-strip-types` four times in JSDoc (explaining why we use tsx instead). Plan acceptance criterion requires `grep -F 'experimental-strip-types' test/fit/dev-field-shadow.test.ts | wc -l` = 0.
- **Fix:** Reworded the four references to talk about "the built-in Node TS stripper" instead of naming the flag literally. CLAUDE.md citation, the rationale (.js -> .ts import-specifier rewriting), and the "use tsx" guidance are all preserved.
- **Files modified:** `test/fit/dev-field-shadow.test.ts`.
- **Verification:** `grep -F 'experimental-strip-types' test/fit/dev-field-shadow.test.ts | wc -l` = 0; tests still pass.
- **Committed in:** `561f53d`.

**4. [Rule 1 - Bug] Same-class JSDoc tightening in `test/fit/perf.test.ts`**

- **Found during:** Task 4 (acceptance verification).
- **Issue:** First draft of the file-header JSDoc said "do NOT add `.skip`" — the literal token `.skip` triggered the acceptance grep `grep -E '\.skip|skipIf' test/fit/perf.test.ts | wc -l` reporting 1 (instead of the required 0).
- **Fix:** Reworded the bullet to "do NOT bypass the gate by disabling this test". Intent preserved.
- **Files modified:** `test/fit/perf.test.ts`.
- **Verification:** `grep -E '\.skip|skipIf' test/fit/perf.test.ts | wc -l` = 0; test still passes.
- **Committed in:** `b2a09ad`.

---

**Total deviations:** 4 auto-fixed (all the same class — grep-driven JSDoc tightening, identical pattern to plan 02-01 deviation §1 and plan 02-03 deviations §1/§2). Each tightening preserved the plan's intent; none changed test behavior or weakened assertions.

## Issues Encountered

None beyond the four grep-driven JSDoc tightenings above. The subprocess + `npx tsx` + `NODE_DEBUG` approach for the shadow-debuglog assertion worked first try; no fallback to `vi.mock` or stderr-stub was needed.

## TDD Gate Compliance

This plan is `type: execute` (not `type: tdd`). The git log for this plan correctly contains four `test(02-04)` commits and zero `feat(02-04)` commits — Wave 4 is the test wave; the source it asserts against landed in Wave 3 (plan 02-03). MVP+TDD runtime gate is NOT active in this phase per `.planning/config.json` (no `MVP_MODE` / `TDD_MODE` flags propagated by the orchestrator), so the gate's behavior-adding-task halt does not fire here.

## Threat Flags

None. The plan implements every `<threat_model>` mitigation enumerated in source / test:

- **T-02-17 (test mutates a committed fixture in place):** acceptance criterion `git diff --quiet test/fixtures/fit/` exits 0 post-suite — verified clean. All buffer mutation in error-paths.test.ts is on in-memory `Buffer.from(readFileSync(...))` copies; the underlying file bytes are never written.
- **T-02-18 (subprocess captures locale-/version-dependent stderr):** dev-field-shadow.test.ts asserts loose regexes (`/developer field shadow/i` + `/power/i`) rather than exact-string match. Loader is free to refine wording without breaking this test, but cannot drop the shadow-detection signal altogether.
- **T-02-19 (perf test eats the vitest timeout):** measured median ~10.44 ms over 11 runs (~115 ms total + 30 ms warm-up = ~145 ms wall time). Vitest's default 5000 ms timeout has ~30x margin.
- **T-02-20 (test imports loader internal directly):** loader.test.ts imports through `../../src/index.js` (public surface); does NOT touch `src/fit/loader.js`. perf.test.ts and dev-field-shadow.test.ts also stick to the public surface. error-paths.test.ts imports the public surface PLUS the test-only `test/fixtures/minimal-fit-bytes.js` byte writers — same constraint, additional source for FIT-byte construction only.
- **T-02-25 (test inlines a CRC table copy that drifts from generate-shadow.ts):** error-paths.test.ts group 4 imports `writeFitHeader` / `writeFileIdDefinitionAndData` / `writeCrcTrailer` / `FIT_EPOCH_OFFSET_SECONDS` from `test/fixtures/minimal-fit-bytes.js` rather than inlining a CRC table. The literal table boundary values are absent (verified by acceptance grep).
- **T-02-26 (subprocess uses node --experimental-strip-types):** dev-field-shadow.test.ts subprocess invokes `npx tsx`; the literal flag name does not appear anywhere in the file (acceptance grep verified).

## Next Plan Readiness (02-05)

Plan 02-05 (the only remaining plan in Phase 2) ships:

- **`test/fit/normalize.test.ts`** — direct unit tests of the pure `normalize` function imported from `src/fit/normalize.js` (NOT the public surface — normalize is an internal export). Exercises D-FIT-01 (wire `0` preserved, `undefined` omitted), D-FIT-03 (sort + dedup keep-first), D-FIT-09 (`util.debuglog` drop-count messages). Constructs `ParsedFitMinimal` POJOs in tests; no FIT bytes required. Plan 02-05 may also import the `duplicates.fit` fixture (committed in plan 02-02; 13 duplicate timestamps) for end-to-end dedup verification.
- **`test/fit/local.test.ts`** — local-dev opt-in suite gated on an env var. When set, walks the developer's directory of cycling-app exports and asserts each `.fit` file loads to >= 1 record without throwing. Skipped in CI; runs locally before release.
- Plan 02-05 may run in parallel against the same base commit as this plan (02-04). Their files do not overlap (this plan ships `loader.test.ts`, `error-paths.test.ts`, `dev-field-shadow.test.ts`, `perf.test.ts`; plan 02-05 ships `normalize.test.ts`, `local.test.ts`).

## Self-Check: PASSED

- `test/fit/loader.test.ts` — FOUND (148 lines, 7 tests; imports `loadFitFromPath` + `loadFitFromBuffer` + `RideRecord` from `../../src/index.js`; references all four CI fixtures; asserts `not.toBeInstanceOf(Promise)`, `power === 0`, `60_000` ms gap delta, `2400` power threshold; no `1500` or `TEST_FIT_DIR` literals)
- `test/fit/error-paths.test.ts` — FOUND (162 lines, 6 tests; imports the four error subclasses + `FitLoadError` from public surface AND the four byte writers from `../fixtures/minimal-fit-bytes.js`; no inlined CRC-table boundary values; no `DeveloperFieldShadowError` literal; `instanceof FitLoadError` asserted in every group)
- `test/fit/dev-field-shadow.test.ts` — FOUND (97 lines, 3 tests; uses `spawnSync` + `NODE_DEBUG` + `tsx`; no `experimental-strip-types`; asserts `not.toThrow` AND `expect.fail` AND stderr-regex-match on `power` / `shadow`; cites `D-FIT-10`)
- `test/fit/perf.test.ts` — FOUND (69 lines, 1 test; imports `loadFitFromBuffer` from public surface AND `performance` from `node:perf_hooks`; references `perf-1hr.fit`; warm-up + 11-run median + `toBeLessThan(50)`; no `.skip` / `skipIf`)
- Commit `8aac8a8` (Task 1) — FOUND in `git log`
- Commit `e77187f` (Task 2) — FOUND in `git log`
- Commit `561f53d` (Task 3) — FOUND in `git log`
- Commit `b2a09ad` (Task 4) — FOUND in `git log`
- `npx vitest run` exits 0 with all 34 tests passing (Phase 1's 17 + Wave 4's 17) — VERIFIED
- `npm run typecheck:test` exits 0 — VERIFIED
- `git diff --quiet test/fixtures/fit/` exit 0 (no committed fixture bytes mutated by tests) — VERIFIED

---

*Phase: 02-fit-loader-normalization*
*Plan: 04*
*Completed: 2026-05-16*
