# Architecture Research

**Domain:** Node.js BLE FTMS smart trainer simulator (FIT replay → in-process / BLE peripheral)
**Researched:** 2026-05-13
**Confidence:** HIGH

## Standard Architecture

### System Overview

The library is a one-way pipeline from a FIT file on disk to FTMS-encoded notifications
on the consumer's `onData` handler. Each box is a pure-ish unit with a narrow seam to the
next; the only place plumbing diverges is the final transport.

```
┌──────────────────────────────────────────────────────────────────────────┐
│                          Public API (index.ts)                           │
│             createFakeTransport(config) → ITrainerTransport              │
└───────────────────────────────────────────┬──────────────────────────────┘
                                            │
┌───────────────────────────────────────────▼──────────────────────────────┐
│                        Transport Layer (the seam)                        │
│   ┌─────────────────────────┐         ┌─────────────────────────────┐    │
│   │     FakeTransport       │         │   BlenoTransport (v2)       │    │
│   │  (in-process EventEmit) │         │  (BLE peripheral, GATT)     │    │
│   └────────────┬────────────┘         └──────────────┬──────────────┘    │
│                │  emits(frame: DataView)              │  notify(frame)   │
└────────────────┼─────────────────────────────────────┼───────────────────┘
                 │                                      │
                 └──────────────┬───────────────────────┘
                                │   both consume the SAME engine
┌───────────────────────────────▼──────────────────────────────────────────┐
│                          Replay Engine                                   │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │  ReplayController — orchestrates start/stop/pause, owns Scheduler  │  │
│  └─────────┬────────────────────────────────────────────┬─────────────┘  │
│            │                                            │                │
│  ┌─────────▼─────────┐                       ┌──────────▼─────────────┐  │
│  │  Scheduler        │                       │  ResistanceLog         │  │
│  │  (clock + timers) │                       │  (echo-only sink)      │  │
│  └─────────┬─────────┘                       └────────────────────────┘  │
└────────────┼─────────────────────────────────────────────────────────────┘
             │ "tick at FIT timestamp T"
┌────────────▼─────────────────────────────────────────────────────────────┐
│                              Codec Layer                                 │
│   ┌──────────────────────────┐         ┌──────────────────────────────┐  │
│   │   RideIterator           │ ──────▶ │   FTMS IndoorBikeData        │  │
│   │ (pulls next record by t) │ record  │   encoder (vendored)         │  │
│   └────────────┬─────────────┘         └──────────────┬───────────────┘  │
└────────────────┼────────────────────────────────────── ┼──────────────────┘
                 │ {timestamp, power, cadence}            │ DataView (LE)
┌────────────────▼─────────────────────────────────────────────────────────┐
│                              Source Layer                                │
│   ┌─────────────────────────────────────────────────────────────────┐    │
│   │   FitLoader — parse file/Buffer → normalized RideRecord[]        │   │
│   │   (wraps fit-file-parser or @garmin/fitsdk-javascript)           │   │
│   └─────────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| `FitLoader` | Parse a FIT file/Buffer into a normalized, ordered `RideRecord[]` (timestamp, power, cadence). Validates fields exist; throws clean errors. | Thin wrapper around chosen FIT parser (decision deferred per PROJECT.md). Returns plain JS objects, no streams. |
| `RideIterator` | Stateful cursor over `RideRecord[]`. Knows current index, supports `next()`, `peek()`, `reset()`, `isDone()`. Pure — no timers. | Class or generator. Loop/stop-at-end is a wrap policy applied by controller, not the iterator itself. |
| `FtmsEncoder` | Pure function: `(record) → DataView`. Builds an FTMS IndoorBikeData characteristic frame with the flag bits set for power+cadence. | Vendored module under `src/ftms/`. Stateless. No transport awareness. |
| `Scheduler` | Drives "fire next event at FIT-relative time T × speed." Provides cancellation. Wraps a clock and a timer primitive. | Uses `performance.now()` + `setTimeout` with drift correction; AbortController-aware. |
| `ReplayController` | Owns the iterator + scheduler + resistance log. Public verbs: `start`, `stop`, `pause` (optional), `setSpeed`. Emits `(frame: DataView)` on each tick. | Plain class. Has no idea whether output goes to an EventEmitter or a BLE characteristic. |
| `ResistanceLog` | Records `sendResistance(grade)` calls with timestamps for test assertions. Echo-only — does NOT influence replay. | In-memory array; exposed via `getResistanceCalls()` on FakeTransport. |
| `FakeTransport` | Implements `ITrainerTransport`. Wires consumer handlers to `ReplayController` events. `connect()` starts replay, `disconnect()` stops. | EventEmitter under the hood; no I/O. |
| `BlenoTransport` (v2) | Same shape; `connect()` starts BLE advertising + opens GATT server, then starts replay; each frame becomes a characteristic notification. | `@abandonware/bleno`; new file, no changes to engine. |

The crucial invariant: **everything below the transport layer has no knowledge of how
data exits the process.** Adding BlenoTransport in v2 is a new file, not a refactor.

## Recommended Project Structure

```
src/
├── index.ts                    # Public API: createFakeTransport, types
├── types.ts                    # ITrainerTransport, RideRecord, Config
│
├── fit/                        # Source layer (FIT parsing)
│   ├── loader.ts               # FitLoader: file/Buffer → RideRecord[]
│   └── normalize.ts            # Map FIT records → RideRecord shape
│
├── replay/                     # Engine layer (timing-free + timing)
│   ├── ride-iterator.ts        # Cursor over RideRecord[] (pure)
│   ├── scheduler.ts            # Monotonic-clock timer with drift correction
│   ├── controller.ts           # ReplayController (orchestration)
│   └── resistance-log.ts       # Echo-only sink for sendResistance
│
├── ftms/                       # Codec layer (vendored, stateless)
│   ├── indoor-bike-data.ts     # encodeIndoorBikeData(record) → DataView
│   ├── flags.ts                # FTMS flag bit constants
│   └── README.md               # "Why this is vendored — see PROJECT.md"
│
├── transport/                  # Transport layer (the seam)
│   ├── fake-transport.ts       # FakeTransport (v1)
│   └── bleno-transport.ts      # BlenoTransport (v2 — placeholder in v1)
│
└── util/
    └── clock.ts                # Injectable clock (for tests)

test/
├── fixtures/                   # Generated minimal FIT files (no bundled rides)
├── fit/                        # Loader tests
├── replay/                     # Iterator + scheduler tests (use fake clock)
├── ftms/                       # Encoder byte-level tests vs known good frames
├── transport/                  # FakeTransport integration tests
└── e2e/                        # End-to-end: real FIT → consumer handler

dist/                           # ESM-only build output
package.json                    # "type": "module", "exports" map
tsconfig.json
```

### Structure Rationale

- **`fit/` is isolated from `replay/`:** the parser library choice is deferred per
  PROJECT.md. Keeping `FitLoader` behind a single import means we can swap parsers
  without touching the engine.
- **`replay/` splits timing from iteration:** `RideIterator` has no clock, so it's
  trivially testable. `Scheduler` has a clock and is tested against a fake clock. The
  controller wires them.
- **`ftms/` is its own folder, not under `replay/`:** the codec is vendored and slated
  for possible extraction to `@veloworld/ftms-codec` later. Folder boundary makes that
  extraction a literal directory move.
- **`transport/` houses both Fake and Bleno (placeholder in v1):** the seam is a
  directory, not a class hierarchy. v2 adds a file; v1 doesn't know it exists.
- **`util/clock.ts`:** isolating `performance.now()` and `setTimeout` behind a tiny
  abstraction lets tests advance time without `setTimeout` flakiness.

## Architectural Patterns

### Pattern 1: Transport as a Strategy (composition, not inheritance)

**What:** `ReplayController` is constructed by each transport. Both transports own a
controller and translate its `frame` events into their delivery channel. There is no
`AbstractTransport` base class — the `ITrainerTransport` interface is the only contract,
and shared engine state lives in `ReplayController`, which both transports compose.

**When to use:** Any time a single core engine needs multiple I/O backends and the
backends differ in lifecycle (BLE has advertising, GATT, CCCD subscriptions; in-process
has none of that).

**Trade-offs:**
- Pro: Each transport's `connect()`/`disconnect()` is honest about its own lifecycle —
  no awkward template method that BLE has to fight.
- Pro: Engine is reusable in a third transport (WebSocket, stdout dumper) without touching
  existing transports.
- Con: A few lines of "wire controller events to my output" duplicated per transport.
  This is the right kind of duplication.

**Example:**
```typescript
// transport/fake-transport.ts
export function createFakeTransport(config: FakeTransportConfig): ITrainerTransport {
  const records = loadFitFile(config.fitPath);
  const controller = new ReplayController(records, {
    speed: config.speed ?? 1,
    loop: config.loop ?? false,
    encoder: encodeIndoorBikeData,
    clock: config.clock,  // injectable for tests
  });
  const handlers = new Set<(frame: DataView) => void>();
  const resistanceLog = new ResistanceLog();

  controller.on("frame", (frame) => handlers.forEach((h) => h(frame)));

  return {
    connect: () => controller.start(),
    disconnect: () => controller.stop(),
    onData: (h) => { handlers.add(h); return () => handlers.delete(h); },
    sendResistance: (grade) => resistanceLog.record(grade),
    // test affordance, not part of ITrainerTransport:
    _getResistanceCalls: () => resistanceLog.snapshot(),
  };
}
```

`BlenoTransport` (v2) instantiates the same `ReplayController` and forwards `frame` events
to a Bleno characteristic's `notify`. Identical engine, different last mile.

### Pattern 2: Drift-corrected scheduler with monotonic clock

**What:** Don't `setTimeout(tick, 1000)` per record — drift accumulates. Instead, anchor
to a monotonic start instant and schedule each record's tick at
`startInstant + (record.timestamp - firstTimestamp) / speed`, computing the delay as
`targetInstant - now()` on every tick.

**When to use:** Any real-time replay or simulation where playback fidelity matters.

**Trade-offs:**
- Pro: Bounded drift. No accumulation of `setTimeout` overshoot.
- Pro: Speed multiplier is a single division — change at any time and next tick recomputes.
- Con: A pause/resume must rebase the start instant; not free, but localized.

**Example:**
```typescript
// replay/scheduler.ts
export class Scheduler {
  private startMonotonic = 0;
  private firstRecordTs = 0;
  private timer: NodeJS.Timeout | null = null;
  private aborted = false;

  constructor(private clock: Clock, private speed: number) {}

  start(firstTs: number) {
    this.startMonotonic = this.clock.now();
    this.firstRecordTs = firstTs;
  }

  scheduleAt(recordTs: number, fn: () => void) {
    if (this.aborted) return;
    const elapsedSrc = recordTs - this.firstRecordTs;       // ms in source time
    const targetMono = this.startMonotonic + elapsedSrc / this.speed;
    const delay = Math.max(0, targetMono - this.clock.now());
    this.timer = setTimeout(() => { if (!this.aborted) fn(); }, delay);
  }

  cancel() {
    this.aborted = true;
    if (this.timer) clearTimeout(this.timer);
  }
}
```

For sub-second precision in long rides, validate with a fixture and tighten with
`setImmediate` polling near deadlines if drift exceeds ~10ms over many minutes. For v1's
1Hz FIT cadence, plain `setTimeout` with drift correction is sufficient.

### Pattern 3: AbortController for cancellation across the controller

**What:** `ReplayController` exposes an internal `AbortSignal`. `disconnect()` calls
`controller.abort()`, which: cancels the scheduler timer, marks state as stopped, and
prevents in-flight ticks from emitting after disconnect.

**When to use:** Any time consumers can interrupt long-running async work (here:
`disconnect()` mid-ride, plus `loop=false` natural end).

**Trade-offs:**
- Pro: Standard Node.js cancellation primitive; composes with `fetch`, streams, etc.
- Pro: Single source of truth for "are we still playing?"
- Con: Requires discipline — every callback site checks `signal.aborted`.

**Example:**
```typescript
// replay/controller.ts (excerpt)
export class ReplayController extends EventEmitter {
  private ac = new AbortController();

  start() {
    this.ac = new AbortController();   // fresh each start (supports stop+start)
    const tick = () => {
      if (this.ac.signal.aborted) return;
      const record = this.iterator.next();
      if (!record) {
        if (this.config.loop) { this.iterator.reset(); return tick(); }
        this.emit("end"); return;
      }
      this.emit("frame", this.config.encoder(record));
      const peek = this.iterator.peek();
      if (peek) this.scheduler.scheduleAt(peek.timestamp, tick);
      else if (!this.config.loop) this.emit("end");
    };
    this.scheduler.start(this.iterator.peek()!.timestamp);
    tick();
  }

  stop() { this.ac.abort(); this.scheduler.cancel(); }
}
```

### Pattern 4: Define `ITrainerTransport` here, re-exported by consumers

**What:** trainer-sim is the source of truth for the `ITrainerTransport` interface. It
exports the type. VeloWorld imports it (or re-exports from its own integration layer if
it wants a vanity alias).

**When to use:** When the contract is symmetric (consumer needs same shape sim provides)
AND you want a single repo to evolve the contract.

**Trade-offs:**
- Pro: One canonical definition. Adding a method (e.g., `sendPower`) updates one file.
- Pro: VeloWorld can swap `BlenoTrainerAdapter` for `FakeTransport` because both satisfy
  the imported type — TypeScript proves the substitution.
- Pro: Other FTMS consumers (the open-source angle) get the contract for free.
- Con: If VeloWorld wants to evolve its own internal trainer abstraction beyond FTMS,
  it would need to widen its internal type and treat `ITrainerTransport` as one
  implementation. Acceptable; that's the natural shape anyway.

**Recommendation:** trainer-sim defines and exports `ITrainerTransport`. VeloWorld
imports it. The PROJECT.md phrase "satisfy VeloWorld's `ITrainerTransport` interface
byte-for-byte" is best honored by making trainer-sim the definer — it's the side that
must conform to a precise shape, and conformance is easier when you own the shape.

```typescript
// src/types.ts (exported from index)
export interface ITrainerTransport {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  onData(handler: (frame: DataView) => void): () => void;  // returns unsubscribe
  sendResistance(grade: number): void;
}
```

### Pattern 5: Factory function as the public API (factory + class, ESM-first)

**What:** Export a `createFakeTransport(config)` factory as the documented entry point.
The underlying class (`FakeTransport` or just the wired-up controller) is an
implementation detail. Export the class only if a power-user needs to subclass — likely
not for this project.

**When to use:** When you want to hide construction complexity (loader + iterator +
encoder + scheduler + controller) and present a single clean entrypoint.

**Trade-offs:**
- Pro: Async loading (FIT parse) fits naturally as `await createFakeTransport(...)` if
  needed.
- Pro: Consumers don't `new` anything they don't understand.
- Pro: Returns a value typed as `ITrainerTransport` — the consumer codes against the
  interface, not the implementation.
- Con: Slightly less discoverable in IDE auto-import vs a class. Mitigated by good
  JSDoc.

**ESM-first:** `package.json` declares `"type": "module"` and an `"exports"` map.
Single ESM build, no CommonJS. VeloWorld is on a modern Node + bundler stack; CJS legacy
is not a concern for v1. If a future consumer needs CJS, add a dual build then.

```typescript
// src/index.ts
export { createFakeTransport } from "./transport/fake-transport.js";
export type { ITrainerTransport, FakeTransportConfig, RideRecord } from "./types.js";
// BlenoTransport added in v2 — same shape:
// export { createBlenoTransport } from "./transport/bleno-transport.js";
```

## Data Flow

### Replay Flow (the only flow that matters)

```
[FIT file on disk]
        │
        ▼
┌───────────────────┐
│   FitLoader       │  parses once at connect() — synchronous after load
│   .load(path)     │  returns RideRecord[] sorted by timestamp
└────────┬──────────┘
         │ RideRecord[]
         ▼
┌───────────────────┐
│  RideIterator     │  pure cursor; .next() / .peek() / .reset()
└────────┬──────────┘
         │ {timestamp, power, cadence}   (one record per tick)
         ▼
┌───────────────────┐
│  FtmsEncoder      │  pure: encodeIndoorBikeData(record) → DataView
└────────┬──────────┘
         │ DataView (FTMS IndoorBikeData frame, LE-encoded)
         ▼
┌───────────────────┐
│ ReplayController  │  emits "frame" event when Scheduler fires
└────────┬──────────┘
         │ (frame: DataView)
         ▼
┌───────────────────┐
│ FakeTransport     │  forwards to every registered onData handler
└────────┬──────────┘
         │
         ▼
[consumer's onData(frame) callback]    ← VeloWorld decoder lives here
```

The flow is **strictly one-way**. There is no return path from consumer to engine. The
`sendResistance(grade)` call is a side-channel into `ResistanceLog` only — it does not
re-enter the replay pipeline.

### Lifecycle Flow

```
consumer.connect()
   → FakeTransport: create controller (loader runs, iterator initialized)
   → controller.start()
       → scheduler anchors to clock.now()
       → tick loop begins (fires per FIT timestamp × 1/speed)
       → each tick: iterator.next() → encode → emit("frame") → schedule next

consumer.disconnect()
   → FakeTransport: controller.stop()
       → AbortController.abort() — pending tick is no-op
       → scheduler.cancel() — clearTimeout
   → handlers retain references but receive nothing further

natural end (loop=false)
   → iterator returns null → controller.emit("end")
   → FakeTransport optionally surfaces this (e.g., via onData semantics or an "end" event)
```

## Build Order

The dependency graph is a near-perfect linear chain — bottom-up is the only sane order.

```
Layer 0 (foundations, parallelizable):
  ├─ types.ts           (ITrainerTransport, RideRecord, configs)
  └─ util/clock.ts      (injectable clock + fake clock for tests)
                            │
                            ▼
Layer 1 (codec, no deps on engine):
  └─ ftms/indoor-bike-data.ts   (pure encoder — testable in isolation against
                                  known-good byte sequences)
                            │
                            ▼
Layer 2 (source):
  └─ fit/loader.ts + fit/normalize.ts
                            │
                            ▼
Layer 3 (engine):
  ├─ replay/ride-iterator.ts    (depends on RideRecord type)
  ├─ replay/scheduler.ts        (depends on clock util)
  ├─ replay/resistance-log.ts   (standalone)
  └─ replay/controller.ts       (composes the above 3 + ftms encoder)
                            │
                            ▼
Layer 4 (transport):
  └─ transport/fake-transport.ts   (composes controller + EventEmitter glue)
                            │
                            ▼
Layer 5 (public API):
  └─ index.ts (re-exports + the factory)
                            │
                            ▼
Layer 6 (validation):
  └─ e2e tests with real FIT file → assert frame stream
  └─ VeloWorld integration smoke test
```

### Recommended order with rationale

1. **`types.ts` + `util/clock.ts`** — types are the contract everyone signs;
   injectable clock unblocks every downstream test.
2. **`ftms/indoor-bike-data.ts`** — totally independent. Build first because it's the
   highest-risk correctness piece (byte-level FTMS encoding). Test against known-good
   frames captured from real trainers (or hand-computed). If this is wrong, nothing
   works downstream — flush it out early.
3. **`fit/loader.ts`** — parser choice is deferred per PROJECT.md, but the *interface*
   (`load(path | Buffer) → RideRecord[]`) can be built and tested with stub data first;
   then swap in the real parser once chosen. This decouples "decide on a parser" from
   "make progress on the engine."
4. **`replay/ride-iterator.ts`** — pure, trivial, but the iterator's loop/reset
   semantics need test coverage before the controller composes them.
5. **`replay/scheduler.ts`** — drift-corrected scheduler. Test with a fake clock that
   advances synchronously. This is where real-time fidelity is won or lost.
6. **`replay/controller.ts`** — wires iterator + scheduler + encoder. Emits frames via
   EventEmitter. Test with fake clock + stub encoder; assert frame ordering and timing.
7. **`replay/resistance-log.ts`** — minutes of work; build alongside the controller.
8. **`transport/fake-transport.ts`** — thin glue. Once controller emits frames, this is
   ~30 lines.
9. **`index.ts`** — public surface. ESM exports map.
10. **End-to-end:** real Garmin/Wahoo FIT file, consumer subscribes, asserts power and
    cadence values match expectations across the ride. **This is the gate before
    declaring v1 done.**

### Slice that unlocks everything else

The **encoder + iterator + a synchronous "as-fast-as-possible" controller** (no
scheduler yet) is the smallest end-to-end slice that proves the architecture works. It
takes a FIT file (even stubbed) and produces a sequence of valid FTMS DataViews. Build
this in week 1; everything after is layering real-time behavior and the transport seam
on top.

## Scaling Considerations

This is a developer test tool, not a multi-tenant service. "Scale" means **fidelity over
long runs** and **multiple FakeTransport instances in a test suite**, not horizontal
scaling.

| Scale | Architecture Adjustments |
|-------|--------------------------|
| Single short ride (10 min) | Default config. setTimeout drift is invisible at 1Hz. |
| Long-soak ride (4+ hours) | Validate cumulative drift; if >100ms over the run, switch scheduler to a hybrid `setTimeout` (coarse) + `setImmediate` (final adjust) pattern. |
| Hundreds of FakeTransports in a test suite | Each instance owns its own scheduler timer — fine; Node handles thousands of timers. Avoid global state in any module. |
| Speed multipliers >50× (fast tests) | At 100×, 1Hz records become 100Hz delivery. Verify the consumer can handle that throughput; if not, add a `maxBatchInterval` config that coalesces ticks. |

### Scaling priorities

1. **First bottleneck (long rides):** scheduler drift. Mitigation: monotonic clock,
   absolute scheduling per Pattern 2.
2. **Second bottleneck (high speed multipliers):** consumer back-pressure. Mitigation:
   document the max safe speed for v1; consider event-loop yields between ticks.

## Anti-Patterns

### Anti-Pattern 1: Inheritance hierarchy for transports

**What people do:** Define `abstract class BaseTransport` with a `protected emit(frame)`
method; `FakeTransport` and `BlenoTransport` extend it.
**Why it's wrong:** BLE lifecycle (advertise, GATT server, CCCD subscribe) is fundamentally
different from in-process EventEmitter — the base class becomes a leaky abstraction or a
"god class" with conditional logic.
**Do this instead:** Composition. Both transports own a `ReplayController` and connect
its `frame` event to their respective output. Per Pattern 1.

### Anti-Pattern 2: Letting the iterator own the clock

**What people do:** `RideIterator.next()` blocks/awaits until "real-time T" arrives.
**Why it's wrong:** Couples iteration semantics to scheduling. Can't test iterator
without time. Can't change speed mid-ride without rewriting the iterator. Can't reuse
iterator for non-real-time consumers (e.g., a future "render the whole ride to file"
mode).
**Do this instead:** Iterator is pure (cursor + records). Scheduler decides when to call
`iterator.next()`. Per the layered build order.

### Anti-Pattern 3: Letting `sendResistance` mutate replayed values

**What people do:** "It would be cool if grade affected power dynamically..."
**Why it's wrong:** PROJECT.md explicitly out-of-scopes this — couples sim to physics
and breaks faithful replay. Once you do it, every test asserts against simulated
physics, not the source FIT.
**Do this instead:** `ResistanceLog` only. Tests assert "consumer called sendResistance
with grade X at time Y." Replay is invariant.

### Anti-Pattern 4: `setInterval(emit, 1000)` for "1Hz FIT data"

**What people do:** Assume FIT records are exactly 1Hz and use `setInterval`.
**Why it's wrong:** FIT records are *timestamped*, not periodic. Records can be missing,
unevenly spaced (especially around transitions, pauses, smart-recording), or sub-second.
Using `setInterval` desyncs from source timing.
**Do this instead:** Schedule each tick at the *next record's* timestamp relative to
start. The scheduler owns this per Pattern 2.

### Anti-Pattern 5: Mixing FTMS encode and BLE transport

**What people do:** "Bleno needs DataView, just `bleno.updateValue(encode(record))` in
the controller."
**Why it's wrong:** Engine now imports Bleno transitively, breaking the v1 promise that
FakeTransport runs anywhere Node runs. Also makes the eventual `@veloworld/ftms-codec`
extraction harder.
**Do this instead:** Encoder produces DataView; controller emits DataView; transport is
the only thing that knows about Bleno.

### Anti-Pattern 6: Defining `ITrainerTransport` in the consumer (VeloWorld)

**What people do:** Treat the interface as VeloWorld's, and trainer-sim "satisfies" it
without owning the type.
**Why it's wrong:** Open-source consumers (the second-class goal of this repo) have no
type to import. Two definitions can drift. Adding methods requires coordinated PRs.
**Do this instead:** Per Pattern 4 — trainer-sim is the canonical definer. VeloWorld
imports the type.

## Integration Points

### External Services / Libraries

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| FIT parser (`fit-file-parser` or `@garmin/fitsdk-javascript`) | Wrapped in `FitLoader`. Parser-specific code lives behind one module boundary. | Choice deferred per PROJECT.md. Build the loader's interface first, swap parsers later. |
| `@abandonware/bleno` (v2) | Wrapped in `BlenoTransport`. Engine never imports it. | macOS/Linux only — confirmed by PROJECT.md. Not relevant for v1 architecture. |
| Node `events` (`EventEmitter`) | Used inside `ReplayController` for `frame` and `end` events. Not exposed publicly. | Public API is `onData(handler)` returning an unsubscribe function — friendlier than raw EventEmitter. |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| FitLoader → RideIterator | Plain `RideRecord[]` passed at construction | One-shot; no streaming for v1 (rides are small enough). |
| RideIterator → ReplayController | `next()` / `peek()` calls (synchronous) | Iterator is fully passive. |
| Scheduler → ReplayController | Callback function (`fn` in `scheduleAt`) | Cancellation via AbortController on controller. |
| ReplayController → FtmsEncoder | Function call (encoder is pure) | Encoder is injected into controller — keeps controller decoupled from FTMS specifics, simplifying eventual codec extraction. |
| ReplayController → Transport | EventEmitter (`frame`, `end` events) | Both transports listen to the same controller. |
| Transport → Consumer | `onData(handler)` registration; handler invoked with DataView | Synchronous emission. Backpressure is consumer's problem (documented). |
| Consumer → Transport (sendResistance) | Method call → ResistanceLog | One-way side channel; never feeds replay. |

## Sources

- PROJECT.md — Constraints, Key Decisions, Out of Scope (canonical authority for this
  research). Confirms two-transports-from-one-codebase, vendored FTMS, echo-only
  resistance, real-time replay with speed multiplier, Node+TS stack, MIT.
- FTMS spec (Bluetooth SIG, Fitness Machine Service v1.0) — IndoorBikeData
  characteristic frame layout (flags + fields), little-endian encoding. Confidence:
  HIGH (authoritative spec).
- Node.js `AbortController` / `AbortSignal` (Node ≥15) — standard cancellation
  primitive, composable with timers and async work. Confidence: HIGH.
- Node.js `perf_hooks.performance.now()` — monotonic clock, immune to wall-clock jumps.
  Confidence: HIGH.
- Common scheduling patterns from real-time playback engines (audio/video sequencers
  use the same drift-correction approach). Confidence: HIGH for the pattern, MEDIUM for
  domain-specific tuning constants — validate with a real long-soak FIT in testing.
- ESM-first package conventions (Node 20+, `"type": "module"`, `"exports"` map).
  Confidence: HIGH.

---
*Architecture research for: Node.js BLE FTMS smart trainer simulator (FIT replay)*
*Researched: 2026-05-13*
