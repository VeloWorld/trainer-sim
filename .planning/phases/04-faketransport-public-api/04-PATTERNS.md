# Phase 4: FakeTransport & Public API — Pattern Map

**Mapped:** 2026-05-16
**Files analyzed:** 8 (1 create / 7 modify or create with strong analogs)
**Analogs found:** 8 / 8 (every Phase 4 file has a same-repo analog — no greenfield patterns)

## File Classification

| Phase 4 File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/transport/fake-transport.ts` (CREATE) | factory module | request-response (subscribe/fan-out) + lifecycle (connect/disconnect) | `src/replay/replay.ts` (Phase 3 lifecycle wrapper, JSDoc, single-import-seam, Promise.withResolvers + .catch defuse, single-subscriber lock) | exact for class-style; takes object-literal Discretion path |
| `src/types.ts` (MODIFY — extend) | public type definitions | type-only (consumed by public surface + factory) | `src/types.ts:25-46` (`RideRecord` shape and JSDoc style) and `src/replay/types.ts:34-91` (`ReplayConfig` / `ReplayState` shape — the structural sibling) | exact (same file, same conventions) |
| `src/index.ts` (MODIFY — add 4 export lines) | public-API barrel | re-export only | `src/index.ts:3-22` (existing pattern of value-export + `export type`) | exact (same file) |
| `test/transport/fake-transport.test.ts` (CREATE) | unit test (lifecycle + fan-out) | event-driven under fake timers | `test/replay/replay.test.ts` (Replay lifecycle + completed Promise + fake timers) | exact |
| `test/transport/path-and-buffer.test.ts` (CREATE) | integration test (fixture-backed) | file-I/O → factory → fan-out | `test/fit/loader.test.ts` (loadFitFromPath/Buffer parity against `basic.fit` fixture) | exact for fixture wiring; combine with `test/replay/replay.test.ts` for lifecycle |
| `test/transport/publish.test.ts` (CREATE) | tooling/build smoke test | shells out to npm | NEW pattern (no existing test does shell-out); `package.json:36-38` `validate:publint`/`validate:attw` scripts are the existing wiring | role-match (no shell-out test analog yet — `package.json` scripts are the analog) |
| `test/_helpers/fake-aware-sleep.ts` (CREATE) | shared test helper | utility | byte-identical duplicate at `test/replay/scheduler.test.ts:57-82`, `test/replay/abort.test.ts:37-62`, `test/replay/replay.test.ts:42-67`, `test/replay/loop.test.ts:28-53` | exact (pure lift, zero behavior change) |
| `test/replay/{abort,loop,replay,scheduler}.test.ts` (MODIFY — replace local helper with import) | test files | refactor only | self (drop `function fakeAwareSleep(...)` block, add `import { fakeAwareSleep } from '../_helpers/fake-aware-sleep.js'`) | exact |

---

## Pattern Assignments

### `src/transport/fake-transport.ts` (factory module)

**Primary analog:** `src/replay/replay.ts` (Phase 3 lifecycle wrapper)
**Secondary analogs:** `src/fit/loader.ts` (single-import seam, `debuglog` namespace), `src/fit/errors.ts` (typed-error class style — for ANY new errors thrown; v1 uses plain `Error` per D-API-06, but the JSDoc style is the analog)

#### Pattern A1 — Module-doc preamble citing locked decisions (copy from `src/replay/replay.ts:1-73`)

The Phase 3 wrapper opens with a long block comment that:
1. States the file's role (`Replay lifecycle class — wraps runScheduler...`)
2. Enumerates the lifecycle states explicitly
3. Lists every locked decision the file implements (`D-REPL-07`, `D-REPL-08`, ...) with one-line citations
4. Lists every pitfall the file addresses with section references (`§4`, `§6`, `§10`)
5. Lists references to canonical research documents

**Phase 4 Apply:** `src/transport/fake-transport.ts` opens with the same structure. List `D-API-01..21` (locked), `D-API-25` (Phase 3 followup folds), and Pitfalls 1-8 from `04-RESEARCH.md`. Reference `.planning/phases/04-faketransport-public-api/04-CONTEXT.md` and `04-RESEARCH.md`.

**Excerpt to mirror** (`src/replay/replay.ts:1-12`, abbreviated):

```typescript
/**
 * Replay lifecycle class — wraps `runScheduler` with a single-subscriber slot,
 * an internal AbortController, and a `Promise<void>` completion surface. This
 * is the public-to-Phase-4 layer that Phase 4's `createFakeTransport` will
 * instantiate; Phase 3 itself does NOT re-export it from `src/index.ts`
 * (D-REPL-12 lock).
 *
 * Lifecycle:
 *   - `idle` → `running` on `start()`.
 *   ...
 *
 * Implements (per .planning/phases/03-replay-engine/03-CONTEXT.md):
 *   - D-REPL-07: stop-at-end → state moves to `done`; subsequent `start()` ...
 *   - D-REPL-08: Promise-first completion surface ...
 */
```

#### Pattern A2 — Single-import-seam discipline + acceptance grep

**Source 1: `src/fit/loader.ts:21-23`** — verbatim comment block enforced by acceptance grep (Phase 2 D-FIT-08):

```typescript
import { debuglog } from 'node:util';
// THE SINGLE PARSER IMPORT IN ALL OF src/. No other src/* file may import
// this module — D-FIT-08 seam (acceptance grep enforces).
import FitParser from 'fit-file-parser';
```

**Source 2: `src/replay/scheduler.ts:63-70`** — same discipline applied to `node:timers/promises`:

```typescript
// SINGLE-SOURCE-OF-TRUTH IMPORT SEAM. This module is the ONLY file in `src/`
// that imports `'node:timers/promises'` — mirroring the D-FIT-08 enforcement
// from Phase 2 (only `src/fit/loader.ts` imports `fit-file-parser`). The
// 03-01-PLAN acceptance grep confirms the seam; threat T-03-01 in the plan's
// threat model documents WHY a future regression that imports the global
// `setTimeout` here would re-introduce the §3 listener-leak antipattern.

import { setTimeout as defaultSleep } from 'node:timers/promises';
```

**Phase 4 Apply:** `src/transport/fake-transport.ts` becomes the THIRD single-import seam — for `Replay`. The import block:

```typescript
import { EventEmitter } from 'node:events';
import { debuglog } from 'node:util';
import { encodeIndoorBikeData } from '../ftms/indoor-bike-data.js';
import { loadFitFromBuffer, loadFitFromPath } from '../fit/loader.js';
// THE SINGLE Replay IMPORT IN ALL OF src/. No other src/* file may import
// from `../replay/` — D-API-18 seam (v2 BlenoTransport will be the second).
// Acceptance grep enforces.
import { Replay } from '../replay/replay.js';
import type {
  FakeTransport,
  FakeTransportConfig,
  ITrainerTransport,
  RideRecord,
} from '../types.js';
```

**Acceptance grep** (Phase 4 plan must include one of these in `<verification>`; see Pitfall 5 in `04-RESEARCH.md`):

```bash
# ONLY src/transport/fake-transport.ts may import from src/replay/.
grep -rn "from '\.\./replay" src/ | grep -v "^src/transport/fake-transport.ts" || echo "clean"
# AND no BLE-specific types reachable from public surface.
grep -rn "bleno\|gatt\|advertis" src/index.ts src/types.ts src/transport/fake-transport.ts || echo "clean"
```

#### Pattern A3 — `util.debuglog('trainer-sim:transport')` channel

**Source 1: `src/fit/loader.ts:33`**:

```typescript
const log = debuglog('trainer-sim:fit');
```

**Source 2: `src/replay/scheduler.ts:75`**:

```typescript
const log = debuglog('trainer-sim:replay');
```

**Phase 4 Apply:** Module-top-level constant `const log = debuglog('trainer-sim:transport');` immediately after the imports. Use sites:
1. `D-API-10` subscriber-throws swallow path: `try { h(dv); } catch (err) { log('subscriber threw: %O', err); }`
2. Optional: connect/disconnect tracing if it helps debugging.

The `:fit` namespace logs shadow detection (`src/fit/loader.ts:222-231`); the `:replay` namespace logs clamped-tick summaries (`src/replay/scheduler.ts:249-256`). Phase 4's `:transport` follows the same opt-in posture (zero-cost when `NODE_DEBUG` is unset).

#### Pattern A4 — Promise.withResolvers + `.catch(() => undefined)` defuse for the rejection trap

**Source: `src/replay/replay.ts:117-126, 258-266`**

Construction (`replay.ts:117-126`):
```typescript
private readonly completedDeferred: {
  promise: Promise<void>;
  resolve: () => void;
  reject: (e: unknown) => void;
};

constructor(config: ReplayConfig) {
  this.config = config;
  this.completedDeferred = Promise.withResolvers<void>();
}
```

Defuse (`replay.ts:258-266`):
```typescript
// CR-02: Defuse the unhandled-rejection trap. `completedDeferred.promise`
// is created eagerly in the constructor; if a caller follows the
// documented `replay.start(); /* setup */; await replay.completed;`
// pattern and the scheduler aborts before the await attaches a handler,
// Node 24 emits an unhandledRejection warning. Attaching a no-op .catch
// here marks the promise as handled — consumers' later .then/.catch
// still observe the rejection (Promise rejection is fan-out, not consumed).
this.completedDeferred.promise.catch(() => undefined);
```

**Phase 4 Apply:** Phase 4 does NOT need `Promise.withResolvers()` for the `'complete'` event (that uses `EventEmitter`). It DOES need the same defuse posture wherever it consumes `replay.completed`:

```typescript
// In disconnect() — Pattern 3 from 04-RESEARCH §Pattern 3:
async function disconnect(): Promise<void> {
  if (replay === undefined) return;
  const r = replay;
  replay = undefined;
  r.stop();
  await r.completed.catch(() => undefined);  // consume the rejection caused by our own stop()
}

// In connect() — when wiring the 'complete' event, the .then(success, failure)
// form attaches BOTH handlers eagerly (mirrors replay.ts:247-256 .then(success, failure)):
replay.completed.then(
  () => emitter.emit('complete'),  // natural completion (D-API-12)
  () => undefined,                 // abort — silent (D-API-12)
);
```

The `.then(success, failure)` form is the SAME pattern Phase 3 uses on `runScheduler().then(...)` at `replay.ts:247-256` — attaching both handlers eagerly so a synchronous rejection never surfaces as `unhandledRejection`.

#### Pattern A5 — Single-subscriber lock + start guards (composition target)

**Source: `src/replay/replay.ts:159-218`** (`onRecord` and `start` guards)

```typescript
onRecord(handler: (r: RideRecord) => void): () => void {
  if (this.subscriber !== undefined) {
    throw new Error('Replay.onRecord: single-subscriber slot already taken (D-REPL-11). Phase 4 wraps for fan-out.');
  }
  if (this.state !== 'idle') {
    throw new Error('Replay.onRecord: must be called before start() (D-REPL-11)');
  }
  this.subscriber = handler;
  return () => {
    if (this.subscriber === handler) {
      this.subscriber = undefined;
    }
  };
}

start(config?: { signal?: AbortSignal; sleep?: (...) => Promise<void> }): void {
  if (this.subscriber === undefined) { throw new Error('Replay.start: onRecord must be called before start() (D-REPL-11)'); }
  if (this.state !== 'idle') { throw new Error(`Replay.start: instance is single-use; state is ${this.state} (D-REPL-07). Construct a new Replay to replay again.`); }
  if (this.config.records.length === 0) { throw new Error('Replay.start: records cannot be empty (D-REPL-13)'); }
  if (config?.signal?.aborted) { throw new Error('Replay.start: external signal is already aborted (D-REPL-09)'); }
  // ... proceed
}
```

**Phase 4 Apply:** FakeTransport is the *fan-out* layer over Phase 3's single-subscriber slot. The mapping is:

| Replay (Phase 3) | FakeTransport (Phase 4) |
|---|---|
| `subscriber: ((r) => void) \| undefined` (slot — D-REPL-11) | `subscribers: Set<(d: DataView) => void>` (registry — D-API-09) |
| `onRecord` throws on second call | `onData` always succeeds; returns disposer |
| `start()` validates 4 preconditions and throws | Factory validates `speed > 0` / `maxEmissionHz > 0` *synchronously* (D-API-06 + WR-05 fold). Validation lives in the factory body BEFORE returning the object literal — same fail-fast posture as `Replay.start`. |
| Single-use lock — `start()` throws when state is not idle | `connect()` is idempotent (early-return when `replay !== undefined`); freshness comes from `reset()` discarding-and-re-instantiating |

**Concrete factory validation block** (mirror of `replay.ts:207-218` style — throw eagerly with the locked-decision citation):

```typescript
// Sync validation (D-API-06 + Phase 3 followup WR-05 fold per D-API-25)
const speed = config.speed ?? 1;
const loop = config.loop ?? false;
const maxEmissionHz = config.maxEmissionHz ?? 1000;
if (!(speed > 0)) {
  throw new Error(`createFakeTransport: speed must be > 0, got ${String(speed)}`);
}
if (!(maxEmissionHz > 0)) {
  throw new Error(`createFakeTransport: maxEmissionHz must be > 0, got ${String(maxEmissionHz)}`);
}
```

#### Pattern A6 — Re-check abort between sleep-return and emit (CR-01 family)

**Source: `src/replay/scheduler.ts:229-237`** — Phase 3's CR-01 fix (commit `e4b04a9`):

```typescript
// 4d — Re-check abort between sleep-return and emit (CR-01 / D-REPL-10).
// `await sleep(...)` resolving and the synchronous `emit(record)` below
// are not atomic; if `replay.stop()` aborts in another microtask after
// sleep resolves but before emit fires, we MUST NOT emit. Without this
// guard, one ghost record can land after `disconnect()` resolves —
// a direct REPL-06 violation.
if (signal.aborted) {
  throw signal.reason;
}
```

**Phase 4 Apply:** Phase 4 does NOT re-implement this guard (Phase 3 owns the scheduler), but the *consequence* shapes Pattern 3 in `04-RESEARCH.md`: `disconnect()` uses `await replay.completed.catch(() => undefined)` after `replay.stop()` precisely so the FakeTransport boundary observes the post-CR-01 invariant ("after disconnect resolves, no further onData callbacks fire") synchronously. The plan `<verification>` block should reference CR-01 by commit `e4b04a9` and add a regression test mirroring `test/replay/abort.test.ts:100-113` ("zero further emissions in 100ms after stop").

#### Pattern A7 — JSDoc style on private/closure state

**Source: `src/replay/replay.ts:86-121`** — every private field carries a JSDoc citing the locked decision and the rationale:

```typescript
/**
 * Frozen at construction; not mutated. `ReplayConfig` is internal — see
 * `./types.ts`. The scheduler reads `records` as `ReadonlyArray`, so no
 * defensive copy is needed.
 */
private readonly config: ReplayConfig;

/**
 * D-REPL-11 — single subscriber slot. Phase 4 wraps for fan-out. `undefined`
 * until `onRecord(handler)` is called; `start()` throws if still undefined.
 */
private subscriber: ((r: RideRecord) => void) | undefined = undefined;
```

**Phase 4 Apply:** Even in the object-literal-with-closure form (D-API-04 / Discretion), each closure variable gets a JSDoc citing its locked decision:

```typescript
// D-API-09 — Set fan-out registry. O(1) add/delete; insertion-order iteration.
const subscribers = new Set<(data: DataView) => void>();

// D-API-16 / D-API-17 — internal mutable backing for `received.resistance`;
// exposed as ReadonlyArray<number> at the type level (no Object.freeze).
const resistanceLog: number[] = [];

// D-API-11 — composed (NOT extended) EventEmitter for the 'complete' surface.
const emitter = new EventEmitter<{ complete: [] }>();

// Lazily constructed on connect(); discarded on reset() (Phase 3 D-REPL-07
// forces single-use, so reuse is impossible). Defense-in-depth idempotency:
// connect() early-returns when this is set; disconnect() early-returns when undefined.
let replay: Replay | undefined;
```

---

### `src/types.ts` (extend with 4 new types)

**Primary analog:** the existing file itself (`src/types.ts:21-46` — `RideRecord`)
**Secondary analog:** `src/replay/types.ts:34-91` (the structural sibling — interface + state union)

#### Pattern T1 — Decision-cited JSDoc on each interface

**Source: `src/types.ts:1-46`** — the existing file's preamble + `RideRecord`:

```typescript
/**
 * Shared types for trainer-sim. Phase 2 introduces `RideRecord` — the contract
 * Phase 3 (replay engine) iterates over and Phase 4 (FakeTransport) consumes.
 * Future phases (Phase 4 `ITrainerTransport`, library-wide `Config`) extend
 * this file rather than scattering types across modules.
 *
 * Locked decisions:
 *   - D-FIT-01 (.planning/phases/02-fit-loader-normalization/02-CONTEXT.md):
 *     `RideRecord` shape is `{ timestamp: number; power?: number; cadence?: number }`.
 *     ...
 */

export interface RideRecord {
  /**
   * Unix epoch milliseconds (NOT FIT epoch — the 1989-12-31 UTC offset has
   * been applied by the loader). FIT-03.
   */
  timestamp: number;
  /**
   * Watts. `undefined` = no power signal ... Do NOT collapse `undefined` to `0` —
   * Phase 1's encoder gates the FTMS flag bit on `value === undefined` ...
   */
  power?: number;
  ...
}
```

**Phase 4 Apply:** Update the file preamble's "Future phases" sentence to reflect that Phase 4 has now landed. Add four type definitions, each with the decision-cited JSDoc:

```typescript
/**
 * Transport contract — what trainer-sim's FakeTransport (and v2's BlenoTransport)
 * provide, and what consumers (e.g., VeloWorld) program against. Per D-API-01,
 * trainer-sim is the canonical definer (ARCHITECTURE.md Pattern 4 + Anti-Pattern 6);
 * VeloWorld imports the type from this package rather than defining its own.
 *
 * Per D-API-13: this interface does NOT include event-emitter methods. The
 * 'complete' event lives on the FakeTransport-shaped subtype (below) so that
 * v2's BlenoTransport can add transport-specific events ('disconnect' on BLE
 * link-loss) without widening the interface.
 *
 * Per D-API-02: every method returns Promise<void>. Even Fake's sendResistance
 * forces a microtask boundary so consumers cannot observe a Fake-vs-Bleno
 * timing difference (PITFALLS.md §12).
 */
export interface ITrainerTransport {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  onData(handler: (data: DataView) => void): () => void;
  sendResistance(grade: number): Promise<void>;
}

/**
 * FIT input source for FakeTransport. Discriminated union per D-API-05 — the
 * consumer is explicit about which load path runs at connect() time.
 *
 * The `records` variant is for trainer-sim's OWN tests — skip FIT parse for
 * speed. Consumer-facing tests SHOULD use `path` or `buffer` so the FIT path
 * stays exercised end-to-end (SUMMARY.md note + D-API-05 lock).
 */
export type FakeTransportSource =
  | { path: string }
  | { buffer: Buffer | Uint8Array }
  | { records: ReadonlyArray<RideRecord> };

/**
 * Top-level config for createFakeTransport. Per D-API-06 the defaults
 * (speed = 1, loop = false, maxEmissionHz = 1000) are applied in the
 * factory body, not by the type-system — every field stays optional here
 * so consumers can pass `{ source }` alone for the default behavior.
 */
export interface FakeTransportConfig { ... }

/**
 * Public return type of createFakeTransport. Extends ITrainerTransport with
 * FakeTransport-specific affordances (received log, reset, complete event).
 * Per D-API-13, the on/off/once signatures are LITERALLY 'complete'-typed —
 * not Pick<EventEmitter, ...>, which would inherit the loose string|symbol
 * overloads (04-RESEARCH §Pattern 2).
 */
export interface FakeTransport extends ITrainerTransport { ... }
```

#### Pattern T2 — `import type { Buffer }` for the `Buffer | Uint8Array` union

**Source: `src/fit/loader.ts:18-19`** (current file imports `Buffer` from `node:buffer` as a value):

```typescript
import { readFile } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
```

**Phase 4 Apply:** `src/types.ts` only NEEDS the type, not the value (it's used in a type position). Use `import type`:

```typescript
import type { Buffer } from 'node:buffer';
```

This matches `verbatimModuleSyntax: true` (Phase 1+ tsconfig) — the executor must NOT use `import { Buffer } from 'node:buffer'` here because it would emit a runtime no-op import.

---

### `src/index.ts` (add 4 export lines)

**Primary analog:** the existing file itself (`src/index.ts:3-22`)

#### Pattern I1 — Value vs `export type` discipline

**Source: `src/index.ts:1-22`** verbatim:

```typescript
/** trainer-sim public API. Phase 1: encoder + type. Phase 2: FIT loader + types + errors. Phase 4 will add ITrainerTransport and createFakeTransport. */

export { encodeIndoorBikeData } from './ftms/indoor-bike-data.js';
export type { IndoorBikeRecord } from './ftms/indoor-bike-data.js';

// Phase 2: FIT loader and normalization. RideRecord is type-only (the
// `verbatimModuleSyntax: true` tsconfig requires `export type` so tsup does
// not emit a runtime no-op export). The four FitLoadError classes are
// runtime values (constructors with `instanceof` semantics) and MUST NOT be
// re-exported with the `type` keyword. ...
export { loadFitFromPath, loadFitFromBuffer } from './fit/loader.js';
export type { RideRecord } from './types.js';
export {
  FitLoadError,
  InvalidFitHeaderError,
  FitCrcError,
  FitTruncatedError,
  NoRecordMessagesError,
} from './fit/errors.js';
```

**Phase 4 Apply:** The preamble updates ("Phase 4 will add..." → "Phase 4: FakeTransport"). Then append in the same value-vs-type discipline (`createFakeTransport` is a runtime function; the four type names are types):

```typescript
// Phase 4: FakeTransport public surface (D-API-07).
export { createFakeTransport } from './transport/fake-transport.js';
export type {
  ITrainerTransport,
  FakeTransport,
  FakeTransportConfig,
  FakeTransportSource,
} from './types.js';
```

The five-name export instead of the locked-three-name list adds `FakeTransport` as a Discretion-level convenience (`04-RESEARCH §Code Example 3` documents the rationale: lets consumers annotate `const transport: FakeTransport = createFakeTransport(...)` without `ReturnType<typeof ...>`). Plan can keep or drop the fifth depending on planner judgment.

---

### `test/transport/fake-transport.test.ts` (CREATE)

**Primary analog:** `test/replay/replay.test.ts` (lifecycle + completed Promise + fake timers)
**Secondary analog:** `test/replay/abort.test.ts` (abort race + emission-after-stop guard, mirrors what `disconnect()` must observe)

#### Pattern TR1 — Module preamble citing locked decisions and pitfalls

**Source: `test/replay/replay.test.ts:1-26`**:

```typescript
// Phase 3 Plan 03-03 Task 2 — unit tests for the Replay class lifecycle.
//
// SUT: src/replay/replay.ts (built in plan 03-02 task 1; sleep-passthrough
//   added by plan 03-03 fix commit).
// Direct unit-test import via the internal path is acceptable because
// D-REPL-12 keeps the entire replay surface internal in this phase —
// `src/index.ts` is NOT extended.
//
// Locked decisions / requirements exercised:
//   - REPL-05 (replay.completed Promise resolves on stop-at-end — Group 1).
//   - D-REPL-07 (single-use lock — Group 3).
//   - D-REPL-08 (Promise-first completion surface — Group 1).
//   ...
//   - RESEARCH §Pitfall 5 — vi.advanceTimersByTimeAsync (NEVER the sync variant).
//   - RESEARCH §Pitfall 6 — module-import-binding capture: tests inject a
//     `globalThis.setTimeout`-based sleep via `replay.start({ sleep })`.
```

**Phase 4 Apply:** `test/transport/fake-transport.test.ts` opens with the same structure. SUT is `src/transport/fake-transport.ts` (Phase 4 plan task N). Locked decisions: `D-API-04` (sync factory + deferred load), `D-API-09/10` (Set fan-out + throw isolation), `D-API-11/12` (composed EE + complete event), `D-API-14/15` (reset semantics), `D-API-16/17` (received shape), `D-API-20` (per-record collapse). Pitfalls to cite: `04-RESEARCH §Pitfall 1` (microtask boundary), `§3` (mid-fan-out disposer), `§6` (disconnect-completes-after-scheduler), `§8` (subscriber-throws isolation).

**Imports through the public surface** (NOT the internal path — Phase 4 makes FakeTransport public, so tests import via `../../src/index.js`):

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { once } from 'node:events';
import { createFakeTransport } from '../../src/index.js';
import type { FakeTransport, RideRecord } from '../../src/index.js';
import { fakeAwareSleep } from '../_helpers/fake-aware-sleep.js';
```

#### Pattern TR2 — `vi.useFakeTimers()` lifecycle hooks

**Source: `test/replay/replay.test.ts:69-75`** (verbatim):

```typescript
describe('Replay — fake-timer lifecycle tests', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });
```

**Phase 4 Apply:** Same hook block at the top of every `describe` that drives the scheduler under fake timers. NEVER `vi.advanceTimersByTime` (sync variant) — only `vi.advanceTimersByTimeAsync` per Phase 3 RESEARCH §Pitfall 5 (also reaffirmed in `04-RESEARCH §Pitfall 4`).

#### Pattern TR3 — Synthetic record helper inside the test file

**Source: `test/replay/replay.test.ts:33-35`** (verbatim):

```typescript
function makeRecords(count: number, cadenceMs = 100): RideRecord[] {
  return Array.from({ length: count }, (_, i) => ({ timestamp: 1000 + i * cadenceMs }));
}
```

**Phase 4 Apply:** Same helper, top of file. Used for all `{ records: [...] }` source-variant tests (the fast-path per D-API-05 — for trainer-sim's own tests).

#### Pattern TR4 — `await once(transport, 'complete')` cooperates with fake timers

**Source: `04-RESEARCH §Code Example 5`** (researched and verified this session):

```typescript
it('emits complete event on natural end (await once cooperates with fake timers)', async () => {
  const records: RideRecord[] = [
    { timestamp: 1000 }, { timestamp: 1100 }, { timestamp: 1200 },
  ];
  const transport = createFakeTransport(
    { source: { records } },
    { sleep: fakeAwareSleep },          // test-only seam — see 04-RESEARCH §Pitfall 4
  );
  const emitted: DataView[] = [];
  transport.onData((dv) => emitted.push(dv));

  const completePromise = once(transport, 'complete');
  await transport.connect();
  await vi.advanceTimersByTimeAsync(300);
  await completePromise;

  expect(emitted).toHaveLength(3);
});
```

**Phase 4 Apply:** This is the canonical "complete event under fake timers" form. Mirrors how Phase 3's `replay.test.ts` Group 1 (`replay.test.ts:78-128`) awaits `replay.completed`; Phase 4's equivalent at the *transport* layer is `await once(transport, 'complete')`.

#### Pattern TR5 — Eager `.catch(() => undefined)` on completion to avoid unhandled-rejection during awaits

**Source: `test/replay/abort.test.ts:91-98`**:

```typescript
// Attach a no-op failure handler eagerly so the eventual rejection
// does NOT register as an unhandled-rejection during the intermediate
// `await vi.advanceTimersByTimeAsync(...)` waits before the
// `await expect(...).rejects` assertion runs. The original
// `replay.completed` promise remains rejected — we observe it both
// ways below.
replay.completed.catch(() => undefined);
```

**Phase 4 Apply:** When a Phase 4 test asserts `disconnect()` semantics, the FakeTransport implementation already attaches the `.catch` internally (Pattern A4 above), so this defensive eager-catch is rarely needed in test code. BUT — for tests that await `transport.disconnect()` and then later assert on the in-flight emission count, the same pattern applies if the test reaches into Replay state directly (which Phase 4 tests do NOT — they go through the public surface, so the internal `.catch` already covers it).

#### Pattern TR6 — Subscriber-throws isolation test (Phase 4-specific, no Phase 3 analog)

**Pattern:** new test group exercising `D-API-10` per `04-RESEARCH §Pitfall 8`:

```typescript
describe('D-API-10: subscriber that throws does NOT abort the loop', () => {
  it('throwing handler does not starve other subscribers', async () => {
    const records: RideRecord[] = [{ timestamp: 1000 }, { timestamp: 1100 }];
    const transport = createFakeTransport(
      { source: { records } },
      { sleep: fakeAwareSleep },
    );
    const ok: DataView[] = [];
    transport.onData(() => { throw new Error('handler 1 boom'); });
    transport.onData((dv) => ok.push(dv));
    await transport.connect();
    await vi.advanceTimersByTimeAsync(200);
    await once(transport, 'complete');
    expect(ok).toHaveLength(2);  // both emissions reach handler 2
  });
});
```

#### Pattern TR7 — `reset()` semantics test (re-instantiate Replay)

**Pattern:** new test group exercising `D-API-14`:

```typescript
describe('D-API-14: reset() clears resistance log + recycles for next connect', () => {
  it('reset() clears received.resistance but preserves subscribers', async () => {
    const records: RideRecord[] = [{ timestamp: 1000 }];
    const transport = createFakeTransport(
      { source: { records } },
      { sleep: fakeAwareSleep },
    );
    const collected: DataView[] = [];
    transport.onData((dv) => collected.push(dv));

    await transport.sendResistance(0.05);
    await transport.sendResistance(0.10);
    expect(transport.received.resistance).toEqual([0.05, 0.10]);

    await transport.connect();
    await vi.advanceTimersByTimeAsync(50);
    await once(transport, 'complete');

    await transport.reset();
    expect(transport.received.resistance).toEqual([]);

    // After reset(), connect() succeeds again (single-use Replay was discarded).
    await transport.connect();
    await vi.advanceTimersByTimeAsync(50);
    await once(transport, 'complete');
    expect(collected).toHaveLength(2);  // subscriber preserved across reset()
  });
});
```

---

### `test/transport/path-and-buffer.test.ts` (CREATE)

**Primary analog:** `test/fit/loader.test.ts:1-76`

#### Pattern TPB1 — Fixture path resolution

**Source: `test/fit/loader.test.ts:33-42`**:

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { loadFitFromPath, loadFitFromBuffer } from '../../src/index.js';
import type { RideRecord } from '../../src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = resolve(__dirname, '../fixtures/fit');
```

**Phase 4 Apply:** Same imports plus `createFakeTransport` and `fakeAwareSleep`. Fixture is `basic.fit` (per `04-RESEARCH §Open Questions resolution 9` and `D-API-22`) — 443 records, 7 minutes, ROUVY clean 1Hz, 28 zero-power records (exercises the `rec.power ?? 0` collapse). Path:

```typescript
const FIXTURE = resolve(__dirname, '../fixtures/fit/basic.fit');
```

#### Pattern TPB2 — Path-and-buffer parity test

**Source: `test/fit/loader.test.ts:43-56`**:

```typescript
describe('FIT-01: loadFitFromPath / loadFitFromBuffer parity', () => {
  it('path and buffer entries return identical RideRecord arrays for basic.fit', async () => {
    const path = resolve(FIXTURE_DIR, 'basic.fit');
    const buf = readFileSync(path);
    const fromPath = await loadFitFromPath(path);
    const fromBuf = loadFitFromBuffer(buf);
    expect(fromPath).toEqual(fromBuf);
    expect(fromPath.length).toBeGreaterThan(0);
    expect(fromPath.length).toBeGreaterThanOrEqual(440);
    expect(fromPath.length).toBeLessThanOrEqual(445);
  });
```

**Phase 4 Apply:** Mirror at the *transport* layer — both source variants (`{ path }` and `{ buffer }`) should produce identical `DataView` byte streams when run through FakeTransport. Pseudocode:

```typescript
it('{ path } and { buffer } source variants produce identical emission streams', async () => {
  const buf = readFileSync(FIXTURE);
  const fromPathBytes: Uint8Array[] = [];
  const fromBufferBytes: Uint8Array[] = [];

  const t1 = createFakeTransport(
    { source: { path: FIXTURE }, speed: Infinity, maxEmissionHz: 1000 },
    { sleep: fakeAwareSleep },
  );
  t1.onData((dv) => fromPathBytes.push(new Uint8Array(dv.buffer.slice(dv.byteOffset, dv.byteOffset + dv.byteLength))));
  await t1.connect();
  await vi.advanceTimersByTimeAsync(60_000);  // basic.fit is 7min; speed=Infinity caps at 1000Hz → 443ms
  await once(t1, 'complete');

  const t2 = createFakeTransport(
    { source: { buffer: buf }, speed: Infinity, maxEmissionHz: 1000 },
    { sleep: fakeAwareSleep },
  );
  t2.onData((dv) => fromBufferBytes.push(new Uint8Array(dv.buffer.slice(dv.byteOffset, dv.byteOffset + dv.byteLength))));
  await t2.connect();
  await vi.advanceTimersByTimeAsync(60_000);
  await once(t2, 'complete');

  expect(fromPathBytes).toEqual(fromBufferBytes);
  expect(fromPathBytes.length).toBeGreaterThanOrEqual(440);
});
```

(The exact byte-comparison form depends on whether the planner wants to assert "same length" only or "identical byte content" — `04-RESEARCH §Pattern 5` notes the same `DataView` reference is shared across subscribers, so a byte-snapshot at emission time is the correct copy form. The planner picks the assertion strength.)

---

### `test/transport/publish.test.ts` (CREATE — `test.slow`)

**Primary analog:** `package.json:36-38` `validate:publint` + `validate:attw` scripts (existing wiring; no test file analog)

#### Pattern TPB3 — Shell-out test marked `test.slow`

This is a NEW pattern (no existing test in the repo shells out to `npm run`). The closest analog is the existing `package.json` validate chain:

```json
"build": "tsup",
"validate:publint": "publint",
"validate:attw": "attw --pack .",
"validate": "npm run build && npm run validate:publint && npm run validate:attw",
```

**Phase 4 Apply:** `test/transport/publish.test.ts` shells out via `child_process.execSync` (or `node:child_process` `spawnSync` with cwd-locked invocations). Marked `test.slow` per `D-API-22` so the default `npm test` still runs fast and `npm run prepublishOnly` remains the canonical full-validate gate. Pseudocode:

```typescript
import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');

describe.slow('publish hygiene (API-07 / API-08)', () => {
  it('publint passes against built dist/', () => {
    execSync('npm run build', { cwd: REPO_ROOT, stdio: 'inherit' });
    execSync('npm run validate:publint', { cwd: REPO_ROOT, stdio: 'inherit' });
  });

  it('attw passes against built dist/', () => {
    execSync('npm run validate:attw', { cwd: REPO_ROOT, stdio: 'inherit' });
  });
});
```

**Note:** `04-RESEARCH §Tooling Validation` confirms both `publint` and `attw` are GREEN against current `dist/` as of this session. Phase 4 does NOT change `package.json` or `tsup.config.ts`; the only change to the build artifact is the *content* (new `createFakeTransport` + 4 type exports flow through the existing single-rooted exports map). `publish.test.ts` exists to *catch a regression* if a future plan accidentally breaks the exports map.

---

### `test/_helpers/fake-aware-sleep.ts` (CREATE — pure lift)

**Primary analog:** byte-identical block at:
- `test/replay/scheduler.test.ts:50-82`
- `test/replay/abort.test.ts:32-62`
- `test/replay/replay.test.ts:37-67`
- `test/replay/loop.test.ts:23-53`

#### Pattern TH1 — The `fakeAwareSleep` body verbatim

**Source: `test/replay/scheduler.test.ts:50-82`** (or any of the other 3 — they are byte-identical except for one comment-line variation):

```typescript
/**
 * Test-only AbortSignal-aware sleep using `globalThis.setTimeout` (which
 * Vitest 4's `vi.useFakeTimers()` DOES intercept — RESEARCH §Pitfall 6
 * parallel). Mirrors the contract the production `node:timers/promises`
 * `setTimeout` honors: rejects with AbortError on signal abort, resolves
 * after `delay` ms otherwise, cleans up its abort listener on natural
 * completion.
 */
function fakeAwareSleep(
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

**Phase 4 Apply:** Lift verbatim into `test/_helpers/fake-aware-sleep.ts`, change `function fakeAwareSleep(...)` to `export function fakeAwareSleep(...)`, expand the JSDoc preamble to cite Phase 3 followup IN-01 + Phase 4 D-API-24 + the Pitfall 6 root cause (per `04-RESEARCH §Code Example 4`):

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

export function fakeAwareSleep(
  delay: number,
  _value?: undefined,
  options?: { signal?: AbortSignal },
): Promise<void> {
  // ... body byte-identical with the 4 source files ...
}
```

#### Pattern TH2 — Migration of the 4 Phase 3 test files

**Source: any of `test/replay/{scheduler,abort,replay,loop}.test.ts:35-67`** — drop the local function definition, add one import line at the top.

**Phase 4 Apply:** Each migrated file gains:

```typescript
import { fakeAwareSleep } from '../_helpers/fake-aware-sleep.js';
```

…and loses the local `function fakeAwareSleep(...)` definition (along with its JSDoc preamble). `04-RESEARCH §Open Questions resolution 8` confirms zero behavioral change. The plan should land this lift as the FIRST task in Wave 1 so subsequent transport tests can import from the new location without conflict.

---

## Shared Patterns (cross-cutting)

### S1 — `.js` extensions on relative imports

**Source:** every `.ts` file in `src/` and `test/` (e.g., `src/replay/replay.ts:75-77`, `src/index.ts:3-22`):

```typescript
import { runScheduler } from './scheduler.js';
import type { ReplayConfig, ReplayState } from './types.js';
import type { RideRecord } from '../types.js';
```

**Apply to ALL Phase 4 files:** new code uses `.js` extensions on relative imports per the Phase 1+ ESM-NodeNext discipline. NEVER write `from './scheduler'` (no extension) or `from './scheduler.ts'` (wrong extension).

### S2 — `verbatimModuleSyntax` discipline (`import type` for type-only imports)

**Source:** `src/replay/replay.ts:75-77`:

```typescript
import { runScheduler } from './scheduler.js';                  // value import
import type { ReplayConfig, ReplayState } from './types.js';    // type-only
import type { RideRecord } from '../types.js';                  // type-only
```

**Apply to ALL Phase 4 files:** The four new types (`ITrainerTransport`, `FakeTransport`, `FakeTransportConfig`, `FakeTransportSource`) are imported and re-exported with the `type` keyword. `createFakeTransport` is the one runtime-value export. Acceptance (informal — `tsup` build will fail otherwise): `tsc --noEmit -p tsconfig.test.json` must remain green.

### S3 — Per-task atomic conventional-commit prefixes

**Source:** repo `git log` (recent commits):
- `feat(03-...)`, `test(03-...)`, `docs(03-...)`, `fix(03-...)`

**Apply to Phase 4:** plan tasks should commit as `feat(04-...)`, `test(04-...)`, `refactor(04-...)` (the `fakeAwareSleep` lift is a refactor), `docs(04-...)`. The existing pattern is one commit per atomic unit of work, NOT one mega-commit per phase.

### S4 — Plan `<verification>` blocks with acceptance greps

**Source:** repeated pattern in Phase 1/2/3 plans (referenced from `04-CONTEXT.md` and `04-RESEARCH.md`):

```bash
grep -rn "bleno\|gatt\|advertis" src/index.ts src/types.ts src/transport/fake-transport.ts || echo "clean"
grep -rn "from '\.\./replay" src/ | grep -v "^src/transport/fake-transport.ts" || echo "clean"
```

**Apply to Phase 4 plan:** every task that creates or modifies a file should ship one or more acceptance greps that verify the locked invariants (no BLE-types, single-import-seam for `Replay`, `:transport` debuglog namespace present, `import type` discipline preserved).

### S5 — `debuglog` namespace convention (`'trainer-sim:<layer>'`)

**Source:**
- `src/fit/loader.ts:33` — `const log = debuglog('trainer-sim:fit');`
- `src/replay/scheduler.ts:75` — `const log = debuglog('trainer-sim:replay');`

**Phase 4 adds the third instance:** `const log = debuglog('trainer-sim:transport');` in `src/transport/fake-transport.ts`. Opt-in observability via `NODE_DEBUG=trainer-sim:transport`. Zero cost when unset.

### S6 — JSDoc decision-citation convention

**Source:** every Phase 1/2/3 file. Examples:
- `src/types.ts:8-19` — `Locked decisions: D-FIT-01 ... FIT-03`
- `src/replay/types.ts:9-23` — `Locked decisions (.planning/phases/03-replay-engine/03-CONTEXT.md): D-REPL-04 ... D-REPL-13`
- `src/replay/replay.ts:20-37` — `Implements (per .planning/phases/03-replay-engine/03-CONTEXT.md): D-REPL-07 ... D-REPL-13`
- `src/fit/loader.ts:8-16` — `Locked decisions: D-FIT-06 ... D-FIT-10`

**Apply to ALL Phase 4 files (source + tests):** the file preamble enumerates D-API-* decisions implemented + research-document section references. Inline decision citations in JSDoc on individual fields/methods/groups. This is the project's established self-documenting style — every line of prose is traceable to a numbered locked decision.

---

## No Analog Found

| File | Role | Reason | Mitigation |
|---|---|---|---|
| `test/transport/publish.test.ts` | shell-out test (publint + attw against `dist/`) | No prior test in the repo shells out to `npm run`. Existing wiring is the `package.json` `validate` script chain. | Use the `package.json:36-38` script names verbatim from inside the test (`execSync('npm run validate:publint')`); mark `test.slow` per D-API-22; run the build inside the test (the script already chains build + publint + attw). 04-RESEARCH §Tooling Validation confirms both validators are currently GREEN — the test exists to catch future regressions, not to fix current state. |

---

## Metadata

**Analog search scope:**
- `src/` — every existing module read directly (5 files: `index.ts`, `types.ts`, `replay/replay.ts`, `replay/scheduler.ts`, `replay/types.ts`, `fit/loader.ts`, `fit/errors.ts`, `ftms/indoor-bike-data.ts`)
- `test/replay/*` — 4 test files read directly (the `fakeAwareSleep` source-of-truth for the Phase 4 lift)
- `test/fit/loader.test.ts` — the closest fixture-backed test pattern
- `package.json`, `tsup.config.ts` — build/validate pipeline confirmed unchanged

**Files scanned:** 14 source/test files, 2 build configs

**Pattern extraction date:** 2026-05-16

**Confidence:** HIGH — every Phase 4 file has at least one same-repo analog; all locked decisions in `04-CONTEXT.md` map to a concrete excerpt with file:line citations.
