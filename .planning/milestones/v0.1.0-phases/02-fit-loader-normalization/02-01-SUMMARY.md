---
phase: 02-fit-loader-normalization
plan: 01
subsystem: fit
tags:
  - fit
  - foundation
  - types
  - errors
  - parser-dep
  - typescript

# Dependency graph
requires:
  - phase: 01-vendored-ftms-codec
    provides: |
      Phase 1's `src/index.ts` re-export pattern (`.js` extensions on relative
      specifiers); Phase 1's encoder gates the FTMS flag bit on `value === undefined`,
      which the new `RideRecord.power?` / `cadence?` shape lines up with.
provides:
  - "fit-file-parser@~3.0.0 installed as a runtime dependency (D-FIT-08)"
  - "Public `RideRecord` type for the parsed-FIT contract (D-FIT-01)"
  - "First typed-error hierarchy in trainer-sim: FitLoadError + 4 concrete leaves (D-FIT-06)"
  - "Locked exclusion of typed shadow-error class (D-FIT-10 — debuglog-only)"
affects:
  - "02-02-fixtures (FIT bytes)"
  - "02-03-loader (consumes RideRecord + throws the FitLoadError leaves)"
  - "02-04-normalize (constructs RideRecord)"
  - "02-05-tests (asserts the error hierarchy)"
  - "Phase 3 replay (iterates RideRecord[])"
  - "Phase 4 FakeTransport (consumes RideRecord stream)"

# Tech tracking
tech-stack:
  added:
    - "fit-file-parser ~3.0.0 (MIT, dual ESM+CJS, ships .d.ts)"
  patterns:
    - "Typed-error hierarchy: abstract base + bodyless concrete leaves; name set in base via this.constructor.name"
    - "Public types live in src/types.ts (Phase 4 will extend with ITrainerTransport / Config)"

key-files:
  created:
    - "src/types.ts (46 lines — RideRecord interface)"
    - "src/fit/errors.ts (57 lines — FitLoadError + 4 leaves)"
  modified:
    - "package.json (+ fit-file-parser dep)"
    - "package-lock.json (lockfile updated)"

key-decisions:
  - "fit-file-parser pinned with TILDE (~3.0.0), not caret — minor bump must be intentional because D-FIT-07 exploits the parser's sync-callback property and a 3.x.0 release could fix the CRC TODO"
  - "RideRecord power/cadence are optional with strict undefined-vs-zero semantics (D-FIT-01) — never collapse undefined to 0"
  - "No typed shadow-error class in the FitLoadError hierarchy (D-FIT-10 — shadow conflicts emit util.debuglog and do NOT throw)"
  - "Re-exports from src/index.ts deliberately deferred to plan 02-03 (lands alongside the loader)"

patterns-established:
  - "Conventional-commit prefix per task: chore(02-01) for dep install, feat(02-01) for source"
  - "Each plan's typed errors live in a sibling errors.ts under the feature dir (src/fit/errors.ts) — future phases (replay, transport) follow"
  - "Acceptance grep regexes drive verification — comments must avoid literal forbidden strings (DeveloperFieldShadowError grep-banned even in JSDoc)"

requirements-completed:
  - FIT-01
  - FIT-02
  - FIT-03
  - FIT-04
  - FIT-05

# Metrics
duration: ~10min
completed: 2026-05-16
---

# Phase 2 Plan 01: Phase 2 Foundation Summary

**fit-file-parser@~3.0.0 installed as runtime dep, public `RideRecord` type authored per D-FIT-01, and the first typed-error hierarchy in trainer-sim (`FitLoadError` + 4 concrete leaves) shipped per D-FIT-06 — with the deliberate non-member shadow-error class locked out per D-FIT-10.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-05-15T21:13:00Z
- **Completed:** 2026-05-15T21:16:00Z
- **Tasks:** 3
- **Files created:** 2 (`src/types.ts`, `src/fit/errors.ts`)
- **Files modified:** 2 (`package.json`, `package-lock.json`)

## Accomplishments

- `fit-file-parser@~3.0.0` pinned with **tilde** range under `dependencies` (NOT devDeps); tilde — not caret — protects D-FIT-07's reliance on the parser's sync-callback property and the CRC-TODO behavior. Disk version: 3.0.0.
- `src/types.ts` (46 lines) exports a single `RideRecord` interface: `{ timestamp: number; power?: number; cadence?: number }`. JSDoc explicitly documents the absent-vs-zero semantics (D-FIT-01) and the Unix-epoch-ms convention (FIT-03). No other exports — Phase 4 will extend this file when `ITrainerTransport` lands.
- `src/fit/errors.ts` (57 lines) exports an **abstract** `FitLoadError extends Error` plus four bodyless concrete leaves: `InvalidFitHeaderError`, `FitCrcError`, `FitTruncatedError`, `NoRecordMessagesError`. The base sets `this.name = this.constructor.name` so stack traces identify the concrete subclass.
- **Deliberate non-member confirmed:** there is NO typed shadow-error class in the hierarchy (D-FIT-10 + the FIT-05 amendment locked 2026-05-16). Shadow conflicts will be `util.debuglog('trainer-sim:fit')` warnings in the loader (plan 02-03), not throws. The file header explains this so a future copy-from-RESEARCH-Example-3 mistake is grep-banned.
- `npm run build` and `npm run typecheck:test` both green post-commit.

## Task Commits

Each task was committed atomically on `worktree-agent-ae6219eb6a0cfa6f1`:

1. **Task 1: Install fit-file-parser@~3.0.0** — `4ca949c` (`chore(02-01): install fit-file-parser@~3.0.0 (D-FIT-08)`)
2. **Task 2: Author src/types.ts (RideRecord)** — `73c5b29` (`feat(02-01): add RideRecord type per D-FIT-01`)
3. **Task 3: Author src/fit/errors.ts (FitLoadError hierarchy)** — `6a06991` (`feat(02-01): add FitLoadError hierarchy per D-FIT-06`)

The orchestrator commits SUMMARY.md (and any shared-file updates) post-merge — this agent does NOT touch STATE.md / ROADMAP.md from inside the worktree.

## Files Created/Modified

- `src/types.ts` (NEW, 46 lines) — Public `RideRecord` interface for the parsed-FIT contract.
- `src/fit/errors.ts` (NEW, 57 lines) — Abstract `FitLoadError` + 4 concrete subclasses; first typed-error hierarchy in the project.
- `package.json` — Added `fit-file-parser: ~3.0.0` to `dependencies`.
- `package-lock.json` — Lockfile updated (150 transitive packages added; `npm audit` reports 0 vulnerabilities).

## Decisions Made

All decisions for this plan are pre-locked in `02-CONTEXT.md` (D-FIT-01, D-FIT-06, D-FIT-08, D-FIT-10) and Phase 1 conventions (`.js`-extension import specifiers, dual ESM+CJS publish). No new decisions were needed at execution time.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Tightened JSDoc to satisfy acceptance grep regex**
- **Found during:** Task 3 (FitLoadError hierarchy)
- **Issue:** First draft of `src/fit/errors.ts` mentioned `DeveloperFieldShadowError` by name twice in JSDoc — once to label the deliberate non-member, once to reference the stale RESEARCH.md Example 3. The plan's acceptance criterion `[ "$(grep -cE 'DeveloperFieldShadowError' src/fit/errors.ts)" = "0" ]` is a literal grep, not an export-only check, so any occurrence — even in a comment explaining the *absence* — fails the check.
- **Fix:** Reworded the file header and comments to describe the locked-out class without naming it (e.g. "the deliberately-absent typed shadow-error class," "the shadow class shown in 02-RESEARCH.md §Example 3 must NOT be carried in"). Kept the rationale and the cross-reference to D-FIT-10 / FIT-05 / RESEARCH Example 3 intact so future readers still see the trap.
- **Files modified:** `src/fit/errors.ts`
- **Verification:** `grep -cE 'DeveloperFieldShadowError' src/fit/errors.ts` → `0`; all other Task 3 acceptance greps still pass.
- **Committed in:** `6a06991` (Task 3 commit; the rewording was applied before the commit, not after).

**2. [Rule 3 - Blocking] Replaced `require('fit-file-parser/package.json')` verifier with fs-read equivalent**
- **Found during:** Task 1 (parser install)
- **Issue:** The plan's verbatim acceptance check `node -e "const v=require('fit-file-parser/package.json').version; if(!/^3\.0\./.test(v)) process.exit(1)"` cannot run on this package because `fit-file-parser@3.0.0`'s `exports` map does not expose `./package.json` (Node 24 enforces `exports`-map subpath restrictions; throws `ERR_PACKAGE_PATH_NOT_EXPORTED`). The verifier as written would fail on a correctly-installed package.
- **Fix:** Verified the disk version via filesystem read instead: `node -e "const fs=require('fs'); const v=JSON.parse(fs.readFileSync('node_modules/fit-file-parser/package.json','utf8')).version; if(!/^3\.0\./.test(v)) process.exit(1)"`. Identical semantics, respects the package's exports policy.
- **Files modified:** None (verification-only adjustment; the plan's acceptance criterion remains satisfied — disk version IS `3.0.0`).
- **Verification:** fs-read prints `3.0.0`; the regex `/^3\.0\./` matches.
- **Committed in:** N/A (this was a verification-tool adjustment, not a source change).

---

**Total deviations:** 2 auto-fixed (1 grep-driven JSDoc tightening, 1 verifier-tool substitution).
**Impact on plan:** Neither deviation changed the plan's source-of-truth behavior. The first preserves D-FIT-10's intent more strongly (no typed shadow-error class even by name). The second is a Node-24 reality check on a verbatim verifier; it does not weaken the acceptance check.

## Issues Encountered

None beyond the two deviations above.

## TDD Gate Compliance

This plan is `type: execute` (not `type: tdd`). No RED/GREEN/REFACTOR cycle expected; the plan ships only types, errors, and a dependency declaration. Test fixtures and behavioral tests for the loader land in plans 02-02 and 02-05.

## Threat Flags

None. The plan implements `T-02-04` mitigation in source: `src/fit/errors.ts` does NOT export a typed shadow-error class (acceptance-grep enforced). `T-02-01` (supply-chain pin) implemented via the tilde range. `T-02-02` and `T-02-03` are accepted threats per the plan's `<threat_model>` and require no source changes.

## Next Plan Readiness (02-02 / 02-03 / 02-04 / 02-05)

- `RideRecord` is the contract — plans 02-04 (normalize) constructs it, 02-03 (loader) returns `RideRecord[]`, plan 02-05 tests it. Future Phase 3 / Phase 4 consume it.
- `FitLoadError` and the four leaves are ready to be thrown by the loader (plan 02-03) and asserted by tests (plan 02-05).
- `fit-file-parser` binary is on disk; plan 02-03's `loadFitFromBuffer` can `import FitParser from 'fit-file-parser'` directly.
- Re-exports from `src/index.ts` are intentionally NOT done here — they land in plan 02-03 alongside `loadFitFromPath` / `loadFitFromBuffer` so the public surface widens in one atomic commit.
- `verbatimModuleSyntax: true` reminder for plan 02-03: the `RideRecord` re-export must be `export type { RideRecord } from './types.js'` (with `.js`).

## Self-Check: PASSED

- `src/types.ts` — FOUND (46 lines, exports `RideRecord` interface)
- `src/fit/errors.ts` — FOUND (57 lines, 5 class exports: 1 abstract base + 4 leaves; 0 occurrences of `DeveloperFieldShadowError`)
- `package.json` declares `fit-file-parser: "~3.0.0"` under `dependencies` — FOUND
- Installed disk version `3.0.0` — FOUND
- Commit `4ca949c` (chore(02-01): install fit-file-parser@~3.0.0) — FOUND in `git log`
- Commit `73c5b29` (feat(02-01): add RideRecord type) — FOUND in `git log`
- Commit `6a06991` (feat(02-01): add FitLoadError hierarchy) — FOUND in `git log`
- `npm run build` exit 0 — VERIFIED
- `npm run typecheck:test` exit 0 — VERIFIED

---

*Phase: 02-fit-loader-normalization*
*Plan: 01*
*Completed: 2026-05-16*
