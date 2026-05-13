# Requirements: trainer-sim

**Defined:** 2026-05-13
**Core Value:** A cycling app developer can run their app end-to-end against a realistic trainer signal — no hardware, no BLE, no flaky integration loop — by importing one library and pointing it at a real Garmin/Wahoo FIT file.

## v1 Requirements

Requirements for v1 (FakeTransport library only). Each maps to roadmap phases.

### FTMS Codec

- [ ] **FTMS-01**: Library encodes FTMS Indoor Bike Data characteristic payloads as little-endian binary (DataView/Buffer) per Bluetooth SIG spec v1.0.1
- [ ] **FTMS-02**: Encoder includes Instantaneous Power (sint16, watts) when power is present in the source record
- [ ] **FTMS-03**: Encoder includes Instantaneous Cadence (uint16, 0.5 rpm resolution; wire = rpm × 2) when cadence is present in the source record
- [ ] **FTMS-04**: Encoder sets the inverted bit-0 "More Data" flag correctly (0 = speed present, 1 = NOT present) and all other flag bits per spec
- [ ] **FTMS-05a**: Encoded payloads round-trip cleanly through a spec-cited hand-rolled MIT decoder at `test/fixtures/ftms-decoder.ts` (each field annotated with the Bluetooth SIG FTMS v1.0.1 §4.9 line it implements; authored from the spec, not by inverting the encoder) — power, cadence, and speed-present semantics read back equal to the inputs
- [ ] **FTMS-05b**: Encoded payloads match hand-computed reference byte fixtures (per Phase 1 RESEARCH.md) — catches spec mis-reads that an encoder-symmetric round-trip would miss
- [ ] **FTMS-05c**: One-shot manual nRF Connect verification — a dev script encodes a known `{power, cadence}` payload, nRF Connect on a phone reads back the same values, screenshot attached to phase verification (the only genuinely third-party check; required for Phase 1 done)

### FIT Loader

- [ ] **FIT-01**: Library loads a FIT file from a filesystem path or an in-memory Buffer
- [ ] **FIT-02**: Loader extracts `record` messages and exposes them as a normalized, time-ordered `RideRecord[]` (timestamp, optional power, optional cadence)
- [ ] **FIT-03**: Loader converts FIT timestamps (seconds since 1989-12-31 UTC) to Unix epoch correctly
- [ ] **FIT-04**: Loader handles real-world Garmin/Wahoo files with autopause gaps, sparse smart-recording records, and null power values without throwing
- [ ] **FIT-05**: Loader reads standard fields by `(message-num, field-num)` so developer-defined fields (e.g. TrainerRoad's "power") never shadow the standard ones

### Replay Engine

- [ ] **REPL-01**: Replay emits records in real-time, respecting FIT record timestamps (not periodic intervals)
- [ ] **REPL-02**: Replay accepts a numeric `speed` multiplier (`1` = real-time, `2` = 2×, `Infinity` = as-fast-as-possible) with a configurable max emission-rate cap to defend against runaway tests
- [ ] **REPL-03**: Replay scheduler is drift-corrected: end time within 250 ms of FIT duration over a 30-minute replay
- [ ] **REPL-04**: Default end-of-file behavior is stop-at-end; `loop: true` opt-in causes replay to restart from the first record
- [ ] **REPL-05**: When stop-at-end completes, FakeTransport emits a `'complete'` event tests can await
- [ ] **REPL-06**: After `disconnect()` resolves, no further `onData` callbacks fire (AbortController + clearTimeout teardown)

### FakeTransport API

- [ ] **API-01**: Library exports `createFakeTransport(config)` factory returning an `ITrainerTransport`-shaped object (`connect`, `disconnect`, `onData`, `sendResistance`)
- [ ] **API-02**: `ITrainerTransport` interface is exported as a TypeScript type from the package root
- [ ] **API-03**: `onData(handler)` accepts a `(data: DataView) => void` handler and returns a disposer for unsubscription
- [ ] **API-04**: `sendResistance(grade)` is echo-only — it records the call and does NOT modify replayed power/cadence values
- [ ] **API-05**: `received.resistance` is a public read-only array of every `sendResistance(grade)` call in order, for test assertions
- [ ] **API-06**: `reset()` clears the resistance log and replay cursor so a single FakeTransport instance can be reused across `afterEach()`-isolated tests
- [ ] **API-07**: Library ships as ESM-first with dual ESM/CJS publish, validated by `publint` and `@arethetypeswrong/cli`
- [ ] **API-08**: Library is importable into TypeScript Node 24 projects with strict-mode types out of the box

### VeloWorld Integration

- [ ] **VW-01**: VeloWorld's existing `ITrainerTransport`-consuming code runs unchanged when `FakeTransport` is swapped in for the real BLE transport
- [ ] **VW-02**: A real Garmin/Wahoo FIT file replayed through FakeTransport produces power and cadence values that VeloWorld's existing FTMS decoder reads correctly across the full ride
- [ ] **VW-03**: Continuous integration runs the VeloWorld E2E suite green on macOS and Linux (Node 24)

## v2 Requirements

Deferred to v2. Tracked but not in current roadmap.

### BLE Peripheral

- **BLE-01**: `BlenoTransport` advertises as a real FTMS peripheral over Bluetooth Low Energy
- **BLE-02**: BlenoTransport handles GATT Fitness Machine Control Point (FMCP) opcodes (resistance, target power, stop)
- **BLE-03**: BlenoTransport notifications are recognized and consumed by at least one third-party app (Zwift or TrainerRoad)
- **BLE-04**: BlenoTransport works on macOS and Linux (`@stoprocent/bleno`)

### CLI

- **CLI-01**: `trainer-sim play <file.fit>` starts BLE peripheral advertising
- **CLI-02**: CLI exposes flags for `--speed`, `--loop`, and BLE device name

### Codec Sharing

- **CODEC-01**: FTMS encoder extracted to a shared `@veloworld/ftms-codec` npm package and consumed by both trainer-sim and VeloWorld

### Additional FTMS Fields

- **FTMS-06**: Encoder includes Instantaneous Speed (uint16, 0.01 km/h) when present
- **FTMS-07**: Encoder includes Heart Rate (uint8, bpm) when present

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| BlenoTransport / real BLE in v1 | Deferred to v2; FakeTransport unblocks VeloWorld first |
| CLI in v1 | Only meaningful with BLE peripheral, ships with v2 |
| Heart rate and speed FTMS fields in v1 | Not needed by VeloWorld v1; add when a consumer requires them |
| Bundled fixture FIT files | Consumers (incl. VeloWorld) bring their own; tests use generated minimal FIT |
| Resistance affecting replayed power (grade → power scaling) | Couples sim to physics; replay stays faithful to source FIT |
| Synthetic CSV / hand-crafted ride data | Real Garmin/Wahoo FIT files only, from day one |
| Workouts, UI, user management | This is a developer test tool, not a product |
| Recording from a real trainer to FIT | Not a v1 use case; existing tools cover this (zwack, gymnasticon) |
| Windows BLE peripheral | Historically unreliable; not a v1 target (FakeTransport runs anywhere Node runs) |
| Sharing the FTMS codec via npm package in v1 | Vendored copy avoids coupling; extract `@veloworld/ftms-codec` only when both repos feel duplication pain |
| Importing VeloWorld's codec into trainer-sim | Tight coupling — explicit non-goal |
| FTMS *decode* (only encode) | Decode lives in the consuming app; trainer-sim is a producer-only test fake |
| Multiple simultaneous BLE clients (v2 concern, but explicit) | One central per peripheral session is sufficient for app testing |
| ANT+ output | Out-of-band protocol; FTMS over BLE is the v1+v2 surface |
| `tick(ms)` virtual-clock mode in v1 | Differentiator but adds complexity; defer to v1.x if real demand emerges |
| ReadableStream as a FIT input source | `Buffer | path` covers the test patterns; streaming defers to v1.x |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| FTMS-01 | Phase 1 | Pending |
| FTMS-02 | Phase 1 | Pending |
| FTMS-03 | Phase 1 | Pending |
| FTMS-04 | Phase 1 | Pending |
| FTMS-05a | Phase 1 | Pending |
| FTMS-05b | Phase 1 | Pending |
| FTMS-05c | Phase 1 | Pending |
| FIT-01 | Phase 2 | Pending |
| FIT-02 | Phase 2 | Pending |
| FIT-03 | Phase 2 | Pending |
| FIT-04 | Phase 2 | Pending |
| FIT-05 | Phase 2 | Pending |
| REPL-01 | Phase 3 | Pending |
| REPL-02 | Phase 3 | Pending |
| REPL-03 | Phase 3 | Pending |
| REPL-04 | Phase 3 | Pending |
| REPL-05 | Phase 3 | Pending |
| REPL-06 | Phase 3 | Pending |
| API-01 | Phase 4 | Pending |
| API-02 | Phase 4 | Pending |
| API-03 | Phase 4 | Pending |
| API-04 | Phase 4 | Pending |
| API-05 | Phase 4 | Pending |
| API-06 | Phase 4 | Pending |
| API-07 | Phase 4 | Pending |
| API-08 | Phase 4 | Pending |
| VW-01 | Phase 5 | Pending |
| VW-02 | Phase 5 | Pending |
| VW-03 | Phase 5 | Pending |

**Coverage:**
- v1 requirements: 29 total (FTMS-05 split into 05a/05b/05c on 2026-05-13)
- Mapped to phases: 29
- Unmapped: 0 ✓

---
*Requirements defined: 2026-05-13*
*Last updated: 2026-05-13 — traceability finalized after roadmap creation*
