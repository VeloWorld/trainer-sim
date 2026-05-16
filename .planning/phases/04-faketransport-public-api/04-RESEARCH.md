# Phase 4: FakeTransport & Public API - Research

**Researched:** 2026-05-16
**Domain:** Public TypeScript library API design — `createFakeTransport` factory, `ITrainerTransport` contract, multi-subscriber fan-out, dual ESM/CJS publish hygiene
**Confidence:** HIGH

## Summary

Phase 4 surfaces the Phase 3 internal `Replay` (`src/replay/replay.ts`) through the public package API as `createFakeTransport(config) → ITrainerTransport`. Every architectural and lifecycle question is already locked in `04-CONTEXT.md` (D-API-01..26): the factory is sync, FIT load is deferred to `connect()`, the source is a `{ path } | { buffer } | { records }` discriminated union, fan-out is a `Set<handler>` with per-handler `try/catch + debuglog` isolation, the `'complete'` event is wired by composing (not extending) an internal `EventEmitter`, `reset()` discards-and-re-instantiates `Replay` (Phase 3's single-use lock — D-REPL-07), and `received.resistance` is exposed as a literal `ReadonlyArray<number>` with NO v2-forward `controlPoint[]` shape. CONTEXT also folds the four research-flagged Phase 3 followups: lift `fakeAwareSleep` to `test/_helpers/`, validate `speed > 0` / `maxEmissionHz > 0` synchronously in the factory, leave `currentState` docstring alone unless tests demand it, leave the "frozen-by-convention" config posture alone.

This research therefore does NOT explore alternatives to locked decisions. It pins the *exact mechanical recipe* for ten gaps the planner needs settled before writing tasks: (1) the publint/attw delta when `src/index.ts` gains three new top-level named exports — answer: **zero changes to `package.json`/`tsup.config.ts`** because the new exports flow through the existing `.` root and the dual-emit pipeline already covers them; (2) the canonical Node 24 typed-`EventEmitter<{ complete: [] }>` form (verified compiling under TS 5.9 + `@types/node@~24`); (3) `await null` vs `await Promise.resolve()` vs `queueMicrotask` for the v1 `sendResistance` microtask boundary (`await Promise.resolve()` wins on intent-clarity); (4) the precise object-literal-with-internal-EventEmitter return shape and how to type it so `instanceof FakeTransport` cannot leak; (5) the `disconnect()` contract — `replay.stop()` is synchronous, but Phase 3's REPL-06 test pattern requires we let the in-flight scheduler microtask fully unwind before resolving; the safe form is `replay.stop(); await replay.completed.catch(() => undefined)`; (6) `node:events.once(emitter, 'complete')` cooperates with `vi.useFakeTimers()` because emit happens inside a `replay.completed.then(...)` microtask and microtasks drain naturally during `vi.advanceTimersByTimeAsync()`; (7) Set iteration with mid-fan-out handler-removal is ECMA-spec defined (the iteration sees the snapshot at point of `for…of` start, but mutation during iteration is supported — added entries are visited, removed not-yet-visited entries are skipped) — the `try/catch` per handler addresses the throw case independently; (8) the canonical `fakeAwareSleep` signature is byte-identical across all four Phase 3 test files — a lift-and-import is a pure refactor with zero behavioral change; (9) D-FIT-05 confirms `basic.fit` (443 records, 7 minutes, ROUVY clean 1Hz, 28 zero-power records) is the right fixture for the `{ path }` and `{ buffer }` source variants; (10) the existing `package.json` exports map already passes publint + attw (verified in this session: both green against current dist) and Phase 4's three new named exports flow through unchanged.

**Primary recommendation:** Implement `createFakeTransport` exactly as the CONTEXT lock spells it: sync factory, deferred FIT load, `Set<handler>` fan-out, composed-not-extended `EventEmitter<{ complete: [] }>`, `await Promise.resolve()` microtask boundary in `sendResistance`, `disconnect()` resolves after `replay.stop(); await replay.completed.catch(() => undefined)`. Tests under `test/transport/` consume a lifted `test/_helpers/fake-aware-sleep.ts` shared with the Phase 3 suite. Make NO changes to `package.json` or `tsup.config.ts` — the existing single-rooted `exports` map and `entry: ['src/index.ts']` already cover the new surface. Verify `publint` + `attw` green by simply re-running `npm run validate` after the implementation lands.

## User Constraints (from CONTEXT.md)

### Locked Decisions

**ITrainerTransport definition site & async semantics:**
- D-API-01: trainer-sim is the canonical definer of `ITrainerTransport`. Lives in `src/types.ts` next to `RideRecord`; re-exported from `src/index.ts`. (ARCHITECTURE.md Pattern 4 + Anti-Pattern 6.)
- D-API-02: `connect() / disconnect() / sendResistance(grade)` all return `Promise<void>`. Even Fake's `sendResistance` forces a microtask boundary so consumers cannot observe a Fake-vs-Bleno timing difference. (PITFALLS.md §12.)
- D-API-03: NO BLE-specific types appear anywhere reachable from `src/index.ts`. Acceptance grep:
  ```bash
  grep -rn "bleno\|gatt\|advertis" src/index.ts src/types.ts src/transport/fake-transport.ts || echo "clean"
  ```

**Factory shape & source discriminated union:**
- D-API-04: `createFakeTransport(config)` is synchronous. FIT loading + `Replay` construction deferred to `connect()`. Filesystem errors and `FitLoadError` family land in `connect()` Promise rejection.
- D-API-05: `config.source = { path: string } | { buffer: Buffer | Uint8Array } | { records: ReadonlyArray<RideRecord> }`. The `records` variant is for trainer-sim's OWN tests.
- D-API-06: Defaults: `speed = 1`, `loop = false`, `maxEmissionHz = 1000`. Defaults live in factory. Factory validates `speed > 0` and `maxEmissionHz > 0` synchronously (Phase 3 followup WR-05 fold).

**Public API surface:**
- D-API-07: `src/index.ts` adds:
  ```ts
  export { createFakeTransport } from './transport/fake-transport.js';
  export type { ITrainerTransport, FakeTransportConfig, FakeTransportSource } from './types.js';
  ```
- D-API-08: `package.json` exports map stays single-rooted (`"."` only) for v1.

**Multi-subscriber fan-out & error isolation:**
- D-API-09: Subscriber registry is `Set<(data: DataView) => void>`. `onData` returns disposer that calls `subscribers.delete(handler)`.
- D-API-10: A subscriber that throws does NOT abort the loop. Wraps each handler invocation in `try { h(data) } catch (err) { log('subscriber threw: %O', err) }` using `util.debuglog('trainer-sim:transport')`.

**`'complete'` event surface:**
- D-API-11: FakeTransport COMPOSES an internal `EventEmitter` (does NOT extend). Returned object exposes `on`/`off`/`once` ONLY for `'complete'`.
- D-API-12: `'complete'` fires when `Replay.completed` resolves naturally. Does NOT fire when `disconnect()` aborts.
- D-API-13: `ITrainerTransport` does NOT include event-emitter methods. The `on('complete', ...)` surface is FakeTransport-specific.

**`reset()` scope:**
- D-API-14: `reset()` does: (1) idempotent `disconnect()`; (2) clear `received.resistance`; (3) construct a fresh internal `Replay` for next `connect()`; (4) does NOT clear `onData` subscribers.
- D-API-15: `reset()` returns `Promise<void>`.

**`received` shape:**
- D-API-16: `received: { resistance: ReadonlyArray<number> }`. NO v2-forward `controlPoint` shape.
- D-API-17: Backed by an internal `number[]` the implementation appends to. NO `Object.freeze`.

**Module layout:**
- D-API-18: `src/transport/fake-transport.ts`. v2's `BlenoTransport` will be `src/transport/bleno-transport.ts` — sibling, not subclass.
- D-API-19: NO `src/util/clock.ts`. Tests rely on `vi.useFakeTimers()` against `globalThis.performance.now` and `globalThis.setTimeout`.

**FTMS encode wiring:**
- D-API-20: Per-record path collapses `rec.power ?? 0` and `rec.cadence ?? 0` inside the `replay.onRecord(...)` handler, then calls `encodeIndoorBikeData({ power, cadence })` once and fans out the resulting `DataView` over the subscribers Set.
- D-API-21: NO new FTMS fields (speed, HR) emitted in v1.

**Test strategy:**
- D-API-22: Phase 4 tests under `test/transport/`. Three test files:
  1. `test/transport/fake-transport.test.ts` — factory shape, lifecycle, fan-out, throw isolation, ordering, `reset()`. Uses `{ records: [...] }` source for speed.
  2. `test/transport/path-and-buffer.test.ts` — `{ path }` and `{ buffer }` against `test/fixtures/fit/basic.fit`.
  3. `test/transport/publish.test.ts` — `publint` + `attw` against built `dist/`. Marked `test.slow` (shells out to `npm run build`).
- D-API-23: NO new FIT fixtures.
- D-API-24: Vitest fake-timer discipline — `vi.useFakeTimers()`, `vi.advanceTimersByTimeAsync()` (NOT sync). Lift `fakeAwareSleep` to `test/_helpers/fake-aware-sleep.ts`; consume from new + 4 existing Phase 3 test files.

**Phase 3 followups folded:**
- D-API-25: Fold WR-05 (factory-level speed/maxEmissionHz validation) and IN-01 (`fakeAwareSleep` lift). Optional WR-02 (`currentState` docstring) — only if Phase 4 tests demand it. WR-04 (`config "frozen"` claim without `Object.freeze`) — leave alone (matches D-API-17 posture).
- D-API-26: Phase 2 followups (WR-01, WR-03, WR-05) NOT folded — loader-internal.

### Claude's Discretion

- File-level layout inside `src/transport/`: single `fake-transport.ts` is fine for v1. Split only if file exceeds ~250 LOC.
- Object literal vs class for the FakeTransport return — default to **plain object literal** (avoids leaking `instanceof FakeTransport`).
- Typed `EventEmitter<{ complete: [] }>` (Node 22+) vs loose `EventEmitter` — default to **typed**.
- Naming inside the factory closure (`subscribers`, `resistanceLog`, `replay`, `emitter`) — taste-level.

### Deferred Ideas (OUT OF SCOPE)

- `tick(ms)` virtual-clock mode — REQUIREMENTS.md out-of-scope (v1.x).
- `received.controlPoint[]` v2-forward shape — D-API-16 explicit defer.
- `'data'` event surface or `notified.count` accessor — v2 if needed.
- ReadableStream / URL / HTTP source variants — REQUIREMENTS.md out-of-scope.
- Multiple FakeTransport instances sharing a parsed FIT — out of scope.
- `tsup` `external` for bleno (v2 forward-shape) — `tsup.config.ts` already has the comment.
- `@stoprocent/bleno` PROJECT.md update (Phase 1 carry-forward) — handle at Phase 4→5 transition.
- Phase 3 followup WR-02 docstring — only if needed.
- Phase 3 followup WR-04 `Object.freeze` — leave alone.
- Phase 2 followups WR-01, WR-03, WR-05 — loader-internal.
- CLI (`trainer-sim play`) — v2.
- VeloWorld E2E — Phase 5.
- BlenoTransport / `@stoprocent/bleno` — v2.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| API-01 | `createFakeTransport(config)` returns `ITrainerTransport`-shaped (`connect/disconnect/onData/sendResistance`) | §Standard Stack (composition pattern) + §Code Examples 1 (factory skeleton) |
| API-02 | `ITrainerTransport` exported as TypeScript type from package root | §Standard Stack + D-API-07 + verified-compiling typed-EE check (this session) |
| API-03 | `onData(handler: (data: DataView) => void) → disposer` | §Code Examples 2 (Set-based fan-out + disposer); §Common Pitfalls #4 (Set iteration during mutation) |
| API-04 | `sendResistance(grade)` echo-only — records call, does NOT modify replayed values | §Code Examples 3 (echo + microtask boundary); D-API-20 (encode wiring is per-record, not per-resistance) |
| API-05 | `received.resistance: ReadonlyArray<number>` of grade calls in order | §Architecture Patterns Pattern 3 (literal v1 shape per D-API-16) |
| API-06 | `reset()` clears resistance log + rewinds replay cursor; reusable across `afterEach()` | §Code Examples 4 (`reset()` recipe — fresh `Replay` per Phase 3's single-use lock) |
| API-07 | Dual ESM/CJS publish validated by `publint` + `@arethetypeswrong/cli` | §Tooling Validation (current state: green; Phase 4 changes do not touch the exports map) |
| API-08 | Strict-mode TS Node 24 import works without `@types/*` shim | §Tooling Validation (`tsup` already emits `.d.ts`+`.d.cts`; types-first conditional already in place; verified attw green this session) |

## Architectural Responsibility Map

trainer-sim is a single-process Node library — there is no Browser/Frontend Server/CDN/Database tier. Mapping is at the **module-layer** level instead, since "tier ownership" for a library means "which file/folder owns this capability."

| Capability | Primary Layer | Secondary Layer | Rationale |
|------------|---------------|-----------------|-----------|
| Public API surface (`createFakeTransport`, `ITrainerTransport` type) | `src/index.ts` (re-export only) | `src/types.ts` (interface definition site) | D-API-01 — trainer-sim is the canonical definer; `src/index.ts` is a thin re-export hub. |
| Factory + lifecycle (sync construction, async `connect()`, deferred FIT load) | `src/transport/fake-transport.ts` | — | D-API-04 + D-API-18; new file in Phase 4. |
| Multi-subscriber fan-out (`Set<handler>`, disposer, throw-isolation) | `src/transport/fake-transport.ts` | — | D-API-09/10; the only place a `Set<handler>` exists. Phase 3's `Replay` is single-subscriber by design (D-REPL-11). |
| Resistance recorder (`received.resistance` + microtask boundary in `sendResistance`) | `src/transport/fake-transport.ts` | — | D-API-16/17 + PITFALLS.md §12. Echo-only — does not enter the replay pipeline. |
| `'complete'` event surface (composed `EventEmitter`) | `src/transport/fake-transport.ts` | — | D-API-11/12; emitter is private to the factory closure, exposed only as `on/off/once` pass-through for `'complete'`. |
| `reset()` (discard `Replay`, clear log, preserve subscribers) | `src/transport/fake-transport.ts` | — | D-API-14; "fresh `Replay`" is forced by Phase 3's single-use lock (D-REPL-07). |
| Per-record FTMS encode (collapse `rec.power ?? 0`, `rec.cadence ?? 0`, call `encodeIndoorBikeData`, fan out the `DataView`) | `src/transport/fake-transport.ts` (collapse + fan-out) | `src/ftms/indoor-bike-data.ts` (encode itself) | D-API-20; Phase 1's encoder stays pure (D-08); the v1 absent→0 collapse is consumer-visible policy. |
| FIT load (`{ path }` / `{ buffer }`) | `src/fit/loader.ts` | `src/transport/fake-transport.ts` (call site only — inside `connect()`) | D-API-05; FakeTransport CALLS the loader; FitLoadError family bubbles unchanged. |
| Replay engine (drift-corrected scheduler, `'complete'` Promise) | `src/replay/replay.ts` + `src/replay/scheduler.ts` | — | Phase 3 owns this. FakeTransport composes `Replay` through the public seam (`onRecord`, `start`, `stop`, `completed`); does NOT reach past it (D-REPL-12). |
| Test fan-out fixture (`fakeAwareSleep` helper) | `test/_helpers/fake-aware-sleep.ts` | — | D-API-24 + IN-01 fold; lifted from 4 Phase 3 test files. |

**Why this matters:** the `src/transport/` boundary is the single new component in Phase 4. Every other capability either already exists (`Replay`, encoder, loader) or is a re-export-level addition (`src/index.ts`, `src/types.ts`). Misassignment risk is low here BECAUSE Phase 3 already enforces the "Replay is internal" lock (D-REPL-12) and Phase 1 already enforces the "encoder is pure" lock (D-08).

## Standard Stack

### Core (already installed and verified — see Tooling Validation below)

| Library | Version (verified `npm view` 2026-05-16) | Purpose | Why Standard |
|---------|------------------------------------------|---------|--------------|
| TypeScript | 5.9.3 | Strict-mode types-first surface | Already in `package.json`. Compiles `EventEmitter<{ complete: [] }>` cleanly under `verbatimModuleSyntax: true` (verified this session). `[VERIFIED: tsc --noEmit]` |
| Node | 24.x LTS, `engines: ">=24.0"` | Runtime; `EventEmitter<T>` typed events stable since 22; `AbortSignal.any` stable in 24; `Promise.withResolvers()` stable in 22+ | Phase 3 already relies on all three. `[VERIFIED: 04-CONTEXT.md D-API-19; replay.ts uses these]` |
| `tsup` | 8.5.1 | Dual ESM+CJS build; `.d.ts`+`.d.cts` emit | Already configured (`tsup.config.ts`). Phase 4 makes NO change. `[VERIFIED: build green this session]` |
| `vitest` | 4.1.6 | Test runner; `vi.useFakeTimers()` cooperates with `globalThis.setTimeout` (Phase 3 RESEARCH §Pitfall 6 confirmed it does NOT intercept `node:timers/promises`) | Phase 3 tests rely on this — same pattern carries forward. `[VERIFIED: 4 Phase 3 test files green]` |
| `publint` | 0.3.21 | `package.json` `exports` map validation | Already wired (`npm run validate:publint`). `[VERIFIED: passed this session — "All good!"]` |
| `@arethetypeswrong/cli` | 0.18.2 | Type resolution validation across ESM/CJS | Already wired (`npm run validate:attw`). `[VERIFIED: passed this session — "No problems found 🌟"]` |

### Phase-4 internal-only consumed APIs

| API | Where used | Why |
|-----|------------|-----|
| `node:events` `EventEmitter` + `once` | Composition inside `fake-transport.ts`; tests `await once(transport, 'complete')` | D-API-11; `once()` returns a Promise that cooperates with `vi.useFakeTimers()` because emit fires inside a `replay.completed.then(...)` microtask which drains during `vi.advanceTimersByTimeAsync()`. `[CITED: nodejs.org/docs/latest-v24.x/api/events]` |
| `node:util` `debuglog('trainer-sim:transport')` | Subscriber-throws swallow path; observability seam matching `:fit` (Phase 2 D-FIT-09) and `:replay` (Phase 3) | Same conventional namespace — Phase 4 is the third instance; opt-in via `NODE_DEBUG=trainer-sim:transport`. `[VERIFIED: same pattern in src/fit/loader.ts and src/replay/scheduler.ts]` |
| `Promise.resolve()` (TC39 stage 4, Node 22+ stable) | Microtask boundary inside `sendResistance` | PITFALLS.md §12; `await Promise.resolve()` is the canonical idiom. `queueMicrotask` does NOT return a Promise — wrong primitive here. `await null` works (await unwraps `null` to a thenable check that returns synchronously after a microtask) but `await Promise.resolve()` is intent-clearer to a future reader. `[CITED: tc39.es/proposal-promise-with-resolvers, ECMA-262 §AwaitExpression]` |

### Alternatives Considered (and rejected per locked decisions)

| Instead of | Could Use | Why CONTEXT rejected |
|------------|-----------|-----------------------|
| `await Promise.resolve()` | `queueMicrotask(() => …)` | `queueMicrotask` does not return a Promise — the calling consumer cannot `await transport.sendResistance(grade)`. Wrong primitive (PITFALLS.md §12). |
| `await Promise.resolve()` | `await null` | Works (the await machinery treats `null` as already-resolved, but spec-wise this still schedules a microtask), but is intent-obscure to a future reader. Use `await Promise.resolve()`. `[CITED: ECMA-262 §AwaitExpression — the expression is wrapped in `PromiseResolve(null)` which schedules a microtask]` |
| Composed `EventEmitter` | `class FakeTransport extends EventEmitter` | D-API-11 explicit — extending widens the public surface to ~30 EventEmitter methods that `ITrainerTransport` does not promise; keeps the type honest. |
| `Set<handler>` for fan-out | `Array<handler>` | D-API-09 — Set gives O(1) `delete()` on the disposer path; iteration order is identical (insertion order). Spec: `Set.prototype[@@iterator]` walks insertion order; ECMA-262 supports add/delete during iteration. `[CITED: ECMA-262 §Set.prototype.values]` |
| Re-instantiate `Replay` on `reset()` | Add a `Replay.reset()` method | Phase 3's D-REPL-07 single-use lock is intentional; the alternative would force Phase 3 to grow a state-machine reset path. Discard-and-re-instantiate keeps `Replay` simple. |
| Discriminated union `{ path } \| { buffer } \| { records }` | `string \| Buffer \| RideRecord[]` | D-API-05 — discriminated union forces the consumer to be explicit at the call site (`{ path: '...' }` vs `'/'`-as-string-also-could-be-an-error-message); also makes adding a 4th variant additive. |
| `Object.freeze(received)` / `Object.freeze(received.resistance)` | leave the array as a normal `number[]`, type as `ReadonlyArray<number>` | D-API-17 explicit — the type-level readonly is the contract; freezing forces consumers who copy the array to defensively un-freeze. |

### No Installation

Phase 4 adds **zero new runtime or dev dependencies**. Every API consumed (`node:events`, `node:util`, `Promise.resolve()`, `globalThis.setTimeout`) is part of Node 24's standard library or the language. Phase 1's `tsup` + `publint` + `attw` + `vitest` are all already wired. `[VERIFIED: package.json — no `npm install` required for Phase 4]`

**Version verification:** All Phase 4-relevant package versions confirmed against `npm view` on 2026-05-16: `fit-file-parser@3.0.0`, `tsup@8.5.1`, `vitest@4.1.6`, `publint@0.3.21`, `@arethetypeswrong/cli@0.18.2`, `typescript@5.9.3`, `@types/node@24.12.4`. All match `package.json`. No upgrades needed for this phase.

## Architecture Patterns

### System Architecture Diagram

```
                                          ┌──────────────────────────────────────────────┐
   consumer                                │       PUBLIC SURFACE — src/index.ts         │
   ─────                                   │  + createFakeTransport (NEW Phase 4)         │
   import { createFakeTransport }          │  + type ITrainerTransport (NEW Phase 4)      │
       from 'trainer-sim'                  │  + type FakeTransportConfig (NEW Phase 4)    │
                                           │  + type FakeTransportSource (NEW Phase 4)    │
                                           │  + encodeIndoorBikeData / IndoorBikeRecord   │
                                           │  + loadFitFromPath / loadFitFromBuffer       │
                                           │  + RideRecord / FitLoadError family          │
                                           └─────────────────┬────────────────────────────┘
                                                             │
                                                             ▼
                                          ┌──────────────────────────────────────────────┐
                                          │  src/transport/fake-transport.ts (NEW)       │
                                          │                                              │
   transport.connect()  ────────────────► │  1. resolve source variant                   │
                                          │  2. await loadFitFromPath / sync loader      │
                                          │  3. construct Replay(config)                 │
                                          │  4. replay.onRecord((rec) => {               │
                                          │       const dv = encodeIndoorBikeData(...)   │
                                          │       for (const h of subscribers) {         │
                                          │         try { h(dv) } catch { debuglog }     │
                                          │       }                                      │
                                          │     })                                       │
                                          │  5. replay.completed.then(                   │
                                          │       () => emitter.emit('complete'),        │
                                          │       () => {/* aborted — no 'complete' */}, │
                                          │     )                                        │
                                          │  6. replay.start({ sleep? })                 │
                                          │                                              │
   transport.disconnect() ──────────────► │  replay.stop();                              │
                                          │  await replay.completed.catch(()=>undefined) │
                                          │                                              │
   transport.onData(h) ─────────────────► │  subscribers.add(h);                         │
                                          │  return () => subscribers.delete(h)          │
                                          │                                              │
   transport.sendResistance(g) ─────────► │  await Promise.resolve();                    │
                                          │  resistanceLog.push(g)                       │
                                          │                                              │
   transport.received.resistance ───────► │  resistanceLog as ReadonlyArray<number>      │
                                          │                                              │
   transport.reset() ───────────────────► │  await this.disconnect();                    │
                                          │  resistanceLog.length = 0;                   │
                                          │  this.replay = new Replay(...)               │
                                          │  // subscribers Set untouched                │
                                          │                                              │
   await once(transport, 'complete') ───► │  on/off/once pass-through to internal        │
                                          │  EventEmitter<{ complete: [] }>              │
                                          └──────────────┬───────────────────────────────┘
                                                         │ composes
                                                         ▼
                  ┌───────────────────────────────────────────────────────────────────────┐
                  │  src/replay/replay.ts (Phase 3, INTERNAL — D-REPL-12)                 │
                  │  • onRecord(handler) — single subscriber slot (D-REPL-11)             │
                  │  • start({ signal?, sleep? })                                         │
                  │  • stop() (idempotent)                                                │
                  │  • completed: Promise<void> (resolves on natural end; rejects on abort)│
                  │  • currentState: 'idle'|'running'|'done'|'aborted'                    │
                  └────────────────────┬──────────────────────────────────────────────────┘
                                       │ uses
                                       ▼
                  ┌───────────────────────────────────────────────────────────────────────┐
                  │  src/replay/scheduler.ts (Phase 3, INTERNAL — drift-corrected loop)   │
                  └───────────────────────────────────────────────────────────────────────┘

                   ┌─────────────────────────────────────────────┐
                   │  src/fit/loader.ts (Phase 2)                │
                   │  loadFitFromPath / loadFitFromBuffer         │
                   │  → throws FitLoadError family on corruption  │
                   │  → bubbles ENOENT/EACCES from fs/promises    │
                   └─────────────────────────────────────────────┘

                   ┌─────────────────────────────────────────────┐
                   │  src/ftms/indoor-bike-data.ts (Phase 1)     │
                   │  encodeIndoorBikeData({power,cadence})→DataView│
                   └─────────────────────────────────────────────┘
```

### Recommended Project Structure

The structure for Phase 4 is **additive only** — no existing file moves, no existing exports change semantics:

```
src/
├── index.ts                       # ADD 4 export lines (D-API-07)
├── types.ts                       # ADD ITrainerTransport, FakeTransportConfig, FakeTransportSource (D-API-01)
├── ftms/
│   └── indoor-bike-data.ts        # NO CHANGE (Phase 1)
├── fit/
│   ├── loader.ts                  # NO CHANGE (Phase 2)
│   ├── normalize.ts               # NO CHANGE
│   └── errors.ts                  # NO CHANGE
├── replay/
│   ├── replay.ts                  # NO CHANGE (Phase 3)
│   ├── scheduler.ts               # NO CHANGE
│   └── types.ts                   # NO CHANGE
└── transport/                     # NEW DIRECTORY (D-API-18)
    └── fake-transport.ts          # NEW FILE — ~150–200 LOC budget

test/
├── _helpers/                      # NEW DIRECTORY (D-API-24)
│   └── fake-aware-sleep.ts        # NEW FILE — IN-01 lift; ~30 LOC byte-for-byte from Phase 3 test files
├── replay/                        # 4 test files MIGRATE imports to ../_helpers (D-API-24)
│   ├── scheduler.test.ts          # remove local fakeAwareSleep, import from ../_helpers/
│   ├── abort.test.ts              # ditto
│   ├── replay.test.ts             # ditto
│   └── loop.test.ts               # ditto
└── transport/                     # NEW DIRECTORY (D-API-22)
    ├── fake-transport.test.ts     # NEW — factory shape, lifecycle, fan-out, throw isolation, reset()
    ├── path-and-buffer.test.ts    # NEW — { path } and { buffer } against test/fixtures/fit/basic.fit
    └── publish.test.ts            # NEW — publint + attw shell-out; test.slow

package.json                       # NO CHANGE (D-API-08)
tsup.config.ts                     # NO CHANGE
tsconfig.json                      # NO CHANGE (the `include: ['src/**/*']` already covers src/transport/)
tsconfig.test.json                 # NO CHANGE (the `include: ['src/**/*', 'test/**/*']` covers test/transport/ and test/_helpers/)
```

### Pattern 1: Factory-returns-interface, NOT class instance (Composition)

**What:** `createFakeTransport(config)` is a **synchronous factory function** that returns a plain object literal typed as the public `FakeTransport` shape (which extends `ITrainerTransport`). The object's methods close over private factory-scope state (`subscribers`, `resistanceLog`, `replay`, `emitter`).

**When to use:** When the public surface should be the interface, not the class. Avoids leaking `instanceof FakeTransport` as a narrowing path, keeps the door open for v2's `BlenoTransport` to be a sibling factory with the same shape.

**Why prescribed here:** D-API-04 (sync factory) + Claude's Discretion (default to object literal) + ARCHITECTURE.md Pattern 5.

**Example (factory skeleton — see Code Examples §1 below for full version):**
```typescript
// src/transport/fake-transport.ts
export function createFakeTransport(config: FakeTransportConfig): FakeTransport {
  // Validate sync (D-API-06)
  if (!(config.speed === undefined ? 1 : config.speed > 0)) { /* throw */ }
  // Closure-scope state
  const subscribers = new Set<(d: DataView) => void>();
  const resistanceLog: number[] = [];
  const emitter = new EventEmitter<{ complete: [] }>();
  let replay: Replay | undefined;
  // ... return object literal with the closure-bound methods
}
```

### Pattern 2: Composed `EventEmitter`, NOT inheritance

**What:** Construct an `EventEmitter<{ complete: [] }>` inside the factory closure. Expose ONLY `on`, `off`, `once` as thin pass-throughs constrained to the `'complete'` event. The returned object is NOT an `EventEmitter` instance.

**When to use:** When you want a single typed event surface but don't want to inherit ~30 EventEmitter methods (`addListener`, `removeListener`, `setMaxListeners`, `eventNames`, `rawListeners`, etc.) into the public type.

**Why prescribed here:** D-API-11 + D-API-13 + Claude's Discretion (default to typed `EventEmitter<{ complete: [] }>`).

**The typed signature (verified compiling under TS 5.9 + `@types/node@~24` this session):**
```typescript
import { EventEmitter } from 'node:events';
const emitter = new EventEmitter<{ complete: [] }>();
emitter.on('complete', () => {});  // OK — listener has zero args
emitter.emit('complete');           // OK — no args required
emitter.emit('whatever');           // ERROR — 'whatever' not in event map
```
The empty tuple `[]` says "the listener takes zero arguments." `[VERIFIED: tsc --noEmit on /tmp/ee-typed-test.ts this session, exit 0]` `[CITED: nodejs.org/docs/latest-v24.x/api/events.html — EventEmitter generic]`

**The returned-shape pass-through:**
```typescript
type CompleteListener = () => void;
return {
  // ITrainerTransport methods
  connect, disconnect, onData, sendResistance,
  // ...
  // 'complete' event surface — narrowly typed (D-API-13)
  on(event: 'complete', listener: CompleteListener): void { emitter.on(event, listener); },
  off(event: 'complete', listener: CompleteListener): void { emitter.off(event, listener); },
  once(event: 'complete', listener: CompleteListener): void { emitter.once(event, listener); },
};
```
Note: the public `on/off/once` signatures use literal `'complete'` — this is what makes `Pick<EventEmitter, 'on' | 'off' | 'once'>` the WRONG approach (it would inherit the loose `string|symbol` overloads). Declare the three signatures explicitly.

### Pattern 3: Disconnect-then-await-completed for clean teardown

**What:** `disconnect()` calls `replay.stop()` (synchronous abort signal), then awaits `replay.completed.catch(() => undefined)` so the in-flight scheduler microtask fully unwinds before the disconnect Promise resolves.

**When to use:** When the contract is "after `disconnect()` resolves, no further `onData` callbacks fire" (REPL-06 binding contract). Phase 3's CR-01 fix (commit `e4b04a9`) closed the post-sleep abort race inside the scheduler — but the `completed` Promise still rejects asynchronously after `controller.abort()`. Awaiting `completed` lets the rejection observation happen synchronously inside `disconnect()`.

**Why prescribed here:** Open question 5 + REPL-06 binding contract + 03-RESEARCH §AbortController teardown pitfalls.

**The recipe:**
```typescript
async function disconnect(): Promise<void> {
  if (!replay) return;                        // already disconnected
  replay.stop();                              // sync — sets the AbortController
  await replay.completed.catch(() => undefined);  // wait for the scheduler to finish unwinding
  // After this point, the scheduler's last microtask has resolved.
  // No further onData callbacks can fire — the scheduler has exited (Phase 3 D-REPL-10).
}
```

**Why not just `replay.stop(); return;`?** Because `replay.completed` is resolved/rejected asynchronously inside the `runScheduler().then(...)` callback chain in `replay.ts:247–256`. If `disconnect()` returns before that chain settles, a `'complete'` event could (in theory) fire after `disconnect()` resolved — though in practice it won't because D-API-12 says abort does NOT emit `'complete'`. The `await` is defense-in-depth for the contract REPL-06 spells out: "after `disconnect()` resolves, no further `onData` callbacks fire." Resolving the Promise after the scheduler has stopped is the form that makes that contract observable.

**`.catch(() => undefined)` is correct here, not a swallow:** Phase 3's `replay.completed` REJECTS on abort with the `AbortError` from `node:timers/promises` (per D-REPL-09). FakeTransport caused the abort — the rejection is not a surprise. The CR-02 fix in Phase 3 already attached an internal `.catch` to the underlying deferred so the rejection is not unhandled (replay.ts:266); this surface-level `.catch` is for *consuming* the rejection during `disconnect()`, not for marking it handled.

### Pattern 4: `reset()` discards and re-instantiates `Replay`

**What:** Phase 3's D-REPL-07 makes `Replay` single-use — once `start()` has been called, the instance cannot be restarted regardless of state. So `reset()` cannot rewind; it must construct a fresh `Replay`.

**When to use:** When the underlying engine is single-use by design and the public API needs a "reusable across `afterEach()`" surface.

**Why prescribed here:** D-API-14 + Phase 3's D-REPL-07 forces this shape.

**The recipe:**
```typescript
async function reset(): Promise<void> {
  await disconnect();                  // idempotent (D-API-14 step 1)
  resistanceLog.length = 0;            // clear in place; the ReadonlyArray<number> view stays the same reference
  replay = undefined;                  // next connect() will construct a fresh one
  // subscribers Set is intentionally NOT cleared (D-API-14 step 4)
}
```

**Why `resistanceLog.length = 0` and not `resistanceLog = []`?** The factory closure captures `resistanceLog` by reference; the `received.resistance` getter returns the same reference each call. Reassigning the variable would not propagate to the previously-returned `received.resistance` view. Truncating in place keeps the same object identity — important if a consumer happens to hold a reference to `transport.received.resistance` across a `reset()` call.

### Pattern 5: Per-record collapse + fan-out inside `replay.onRecord(...)` callback

**What:** The single `replay.onRecord` callback (one per `Replay` instance — D-REPL-11 single-subscriber slot) does THREE things in this order: (1) collapse `RideRecord.power ?? 0`, `RideRecord.cadence ?? 0`; (2) call `encodeIndoorBikeData({power, cadence})` ONCE per tick; (3) iterate `subscribers` Set with per-handler `try/catch` and fan out the same `DataView`.

**When to use:** Whenever a single producer must serve multiple consumers and the encoding cost is non-trivial (Buffer allocation per call). Encoding once per tick is cheaper than encoding per (record × subscriber).

**Why prescribed here:** D-API-09 (Set fan-out) + D-API-10 (per-handler error isolation) + D-API-20 (per-record collapse policy lives in FakeTransport, not in the loader).

**The recipe (per Code Examples §2):**
```typescript
replay.onRecord((rec: RideRecord) => {
  const dv = encodeIndoorBikeData({
    power: rec.power ?? 0,
    cadence: rec.cadence ?? 0,
  });
  for (const h of subscribers) {
    try { h(dv); } catch (err) { log('subscriber threw: %O', err); }
  }
});
```

**Subtlety: the same `DataView` is shared across all subscribers.** This is intentional — DataView is read-only relative to the encoder's intent (the Buffer is mutated only inside `encodeIndoorBikeData` before it returns). If a subscriber mutates the underlying ArrayBuffer (e.g., calls `view.setUint16(0, 0)`), other subscribers will see the mutation. This is consumer responsibility — Phase 1's D-08 says the encoder allocates fresh memory per call, but does not promise immutability against subscriber mutation. Document in JSDoc: "The DataView passed to handlers should be treated as read-only; copy the bytes if your handler retains them."

### Anti-Patterns to Avoid

- **`class FakeTransport extends EventEmitter` (extending instead of composing).** Inflates the public type by ~30 EventEmitter methods that `ITrainerTransport` does not promise. D-API-11 explicit prohibition.
- **`new ITrainerTransport()` thinking — defining `ITrainerTransport` as a class instead of an interface.** It is a structural-typing contract; class-based would force `instanceof` checks at the consumer boundary.
- **Reaching past `Replay`'s public surface into `runScheduler` / `scheduler.ts`.** D-REPL-12 keeps `Replay` internal; `runScheduler` is a non-export inside `scheduler.ts`. The plan acceptance grep should verify that `src/transport/fake-transport.ts` imports ONLY from `../replay/replay.js`, not `../replay/scheduler.js`.
- **Wrapping `FitLoadError` family in transport-layer errors.** They bubble unchanged from `connect()`'s Promise rejection so consumers can `catch (e instanceof FitLoadError)` (CONTEXT.md §Reusable Assets).
- **`Object.freeze(received)` or `Object.freeze(received.resistance)`.** D-API-17 — type-level readonly is the contract.
- **Eagerly loading the FIT in the factory (sync factory + sync FIT load → blocking constructor).** D-API-04 explicit — FIT load is deferred to `connect()` so filesystem and FIT errors land in the Promise chain.
- **Implementing `sendResistance` as `(grade) => { resistanceLog.push(grade); }` without the microtask boundary.** PITFALLS.md §12 — when v2's `BlenoTransport` lands, tests written against synchronous Fake will fail against async Bleno. Force `await Promise.resolve()` even in v1.
- **Accepting the `FakeTransport` factory's `source.records` variant in consumer-facing tests.** D-API-05 explicit — the `records` variant is for trainer-sim's own tests (skip FIT parse for speed). Document with a JSDoc "do not use in production tests" note.
- **Adding a `received.controlPoint[]` shape now to "future-proof" for v2 GATT FMCP opcodes.** D-API-16 + CLAUDE.md "no abstractions for hypothetical future requirements." V2 will refactor additively when opcodes 0x04/0x05/0x11 land.
- **Breaking the `'trainer-sim:transport'` debuglog convention.** Phase 2 used `:fit`, Phase 3 used `:replay`, Phase 4 must use `:transport` (D-API-10) for opt-in observability symmetry.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Multi-subscriber fan-out | Hand-rolled array with index tracking + bounds checks on disposer | `Set<handler>` with `add`/`delete`/`for…of` | O(1) add/delete; insertion-order iteration; ECMA-spec defined behavior under add/delete during iteration. `[CITED: ECMA-262 §Set.prototype.values]` |
| Typed event emitter for one event | Hand-rolled `subscribers: ((data: T) => void)[]` with custom `on`/`off`/`once` | `EventEmitter<{ complete: [] }>` from `node:events` | Built-in. Cooperates with `events.once(emitter, 'complete')` for `await`-ability in tests. `[CITED: nodejs.org/docs/latest-v24.x/api/events.html]` |
| Promise-aware "fire after current task" | Custom microtask queue, `setImmediate(resolve)` | `await Promise.resolve()` | Single line. Schedules a microtask. `await null` works but is intent-obscure. `queueMicrotask` is wrong — does not return a Promise. `[CITED: ECMA-262 §AwaitExpression]` |
| "Wait for one event" Promise | `new Promise(r => emitter.once('complete', r))` boilerplate at every callsite | `import { once } from 'node:events'; await once(emitter, 'complete')` | Built-in; supports AbortSignal. `[CITED: nodejs.org/docs/latest-v24.x/api/events.html#eventsonceemitter-name-options]` |
| Disposer pattern | Custom subscription object with `.dispose()` method | Plain function: `onData(h) { ...; return () => subscribers.delete(h); }` | Idiomatic for 2026 TS libraries (RxJS-style). Returning the cleanup callback directly is ergonomic in tests: `const off = transport.onData(...); off();`. |
| Resistance log mutation tracking | Observer pattern, dirty flags | Plain `number[]` exposed as `ReadonlyArray<number>` | D-API-17 — type-level readonly is the contract. |

**Key insight:** Phase 4 is the *thinnest* phase by code volume in the project. Every primitive Phase 4 needs (composition over inheritance, factory function, Set-based fan-out, microtask boundary, disposer return, `await once()`) is a single-line built-in or language idiom. The danger is OVER-engineering: a future contributor "improving" the code by adding a strategy pattern, dependency injection container, or generic event-emitter abstraction would defeat the design entirely. Plans should explicitly forbid these refactors and the file should JSDoc-document why composition is chosen over `extends EventEmitter`.

## Common Pitfalls

### Pitfall 1: Forgetting the microtask boundary in `sendResistance`

**What goes wrong:** Implementing `sendResistance(grade) { resistanceLog.push(grade); return Promise.resolve(); }` (or worse, `async sendResistance(grade) { resistanceLog.push(grade); }` with no `await` inside). Both forms cause the Promise to resolve in the SAME microtask the caller's `await` was scheduled in — meaning the `push` is observable BEFORE the caller's next line runs. v2's `BlenoTransport` will need an actual `await` on the BLE write callback, which puts the `push`-observation on a LATER microtask. Tests written against v1 Fake that check timing-related ordering will fail against v2 Bleno.

**Why it happens:** "It's just a fake; it's instant" thinking. The interface contract should be driven by the real transport's needs, not the fake's convenience.

**How to avoid:** Force a microtask boundary in v1 Fake — `await Promise.resolve()` is the canonical idiom. The body becomes:
```typescript
async sendResistance(grade: number): Promise<void> {
  await Promise.resolve();          // microtask boundary — matches v2 BlenoTransport timing
  resistanceLog.push(grade);
}
```
Test assertion pattern (correct):
```typescript
await transport.sendResistance(0.05);
expect(transport.received.resistance).toEqual([0.05]);
```

**Warning signs:** Tests that pass alone but fail when run together (interleaved promise queues). Tests that pass with FakeTransport but fail with BlenoTransport in v2.

**Source:** PITFALLS.md §12 (CITED — already in repo at `.planning/research/PITFALLS.md` lines 313–335).

### Pitfall 2: Letting `instanceof FakeTransport` leak into the public type

**What goes wrong:** Returning `class FakeTransport { ... }` instances instead of an object literal. Consumers can write `if (transport instanceof FakeTransport) ...` for type narrowing, which couples them to an implementation detail. When v2 ships `BlenoTransport`, the consumer code that narrowed against `FakeTransport` breaks silently — the BlenoTransport satisfies `ITrainerTransport` shape but is not `instanceof FakeTransport`.

**Why it happens:** Class-based factory feels natural to OO-trained developers. TypeScript happily infers `FakeTransport` as the return type if you `return new FakeTransport(...)`.

**How to avoid:** Return a plain object literal typed as a narrow public-shape type that extends `ITrainerTransport`. Example:
```typescript
export interface FakeTransport extends ITrainerTransport {
  readonly received: { resistance: ReadonlyArray<number> };
  reset(): Promise<void>;
  on(event: 'complete', listener: () => void): void;
  off(event: 'complete', listener: () => void): void;
  once(event: 'complete', listener: () => void): void;
}

export function createFakeTransport(config: FakeTransportConfig): FakeTransport {
  // ...
  return { connect, disconnect, onData, sendResistance, received: { /* getter */ }, reset, on, off, once };
}
```

**Warning signs:** A consumer writing `transport instanceof FakeTransport` in their tests; an `export class FakeTransport` in `src/transport/fake-transport.ts`.

### Pitfall 3: `onData` handler removing itself during fan-out

**What goes wrong:** A handler that does `transport.onData(h)` and then inside `h` calls the disposer (or another handler's disposer). During the `for (const h of subscribers)` iteration, mutating the Set could surprise the iterator.

**Why it happens:** Tests that subscribe-then-immediately-unsubscribe-on-first-call to "wait for one frame" will hit this.

**How to avoid:** Don't snapshot the Set. ECMA-262 specifies `Set.prototype[@@iterator]` behavior under mutation: entries added during iteration ARE visited; entries deleted that have not yet been visited are NOT visited. This is exactly what we want — a self-removing handler is invoked once (the current iteration step), then removed for future emissions. No snapshot needed; no defensive copy. `[CITED: ECMA-262 §24.2.5.1 Set.prototype[@@iterator]]`

If a handler **adds** a new handler during fan-out: the new handler is called as part of THE SAME emission. This is a subtle case — if a test wants "register-then-be-called-on-the-NEXT-emission," it must defer registration with a microtask. Document this in JSDoc with an example. The `Set` semantics here match exactly what the `EventEmitter` does for synchronous `emit` — consumers used to EventEmitter will not be surprised.

**Warning signs:** A handler that mutates the subscriber set during `emit` produces fewer (or more) callbacks than expected.

### Pitfall 4: `vi.useFakeTimers()` does not intercept `node:timers/promises`

**What goes wrong:** Phase 3's `runScheduler` imports `setTimeout` from `node:timers/promises`. Vitest 4's `vi.useFakeTimers()` only intercepts `globalThis.setTimeout` — NOT the `node:timers/promises` module-level binding. Tests that drive the scheduler under fake timers without injecting a `globalThis.setTimeout`-based sleep will hang because the real `node:timers/promises.setTimeout` waits real time.

**Why it happens:** ESM static imports of built-in `node:` modules are captured at module-load time; `vi.useFakeTimers()` runs after that and cannot retroactively intercept the binding.

**How to avoid:** This is already solved in Phase 3 — `Replay.start({ sleep })` accepts a sleep injection seam, and the 4 Phase 3 test files all pass a `globalThis.setTimeout`-based `fakeAwareSleep`. Phase 4's `fake-transport.test.ts` (which uses `{ records: [...] }` source variant) and `path-and-buffer.test.ts` (which uses `{ path }`/`{ buffer }`) MUST do the same: pass `sleep: fakeAwareSleep` through the FakeTransport factory's optional test seam.

**Question for the planner:** Does Phase 4's FakeTransport factory expose a `sleep?` injection seam? **Yes** — it must, because tests need to drive the scheduler under fake timers. The seam is internal (not in `FakeTransportConfig`), passed through to `Replay.start({ sleep })`. Suggested API: `createFakeTransport(config, options?: { sleep?: SleepFn })` where `SleepFn` matches the Phase 3 type. Alternatively, expose a non-public test-only export. The cleaner form is the second-arg `options` object — keeps the public `config` clean, makes the test seam discoverable in JSDoc as "test-only — do not use in production code."

**Warning signs:** Phase 4 tests hanging until the Vitest test timeout fires (5 s default).

**Source:** Phase 3 RESEARCH §Pitfall 6 + scheduler.ts:131–139 + Phase 3 test files.

### Pitfall 5: Multi-import of `Replay` outside `src/transport/`

**What goes wrong:** A future contributor imports `Replay` from `src/replay/replay.js` into a non-transport file (e.g., for "convenience"). This widens the surface area Phase 3 deliberately kept narrow (D-REPL-12).

**Why it happens:** Composition-over-inheritance + one-file-per-transport invites "I'll just instantiate `Replay` directly in this script."

**How to avoid:** Single-import-seam pattern (Phase 2 D-FIT-08, Phase 3's `node:timers/promises`). The plan acceptance grep should verify:
```bash
# Inside src/, ONLY src/transport/fake-transport.ts may import from src/replay/.
# (Tests under test/replay/ are exempt — they import from '../../src/replay/replay.js'.)
grep -rn "from '\.\./replay" src/ | grep -v "^src/transport/fake-transport.ts" || echo "clean"
```

**Warning signs:** A grep for `from '../replay/` inside `src/` returns more than one file (the one being `src/transport/fake-transport.ts`).

### Pitfall 6: The `disconnect()` returns before scheduler microtasks drain

**What goes wrong:** `disconnect() { replay.stop(); return; }` resolves synchronously while the scheduler's `runScheduler().then(success, failure)` callback chain is still scheduled to run. Under specific microtask interleavings (rare but documentable in CR-01-style reproducers), a `'complete'` event listener could fire AFTER `disconnect()` resolved.

**Why it happens:** `replay.stop()` is synchronous (sets the `AbortController`), but the scheduler's reaction (the `.then(...)` callback that flips state to `'aborted'` and rejects `completedDeferred`) lands on a later microtask.

**How to avoid:** `await replay.completed.catch(() => undefined)` AFTER `replay.stop()`. By the time `completed` settles (resolved on natural end OR rejected on abort), the scheduler's full reaction has completed — including the moment when `state` transitions from `running` to `aborted`. After the await, `replay.completed` is settled and any `replay.completed.then(...)` listener in the FakeTransport (the one that emits `'complete'`) has already had a chance to NOT emit (per D-API-12, abort does not emit `'complete'`).

**Warning signs:** A "wait 100 ms after disconnect, assert zero `'complete'` emissions" test that fails intermittently. (Phase 3's existing CR-01 test is the closest analog — it asserts no record emission after `stop()`; Phase 4 needs the equivalent for `'complete'` event.)

### Pitfall 7: `package.json`'s `files` whitelist excludes new tests/types

**What goes wrong:** `files: ['dist', 'README.md', 'LICENSE.md']` in `package.json` already covers everything Phase 4 emits — but only because `tsup` builds Phase 4's `src/transport/fake-transport.ts` into `dist/index.js` (single-entry build, tree-shaken). If a future contributor splits the entry points (e.g., adds `entry: ['src/index.ts', 'src/transport/index.ts']`), the `files` array would still cover `dist/` — but the `exports` map would need updating.

**Why it happens:** Phase 4's `tsup.config.ts` keeps `entry: ['src/index.ts']`, so all of FakeTransport gets bundled into `dist/index.js`. The single root entry IS the recommended shape.

**How to avoid:** Don't change `tsup.config.ts` or `package.json` in Phase 4. Verify after build that `dist/index.js` and `dist/index.d.ts` contain the new exports. The `publish.test.ts` in Phase 4 will catch any regression by running `publint` and `attw` against the freshly-built dist.

**Warning signs:** `publint` reports `EXPORTS_VALUE_NOT_PROVIDED` for `createFakeTransport` (would only happen under a botched manual entry-points split).

### Pitfall 8: Subscriber-throws aborts the loop

**What goes wrong:** A handler that throws (e.g., a test assertion `expect(...).toBe(...)` mismatch) aborts the `for…of` iteration over subscribers — later subscribers do not receive the emission.

**Why it happens:** `for…of` propagates exceptions out of the iteration body by default.

**How to avoid:** Wrap each handler invocation in `try/catch`:
```typescript
for (const h of subscribers) {
  try { h(dv); } catch (err) { log('subscriber threw: %O', err); }
}
```
This is **D-API-10 verbatim**. The `debuglog('trainer-sim:transport')` swallow ensures the throw doesn't propagate but is observable via `NODE_DEBUG=trainer-sim:transport`.

**Prior art:** The same try/catch-per-handler pattern appears in:
- Node's `EventEmitter` synchronous emit when `captureRejections: false` (default) — actually NO, EventEmitter propagates the throw out of `emit()`. So this pattern is *stricter* than EventEmitter's default. `[CITED: nodejs.org/docs/latest-v24.x/api/events.html#capture-rejections-of-promises — captureRejections only handles async listeners]`
- MSW (`msw/lib/core/handlers/RestHandler`) — wraps each interceptor invocation in try/catch.
- Sinon's `sinon.fakeServer` — fans out to all subscribers regardless of one throwing.

**Warning signs:** A test that registers `(data) => { expect(data.byteLength).toBe(8) }` as one handler and a separate `(data) => { received.push(data) }` as another, expects the second to receive the emission even when the first throws. Without per-handler try/catch, the second never sees it.

## Runtime State Inventory

This is a code-and-config-only phase. The phase changes only:
- Adds `src/transport/fake-transport.ts` (new file)
- Adds 4 export lines to `src/index.ts` (existing file)
- Adds `ITrainerTransport`, `FakeTransportConfig`, `FakeTransportSource` to `src/types.ts` (existing file)
- Creates `test/_helpers/fake-aware-sleep.ts` (new file)
- Migrates 4 Phase 3 test files to import the helper from the new location (in-place edits)
- Creates 3 new test files under `test/transport/` (new files)

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — phase ships no persistent state. | None. |
| Live service config | None — phase ships no service. | None. |
| OS-registered state | None — no Task Scheduler / launchd / pm2 / systemd entries. | None. |
| Secrets/env vars | `NODE_DEBUG=trainer-sim:transport` (NEW debuglog namespace). Opt-in observability only — does not exist as a stored value; consumers set it at runtime. | None — documented in JSDoc only. |
| Build artifacts | `dist/index.js` / `dist/index.cjs` / `dist/index.d.ts` / `dist/index.d.cts` already emitted by Phase 1. Phase 4 changes their CONTENT (adds `createFakeTransport` + 3 type exports) but not their LOCATION or NAMES. | After phase completes, consumers who installed `0.0.1` will see `0.0.2` (or whatever Phase 4 bumps to) ship the new exports — purely additive. No artifact rename. |

**Nothing found in any rename/refactor category** — verified by reviewing the file diff list above. Phase 4 is purely additive at the public-surface level (new exports, new files, no renames, no removed exports).

## Code Examples

Verified patterns. Inline-cited where the source is Node docs or repo files.

### Code Example 1: The factory skeleton

```typescript
// src/transport/fake-transport.ts
//
// Public factory. Per D-API-04: synchronous; FIT load deferred to connect().
// Per D-API-11: composes EventEmitter; does NOT extend.
// Per ARCHITECTURE.md Pattern 5 + Claude's Discretion: returns a plain object literal.

import { EventEmitter } from 'node:events';
import { debuglog } from 'node:util';
import { encodeIndoorBikeData } from '../ftms/indoor-bike-data.js';
import { loadFitFromBuffer, loadFitFromPath } from '../fit/loader.js';
import { Replay } from '../replay/replay.js';
import type {
  FakeTransport,
  FakeTransportConfig,
  ITrainerTransport,
  RideRecord,
} from '../types.js';

const log = debuglog('trainer-sim:transport');

export function createFakeTransport(config: FakeTransportConfig): FakeTransport {
  // Sync validation (D-API-06 + Phase 3 followup WR-05 fold per D-API-25)
  const speed = config.speed ?? 1;
  const loop = config.loop ?? false;
  const maxEmissionHz = config.maxEmissionHz ?? 1000;
  if (!(speed > 0)) {
    throw new Error(`createFakeTransport: speed must be > 0, got ${String(speed)}`);
  }
  if (!(maxEmissionHz > 0)) {
    throw new Error(
      `createFakeTransport: maxEmissionHz must be > 0, got ${String(maxEmissionHz)}`,
    );
  }

  // Closure-scope state (D-API-09 / D-API-11 / D-API-17)
  const subscribers = new Set<(data: DataView) => void>();
  const resistanceLog: number[] = [];
  const emitter = new EventEmitter<{ complete: [] }>();
  let replay: Replay | undefined;

  async function loadRecords(): Promise<ReadonlyArray<RideRecord>> {
    const src = config.source;
    if ('records' in src) return src.records;
    if ('buffer' in src) return loadFitFromBuffer(src.buffer);
    return loadFitFromPath(src.path);
  }

  async function connect(): Promise<void> {
    if (replay !== undefined) return;  // idempotent (defense-in-depth; tests can re-call)
    const records = await loadRecords();
    replay = new Replay({ records, speed, loop, maxEmissionHz });
    replay.onRecord((rec) => {
      const dv = encodeIndoorBikeData({
        power: rec.power ?? 0,           // D-API-20 — the ONLY place absent→0 collapses
        cadence: rec.cadence ?? 0,
      });
      for (const h of subscribers) {
        try { h(dv); } catch (err) { log('subscriber threw: %O', err); }
      }
    });
    // Wire 'complete' on natural completion; abort path is silent (D-API-12).
    replay.completed.then(
      () => emitter.emit('complete'),
      () => undefined,
    );
    replay.start();
  }

  async function disconnect(): Promise<void> {
    if (replay === undefined) return;  // already disconnected
    const r = replay;
    replay = undefined;
    r.stop();
    await r.completed.catch(() => undefined);  // Pattern 3 above
  }

  function onData(handler: (data: DataView) => void): () => void {
    subscribers.add(handler);
    return () => { subscribers.delete(handler); };
  }

  async function sendResistance(grade: number): Promise<void> {
    await Promise.resolve();           // microtask boundary (PITFALLS.md §12)
    resistanceLog.push(grade);
  }

  async function reset(): Promise<void> {
    await disconnect();
    resistanceLog.length = 0;          // truncate in place (Pattern 4 above)
    // subscribers Set NOT cleared (D-API-14 step 4)
  }

  type CompleteListener = () => void;
  const transport: FakeTransport = {
    connect,
    disconnect,
    onData,
    sendResistance,
    get received() {
      return { resistance: resistanceLog as ReadonlyArray<number> };
    },
    reset,
    on(event: 'complete', listener: CompleteListener): void { emitter.on(event, listener); },
    off(event: 'complete', listener: CompleteListener): void { emitter.off(event, listener); },
    once(event: 'complete', listener: CompleteListener): void { emitter.once(event, listener); },
  };
  return transport;
}
```

### Code Example 2: The type definitions

```typescript
// src/types.ts (additions; existing RideRecord stays)
//
// Per D-API-01: trainer-sim is the canonical definer of ITrainerTransport.
// Per D-API-13: ITrainerTransport does NOT include event-emitter methods.

import type { Buffer } from 'node:buffer';
import type { RideRecord } from './types.js';  // self-reference; remove in actual file

/**
 * Transport contract — what trainer-sim's FakeTransport (and v2's BlenoTransport)
 * provide, and what consumers (e.g., VeloWorld) program against.
 */
export interface ITrainerTransport {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  onData(handler: (data: DataView) => void): () => void;
  sendResistance(grade: number): Promise<void>;
}

/**
 * FIT input source for FakeTransport. Discriminated union — the consumer is
 * explicit about which load path runs at connect() time.
 *
 * `records` is for trainer-sim's OWN tests — skip FIT parse for speed.
 * Consumer-facing tests SHOULD use `path` or `buffer` so the FIT path stays
 * exercised end-to-end.
 */
export type FakeTransportSource =
  | { path: string }
  | { buffer: Buffer | Uint8Array }
  | { records: ReadonlyArray<RideRecord> };

/**
 * Top-level config for createFakeTransport. Defaults applied in the factory:
 *   speed = 1, loop = false, maxEmissionHz = 1000.
 */
export interface FakeTransportConfig {
  source: FakeTransportSource;
  speed?: number;
  loop?: boolean;
  maxEmissionHz?: number;
}

/**
 * Public return type of createFakeTransport. Extends ITrainerTransport with
 * the FakeTransport-specific affordances (received log, reset, complete event).
 */
export interface FakeTransport extends ITrainerTransport {
  readonly received: { resistance: ReadonlyArray<number> };
  reset(): Promise<void>;
  on(event: 'complete', listener: () => void): void;
  off(event: 'complete', listener: () => void): void;
  once(event: 'complete', listener: () => void): void;
}
```

### Code Example 3: `src/index.ts` additions (D-API-07)

```typescript
// src/index.ts — current exports unchanged; add 4 lines for Phase 4.

export { encodeIndoorBikeData } from './ftms/indoor-bike-data.js';
export type { IndoorBikeRecord } from './ftms/indoor-bike-data.js';

export { loadFitFromPath, loadFitFromBuffer } from './fit/loader.js';
export type { RideRecord } from './types.js';
export {
  FitLoadError,
  InvalidFitHeaderError,
  FitCrcError,
  FitTruncatedError,
  NoRecordMessagesError,
} from './fit/errors.js';

// Phase 4 additions (D-API-07):
export { createFakeTransport } from './transport/fake-transport.js';
export type {
  ITrainerTransport,
  FakeTransport,                      // the wider public-shape type for narrowing
  FakeTransportConfig,
  FakeTransportSource,
} from './types.js';
```

The CONTEXT lock D-API-07 lists three type exports (`ITrainerTransport`, `FakeTransportConfig`, `FakeTransportSource`). Adding `FakeTransport` (the narrow return-shape type) is a Claude's-Discretion choice that costs nothing and gives consumers a way to annotate variables: `const transport: FakeTransport = createFakeTransport(...)`. The planner may decide whether to include it; if not, consumers can use `ReturnType<typeof createFakeTransport>` as a workaround.

### Code Example 4: The lifted `fakeAwareSleep` helper

```typescript
// test/_helpers/fake-aware-sleep.ts
//
// Lifted from 4 Phase 3 test files (test/replay/{scheduler,abort,replay,loop}.test.ts).
// Phase 3 followup IN-01 / Phase 4 D-API-24.
//
// Why this helper exists: Vitest 4's vi.useFakeTimers() does NOT intercept the
// node:timers/promises module-level binding (Phase 3 RESEARCH §Pitfall 6).
// Phase 3's scheduler accepts an optional `sleep` injection seam; tests pass
// THIS helper through Replay.start({ sleep }) (and Phase 4 will do the same
// through the FakeTransport factory's test-only `sleep` option).

/**
 * AbortSignal-aware sleep using `globalThis.setTimeout` (which Vitest's
 * `vi.useFakeTimers()` intercepts). Matches the Phase 3 SleepFn signature
 * in src/replay/scheduler.ts. Identical bytes across all 4 Phase 3 test
 * files — this lift is a pure refactor.
 */
export function fakeAwareSleep(
  delay: number,
  _value?: undefined,
  options?: { signal?: AbortSignal },
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const signal = options?.signal;
    if (signal?.aborted) {
      const err = new Error('The operation was aborted');
      (err as { name: string }).name = 'AbortError';
      reject(err);
      return;
    }
    const onAbort = (): void => {
      clearTimeout(handle);
      const err = new Error('The operation was aborted');
      (err as { name: string }).name = 'AbortError';
      reject(err);
    };
    const handle = globalThis.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, delay);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
```

**Migration cost:** zero behavioral change. The helper bytes are identical across the 4 Phase 3 test files (verified by reading scheduler.test.ts:42–67, abort.test.ts:37–62, replay.test.ts:42–67, loop.test.ts:28–53 — all four are byte-for-byte the same except for one comment-line variation that does not affect runtime). Each Phase 3 test file gains:
```typescript
import { fakeAwareSleep } from '../_helpers/fake-aware-sleep.js';
```
…and loses the local `function fakeAwareSleep(...)` definition. The plan should commit this lift as the FIRST task in Wave 1 (before any new transport code lands) so subsequent Phase 4 transport tests can import from the new helper without conflict.

### Code Example 5: The `await once()` test pattern

```typescript
// test/transport/fake-transport.test.ts (excerpt)
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { once } from 'node:events';
import { createFakeTransport } from '../../src/index.js';
import { fakeAwareSleep } from '../_helpers/fake-aware-sleep.js';
import type { RideRecord } from '../../src/types.js';

describe('FakeTransport', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('emits complete event on natural end (await once cooperates with fake timers)', async () => {
    const records: RideRecord[] = [
      { timestamp: 1000 }, { timestamp: 1100 }, { timestamp: 1200 },
    ];
    const transport = createFakeTransport(
      { source: { records } },
      { sleep: fakeAwareSleep },          // test-only seam — see Pitfall 4
    );
    const emitted: DataView[] = [];
    transport.onData((dv) => emitted.push(dv));

    const completePromise = once(transport, 'complete');
    await transport.connect();
    await vi.advanceTimersByTimeAsync(300);
    await completePromise;                 // resolves with [] (the emit('complete') has no args)

    expect(emitted).toHaveLength(3);
  });
});
```

**Why `once()` cooperates with `vi.useFakeTimers()`:** the `'complete'` event fires inside the `replay.completed.then(() => emitter.emit('complete'), ...)` callback chain. When `vi.advanceTimersByTimeAsync(300)` advances the fake clock, the scheduler resolves naturally → `replay.completed` resolves → the `.then()` callback (which calls `emitter.emit('complete')`) lands on the next microtask → `once()`'s internal listener fires → `completePromise` resolves. Microtasks drain naturally inside `vi.advanceTimersByTimeAsync()` per Vitest's documented behavior. `[CITED: nodejs.org/docs/latest-v24.x/api/events.html#eventsonceemitter-name-options + Vitest docs on advanceTimersByTimeAsync]`

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `class FakeTransport extends EventEmitter` (every Node mock library 2015–2020) | Composition: `EventEmitter` instance inside a factory closure | TS 4+ ecosystem (~2022) — types-first design discourages widening public surface | D-API-11 explicit; matches MSW / Nock / Sinon-fake-timers patterns. |
| Single sync `setTimeout(fn, 0)` for "next-tick" boundary | `await Promise.resolve()` (microtask) or `setImmediate(fn)` (macrotask, only when needed) | TC39 Promise stage 4 (~2018), `Promise.withResolvers()` stage 4 (Node 22+) | PITFALLS.md §12. Microtask is what you usually want for "logical async boundary." |
| Hand-rolled deferred promise (`let resolve, reject; new Promise(...)`) | `Promise.withResolvers()` (TC39 stage 4 / Node 22+) | Phase 3 already adopted this in `replay.ts:125` | No-op for Phase 4 (Phase 3 owns the deferred). |
| `AbortController` + manual `signal.addEventListener('abort', ...)` plumbing | `AbortSignal.any([...])` for composition; `node:timers/promises.setTimeout` accepts `signal` natively | Node 20+ stable, used in Phase 3's scheduler | Phase 4 inherits — no new abort-composition code needed. |
| Single-rooted `exports: './dist/index.js'` (string form) | Conditional `exports: { '.': { import: { types, default }, require: { types, default } } }` | publint enforces "types-first, default-last" since 0.2.x | Already in place from Phase 1. `[VERIFIED: publint green this session]` |

**Deprecated/outdated:**
- `bleno` package (the original Sandeep Mistry one) — last release 2018; replaced by `@stoprocent/bleno` for v2 work. Not relevant to Phase 4 (no BLE in v1).
- `Pick<EventEmitter, 'on' | 'off' | 'once'>` for "narrow EventEmitter surface" — inherits the loose `string|symbol` overloads. Use a literal-typed declaration instead (Pattern 2 above).

## Assumptions Log

This research drew on existing repo files, locked CONTEXT decisions, official Node 24 + publint docs, and TS 5.9 compilation checks run THIS session. The few claims marked `[ASSUMED]`:

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The same DataView reference passed to multiple subscribers is consumer-acceptable; consumers should treat it as read-only. | Pattern 5 (per-record collapse) | LOW — if a future consumer mutates the DataView mid-fan-out, only that consumer sees the corruption (Set iteration is in-progress and the encode happens once per tick). The plan should JSDoc-document the read-only intent. The mitigation is documentation, not code. |
| A2 | Vitest 4's `vi.advanceTimersByTimeAsync()` drains microtasks between fake-timer advances such that `await once(transport, 'complete')` resolves before the test's next assertion. | Pitfall 4 / Code Example 5 | LOW — this is the documented Vitest behavior and Phase 3's tests already rely on it (`replay.test.ts` Group 1). If a Phase 4 test exposes a counterexample, fall back to `await new Promise(setImmediate)` between advance + assertion. |
| A3 | A consumer who copies `transport.received.resistance` defensively gets a real `number[]` they can mutate; the type-level `ReadonlyArray<number>` is honored only by the type checker. | Pattern 4 / D-API-17 | NONE — this is what `ReadonlyArray<T>` means. The CONTEXT lock D-API-17 explicitly accepts this posture. |

**Everything else in this research is `[VERIFIED]` against repo files, `[CITED]` to Node 24 / publint / ECMA-262 docs, or directly cited from the locked CONTEXT decisions in `04-CONTEXT.md`.**

## Open Questions

All of the originally-listed open questions resolved during research. Recapping resolutions:

1. **publint + attw delta when `src/index.ts` adds new exports** — RESOLVED. `package.json` `exports` map is single-rooted (`"."` only) and `tsup` builds a single entry point (`src/index.ts`). New exports flow through unchanged. publint and attw both green this session against current dist; the only thing Phase 4 changes is the CONTENT of `dist/index.js` / `.d.ts` / `.cjs` / `.d.cts`. No `package.json` or `tsup.config.ts` edit needed. **`publish.test.ts` confirms post-Phase-4.**

2. **Typed `EventEmitter<T>` form** — RESOLVED. `EventEmitter<{ complete: [] }>` (empty tuple = zero-arg listener). VERIFIED compiling under TS 5.9 + `@types/node@~24` this session. `[CITED: nodejs.org/docs/latest-v24.x/api/events.html — EventEmitter generic was stable in Node 22; Node 24 inherits]`

3. **Microtask boundary primitive** — RESOLVED. `await Promise.resolve()`. `queueMicrotask` is wrong (no Promise return); `await null` works but is intent-obscure. ECMA-262 §AwaitExpression confirms both `await Promise.resolve()` and `await null` schedule a microtask.

4. **Object-literal-with-internal-EventEmitter return shape** — RESOLVED. Declare `interface FakeTransport extends ITrainerTransport { /* received, reset, on/off/once */ }` and return a plain object literal typed as `FakeTransport`. The on/off/once signatures use literal `'complete'` event-name (NOT `Pick<EventEmitter, 'on' | 'off' | 'once'>` — that inherits loose overloads).

5. **AbortController composition for `disconnect()`** — RESOLVED. `replay.stop(); await replay.completed.catch(() => undefined);` is the form that satisfies REPL-06 binding contract. Phase 3's CR-01 fix already closes the post-sleep abort race inside the scheduler; the await-completed pattern adds defense-in-depth at the FakeTransport boundary.

6. **`once()` + `vi.useFakeTimers()` cooperation** — RESOLVED. `await once(transport, 'complete')` cooperates because emit happens inside a `replay.completed.then(...)` microtask which drains during `vi.advanceTimersByTimeAsync()`. Same pattern Phase 3 already uses in `replay.test.ts` Group 1.

7. **Subscriber-throws + Set iteration** — RESOLVED. ECMA-262 §Set.prototype[@@iterator] specifies behavior under add/delete during iteration; per-handler `try/catch` handles the throw case independently. A handler removing itself during emit is invoked once and not re-invoked on the next emission. A handler adding a new handler during emit causes the new handler to be invoked in the SAME emission (consumer responsibility to defer if undesired).

8. **`fakeAwareSleep` migration cost** — RESOLVED. ZERO behavioral change. The helper bytes are byte-for-byte identical across the 4 Phase 3 test files (verified by reading lines 42–67 of scheduler.test.ts, 37–62 of abort.test.ts, 42–67 of replay.test.ts, 28–53 of loop.test.ts). Lift to `test/_helpers/fake-aware-sleep.ts`; each Phase 3 test file replaces the local definition with one import line. **The plan should land the lift as the FIRST task in the phase so subsequent transport tests can import from the new location without conflict.**

9. **Phase 2 fixture choice for `{ path }` and `{ buffer }` tests** — RESOLVED. `test/fixtures/fit/basic.fit` is the right pick per D-API-22 — confirmed against D-FIT-05 fixture map (443 records, 7 minutes, ROUVY clean 1Hz, 28 zero-power records — exercises the `rec.power ?? 0` collapse path naturally). `autopause.fit` is NOT needed (its purpose is gap-timing-preservation, which Phase 3 already verifies). `perf-1hr.fit` is NOT needed (soak proxy — Phase 3 territory).

10. **`package.json` / `tsup.config.ts` changes** — RESOLVED. NONE. The `exports` map already single-rooted; `tsup` already single-entry; `files` array already covers `dist/`; `prepublishOnly` chains `validate && test` and the new `test/transport/` directory is picked up by Vitest's default file pattern (`test/**/*.{test,spec}.{js,ts}`).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Runtime | ✓ | 24.15.0 | — |
| npm | Package management; `npm run build` shell-out from `publish.test.ts` | ✓ | — | — (`publish.test.ts` is the only test that shells out) |
| TypeScript | Compile | ✓ | 5.9.3 (devDep, locked in `package.json`) | — |
| `tsup` | Build | ✓ | 8.5.1 (devDep) | — |
| `vitest` | Test | ✓ | 4.1.6 (devDep) | — |
| `publint` | Validate `exports` | ✓ | 0.3.21 (devDep); verified passing against current `dist/` | — |
| `@arethetypeswrong/cli` | Validate types | ✓ | 0.18.2 (devDep); verified passing against current `dist/` | — |
| `fit-file-parser` | Phase 2 loader (called by `path-and-buffer.test.ts`) | ✓ | 3.0.0 (runtime dep) | — |

**Missing dependencies with no fallback:** None.
**Missing dependencies with fallback:** None.

## Validation Architecture

`workflow.nyquist_validation` is `false` in `.planning/config.json`. **Section skipped per init contract.**

## Security Domain

`security_enforcement` is not set in `.planning/config.json` (defaulted to enabled per the init contract). Phase 4's surface is in-process library code with no network or filesystem state changes beyond reading consumer-supplied FIT paths. Applicable controls:

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — (no auth surface) |
| V3 Session Management | no | — (no session) |
| V4 Access Control | no | — (no multi-user model) |
| V5 Input Validation | yes | Factory-level sync validation of `speed > 0` / `maxEmissionHz > 0` (D-API-06). `source` is a TypeScript discriminated union — the type system enforces the three valid shapes at the consumer boundary. FIT format validation (header + CRC + magic) is owned by Phase 2's loader and is unchanged. |
| V6 Cryptography | no | — (no crypto in trainer-sim) |
| V7 Errors / Logging | yes | `util.debuglog('trainer-sim:transport')` for subscriber-throw observability (D-API-10). FIT format errors bubble unchanged from `loadFitFromPath`/`loadFitFromBuffer` so consumers can pattern-match `e instanceof FitLoadError`. |
| V12 Files | yes | FIT path is consumer-supplied; bubbled `ENOENT`/`EACCES` from `fs/promises.readFile`. Phase 2's loader caps file size at 50 MB (PITFALLS.md security mistake — already implemented). Phase 4 adds NO new file surface. |

### Known Threat Patterns for trainer-sim's stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Subscriber registered then never disposed (memory leak) | DoS | The `onData` disposer pattern. Tests should call disposers in `afterEach`. JSDoc the disposer return type. |
| Subscriber that throws aborts the emit loop | DoS | D-API-10 — per-handler `try/catch` + `debuglog`. |
| Consumer mutates `transport.received.resistance` array (we expose the underlying `number[]`) | Tampering | Type-level `ReadonlyArray<number>` is the contract (D-API-17). Mutation is a TypeScript-level violation; runtime mutation is consumer's problem. |
| Consumer holds reference to `transport.received.resistance` across `reset()`, expects it to update | Tampering / unintended interface | The `resistanceLog.length = 0` truncates in place — same reference; it WILL update. This is the intended behavior; document in JSDoc. |
| Concurrent `connect()` + `disconnect()` race | DoS | Both are async; `connect()` is idempotent (early-returns when `replay !== undefined`); `disconnect()` is idempotent (early-returns when `replay === undefined`); the `replay = undefined` reset happens BEFORE the `await replay.completed`, so a re-entrant `connect()` constructs a fresh `Replay` cleanly. Plan should add a test for "rapid connect/disconnect/connect" sequencing. |

## Sources

### Primary (HIGH confidence)

- `/Users/agniveshpatel/dev/agni21/trainer-sim/.planning/phases/04-faketransport-public-api/04-CONTEXT.md` — D-API-01..26, all locked decisions cited verbatim
- `/Users/agniveshpatel/dev/agni21/trainer-sim/.planning/REQUIREMENTS.md` — API-01..08
- `/Users/agniveshpatel/dev/agni21/trainer-sim/.planning/ROADMAP.md` §Phase 4 — success criteria + microtask-boundary note
- `/Users/agniveshpatel/dev/agni21/trainer-sim/.planning/research/ARCHITECTURE.md` Patterns 1, 4, 5; Anti-Patterns 1, 5, 6
- `/Users/agniveshpatel/dev/agni21/trainer-sim/.planning/research/PITFALLS.md` §12 (sendResistance async) + §13 (BLE-type leak)
- `/Users/agniveshpatel/dev/agni21/trainer-sim/.planning/research/STACK.md` — publint + attw + tsup config (Phase 1 dual-publish in place)
- `/Users/agniveshpatel/dev/agni21/trainer-sim/.planning/phases/03-replay-engine/03-CONTEXT.md` — D-REPL-07/08/09/11/12/13 (Phase 3 lock context for FakeTransport composition)
- `/Users/agniveshpatel/dev/agni21/trainer-sim/.planning/phases/03-replay-engine/03-RESEARCH.md` lines 529–545 — explicit Phase 4 wiring sketch
- `/Users/agniveshpatel/dev/agni21/trainer-sim/.planning/phases/02-fit-loader-normalization/02-CONTEXT.md` D-FIT-05 — fixture map (basic.fit confirmed)
- `/Users/agniveshpatel/dev/agni21/trainer-sim/src/index.ts` — current public surface (+4 lines for Phase 4)
- `/Users/agniveshpatel/dev/agni21/trainer-sim/src/types.ts` — current `RideRecord`; gains `ITrainerTransport`/`FakeTransport`/`FakeTransportConfig`/`FakeTransportSource`
- `/Users/agniveshpatel/dev/agni21/trainer-sim/src/replay/replay.ts` — `Replay` class with `Promise.withResolvers()` deferred + CR-01/CR-02 fixes (commit `e4b04a9`)
- `/Users/agniveshpatel/dev/agni21/trainer-sim/src/fit/loader.ts` — `loadFitFromPath` (async) + `loadFitFromBuffer` (sync)
- `/Users/agniveshpatel/dev/agni21/trainer-sim/src/fit/errors.ts` — `FitLoadError` family bubbling unchanged
- `/Users/agniveshpatel/dev/agni21/trainer-sim/src/ftms/indoor-bike-data.ts` — `encodeIndoorBikeData({ power, cadence, speed? })`; per-record call site for D-API-20
- `/Users/agniveshpatel/dev/agni21/trainer-sim/test/replay/{scheduler,abort,replay,loop}.test.ts` — 4× `fakeAwareSleep` byte-identical duplicate (read this session for migration sizing)
- `/Users/agniveshpatel/dev/agni21/trainer-sim/package.json` — current exports map and validate scripts
- `/Users/agniveshpatel/dev/agni21/trainer-sim/tsup.config.ts` — single-entry build with `node24` target

### Tooling validation runs (this session, MEDIUM-HIGH confidence — point-in-time)

- `npm run build` → green (Phase 1 build still passes; dist emitted: `index.js`, `index.cjs`, `index.d.ts`, `index.d.cts`, sourcemaps)
- `npm run validate:publint` → "All good!"
- `npm run validate:attw` → "No problems found 🌟"; node10 / node16-CJS / node16-ESM / bundler all 🟢
- `npm view fit-file-parser version` → `3.0.0` (matches `package.json` `~3.0.0`)
- `tsc --noEmit` on `EventEmitter<{ complete: [] }>` test snippet → exit 0 (typed-EE generic verified)

### Secondary (CITED, official docs)

- `nodejs.org/docs/latest-v24.x/api/events.html` — `EventEmitter` generic, `events.once(emitter, name, options?)`, `captureRejections`
- `nodejs.org/docs/latest-v24.x/api/timers.html` — `setTimeout` from `node:timers/promises` accepts `signal`
- `tc39.es/proposal-promise-with-resolvers` — `Promise.withResolvers()` (used by Phase 3, referenced for Phase 4 microtask discussion)
- ECMA-262 §AwaitExpression — `await null` and `await Promise.resolve()` both schedule microtasks
- ECMA-262 §Set.prototype[@@iterator] — insertion-order iteration; add/delete during iteration semantics
- `github.com/publint/publint` `site/src/pages/rules.md` — `EXPORTS_TYPES_SHOULD_BE_FIRST`, `EXPORTS_DEFAULT_SHOULD_BE_LAST` (current `package.json` already conforms)

### Tertiary

- MSW / Nock / Sinon-fake-timers documented patterns for "compose EventEmitter without extending" — referenced from Phase 4 SUMMARY.md (transitive); no individual citation chased because the locked decision (D-API-11) has independent justification (no surface inflation).

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all packages already installed and verified at locked versions; new code adds zero deps
- Architecture: HIGH — every architectural choice is locked in CONTEXT.md (D-API-*); research validated each against repo state
- Pitfalls: HIGH — 4 of 8 pitfalls are direct citations from PITFALLS.md / Phase 3 RESEARCH; the other 4 are mechanical consequences of locked decisions
- Tooling validation: HIGH — `publint` + `attw` runs were performed this session against current `dist/` and both passed
- Test ergonomics (`fakeAwareSleep` migration, `await once()` cooperation): HIGH — verified by reading the 4 existing Phase 3 test files

**Research date:** 2026-05-16
**Valid until:** 2026-06-15 (30 days for stable Node 24 / TS 5.9 / Vitest 4 stack)
