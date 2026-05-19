---
plan: 05-02
phase: 05-veloworld-end-to-end-validation
status: complete
completed: 2026-05-19
---

# Plan 05-02 Summary — VW Local-Green Build

## Outcome

VW's `feat/phase-5-trainer-sim-canonical` branch contains a single Wave 1a commit that:

- Pins `trainer-sim` to a browser-safe build via `github:VeloWorld/trainer-sim#b1b4304`
- Allowlists trainer-sim in pnpm 10 strict-mode (root `package.json`)
- Deletes 4 vendored FIT/replay modules (-830 LOC)
- Rewrites `dev/fake-trainer-transport.ts` as a 166-LOC adapter composing trainer-sim
- Rewrites two test files to mock `'trainer-sim'` instead of `'../../dev/fit-loader'`
- Wires trainer-sim's `'complete'` event → `setSensorState('trainer', 'disconnected')` (CR-04)
- Expands CI matrix to `[ubuntu-latest, macos-latest]`

`pnpm typecheck`, `pnpm test` (workspace-wide; 406/421 pass + 15 skipped), `pnpm --filter @veloworld/desktop build` all exit 0. Production-bundle grep gate (`grep -El 'fake-transport|FakeTransport|trainer-sim'`) exits 1 (no matches). The post-replan defense grep for `dev/fit-loader|dev/replay-scheduler` references outputs zero files. Branch has not been pushed; Plan 05-03 owns the push + PR cycle.

## Key facts for downstream plans

| Item | Value |
|------|-------|
| VW feature branch | `feat/phase-5-trainer-sim-canonical` |
| VW commit sha | `7285152c27e6a57fbc6bff7b27e7bd55b508224f` |
| trainer-sim sha pinned | `b1b430457a02908808b0bd02f924465180a335d7` (Wave 0 + browser-safe fix) |
| Files in commit | 11 (7 modified + 4 deleted) |
| Pre-rewrite adapter LOC | 272 |
| Post-rewrite adapter LOC | 166 |
| LOC delta | -830 +280 (net -550) |

## Execution deviations

### 1. trainer-sim browser-safe build (Wave 0.5)

**Problem.** `pnpm --filter @veloworld/desktop build` failed:

```
"debuglog" is not exported by "__vite-browser-external", imported by trainer-sim/dist/index.js
```

**Root cause.** trainer-sim's `dist/index.js` (built by `tsup`) emitted bare-specifier imports for Node builtins (`util`, `events`, `fs/promises`, `timers/promises`, `buffer`). VW's renderer is bundled by Vite for an Electron Chromium context with `nodeIntegration: false` (default). Vite externalises bare Node-builtin specifiers to its `__vite-browser-external` stub, which exports a default object but not the specific named symbols (`debuglog`, etc.). Rollup's static dependency analysis fails the build.

RESEARCH.md Pitfall 6 anticipated `node:fs` (the `{ path }` source variant) but did NOT anticipate that trainer-sim is fundamentally a Node-only library — `EventEmitter` for the `'complete'` event, `debuglog` for tracing, `setTimeout` from `node:timers/promises` for the scheduler are reachable from the `{ buffer }` path even when `loadFitFromPath` is never called. tsup also strips `node:` prefixes from imports, which means Vite's browser-resolution kicks in instead of Node-builtin resolution.

**Fix.** Per user override "patch trainer-sim locally to be browser-safe", landed two trainer-sim commits on `origin/main`:

- `b1b4304 build(05): browser-safe dual build for VW Electron renderer (D-VW-10)`
- `012f653 docs(05): re-pin Wave 0 sha to browser-safe build`

The fix introduces a third `tsup` output, `dist/index.browser.js`, exposed via the `"browser"` exports condition. tsup uses an esbuild resolve-plugin to swap four `_internal/*.ts` shims for their `.browser.ts` siblings:

- `debuglog` → no-op in browser; `node:util.debuglog` in Node (unchanged)
- `EventEmitter` → 50-LOC inline impl; `node:events.EventEmitter` in Node
- `defaultSleep` → `setTimeout` + `AbortSignal`; `node:timers/promises.setTimeout` in Node
- `readFile` → throws explanatory error; `node:fs/promises.readFile` in Node

`indoor-bike-data.ts` drops `Buffer` entirely — switches to `DataView.set{Uint,Int}16(_, _, true)`. Wire format byte-identical (verified by the third-party-decoder round-trip test).

`fit/loader.ts` drops `Buffer` too — `fit-file-parser`'s binary reader accepts any indexable byte source (verified by reading `binary.js:426`). `loadFitFromBuffer` now accepts `Uint8Array`; `Buffer extends Uint8Array` so existing Node consumers work unchanged.

**Validation.** All 115 trainer-sim tests pass on Node. `publint` + `attw` across `node10/node16-CJS/ESM/bundler` all green. `dist/index.browser.js`: only `import FitParser from 'fit-file-parser'`; zero node-builtin imports.

### 2. SUB-STEP B0 verify path

The plan's automated verify check looked for `node_modules/trainer-sim/dist/index.js` at the repo root. pnpm's hoisting layout puts the consumer-resolved copy at `apps/desktop/node_modules/trainer-sim/dist/index.js` instead. The prepare hook ran successfully (all 8 dist artifacts present, including the browser bundle); the path mismatch was a verify-script issue, not a plan failure.

### 3. Consumer set deviation (Task 1 SUB-STEP C)

The plan expected exactly 2 consumer files of the deleted modules. Actual count was 3 (the adapter + the unit test + the integration test) — but the unit test and integration test share the same logical role (both mock `dev/fit-loader`), so the substantive work was already accounted for in Tasks 3 and 4. No additional plan changes needed.

### 4. RideRecord field-name divergence

VW's vendored `RideRecord` type used `timestampMs: number, speed: number`. trainer-sim's `RideRecord` type uses `timestamp: number` with `power?: number, cadence?: number` (no speed channel). Test fixtures in `dev-mode-save-flow.test.ts` and `fake-trainer-transport.test.ts` were updated to match trainer-sim's shape. The fixtures are mock-only (the tests mock `createFakeTransport` at the boundary, so trainer-sim's loader/scheduler never observe them), so the rename is cosmetic.

### 5. SUB-STEP 5 chosen path (dev-mode-save-flow.test.ts)

Per Plan 05-02 SUB-STEP 5, the executor chose **option (a) data-bypass + move-to-post-disconnect**:

- `handlerSpy` expectation changed from `toHaveBeenCalledTimes(2)` to `not.toHaveBeenCalled()` — no records driven through the captured `onData` callback; the test exclusively exercises the `'complete'` → `'disconnected'` transition.
- The pre-disconnect `expect(unsubSpy).toHaveBeenCalledTimes(1)` assertion was changed to `not.toHaveBeenCalled()` (the post-Task-2 adapter's `'complete'` listener does NOT call `teardown()`; it only fires `setSensorState`).
- The post-disconnect assertion stays `expect(unsubSpy).toHaveBeenCalledTimes(1)`, plus a new idempotency check (`await t.disconnect(); expect(unsubSpy).toHaveBeenCalledTimes(1)` — second disconnect is a no-op).

CR-01..CR-04 invariants preserved with all 16 inline `CR-0X` markers intact.

## Acceptance gate transcript (last 20 lines per check)

### `pnpm typecheck` — exit 0

```
 Tasks:    9 successful, 9 total
Cached:    9 cached, 9 total
  Time:    14ms >>> FULL TURBO
```

### `pnpm test` — exit 0

```
 Test Files  44 passed (44)
      Tests  406 passed | 15 skipped (421)
   Duration  857ms (transform 2.69s, setup 398ms, import 3.65s, tests 2.79s, environment 2ms)

 Tasks:    8 successful, 8 total
```

### `pnpm --filter @veloworld/desktop build` — exit 0

```
transforming...
✓ 1959 modules transformed.
rendering chunks...
../../out/renderer/index.html                                    0.40 kB
../../out/renderer/assets/index-0-XeOIJv.css                    41.71 kB
../../out/renderer/assets/ble-trainer-transport-CUwRrpVC.js     10.66 kB
../../out/renderer/assets/index-CYKgmh53.js                  3,552.04 kB
✓ built in 1.66s
```

### `grep -El 'fake-transport|FakeTransport|trainer-sim' apps/desktop/out/renderer/assets/*.js` — exit 1 (no matches)

(no output)

### `grep -rln 'dev/fit-loader\|dev/replay-scheduler' apps/desktop/src/ packages/` — zero files

(no output)

### Wave 0 sha file

```
$ cat .planning/phases/05-veloworld-end-to-end-validation/05-WAVE-0-SHA.txt
b1b430457a02908808b0bd02f924465180a335d7
```

### VW root pnpm allowlist

```
$ grep '"trainer-sim"' /Users/agniveshpatel/dev/agni21/veloworld-ride/package.json
    "onlyBuiltDependencies": ["electron", "esbuild", "trainer-sim"]
```

### Wave 1a commit shape

```
$ git log -1 --pretty='%h %s'
7285152 feat(phase-5): adopt trainer-sim FakeTransport via git-ref + adapter

$ git diff --name-only HEAD~1 HEAD | wc -l
11
```

## Handoff to Plan 05-03

Plan 05-03 inputs:

- VW branch: `feat/phase-5-trainer-sim-canonical` (NOT pushed)
- VW commit: `7285152c27e6a57fbc6bff7b27e7bd55b508224f`
- trainer-sim sha: `b1b430457a02908808b0bd02f924465180a335d7` (already on `VeloWorld/trainer-sim` `origin/main`)
- Local-green: `pnpm typecheck && pnpm test && pnpm --filter @veloworld/desktop build` all 0
- Production grep gate locally clean

Plan 05-03 owns: push the branch, open the PR, monitor `ci (ubuntu-latest)` + `ci (macos-latest)` jobs, iterate on failures (per D-VW-08 — fix in trainer-sim first if the issue is trainer-sim-side), capture URLs/SHAs for Plan 05-04's acceptance bundle.
