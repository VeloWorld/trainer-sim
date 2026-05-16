---
phase: 04
plan: 03
subsystem: transport
tags: [factory, fake-transport, public-surface, keystone]
requires: [01, 02]
provides: [createFakeTransport, ITrainerTransport-implementation]
affects: [src/transport/, src/index.ts]
tech-stack:
  added: []
  patterns:
    - factory-returns-object-literal (D-API-04 + Pitfall 2 — no instanceof leak)
    - composed-not-extended-EventEmitter (D-API-11 — narrow public surface)
    - single-import-seam-for-Replay (D-API-18 — third repo seam after fit-file-parser and node:timers/promises)
    - microtask-boundary-in-fake (PITFALLS.md §12 — sendResistance forces await Promise.resolve())
    - .then(success, failure)-defuse (Pattern A4 — eager handler attach, no unhandledRejection)
key-files:
  created:
    - src/transport/fake-transport.ts
  modified:
    - src/index.ts
decisions:
  - D-API-04 implemented (sync factory, deferred FIT load)
  - D-API-06 implemented (factory-level speed/maxEmissionHz validation; folds Phase 3 followup WR-05)
  - D-API-09/10 implemented (Set fan-out + per-handler try/catch + debuglog isolation)
  - D-API-11/12/13 implemented (composed typed EventEmitter; complete on natural end only; literal 'complete' overloads)
  - D-API-14/15/17 implemented (reset truncates in place; preserves subscribers; no Object.freeze)
  - D-API-18 enforced (single-import seam for Replay)
  - D-API-20/21 implemented (per-record collapse; speed field omitted in v1)
metrics:
  duration: ~25min
  completed: 2026-05-16
---

# Phase 4 Plan 03: createFakeTransport Factory Summary

The keystone plan for Phase 4 — `createFakeTransport(config, options?)` factory that composes the Phase 3 `Replay`, the Phase 2 loader, and the Phase 1 encoder behind the `ITrainerTransport` contract. Sync factory + deferred FIT load + composed (not extended) typed EventEmitter; first runtime value reachable from the public package root since Phase 2.

## Files Created / Modified

| File                                | Status   | LOC | Role                                     |
| ----------------------------------- | -------- | --- | ---------------------------------------- |
| `src/transport/fake-transport.ts`   | created  | 267 | Factory + composition + complete wiring  |
| `src/index.ts`                      | modified | +10 | 4 new exports per D-API-07               |

`package.json` and `tsup.config.ts` are **unchanged** (D-API-08 + Phase 4 zero-config-change invariant) — verified with `git diff --stat HEAD~2 HEAD -- package.json tsup.config.ts` (empty output). The single-rooted `exports` map and tsup single-entry build cover the new surface; `publint`/`attw` will validate via Plan 04-06.

## Verification Results

All phase-level greps + commands from the plan `<verification>` block:

| Check                                                                                            | Result                                              |
| ------------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| `tsc --noEmit -p tsconfig.test.json`                                                             | exit 0                                              |
| `npm run build`                                                                                  | exit 0 — `dist/index.{js,cjs,d.ts,d.cts}` regenerate |
| `grep "bleno\|gatt\|advertis" src/index.ts src/types.ts src/transport/fake-transport.ts`         | **clean** (T-04-03-01 mitigated)                    |
| `grep -rln "from '../replay" src/ \| grep -v "^src/transport/fake-transport.ts"`                 | **clean** (D-API-18 + Pitfall 5 enforced)           |
| `grep -c "debuglog('trainer-sim:" src/`                                                          | 8 (call sites for `:fit`, `:replay`, `:transport` plus JSDoc references) |
| `node -e "import('./dist/index.js').then(m => …)"`                                               | exit 0 — `createFakeTransport` resolves at runtime  |
| `node -e "require('./dist/index.cjs').createFakeTransport"`                                      | exit 0 — CJS dual-publish path resolves              |
| `npm test` (existing suites, regression check)                                                   | 77 passed, 2 intentional skips                      |

## Requirements Addressed

- **API-01** — `createFakeTransport(config)` returns an `ITrainerTransport`-shaped object literal (`connect`/`disconnect`/`onData`/`sendResistance`).
- **API-02** — `ITrainerTransport` exported as a TypeScript type from the package root via `export type { ITrainerTransport } from './types.js'`.
- **API-03** — `onData(handler)` adds to the Set; returns a sync disposer arrow function that calls `subscribers.delete(handler)`.
- **API-04** — `sendResistance(grade)` is echo-only; the per-record encode path does NOT consult `resistanceLog`. Microtask boundary forced via `await Promise.resolve()` BEFORE the push (PITFALLS.md §12) so v2 wire-write timing is observable in v1 Fake.
- **API-05** — `received.resistance` is exposed as `ReadonlyArray<number>` at the type level; backed by an internal `number[]` (D-API-17 — no `Object.freeze`).
- **API-06** — `reset()` is `Promise<void>`-returning; awaits `disconnect()`, truncates `resistanceLog` in place (`.length = 0` — Pattern 4 stable-reference), and discards `replay` so the next `connect()` constructs a fresh `Replay` (Phase 3 D-REPL-07 single-use lock).

## Implemented Decisions

D-API-01 through D-API-21 (locked) plus D-API-25 (Phase 3 followups WR-05 + IN-01 fold — IN-01 closed in Plan 04-01). Highlights:

- **D-API-04** — sync factory + deferred FIT load. `loadFitFromPath` / `loadFitFromBuffer` are called inside `connect()`; `FitLoadError` family + `ENOENT`/`EACCES` bubble through the Promise rejection unchanged.
- **D-API-06 + WR-05 fold** — `!(speed > 0)` and `!(maxEmissionHz > 0)` checks throw synchronously from the factory body BEFORE `connect()` returns its Promise. The `!(x > 0)` form catches NaN, 0, negative, and non-numeric coercions in one expression.
- **D-API-11** — composed `EventEmitter<{ complete: [] }>` (typed empty-tuple form). `on`/`off`/`once` are pass-through methods with LITERAL `'complete'` event-name (NOT `string` parameter — D-API-13 narrowing protection).
- **D-API-12** — `replay.completed.then(() => emitter.emit('complete'), () => undefined)` attaches BOTH handlers eagerly. Natural completion → emit; abort path → silent. The two-handler form mirrors `src/replay/replay.ts:247-256` and prevents `unhandledRejection`.
- **D-API-14** — `reset()` does the four-step recipe: idempotent `disconnect()` → truncate `resistanceLog.length = 0` in place → `replay = undefined` (cleared inside `disconnect()`) → subscribers Set NOT cleared.
- **D-API-18** — single-import-seam for `Replay` enforced by acceptance grep. `src/transport/fake-transport.ts` is the ONLY file in `src/` that imports from `../replay/`.
- **D-API-20** — per-record path collapses `rec.power ?? 0` and `rec.cadence ?? 0` BEFORE calling `encodeIndoorBikeData`. The encoder is called ONCE per tick; the resulting `DataView` fans out across the subscribers Set with per-handler `try/catch` (D-API-10) so a throwing handler does NOT starve other subscribers.

## Threat Mitigations

- **T-04-03-01 (HIGH severity — BLE-type leak through public type graph)** — **MITIGATED**. Phase-level grep `grep -rn "bleno\|gatt\|advertis" src/index.ts src/types.ts src/transport/fake-transport.ts` returns zero matches. Plan 04-06's `publint` + `attw` runs against the built `dist/` will provide defense-in-depth.
- **T-04-03-02 (DoS — subscriber-throws aborts fan-out)** — **MITIGATED**. Per-handler `try { h(dv); } catch (err) { log('subscriber threw: %O', err); }` wraps each invocation; the `debuglog('trainer-sim:transport')` swallow keeps observability without propagation. Plan 04-04 will add the regression test.
- **T-04-03-03 (DoS — undisposed subscriber leaks)** — **ACCEPTED** per CLAUDE.md "trust internal code"; the `onData` disposer return is the contract.
- **T-04-03-04 (Tampering — reset/in-flight emit race)** — **MITIGATED**. `reset()` awaits `disconnect()`, which awaits `replay.completed.catch(() => undefined)` — by the time `reset()` resolves, the scheduler's last microtask has unwound (Pattern 3 + REPL-06 + Phase 3 CR-01 fix at commit `e4b04a9`). Plan 04-04 will add the analog of `test/replay/abort.test.ts:100-113`.
- **T-04-03-05 (Tampering — DataView mutation between subscribers)** — **ACCEPTED** as documented consumer responsibility.
- **T-04-03-06 (DoS — FIT path ENOENT/EACCES inside connect)** — **MITIGATED**. Bubbles unchanged through `connect()` Promise rejection; Phase 2's loader caps file size at 50 MB.
- **T-04-03-07 (Information Disclosure — FitLoadError details)** — **ACCEPTED**; messages don't include file paths or buffer contents (Phase 2 review verified).

## Phase 3 Followups Closed

- **WR-05 (Phase 3)** — `Replay.start()` doesn't validate `speed > 0` / `maxEmissionHz > 0`. **CLOSED** at the factory boundary per D-API-25. The factory throws synchronously with the messages `createFakeTransport: speed must be > 0, got <value>` and `createFakeTransport: maxEmissionHz must be > 0, got <value>`. Replay stays internally lenient — the public boundary is the validation gate.
- **IN-01 (Phase 3)** — already closed in Plan 04-01 (per the plan's introductory note); not re-addressed here.

## Deviations from Plan

**One Rule 1 (auto-fix) deviation worth noting:**

**1. [Rule 1 — Acceptance-grep guard] Removed BLE token strings from JSDoc comments**
- **Found during:** Task 1 verification
- **Issue:** The plan-mandated grep `! grep -E "bleno|gatt|advertis" src/transport/fake-transport.ts` failed because the original module-doc preamble cited "v2's `BlenoTransport` will be a sibling factory in `src/transport/bleno-transport.ts`" and similar in pitfall references. The grep is intentionally strict (it's the T-04-03-01 acceptance mechanism — defends against BLE imports leaking through the type graph). Even tokens inside JSDoc comments fail it.
- **Fix:** Rephrased comments to refer to "v2's BLE-peripheral transport / sibling transport file / wire-write timing" without the literal tokens. Same semantic content, same decision-citation depth, satisfies the grep.
- **Files modified:** `src/transport/fake-transport.ts`
- **Commit:** included in `8448439` (Task 1 — single commit)

No other deviations. Plan executed exactly as written.

## Authentication Gates

None.

## Self-Check: PASSED

- `src/transport/fake-transport.ts` — FOUND
- `src/index.ts` — FOUND (modified; 4 new exports present)
- Commit `8448439` (feat: implement createFakeTransport factory) — FOUND in `git log`
- Commit `9c780a2` (feat: export Phase 4 FakeTransport surface from package root) — FOUND in `git log`
- Phase-level BLE grep — clean
- Single-import seam grep — clean
- `npm run build` — exit 0
- ESM + CJS runtime resolution of `createFakeTransport` — both exit 0
- `package.json` + `tsup.config.ts` — unchanged (verified by `git diff --stat`)
