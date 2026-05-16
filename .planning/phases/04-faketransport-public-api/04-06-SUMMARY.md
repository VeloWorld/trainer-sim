---
phase: 04
plan: 06
subsystem: test/publish-hygiene
tags: [test, publint, attw, dual-publish, slow, api-07, api-08]
requires:
  - .planning/phases/04-faketransport-public-api/04-03-SUMMARY.md  # public exports landed
  - .planning/phases/04-faketransport-public-api/04-04-SUMMARY.md  # records source path
  - .planning/phases/04-faketransport-public-api/04-05-SUMMARY.md  # path/buffer source + echo-only
provides:
  - "Build + publint + attw smoke test against the dual-published dist/"
  - "Structural pin on package.json exports map (D-API-08 invariant)"
  - "Structural pin on tsup.config.ts single-entry build (D-API-08 invariant)"
affects:
  - "test/transport/publish.test.ts (new — 152 LOC)"
tech-stack:
  added: []
  patterns:
    - "child_process.execSync shell-out to npm run scripts (Pattern TPB3 — first such test in repo)"
    - "stdio: 'pipe' to keep npm output off the test reporter (T-04-06-05 mitigation)"
    - "{ timeout: 60_000 } per-test override on build + attw (T-04-06-03 mitigation)"
    - "[slow] title-suffix convention because Vitest 4.1.x has no describe.slow / test.slow API"
key-files:
  created:
    - test/transport/publish.test.ts
  modified: []
decisions:
  - "Use the [slow] describe-title suffix instead of a Vitest API marker (Vitest 4.1.x exposes no describe.slow / test.slow). The convention is documentation-only; per-test { timeout: 60_000 } overrides handle the actual timeout concern. JSDoc preamble cites this absence so a future Vitest 5+ migration can swap to the real API."
  - "Run `npm run build` from inside the test (not as a beforeAll) — keeps each test independently debuggable and makes Test 1's existsSync assertions a defense-in-depth check that the build emits all four artifacts."
  - "Assert against built artifact text (dist/index.js contains 'createFakeTransport'; dist/index.d.ts contains 'ITrainerTransport') in addition to publint+attw — provides a fast structural guard before the slower validators run."
metrics:
  duration_minutes: 1
  task_count: 1
  file_count: 1
  completed: 2026-05-16
---

# Phase 4 Plan 06: Publish Hygiene Smoke Test Summary

Build + publint + attw shell-out test (`test/transport/publish.test.ts`) that locks the D-API-07 public surface and the D-API-08 unchanged-publish-config invariant against the built `dist/`.

## What was built

Single new test file: **`test/transport/publish.test.ts`** (152 LOC, 5 tests under one `describe`).

The test runs against the dual-published `dist/` artifacts (regenerated in Test 1 via `npm run build`) and asserts:

1. **`npm run build` succeeds** and emits all four expected artifacts: `dist/index.js`, `dist/index.cjs`, `dist/index.d.ts`, `dist/index.d.cts`. (60s per-test timeout — defeats Vitest's default 5s.)
2. **Built artifacts contain the Phase 4 public surface** — `createFakeTransport` appears in both `dist/index.js` and `dist/index.cjs`; `ITrainerTransport`, `FakeTransportConfig`, and `FakeTransportSource` appear in both `dist/index.d.ts` and `dist/index.d.cts`.
3. **`npm run validate:publint` exits 0** — pins the publint rules (types-first conditional, default-last conditional, no missing exports).
4. **`npm run validate:attw` exits 0** (API-08) — all six resolution modes green: `node10`, `node16` from CJS, `node16` from ESM, `bundler`, ESM consumer, CJS consumer.
5. **`package.json` and `tsup.config.ts` shape pinned** (D-API-08 invariant) — `pkg.exports['.']` has the dual-publish form with `import.types` and `require.types` first; `pkg.engines.node === '>=24.0'`; `pkg.files === ['dist','README.md','LICENSE.md']`; `tsup.config.ts` contains `entry: ['src/index.ts']`, `format: ['esm', 'cjs']`, and `dts: true`.

## Verification

Both ran from the worktree:

| Step | Command | Result |
|------|---------|--------|
| Type-check tests | `npm run typecheck:test` | exit 0 |
| Run new file in isolation | `npm test -- test/transport/publish.test.ts` | **5/5 passing in 1.83s** (vitest 4.1.6) |
| Standalone validate chain | `npm run validate` | build OK; `publint` "All good!"; `attw` "No problems found 🌟" with all 6 resolution modes 🟢 |

## Test runtime

The test ran in **~1.83s** end-to-end on this machine (the build step is ~0.5s on warm cache). The plan budgeted up to 30s; actual is well under. The 60s per-test timeouts on Tests 1 and 4 remain as headroom for slower CI machines.

## Deviations from Plan

**None.** Plan executed exactly as written.

The plan specifically called out a Vitest-API uncertainty around `describe.slow` / `test.slow`:

> **Read the vitest 4 API for the actual slow-marker syntax during execution; if `test.slow` / `describe.slow` does not exist, document the absence in the file's JSDoc preamble + use the `[slow]` suffix convention.**

I confirmed via grep against `node_modules/vitest/dist/*.d.ts` and `node_modules/@vitest/runner/dist/*.d.ts` that no `slow` API exists in 4.1.6. The implementation follows the plan's documented fallback (title suffix + JSDoc note + per-test `{ timeout: 60_000 }`). This is plan-mandated behavior, not a deviation.

## Threat Model Compliance

| Threat ID | Disposition | Status | How |
|-----------|-------------|--------|-----|
| T-04-06-01 (exports map regression) | mitigate | applied | publint + attw + structural exports-map assertion in Test 5 |
| T-04-06-02 (BLE type leak via attw) | mitigate | applied | attw run in Test 4; defense-in-depth alongside Plan 04-03's grep guard |
| T-04-06-03 (Vitest 5s timeout fires on build) | mitigate | applied | `{ timeout: 60_000 }` on Tests 1 + 4 |
| T-04-06-04 (slow test bloats local iteration) | accept | accepted | `[slow]` suffix + JSDoc note pointing to `--exclude` workaround |
| T-04-06-05 (npm output leaks into test stream) | mitigate | applied | `stdio: 'pipe'` in `runScript` helper with WHY-non-obvious comment |
| T-04-06-06 (multi-entry tsup breaks single-rooted exports) | mitigate | applied | Test 5 asserts `entry: ['src/index.ts']` literal in tsup.config.ts |

## D-API-08 Invariant — Verified

`package.json` and `tsup.config.ts` were **NOT** modified in Phase 4. Confirmed by:

```bash
git diff main..HEAD -- package.json tsup.config.ts
# (empty)
```

The single-rooted exports map (`"."` only — no `./bleno`) and the single-entry tsup config (`entry: ['src/index.ts']`) are intact. Test 5 inside `publish.test.ts` makes this a CI-enforced invariant going forward; future plans that change either file must update this test in the same commit.

## Phase 4 Closing Checklist

- [x] **API-01..06** covered by Plan 04-04 (records source) + Plan 04-05 (path/buffer + FitLoadError bubble + echo-only sendResistance)
- [x] **API-07** + **API-08** covered by Plan 04-06 (this plan) — publint + attw against the built artifact
- [x] **HIGH-severity threat T-04-03-01** (BLE type leak) mitigated by Plan 04-03's grep + defense-in-depth from this plan's `attw` run
- [x] **Phase 3 followups folded:** WR-05 closed in Plan 04-03 (factory validation gate); IN-01 closed in Plan 04-01 (`fakeAwareSleep` lift)
- [x] **Phase 3 followups NOT addressed (per scope):** WR-02 (`Replay.currentState` async transition docstring), WR-04 (config "frozen" claim without `Object.freeze`)
- [x] **Phase 2 followups NOT addressed (per scope per D-API-26):** WR-01 (signed-shift on dataLength for ≥2GB files), WR-03 (records lacking timestamp silently dropped), WR-05 (CRC-16/ARC table duplicated)

**Phase 4 is done.** All Phase 4 requirements (API-01..08) are satisfied; Phase 4-internal threats are mitigated; declared out-of-scope items are explicitly carried forward.

## Commits

| Task | Commit | Message |
|------|--------|---------|
| 1    | `bd6bb90` | `test(04-06): add publish hygiene smoke test (publint + attw against built dist)` |

## Self-Check: PASSED

- File exists: `test/transport/publish.test.ts` — FOUND
- Commit exists: `bd6bb90` — FOUND
- Validate chain GREEN standalone: `npm run validate` — passes (publint "All good!", attw "No problems found 🌟", all 6 resolution modes 🟢)
- D-API-08 invariant: `package.json` and `tsup.config.ts` show zero diff vs. before Phase 4 — confirmed
