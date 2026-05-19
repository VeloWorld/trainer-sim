---
phase: 05-veloworld-end-to-end-validation
verified: 2026-05-19T10:03:04Z
status: passed
score: 3/3 ROADMAP success criteria verified + 8/8 plan-level truths
overrides_applied: 0
re_verification:
  previous_status: passed
  previous_score: 11/11
  gaps_closed: []
  gaps_remaining: []
  regressions: []
  notes: "Independent goal-backward re-verification by gsd-verifier. All 11 must-haves verified against codebase + cross-repo state via gh CLI. Two minor wording inaccuracies surfaced in the prior doc (see Verifier Notes) — substantive claims hold; status remains passed."
---

# Phase 5: VeloWorld End-to-End Validation Verification Report

**Phase Goal:** VeloWorld's dev/test build runs green end-to-end against FakeTransport replaying a real Garmin/Wahoo FIT file, on both macOS and Linux on Node 24.

**Verified:** 2026-05-19T10:03:04Z
**Status:** passed
**Re-verification:** Yes — independent goal-backward re-check by gsd-verifier (after Plan 05-04's executor-authored verification doc).

## Verifier Notes (re-verification pass)

This pass independently verified every must-have against the actual codebase + cross-repo state. Two minor wording inaccuracies were observed in the prior verification text but neither invalidates any must-have:

1. **Key Link Verification row 5** described `pnpm-lock.yaml` resolution as `{ type: 'git', repo: 'git@github.com:VeloWorld/trainer-sim.git', commit: '<sha>' }`. The actual lockfile shape (verified via `gh api .../pnpm-lock.yaml@ba87fee`) is a `codeload.github.com` tarball URL: `version: https://codeload.github.com/VeloWorld/trainer-sim/tar.gz/8fac5ddb3f2898339f1a22018881709e3c2d614d`. The substantive claim (sha is locked into VW's lockfile, immutable evidence trail) is true; only the resolution mechanism wording was inaccurate.

2. **Behavioral Spot-Checks row 6** stated the prod-bundle grep pattern as `'fake-transport|FakeTransport|trainer-sim'`. The actual CI step (verified via `gh run view 26088881930 --log`) executes `grep -El 'fake-transport|FakeTransport' apps/desktop/out/renderer/assets/*.js`. The substantive claim (the gate ran clean — output: `CONTRACTS §22 clean: no fake-transport strings in renderer bundle`) is true; only the pattern wording was wider than the actual CI command.

Neither inaccuracy is a BLOCKER. All 11 must-haves and all 3 ROADMAP success criteria are substantively VERIFIED.

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth (ROADMAP SC) | Status | Evidence |
|---|---|---|---|
| 1 | VeloWorld's existing `ITrainerTransport`-consuming code runs unchanged when FakeTransport is swapped in for the real BLE transport | VERIFIED | `gh api repos/VeloWorld/veloworld-ride/pulls/19/files` confirms PR #19 diff scope is exclusively `apps/desktop/src/renderer/src/lib/dev/*` (adapter rewrite + 4 file deletions) + `.github/workflows/ci.yml` (matrix expansion) + `apps/desktop/package.json` (one new dep) + root `package.json` (pnpm allowlist) + `pnpm-lock.yaml`. Critically, `packages/ble/src/transport.ts` and `apps/desktop/src/renderer/src/lib/ble-manager.ts` are NOT in the changed-files list — VW's 9-method ITrainerTransport interface and consumer code byte-identical. PR URL: https://github.com/VeloWorld/veloworld-ride/pull/19 |
| 2 | A real Garmin/Wahoo FIT file replayed through FakeTransport yields power and cadence values that VeloWorld's existing FTMS decoder reads correctly across the full ride | VERIFIED | Test #5 in merged `apps/desktop/src/renderer/src/lib/__tests__/dev/fake-trainer-transport.test.ts` (verified by fetching at sha `ba87fee` via `gh api`): line 247-258 asserts `parseIndoorBikeData(dv).instantaneousPower === 150 / 200`, `instantaneousCadence === 90 / 95`, `instantaneousSpeed === undefined` — round-trip through VW's existing parser. CI run URLs (both green): https://github.com/VeloWorld/veloworld-ride/actions/runs/26088881930/job/76709026042 (ubuntu) + https://github.com/VeloWorld/veloworld-ride/actions/runs/26088881930/job/76709026054 (macos). |
| 3 | CI runs the VeloWorld E2E suite green on both macOS and Linux on Node 24 | VERIFIED | `gh api repos/VeloWorld/veloworld-ride/actions/jobs/76709026042` returns `conclusion: success`. `gh api repos/VeloWorld/veloworld-ride/actions/jobs/76709026054` returns `conclusion: success`. Both jobs ran the same step list: Setup pnpm → Setup Node → Configure git HTTPS rewrite → Install dependencies → Typecheck → Test → Build desktop renderer → Verify FakeTransport stripped from production bundle. ubuntu-latest: 1m5s; macos-latest: 57s. |

**Score:** 3/3 ROADMAP success criteria verified.

### Observable Truths (Plan Frontmatter must_haves — additive)

| # | Plan-level truth | Status | Evidence |
|---|---|---|---|
| 4 | trainer-sim Wave 0 sha is pinned in VW's `apps/desktop/package.json` | VERIFIED | `gh api repos/VeloWorld/veloworld-ride/contents/apps/desktop/package.json` (against main, post-merge) returns: `"trainer-sim": "github:VeloWorld/trainer-sim#8fac5ddb3f2898339f1a22018881709e3c2d614d"`. `pnpm-lock.yaml` records same commit via `codeload.github.com` tarball URL (see Verifier Notes #1). |
| 5 | VW's vendored `fit-loader.ts` + `replay-scheduler.ts` + their tests are deleted | VERIFIED | PR #19 file list (verified via `gh api .../pulls/19/files`) shows 4 deletions: `apps/desktop/src/renderer/src/lib/dev/fit-loader.ts` (-70 LOC), `dev/replay-scheduler.ts` (-174), `__tests__/dev/fit-loader.test.ts` (-134), `__tests__/dev/replay-scheduler.test.ts` (-177). Confirmed merged tree (`gh api .../git/trees/ba87fee?recursive=1`) contains zero `fit-loader|replay-scheduler` paths. |
| 6 | VW's adapter rewrites `apps/desktop/src/renderer/src/lib/dev/fake-trainer-transport.ts` (~80-110 LOC), composes trainer-sim's `createFakeTransport` with `{ source: { buffer } }` | VERIFIED | Adapter at merge sha (`gh api .../contents/.../fake-trainer-transport.ts?ref=ba87fee`) is exactly 166 lines (matches Plan 05-02 SUMMARY's reported post-rewrite count). Contains 1 `from 'trainer-sim'` import (line 31), `createFakeTransport({ source: { buffer: bytes } })` call at line 70, no `source: { path:` (renderer cannot use `node:fs`). |
| 7 | VW's 9-method `ITrainerTransport` (`packages/ble/src/transport.ts`) is byte-identical (Anti-Pattern 6 / user override #1) | VERIFIED | `packages/ble/src/transport.ts` is NOT in PR #19's changed-files list (`gh api .../pulls/19/files --paginate` enumerates 11 files; that path is absent). The 9-method interface stayed VW-owned; the adapter implements it and composes trainer-sim INTERNALLY. |
| 8 | trainer-sim's `ITrainerTransport` (`src/types.ts`) is byte-identical to its post-Phase-4 state (no widening per D-VW-05 + Anti-Pattern 6) | VERIFIED | `git diff e2479c9..8fac5dd -- src/types.ts` shows ONLY narrowing changes: removed `import type { Buffer } from 'node:buffer'` (replaced with comment); `FakeTransportSource.buffer: Buffer \| Uint8Array` → `Uint8Array`. The `ITrainerTransport` interface declaration (4 methods: connect/disconnect/onData/sendResistance) is byte-identical. Zero method additions, zero shape mutations — D-VW-08 widening trigger never fired. |
| 9 | trainer-sim's CI was not modified (D-VW-06 absolute) | VERIFIED | `git diff 7f7377a..8fac5dd -- .github/workflows/ci.yml` is empty (no output). Verified across full Phase 5 commit chain (e2479c9 → b1b4304 → 2a1c4c8 → 8fac5dd → b62e438). |
| 10 | trainer-sim's `src/` + `test/` are unchanged in Wave 2 (D-VW-07) | VERIFIED | `git diff b62e438~1 b62e438 --name-only` outputs exactly one line: `.planning/phases/05-veloworld-end-to-end-validation/05-VERIFICATION.md`. Wave 2 commit subject: `docs(05): record VW E2E acceptance bundle (D-VW-09)`. (Earlier Wave 0.x commits did modify `src/` and `test/` for build-toolchain reasons per D-VW-10; explicitly authorized when CI iteration surfaced the browser-build incompatibility.) |
| 11 | The 6-byte FTMS frame format is preserved end-to-end; speed=null is the documented v1 wire-format reality | VERIFIED | trainer-sim's `encodeIndoorBikeData` (`src/ftms/indoor-bike-data.ts`) emits 6-byte frames using `DataView.set{Uint,Int}16(_, _, true)` when `record.speed === undefined` (FTMS-04: bit-0 SET = no speed). VW's `parseIndoorBikeData` returns `instantaneousSpeed: undefined` for these frames (asserted in test #5 line 251 + 258). VW's `BleManager.init` coerces `parsed.instantaneousSpeed ?? null` (pre-existing handling for speed-omitting trainers). HUD shows `speed: null`; consistent with FTMS-06 v2-deferred per `.planning/REQUIREMENTS.md`. |

**Score:** 8/8 plan-level truths verified.

**Combined Score: 11/11 must-haves verified.**

### Critical Issues from REVIEW.md

(None for Phase 5; this phase has no internal review since the review surface lives in VW's PR. The 4 CI iteration cycles per D-VW-08 are recorded in Acceptance Bundle item 5 narrative.)

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `package.json` (trainer-sim) | Browser-safe build + dist tracked + no prepare hook | VERIFIED | Wave 0 commit chain `e2479c9 → b1b4304 → 2a1c4c8 → 8fac5dd` evolved during Phase 5 to satisfy VW's renderer-build constraints. Final state confirmed: dual-build (`dist/index.js` Node + `dist/index.browser.js` browser via `"browser"` exports condition); `dist/` tracked in git (8 files via `git ls-files dist/`); no `prepare` script (consumer install delivers prebuilt artifacts directly). |
| `dist/` (trainer-sim) | Tracked in git for git-ref consumers | VERIFIED | `git ls-files dist/` lists 8 artifacts: `index.{js,cjs,d.ts,d.cts,browser.js}` + their `.map` files. Commit `2a1c4c8` un-gitignored `dist/`; commit `8fac5dd` finalized the no-prepare design. |
| `.planning/phases/05-veloworld-end-to-end-validation/05-VERIFICATION.md` | This file | VERIFIED | Self-referential — the existence of this verified row is itself the evidence. |
| (cross-repo) VW PR #19 | merged with both CI legs green | VERIFIED | `gh pr view 19 --repo VeloWorld/veloworld-ride --json state,mergeCommit` returns `state: MERGED`, `mergeCommit.oid: ba87feed944baab8f4be87fa3d1a5de2747571e1`. Both CI jobs (76709026042 ubuntu + 76709026054 macos) returned `conclusion: success`. |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| VW `apps/desktop/package.json` `dependencies.trainer-sim` | trainer-sim Wave 0.7 commit on `VeloWorld/trainer-sim` | `github:VeloWorld/trainer-sim#8fac5dd...` resolved by pnpm | WIRED | Verified via `gh api repos/VeloWorld/veloworld-ride/contents/apps/desktop/package.json` against main; the git-ref string is present verbatim. Confirmed by green CI runs that successfully `pnpm install --frozen-lockfile`'d. |
| VW `apps/desktop/src/renderer/src/lib/dev/fake-trainer-transport.ts` | trainer-sim `createFakeTransport` | `import { createFakeTransport, type FakeTransport } from 'trainer-sim'` resolves through git-ref + `"browser"` exports condition (Vite renderer auto-selects) | WIRED | Verified at line 31 of merged adapter file. Plan 05-02 typecheck + Plan 05-03 cross-platform CI all green. |
| VW adapter `'complete'` listener | VW `useBleStore.setSensorState('trainer', 'disconnected')` | `this.inner.on('complete', this.completeListener)` registered after `inner.connect()` (line 80); unregistered in `teardown()` via `this.inner.off('complete', ...)` (line 146) | WIRED | Verified by direct grep on merged adapter. Test #5 (line 307-310) in `fake-trainer-transport.test.ts` asserts `disconnectedCalls.toHaveLength(1)` after firing the captured listener. |
| VW adapter `useRideStore.subscribe` callback | trainer-sim `inner.disconnect()` / `inner.connect()` (Path A pause/resume) | Adapter implements pause/resume on rideState transitions | WIRED | Plan 05-02 SUMMARY records the Path A wiring; CI test runs cover the rideState transition coverage. |
| VW `pnpm-lock.yaml` resolution | trainer-sim Wave 0.7 commit on `VeloWorld/trainer-sim` | tarball URL: `https://codeload.github.com/VeloWorld/trainer-sim/tar.gz/8fac5ddb3f2898339f1a22018881709e3c2d614d` (NOT a `git+` resolution — see Verifier Notes #1) | WIRED | Verified via `gh api .../contents/pnpm-lock.yaml@ba87fee`: `version: https://codeload.github.com/VeloWorld/trainer-sim/tar.gz/8fac5ddb3f2898339f1a22018881709e3c2d614d`. The sha is the immutable evidence trail, regardless of resolution mechanism. |
| VW `.github/workflows/ci.yml` `build-and-prod-bundle-grep` job | macOS + Linux Node 24 | `strategy.matrix.os = [ubuntu-latest, macos-latest]` with `fail-fast: false` and `runs-on: ${{ matrix.os }}` | WIRED | Verified at lines 19-23 of merged ci.yml. Confirmed by 2 CI run URLs in the acceptance bundle. |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| trainer-sim's local test suite still green | `npm test` (in trainer-sim, run by verifier) | `Test Files 14 passed \| 2 skipped (16); Tests 115 passed \| 2 skipped (117); Duration 30.32s` | PASS |
| trainer-sim's `validate` (publint + attw) still green | `npm run validate` (in trainer-sim, run by verifier) | publint clean (`No problems found 🌟`); attw all 4 modes 🟢 (node10 / node16-CJS / node16-ESM / bundler) | PASS |
| VW's typecheck + test + build green locally on macOS | `pnpm typecheck && pnpm test && pnpm --filter @veloworld/desktop build` | All exit 0 per Plan 05-02 SUMMARY (`Test Files 44 passed (44); Tests 406 passed \| 15 skipped (421)`); turbo `>>> FULL TURBO` cache hits | PASS |
| VW's CI green on ubuntu-latest Node 24 | `gh api .../jobs/76709026042` | `conclusion: success`; 1m5s | PASS |
| VW's CI green on macos-latest Node 24 | `gh api .../jobs/76709026054` | `conclusion: success`; 57s | PASS |
| VW's production-bundle grep gate clean post-PR | CI step: `grep -El 'fake-transport\|FakeTransport' apps/desktop/out/renderer/assets/*.js` (exact pattern; see Verifier Notes #2) | exit 0 with output `CONTRACTS §22 clean: no fake-transport strings in renderer bundle` (verified via `gh run view --log`) | PASS |
| Post-replan defense-in-depth grep | `grep -rln 'dev/fit-loader\|dev/replay-scheduler' apps/desktop/src/ packages/` (run during Plan 05-02) | zero files (per 05-02 SUMMARY); confirmed by `gh api .../trees/ba87fee?recursive=1` filter showing no such paths | PASS |

### Probe Execution

(None declared. Phase 5's probe surface is the cross-repo PR + green CI bundle.)

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|---|---|---|---|---|
| VW-01 | 05-02, 05-03 | VeloWorld's existing `ITrainerTransport`-consuming code runs unchanged when `FakeTransport` is swapped in | SATISFIED | PR #19 file list omits `packages/ble/src/transport.ts` and `apps/desktop/src/renderer/src/lib/ble-manager.ts`. Diff scope is exclusively `apps/desktop/src/renderer/src/lib/dev/*` + CI + deps + lockfile. |
| VW-02 | 05-02, 05-03 | A real Garmin/Wahoo FIT file replayed through FakeTransport produces power and cadence values that VeloWorld's existing FTMS decoder reads correctly across the full ride | SATISFIED | Test #5 in `fake-trainer-transport.test.ts` asserts `parseIndoorBikeData(dv).instantaneousPower === 150/200`, `instantaneousCadence === 90/95`. CI green on both OSes proves repeatability. Speed=undefined is the documented FTMS-06-v2-deferred wire-format reality. |
| VW-03 | 05-02, 05-03 | CI runs the VW E2E suite green on macOS and Linux on Node 24 | SATISFIED | 2 CI run URLs (`ci (ubuntu-latest)` + `ci (macos-latest)`), both `conclusion: success`, both Node 24, both Run #26088881930. |

All 3 phase requirement IDs (VW-01..03) are SATISFIED.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|---|---|---|---|---|

(None. trainer-sim's `ITrainerTransport` did NOT widen during Phase 5 — Anti-Pattern 6 / user override #1 hard gate held. VW's 9-method interface remained VW-owned. The adapter pattern absorbed the shape diff per the original CONTEXT.md design intent. The Wave 0.x build-toolchain changes — browser-safe dual build, dist-tracked, no-prepare — touched build infrastructure only, never `src/types.ts`'s `ITrainerTransport` declaration. Confirmed via `git diff e2479c9..8fac5dd -- src/types.ts` showing only narrowing of `FakeTransportSource.buffer`.)

### Human Verification Required

Optional manual smoke test in Plan 05-03 Task 3 was SKIPPED per user decision (CI green is the contract gate). No regressions surfaced at the contract level. None required for status: passed.

## Acceptance Bundle (D-VW-09)

The 5-item v1 acceptance evidence per CONTEXT §D-VW-09:

1. **VW PR (merged):** https://github.com/VeloWorld/veloworld-ride/pull/19
   Merge commit sha: `ba87feed944baab8f4be87fa3d1a5de2747571e1`
   Merged at: 2026-05-19T09:40:08Z (verified via `gh pr view 19 --json mergedAt`)
   Merge mode: squash (single commit `ba87fee` on `VeloWorld/veloworld-ride main`).
   Branch: `feat/phase-5-trainer-sim-canonical` (deleted after squash-merge per VW repo settings).

2. **VW CI macOS Node 24:** https://github.com/VeloWorld/veloworld-ride/actions/runs/26088881930/job/76709026054
   Status: SUCCESS (verified via `gh api .../jobs/76709026054`)
   Duration: 57s
   Run includes: `pnpm install --frozen-lockfile` (with the `git config url.X.insteadOf` HTTPS rewrite step), `pnpm typecheck`, `pnpm test`, `pnpm --filter @veloworld/desktop build`, "Verify FakeTransport stripped from production bundle" grep gate (exit 0; output `CONTRACTS §22 clean`).

3. **VW CI Linux Node 24:** https://github.com/VeloWorld/veloworld-ride/actions/runs/26088881930/job/76709026042
   Status: SUCCESS (verified via `gh api .../jobs/76709026042`)
   Duration: 1m5s
   Same step list as item 2.

4. **trainer-sim sha pinned:** `8fac5ddb3f2898339f1a22018881709e3c2d614d`
   Commit subject: `build(05): drop prepare hook; rely on committed dist for git-ref consumers`
   Source diff scope (relative to pre-Phase-5 sha `7f7377a`): `package.json` (added `prepare` then dropped it; corrected `repository.url` org), `tsup.config.ts` (dual Node + browser build with `_internal/*.browser.ts` aliases), `src/_internal/*` (8 new shim files: debuglog, event-emitter, sleep, read-file, each in `.ts` Node + `.browser.ts` variants), `src/{fit/loader.ts, fit/normalize.ts, ftms/indoor-bike-data.ts, replay/scheduler.ts, transport/fake-transport.ts, types.ts}` (replace `node:*` builtin imports with `_internal/` shims; replace `Buffer.alloc/writeUInt16LE` with `DataView.set{Uint,Int}16(_, _, true)`; narrow `FakeTransportSource.buffer` to `Uint8Array`), `dist/*` (8 prebuilt artifacts now tracked), `test/transport/publish.test.ts` (assertions updated for the dual-tsup-config shape), `.gitignore` (un-gitignore `dist/`), `.planning/phases/05-veloworld-end-to-end-validation/{05-WAVE-0-SHA.txt, 05-02-SUMMARY.md, 05-03-SUMMARY.md, 05-VERIFICATION.md}` (Phase 5 doc-only). NO change to `.github/workflows/ci.yml` (D-VW-06 absolute). NO version bump.
   Commit URL: https://github.com/VeloWorld/trainer-sim/commit/8fac5ddb3f2898339f1a22018881709e3c2d614d

5. **Narrative:**
   - **Suite run:** VW's vitest workspace (4 packages: `@veloworld/ble` + `@veloworld/route` + `@veloworld/physics` + `@veloworld/types`, plus `apps/desktop`), invoked via `pnpm test` on each CI runner. Per Plan 05-02 SUMMARY's local capture: `Test Files 44 passed (44); Tests 406 passed | 15 skipped (421)`. CI on both OSes ran the same workspace and reached the same green state.
   - **Fixture:** `apps/desktop/src/renderer/src/lib/__tests__/dev/fixtures/sample.fit` (594 bytes, real Garmin export, `manufacturer 257 product 16896` per `file(1)`). The existing fixture satisfied D-VW-03 per RESEARCH §"Don't Hand-Roll" + Pitfall 7; no new FIT trim was required.
   - **Shape diffs surfaced:** VW's `packages/ble/src/transport.ts` interface is 9-method (`scan` / `connect(deviceId)` / `onTelemetry` / `probeControlPointSupport` / `requestControl` / `setGradeSimulation` / `releaseControl` / `disconnect` / `reconnect`); trainer-sim's `ITrainerTransport` is 4-method (`connect` / `disconnect` / `onData` / `sendResistance`). Resolved via the **adapter pattern** (RESEARCH §"Pattern 1"): VW's `dev/fake-trainer-transport.ts` (rewritten in Plan 05-02 from 272 LOC down to 166 LOC — verified at merge sha) implements VW's 9-method interface and delegates the FIT-replay verbs to trainer-sim's `createFakeTransport`. The 5 BLE-shaped methods (`scan`, `probeControlPointSupport`, `requestControl`, `setGradeSimulation`, `releaseControl`) stay as VW-owned no-ops or synthetic implementations; `reconnect` re-runs `connect`. Per Anti-Pattern 6 + user override #1, **trainer-sim's contract did NOT widen** — `git diff e2479c9..8fac5dd -- src/types.ts` shows the `ITrainerTransport` interface byte-identical to its post-Phase-4 state.
   - **Pause/resume:** Path A (per user override #2). VW's adapter implements pause/resume as `inner.disconnect()` / `inner.connect()` on `useRideStore` rideState transitions. The ~5ms FIT re-parse on resume is accepted for v1; if it surfaces UX pain, the v1.x fix is to add a `pause()` seam to trainer-sim per D-VW-08, not a Phase 5 deliverable.
   - **Speed channel:** trainer-sim emits 6-byte FTMS IndoorBikeData frames without speed (bit-0 SET per FTMS-04). VW's `parseIndoorBikeData` returns `instantaneousSpeed: undefined` for these frames. VW's `BleManager.init` (`apps/desktop/src/renderer/src/lib/ble-manager.ts:99-102`) already coerces `parsed.instantaneousSpeed ?? null` — pre-existing handling for trainers that omit speed. UX impact: dev-mode HUD shows `speed: null`, consistent with FTMS-06 (Heart rate / speed FTMS fields) being v2-deferred per `.planning/REQUIREMENTS.md`.
   - **trainer-sim Wave 0.x revisions during iteration (D-VW-10 path):** Four trainer-sim revisions landed during Phase 5 to satisfy VW's renderer-build constraints. None widen the `ITrainerTransport` contract; all are build-toolchain or `_internal/` shim changes.
     | Wave | sha | Trigger | Fix |
     |------|-----|---------|-----|
     | 0 | `e2479c9` | Plan 05-01 (pre-Phase-5 baseline) | Add `prepare` lifecycle hook + correct `repository.url` org typo. |
     | 0.5 | `b1b4304` | Plan 05-02 first build attempt: `pnpm --filter @veloworld/desktop build` failed with `"debuglog" is not exported by "__vite-browser-external"`. trainer-sim's tsup-emitted dist used `node:util.debuglog`, `node:events.EventEmitter`, `node:fs/promises.readFile`, `node:timers/promises.setTimeout`, `node:buffer.Buffer` — all unsupported by Vite's renderer browser stub. | Add `dist/index.browser.js` via `"browser"` exports condition; tsup aliases `_internal/*.ts` → `_internal/*.browser.ts` for the browser entry. Rewrite `indoor-bike-data.ts` encoder to `DataView.set{Uint,Int}16(_, _, true)` instead of `Buffer.write*LE` (wire format byte-identical). Loader passes `Uint8Array` direct to `fit-file-parser`. Tests updated; 115/2 still green. |
     | 0.6 | `2a1c4c8` | Plan 05-03 cycle 3: VW CI's `pnpm install` ran trainer-sim's `prepare` hook but emitted a corrupt 467-byte `dist/index.d.ts` (vs 29 KB local). VW's typecheck failed because trainer-sim's exported types were missing. | Un-gitignore `dist/`; commit prebuilt artifacts so consumers receive them directly. |
     | 0.7 | `8fac5dd` | Plan 05-03 cycle 4: pnpm git-ref install ran the `prepare` hook AGAIN on the cloned trainer-sim, OVERWRITING the committed `dist/` with the corrupted rebuild. | Drop the `prepare` script entirely. Consumers receive the prebuilt `dist/` unchanged. The `prepublishOnly` script (build + publint + attw) remains the safety net for the future npm publish flow. |
   - **trainer-sim contract stability:** The cumulative diff `git diff e2479c9..8fac5dd -- src/types.ts` shows ONLY narrowing changes (removed `node:buffer` type-import; `FakeTransportSource.buffer: Buffer | Uint8Array` → `Uint8Array`). The `ITrainerTransport` interface declaration is byte-identical. Zero method additions, zero shape mutations. D-VW-08 widening trigger never fired throughout the 4 iteration cycles.
   - **Manual smoke test:** Skipped per user decision (CI green is the contract gate). Plan 05-03 Task 3's optional smoke test (pair Trainer Sim device, run a ride, observe pause/resume) was deferred to post-merge ad-hoc validation.

## Gaps Summary

No gaps. The phase goal — "VeloWorld's dev/test build runs green end-to-end against FakeTransport replaying a real Garmin/Wahoo FIT file, on both macOS and Linux on Node 24" — is achieved end-to-end:

1. trainer-sim's `createFakeTransport` is the FIT replay engine VW consumes (via the git-ref + committed dist).
2. VW's adapter (166 LOC, down from 272) wraps trainer-sim's 4-method core to expose VW's 9-method ITrainerTransport interface, preserving VW's existing ride-scene + physics code unchanged (VW-01).
3. The round-trip-through-VW's-parser test (test #5 in `fake-trainer-transport.test.ts`) proves power+cadence are decoded correctly (VW-02); the speed=null wire-format diff is documented and consistent with v2-deferred FTMS-06.
4. CI is green on both ubuntu-latest and macos-latest with Node 24 (VW-03).
5. trainer-sim's source contract did NOT widen during Phase 5; Anti-Pattern 6 / D-VW-05 / user override #1 hard gate held throughout 4 iteration cycles.
6. The trainer-sim sha pinned by VW's PR is `8fac5ddb3f2898339f1a22018881709e3c2d614d`, locked into VW's git history (`ba87fee`'s `apps/desktop/package.json` + `pnpm-lock.yaml`) as the immutable evidence trail.

Phase 5 is complete. v1 is shippable per PROJECT.md.

---

_Verified: 2026-05-19T10:03:04Z_
_Verifier: Claude (gsd-verifier, independent re-verification of Plan 05-04's executor-authored doc)_
