# Roadmap: trainer-sim

## Overview

trainer-sim is built bottom-up along a strictly linear dependency chain: a vendored
FTMS encoder is the foundation (its byte-level traps are silent and downstream-fatal),
the FIT loader normalizes real Garmin/Wahoo exports into a clean record stream, the
replay engine drives those records through a drift-corrected scheduler, the
FakeTransport wraps the engine in the public `ITrainerTransport` contract, and the v1
ships only when VeloWorld's existing decoder consumes a real FIT replay end-to-end on
both macOS and Linux. Each phase is testable in isolation against the layer above it,
so a regression at any layer surfaces locally rather than at the integration gate.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Vendored FTMS Codec** - Byte-correct IndoorBikeData encoder gated on spec-cited MIT decoder round-trip + hand-computed byte fixtures + one-shot nRF Connect manual verification
- [ ] **Phase 2: FIT Loader & Normalization** - Real Garmin/Wahoo FIT files become a clean RideRecord stream
- [ ] **Phase 3: Replay Engine** - Drift-corrected real-time scheduler with clean cancellation and loop/stop semantics
- [ ] **Phase 4: FakeTransport & Public API** - `createFakeTransport` factory ships dual ESM/CJS with the `ITrainerTransport` contract
- [ ] **Phase 5: VeloWorld End-to-End Validation** - VeloWorld's dev/test build runs green against a real FIT replayed through FakeTransport on macOS and Linux

## Phase Details

### Phase 1: Vendored FTMS Codec
**Goal**: Library produces byte-correct FTMS IndoorBikeData payloads that any spec-compliant decoder can consume
**Depends on**: Nothing (first phase)
**Requirements**: FTMS-01, FTMS-02, FTMS-03, FTMS-04, FTMS-05a, FTMS-05b, FTMS-05c
**Success Criteria** (what must be TRUE):
  1. Calling the encoder with a `{power, cadence}` record produces a little-endian `DataView` that matches a hand-computed reference payload byte-for-byte (FTMS-05b)
  2. Encoded payloads round-trip cleanly through a spec-cited hand-rolled MIT decoder at `test/fixtures/ftms-decoder.ts` — each field annotated with the Bluetooth SIG FTMS v1.0.1 §4.9 line it implements, authored from the spec rather than by inverting the encoder (FTMS-05a)
  3. Power values across the sint16 sign edge (`-1`, `-32768`, `+32767`) round-trip with correct sign and value
  4. Cadence at half-rpm resolution (e.g., 90.5 rpm) round-trips through the decoder as 90.5, not 45 or 181
  5. The "More Data" flag bit-0 inversion is set correctly: encoded payloads decode with the expected speed-present semantics
  6. One-shot manual nRF Connect verification — a dev script encodes a known `{power, cadence}` payload, nRF Connect on a phone reads back the same values, screenshot attached to phase verification (FTMS-05c)
**Plans**: 5 plans
- [x] 01-01-PLAN.md — Project skeleton (package.json, tsconfig, tsup, vitest, src/index.ts stub, README, .gitignore) — Wave 1
- [x] 01-02-PLAN.md — Hand-rolled spec-cited MIT FTMS decoder fixture (test/fixtures/ftms-decoder.ts) — Wave 1
- [x] 01-03-PLAN.md — Implement encodeIndoorBikeData (src/ftms/indoor-bike-data.ts) + re-export from src/index.ts — Wave 2
- [x] 01-04-PLAN.md — Byte-correctness + round-trip + FIELDS-invariants test suite + publint/attw validate — Wave 3
- [x] 01-05-PLAN.md — GitHub Actions CI (macOS + Ubuntu, Node 24) + nRF Connect manual verification — Wave 3
**Notes**:
  - Risk: encoding traps (sint16, half-rpm, inverted bit-0, big-endian default) are all silent — naive unit tests pass but real decoders disagree. Phase 1 done is gated on three independent checks, not one: hand-computed byte fixtures (catches spec mis-reads), spec-cited MIT decoder round-trip (catches encoder/decoder asymmetry and future regressions), and one-shot nRF Connect (the only genuinely third-party check).
  - Decoder harness resolved 2026-05-13: hand-rolled MIT decoder in `test/fixtures/ftms-decoder.ts`, authored from the SIG spec PDF. Auuki was rejected — it is AGPL-3.0 (prior CONTEXT entries calling it MIT-compatible were wrong); vendoring or submoduling it would contaminate this MIT repo. PyFTMS and an Auuki submodule were considered and declined as heavier alternatives that don't materially improve coverage over the chosen three-gate approach.

### Phase 2: FIT Loader & Normalization
**Goal**: Library turns a real Garmin/Wahoo FIT file (path or Buffer) into a normalized, time-ordered `RideRecord[]` that the replay engine can consume without surprises
**Depends on**: Phase 1
**Requirements**: FIT-01, FIT-02, FIT-03, FIT-04, FIT-05
**Success Criteria** (what must be TRUE):
  1. Loading a FIT file by filesystem path and by in-memory Buffer both yield the same normalized `RideRecord[]`
  2. Timestamps in the returned records are Unix epoch milliseconds, not FIT epoch (the 1989-12-31 UTC offset is applied)
  3. A real Garmin export containing autopause gaps, sparse smart-recording records, and null power values loads without throwing and produces a usable record stream
  4. A TrainerRoad-exported FIT file with developer-defined `power` fields loads without throwing and emits a `util.debuglog('trainer-sim:fit')` warning naming the affected fields (per FIT-05 amendment 2026-05-16 / D-FIT-10; supersedes the prior "returns standard `record.power`, never the developer field" wording)
**Plans**: 5 plans
- [x] 02-01-PLAN.md — Foundation: install fit-file-parser@~3.0.0, add RideRecord type, FitLoadError hierarchy (D-FIT-01, D-FIT-06, D-FIT-08, D-FIT-10) — Wave 1
- [x] 02-02-PLAN.md — Fixtures: scrubber + shadow generator + 7 committed FIT fixtures + provenance README (D-FIT-04, D-FIT-05) — Wave 2
- [x] 02-03-PLAN.md — Source: src/fit/normalize.ts + src/fit/loader.ts (header/CRC validation, FitRecordSource seam, shadow debuglog) + src/index.ts re-exports (D-FIT-01..03/06..10) — Wave 3
- [x] 02-04-PLAN.md — Tests A: loader path/buffer parity, error paths, dev-field shadow non-fatal, perf gate <50 ms (FIT-01, FIT-04, FIT-05, D-FIT-06, D-FIT-10) — Wave 4
- [x] 02-05-PLAN.md — Tests B: normalize unit tests + TEST_FIT_DIR opt-in local-dev suite (FIT-02, FIT-03, FIT-04, D-FIT-01..04, D-FIT-09) — Wave 4
**Notes**:
  - Phase research flag: final FIT-parser license review — confirm `fit-file-parser` 3.0 (MIT) is the right pick versus `@garmin/fitsdk` (custom Garmin license). The `FitLoader` boundary makes the swap a one-file change either way, but the call must be made before any code lands.
  - Parse upfront, not lazily — keeps the Phase 3 scheduler honest. Performance gate: <100 ms parse for a typical 1-hour file.

### Phase 3: Replay Engine
**Goal**: Library replays a `RideRecord[]` in real time with configurable speed, loop/stop-at-end behavior, drift-bounded timing, and clean cancellation
**Depends on**: Phase 2
**Requirements**: REPL-01, REPL-02, REPL-03, REPL-04, REPL-05, REPL-06
**Success Criteria** (what must be TRUE):
  1. A 30-minute FIT replayed at `speed=1` ends within 250 ms of the source FIT duration (drift-corrected scheduler verified by long-soak smoke test)
  2. Setting `speed=Infinity` replays as fast as possible without exceeding the configurable max emission-rate cap
  3. Default end-of-file behavior stops the replay and emits a `'complete'` event a test can `await`; setting `loop: true` restarts from the first record without drift accumulating across loop boundaries
  4. After `disconnect()` resolves, no further `onData` callbacks fire (verified by a "wait 100 ms after disconnect, assert zero emissions" test)
**Plans**: 4 plans
- [ ] 03-01-PLAN.md — Foundation: src/replay/types.ts (ReplayConfig + ReplayState) + src/replay/scheduler.ts (drift-corrected runScheduler async fn, D-REPL-01..06/09) — Wave 1
- [ ] 03-02-PLAN.md — Replay class: src/replay/replay.ts (lifecycle wrapper, single-subscriber, AbortController, completed Promise, D-REPL-07..13) — Wave 2
- [ ] 03-03-PLAN.md — Unit-test suite: test/replay/{scheduler,replay,abort,loop}.test.ts (vi.useFakeTimers; REPL-01/02/04/05/06) — Wave 3
- [ ] 03-04-PLAN.md — Soak suite: test/replay/{soak-proxy,soak}.test.ts (real-clock; REPL-03 drift gate, opt-in via RUN_SOAK=1) — Wave 3
**Notes**:
  - The scheduler is the keystone for v2 BlenoTransport too — getting drift correction and `AbortController` cancellation right once means v2 inherits it for free.
  - Standard pattern; no phase research flag.

### Phase 4: FakeTransport & Public API
**Goal**: Library exposes a `createFakeTransport(config)` factory that satisfies `ITrainerTransport` and ships as a dual ESM/CJS package importable cleanly into a TypeScript Node 24 project
**Depends on**: Phase 3
**Requirements**: API-01, API-02, API-03, API-04, API-05, API-06, API-07, API-08
**Success Criteria** (what must be TRUE):
  1. `createFakeTransport(config)` returns an object with `connect`, `disconnect`, `onData`, and `sendResistance` matching the `ITrainerTransport` type exported from the package root
  2. `onData(handler)` accepts a `(data: DataView) => void` handler and returns a disposer that, when called, stops further deliveries to that handler
  3. Calling `sendResistance(grade)` records the grade in `received.resistance` (in order) and does not modify any subsequent emitted power or cadence value
  4. `reset()` clears `received.resistance` and rewinds the replay cursor so a single instance can be reused across `afterEach()`-isolated tests
  5. `publint` and `@arethetypeswrong/cli` both pass against the published package shape; importing the library into a fresh strict-mode TypeScript Node 24 project requires no `@types/*` shim
**Plans**: TBD
**Notes**:
  - The `ITrainerTransport` interface owns the async semantics for `sendResistance` (force a microtask boundary even in Fake) and forbids any BLE-specific types in the import graph — these decisions ripple through every test and into v2's BlenoTransport, so settle them here.

### Phase 5: VeloWorld End-to-End Validation
**Goal**: VeloWorld's dev/test build runs green end-to-end against FakeTransport replaying a real Garmin/Wahoo FIT file, on both macOS and Linux
**Depends on**: Phase 4
**Requirements**: VW-01, VW-02, VW-03
**Success Criteria** (what must be TRUE):
  1. VeloWorld's existing `ITrainerTransport`-consuming code runs unchanged when FakeTransport is swapped in for the real BLE transport (no edits to ride scene or physics code)
  2. A real Garmin/Wahoo FIT file replayed through FakeTransport yields power and cadence values that VeloWorld's existing FTMS decoder reads correctly across the full ride
  3. CI runs the VeloWorld E2E suite green on both macOS and Linux on Node 24
**Plans**: TBD
**Notes**:
  - Cross-repo coordination point: the integration target lives in the VeloWorld repo, not this one. Plan-phase will need a coordinated workflow that pulls VeloWorld's existing `ITrainerTransport` consumer into a smoke test (or stands up a temporary integration harness inside trainer-sim that mirrors VeloWorld's decoder usage). Decide the form before planning starts.
  - The acceptance gate per PROJECT.md: until this phase passes, v1 is not done — green unit tests in Phases 1–4 are necessary but not sufficient.

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Vendored FTMS Codec | 0/TBD | Not started | - |
| 2. FIT Loader & Normalization | 0/5 | Not started | - |
| 3. Replay Engine | 0/TBD | Not started | - |
| 4. FakeTransport & Public API | 0/TBD | Not started | - |
| 5. VeloWorld End-to-End Validation | 0/TBD | Not started | - |

## Risks & Coordination Points

- **Phase 1 — decoder harness (resolved 2026-05-13).** Hand-rolled spec-cited MIT decoder in `test/fixtures/ftms-decoder.ts` + hand-computed byte fixtures + one-shot nRF Connect manual verification. Auuki was rejected as AGPL-3.0 (prior CONTEXT.md/SUMMARY.md entries calling it MIT-compatible were wrong). See Phase 1 success criteria.
- **Phase 2 — FIT-parser license review.** The deferred PROJECT.md decision between `fit-file-parser` (MIT) and `@garmin/fitsdk` (custom Garmin license) must be resolved by phase research before code lands. The `FitLoader` boundary makes the swap a one-file change either way.
- **Phase 5 — cross-repo coordination with VeloWorld.** The integration target lives in a separate repository. The form of the integration test (in-tree harness mirroring VeloWorld's decoder usage vs a coordinated PR against VeloWorld) must be decided in plan-phase.
