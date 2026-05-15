---
phase: 02-fit-loader-normalization
plan: 05
subsystem: fit
tags:
  - fit
  - tests
  - normalize
  - local-dev
  - opt-in

# Dependency graph
requires:
  - phase: 02-fit-loader-normalization
    plan: 03
    provides: |
      Pure `normalize(parsed): RideRecord[]` function (src/fit/normalize.ts)
      and `loadFitFromPath` / `loadFitFromBuffer` public surface
      (src/index.ts) — the SUT and seam this plan asserts against.
  - phase: 02-fit-loader-normalization
    plan: 02
    provides: |
      `test/fixtures/fit/duplicates.fit` (702 records, 13 duplicate
      timestamps per D-FIT-05 mapping) — input for the D-FIT-09 debuglog
      subprocess test.
provides:
  - "test/fit/normalize.test.ts: 16 unit tests covering FIT-02 (sort), FIT-03 (Date->ms via getTime()), D-FIT-01 (wire-honest 0 / undefined / omitted-key), D-FIT-02 (gap preservation), D-FIT-03 (dedup keep-first against hand-rolled inputs AND duplicates.fit), D-FIT-09 (debuglog emission via NODE_DEBUG + npx tsx subprocess capture)"
  - "test/fit/local.test.ts: D-FIT-04 local-dev opt-in smoke suite. Skipped silently when TEST_FIT_DIR unset (CI default and binding D-FIT-04 contract); when set, walks the directory and asserts every .fit loads to >0 records via public loadFitFromPath"
affects:
  - "Phase 2 test count: 33 passed + 1 skipped (was 17 passed before this plan; plan 02-04 contributes the rest)"
  - "Phase 3 replay (the D-FIT-01 wire-honest contract is now pinned at the unit-test level — Phase 3 must honor `power: 0` distinct from missing `power`)"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Direct unit-test import of a pure function bypassing the public surface — acceptable per the plan when the SUT is parser-agnostic and most inputs are hand-constructed POJOs (test imports `from '../../src/fit/normalize.js'`, not `from '../../src/index.js'`)"
    - "Subprocess + NODE_DEBUG=trainer-sim:fit + npx tsx for capturing util.debuglog stderr — same pattern plan 02-04 task 3 will use; the `npx tsx` choice (NOT Node's built-in TS-stripping loader) handles `.js`->`.ts` import-specifier rewriting"
    - "`'in'` operator for omitted-vs-explicit-undefined property assertions — `'power' in result[0]` is semantically tighter than `result[0].power === undefined` (catches the omitted-key D-FIT-01 contract that the latter misses)"
    - "describe.skipIf(!process.env.TEST_FIT_DIR) for silent CI skip of opt-in suites — defensively wraps directory enumeration in try/catch so a typo'd TEST_FIT_DIR fails ONLY the local suite, not the whole npm test run"

key-files:
  created:
    - "test/fit/normalize.test.ts (248 lines, 16 tests)"
    - "test/fit/local.test.ts (80 lines, 0-N tests depending on TEST_FIT_DIR)"
  modified: []

key-decisions:
  - "Direct import of `normalize` from src/fit/normalize.js (pure function — allowed to bypass public-API surface per plan acceptance criteria) vs. testing exclusively through loadFitFromPath/loadFitFromBuffer: chose direct import for groups 1-3+5 (hand-rolled ParsedFitMinimal POJOs are easier to construct and reason about than crafting matching FIT bytes); group 4 invokes the loader via the public API as the duplicates.fit test."
  - "Subprocess test approach for D-FIT-09: chose `npx tsx -e <inline script>` over a separate fixture script file. The inline form keeps the test self-contained (no extra committed file to maintain) and matches plan 02-04 task 3's pattern. Acceptance criterion grep-bans `experimental-strip-types` literal in the file (rationale: even mentioning it in comments would invite a future executor to copy-paste it)."
  - "Defensive directory enumeration in local.test.ts: chose try/catch wrapping statSync + readdirSync over letting ENOENT bubble up at module-load time. A typo'd TEST_FIT_DIR fails ONLY the local suite's tests (with a clear message); the rest of npm test still runs."

requirements-completed:
  - FIT-02
  - FIT-03
  - FIT-04

# Metrics
duration: ~5min
completed: 2026-05-16
---

# Phase 2 Plan 05: Normalize Unit Tests + TEST_FIT_DIR Opt-In Suite Summary

**Wave 4's normalize-side test wave: 16 unit tests pinning FIT-02 / FIT-03 / D-FIT-01 / D-FIT-02 / D-FIT-03 / D-FIT-09 against the pure `normalize` function (with one subprocess-driven fixture test for the D-FIT-09 debuglog), plus the D-FIT-04 local-dev opt-in suite that walks `TEST_FIT_DIR` when set and is silently skipped when unset.**

## Performance

- **Duration:** ~5 min (running in parallel with plan 02-04 in a sibling worktree)
- **Tasks:** 2
- **Files created:** 2 (`test/fit/normalize.test.ts`, `test/fit/local.test.ts`)
- **Files modified:** 0
- **Total LOC added:** 328 (248 normalize + 80 local)
- **Test count delta:** +16 unit tests (normalize) + 0 CI-running tests (local — skipped). 1 vitest "skipped" entry reflects the local suite.

## Accomplishments

### test/fit/normalize.test.ts (248 lines, 16 tests)

Direct unit-test import of `normalize` from `../../src/fit/normalize.js` — bypasses the public surface, which is acceptable here because `normalize` is a pure function whose contract is well-defined. The plan acceptance criteria require this exact import path.

The 16 tests are organized into five groups mapped 1:1 to locked decisions:

- **Group 1 (FIT-03 — Date -> Unix ms via getTime()):** 3 tests. Asserts the conversion happens (`Date('2025-01-01T00:00:00Z')` -> `Date.UTC(2025,0,1)`); `typeof timestamp === 'number'` (NOT string per RESEARCH §Pitfall 7); millisecond precision preserved.
- **Group 2 (D-FIT-01 — wire-honest power/cadence):** 5 tests. Real `power: 0` preserved as `0`; both `power: 0` AND `cadence: 0` preserved together; missing fields produce omitted keys (verified via `'power' in result[0]` === `false`); explicit-input `undefined` collapses to omitted-key (D-FIT-01: undefined and missing-field are equivalent); non-zero values pass through unchanged.
- **Group 3 (FIT-02 + D-FIT-03 — sort + dedup keep-first):** 6 tests. Out-of-order sorted ascending (with values following their records, not the input position); exact-duplicate timestamps deduped keep-first (first occurrence's `power: 100` wins over second's `power: 200`); dedup applies AFTER sort (the post-sort first occurrence is the kept record); empty `records: []` returns `[]`; `records: undefined` returns `[]`; defensive skip on records lacking a timestamp.
- **Group 4 (D-FIT-03 + D-FIT-09 — dedup count via debuglog, real fixture coverage):** 1 subprocess test against `test/fixtures/fit/duplicates.fit` (702 records, 13 dupes per D-FIT-05 mapping). Spawns `npx tsx -e <inline loader script>` with `NODE_DEBUG=trainer-sim:fit`, captures stderr, asserts `/normalize.*duplicates.*dropped/i` matches, asserts stdout reports `689` records (±2 tolerance — `records=68[7-9]|records=69[0-1]`).
- **Group 5 (D-FIT-02 — gap preservation):** 1 test. A 60-second gap between two records survives normalize verbatim — output length stays at 2, the timestamp delta is `60_000` ms (no backfill, no phantom records inserted).

### test/fit/local.test.ts (80 lines, 0 CI tests)

D-FIT-04 local-dev tier. Imports `loadFitFromPath` from the public surface (`../../src/index.js`), reads `process.env.TEST_FIT_DIR`, and gates the entire suite on `describe.skipIf(!dir)`.

When unset (CI default and the binding D-FIT-04 contract per CONTEXT.md): vitest reports 1 skipped, exit code 0. When set: walks the directory via `readdirSync`, filters to `.fit` extension via `extname`, and emits one `it()` block per file that asserts `records.length > 0` AND every record's `timestamp` is a number (light D-FIT-01 / FIT-03 shape check).

Defensive enumeration: `statSync` + `readdirSync` are wrapped in try/catch. If `TEST_FIT_DIR` points to a non-existent or unreadable path, only the local suite's tests fail (with a clear message naming the bad path); the rest of `npm test` still runs. If the directory exists but contains zero `.fit` files, one explicit `expect.fail` test fires so the developer knows their `TEST_FIT_DIR` is misconfigured.

## Confirmation Items (per plan `<output>`)

### Per-test-file metrics

- **`test/fit/normalize.test.ts`:** 248 lines, 16 unit tests. All pass via `npx vitest run test/fit/normalize.test.ts` (verified pre-commit).
- **`test/fit/local.test.ts`:** 80 lines, 0-N tests depending on TEST_FIT_DIR. Under default `npm test` (CI default), 1 skipped entry.

### Local-suite skip contract — the binding D-FIT-04 behavior

**`env -u TEST_FIT_DIR npx vitest run test/fit/local.test.ts` exits 0 with "skipped" in the output:**

```
 Test Files  1 skipped (1)
      Tests  1 skipped (1)
```

This is the binding D-FIT-04 contract. CI never sets `TEST_FIT_DIR`; the local suite is reported as skipped (NOT failed). Plan acceptance verified.

**Under default `npm test` (no env var):**

```
 Test Files  2 passed | 1 skipped (3)
      Tests  33 passed | 1 skipped (34)
```

The skipped suite is `local.test.ts`; the 2 passing files are `test/ftms/indoor-bike-data.test.ts` (Phase 1, 17 tests) and `test/fit/normalize.test.ts` (this plan, 16 tests).

### "When TEST_FIT_DIR is set" path — exercised manually during local dev

Manually verified during this plan's execution: `TEST_FIT_DIR=/tmp/test-fit-dir npx vitest run test/fit/local.test.ts` (with `basic.fit` and `duplicates.fit` copied into the directory) reported `Test Files 1 passed (1) / Tests 2 passed (2)`. This is informational — D-FIT-04 explicitly excludes the "when set" path from the CI contract. The test directory was cleaned up after verification (no committed test artifact).

### duplicates.fit + NODE_DEBUG + npx tsx subprocess test passed

Group 4's subprocess test passed on the first run with the planned approach unchanged: `npx tsx -e <inline loader script>` with `NODE_DEBUG=trainer-sim:fit` produces stderr matching `/normalize.*duplicates.*dropped/i` and stdout reporting `records=689` (exact). The `±2` tolerance in the regex was not needed for this fixture but is preserved per the plan's intent.

### Aggregate Phase 2 test count and pass count post-commit

This worktree's view (plan 02-05 only — plan 02-04 runs in a sibling worktree):

| Suite                                  | Passed | Skipped |
| -------------------------------------- | ------ | ------- |
| `test/ftms/indoor-bike-data.test.ts`   | 17     | 0       |
| `test/fit/normalize.test.ts` (this plan) | 16     | 0       |
| `test/fit/local.test.ts` (this plan)   | 0      | 1       |
| **Total**                              | **33** | **1**   |

Plan 02-04's tests (loader.test.ts, error-paths.test.ts, dev-field-shadow.test.ts, perf.test.ts) land in a sibling worktree merge — combined Phase 2 test count will be reported in the orchestrator's wave-4 merge summary, not here.

## Task Commits

Each task committed atomically on `worktree-agent-a6a228d878f33a590`:

1. **Task 1: `test/fit/normalize.test.ts`** — `d79ee7d` (`test(02-05): normalize unit tests (FIT-02/03, D-FIT-01/02/03/09)`)
2. **Task 2: `test/fit/local.test.ts`** — `cff8cb3` (`test(02-05): TEST_FIT_DIR opt-in local-dev suite (D-FIT-04)`)

The orchestrator commits SUMMARY.md (and any shared-file updates) post-merge — this agent does NOT touch STATE.md / ROADMAP.md from inside the worktree.

## Decisions Made

All test-strategy decisions are pre-locked in `02-CONTEXT.md` (D-FIT-01 through D-FIT-10) and the plan's task action text. Three execution-time decisions are recorded in the frontmatter:

- **Direct import of `normalize` (groups 1-3+5) vs. exclusive public-API testing:** plan acceptance criteria explicitly require the direct import; rationale is that hand-rolled `ParsedFitMinimal` POJOs are easier to construct than crafting matching FIT bytes for every edge case. Group 4 invokes `loadFitFromBuffer` (the public API) for the duplicates.fit subprocess test, which keeps the parser-dependency surface tested through the seam.
- **Subprocess approach (`npx tsx -e <inline>`) vs. external script file:** chose inline; matches plan 02-04 task 3's pattern; keeps the test self-contained.
- **Defensive try/catch around statSync + readdirSync in local.test.ts:** chose to wrap rather than let ENOENT bubble up at module-load time; ensures a typo'd TEST_FIT_DIR fails ONLY the local suite's tests, not the whole `npm test` run.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Tightened JSDoc/comments to satisfy literal-grep acceptance criteria**

- **Found during:** Task 1 verification (acceptance criterion: `grep -F 'experimental-strip-types' test/fit/normalize.test.ts | wc -l` must report 0).
- **Issue:** First draft of `test/fit/normalize.test.ts` referenced `node --experimental-strip-types` 5 times across the file-header comments and Group 4's inline rationale ("we use `npx tsx`, NOT `node --experimental-strip-types`, because..."). The plan's acceptance grep is a literal `grep -F` and counts every line containing the substring — including comment lines that explain *why we don't use it*. Same pattern as plan 02-03 deviation §1.
- **Fix:** Reworded all 5 references to "Node's built-in TS-stripping loader" and similar phrasings. The cross-reference to RESEARCH and CLAUDE.md is preserved; only the literal symbol that would invite a future copy-paste mistake is removed.
- **Files modified:** `test/fit/normalize.test.ts`.
- **Verification:** `grep -F 'experimental-strip-types' test/fit/normalize.test.ts | wc -l` -> `0`.
- **Committed in:** `d79ee7d` (the rewording was applied before the commit, not after).

**2. [Rule 1 - Bug] Same-class issue in `test/fit/local.test.ts` for `fit-file-parser`**

- **Found during:** Task 2 verification (acceptance criterion: `grep -F 'fit-file-parser' test/fit/local.test.ts | grep -v '^[[:space:]]*//' | wc -l` must report 0).
- **Issue:** First draft of `test/fit/local.test.ts`'s file-header JSDoc had a "Forbidden" bullet that read "No fit-file-parser import". The verifier's `grep -v '^[[:space:]]*//'` filters lines starting with `//`, but the JSDoc bullet line starts with ` *` (asterisk + space inside `/** ... */`), so it isn't filtered. The literal substring fails the count.
- **Fix:** Reworded to "No direct parser-dependency import (we test through the public surface)". Same intent; same plan acceptance criterion satisfied.
- **Files modified:** `test/fit/local.test.ts`.
- **Verification:** `grep -F 'fit-file-parser' test/fit/local.test.ts | grep -v '^[[:space:]]*//' | wc -l` -> `0`.
- **Committed in:** `cff8cb3` (the rewording was applied before the commit, not after).

---

**Total deviations:** 2 auto-fixed (both grep-driven JSDoc/comment tightenings — same pattern as plans 02-01 deviation §1 and 02-03 deviation §1; this is a recurring class of issue when literal-grep acceptance criteria intersect JSDoc comments). **Impact on plan:** Neither deviation changed test behavior. Both preserve the plan's intent (no `node --experimental-strip-types` invocation; no parser-dependency import) more strongly at the comment level too.

## Issues Encountered

None beyond the two grep-driven JSDoc tightenings above.

## TDD Gate Compliance

Task 1 in this plan is tagged `tdd="true"` in the frontmatter, but the SUT (`src/fit/normalize.ts`) was already shipped in plan 02-03's task 1 (`feat(02-03): add FIT normalize ...`). The plan-level `type: execute` (not `type: tdd`) and the wave structure make this a "test-after" wave — the source ships in Wave 3 (plan 02-03), the tests ship in Wave 4 (plans 02-04 and 02-05). The git log for this plan therefore correctly contains two `test(02-05)` commits and zero `feat(02-05)` commits.

For the executor's MVP+TDD gate: the runtime gate is NOT active in this phase per `.planning/config.json` (no MVP_MODE / TDD_MODE flags propagated by the orchestrator), so the gate's behavior-adding-task halt does not fire here.

## Threat Flags

None. The plan implements every `<threat_model>` mitigation enumerated:

- **T-02-21 (debuglog format coupling):** the regex assertion targets `/normalize.*duplicates.*dropped/i` — a loose pattern that allows future word-order tweaks but catches a complete removal of drop-count emission.
- **T-02-22 (PII in TEST_FIT_DIR runs):** accepted; CI never sets the env var. The local suite asserts `records.length > 0` and `typeof timestamp === 'number'` only — no record contents reach stdout/stderr.
- **T-02-23 (DoS via huge TEST_FIT_DIR):** accepted; developer-machine choice.
- **T-02-24 (RideRecord widening invalidates hand-rolled inputs):** mitigated by pinning the exact contract for v1; widening RideRecord requires re-running these tests.
- **T-02-27 (subprocess uses Node's built-in TS-stripping loader instead of tsx):** mitigated by `npx tsx` in Group 4 + acceptance criterion `grep -F 'experimental-strip-types' ... wc -l == 0`.
- **T-02-28 (verify pins a developer-host path, masking the unset-skip regression):** mitigated by the `env -u TEST_FIT_DIR` invocation in the plan's verify command — the binding D-FIT-04 contract is the unset-skip behavior, exercised explicitly.

## Self-Check: PASSED

- `test/fit/normalize.test.ts` — FOUND (248 lines, 16 tests; imports `normalize` from `../../src/fit/normalize.js`; uses `Date.UTC`; references `duplicates.fit`; uses `NODE_DEBUG`; uses `tsx`; zero occurrences of `experimental-strip-types`; zero non-comment occurrences of `fit-file-parser`)
- `test/fit/local.test.ts` — FOUND (80 lines; uses `describe.skipIf`; imports `loadFitFromPath` from `../../src/index.js`; uses `readdirSync` + `extname`; asserts `records.length > 0`; zero occurrences of `/Users/` or `/home/` paths; zero non-comment occurrences of `fit-file-parser`)
- Commit `d79ee7d` (Task 1 normalize tests) — FOUND in `git log` (verified: `git log --oneline | grep d79ee7d`)
- Commit `cff8cb3` (Task 2 local test) — FOUND in `git log`
- `npx vitest run test/fit/normalize.test.ts` exit 0, 16 passed — VERIFIED
- `env -u TEST_FIT_DIR npx vitest run test/fit/local.test.ts` exit 0, 1 skipped — VERIFIED
- `npm test` exit 0, 33 passed + 1 skipped — VERIFIED
- `npm run typecheck:test` exit 0 — VERIFIED

---

*Phase: 02-fit-loader-normalization*
*Plan: 05*
*Completed: 2026-05-16*
