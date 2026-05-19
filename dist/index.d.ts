/**
 * FTMS IndoorBikeData (0x2AD2) encoder — vendored under PROJECT.md "Vendor the
 * FTMS encoder for v1" key decision. Intended to extract cleanly to
 * `@veloworld/ftms-codec` in v2; therefore this module imports nothing from
 * elsewhere in the project (no config, no logger, no shared utils). The only
 * external API touched is `node:buffer`.
 *
 * Spec authority:
 *   Bluetooth SIG Fitness Machine Service v1.0.1 §4.9 "Indoor Bike Data"
 *   (characteristic 0x2AD2). Frame layout: little-endian Flags (uint16) followed
 *   by present fields in spec order. Cross-confirmed by two independent
 *   implementations (Auuki AGPL-3.0 reference; PyFTMS Apache-2.0 reference) —
 *   neither is imported here; Auuki is AGPL and stays out of an MIT repo
 *   (CONTEXT.md D-03c).
 *
 * Encoding traps addressed (see .planning/research/PITFALLS.md):
 *   §1 — Bit 0 ("More Data") is INVERTED: 0 = speed PRESENT, 1 = NOT PRESENT.
 *        Implemented in `buildFlags` per CONTEXT.md D-05; the inversion is
 *        encoded as a real branch (NOT a hard-coded 0x0045 literal) so the
 *        speed-present case works the moment a future caller passes `speed`.
 *   §2 — InstantaneousPower is sint16 (the spec is unambiguous; Auuki's source
 *        treats it as uint16, which is a known Auuki bug). Power is written via
 *        `setInt16(_, _, true)` and gated by `assertInt16` (Phase 5 / WR-01)
 *        so out-of-range values throw `RangeError` instead of silently
 *        wrapping via `ToInt16` (the DataView migration would otherwise
 *        regress the throw-on-overflow contract that `Buffer.writeInt16LE`
 *        provided). The FIELDS table marks `'sint16'` and a developer who
 *        "fixes" it to `'uint16'` to match Auuki breaks the assertion that
 *        plan 04 ships.
 *   §3 — InstantaneousCadence has 0.5 rpm resolution; wire = round(rpm / 0.5).
 *        The FIELDS table is the only place the resolution lives.
 *   §4 — Multi-byte fields are LE; raw DataView writes default to BE.
 *        This file uses `DataView.set{Uint,Int}16(_, _, true)` exclusively
 *        (the third arg `true` means little-endian) so byte order is explicit
 *        at every call site. Previously this file used `Buffer.write{U,Int}16LE`
 *        per CONTEXT.md D-10; that has been superseded to make trainer-sim
 *        bundleable into browser/renderer contexts (Phase 5 / D-VW-10) where
 *        Node's `Buffer` is unavailable. The wire format is byte-identical;
 *        consumers (and the existing third-party-decoder round-trip test) see
 *        no change.
 *   §5 — Wire-fractional values (cadence at 0.5, speed at 0.01) are rounded
 *        with `Math.round` before the integer write; otherwise sensor noise
 *        like `cadence = 73.3` silently truncates instead of rounding.
 *
 * References:
 *   - .planning/phases/01-vendored-ftms-codec/01-CONTEXT.md
 *       D-04 (record shape), D-05 (bit-0 inversion verbatim),
 *       D-06 (both branches active), D-07 (public surface),
 *       D-08 (pure stateless), D-09 (FIELDS source-of-truth),
 *       D-10 (Buffer.write*LE only — superseded by D-VW-10; see header above).
 *   - .planning/research/PITFALLS.md §1–§5.
 *   - PROJECT.md key decisions: "Vendor the FTMS encoder for v1";
 *     "DataView is the consumer-facing payload type".
 */
/**
 * Input record for the IndoorBikeData encoder. Per CONTEXT.md D-07, Phase 1
 * supports power + cadence (always present) and an optional speed channel.
 *
 * Future-coupling: this shape extracts to `@veloworld/ftms-codec` unchanged in
 * v2. Adding fields (heart rate, distance, resistance, …) is purely additive
 * because the FIELDS table drives flag-bit and field-order semantics.
 */
interface IndoorBikeRecord {
    /**
     * Watts, sint16 range (`-32768..+32767`), 1 W resolution. Negative values
     * are valid (regenerative braking, freewheeling on smart trainers that
     * support it). Spec-mandated signed type — see PITFALLS.md §2 for why
     * encoding power as uint16 is a silent bug.
     */
    power: number;
    /**
     * Cadence in rpm. Wire encoding is uint16 with 0.5 rpm resolution
     * (`wire = round(rpm / 0.5)` — see PITFALLS.md §3). Half-rpm values like
     * `90.5` are intended and round-trip exactly.
     */
    cadence: number;
    /**
     * Speed in km/h. Wire encoding is uint16 with 0.01 km/h resolution. v1
     * callers (Phase 3 replay) omit this; the encoder still implements the
     * speed-present branch so the bit-0 inversion logic is exercised by tests
     * and a future caller can opt in without an encoder rewrite (CONTEXT.md
     * D-04 / D-06).
     */
    speed?: number;
}
/**
 * Encode an IndoorBikeRecord to an FTMS IndoorBikeData characteristic payload.
 *
 * Pure, stateless function (CONTEXT.md D-08): allocates a fresh ArrayBuffer
 * per call, returns a DataView over its memory, and shares no state with
 * previous calls. The returned DataView is the caller-facing payload type
 * (PROJECT.md mandate) and owns its bytes. Suitable for 1 Hz emission; a
 * buffer pool is a v2 concern only if soak tests show GC jank (PITFALLS.md
 * performance #2).
 *
 * Field order on the wire (per FTMS §4.9): Flags, then any present fields in
 * spec order (Speed before Cadence before Power). Speed is omitted when
 * `record.speed === undefined`, in which case bit 0 of Flags is 1.
 */
declare function encodeIndoorBikeData(record: IndoorBikeRecord): DataView;

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
/**
 * One sample from a parsed FIT ride file. The replay engine emits these to
 * subscribers in timestamp order; the FTMS encoder turns them into wire bytes.
 */
interface RideRecord {
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
interface ITrainerTransport {
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
type FakeTransportSource = {
    path: string;
} | {
    buffer: Uint8Array;
} | {
    records: ReadonlyArray<RideRecord>;
};
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
interface FakeTransportConfig {
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
interface FakeTransport extends ITrainerTransport {
    /**
     * Per-test echo log. Append-only at the implementation level; exposed as
     * `ReadonlyArray<number>` at the type level so callers cannot push.
     * `sendResistance(grade)` appends `grade`; `reset()` clears the array.
     * D-API-16 / D-API-17.
     */
    readonly received: {
        resistance: ReadonlyArray<number>;
    };
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

/**
 * Synchronous entry point. Validates header + CRC, parses, detects dev-field
 * shadow (debuglog only), then delegates to `normalize`. Throws all four
 * `FitLoadError` subclasses on appropriate corruption (D-FIT-06).
 *
 * Sync per D-FIT-07 — exploits the parser's sync-callback property.
 */
declare function loadFitFromBuffer(input: Uint8Array): RideRecord[];
/**
 * Async entry point. Reads the file via `fs/promises.readFile`, then
 * delegates to `loadFitFromBuffer` for all FIT-format validation and parsing.
 *
 * Filesystem errors (ENOENT, EACCES, EISDIR) bubble up as Node's standard
 * `Error` types — they are deliberately NOT wrapped in `FitLoadError`
 * subclasses because they describe filesystem failures, not FIT-format
 * failures. Plan 02-04 will document this distinction in test expectations.
 */
declare function loadFitFromPath(path: string): Promise<RideRecord[]>;

/**
 * First typed-error hierarchy in trainer-sim. Future phases (replay timeouts,
 * transport failures, etc.) follow the same `extends FitLoadError`-style
 * pattern: an abstract base + concrete leaf classes whose `name` propagates
 * via `this.constructor.name`.
 *
 * Per D-FIT-06 (.planning/phases/02-fit-loader-normalization/02-CONTEXT.md):
 * fail-fast on **corrupt** input. Valid-but-weird input (autopause gaps,
 * sparse cadence, null power, non-shadow developer fields) is the happy path
 * and does NOT throw — that's FIT-04's "load without throwing on weird shapes."
 *
 * **Deliberate non-member: there is NO developer-field-shadow error class.**
 * Per D-FIT-10 + the FIT-05 amendment in REQUIREMENTS.md (locked 2026-05-16),
 * developer-defined-field name collisions on standard `record` fields (e.g.
 * TrainerRoad's `"power"`) are NON-FATAL: the loader emits
 * `util.debuglog('trainer-sim:fit')` and returns the parser's result as-is.
 * Adding a typed shadow-error class here would invite future code to throw
 * it, breaking the locked behavior. The research example in 02-RESEARCH.md
 * §Code Examples Example 3 predates D-FIT-10 and is stale on this point —
 * the shadow class shown there must NOT be carried into this hierarchy.
 */
/**
 * Abstract base for all FIT-load failures. Consumers can catch the base for
 * generic handling (`catch (e) { if (e instanceof FitLoadError) ... }`) or
 * narrow on a concrete subclass for specific recovery. Marked `abstract` so
 * `new FitLoadError(...)` is a compile-time error — every throw site picks a
 * concrete subclass.
 */
declare abstract class FitLoadError extends Error {
    constructor(message: string);
}
/** Bad magic / wrong header bytes / header length not 12 or 14. */
declare class InvalidFitHeaderError extends FitLoadError {
}
/**
 * CRC-16/ARC mismatch. trainer-sim computes this itself because
 * `fit-file-parser` 3.0 has the CRC verification TODO-commented-out
 * (per .planning/phases/02-fit-loader-normalization/02-RESEARCH.md §Critical Finding).
 */
declare class FitCrcError extends FitLoadError {
}
/** File ends mid-header / mid-data / mid-CRC-trailer. */
declare class FitTruncatedError extends FitLoadError {
}
/**
 * Valid FIT (header + CRC + parses cleanly) but contains zero `record`
 * messages — typical of workout-only files or GPX exports mislabeled as FIT.
 */
declare class NoRecordMessagesError extends FitLoadError {
}

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

/**
 * Type of the AbortSignal-aware delay primitive Phase 3's `Replay.start`
 * accepts as its test-only `sleep` injection seam (matches `replay.ts:201-205`
 * exactly). Vitest 4 cannot fake the `node:timers/promises` module-level
 * binding (Phase 3 RESEARCH §Pitfall 6), so tests pass a
 * `globalThis.setTimeout`-based variant through the FakeTransport factory's
 * `options.sleep` and we forward it unchanged.
 */
type SleepFn = (delay: number, value?: undefined, options?: {
    signal?: AbortSignal;
}) => Promise<void>;
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
declare function createFakeTransport(config: FakeTransportConfig, options?: {
    sleep?: SleepFn;
}): FakeTransport;

export { type FakeTransport, type FakeTransportConfig, type FakeTransportSource, FitCrcError, FitLoadError, FitTruncatedError, type ITrainerTransport, type IndoorBikeRecord, InvalidFitHeaderError, NoRecordMessagesError, type RideRecord, createFakeTransport, encodeIndoorBikeData, loadFitFromBuffer, loadFitFromPath };
