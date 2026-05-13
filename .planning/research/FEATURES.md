# Feature Research

**Domain:** BLE FTMS smart-trainer simulator / FIT-replay test library (Node.js, TypeScript)
**Researched:** 2026-05-13
**Confidence:** MEDIUM-HIGH

> Confidence is **HIGH** for FTMS Indoor Bike Data structure, comparable simulators
> (zwack, gymnasticon), and mock-library API patterns (MSW, Nock, Sinon fake timers,
> fake-indexeddb, Mirage). Confidence is **MEDIUM** for inferred consumer expectations
> in the FTMS dev-tool space — there is no large established "FTMS test library"
> category to benchmark against; the closest comparables are real-broadcast simulators,
> not in-process fakes.

---

## Comparable Tools Surveyed

| Tool | Stack | Stars | Mode | Why it matters |
|------|-------|-------|------|----------------|
| **zwack** (paixaop) | Node + bleno | 128 | Real BLE peripheral, keyboard-driven values | Closest BLE peer — proves the bleno-peripheral path; uses interactive controls, no FIT replay, no in-process transport |
| **gymnasticon** (ptx2) | Node, BLE peripheral + bridge | 328 | Real BLE peripheral, bridges proprietary bikes to FTMS/CSP | Strong CLI ergonomics (yargs-style), config-file support, `--bot-power`/`--bot-cadence` for synthetic source — but no FIT replay |
| **swiftcheetah** | Swift, iOS | — | BLE broadcasting (FTMS/CPS/RSC) with synthetic data + UI | Multi-protocol, but UI-driven and platform-specific |
| **FTMSTrainer** (michallaskowski) | Swift | 26 | FTMS *client* models | Proves the IndoorBikeData encoding — useful as reference, not a sim |
| **ftms-toolkit** (eenterwebz) | Python + bleak | — | FTMS *client* — discovers, controls, calibrates real bikes | Confirms what an FTMS consumer expects to see (flag bits, control point opcodes, resistance ranges) |

**Key gap:** None of the comparables ship a **library-first, in-process fake transport**
shaped for unit/integration tests of consumer apps. zwack and gymnasticon are
end-user binaries that broadcast over real BLE. trainer-sim's `FakeTransport` is
genuinely differentiated — its closest *philosophical* peers are not cycling tools
but **MSW** (in-process HTTP mock for tests) and **fake-indexeddb** (drop-in
replacement that satisfies a real interface contract).

---

## Mock-Library API Patterns Worth Mimicking

These are *not* in the cycling space, but they define the ergonomic ceiling for a
"fake transport for tests" library. Each row is something `FakeTransport` should
borrow.

| Library | Pattern | What to copy for trainer-sim |
|---------|---------|------------------------------|
| **MSW** | `setupServer()` returns a handle with `listen()` / `close()` / `resetHandlers()` / `use()` for runtime injection | A `createFakeTransport({ source })` factory that returns an object with `connect()/disconnect()` and a `reset()` for between-test isolation |
| **Nock** | Fluent builder + `.isDone()` / `.pendingMocks()` for assertions; events `'request'` / `'replied'` | Recorded `sendResistance` calls accessible via `.received()` / `.lastResistance()` for test asserts; emit events when payloads are notified |
| **Sinon fake-timers** | `tick(ms)` / `next()` / `runAll()` / `jump()` for deterministic time control; `now`, `shouldAdvanceTime` config | A `manualClock: true` mode where tests call `transport.tick(1000)` instead of waiting wall-clock; `speed: Infinity` for "drain everything synchronously" (parallel to `clock.runAll()`) |
| **fake-indexeddb** | Drop-in replacement that satisfies the real interface so production code is untouched | `FakeTransport` must satisfy VeloWorld's `ITrainerTransport` byte-for-byte — already required by PROJECT.md; this is the table-stake |
| **MirageJS** | "Scenarios" (named seed sets) + `factories` for generating realistic test data + `timing` config for latency simulation | Named scenarios (`hilly-ride.fit`, `interval-workout.fit`) loadable by key; configurable network/notification jitter for stress tests |
| **Vitest/Jest fake timers** | Auto-installed via `vi.useFakeTimers()` with `vi.advanceTimersByTime()` | Cooperate with consumer's fake timers — don't fight them; document the recommended setup |

**Synthesized takeaway:** The winning shape is **factory + lifecycle + observability + time-control**.

```ts
// What "good" looks like, distilled from MSW + Nock + Sinon:
const transport = createFakeTransport({ source: fitFile, speed: 4, loop: true });
await transport.connect();                    // lifecycle (MSW.listen)
transport.onData((dv) => { /* ... */ });      // notification subscription
transport.sendResistance(grade);              // recorded, no replay effect
transport.received.resistance;                // observability (Nock.isDone-style)
transport.tick(5000);                         // deterministic time (Sinon)
transport.reset();                            // test isolation (MSW.resetHandlers)
await transport.disconnect();                 // lifecycle (MSW.close)
```

---

## Feature Landscape

### Table Stakes (Without these, developers won't adopt it)

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **`ITrainerTransport`-shaped surface** (`connect`, `disconnect`, `onData`, `sendResistance`) | PROJECT.md requirement; whole point is drop-in replacement of real BLE transport — same lesson `fake-indexeddb` learned (must be drop-in) | LOW | Interface contract is owned by VeloWorld; trainer-sim conforms to it |
| **FIT file parsing → power + cadence record stream** | Without this nothing replays. Garmin/Wahoo `.fit` is the canonical format | MEDIUM | Parser choice deferred (PROJECT.md). Garmin official `@garmin/fitsdk-javascript` is sync, well-typed; `fit-file-parser` is older, callback-based. Both surface `record.power` and `record.cadence` |
| **Real-time replay respecting FIT record timestamps** | "Replay" implies temporal fidelity. Records are typically 1Hz but can be sparse or 4Hz; naive `setInterval` would lie about timing | MEDIUM | Schedule each notify against `record.timestamp` deltas, not a fixed tick |
| **Faithful FTMS IndoorBikeData encoding** as a `DataView` | Consumer's existing decoder must work unchanged. Misencoded flag bits = silent data corruption (the worst kind of bug) | MEDIUM | 16-bit flags LSB-first, sint16 power (watts, scale 1), uint16 cadence (RPM, scale 0.5 — i.e. multiply by 2 in the byte stream). Vendor-encoded per PROJECT.md decision |
| **Speed multiplier** (e.g., `speed: 4` = 4× real time) | Tests can't sit through a 90-min ride. zwack and gymnasticon both expose tunables; this is the test-tool equivalent | LOW | Multiply scheduling deltas; `Infinity` should drain synchronously for unit tests |
| **Loop vs. stop-at-end** | Long-soak tests need looping; deterministic tests need clean termination with a `'complete'` signal | LOW | Both modes already in PROJECT.md Active scope |
| **Echo-only `sendResistance(grade)` with assertion access** | PROJECT.md: replay stays faithful (no grade→power coupling); but tests must assert "the app sent resistance X". Mirrors Nock's `.isDone()` and Sinon's spy-call recording | LOW | Maintain `received.resistance: number[]` and `received.lastResistance` |
| **Async-iterable / event-emitter semantics for `onData`** | Node ecosystem expects `EventEmitter`-style or `AsyncIterable`; consumers will compose with backpressure | LOW | `onData(cb)` is fine for v1, but ensure unsubscribe returns a disposer |
| **Clean test-isolation reset** | Per-test cleanup (`afterEach`) is universal in JS testing. MSW's `resetHandlers`, fake-indexeddb's `new IDBFactory()`, Sinon's `restore()` all do this | LOW | `transport.reset()` → re-arms timeline at t=0, clears `received` |
| **TypeScript types shipped** | VeloWorld is TS; this is non-negotiable in 2026 | LOW | Already implied by stack — call it out so it doesn't get deferred |
| **Works alongside a consumer's fake timers** | Almost every JS test suite uses `vi.useFakeTimers()` or Jest equivalent. A library that fights fake timers is unusable in tests | MEDIUM | Use `setTimeout` (the fake-able one), not `setImmediate`/`process.nextTick`. Document recommended setup |
| **Zero hardware, zero BLE in v1** | This is *the* reason for FakeTransport's existence | — | PROJECT.md Active requirement |

### Differentiators (Why pick this over a hand-rolled fake?)

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Two transports, one engine** (FakeTransport v1 → BlenoTransport v2 sharing the FIT-replay + FTMS-encode core) | The same code that drives unit tests also drives the v2 BLE peripheral. No rewrites when promoting from FakeTransport to BlenoTransport. PROJECT.md Key Decision | MEDIUM | Architecture concern, not a feature — but it's the pitch line |
| **Manual / virtual-clock mode** (`tick(ms)`) | Deterministic tests without real-time waits. Sinon proved the value; MSW added `delay()` controls for the same reason | MEDIUM | Ship in v1 if cheap; defer to v1.x if it forces a re-architecture |
| **Pluggable data source** (FIT file is one of N possible sources) | Lets tests inject minimal hand-built record streams without bundling real `.fit` fixtures (also satisfies PROJECT.md "tests use generated/minimal FIT") | MEDIUM | An internal `RecordSource` interface (`AsyncIterable<{ timestamp, power, cadence }>`) keeps FIT parsing optional and lets trainer-sim's *own* tests skip the FIT layer entirely. Avoids `synthetic CSV` anti-feature by keeping this internal-only |
| **Notification observability hooks** (`transport.notified` / `'data'` event) | Tests can assert "exactly N IndoorBikeData notifications were emitted with payload X". This is what Nock's `.pendingMocks()` and MSW's `'request:start'` event give you | LOW | A simple counter + last-payload-buffer covers 80% of needs |
| **Resistance-call recorder with command-point opcode tagging** | When a real consumer sends a Fitness Machine Control Point write, it's not just "grade=X" — it's an opcode (0x05 set-target-power, 0x11 set-indoor-bike-sim, etc.). Recording the *opcode* lets tests assert protocol-level behavior | LOW-MEDIUM | Even if v1 only handles `setIndoorBikeSimulationParameters`, name the recorder around opcodes so it generalizes |
| **Deterministic seed for any jitter** | If we add notification jitter (real BLE has it), make it seedable so tests stay reproducible. Mirage's `factory.faker` does this | LOW | Cheap if added early, painful to retrofit |
| **Clear "replay complete" signal** | A `'complete'` event when stop-at-end is reached, plus a returned `Promise` from `connect({ awaitComplete: true })` for soak tests | LOW | Smaller than it looks; just a discipline of always firing the terminator |
| **Type-safe `received` API** | `transport.received.resistance` is `number[]` — not `any`. Sinon's biggest UX win is well-typed spy assertions | LOW | TS-first design |
| **Source-input flexibility for FIT** (Buffer, file path, ReadableStream) | Cuts boilerplate. `@garmin/fitsdk-javascript` accepts Buffer/ArrayBuffer/Uint8Array — match that surface | LOW | Just adapter functions; no engine impact |

### Anti-Features (Do NOT build)

> Many of these are already in PROJECT.md Out of Scope. This table **confirms** them
> with research-grounded reasoning and **adds** ones that emerged from comparable-tool review.

| Feature | Why Tempting | Why Wrong | Alternative |
|---------|--------------|-----------|-------------|
| **UI / dashboard** (already Out of Scope) | zwack and swiftcheetah ship UIs; gymnasticon ships a CLI — surely we should too? | trainer-sim is a *library* for tests. UIs serve end-users, not test runners. CLI ships in v2 only because BlenoTransport needs an entrypoint | Ship a tiny v2 CLI when BlenoTransport lands; never a UI |
| **Workouts / structured intervals / ERG mode generation** (already Out of Scope) | Gymnasticon and ftms-toolkit both touch ERG; consumers may ask | Couples the sim to *workout semantics* and *physics models*. PROJECT.md is explicit: replay stays faithful; the consumer app does physics | Tell consumers: build a `.fit` file with the workout you want and replay it |
| **User management / auth / cloud sync** (already Out of Scope) | Every B2C cycling app has it | This is a developer tool. Zero users. Zero accounts | n/a |
| **Synthetic CSV / hand-crafted ride JSON** (already Out of Scope) | Easier to write a test fixture by hand than find a real `.fit` file | PROJECT.md: real FIT only; synthetic data can't capture the awkward record gaps, paused segments, and 4Hz bursts that break real apps | Tests use a *minimal generated* FIT; `RecordSource` interface stays internal so consumers can't be tempted into hand-crafted JSON |
| **Heart rate / speed / power balance / energy fields** (already Out of Scope for v1) | Easy to add since the IndoorBikeData flag bits already define them | "When a consumer needs them" (PROJECT.md). Speed especially is a trap — Indoor Bike Data carries instantaneous *speed* (km/h), but trainers compute speed from power+grade+rider; if the FIT has a speed value, it's the rider's outdoor recorded speed, which may not match what the consumer's physics would compute. Better to omit than mislead | Add per-field as consumer demand surfaces; document the speed gotcha |
| **Resistance affecting replayed power** (already Out of Scope) | Feels "more realistic" — the trainer would *respond* to grade | PROJECT.md Key Decision: couples sim to physics; replay stops being faithful to source | `sendResistance` is echo-only; consumers do their own physics |
| **Recording from a real trainer** (already Out of Scope) | Cyclists already have FIT recorders (their head units); also trivial to build "BLE central → log notifications → replay" | Out-of-scope per PROJECT.md, and FIT files are already the canonical recorded format. Building a recorder competes with Garmin/Wahoo head units | Tell users: ride your trainer with a Garmin/Wahoo, export the FIT, replay it |
| **Bundled fixture FIT files in the repo** (already Out of Scope) | Convenience: `npm test` should "just work" | Licensing of real ride data is murky; bloats the repo; trainer-sim's tests should generate minimal FITs anyway | Internal test FITs are *generated*, not committed |
| **NEW: Auto-detect FIT format / convert TCX/GPX/CSV** | Sounds helpful — "support all the formats" | Three formats to maintain. `.tcx` and `.gpx` don't have power/cadence as natively as FIT (cadence in GPX is via extensions; not all writers include it). Scope creep | FIT-only. If a user has a TCX, they convert to FIT first |
| **NEW: Power-curve simulation / bike-model selection** | Gymnasticon has `--bike` selection (flywheel, peloton, ic4, keiser); ftms-toolkit calibrates per-bike | Those tools *adapt to specific real bikes*. trainer-sim *replays a recording* — it has no model. Adding bike-model selection would mean modifying replayed power, which is exactly what `sendResistance` echo-only forbids | The `.fit` file *is* the bike model, captured live |
| **NEW: ANT+ output** | gymnasticon ships ANT+ alongside BLE | Doubles the protocol surface; ANT+ requires USB stick; VeloWorld is BLE-only | BLE/FTMS only; document that ANT+ is intentionally not supported |
| **NEW: Multi-client / multi-subscriber simulation** (one fake serving N consumers concurrently) | "What if you want to test the app with two users?" | YAGNI — consumer apps are single-trainer. Adds threading/queue complexity | Run two `FakeTransport` instances if you really need it |
| **NEW: Round-trip FTMS *decode* in trainer-sim** | "Why have encode without decode?" | PROJECT.md: encode lives here, decode lives in VeloWorld. Keeps coupling minimal; revisit only when extracting `@veloworld/ftms-codec` | Test the encoder by feeding its output to a known-good decoder fixture |
| **NEW: Sharing the FTMS codec via npm package in v1** (already Out of Scope) | Code duplication feels bad | PROJECT.md Key Decision: vendor first, extract only when both repos hurt. Premature extraction creates a 3-way release dance | Vendor it; revisit at the milestone when VeloWorld and trainer-sim both want it changed |
| **NEW: Pre-recorded byte-stream replay** (replay raw notification bytes captured from a real BLE central) | "Even more faithful than FIT — capture exact bytes!" | Couples to a specific trainer's quirks (Wahoo Kickr's flag-bit choices ≠ Tacx Neo's). FIT is portable; raw notifications aren't. Also requires building a recorder (see above) | FIT replay covers 95% of need; the remaining 5% is consumer-specific edge cases |
| **NEW: Windows BLE peripheral support** (already Out of Scope) | Cross-platform appeal | bleno on Windows is historically broken; v1 has no BLE anyway | macOS/Linux for v2 BlenoTransport; FakeTransport runs anywhere Node runs |

---

## Feature Dependencies

```
[ITrainerTransport conformance]
    └─ enables ──> [VeloWorld can swap real BLE for FakeTransport]

[FIT parsing]
    └─ feeds ──> [RecordSource]
                    └─ feeds ──> [Real-time scheduler]
                                    └─ feeds ──> [FTMS IndoorBikeData encoder]
                                                    └─ feeds ──> [onData(DataView) notifications]

[Speed multiplier] ──modifies──> [Real-time scheduler]
[Loop / stop-at-end] ──modifies──> [Real-time scheduler]
[Manual clock / tick()] ──replaces──> [Real-time scheduler's wall clock]

[sendResistance(grade)]
    └─ recorded into ──> [received.resistance[]]   (NO connection to scheduler/encoder by design)

[reset()] ──restores──> [scheduler t=0, received cleared, source rewound]

[BlenoTransport (v2)]
    └─ shares ──> [FIT parsing] + [Real-time scheduler] + [FTMS encoder]
    └─ replaces ──> [onData callback dispatch]   with   [GATT notify on Indoor Bike Data char]
    └─ replaces ──> [received.resistance recorder]   with   [GATT write callback on Control Point]

[CLI (v2)] ──depends on──> [BlenoTransport]
```

### Dependency Notes

- **FIT parsing → RecordSource:** Decouple early. The scheduler and encoder don't need
  to know FIT exists. This is what lets trainer-sim's *own* tests skip FIT and feed
  in-memory record streams without violating the "real FIT only" principle for
  *consumers*.
- **Real-time scheduler is the keystone:** Speed multiplier, loop, manual clock, and
  the v2 BlenoTransport all hang off it. Get this interface right in v1 even if the
  implementation is a simple `setTimeout` chain.
- **`sendResistance` is deliberately disconnected:** No arrow back into the scheduler.
  This is a load-bearing absence — it's what keeps replay faithful.
- **BlenoTransport is the same engine + a new edge:** v2 adds a *delivery layer*, not a
  replay layer. If v1 mixes them, v2 will be a rewrite.

---

## MVP Definition

### Launch With (v1 — "FakeTransport unblocks VeloWorld")

Aligned with PROJECT.md Active requirements:

- [ ] **`createFakeTransport({ source, speed, loop })` factory** — single ergonomic entry point (MSW pattern)
- [ ] **`ITrainerTransport` surface** — `connect()`, `disconnect()`, `onData(cb)`, `sendResistance(grade)` exactly as VeloWorld defines
- [ ] **FIT parsing** of power + cadence (parser choice from STACK.md research)
- [ ] **Internal `RecordSource`** abstraction so engine doesn't depend on FIT directly (and so trainer-sim's tests can use generated minimal records)
- [ ] **Real-time scheduler** respecting FIT record timestamps
- [ ] **`speed` multiplier** (number, ≥1; document `Infinity` if cheap)
- [ ] **`loop: boolean`** with stop-at-end emitting a `'complete'` signal
- [ ] **FTMS IndoorBikeData encoder** (vendored, power + cadence flag bits only) → `DataView`
- [ ] **`sendResistance` recorder** — `transport.received.resistance: number[]`, `transport.received.lastResistance`
- [ ] **`reset()`** — for `afterEach` test isolation
- [ ] **TypeScript types** shipped, `ITrainerTransport` re-exported
- [ ] **VeloWorld dev/test build runs end-to-end against FakeTransport with a real FIT file** (the only acceptance test that matters)

### Add After Validation (v1.x — once VeloWorld is using it daily)

- [ ] **Manual clock / `tick(ms)`** — promotes from differentiator to expected, once first user writes a "I want this synchronous" issue
- [ ] **Notification observability** — `transport.notified.count`, `'data'` event for assertion-on-emit
- [ ] **Source-input flexibility** — accept `Buffer | string | ReadableStream` for FIT
- [ ] **Additional IndoorBikeData fields** — speed and HR, gated on a consumer asking
- [ ] **Deterministic jitter / seed** — if anyone needs realistic notification timing variance

### Future Consideration (v2 — "BlenoTransport ships")

- [ ] **`BlenoTransport`** — same engine, real BLE peripheral output (macOS/Linux only)
- [ ] **CLI** — `trainer-sim play <file.fit> [--speed N] [--loop]` — only meaningful with BlenoTransport per PROJECT.md
- [ ] **GATT-level Fitness Machine Control Point** — receive opcodes 0x04 (set target resistance), 0x05 (set target power), 0x11 (set indoor bike sim parameters); record them in the same `received` shape FakeTransport uses
- [ ] **Fitness Machine Feature characteristic** advertising the supported fields (power, cadence, plus whatever consumers asked for in v1.x)
- [ ] **Bleno error/lifecycle handling** — adapter unavailable, advertising rejected, multiple subscribers

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| `ITrainerTransport` surface conformance | HIGH | LOW | **P1** |
| FIT parsing → power + cadence | HIGH | MEDIUM | **P1** |
| Real-time scheduler (timestamp-respecting) | HIGH | MEDIUM | **P1** |
| FTMS IndoorBikeData encoding | HIGH | MEDIUM | **P1** |
| `speed` multiplier | HIGH | LOW | **P1** |
| `loop` + stop-at-end + `'complete'` | HIGH | LOW | **P1** |
| `sendResistance` echo-only + recorder | HIGH | LOW | **P1** |
| `reset()` for test isolation | HIGH | LOW | **P1** |
| Internal `RecordSource` abstraction | MEDIUM (architectural) | LOW | **P1** (cheap, sets up v2) |
| TypeScript types | HIGH | LOW | **P1** |
| Manual clock / `tick(ms)` | MEDIUM-HIGH | MEDIUM | **P2** |
| Notification observability hooks | MEDIUM | LOW | **P2** |
| Flexible source input types | MEDIUM | LOW | **P2** |
| Speed / HR fields | LOW (until requested) | LOW | **P3** |
| Deterministic jitter / seeding | LOW | LOW | **P3** |
| BlenoTransport | HIGH (for v2 audience) | HIGH | **P2** (v2) |
| CLI | MEDIUM (v2 only) | LOW | **P2** (v2) |
| Control Point opcode handling (real GATT) | HIGH (for v2) | MEDIUM | **P2** (v2) |
| Fitness Machine Feature characteristic | MEDIUM | LOW | **P2** (v2) |

**Priority key:**
- P1 — must have for v1 launch
- P2 — should have, add when consumer demand or v2 forces it
- P3 — nice to have, deliberately deferred

---

## Competitor Feature Analysis

| Feature | zwack | gymnasticon | swiftcheetah | trainer-sim's approach |
|---------|-------|-------------|--------------|------------------------|
| **FIT replay as data source** | No (interactive keys) | No (real bike bridge or `--bot-power`) | No (synthetic) | **Yes — primary input** (PROJECT.md core value) |
| **In-process / library mode** | No (binary, real BLE) | No (binary, real BLE) | No (iOS app) | **Yes — v1 *only* mode** (FakeTransport) |
| **Real BLE peripheral** | Yes (bleno) | Yes (bleno) | Yes (CoreBluetooth) | v2 only (BlenoTransport) |
| **CLI** | npm script + keyboard | yargs CLI + JSON config | UI | v2 only |
| **TypeScript / typed API** | No (plain JS) | No (plain JS) | Swift (typed) | **Yes** |
| **Test-oriented observability** (assertable spies) | No | No | No | **Yes — `received.resistance`** |
| **FTMS encode** | Partial | Yes | Yes | **Full power + cadence v1; speed/HR v1.x** |
| **Loop / speed control** | Manual (keyboard) | Steady-state | Manual (UI) | **Yes — `speed`, `loop` config** |
| **`sendResistance` round-trip** | Logs only | Bidirectional w/ real bike | Yes | **Echo-only by design** (faithful replay) |
| **Multi-platform** | macOS/Pi (BLE-bound) | macOS/Pi/x86 Linux | iOS only | **Anywhere Node runs (v1); macOS/Linux (v2)** |
| **MIT-licensed** | MIT | MIT | — | **MIT** (PROJECT.md) |

**Differentiation summary:** trainer-sim wins on three axes that no comparable tool
addresses simultaneously: **(1) FIT-driven realism**, **(2) in-process testability**,
and **(3) library-first ergonomics inspired by MSW/Nock/Sinon rather than by
end-user simulator binaries.** zwack and gymnasticon are excellent at being end-user
binaries; trainer-sim is targeting a different job-to-be-done.

---

## Open Questions for Roadmap Phase Research

These do not block v1 scope but should be resolved at the relevant phase:

1. **FIT parser pick** — `@garmin/fitsdk-javascript` (sync, official, well-typed) vs.
   `fit-file-parser` (older, callback-based). PROJECT.md defers this; STACK.md
   research should resolve. Lean toward Garmin official.
2. **Manual-clock semantics** — does `tick(ms)` advance simulated time only, or also
   process pending timers? Sinon's `tick` does both. Decide before public API freezes.
3. **`onData` shape** — single callback (current PROJECT.md) vs. EventEmitter vs.
   AsyncIterable. Single callback with disposer is simplest; EventEmitter enables
   multiple subscribers (which v2 BlenoTransport will need anyway via GATT).
4. **`'complete'` event vs. returned Promise** — both? Pick a primary; document the
   other as syntactic sugar.
5. **What does `received` look like once Control Point opcodes land in v2?** — design
   it now (`received.controlPoint: { opcode, params }[]`) so v1's `received.resistance`
   doesn't paint us into a corner.

---

## Sources

**Comparable simulators (HIGH confidence — direct READMEs read):**
- zwack (paixaop) — https://github.com/paixaop/zwack — README, 128 stars, Node + bleno + FTMS
- gymnasticon (ptx2) — https://github.com/ptx2/gymnasticon — README, 328 stars, Node + bleno + ANT+
- FTMSTrainer (michallaskowski) — https://github.com/michallaskowski/FTMSTrainer — README, Swift, FTMS client models
- ftms-toolkit (eenterwebz) — README, Python, confirms FTMS opcode semantics from a consumer's perspective
- swiftcheetah — described from search metadata (MEDIUM confidence on internals)

**FTMS spec (HIGH confidence — flag bits and field types):**
- Indoor Bike Data flag bits and field structure — https://github.com/oesmith/gatt-xml/blob/master/org.bluetooth.characteristic.indoor_bike_data.xml (per WebFetch summary)
- Bluetooth SIG FTMS 1.0 spec page — https://www.bluetooth.com/specifications/specs/fitness-machine-service-1-0/ (page exists; full spec PDF not fetched)

**Mock-library API patterns (HIGH confidence — official docs read):**
- MSW — https://mswjs.io/docs (`setupServer`, `listen`/`close`, `resetHandlers`, `use`)
- Nock — https://github.com/nock/nock (fluent builder, `.isDone()`, `.pendingMocks()`, events)
- Sinon fake-timers — https://sinonjs.org/releases/latest/fake-timers/ (`tick`, `next`, `runAll`, `jump`, `restore`)
- MirageJS — https://miragejs.com/docs/getting-started/overview/ (factories, `server.create`, `timing`, scenarios)
- fake-indexeddb — referenced as the pattern for "drop-in replacement satisfying real interface" (could not fetch official page; pattern is well-known in JS testing)

**FIT parser ecosystem (HIGH confidence on Garmin, MEDIUM on others):**
- `@garmin/fitsdk-javascript` — https://github.com/garmin/fit-javascript-sdk — sync API, `Decoder.read()` returns `{ messages, errors }`, `record.power` / `record.cadence` / `record.timestamp`
- `fit-file-parser` — https://github.com/pierremtb/easy-fit (older, callback-style; not directly fetched)

---

*Feature research for: BLE FTMS smart-trainer simulator / FIT-replay test library*
*Researched: 2026-05-13*
