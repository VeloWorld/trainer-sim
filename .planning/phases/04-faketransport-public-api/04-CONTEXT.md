# Phase 4: FakeTransport & Public API - Context

**Gathered:** 2026-05-16
**Status:** Ready for planning
**Mode:** auto (recommended-option selection across all gray areas; see Discussion Log)

<domain>
## Phase Boundary

Surface the Phase 3 internal `Replay` (`src/replay/`) through the public package API as `createFakeTransport(config) → ITrainerTransport`, vendoring the `ITrainerTransport` contract here in `src/types.ts`. Phase 4 is the first phase that mutates `dist/index.{js,cjs,d.ts,d.cts}` since Phase 1 — every prior phase ended with `src/index.ts` re-exports of building blocks; this phase ships the actual product.

**In scope (from ROADMAP Phase 4):**
- `createFakeTransport({ source, speed?, loop?, maxEmissionHz? })` factory satisfying `ITrainerTransport` (API-01)
- Vendored `ITrainerTransport` interface exported as a TypeScript type from the package root (API-02)
- `onData(handler)` accepts `(data: DataView) => void`, returns a disposer (API-03)
- `sendResistance(grade)` is echo-only — appends to `received.resistance` and does NOT modify replayed payloads (API-04)
- `received.resistance` is a public read-only `ReadonlyArray<number>` of grade calls in order (API-05)
- `reset()` clears `received.resistance` and rewinds the replay cursor so a single instance can be reused across `afterEach()`-isolated tests (API-06)
- Dual ESM/CJS publish validated by `publint` and `@arethetypeswrong/cli` (API-07)
- Strict-mode TypeScript Node 24 import works out of the box, no `@types/*` shim needed (API-08)
- `'complete'` event tests can `await` (REPL-05 — Phase 4 surfaces it; Phase 3 only surfaces `replay.completed`)

**Out of scope (deferred to Phase 5+):**
- VeloWorld integration / cross-repo E2E (Phase 5 owns VW-01..VW-03)
- BLE peripheral / `BlenoTransport` (v2)
- CLI (`trainer-sim play`) (v2)
- HR / speed / distance FTMS fields beyond the encoder's optional `speed?` branch (v2)
- GATT Fitness Machine Control Point opcode handling beyond resistance echo (v2)
- `received.controlPoint[]` v2-forward-compat shape — explicitly deferred (CLAUDE.md "no abstractions for hypothetical future requirements")
- `tick(ms)` virtual-clock mode (v1.x — REQUIREMENTS.md out-of-scope)
- ReadableStream as a FIT input source (v1.x — REQUIREMENTS.md out-of-scope)

</domain>

<decisions>
## Implementation Decisions

### `ITrainerTransport` Definition Site & Async Semantics
- **D-API-01:** trainer-sim is the canonical definer of `ITrainerTransport` (per ARCHITECTURE.md Pattern 4 + Anti-Pattern 6). The interface lives in `src/types.ts` next to `RideRecord` and is re-exported from `src/index.ts`. VeloWorld imports the type from `trainer-sim`. This removes the "two definitions can drift" failure mode and makes adding methods (e.g., v2's GATT FMCP opcodes) a single-file change.
- **D-API-02:** `connect()`, `disconnect()`, and `sendResistance(grade)` all return `Promise<void>`. Even the Fake variant of `sendResistance` forces a microtask boundary (`await Promise.resolve()` or equivalent) so consumers cannot observe a Fake-vs-Bleno timing difference. PITFALLS.md #12 + ROADMAP Phase 4 note ("the `ITrainerTransport` interface owns the async semantics for `sendResistance` — force a microtask boundary even in Fake — and forbids any BLE-specific types in the import graph") — these decisions ripple through every test and into v2's BlenoTransport, so settle them here.
- **D-API-03:** No BLE-specific types appear anywhere in `src/types.ts` or any module reachable from `src/index.ts` without `import type` from a v2-only file. Acceptance grep:
  ```bash
  grep -rn "bleno\|gatt\|advertis" src/index.ts src/types.ts src/transport/fake-transport.ts || echo "clean"
  ```

### Factory Shape & Source Discriminated Union
- **D-API-04:** `createFakeTransport(config)` is a **synchronous** factory returning a fully-typed `ITrainerTransport`. FIT loading and `Replay` construction are deferred to `connect()`, so filesystem errors (`ENOENT`, `EACCES`) and FIT-format errors (`FitLoadError` family) land in the `connect()` Promise rejection. Rationale: ARCHITECTURE.md Pattern 5 + Phase 2's existing async/sync split (`loadFitFromPath` async; `loadFitFromBuffer` sync). Keeps the factory signature stable across all three source variants below.
- **D-API-05:** `config.source` is a discriminated union:
  ```ts
  type FakeTransportSource =
    | { path: string }                         // delegates to loadFitFromPath
    | { buffer: Buffer | Uint8Array }          // delegates to loadFitFromBuffer
    | { records: ReadonlyArray<RideRecord> };  // bypass loader (test-only fast path)
  ```
  The `records` variant is for trainer-sim's OWN tests (skip FIT parse for speed). Consumer-facing tests SHOULD use `path` or `buffer` so the FIT path stays exercised end-to-end. SUMMARY.md "Pluggable internal `RecordSource` so trainer-sim's own tests skip FIT parsing without violating 'real FIT only' for consumers."
- **D-API-06:** `config` defaults: `speed = 1`, `loop = false`, `maxEmissionHz = 1000`. Defaults live in the factory, not in `Replay` (per Phase 3's `ReplayConfig` — every field required, defaults are caller concern). The factory does input validation that Phase 3's `Replay.start` doesn't (`speed > 0`, `maxEmissionHz > 0`); validation throws synchronously from the factory call before `connect()` returns its Promise. T-03-03 followup applies.

### Public API Surface (`src/index.ts` additions)
- **D-API-07:** `src/index.ts` adds the following exports in Phase 4:
  ```ts
  export { createFakeTransport } from './transport/fake-transport.js';
  export type { ITrainerTransport, FakeTransportConfig, FakeTransportSource } from './types.js';
  ```
  Phase 1's `encodeIndoorBikeData` / `IndoorBikeRecord` and Phase 2's `loadFitFromPath` / `loadFitFromBuffer` / `RideRecord` / `FitLoadError` family stay exported (they remain useful as building blocks; consumers can wire their own transport against them).
- **D-API-08:** `package.json` exports map stays single-rooted (`"."` only) for v1. The v2 forward-shape (subpath `./bleno`, `external: ['@stoprocent/bleno']`) is documented as a comment in `tsup.config.ts` already; no change in Phase 4.

### Multi-Subscriber Fan-Out & Error Isolation
- **D-API-09:** Subscriber registry is a `Set<(data: DataView) => void>` (NOT array). Iteration order at emit time is insertion order (Set guarantees this), but the choice of Set is for O(1) add/remove on the disposer path — Phase 4's `onData` returns a disposer that calls `subscribers.delete(handler)`. Phase 3's `Replay` is single-subscriber by design (D-REPL-11); Phase 4's FakeTransport registers ONE subscriber on the Replay (`replay.onRecord(...)`) that fans out to the Set.
- **D-API-10:** A subscriber that throws does NOT abort the loop. The fan-out wraps each handler invocation in `try { h(data) } catch (err) { log('subscriber threw: %O', err) }` using `util.debuglog('trainer-sim:transport')`. Reason: tests routinely throw from `onData` to surface assertion failures (`expect(...).toBe(...)` throws on mismatch); a throwing handler must not starve other subscribers and must not abort the replay. Same `debuglog` discipline as D-FIT-09 / Phase 3's `'trainer-sim:replay'`.

### `'complete'` Event Surface
- **D-API-11:** FakeTransport **composes** an internal `EventEmitter` (does NOT extend one). Implementation: `const emitter = new EventEmitter()` inside the factory closure; the returned object exposes `on`/`off`/`once` as thin pass-throughs ONLY for `'complete'` (NOT a generic event surface). Reason: tests want `await once(transport, 'complete')` from `node:events`, but extending EventEmitter widens the public surface to all 30 EventEmitter methods — which the contract `ITrainerTransport` does not promise. Composition keeps the type honest.
- **D-API-12:** `'complete'` fires when `Replay.completed` resolves naturally (cursor exhaustion, `loop === false`). It does NOT fire when `disconnect()` aborts the replay — that's a user-driven stop, not a natural completion. Phase 3's `replay.completed` rejects on abort; FakeTransport's `disconnect()` swallows that rejection (it is the cause, not a surprise) and does NOT emit `'complete'`.
- **D-API-13:** `ITrainerTransport` does NOT include the event-emitter methods. The `on('complete', ...)` surface is a FakeTransport-specific affordance — consumers who only program against the interface shape can `await transport.connect()` and rely on Promise chains; consumers who want the event hook can narrow to the FakeTransport-shaped return type. The same pattern lets v2 BlenoTransport add a separate `'disconnect'` event for BLE link-loss without widening the interface.

### `reset()` Scope (API-06)
- **D-API-14:** `reset()` does the minimum work to make a FakeTransport reusable across `afterEach()`-isolated tests:
  1. `disconnect()` if currently running (idempotent — Phase 3's `replay.stop()` is already idempotent);
  2. clear `received.resistance` to `[]`;
  3. construct a **fresh internal `Replay`** for the next `connect()` (Phase 3's single-use lock — D-REPL-07 — means recycling is impossible; the only legal path is to discard and re-instantiate);
  4. **does NOT clear `onData` subscribers**. Reason: success-criterion 4 wording is "single instance reused across `afterEach()`-isolated tests"; in idiomatic vitest `onData` handlers register in `beforeEach` (or once per `describe`), and reset's job is to undo *per-test* state (the resistance log + replay cursor), not registry state. If a test wants a clean subscriber set, it can use the disposer that `onData` returned.
- **D-API-15:** `reset()` returns `Promise<void>` so it can `await` the in-flight `disconnect()` without forcing callers to do `await transport.disconnect(); transport.reset()`. The Promise resolves once the replay has been re-instantiated and `received.resistance` cleared.

### `received` Shape — V1 Literal, NOT V2-Forward
- **D-API-16:** `received: { resistance: ReadonlyArray<number> }`. NO pre-design of `received.controlPoint: { opcode, params, timestamp }[]` for v2 GATT FMCP opcodes. CLAUDE.md "no abstractions for hypothetical future requirements" — v2 will refactor when opcodes 0x04/0x05/0x11 land, and the user-facing change will be additive (`received.controlPoint` appears alongside `received.resistance`, which stays as a derived view or a literal mirror). SUMMARY.md gap "received shape forward-compatibility for v2" is explicitly DEFERRED with this decision.
- **D-API-17:** The `received.resistance` array is exposed as `ReadonlyArray<number>` at the type level (callers cannot push) but is backed by a real internal `number[]` the implementation appends to. No `Object.freeze` — the type-level readonly is sufficient discipline; freezing would force consumers who copy the array to defensively un-freeze. Same posture as Phase 3's `private readonly config` (frozen by convention, not by `Object.freeze`).

### Module Layout
- **D-API-18:** `src/transport/fake-transport.ts` houses the factory. `src/transport/` is created in Phase 4 (it does not yet exist). v2's `BlenoTransport` will be `src/transport/bleno-transport.ts` — sibling file, not subclass. ARCHITECTURE.md Pattern 1 (composition, not inheritance) + the "transport seam is a directory, not a class hierarchy" rationale.
- **D-API-19:** No `src/util/clock.ts` is created in Phase 4. ARCHITECTURE.md mentioned it as a Layer 0 utility; Phase 3 chose to inject `getNow` and `sleep` directly into the scheduler (D-REPL-13) rather than pull a separate clock abstraction. Phase 4 inherits this — the FakeTransport factory does NOT take a `clock` config; tests use Vitest's `vi.useFakeTimers()` against `globalThis.performance.now` and `globalThis.setTimeout`, which the Phase 3 wiring already routes through (per `src/replay/replay.ts:245` `() => globalThis.performance.now()`).

### FTMS Encode Wiring
- **D-API-20:** Inside FakeTransport, the per-record pipeline is:
  ```ts
  replay.onRecord((rec: RideRecord) => {
    const dv = encodeIndoorBikeData({
      power: rec.power ?? 0,           // FTMS Indoor Bike Data does not carry "power-absent" semantics in v1
      cadence: rec.cadence ?? 0,
    });
    for (const h of subscribers) {
      try { h(dv); } catch (err) { log('subscriber threw: %O', err); }
    }
  });
  ```
  The `rec.power ?? 0` collapse here is the **only** place trainer-sim collapses absent-vs-zero. Phase 2's `RideRecord.power?` preserved the wire-level distinction (D-FIT-01) precisely so this collapse is consumer-visible policy, not silent loader behavior. **PITFALLS.md note:** the FTMS encoder gates the flag bit on `value === undefined` (Phase 1 D-09 / encoder line `power: number` always present), but FakeTransport always sends the power+cadence flag bits (the encoder's `IndoorBikeRecord` requires `power` and `cadence` to be `number`, not `number | undefined`). This is the correct semantics for v1 — VeloWorld's existing decoder expects continuous power/cadence; "no power signal" UI states are a Phase 5 / v1.x concern.
- **D-API-21:** No new FTMS fields (speed, HR) are emitted in v1. The encoder's `speed?` branch stays untested by FakeTransport — Phase 1's tests already cover both flag-bit branches.

### Test Strategy
- **D-API-22:** Phase 4 tests live under `test/transport/`. Three test files target the three responsibility surfaces:
  1. `test/transport/fake-transport.test.ts` — factory shape, `connect/disconnect/onData/sendResistance`, multi-subscriber fan-out, subscriber-throws isolation, `received.resistance` ordering, `reset()` semantics. Vitest fake timers; uses the `{ records: [...] }` source variant for speed (D-API-05 fast path).
  2. `test/transport/path-and-buffer.test.ts` — exercises `{ path }` and `{ buffer }` source variants against the Phase 2 fixtures (`test/fixtures/fit/basic.fit` is sufficient — 443 records, 7 minutes, fast under fake timers).
  3. `test/transport/publish.test.ts` — runs `publint` + `attw` against the built `dist/`. Marked `test.slow` because it shells out to `npm run build`.
- **D-API-23:** No new FIT fixtures are created in Phase 4. The Phase 2 fixture corpus (`test/fixtures/fit/{basic,autopause,shadow,perf-1hr}.fit`) covers all FakeTransport happy paths; corruption paths inherit from Phase 2's loader tests.
- **D-API-24:** Vitest fake-timer discipline carries over from Phase 3 — `vi.useFakeTimers()`, `vi.advanceTimersByTimeAsync()` (NOT the sync variant — Phase 3 RESEARCH §Pitfall 1 + 03-03-SUMMARY documented why). The `fakeAwareSleep` helper duplicated across 4 Phase 3 test files (Phase 3 followup IN-01) should be lifted to `test/_helpers/fake-aware-sleep.ts` in Phase 4 and consumed by `test/transport/fake-transport.test.ts` — this is a cleanup that naturally fits Phase 4 because Phase 4 is the first phase to add a transport-layer test that would otherwise duplicate the helper a fifth time.

### Phase 3 Followups Folded Into Phase 4
- **D-API-25:** The following Phase 3 advisory followups are appropriate to address as part of Phase 4 (per Phase 3 REVIEW classifications in STATE.md):
  - **WR-05 (Phase 3):** `Replay.start()` doesn't validate `speed > 0` / `maxEmissionHz > 0`. Phase 4's factory is the right validation gate (D-API-06) — Replay stays internally lenient; the public boundary (`createFakeTransport`) throws on bad config. This is consistent with the Phase 3 lock that Replay's caller validates input (D-REPL-13).
  - **IN-01 (Phase 3):** `fakeAwareSleep` duplicated in 4 test files — lift to a shared helper as part of D-API-24.
  - **WR-02 (Phase 3):** `Replay.currentState` async transition not documented. Optional polish; only address if a Phase 4 test needs to assert state transitions and the docstring proves insufficient.
  - **WR-04 (Phase 3):** Replay config JSDoc claims "frozen" without `Object.freeze`. Same posture chosen for D-API-17 — leave as-is; the type-level readonly is the contract.

### Phase 2 Followups (Advisory — NOT Folded)
- **D-API-26:** Phase 2 followups (WR-01, WR-03, WR-05) per STATE.md are NOT in Phase 4 scope. They are loader-internal concerns that don't surface through FakeTransport's contract. Leave them in the followup queue.

### Claude's Discretion
- File-level layout inside `src/transport/`: a single `fake-transport.ts` is fine for v1; only split into `subscriber-registry.ts` / `resistance-log.ts` if the file exceeds ~250 LOC after implementation. ARCHITECTURE.md mentioned `resistance-log.ts` as a separate module — Phase 4 may or may not split it.
- Whether the FakeTransport's returned object is a plain object literal or a class instance — taste-level. Plain object literal is the lightest form (matches ARCHITECTURE.md Pattern 5 example) and avoids leaking `instanceof FakeTransport` as a type narrowing. Default to object literal.
- Whether `'complete'` is emitted with the typed `EventEmitter<{ complete: [] }>` form (Node 22+) or the loose `EventEmitter` — typed is nicer; loose is simpler. Default to typed to match the strict-mode TypeScript posture (API-08).
- Naming inside the factory closure (`subscribers`, `resistanceLog`, `replay`, `emitter`) — taste-level.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Spec authority (no need to fetch — stable contracts)
- Bluetooth SIG Fitness Machine Service v1.0.1 §4.9 "Indoor Bike Data" — frame layout already implemented by Phase 1's encoder; Phase 4 only consumes the encoder
- Node 24 `EventEmitter` (`node:events`) — `on/off/once` semantics, `EventEmitter<T>` typed events (Node 22+)
- Node 24 `AbortController` / `AbortSignal` — used by Phase 3; FakeTransport `disconnect()` calls `replay.stop()` which routes through Phase 3's internal AbortController
- Node 24 `util.debuglog('trainer-sim:transport')` — observability seam; same pattern as `'trainer-sim:fit'` (Phase 2 D-FIT-09) and `'trainer-sim:replay'` (Phase 3)

### Requirements & roadmap
- `.planning/REQUIREMENTS.md` §FakeTransport API — API-01 through API-08 (the binding requirement contracts for this phase)
- `.planning/ROADMAP.md` §Phase 4 — goal, dependencies, success criteria, "the `ITrainerTransport` interface owns the async semantics for `sendResistance` (force a microtask boundary even in Fake) and forbids any BLE-specific types in the import graph — these decisions ripple through every test and into v2's BlenoTransport, so settle them here" note
- `.planning/PROJECT.md` §Active Requirements + §Key Decisions — `ITrainerTransport` shape (`connect/disconnect/onData/sendResistance`); FakeTransport replays power+cadence; `sendResistance` is echo-only; no BLE in v1
- `.planning/PROJECT.md` §Constraints — TypeScript Node 24, MIT, dual ESM/CJS publish

### Phase 3 outputs (the consumer of Phase 3's output is this phase)
- `src/replay/replay.ts` — `Replay` class with `onRecord`, `start`, `stop`, `completed`, `currentState`. Single-subscriber slot; single-use lifecycle (D-REPL-07). FakeTransport instantiates one Replay per `connect()`; `reset()` discards and re-instantiates.
- `src/replay/scheduler.ts` — drift-corrected setTimeout chain. NOT imported by Phase 4 directly; `Replay` is the only seam.
- `src/replay/types.ts` — `ReplayConfig` (`{ records, speed, loop, maxEmissionHz }`), `ReplayState`. FakeTransport's config maps to this 1:1.
- `.planning/phases/03-replay-engine/03-CONTEXT.md` §Decisions — D-REPL-07 (single-use lock), D-REPL-08 (Promise-first completion → Phase 4 wires `'complete'` event), D-REPL-09 (AbortController), D-REPL-11 (single-subscriber → Phase 4 fans out), D-REPL-12 (Replay is internal — Phase 4 owns the public re-export)
- `.planning/phases/03-replay-engine/03-RESEARCH.md` lines 529–545 — explicit Phase 4 wiring sketch for the `'complete'` event
- `.planning/phases/03-replay-engine/03-VERIFICATION.md` — confirms Phase 3 tests are 77/79 passing (2 intentional opt-in skips); CR-01/CR-02 fixed in commit `e4b04a9`

### Phase 2 outputs
- `src/fit/loader.ts` — `loadFitFromPath` (async) + `loadFitFromBuffer` (sync). FakeTransport calls these inside `connect()` for the `{ path }` / `{ buffer }` source variants (D-API-05).
- `src/fit/errors.ts` — `FitLoadError` family. FakeTransport does NOT wrap these — they bubble through `connect()`'s Promise rejection unchanged so consumers `catch (e instanceof FitLoadError)` (or its subclasses) directly.
- `src/types.ts` — `RideRecord`. Already exported from `src/index.ts`; Phase 4 adds `ITrainerTransport`, `FakeTransportConfig`, `FakeTransportSource` alongside.
- `.planning/phases/02-fit-loader-normalization/02-CONTEXT.md` §Decisions — D-FIT-01 (absent-vs-zero preserved at loader; collapsed to 0 only in FakeTransport's encode call per D-API-20), D-FIT-07 (sync/async API split — FakeTransport mirrors)

### Phase 1 outputs
- `src/ftms/indoor-bike-data.ts` — `encodeIndoorBikeData({ power, cadence, speed? }) → DataView`. FakeTransport's per-record path calls this with `speed` omitted (v1 — D-API-21).
- `.planning/phases/01-vendored-ftms-codec/01-CONTEXT.md` §Decisions — D-07 (encoder API shape), D-08 (pure stateless function — safe to call inside the hot path)

### Architecture & stack research
- `.planning/research/ARCHITECTURE.md` §Pattern 1 (Transport as Strategy — composition, not inheritance), §Pattern 4 (Define ITrainerTransport here), §Pattern 5 (Factory function as public API), §Anti-Pattern 1 (no inheritance hierarchy), §Anti-Pattern 5 (no FTMS encode in transport — but the encode CALL is fine), §Anti-Pattern 6 (don't define ITrainerTransport in consumer)
- `.planning/research/ARCHITECTURE.md` §Recommended Project Structure — `src/transport/fake-transport.ts` location locked here
- `.planning/research/STACK.md` §"What NOT to Use" — confirms `tsup` for dual publish, `publint` + `attw` non-negotiable; v2's `@stoprocent/bleno` is NOT a Phase 4 dep
- `.planning/research/PITFALLS.md` §Pitfall 12 (sendResistance async semantics — force microtask in Fake), §Pitfall 13 (BLE types must not leak into ITrainerTransport's import graph)
- `.planning/research/SUMMARY.md` §Phase 4 Plan + §"Cooperates with consumer fake timers" note + §gaps (received forward-compat is DEFERRED here per D-API-16; cross-app BLE compat is v2)

### Tooling validation
- `https://github.com/publint/publint` — `publint` documents the validation rules for `package.json` `exports` maps; Phase 1 already wired the `npm run validate:publint` script (`package.json:36`)
- `https://github.com/arethetypeswrong/arethetypeswrong.github.io` — `@arethetypeswrong/cli` (`attw`) documents type-resolution validation across ESM/CJS; Phase 1 wired `npm run validate:attw` (`package.json:37`)
- `https://github.com/egoist/tsup` README — `tsup` config for dual ESM+CJS with `.d.ts`+`.d.cts` emission; Phase 1 already configured (`tsup.config.ts:11`)

### State & followups
- `.planning/STATE.md` — Phase 3 followups (WR-02, WR-04, WR-05, IN-01) folded selectively per D-API-25; Phase 2 followups (WR-01, WR-03, WR-05) NOT folded per D-API-26

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`Replay` class (src/replay/replay.ts)** — the entire engine. FakeTransport composes it; do NOT reach past the public surface (`onRecord`, `start`, `stop`, `completed`, `currentState`). Phase 3 made this class internal-only (D-REPL-12) precisely so Phase 4 owns the re-export decision; the only file outside `src/replay/` that imports from `src/replay/` should be `src/transport/fake-transport.ts`.
- **`encodeIndoorBikeData` (src/ftms/indoor-bike-data.ts)** — already exported from `src/index.ts`; FakeTransport calls it directly per D-API-20.
- **`loadFitFromPath` / `loadFitFromBuffer` (src/fit/loader.ts)** — already exported; FakeTransport calls them based on the `source` discriminator (D-API-05).
- **`FitLoadError` hierarchy (src/fit/errors.ts)** — bubble through `connect()` unchanged; FakeTransport does NOT translate or wrap.
- **`util.debuglog('trainer-sim:transport')`** — new namespace, same pattern as `:fit` (Phase 2) and `:replay` (Phase 3). Used for the subscriber-throws swallow path (D-API-10).

### Established Patterns
- **`.js` extensions on relative imports** (Phase 1+ convention) — Phase 4 follows. `src/transport/fake-transport.ts` will import `../replay/replay.js`, `../ftms/indoor-bike-data.js`, `../fit/loader.js`, `../types.js`.
- **`verbatimModuleSyntax: true`** (tsconfig) — `import type { ... }` for type-only imports. `ITrainerTransport`, `FakeTransportConfig`, `FakeTransportSource`, `RideRecord` are all type-only re-exports from `src/index.ts`.
- **Per-task atomic commits with conventional-commit prefixes** (Phase 1+ convention) — `feat(04-...)`, `test(04-...)`, etc.
- **Plan-level `<verification>` blocks** with acceptance-grep against the working tree (Phase 1+ convention) — Phase 4 plans grep for the `ITrainerTransport` definition site, the no-BLE-types invariant, and the single-import seam for `Replay`.
- **Single-import-seam pattern** (Phase 2 D-FIT-08, Phase 3's `node:timers/promises` import in scheduler.ts) — Phase 4 inherits: `import { Replay } from '../replay/replay.js'` should appear in EXACTLY ONE file (`src/transport/fake-transport.ts`); a future BlenoTransport will be the second.
- **Sync-default-with-async-when-needed** (Phase 2 D-FIT-07) — `createFakeTransport` is sync; `connect`/`disconnect`/`sendResistance`/`reset` are async; `onData` is sync (returns sync disposer).
- **No-`undefined`-vs-omitted distinction** (Phase 2 D-FIT-01) — collapsed in FakeTransport per D-API-20; the loader still preserves the distinction.

### Integration Points
- **`src/index.ts`** — Phase 4's only edit to a pre-existing top-level file (besides `package.json` if a `files` whitelist update is needed; not expected). Adds three exports per D-API-07.
- **`src/types.ts`** — gains `ITrainerTransport`, `FakeTransportConfig`, `FakeTransportSource` (the latter two named exports next to the existing `RideRecord`).
- **`src/transport/`** — new directory; first file `fake-transport.ts`. v2 BlenoTransport sits here as a sibling.
- **`test/transport/`** — new directory; three test files per D-API-22.
- **`test/_helpers/fake-aware-sleep.ts`** — new helper file (D-API-24); 4 Phase 3 test files migrate to import from here. Phase 4 plan should commit this with Phase 3 test files updated as a pre-implementation step OR roll into the same task that creates the new transport test.
- **`tsup.config.ts`** — no change in Phase 4. The forward-shape comment for v2 stays; entry points are still `['src/index.ts']`.
- **`package.json`** — no change in Phase 4. The `exports` map is already dual-ESM/CJS; `publint` + `attw` scripts already exist; `prepublishOnly` already wires the validate gate.

### Phase 5 Connection Point
- **VeloWorld E2E** asserts that swapping VeloWorld's existing BLE transport for FakeTransport requires zero changes to ride scene or physics code (VW-01). The shape locked here (D-API-01..03) is the **contract** Phase 5 verifies. If VeloWorld's existing internal type differs from `ITrainerTransport`, Phase 5 will surface the diff — but the diff resolution path is "VeloWorld's type imports trainer-sim's", not "trainer-sim's contract widens to match VeloWorld's." (Per ARCHITECTURE.md Pattern 4 + Anti-Pattern 6.)

</code_context>

<specifics>
## Specific Ideas

- **`ITrainerTransport` as a fully-typed contract.** The interface is the v2-shape forward-compat boundary. Adding methods (e.g., v2's GATT FMCP opcodes) updates one file; consumers see additive changes only. This is the "single canonical definer" payoff per ARCHITECTURE.md Pattern 4.
- **The microtask-in-Fake invariant.** Without it, a consumer's `await transport.sendResistance(grade)` resolves synchronously in v1 and asynchronously in v2 — that's a behavior diff in user code that test suites would only catch when v2 lands. Force the microtask now.
- **Composition over EventEmitter inheritance.** Object-literal-with-internal-emitter is what mock libraries (MSW, Nock) ship; the EventEmitter surface inflation isn't worth the convenience for one event (`'complete'`). Document this in the FakeTransport return-type JSDoc so a future contributor doesn't "simplify" it back to `extends EventEmitter`.
- **The `{ records: [...] }` source variant is for trainer-sim's OWN tests, not consumers.** Document this in JSDoc with a "do not use in production tests" note. Consumer-facing tests should use `{ path }` or `{ buffer }` so the FIT load path stays exercised.
- **`reset()` does NOT clear subscribers.** This is a semantics call — vitest idiom registers handlers in `beforeEach` (re-runs per test) so the handler set is naturally fresh; clearing on `reset()` would surprise users who deliberately register once per `describe` block. If a future user reports the opposite expectation, revisit.

</specifics>

<deferred>
## Deferred Ideas

- **`tick(ms)` virtual-clock mode.** REQUIREMENTS.md out-of-scope ("Differentiator but adds complexity; defer to v1.x if real demand emerges"). FakeTransport relies on Vitest's `vi.useFakeTimers()` against `globalThis.performance.now` and `globalThis.setTimeout` — Phase 3 already wires both seams (`replay.ts:245` `() => globalThis.performance.now()` + `scheduler.ts` injectable `sleep`). If a future consumer needs a manual `tick(ms)` API, the seam is in place; no new abstraction needed.
- **`received.controlPoint[]` v2-forward shape.** Explicitly deferred per D-API-16. v2's GATT FMCP opcodes (0x04 set-target-resistance, 0x05 set-target-power, 0x11 set-indoor-bike-simulation) will land alongside `BlenoTransport` — at that point `received` widens additively.
- **`'data'` event surface or `notified.count` accessor.** SUMMARY.md "should have" — not in v1 requirements. `onData` callback is the v1 surface; observability-via-Object-property is a v2 concern if testing patterns demand it.
- **Source-input flexibility beyond `{ path } | { buffer } | { records }`.** ReadableStream is REQUIREMENTS.md out-of-scope; URL/HTTP source is v2+.
- **Multiple FakeTransport instances sharing one parsed FIT.** Out of scope. Each `createFakeTransport` is independent; consumers who want to share a parsed `RideRecord[]` use the `{ records: parsedOnce }` source variant.
- **`tsup` `external` for bleno (v2 forward-shape).** `tsup.config.ts` already documents it as a comment; Phase 4 makes no change.
- **`@stoprocent/bleno` PROJECT.md update** (Phase 1 carry-forward). Still pending — handle at the Phase 4 → Phase 5 transition or after milestone close, not in Phase 4 plan execution.
- **Phase 3 followup WR-02 (Replay.currentState async transition docstring).** Address only if Phase 4 tests need to assert state transitions and find the docstring insufficient. Otherwise leave for v1.x cleanup.
- **Phase 3 followup WR-04 (config "frozen" claim without Object.freeze).** Same posture chosen for D-API-17 — don't fix.
- **Phase 2 followups WR-01, WR-03, WR-05.** Loader-internal; don't surface through FakeTransport's contract; leave in followup queue.
- **CLI (`trainer-sim play`).** v2 only; gated on BlenoTransport.

</deferred>

---

*Phase: 04-faketransport-public-api*
*Context gathered: 2026-05-16*
