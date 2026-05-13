# Phase 1: Vendored FTMS Codec - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-13
**Phase:** 1-vendored-ftms-codec
**Areas discussed:** Third-party decoder harness, Speed-field encoding strategy, Encoder API shape, Project bootstrap scope, Node engines floor

---

## Third-Party Decoder Harness (FTMS-05 gate)

| Option | Description | Selected |
|--------|-------------|----------|
| Auuki JS, in-process | MIT-licensed pure-JS reference; round-trip is a vitest unit-test assertion, runs unmodified in CI | ✓ |
| PyFTMS, via Python subprocess | Apache-2.0; strictest spec-compliant decoder; adds Python toolchain to CI | |
| nRF Connect mobile, manual | Highest fidelity but moves the gate out of automation | |
| Both Auuki AND PyFTMS in CI | Two decoders agree = strongest gate; ~2x cost; no current evidence of need | |

**User's choice:** Auuki JS, in-process (recommended).
**Notes:** Auuki itself encodes power as `Uint16` (PITFALLS.md #2) — that bug is in Auuki's encode path; we read its decode path, where it's correct. Open implementation question (vendor copy vs git submodule vs `npm install` from GitHub) deferred to research/planning. Recommended path is a vendored copy with pinned commit + provenance README.

---

## Speed-Field Encoding Strategy (bit-0 inversion)

| Option | Description | Selected |
|--------|-------------|----------|
| Build optional-speed correctly from day 1 | Encoder accepts `speed?`; bit-0 = `speed === undefined ? 1 : 0`. PITFALLS.md #1's recommendation | ✓ |
| Hard-code bit-0 = 1 always | Simpler v1; encoder is wrong the day someone adds speed | |
| Encoder rejects speed input entirely | Type forbids speed; v2 needs a new file; loses one-line directory move to `@veloworld/ftms-codec` | |

**User's choice:** Build optional-speed correctly from day 1 (recommended).
**Notes:** Round-trip tests cover both branches of the inversion even though v1 production code never emits speed — the inversion has no other automated check that catches the trap.

---

## Encoder API Shape

| Option | Description | Selected |
|--------|-------------|----------|
| Pure function `encodeIndoorBikeData(record): DataView` | Matches research/ARCHITECTURE.md; stateless; literal directory move to `@veloworld/ftms-codec` later | ✓ |
| Class `FtmsEncoder` with config | Room for buffer pool, resolution overrides; adds state and lifecycle for v1 | |
| Factory `createFtmsEncoder(opts?)` returning a closure | Mirrors `createFakeTransport`; one indirection; v1 has no config to pass | |

**User's choice:** Pure function (recommended).
**Notes:** No buffer pool. New `Buffer`/`ArrayBuffer` per call; adequate for 1 Hz emission. Internal `FIELDS` const is the single source of truth; tests assert directly against it.

---

## Project Bootstrap Scope

| Option | Description | Selected |
|--------|-------------|----------|
| Minimal: encoder + vitest + tsconfig only | Phase 1 stays focused; defer tsup/publint/attw to Phase 4 | |
| Full skeleton now | Stand up everything in Phase 1: tsup, dual ESM/CJS exports, publint, attw | ✓ |
| Encoder-only, build later | Skip package.json — too minimal, vitest needs it | |

**User's choice:** Full skeleton now.
**Notes:** Pulls API-07 (publint + attw) forward from Phase 4. Phase 4 will *verify* the publish hygiene rather than build it. Phase 1's plan size grows accordingly. ESLint setup is still deferred to Phase 4 unless lint-blocking patterns emerge.

---

## Node Engines Floor

| Option | Description | Selected |
|--------|-------------|----------|
| Node 22 LTS (`>=22.12`) — VeloWorld parity | research/STACK.md's pick; matches VeloWorld's stack | |
| Node 24 LTS (`>=24.0`) | Latest LTS; pre-empts a future "two LTS behind" question | ✓ |
| Open: `>=22.12` and matrix-test 22 + 24 in CI | Catches consumer-version regressions; ~2x CI minutes | |

**User's choice:** Node 24 LTS.
**Notes:** Overrides STACK.md's earlier Node 22 recommendation. PROJECT.md update for Node 24 + `@stoprocent/bleno` (the latter already pending) handled at next `/gsd-transition`. CI matrix re-evaluation deferred until VeloWorld's actual Node version is confirmed in Phase 5.

---

## Claude's Discretion

- File-level layout inside `src/ftms/` (single file vs split `fields.ts` / `encode.ts`).
- Vitest test file location convention (`*.test.ts` next to source vs `__tests__/`).
- Internal helper names (`writeU16LE`, `MORE_DATA_BIT`, etc.).

## Deferred Ideas

- Node 22 + 24 CI matrix — defer to Phase 5 if VeloWorld is on Node 22.
- Buffer pool / pre-allocation in encoder — v2 concern (PITFALLS.md performance #2).
- Second decoder (PyFTMS) in CI alongside Auuki — revisit if Auuki produces a false positive.
- Lint-ban on raw `DataView.setUint16` — avoided by using `Buffer.write*LE`; revisit if encoder ever uses raw `DataView` writes.
- PROJECT.md update for `@stoprocent/bleno` and Node 24 floor — handle at next `/gsd-transition`.
