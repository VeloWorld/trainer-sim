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
- [x] VeloWorld's dev/test build runs end-to-end against FakeTransport with a real FIT file — validated in Phase 5 via the cross-repo PR cycle: VW PR https://github.com/VeloWorld/veloworld-ride/pull/19 merged at `ba87fee`; both `ci (ubuntu-latest)` and `ci (macos-latest)` jobs SUCCESS on Node 24 against trainer-sim sha `8fac5dd`; 5-item D-VW-09 acceptance bundle in `.planning/phases/05-veloworld-end-to-end-validation/05-VERIFICATION.md`

### Active

<!-- Current scope. Building toward these. -->

- (none — all v1 requirements validated; ready to ship)

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

### Current state (after v0.1.0 close, 2026-05-20)

- **Shipped:** v0.1.0 published as annotated tag + GitHub release; consumed by VeloWorld via git-ref pin (`github:VeloWorld/trainer-sim#v0.1.0`). VW PR #19 squash-merged at `ba87fee` with green CI on `ubuntu-latest` and `macos-latest` (Node 24).
- **Codebase:** ~2,100 LOC TypeScript in `src/`, ~4,370 LOC in `test/`. Stack: TypeScript 5.9 strict, Node 24 (`engines: ">=24.0"`), tsup 8.5 dual ESM+CJS build (Node + browser variants), vitest 4.1, `fit-file-parser` 3.0.
- **Public surface:** `createFakeTransport`, `ITrainerTransport`, `FakeTransport`, `FakeTransportConfig`, `FakeTransportSource`, `RideRecord`, `FitLoadError` hierarchy, `encodeIndoorBikeData`. Dual-publish validated by `publint` + `@arethetypeswrong/cli`.
- **Tech debt carried forward:** 16 advisory items (Phase 2: 5; Phase 3: 6+4 info; Phase 5: 5) — none blocking; queued for v1.x. See `.planning/milestones/v0.1.0-MILESTONE-AUDIT.md` for the full list.

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
| Standalone repo, not a VeloWorld monorepo package | Lets it be open-sourced as a generic FTMS dev tool; avoids coupling release cycles | ✓ Good — VW consumes via git-ref pin (`github:VeloWorld/trainer-sim#v0.1.0`); PR #19 merged with no monorepo coupling |
| Two transports from one codebase (FakeTransport + BlenoTransport) | Same FIT-replay engine, same FTMS encoder; transports just differ in delivery | — Pending (v2; only FakeTransport ships in v0.1.0) |
| Fake-first delivery (v1 = FakeTransport only, v2 = BlenoTransport) | Unblocks VeloWorld dev/test immediately; BLE work has its own complexity | ✓ Good — v0.1.0 unblocked VW dev/test on macOS+Linux Node 24 with no BLE work |
| FIT as the only ride format | Real Garmin/Wahoo exports give realistic dynamics; synthetic CSV would be a step backward | ✓ Good — Phase 2 corpus is 6 scrubbed real Garmin/Zwift/Wahoo files + 1 hand-rolled shadow.fit; no synthetic CSV needed |
| Vendor the FTMS encoder inside trainer-sim for v1 | Avoids tight coupling to VeloWorld; revisit as `@veloworld/ftms-codec` when duplication hurts | ✓ Good — `src/ftms/indoor-bike-data.ts` vendored; v0.1.0 ships independently of VW codec |
| Power + cadence only for v1 IndoorBikeData fields | What VeloWorld v1 needs; speed/HR can be added when a consumer asks | ✓ Good — VW PR #19 confirms power+cadence sufficient; FTMS-06/07 stay v2 |
| `sendResistance` is echo-only (no replay adjustment) | Keeps replay faithful to source FIT; tests can still assert resistance was called | ✓ Good — API-04 test in `test/transport/path-and-buffer.test.ts` Group 4 proves echo-only against FIT-driven payload |
| Real-time playback with configurable speed and loop/stop-at-end | Needed for both fast tests and long-soak runs; FIT timestamps drive sample cadence | ✓ Good — Phase 3 `Replay` class with drift-corrected `node:timers/promises` chain, AbortSignal.any, Promise-first completion. CI proxy 1.86ms drift over 30s; opt-in real soak passes the 250ms/30-min REPL-03 gate |
| Library-only v1 (no CLI) | CLI is only useful for the BLE-peripheral mode that ships in v2 | ✓ Good — no CLI in v0.1.0; consumer (VW) imports the factory directly |
| FIT parser choice deferred to research | Real fixtures + research will compare `fit-file-parser` vs `@garmin/fitsdk-javascript` better than a snap call | ✓ Good — `fit-file-parser` 3.0 (MIT) chosen in Phase 2 (D-FIT-08); single import behind `FitRecordSource` seam in `src/fit/loader.ts` so swap stays a one-file change |
| No bundled fixture FIT files in v1 | VeloWorld supplies its own; tests use generated/minimal FIT | ✓ Good — VW ships its own fixtures; trainer-sim ships only test-internal `basic.fit`, no end-user-facing bundle |
| Browser/renderer support via `_internal/*` shim layer (Phase 5 add) | VW's Vite-bundled Electron renderer needs a browser-safe variant of `debuglog`/`EventEmitter`/`sleep`/`readFile` | ✓ Good — dual Node + browser tsup builds via `"browser"` exports condition; CI green on both targets |
| Encoder migrated from `Buffer` to `DataView` (Phase 5 add) | Browser bundle can't import `node:buffer`; wire format byte-identical to `Buffer` | ✓ Good — VW test #5 round-trips DataView through VW's `parseIndoorBikeData` and reads equal power/cadence |
| Commit `dist/` to git (Phase 5 add) | git-ref consumers (VW) need a built artifact at the pinned sha; no npm publish in v0.1.0 | ⚠️ Revisit — staleness risk (Phase 5 tech debt: `dist/` tracked introduces drift if developer rebuilds without committing). Reassess at v2 / npm-publish boundary |

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
*Last updated: 2026-05-20 after v0.1.0 milestone close — all 29 v1 requirements validated, all 5 phases passed verification, audit passed (`.planning/milestones/v0.1.0-MILESTONE-AUDIT.md`). Released as `v0.1.0` (annotated tag + GitHub release, commit `524aeab`). Consumed downstream by VeloWorld at `github:VeloWorld/trainer-sim#v0.1.0`.*

*Previous: 2026-05-19 after Phase 5 (VeloWorld End-to-End Validation) completion — v1 acceptance gate satisfied. VW PR #19 (https://github.com/VeloWorld/veloworld-ride/pull/19) squash-merged at `ba87fee` with both `ci (ubuntu-latest)` and `ci (macos-latest)` jobs SUCCESS on Node 24, against trainer-sim sha `8fac5dd`. Phase 5 evolved trainer-sim's build infrastructure across 4 Wave-0.x revisions (D-VW-10 path) to satisfy VeloWorld's Vite-bundled Electron renderer: dual Node + browser `tsup` builds via `"browser"` exports condition, `_internal/*` shim layer (debuglog/EventEmitter/sleep/readFile, each with `.ts` Node + `.browser.ts` browser variants), encoder migrated from Buffer to DataView (wire format byte-identical), and `dist/` committed to track for git-ref consumers. trainer-sim's `ITrainerTransport` contract did NOT widen during iteration — only narrowing changes (`FakeTransportSource.buffer` to `Uint8Array`). VW's 9-method ITrainerTransport stayed VW-owned per Anti-Pattern 6. All 115 trainer-sim tests pass; publint + attw all green.*
