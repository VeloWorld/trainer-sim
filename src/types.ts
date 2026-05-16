/**
 * Shared types for trainer-sim. Phase 2 introduces `RideRecord` — the contract
 * Phase 3 (replay engine) iterates over and Phase 4 (FakeTransport) consumes.
 * Phase 4 extends this file with the public transport contract
 * (`ITrainerTransport`) and the FakeTransport-specific shapes
 * (`FakeTransport`, `FakeTransportConfig`, `FakeTransportSource`) rather than
 * scattering types across modules — D-API-01 makes trainer-sim the canonical
 * definer, so the contract lives in exactly one file.
 *
 * Locked decisions:
 *   - D-FIT-01 (.planning/phases/02-fit-loader-normalization/02-CONTEXT.md):
 *     `RideRecord` shape is `{ timestamp: number; power?: number; cadence?: number }`.
 *     Optional fields use `undefined` (omitted property) for absent signals;
 *     a real `0` from the FIT wire stays `0`. This preserves the wire-level
 *     distinction between "rider coasting" and "no sensor reading" — Phase 1's
 *     IndoorBikeData encoder gates the FTMS flag bit on `value === undefined`,
 *     and collapsing absent → 0 here would silently emit a flag-bit-cleared
 *     payload claiming 0 W power. Don't.
 *   - FIT-03 (.planning/REQUIREMENTS.md): timestamp is Unix epoch ms, NOT FIT
 *     epoch (FIT epoch = seconds since 1989-12-31 UTC). The loader (plan 02-03)
 *     applies the offset; downstream code only ever sees Unix ms.
 *   - D-API-01 (.planning/phases/04-faketransport-public-api/04-CONTEXT.md):
 *     trainer-sim is the canonical definer of `ITrainerTransport`
 *     (ARCHITECTURE.md Pattern 4 + Anti-Pattern 6). The interface lives here
 *     next to `RideRecord`; consumers (e.g., VeloWorld) import the type from
 *     `trainer-sim` rather than defining their own.
 *   - D-API-02: `connect()`, `disconnect()`, and `sendResistance(grade)` all
 *     return `Promise<void>`. Even Fake's `sendResistance` forces a microtask
 *     boundary so consumers cannot observe a Fake-vs-Bleno timing difference
 *     (PITFALLS.md §12). The async semantics are owned by the interface, not
 *     the implementation.
 *   - D-API-13: `ITrainerTransport` does NOT include event-emitter methods.
 *     The `'complete'` event lives on the wider `FakeTransport` subtype so
 *     v2's BlenoTransport can add transport-specific events (e.g., a
 *     `'disconnect'` event for BLE link-loss) without widening the interface.
 *   - D-API-05: `FakeTransportSource` is a discriminated union of three
 *     variants — `{ path }`, `{ buffer }`, `{ records }`. The `{ records }`
 *     variant is for trainer-sim's OWN tests (skip FIT parse for speed);
 *     consumer-facing tests should use `{ path }` or `{ buffer }` so the FIT
 *     load path stays exercised end-to-end.
 *   - D-API-06: `FakeTransportConfig` defaults (`speed = 1`, `loop = false`,
 *     `maxEmissionHz = 1000`) are applied in the factory body, not the type
 *     system — every field stays optional here so consumers can pass
 *     `{ source }` alone for the default behavior.
 *   - D-API-16 / D-API-17: `FakeTransport.received` shape is the v1 literal
 *     `{ resistance: ReadonlyArray<number> }`. NO pre-design of
 *     `received.controlPoint[]` for v2 GATT FMCP opcodes (CLAUDE.md "no
 *     abstractions for hypothetical future requirements"). The readonly
 *     posture is enforced at the type level only — no `Object.freeze`.
 */

import type { Buffer } from 'node:buffer';

/**
 * One sample from a parsed FIT ride file. The replay engine emits these to
 * subscribers in timestamp order; the FTMS encoder turns them into wire bytes.
 */
export interface RideRecord {
  /**
   * Unix epoch milliseconds (NOT FIT epoch — the 1989-12-31 UTC offset has
   * been applied by the loader). FIT-03.
   */
  timestamp: number;

  /**
   * Watts. `undefined` = no power signal (sensor disconnected, file lacks the
   * field, FIT invalid sentinel). `0` = rider coasting / freewheeling. Do NOT
   * collapse `undefined` to `0` — Phase 1's encoder gates the FTMS flag bit on
   * `value === undefined`, and the wire-level distinction between "no signal"
   * and "0 W" is the whole point of D-FIT-01.
   */
  power?: number;

  /**
   * RPM. Same absent-vs-zero semantics as `power`: `undefined` = no cadence
   * sensor reading; `0` = pedals stopped.
   */
  cadence?: number;
}

/**
 * Transport contract — what trainer-sim's FakeTransport (and v2's
 * BlenoTransport) provide, and what consumers (e.g., VeloWorld) program
 * against.
 *
 * Per D-API-01, trainer-sim is the canonical definer of this interface
 * (ARCHITECTURE.md Pattern 4 + Anti-Pattern 6); VeloWorld imports the type
 * from this package rather than defining its own. Adding methods (e.g., v2's
 * GATT FMCP opcodes) is a single-file change here, and consumers see additive
 * changes only.
 *
 * Per D-API-13, this interface does NOT include event-emitter methods. The
 * `'complete'` event lives on the FakeTransport-shaped subtype (below) so
 * v2's BlenoTransport can add transport-specific events (e.g., `'disconnect'`
 * on BLE link-loss) without widening the interface. Consumers who only
 * program against this shape can `await transport.connect()` and rely on
 * Promise chains; consumers who want the event hook narrow to
 * `FakeTransport`.
 *
 * Per D-API-02, every method returns `Promise<void>`. Even Fake's
 * `sendResistance` forces a microtask boundary (PITFALLS.md §12) so consumers
 * cannot observe a Fake-vs-Bleno timing difference — the interface owns the
 * async semantics, not the implementation.
 */
export interface ITrainerTransport {
  /**
   * Begin the trainer signal. For FakeTransport this loads the FIT input
   * (deferred from factory time per D-API-04 — filesystem `ENOENT`/`EACCES`
   * and `FitLoadError` family land in this Promise's rejection) and starts
   * the replay scheduler. Idempotent: re-calling on a connected transport is
   * a no-op.
   */
  connect(): Promise<void>;

  /**
   * Stop the trainer signal. After the returned Promise resolves, no further
   * `onData` callbacks fire (Phase 3 CR-01 invariant — commit `e4b04a9`).
   * Idempotent: re-calling on a disconnected transport is a no-op.
   */
  disconnect(): Promise<void>;

  /**
   * Subscribe to FTMS Indoor Bike Data emissions. The handler receives a
   * `DataView` whose backing bytes follow the Bluetooth SIG FTMS v1.0.1 §4.9
   * frame layout (Phase 1's encoder produces these). Returns a synchronous
   * disposer — call it to unsubscribe. Multiple subscribers are fanned out
   * in insertion order; a handler that throws does NOT abort the loop or
   * starve other subscribers (D-API-10).
   */
  onData(handler: (data: DataView) => void): () => void;

  /**
   * Echo-only: record the grade in `received.resistance` and resolve. Per
   * D-API-02 the Promise is always real (microtask boundary forced even on
   * Fake) so consumer code paths cannot observe a Fake-vs-Bleno timing
   * difference. This method does NOT modify replayed payloads — replay stays
   * faithful to the source FIT (PROJECT.md "sendResistance is echo-only").
   */
  sendResistance(grade: number): Promise<void>;
}

/**
 * FIT input source for `createFakeTransport`. Discriminated union per
 * D-API-05 — the consumer is explicit about which load path runs at
 * `connect()` time:
 *   - `{ path }`     → delegates to Phase 2's `loadFitFromPath` (async I/O).
 *   - `{ buffer }`   → delegates to Phase 2's `loadFitFromBuffer` (sync).
 *   - `{ records }`  → bypasses the loader entirely.
 *
 * The `{ records }` variant is for trainer-sim's OWN tests (skip FIT parse
 * for speed). Consumer-facing tests SHOULD use `{ path }` or `{ buffer }` so
 * the FIT path stays exercised end-to-end — that is the load path real
 * VeloWorld dev/test runs will hit.
 */
export type FakeTransportSource =
  | { path: string }
  | { buffer: Buffer | Uint8Array }
  | { records: ReadonlyArray<RideRecord> };

/**
 * Top-level config for `createFakeTransport`.
 *
 * Per D-API-06 the defaults (`speed = 1`, `loop = false`,
 * `maxEmissionHz = 1000`) are applied in the factory body, not by the type
 * system — every field stays optional here so consumers can pass
 * `{ source }` alone for the default behavior. The factory does input
 * validation that Phase 3's `Replay.start` doesn't (`speed > 0`,
 * `maxEmissionHz > 0`); validation throws synchronously from the factory
 * call before `connect()` returns its Promise.
 *
 * Field semantics map 1:1 to Phase 3's internal `ReplayConfig`
 * (`src/replay/types.ts`) minus `records` (which the source variants
 * supply).
 */
export interface FakeTransportConfig {
  /** FIT input source. Required. See `FakeTransportSource` for the variants. */
  source: FakeTransportSource;

  /**
   * Replay speed multiplier. `1` = real-time; `2` = 2× faster than the FIT
   * timestamps; `Infinity` = as-fast-as-possible (rate-limited by
   * `maxEmissionHz`). Default `1`. The factory throws synchronously if
   * `speed <= 0` (would invert time) — Phase 3 followup WR-05 fold per
   * D-API-25.
   */
  speed?: number;

  /**
   * When `true`, replay restarts from cursor 0 after the last record (Phase 3
   * D-REPL-06 rebases the baseline so drift cannot accumulate across loop
   * boundaries). Default `false` — stop-at-end (D-REPL-07), which is when
   * the `'complete'` event fires.
   */
  loop?: boolean;

  /**
   * Maximum emission frequency in Hz. Default `1000`. The Phase 3 scheduler
   * clamps each per-tick delay to `Math.max(target - now, 1000 /
   * maxEmissionHz)`, which both rate-limits the `speed === Infinity` case
   * and provides a knob for soak tests to simulate sparse-record load. The
   * factory throws synchronously if `maxEmissionHz <= 0` (Phase 3 followup
   * WR-05 fold per D-API-25).
   */
  maxEmissionHz?: number;
}

/**
 * Public return type of `createFakeTransport`. Extends `ITrainerTransport`
 * with FakeTransport-specific affordances — the `received` resistance log,
 * `reset()` for `afterEach()`-isolated test reuse, and the `'complete'`
 * event surface.
 *
 * Per D-API-13, the `on`/`off`/`once` signatures are LITERALLY
 * `'complete'`-typed (event name is the literal string `'complete'`,
 * listener is the literal `() => void`) — NOT
 * `Pick<EventEmitter, 'on'|'off'|'once'>`, which would inherit the loose
 * `string | symbol` overloads (04-RESEARCH §Pattern 2). Consumers who
 * annotate `const t: FakeTransport = createFakeTransport(...)` get the
 * narrow form by default, which kills the spoofing threat T-04-02-02
 * (consumer narrows their own variable, inherits loose overloads).
 *
 * Per D-API-16, `received` is the v1 literal shape `{ resistance:
 * ReadonlyArray<number> }`. NO pre-design of `received.controlPoint[]` for
 * v2 GATT FMCP opcodes — v2 will widen additively when the actual opcode
 * work lands. Per D-API-17, the readonly posture is type-level only (no
 * `Object.freeze`); this matches Phase 3's `private readonly config`
 * (frozen by convention).
 */
export interface FakeTransport extends ITrainerTransport {
  /**
   * Per-test echo log. Append-only at the implementation level; exposed as
   * `ReadonlyArray<number>` at the type level so callers cannot push.
   * `sendResistance(grade)` appends `grade`; `reset()` clears the array.
   * D-API-16 / D-API-17.
   */
  readonly received: { resistance: ReadonlyArray<number> };

  /**
   * Make this instance reusable across `afterEach()`-isolated tests. Per
   * D-API-14: (1) `disconnect()` if currently running; (2) clear
   * `received.resistance` to `[]`; (3) construct a fresh internal `Replay`
   * for the next `connect()` (Phase 3's single-use lock — D-REPL-07 — means
   * recycling is impossible; the only legal path is discard-and-reinstantiate).
   * Does NOT clear `onData` subscribers — vitest idiom registers handlers in
   * `beforeEach`, so subscriber state is naturally fresh; reset's job is
   * per-test state (resistance log + replay cursor), not registry state.
   */
  reset(): Promise<void>;

  /**
   * Subscribe to the `'complete'` event, which fires when the replay
   * finishes naturally (cursor exhaustion, `loop === false` — D-API-12).
   * Does NOT fire when `disconnect()` aborts the replay (user-driven stop,
   * not a natural completion). The event is the FakeTransport-specific
   * affordance per D-API-13 — consumers can also `await transport.connect()`
   * if they don't need the event hook.
   */
  on(event: 'complete', listener: () => void): void;

  /** Unsubscribe a previously-registered `'complete'` listener. */
  off(event: 'complete', listener: () => void): void;

  /** Subscribe a one-shot `'complete'` listener. Auto-removes after firing. */
  once(event: 'complete', listener: () => void): void;
}
