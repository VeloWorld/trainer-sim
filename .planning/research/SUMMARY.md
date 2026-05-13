# Project Research Summary

**Project:** trainer-sim
**Domain:** Node.js/TypeScript library — BLE FTMS smart-trainer simulator via FIT replay (v1 = library-only `FakeTransport`; v2 = `BlenoTransport` + CLI, out of scope)
**Researched:** 2026-05-13
**Confidence:** HIGH

## Executive Summary

trainer-sim is a developer test tool: a TypeScript library that lets cycling apps (VeloWorld first, any FTMS-based app second) drop in a `FakeTransport` that satisfies an `ITrainerTransport` contract and emits realistic FTMS `IndoorBikeData` notifications by replaying real Garmin/Wahoo FIT files in real time. Its closest philosophical peers are not other cycling simulators (zwack, gymnasticon — both end-user BLE-broadcasting binaries) but rather mock libraries like MSW, Nock, and Sinon's fake-timers, whose factory + lifecycle + observability + time-control shape is what 2026 consumers expect from a "fake transport for tests."

The recommended approach is a strictly layered, one-way pipeline (FIT loader → normalized `RideRecord[]` → pure ride iterator → drift-corrected scheduler → vendored FTMS encoder → transport seam) on a Node 22 LTS + TypeScript 5.9 + tsup + vitest stack, ESM-first with dual-publish, and a `createFakeTransport(config)` factory as the single public entry point. The transport seam is the only place v1 and v2 diverge: composition (not inheritance) means `BlenoTransport` is a new file in v2 wrapping the same `ReplayController` — not a refactor. `ITrainerTransport` is owned by trainer-sim and re-exported, so VeloWorld and any future open-source consumer share one canonical type.

The risk profile is dominated by encoding correctness, not architecture. The FTMS spec has four concrete traps that silently produce valid-looking-but-wrong bytes (sint16 vs uint16 power, the inverted "More Data" flag bit 0, half-rpm cadence resolution, and `DataView`'s big-endian default). FIT files have three traps (1989 epoch offset, autopause/sparse-record gaps, developer-defined fields shadowing standard ones). The `setInterval`-vs-absolute-deadline scheduler trap is the one architectural risk that — left unfixed — silently degrades long-soak fidelity. Mitigation: a "spec-table-review + third-party-decoder round-trip" gate before declaring the encoder done, plus parsing FIT upfront into a normalized `{ts, power, cadence}[]` rather than lazily during replay.

## Key Findings

### Recommended Stack

Node.js 22 LTS + TypeScript 5.9 strict, ESM-first with dual ESM/CJS publish via `tsup`. Test with `vitest` 4 (matches what `fit-file-parser` and `@garmin/fitsdk` themselves use). Package hygiene via `publint` + `@arethetypeswrong/cli` is non-negotiable. There is **no usable npm encoder for FTMS IndoorBikeData** — vendoring the codec is the only path; the spec is small (≤8 bytes for v1's power+cadence-only payload) and stable. See [STACK.md](./STACK.md).

**Core technologies:**
- **TypeScript 5.9 + Node 22 LTS** — VeloWorld parity; LTS through Oct 2026
- **`tsup` 8.5** — zero-config dual ESM+CJS builder; v2 can add a `trainer-sim/bleno` subpath export without restructuring
- **`vitest` 4.1** (stay on 4 — 5 is beta) — drop-in fake timers cooperate with consumer test suites
- **`fit-file-parser` 3.0** — recommended FIT parser: MIT (vs Garmin's custom non-OSI license), ships TS types, dual ESM+CJS, last released 2026-05-05. **Headline deferred decision** — see Gaps
- **Hand-rolled FTMS encoder, vendored** — no npm package exists; spec is small; matches PROJECT.md's "vendor first" decision
- **`@stoprocent/bleno` 0.12** for v2 (NOT `@abandonware/bleno`) — 80× the weekly downloads, async API, modern TS types, Apple Silicon fix; PROJECT.md should be updated at the next phase transition

### Expected Features

Differentiation comes from being **library-first, in-process, FIT-driven, and observable for tests** — no comparable cycling simulator hits all four. The shape consumers expect is a `createFakeTransport({source, speed, loop})` factory returning an `ITrainerTransport` with `connect/disconnect/onData/sendResistance` plus test-affordance reads (`received.resistance[]`, `'complete'` event, `reset()`). See [FEATURES.md](./FEATURES.md).

**Must have (table stakes):**
- `ITrainerTransport`-shaped surface — VeloWorld swap with zero scene/physics changes
- FIT parsing → power + cadence record stream (real-time, respecting FIT timestamps)
- Faithful FTMS `IndoorBikeData` encoding as a `DataView` (consumer's existing decoder must work unchanged)
- Speed multiplier, loop vs stop-at-end, `'complete'` signal
- Echo-only `sendResistance(grade)` with assertion access (`received.resistance`)
- `reset()` for `afterEach` test isolation
- Cooperates with consumer fake timers (use `setTimeout`, not `setImmediate`/`process.nextTick`)
- TypeScript types shipped from package root

**Should have (competitive):**
- Manual / virtual-clock mode (`tick(ms)`) — Sinon's pattern
- Notification observability hooks (`'data'` event, `notified.count`)
- Pluggable internal `RecordSource` so trainer-sim's *own* tests skip FIT parsing without violating "real FIT only" for *consumers*
- Source-input flexibility (`Buffer | string | ReadableStream`)
- Resistance recorder generalized around control-point opcodes (so v2's GATT FMCP writes use the same shape)

**Defer (v2+):**
- `BlenoTransport` (real BLE peripheral, macOS/Linux only)
- CLI (`trainer-sim play <file.fit>`) — only meaningful with BLE
- Speed and HR `IndoorBikeData` fields — gated on a consumer asking
- GATT Fitness Machine Control Point opcode handling
- Round-trip FTMS *decode* in trainer-sim (decode lives in VeloWorld per PROJECT.md)

### Architecture Approach

A six-layer one-way pipeline with composition over inheritance at the transport seam: `FitLoader → RideIterator → FtmsEncoder ← ReplayController (owns Scheduler + ResistanceLog) → Transport (Fake or Bleno)`. Everything below the transport layer has zero knowledge of how data exits the process — `BlenoTransport` in v2 is a new file, not a refactor. The factory `createFakeTransport()` is the only public entry point; the underlying class is an implementation detail. See [ARCHITECTURE.md](./ARCHITECTURE.md).

**Major components:**
1. **`FitLoader`** (`src/fit/`) — parses FIT file/Buffer into a normalized, ordered `RideRecord[]`; isolates parser-library choice behind one boundary
2. **`RideIterator`** (`src/replay/`) — pure stateful cursor (`next`/`peek`/`reset`); no clock, no I/O, trivially testable
3. **`Scheduler`** (`src/replay/`) — drift-corrected timer anchored to `performance.now()`; `AbortController`-aware; speed multiplier is a single division
4. **`ReplayController`** (`src/replay/`) — orchestrates iterator + scheduler + encoder; emits `frame` and `end` events; doesn't know about transports
5. **`FtmsEncoder`** (`src/ftms/`) — pure stateless `(record) → DataView`; vendored, in its own folder so the eventual `@veloworld/ftms-codec` extraction is a literal directory move
6. **`FakeTransport`** (`src/transport/`) — thin EventEmitter glue implementing `ITrainerTransport`; ~30 lines once the engine is built; `BlenoTransport` (v2) is a sibling file with identical shape

The smallest end-to-end slice that proves the architecture is **encoder + iterator + a synchronous "as-fast-as-possible" controller** (no scheduler yet) — build this first to flush out byte-level correctness before layering real-time behavior on top.

### Critical Pitfalls

The encoding traps are silent, the timing traps accumulate, and the FIT-format traps require real Garmin/Wahoo files (not synthetic minimal ones) to surface. See [PITFALLS.md](./PITFALLS.md) for all 14.

1. **FTMS "More Data" flag bit 0 is inverted** — every other GATT flag uses "1 = present"; bit 0 of `IndoorBikeData` flags uses "0 = speed present, 1 = NOT present." *Avoid:* named constant `MORE_DATA_BIT = 0` with a comment, plus a third-party-decoder round-trip test.
2. **InstantaneousPower is sint16, not uint16** — and so are `ResistanceLevel` and `Inclination`. Cadence is uint16 with **0.5 rpm resolution** (wire = `rpm × 2`). *Avoid:* a single `FIELDS` table-of-truth (type, resolution, unit, flagBit) reviewed line-by-line against the Bluetooth SIG spec.
3. **`DataView` defaults to big-endian; FTMS/FIT/GATT are all little-endian.** *Avoid:* prefer `Buffer.writeUInt16LE`/`writeInt16LE`; if using `DataView`, wrap in `writeU16LE` and lint-ban raw `setUint16`.
4. **`setTimeout`/`setInterval` drift accumulates over long replays.** *Avoid:* absolute-deadline scheduler — each tick's delay is `(fitElapsed/speed) - wallElapsed`, anchored to `startMonotonic`; long-soak smoke test asserts end time within 250 ms of FIT duration.
5. **FIT epoch is 1989-12-31 UTC, not Unix** — offset is `631_065_600` seconds. *Avoid:* single `fitToUnixMs(fitTs)` helper at the parse boundary.
6. **FIT files have autopause gaps, sparse smart-recording records, null power, and developer-defined fields shadowing standard ones** — synthetic test FITs don't reproduce these. *Avoid:* read standard fields by `(message-num, field-num)` not by name; explicit `gapStrategy: 'holdLast'`; test with a real Garmin export with autopause and a TrainerRoad-exported file.
7. **`disconnect()` must fully tear down the loop** — flag-only stop lets next-tick fire. *Avoid:* `AbortController` owned by `ReplayController`, `clearTimeout` on cancel, contract that "after `disconnect()` resolves, no further `onData` callbacks fire."

## Implications for Roadmap

The dependency graph is a near-perfect linear chain (encoder → loader → iterator → scheduler → controller → transport → public API → e2e), so phase ordering is largely forced by build dependencies. Each phase is a layer testable in isolation against the layer above it. This favors **bottom-up phases with one e2e validation gate** rather than feature-vertical slices.

### Phase 1: Foundations & Vendored FTMS Codec
**Rationale:** The codec is the highest-risk correctness piece (byte-level wire format with four silent-failure traps) and has zero downstream dependencies — flush it out first so nothing builds on a broken foundation.
**Delivers:** `types.ts` (`ITrainerTransport`, `RideRecord`, configs), `util/clock.ts` (injectable clock), `src/ftms/indoor-bike-data.ts` (vendored encoder for power+cadence), full unit-test coverage including third-party-decoder round-trip and sign-edge cases.
**Addresses:** "FTMS IndoorBikeData encoder vendored" must-have; foundation for `ITrainerTransport`-shaped surface.
**Avoids:** Pitfalls 1–3 + endianness — gated by a "spec-table review + third-party decoder round-trip" before declaring done.

### Phase 2: FIT Loader & Normalization
**Rationale:** Decoupled from replay timing and from the encoder. The loader's *interface* (`load(path|Buffer) → RideRecord[]`) can be built and tested with stub data first, then the real parser swapped in. This keeps "decide on a parser" off the critical path.
**Delivers:** `src/fit/loader.ts` (parser-library wrapper), `src/fit/normalize.ts` (FIT records → `RideRecord` shape, with FIT-epoch conversion, gap normalization, null-power policy, developer-field exclusion), tests against a real Garmin/Wahoo export with autopause, plus a TrainerRoad-exported file to validate developer-field handling.
**Uses:** `fit-file-parser@3` (recommended) or `@garmin/fitsdk@21` (if license review flips the decision).
**Avoids:** Pitfalls 5 (FIT epoch), 6 (gaps/sparse records/null power/dev fields), event-loop blocking (parse upfront, performance gate <100 ms for a 1-hour file).

### Phase 3: Replay Engine (Iterator + Scheduler + Controller)
**Rationale:** The keystone — speed multiplier, loop, manual clock, and v2's BlenoTransport all hang off the scheduler. Get the scheduler right *once* and v2 inherits it for free.
**Delivers:** `src/replay/ride-iterator.ts`, `src/replay/scheduler.ts` (drift-corrected, monotonic-clock-anchored), `src/replay/controller.ts` (`AbortController` cancellation, `frame`/`end` events), `src/replay/resistance-log.ts`, long-soak smoke test asserting <250 ms drift over a 30-min replay.
**Uses:** Node `AbortController`, `perf_hooks.performance.now()`.
**Avoids:** Pitfall 4 (setTimeout drift — absolute-deadline scheduling), Pitfall 7 (clean disconnect — `clearTimeout` + AbortController; "no emissions after disconnect" test).

### Phase 4: FakeTransport & Public API
**Rationale:** Thin glue once the engine emits frames (~30 lines). Settling `ITrainerTransport`'s async semantics here — before either v1 or v2 ships — avoids a ripple-through-every-test refactor when BLE arrives.
**Delivers:** `src/transport/fake-transport.ts` (`createFakeTransport` factory, EventEmitter-backed `onData` with disposer return, `received.resistance` recorder, `reset()`, `'complete'` event), `src/index.ts` (public exports map, ESM-first dual publish), `package.json` exports field validated by `publint` + `attw`.
**Uses:** `tsup` (dual ESM/CJS build), `publint`, `@arethetypeswrong/cli`.
**Avoids:** Pitfall 12 (sendResistance async semantics — declare async, force a microtask boundary even in Fake), Pitfall 13 (BLE types leaking — type-only imports, no bleno in `ITrainerTransport`'s import graph).

### Phase 5: VeloWorld End-to-End Validation
**Rationale:** The only acceptance test that matters per PROJECT.md ("VeloWorld's dev/test build runs end-to-end against FakeTransport with a real FIT file"). Until this passes, v1 isn't done regardless of green unit tests.
**Delivers:** Real Garmin/Wahoo FIT replayed end-to-end through FakeTransport into VeloWorld's decoder; assertions on power+cadence values across the ride; CI green on macOS + Linux on Node 22.
**Avoids:** Silent encoding mismatch between trainer-sim's encoder and VeloWorld's decoder — recovery from this post-v1 is a coordinated major-version bump.

### Phase Ordering Rationale

- **Bottom-up is forced by the dependency graph.** Nothing above the codec can be built or meaningfully tested until the codec is correct, and nothing above the engine layer means anything until the scheduler is drift-free.
- **The encoder leads despite being "small" because its traps are silent.** Pitfalls 1–3 pass naive unit tests, ship, and surface only when an external decoder reads the payload.
- **The FIT parser decision is intentionally deferred to Phase 2, not Phase 0.** Building the `FitLoader` interface against stubs first lets engine work proceed in parallel; the parser swap is one file.
- **The transport seam is one phase, not split** — `ITrainerTransport`'s async semantics and the no-BLE-types rule are easier to get right in a single sitting than to refactor across two phases.
- **VeloWorld integration is its own phase, not a sub-task of Phase 4.** The PROJECT.md acceptance criterion deserves a dedicated gate.

### Research Flags

Phases likely needing deeper research during planning (`/gsd-research-phase`):

- **Phase 1 (FTMS encoder):** **Third-party decoder round-trip test harness selection** — pick between Auuki's JS decoder, PyFTMS, and nRF Connect mobile.
- **Phase 2 (FIT loader):** **Final FIT parser decision.** Confirm Garmin license is incompatible with MIT redistribution; verify `fit-file-parser` correctly handles a TrainerRoad-exported FIT with developer fields; confirm both parsers expose the same `record.power`/`record.cadence`/`record.timestamp` shape.

Phases with standard patterns (skip research-phase):

- **Phase 3 (replay engine):** Drift-corrected scheduler with monotonic clock + AbortController is well-documented.
- **Phase 4 (transport + public API):** Factory-returns-interface and ESM-first dual-publish are 2026 standard patterns.
- **Phase 5 (VeloWorld integration):** Pure validation; nothing to research.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Verified against npm registry, npm downloads API, GitHub repo health, official docs. The one MEDIUM sub-confidence is the parser pick (license interpretation needs human review). |
| Features | MEDIUM-HIGH | HIGH for FTMS Indoor Bike Data structure, comparable simulators, mock-library API patterns. MEDIUM for inferred consumer expectations in the FTMS dev-tool space. |
| Architecture | HIGH | Anchored to PROJECT.md decisions and FTMS spec authority. The drift-corrected scheduler pattern is borrowed from real-time playback engines where it's well-validated. |
| Pitfalls | HIGH | FTMS encoding traps cross-checked against three sources (Auuki JS, PyFTMS Python, Bluetooth SIG spec). Node timer behavior quoted from official Node docs. MEDIUM-confidence sub-area is cross-app compatibility (Zwift/TrainerRoad) — but this is a v2 concern. |

**Overall confidence:** HIGH

### Gaps to Address

- **FIT parser choice (deferred decision).** STACK.md recommends `fit-file-parser` 3.0; FEATURES.md leans toward `@garmin/fitsdk` (ergonomics). Deciding factor is license review of Garmin's custom FIT Protocol License against an MIT-redistributed open-source dev tool. Resolve at the start of Phase 2 with a 30-minute license read; if Garmin's license is incompatible, `fit-file-parser` wins on license alone. The `FitLoader` boundary makes this a one-file change either way.
- **PROJECT.md update for `@stoprocent/bleno`.** PROJECT.md names `@abandonware/bleno`; STACK.md found `@stoprocent/bleno` is the modern fork (80× downloads, async API, Apple Silicon fix). v2 concern, but reflect at the next phase transition so v1 architecture decisions don't accidentally encode `@abandonware`-specific assumptions (e.g., advertising-name length defaults).
- **Manual-clock semantics for `tick(ms)`.** If it lands in v1, decide whether `tick` advances simulated time only or also processes pending timers. Lock before public-API freeze in Phase 4.
- **`onData` shape.** Single callback with disposer vs EventEmitter vs AsyncIterable. Single callback is simplest; EventEmitter enables multiple subscribers (which v2 BlenoTransport will need anyway via GATT CCCD). Decide in Phase 4.
- **`received` shape forward-compatibility for v2.** Design `received` now as `received.controlPoint: { opcode, params, timestamp }[]` (with `received.resistance` as a derived view) so v2's GATT FMCP opcodes (0x04, 0x05, 0x11) don't paint the v1 API into a corner.
- **Cross-app BLE compatibility (v2).** Zwift's de facto requirements and TrainerRoad's FMCP response-code expectation are MEDIUM-confidence community findings. Out of v1 scope but flag for v2 phase research.

## Sources

### Primary (HIGH confidence)
- npm registry — `fit-file-parser` 3.0.0 (2026-05-05), `@garmin/fitsdk` 21.202.0 (2026-04-28), `@stoprocent/bleno` 0.12.5 (2026-05-07), `@abandonware/bleno` 0.6.2 (2025-02-05)
- npm downloads API — confirmed download share Apr–May 2026 for parser and BLE picks
- GitHub repos — `garmin/fit-javascript-sdk`, `jimmykane/fit-parser`, `stoprocent/bleno`, `abandonware/bleno`
- Bluetooth SIG Fitness Machine Service v1.0.1 — IndoorBikeData characteristic frame layout, flag semantics, field types/resolutions, little-endian encoding
- dvmarinoff/Auuki `src/ble/ftms/indoor-bike-data.js` — JavaScript reference encoder/decoder
- dudanov/python-pyftms — Python reference (confirms sint16 power, half-rpm cadence, 0.01 km/h speed)
- muktihari/fit (Go FIT SDK) — confirms FIT epoch 1989-12-31 UTC, developer-field schema, common gap patterns
- Official Node.js docs — event loop and timers, `AbortController` integration with `node:timers/promises`
- nodejs.org/dist/index.json — current LTS lineup (22 Jod, 24 Krypton)
- PROJECT.md — canonical authority for scope, constraints, key decisions

### Secondary (MEDIUM confidence)
- MSW, Nock, Sinon fake-timers, MirageJS, fake-indexeddb official docs — mock-library API patterns
- Comparable simulators — zwack (paixaop, 128 stars), gymnasticon (ptx2, 328 stars), FTMSTrainer
- Garmin Developer FIT SDK forum — community discussion of corrupted FIT, developer-data decoding
- abandonware/bleno open issues — verified macOS 8-char name limit, NSLog flooding, Linux 6.9 break

### Tertiary (LOW confidence — v2 concern)
- Zwift forums / Reddit r/Zwift — disconnect timeout (~3s) and FMCP requirements
- TrainerRoad FMCP response-code expectation
