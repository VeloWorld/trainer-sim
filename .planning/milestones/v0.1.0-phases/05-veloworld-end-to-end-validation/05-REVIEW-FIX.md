---
phase: 05-veloworld-end-to-end-validation
fixed_at: 2026-05-19T00:00:00Z
review_path: .planning/phases/05-veloworld-end-to-end-validation/05-REVIEW.md
iteration: 1
findings_in_scope: 5
fixed: 5
skipped: 0
status: all_fixed
---

# Phase 5: Code Review Fix Report

**Fixed at:** 2026-05-19
**Source review:** `.planning/phases/05-veloworld-end-to-end-validation/05-REVIEW.md`
**Iteration:** 1

**Summary:**
- Findings in scope: 5 (Critical: 0, Warning: 5; Info: 6 deferred to scope `all`)
- Fixed: 5
- Skipped: 0
- Test baseline: 115 passed / 2 skipped → 132 passed / 2 skipped (+17 regression tests)

All five WARNING-class findings were fixed atomically on a dedicated
`gsd-reviewfix/05-*` worktree branch and then fast-forwarded onto `main`.
Each fix preserves the existing test baseline and adds regression coverage
for the contract it restores.

## Fixed Issues

### WR-01: DataView migration silently lost sint16 range-check on `power`

**Files modified:** `src/ftms/indoor-bike-data.ts`, `test/ftms/indoor-bike-data.test.ts`, `dist/`
**Commit:** `f800306`
**Applied fix:** Added `assertInt16` and `assertUint16` guards inside
`encodeIndoorBikeData`, gating each `view.set{Int,Uint}16(_, _, true)`
write. The guards re-establish the throw-on-overflow contract that
`Buffer.write{Int,Uint}16LE` provided before the Phase 5 DataView
migration. Errors include the offending field name (`power`,
`cadence`, `speed`) and the legal range so a caller hitting the
guard can debug without inspecting bytes. Updated PITFALLS.md §2 file-
header comment to reflect the new path. Added a 10-case
`overflow guards (Phase 5 / WR-01)` describe block locking in:

- power overflow above and below sint16 (`32_768`, `50_000`, `-32_769`, `-50_000`)
- non-integer power (`200.5`)
- exact sint16 boundary acceptance (`32_767`, `-32_768`)
- cadence wire-overflow (`32_768` rpm → wire 65_536) and negative cadence
- cadence wire boundary acceptance (`32_767.5` rpm → wire 65_535)
- speed wire-overflow (`656` km/h) and negative speed
- speed wire boundary acceptance (`655.35` km/h → wire 65_535)

### WR-02: `EventEmitter.once()` shim breaks `off(event, originalListener)` removal contract

**Files modified:** `src/_internal/event-emitter.browser.ts`, `test/_internal/event-emitter.browser.test.ts` (new), `dist/`
**Commit:** `4e55386`
**Applied fix:** Mirrored Node's `_onceWrap` protocol: the once-wrapper
now carries the original listener on a `wrapper.listener` property
(matching Node's public field name, NOT a custom `_originalListener`).
`off()` now uses `findIndex` matching either `entry === listener` OR
`entry.listener === listener`, so both the directly-registered form
and the once-wrapper form resolve to the same removal. Added a new
`test/_internal/` directory with `event-emitter.browser.test.ts`
covering 6 cases:

- `off(event, fn)` removes a `once`-registered listener
- idempotent `off` after a `once`
- `once` still self-removes when `off` is not called
- mixed `on(fn) + once(fn) + off(fn)` removes only the FIRST match (Node parity)
- `on + off` non-once path remains unchanged
- payload-carrying events round-trip through `once + off`

### WR-03: tsup alias plugin uses `process.cwd()` instead of config-file-relative path

**Files modified:** `tsup.config.ts`
**Commit:** `5b2d11d`
**Applied fix:** Replaced `resolve(process.cwd(), 'src', '_internal', replacement)`
with `resolve(__dirname, 'src', '_internal', replacement)`, where
`__dirname` is derived from `import.meta.url` via `fileURLToPath` +
`dirname`. The browser-alias plugin now resolves its `_internal/*.browser.ts`
target paths against the config file's own location, making the build
invocation-cwd-independent. `npm run build` continues to produce
byte-identical output (confirmed: dist/ unchanged after the fix when
invoked from the repo root). Logic verified by inspection;
**status: fixed** — the change is mechanical, not semantic, but a
real-world cross-cwd test would require a different invocation
context outside this fix scope.

### WR-04: Tracking `dist/` in git without `prepare` hook creates stale-artifact risk

**Files modified:** `.gitignore`, `package.json`, `test/transport/publish.test.ts`
**Commit:** `9767274`
**Applied fix:** Three coupled changes (no CI changes per the user's
D-VW-06 absolute):

1. Corrected the `.gitignore` comment that falsely claimed `prepare`
   still rebuilt on install; the comment now describes the current
   reality (`prepare` removed, `dist/` IS the source of truth).
2. Added `validate:dist` npm script that runs `npm run build &&
   git diff --quiet -- dist/` and exits non-zero if `dist/` differs
   from a fresh build of `src/`. Wired into the existing `validate`
   script so it runs as part of `prepublishOnly`.
3. Added a vitest case (`tracked dist/ matches a fresh build of src/`)
   in `publish.test.ts` that runs the same rebuild + diff check during
   `npm test`, surfacing the failure locally **before push**, not just
   before publish. Manually verified the test fails when `src/` is
   mutated without rebuilding `dist/` (simulated via a trailing comment
   added to `event-emitter.browser.ts`; restored after verification).

### WR-05: Two-config tsup build relies on serial execution + asymmetric `clean`

**Files modified:** `tsup.config.ts`, `package.json`
**Commit:** `61f55d4`
**Applied fix:** Hoisted the clean step to a `prebuild` npm script that
runs `node -e "require('node:fs').rmSync('dist', { recursive: true,
force: true })"` (no dependency on `rimraf`). Both tsup configs now
have `clean: false`, so neither can wipe the other's output mid-build
regardless of execution order or parallelism. The `prebuild` hook is
auto-invoked by npm before `build`, so no other call sites change.
Confirmed all 8 dist artifacts (index.{js,cjs,d.ts,d.cts,browser.js}
and four .map siblings) are produced. All 5 substring assertions in
`publish.test.ts` against `tsup.config.ts` (`entry: { index: 'src/index.ts' }`,
`format: ['esm', 'cjs']`, `dts: true`,
`entry: { 'index.browser': 'src/index.ts' }`, `platform: 'browser'`)
remain intact.

---

## Test Baseline

| Stage              | Tests | Skipped | Files |
| ------------------ | ----- | ------- | ----- |
| Pre-fix baseline   | 115   | 2       | 14    |
| After WR-01        | 125   | 2       | 14    |
| After WR-02        | 131   | 2       | 15    |
| After WR-03        | 131   | 2       | 15    |
| After WR-05        | 131   | 2       | 15    |
| After WR-04 (final)| 132   | 2       | 15    |

Net delta: +17 regression tests, 0 broken, 0 reverted.

## Out-of-Scope (deferred to scope=all)

The 6 INFO-class findings (IN-01 through IN-06) were not addressed in
this run because `fix_scope` is `critical_warning`. They remain in
`05-REVIEW.md` for future scope-extension work:

- IN-01: EventEmitter `'error'` event auto-throw parity
- IN-02: `setMaxListeners`/`getMaxListeners` shim parity
- IN-03: Scheduler double `getNow()` per tick (pre-existing)
- IN-04: Alias regex filter is too strict (PascalCase/snake_case)
- IN-05: publish.test.ts substring assertions are brittle
- IN-06: Browser exports-condition lacks a CJS sub-condition

---

_Fixed: 2026-05-19_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
