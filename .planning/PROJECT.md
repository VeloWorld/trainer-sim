# trainer-sim

## What This Is

A standalone Node.js library and (later) CLI that impersonates a BLE FTMS smart trainer
by replaying pre-recorded FIT files. It ships two transports from one codebase:
`FakeTransport` for in-process, hardware-free testing, and `BlenoTransport` for real BLE
peripheral advertising. It exists for developers building cycling apps (VeloWorld first,
then any FTMS-based app) who need to develop and test without a physical trainer.

## Core Value

A cycling app developer can run their app end-to-end against a realistic trainer signal —
no hardware, no BLE, no flaky integration loop — by importing one library and pointing it
at a real Garmin/Wahoo FIT file.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

- [x] FakeTransport library exposes an `ITrainerTransport`-shaped interface (`connect`, `disconnect`, `onData`, `sendResistance`) — validated in Phase 4 (API-01..03)
- [x] FakeTransport replays power and cadence from a real Garmin/Wahoo FIT file — validated in Phase 4 against `test/fixtures/fit/basic.fit` (API-01 + integration tests in `test/transport/path-and-buffer.test.ts`)
- [x] Replay timing is real-time and respects FIT record timestamps (configurable speed multiplier and loop/stop-at-end) — validated in Phase 3 + surfaced through FakeTransport in Phase 4 (REPL-01..06)
- [x] FakeTransport emits FTMS IndoorBikeData-encoded `DataView` payloads to subscribers (codec vendored in this repo) — validated in Phase 4 (per-record collapse in `src/transport/fake-transport.ts:204-207` + Phase 1 encoder)
- [x] `sendResistance(grade)` is recorded for test assertions and does not modify replayed values (echo-only) — validated in Phase 4 (API-04, API-05; echo-only proven against FIT-driven payload in `test/transport/path-and-buffer.test.ts` Group 4)

### Active

<!-- Current scope. Building toward these. -->

- [ ] VeloWorld's dev/test build runs end-to-end against FakeTransport with a real FIT file — Phase 5

### Out of Scope

<!-- Explicit boundaries. Includes reasoning to prevent re-adding. -->

- BlenoTransport / real BLE advertising — deferred to v2; FakeTransport unblocks VeloWorld first
- CLI (`trainer-sim play`, `inspect`, etc.) — only meaningful with BlenoTransport, ships with v2
- Heart rate and speed FTMS fields — not needed by VeloWorld v1; add when a consumer needs them
- FIT `record` strategy decision (which parser, which fields beyond power/cadence) — deferred to research
- Bundled fixture FIT files — consumers (incl. VeloWorld) bring their own; tests use generated/minimal FIT
- Resistance affecting replayed power (grade → power scaling) — couples sim to physics; replay stays faithful
- Synthetic CSV / hand-crafted ride data — real Garmin/Wahoo FIT files only, from day one
- Workouts, UI, user management, recording from a real trainer — this is a test tool, not a product
- Windows BLE peripheral — historically unreliable; not a v1 target (FakeTransport runs anywhere Node runs)
- Sharing the FTMS codec via npm package — start with vendored copy; extract `@veloworld/ftms-codec` only when both repos feel duplication pain
- Importing VeloWorld's codec into trainer-sim — explicit non-goal (tight coupling)

## Context

- **Consumer #1 is VeloWorld.** trainer-sim succeeds when VeloWorld can swap a real BLE
  trainer for FakeTransport via env var or build flag with zero changes to ride scene or
  physics code. The shape of `ITrainerTransport` (connect/disconnect/onData/sendResistance)
  is the contract that makes this possible.
- **Open-source posture.** Kept in a separate repo (not a VeloWorld monorepo package) so it
  can be open-sourced as a developer tool for any FTMS-based cycling app. MIT license.
- **FTMS encode lives here, decode lives in VeloWorld.** Sim encodes IndoorBikeData →
  consuming app decodes. Vendoring the encoder in trainer-sim avoids a circular dependency
  and is acceptable duplication for v1.
- **Real ride data only.** Power/cadence curves from real Garmin/Wahoo FIT exports — the
  whole point of replay is realistic dynamics that hand-crafted test numbers can't capture.
- **Same-machine BLE limitation (informs v2, not v1).** A single BLE adapter can't act as
  central and peripheral simultaneously, so BLE testing later will need a second USB dongle
  or a Pi Zero W. Out of scope for v1 because v1 has no BLE.

## Constraints

- **Tech stack**: Node.js + TypeScript — VeloWorld's existing stack; FakeTransport must
  import cleanly into VeloWorld's test runner
- **License**: MIT — open-source developer tool
- **Platform**: macOS / Linux only for v1 (FakeTransport is platform-agnostic, but the v2
  BlenoTransport will be macOS/Linux because `@abandonware/bleno` only supports those)
- **Compatibility**: FakeTransport's surface must satisfy VeloWorld's `ITrainerTransport`
  interface byte-for-byte; emitted payloads must match real FTMS IndoorBikeData encoding
- **Data format**: Real Garmin/Wahoo FIT files only — no synthetic CSV, no hand-crafted JSON
- **Repo layout**: Standalone repo, not a monorepo package — independently usable and publishable

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Standalone repo, not a VeloWorld monorepo package | Lets it be open-sourced as a generic FTMS dev tool; avoids coupling release cycles | — Pending |
| Two transports from one codebase (FakeTransport + BlenoTransport) | Same FIT-replay engine, same FTMS encoder; transports just differ in delivery | — Pending |
| Fake-first delivery (v1 = FakeTransport only, v2 = BlenoTransport) | Unblocks VeloWorld dev/test immediately; BLE work has its own complexity | — Pending |
| FIT as the only ride format | Real Garmin/Wahoo exports give realistic dynamics; synthetic CSV would be a step backward | — Pending |
| Vendor the FTMS encoder inside trainer-sim for v1 | Avoids tight coupling to VeloWorld; revisit as `@veloworld/ftms-codec` when duplication hurts | — Pending |
| Power + cadence only for v1 IndoorBikeData fields | What VeloWorld v1 needs; speed/HR can be added when a consumer asks | — Pending |
| `sendResistance` is echo-only (no replay adjustment) | Keeps replay faithful to source FIT; tests can still assert resistance was called | — Pending |
| Real-time playback with configurable speed and loop/stop-at-end | Needed for both fast tests and long-soak runs; FIT timestamps drive sample cadence | Resolved — Phase 3 ships internal `Replay` class (`src/replay/`) with drift-corrected setTimeout chain via `node:timers/promises`, AbortSignal.any composition, Promise-first completion, single-subscriber. CI proxy measures 1.86ms drift over 30s; opt-in real soak gates the 250ms / 30-min REPL-03 acceptance criterion. |
| Library-only v1 (no CLI) | CLI is only useful for the BLE-peripheral mode that ships in v2 | — Pending |
| FIT parser choice deferred to research | Real fixtures + research will compare `fit-file-parser` vs `@garmin/fitsdk-javascript` better than a snap call | Resolved — `fit-file-parser` 3.0 (MIT) chosen in Phase 2 (D-FIT-08); single import wrapped behind `FitRecordSource` seam in `src/fit/loader.ts` so the swap stays a one-file change |
| No bundled fixture FIT files in v1 | VeloWorld supplies its own; tests use generated/minimal FIT | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-05-16 after Phase 4 (FakeTransport & Public API) completion — `createFakeTransport(config)` factory ships at `src/transport/fake-transport.ts` (267 LOC) composing Phase 3's `Replay`, Phase 2's loader, and Phase 1's encoder behind the canonically-defined `ITrainerTransport` contract in `src/types.ts`. Public surface adds `createFakeTransport` + 3 type aliases to `src/index.ts`. Dual ESM/CJS publish hygiene validated by `publint` + `@arethetypeswrong/cli` against the built `dist/` (115/117 tests pass — same 2 intentional opt-in skips as Phase 3). Code review caught 3 BLOCKERs in the keystone factory (CR-01 connect race; CR-02 empty-records deadlock; CR-03 unhandledRejection from throwing `'complete'` listener) — all 3 fixed inline with Group 10 regression tests; mirrors the Phase 3 BLOCKER discipline. The five v1 FakeTransport-related PROJECT requirements move to Validated; only `VeloWorld E2E` remains Active for Phase 5.*
