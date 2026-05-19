---
phase: 05-veloworld-end-to-end-validation
plan: 01
subsystem: build
tags: [package-json, npm-prepare-hook, dual-publish, git-ref-install, doc-fix]

requires:
  - phase: 04
    provides: post-Phase-4 trainer-sim contract (createFakeTransport + ITrainerTransport + loadFitFromPath/Buffer + FitLoadError + encodeIndoorBikeData) that VW will pin via git-ref.
provides:
  - "`prepare` lifecycle hook in package.json so git-ref consumers (VW pnpm install) materialize dist/ on install."
  - "Corrected repository.url GitHub org (agni21 -> VeloWorld) so npm/pnpm/tooling resolve the right repo."
  - "Wave 0 sha (e2479c9af0fec979b83e0e06d14524d1b98bc32f) recorded in 05-WAVE-0-SHA.txt for Wave 1 to pin."
  - "agni21 -> VeloWorld doc-string fix in 05-CONTEXT.md so downstream plans quote the correct org."
affects: [05-02, 05-03, 05-04, future-VW-PRs-pinning-trainer-sim]

tech-stack:
  added: []
  patterns:
    - "npm `prepare` lifecycle hook for git-ref dist/-materialization (RESEARCH §A8 Pattern 2)."

key-files:
  created:
    - ".planning/phases/05-veloworld-end-to-end-validation/05-WAVE-0-SHA.txt"
    - ".planning/phases/05-veloworld-end-to-end-validation/05-01-SUMMARY.md"
  modified:
    - "package.json"
    - ".planning/phases/05-veloworld-end-to-end-validation/05-CONTEXT.md"

key-decisions:
  - "Followed D-VW-08 one-way-door: contract gap (no prepare hook + gitignored dist/) is fixed in trainer-sim first, sha advances, VW pins next — never widen trainer-sim to absorb a VW shape."
  - "Wave 0 honored D-VW-06 (no CI changes) and D-VW-07 (no src/ or test/ changes) absolutely."
  - "package.json invariants from D-API-08 (version 0.0.1, engines >=24.0, files whitelist, exports map shape, dependencies/devDependencies untouched) preserved verbatim."
  - "05-WAVE-0-SHA.txt committed in a separate docs commit because committing the sha into the build commit is logically impossible (committing changes the sha)."

patterns-established:
  - "Wave 0 contract-gap fix: single in-repo commit + sha capture + push to remote, leaving a fixed reference point for downstream cross-repo PRs."

requirements-completed: [VW-03]

duration: ~10min
completed: 2026-05-18
---

# Phase 05 Plan 01: package.json `prepare` hook + agni21→VeloWorld typo fix

**Wave 0 contract-gap fix landed: trainer-sim's git-ref consumers now receive a built `dist/`, and the GitHub-org typo VW was about to quote is corrected. Wave 0 sha `e2479c9` is reachable on `origin/main` and recorded for Wave 1 to pin.**

## Performance

- **Duration:** ~10 min
- **Tasks:** 3 / 3
- **Files modified:** 2 source-tracked + 1 new docs file
- **Commits:** 2 (build commit + docs sha-record commit)

## Accomplishments
- Added `"prepare": "npm run build"` to `package.json` `scripts` so a fresh `npm install github:VeloWorld/trainer-sim#<sha>` produces `dist/index.{js,cjs,d.ts,d.cts}` for the consumer.
- Corrected `package.json` `repository.url` from `git+https://github.com/agni21/trainer-sim.git` → `git+https://github.com/VeloWorld/trainer-sim.git`.
- Replaced 3 `agni21/trainer-sim` occurrences in `05-CONTEXT.md` (lines 42, 135, 154) with `VeloWorld/trainer-sim`. `PROJECT.md` had no occurrences (verified via grep).
- Smoke-tested via `npm pack` → `npm install ./trainer-sim-0.0.1.tgz` → `import('trainer-sim').createFakeTransport` resolves as a function. All four `dist/index.{js,cjs,d.ts,d.cts}` artifacts present in the consumer's `node_modules/trainer-sim/dist/`.
- Committed and pushed Wave 0 commit `e2479c9af0fec979b83e0e06d14524d1b98bc32f` to `origin/main`.
- Recorded Wave 0 sha in `05-WAVE-0-SHA.txt` (separate docs commit `768d6eb`) for Wave 1 to read.

## Task Commits

1. **Task 1: package.json prepare hook + repo URL fix** — folded into Wave 0 commit
2. **Task 2: agni21 → VeloWorld doc-string fix in 05-CONTEXT.md** — folded into Wave 0 commit
3. **Task 3: smoke-test + Wave 0 commit + sha capture + push** — `e2479c9` (build), `768d6eb` (docs)

```
e2479c9 build(05): add prepare hook for git-ref install + correct repo org
768d6eb docs(05): record Wave 0 sha for VW pinning
```

## Files Created/Modified
- `package.json` — added `prepare` lifecycle hook + corrected repo URL
- `.planning/phases/05-veloworld-end-to-end-validation/05-CONTEXT.md` — 3 occurrences of `agni21/trainer-sim` → `VeloWorld/trainer-sim`
- `.planning/phases/05-veloworld-end-to-end-validation/05-WAVE-0-SHA.txt` — new file, sole content `e2479c9af0fec979b83e0e06d14524d1b98bc32f\n`
- `.planning/phases/05-veloworld-end-to-end-validation/05-01-SUMMARY.md` — this file

## Verification

### Smoke test (sub-step A)
```
$ cd /tmp/trainer-sim-prepare-test
$ npm pack /Users/agniveshpatel/dev/agni21/trainer-sim --pack-destination .
trainer-sim-0.0.1.tgz   (package size: 84.4 kB, total files: 9, sha f1b1059)
$ npm install ./trainer-sim-0.0.1.tgz
added 5 packages, audited 6 packages in 843ms, found 0 vulnerabilities
$ node -e "import('trainer-sim').then(m => console.log(typeof m.createFakeTransport === 'function' ? 'OK' : 'FAIL'))"
OK: createFakeTransport resolves
$ test -f node_modules/trainer-sim/dist/index.{js,cjs,d.ts,d.cts}
OK: all four dual-publish artifacts present
```

### Test suite
```
$ npm test
Test Files  14 passed | 2 skipped (16)
     Tests  115 passed | 2 skipped (117)
  Duration  30.47s
```
Matches Phase 4's 04-VERIFICATION.md baseline (115/2 — no regressions).

### Validate (publint + attw)
```
$ npm run validate
Running publint v0.3.21 for trainer-sim... All good!
@arethetypeswrong/cli — No problems found
node10: 🟢 | node16 (CJS): 🟢 | node16 (ESM): 🟢 | bundler: 🟢
```

### Invariants (D-VW-06 + D-VW-07 + D-API-08)
```
$ git diff HEAD~2 -- src/ test/ .github/workflows/ci.yml
(empty — D-VW-06 + D-VW-07 honored)

$ node -e "const p = require('./package.json'); console.log(p.version, p.engines.node, JSON.stringify(p.files))"
0.0.1 >=24.0 ["dist","README.md","LICENSE.md"]
```

### agni21 sweep
```
$ grep -rln 'agni21/trainer-sim' .planning/PROJECT.md .planning/STATE.md .planning/ROADMAP.md .planning/REQUIREMENTS.md package.json
(no remaining hits in canonical roots — RESEARCH.md/PATTERNS.md mentions are flagging-the-typo quotations, intentionally preserved)
```

## Deviations
**None substantive.** One minor sequencing adjustment: the plan's task-3 acceptance criterion claims `git diff HEAD~1 --name-only` should list 4 files including `05-WAVE-0-SHA.txt`, but the sha file's contents are the sha of the commit it lives in — committing the sha file changes the sha, breaking the file's correctness. Resolved by splitting into two commits: `e2479c9` (build commit, captures the sha-of-record) + `768d6eb` (docs commit, records that sha). The plan's *intent* (sha is captured, on `main`, reachable on origin) is fully satisfied.

## Self-Check: PASSED

- [x] All 3 tasks executed
- [x] `package.json` `scripts.prepare === "npm run build"` and `repository.url === "git+https://github.com/VeloWorld/trainer-sim.git"`
- [x] All package.json invariants (version, engines, files, exports, deps) byte-identical to pre-edit state
- [x] No file under `src/`, `test/`, or `.github/workflows/` modified (D-VW-06 + D-VW-07 honored)
- [x] `npm test` reports 115 passed + 2 skipped (matches Phase 4 baseline)
- [x] `npm run validate` (publint + attw) exits 0
- [x] Tarball smoke test resolves `createFakeTransport` and all 4 dist artifacts present
- [x] Wave 0 commit `e2479c9` pushed to `origin/main`
- [x] `05-WAVE-0-SHA.txt` contains exactly `e2479c9af0fec979b83e0e06d14524d1b98bc32f` (40 chars + newline)
- [x] `grep -c 'agni21/trainer-sim'` is `0` in `PROJECT.md` and `05-CONTEXT.md`

## Next Plan

Plan 05-02: VW local-green prep (cross-repo). Blocked on this plan only by the need for the Wave 0 sha — now reachable as `github:VeloWorld/trainer-sim#e2479c9af0fec979b83e0e06d14524d1b98bc32f`.
