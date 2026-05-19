# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-05-19

First milestone release. Phases 01–05 are complete; Phase 05's VeloWorld
end-to-end validation makes the v1 surface real-world proven.

### Added

- **Phase 1 — Vendored FTMS IndoorBikeData encoder.** `encodeIndoorBikeData` and
  the `IndoorBikeRecord` type are exported from the package root. Encoding is
  spec-cited against the Bluetooth SIG GATT Specification Supplement (FTMS 1.0)
  and gated by a three-gate verification: byte fixtures, encode/decode
  round-trip against an MIT-licensed third-party decoder, and a manual
  nRF Connect inspection on a real central.
- **Phase 2 — FIT loader and normalization.** `loadFitFromPath` and
  `loadFitFromBuffer` produce a normalized `RideRecord` stream. A typed
  `FitLoadError` hierarchy with four concrete subclasses
  (`InvalidFitHeaderError`, `FitTruncatedError`, `FitCrcError`,
  `NoRecordMessagesError`) makes failure modes diagnosable. `fit-file-parser`
  ~3.0.0 (MIT) is the parser, hidden behind a `FitRecordSource` seam in
  `src/fit/loader.ts`. Header and CRC validation live in the loader.
- **Phase 3 — Drift-corrected replay engine.** `Replay` exposes `start`,
  configurable `speed`, `loop`, and `maxEmissionHz`, `AbortController`-based
  cancellation, and an awaitable `completed` promise. The scheduler is a
  drift-corrected `setTimeout` chain over `node:timers/promises` with
  `AbortSignal.any` composition; replays are single-use.
- **Phase 4 — Public API and dual ESM/CJS publish.** `createFakeTransport(config)`
  factory plus the `ITrainerTransport` public contract. The package
  dual-publishes ESM and CJS via `tsup`, ships `.d.ts` and `.d.cts` types, and
  is `publint`- and `@arethetypeswrong/cli`-clean. CI runs on macOS and Ubuntu
  on Node 24.
- **Phase 5 — VeloWorld end-to-end validation.** Library is consumed by
  VeloWorld via git-ref and exercised end-to-end on macOS and Linux. The v1
  surface is proven against a real consumer.

[Unreleased]: https://github.com/VeloWorld/trainer-sim/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/VeloWorld/trainer-sim/releases/tag/v0.1.0
