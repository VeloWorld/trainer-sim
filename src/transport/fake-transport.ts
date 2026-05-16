/**
 * FakeTransport factory — the keystone of Phase 4. Composes Phase 3's `Replay`
 * (`src/replay/replay.ts`), Phase 2's loader (`src/fit/loader.ts`), and
 * Phase 1's encoder (`src/ftms/indoor-bike-data.ts`) behind the
 * `ITrainerTransport` contract from `src/types.ts`. This is the first runtime
 * value `src/index.ts` exports for Phase 4 consumers.
 *
 * Returns a plain object literal (NOT a class instance — D-API-04 + Pitfall 2)
 * so consumers cannot narrow with `instanceof FakeTransport`. The returned
 * object closes over factory-scope state (`subscribers`, `resistanceLog`,
 * `replay`, `emitter`); v2's BLE-peripheral transport will be a sibling
 * factory inside `src/transport/` (D-API-18) with the same shape.
 *
 * Implements (per .planning/phases/04-faketransport-public-api/04-CONTEXT.md):
 *   - D-API-01: trainer-sim is the canonical definer of `ITrainerTransport`;
 *     this file is the canonical implementation.
 *   - D-API-02: every method returns `Promise<void>`; `sendResistance` forces
 *     a microtask boundary (`await Promise.resolve()`) so consumers cannot
 *     observe a Fake-vs-Bleno timing difference (PITFALLS.md §12).
 *   - D-API-03: NO BLE-specific tokens reachable from this file — acceptance
 *     grep at the phase-verification step enforces (D-API-03 + T-04-03-01).
 *   - D-API-04: synchronous factory; FIT load + `Replay` construction deferred
 *     to `connect()`. Filesystem errors and `FitLoadError` family land in
 *     `connect()`'s Promise rejection.
 *   - D-API-05: `config.source` is a discriminated union of three variants
 *     (`{ path }` / `{ buffer }` / `{ records }`).
 *   - D-API-06: factory-level synchronous validation of `speed > 0` and
 *     `maxEmissionHz > 0` — Phase 3 followup WR-05 fold per D-API-25. Replay
 *     stays internally lenient; the public boundary is the validation gate.
 *   - D-API-09: subscriber registry is a `Set<(data: DataView) => void>`.
 *     `onData` returns a disposer that calls `subscribers.delete(handler)`.
 *   - D-API-10: a subscriber that throws does NOT abort the fan-out loop —
 *     per-handler `try/catch` with `debuglog('trainer-sim:transport')` swallow.
 *   - D-API-11: composes `EventEmitter<{ complete: [] }>` (NOT extends) — the
 *     public surface stays narrow (4 ITrainerTransport methods + 4 FakeTransport
 *     additions); EventEmitter's other ~30 methods are NOT exposed.
 *   - D-API-12: `'complete'` fires when `Replay.completed` resolves naturally;
 *     does NOT fire when `disconnect()` cancels the replay. The `.then(success,
 *     failure)` form attaches both handlers eagerly so the cancel-rejection
 *     never surfaces as `unhandledRejection`.
 *   - D-API-13: `on`/`off`/`once` signatures are LITERAL `'complete'`-typed
 *     (NOT `string`-typed) so consumers narrowing to `FakeTransport` get the
 *     narrow form by default — kills the spoofing threat T-04-02-02.
 *   - D-API-14: `reset()` does (1) idempotent `disconnect()`, (2) truncate
 *     `resistanceLog` in place, (3) discard `Replay` (Phase 3's D-REPL-07
 *     single-use lock means recycling is impossible — discard-and-re-instantiate),
 *     (4) does NOT clear `onData` subscribers.
 *   - D-API-15: `reset()` returns `Promise<void>`.
 *   - D-API-16: `received: { resistance: ReadonlyArray<number> }` — v1 literal
 *     shape; NO pre-design of `received.controlPoint[]` for v2 GATT FMCP.
 *   - D-API-17: `resistanceLog` is a real internal `number[]` exposed via the
 *     `received` getter as `ReadonlyArray<number>`. NO `Object.freeze`.
 *   - D-API-18: this file is the SINGLE-IMPORT-SEAM for `Replay` — no other
 *     file in `src/` may import from `../replay/`. Acceptance grep enforces.
 *     v2's sibling transport file will be the second seam-holder.
 *   - D-API-20: per-record path collapses `rec.power ?? 0` and
 *     `rec.cadence ?? 0` inside the `replay.onRecord` callback BEFORE calling
 *     `encodeIndoorBikeData` — the ONLY place trainer-sim collapses
 *     absent-vs-zero (Phase 2's loader preserves the wire-level distinction
 *     per D-FIT-01).
 *   - D-API-21: NO new FTMS fields (speed, HR) emitted in v1 — encoder's
 *     `speed?` branch stays untested at this layer (Phase 1's tests cover both
 *     flag-bit branches independently).
 *   - D-API-25: Phase 3 followup WR-05 (factory-level `speed`/`maxEmissionHz`
 *     validation) folded here.
 *
 * Pitfalls addressed (per .planning/phases/04-faketransport-public-api/04-RESEARCH.md):
 *   §1 — `sendResistance` microtask boundary forced via `await Promise.resolve()`
 *        BEFORE the push, so v2's wire-write timing is observable in v1 Fake
 *        (tests written against v1 will not break against v2).
 *   §2 — No `class FakeTransport` declaration; the factory returns a plain
 *        object literal so `instanceof FakeTransport` cannot leak.
 *   §3 — A handler that calls its own disposer mid-fan-out is invoked once
 *        (the current iteration step), then removed for future emissions.
 *        ECMA-262 §Set.prototype[@@iterator] specifies the behavior — no
 *        snapshot/copy needed.
 *   §6 — `disconnect()` calls `replay.stop()` (sync) then awaits
 *        `replay.completed.catch(() => undefined)` so the scheduler's last
 *        microtask fully unwinds before the disconnect Promise resolves.
 *        REPL-06 invariant ("after disconnect resolves, no further onData
 *        callbacks fire") is observable at the FakeTransport boundary.
 *        Phase 3's CR-01 fix (commit `e4b04a9`) closes the post-sleep abort
 *        race inside the scheduler; this await is defense-in-depth at the
 *        transport boundary.
 *   §8 — Per-handler `try/catch` wraps each subscriber invocation so a
 *        throwing handler (e.g., a test assertion failure) does NOT starve
 *        other subscribers — `for...of` would otherwise propagate the throw
 *        out of the iteration.
 *
 * References:
 *   - .planning/phases/04-faketransport-public-api/04-CONTEXT.md (D-API-01..26)
 *   - .planning/phases/04-faketransport-public-api/04-RESEARCH.md
 *       §Code Example 1 (factory skeleton); §Patterns 1-5; §Pitfalls 1-8.
 *   - .planning/phases/04-faketransport-public-api/04-PATTERNS.md
 *       §Pattern A1-A7 (module-doc, single-import seam, debuglog, defuse,
 *       sync validation, abort re-check, closure-state JSDoc).
 *   - .planning/research/PITFALLS.md §12 (sendResistance microtask boundary).
 */

import { EventEmitter } from 'node:events';
import { debuglog } from 'node:util';
import { encodeIndoorBikeData } from '../ftms/indoor-bike-data.js';
import { loadFitFromBuffer, loadFitFromPath } from '../fit/loader.js';
// THE SINGLE Replay IMPORT IN ALL OF src/. No other src/* file may import
// from `../replay/` — D-API-18 seam (v2 BlenoTransport will be the second).
// Acceptance grep enforces.
import { Replay } from '../replay/replay.js';
import type { FakeTransport, FakeTransportConfig, RideRecord } from '../types.js';

const log = debuglog('trainer-sim:transport');

/**
 * Type of the AbortSignal-aware delay primitive Phase 3's `Replay.start`
 * accepts as its test-only `sleep` injection seam (matches `replay.ts:201-205`
 * exactly). Vitest 4 cannot fake the `node:timers/promises` module-level
 * binding (Phase 3 RESEARCH §Pitfall 6), so tests pass a
 * `globalThis.setTimeout`-based variant through the FakeTransport factory's
 * `options.sleep` and we forward it unchanged.
 */
type SleepFn = (
  delay: number,
  value?: undefined,
  options?: { signal?: AbortSignal },
) => Promise<void>;

/**
 * Synchronous FakeTransport factory. Validates `speed`/`maxEmissionHz` per
 * D-API-06 then returns a plain object literal whose methods close over
 * factory-scope state. FIT loading and `Replay` construction are deferred to
 * `connect()` per D-API-04 — filesystem errors (`ENOENT`, `EACCES`) and
 * `FitLoadError` family land in `connect()`'s Promise rejection unchanged.
 *
 * @param options.sleep test-only injection seam — DO NOT use in production
 * code. Forwarded verbatim to `Replay.start({ sleep })` for tests that drive
 * the scheduler under fake timers. Kept off `FakeTransportConfig` to avoid
 * encouraging consumer use.
 */
export function createFakeTransport(
  config: FakeTransportConfig,
  options?: { sleep?: SleepFn },
): FakeTransport {
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

  /** D-API-09 — Set fan-out registry. O(1) add/delete; insertion-order iteration. */
  const subscribers = new Set<(data: DataView) => void>();

  /**
   * D-API-16 / D-API-17 — internal mutable backing for `received.resistance`;
   * exposed as `ReadonlyArray<number>` at the type level (no `Object.freeze`).
   * `reset()` truncates IN PLACE so consumers who hold a reference to
   * `transport.received.resistance` across `reset()` see the same array
   * identity stay stable.
   */
  const resistanceLog: number[] = [];

  /**
   * D-API-11 — composed (NOT extended) `EventEmitter` for the `'complete'`
   * surface. Typed with the empty-tuple form (`{ complete: [] }`) so
   * `emitter.emit('complete')` requires zero args and `emitter.on('complete',
   * listener)` infers `listener: () => void`.
   */
  const emitter = new EventEmitter<{ complete: [] }>();

  /**
   * Lazily constructed in `connect()`; discarded in `reset()`/`disconnect()`
   * (Phase 3's D-REPL-07 single-use lock forces discard-and-re-instantiate).
   * `connect()` early-returns when this is set; `disconnect()` early-returns
   * when undefined — defense-in-depth idempotency.
   */
  let replay: Replay | undefined;
  // CR-01 — concurrent `connect()` callers share the same in-flight Promise so
  // a second caller cannot bypass the `replay !== undefined` guard during the
  // `await loadRecords()` window. `disconnect()`/`reset()` await this too so
  // they cannot race past an in-flight connect (closes WR-03).
  let connectInFlight: Promise<void> | undefined;

  async function loadRecords(): Promise<ReadonlyArray<RideRecord>> {
    const src = config.source;
    if ('records' in src) return src.records;
    if ('buffer' in src) return loadFitFromBuffer(src.buffer);
    return loadFitFromPath(src.path);
  }

  function connect(): Promise<void> {
    if (replay !== undefined) return Promise.resolve();
    if (connectInFlight !== undefined) return connectInFlight;
    connectInFlight = (async () => {
      try {
        const records = await loadRecords();
        // CR-02 — reject empty-records source at the public boundary so
        // `replay` never points at a never-started Replay (Phase 3's D-REPL-13
        // throws synchronously on `start()` but only after the constructor
        // assigns; without this guard the transport wedges permanently).
        if (records.length === 0) {
          throw new Error('createFakeTransport.connect: source produced zero records');
        }
        const r = new Replay({ records, speed, loop, maxEmissionHz });
        r.onRecord((rec) => {
          const dv = encodeIndoorBikeData({
            power: rec.power ?? 0,
            cadence: rec.cadence ?? 0,
          });
          for (const h of subscribers) {
            try {
              h(dv);
            } catch (err) {
              log('subscriber threw: %O', err);
            }
          }
        });
        // CR-03 — wrap `emitter.emit('complete')` in try/catch. EventEmitter
        // re-throws listener exceptions synchronously and the surrounding
        // `.then(success, failure)` does NOT catch errors thrown in the
        // `success` arm; a throwing `'complete'` listener would otherwise
        // surface as `unhandledRejection`. Per-handler try/catch matches the
        // `onRecord` fan-out discipline above.
        r.completed.then(
          () => {
            try {
              emitter.emit('complete');
            } catch (err) {
              log("'complete' listener threw: %O", err);
            }
          },
          () => undefined,
        );
        // CR-02 — only commit `replay` after `start()` returns without throwing.
        // Defense-in-depth against any future Replay.start() throw path
        // (D-REPL-09 pre-aborted signal also throws synchronously).
        r.start(options?.sleep ? { sleep: options.sleep } : undefined);
        replay = r;
      } finally {
        connectInFlight = undefined;
      }
    })();
    return connectInFlight;
  }

  async function disconnect(): Promise<void> {
    // WR-03 — drain any in-flight connect() FIRST so its synchronous `replay = r`
    // assignment cannot land after we returned from disconnect(). Swallow its
    // rejection here — the connect() caller's own awaiter still observes it.
    if (connectInFlight !== undefined) {
      await connectInFlight.catch(() => undefined);
    }
    if (replay === undefined) return;
    // Capture locally and clear BEFORE the await so a re-entrant connect()
    // during the unwind constructs a fresh Replay cleanly.
    const r = replay;
    replay = undefined;
    r.stop();
    await r.completed.catch(() => undefined);
  }

  function onData(handler: (data: DataView) => void): () => void {
    subscribers.add(handler);
    return () => {
      subscribers.delete(handler);
    };
  }

  async function sendResistance(grade: number): Promise<void> {
    // PITFALLS.md §12 microtask boundary — MUST happen BEFORE the push so the
    // observable timing matches what v2 BlenoTransport's BLE-write callback
    // will produce.
    await Promise.resolve();
    resistanceLog.push(grade);
  }

  async function reset(): Promise<void> {
    await disconnect();
    resistanceLog.length = 0;
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
    on(event: 'complete', listener: CompleteListener): void {
      emitter.on(event, listener);
    },
    off(event: 'complete', listener: CompleteListener): void {
      emitter.off(event, listener);
    },
    once(event: 'complete', listener: CompleteListener): void {
      emitter.once(event, listener);
    },
  };
  return transport;
}
