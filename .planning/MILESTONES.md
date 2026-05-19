# Milestones

## v0.1.0 — FakeTransport MVP (Shipped: 2026-05-19)

**Delivered:** A standalone Node.js + TypeScript library that impersonates a BLE FTMS smart trainer in-process by replaying real Garmin/Wahoo FIT files through a `createFakeTransport` factory. VeloWorld's dev/test build runs end-to-end against it on macOS + Linux with no consumer-side code changes.

**Stats:** 5 phases · 24 plans · 36 tasks · 29/29 v1 requirements satisfied · all 5 phases passed independent goal-backward verification.

**Key accomplishments:**

- **Vendored FTMS IndoorBikeData encoder** — byte-correct little-endian DataView output, gated by three independent checks: spec-cited hand-rolled MIT decoder round-trip, hand-computed byte fixtures, and one-shot nRF Connect manual verification. (Phase 1)
- **FIT loader and normalization** — `fit-file-parser` 3.0 (MIT) wrapped behind a `FitRecordSource` seam; typed `FitLoadError` hierarchy; real Garmin/Wahoo files with autopause, sparse smart-recording, null power, and TrainerRoad developer-field shadows all load without throwing. (Phase 2)
- **Drift-corrected replay engine** — internal `Replay` class over a `runScheduler` setTimeout chain via `node:timers/promises`; `AbortSignal.any` composition; configurable `speed` multiplier with max-emission-rate cap; opt-in 30-min soak verifies REPL-03 (250 ms drift bound). (Phase 3)
- **Public `createFakeTransport` factory + dual ESM/CJS publish** — `ITrainerTransport`-shaped API with `connect`/`disconnect`/`onData`/`sendResistance`/`reset`; `publint` + `@arethetypeswrong/cli` clean; importable into strict-mode TypeScript Node 24 with no `@types/*` shim. (Phase 4)
- **VeloWorld E2E integration** — VW PR #19 squash-merged at `ba87fee` with green CI on `ubuntu-latest` and `macos-latest` (Node 24); VW's `ITrainerTransport` consumer code byte-identical, no widening of trainer-sim's contract; Vite-bundled Electron renderer support added via dual Node + browser `tsup` builds with `_internal/*` shim layer. (Phase 5)
- **Released as v0.1.0** — `chore(release): v0.1.0` (commit `524aeab`), annotated tag `v0.1.0` pushed, GitHub release published, `CHANGELOG.md` (Keep a Changelog 1.1.0) authored.

**Tech debt (deferred to v1.x):**

- Phase 2: signed-shift on dataLength (≥2GB), timestamp-less record drop, parser callback err+data both, CRC-16/ARC table duplicated across 3 files.
- Phase 3: scheduler observability bias, async `currentState` transition undocumented, `Replay.start()` doesn't validate `speed`/`maxEmissionHz` finiteness.
- Phase 5: encoder DataView overflow guard absent, EventEmitter once/off contract not asserted, `tsup` cwd fragility, `dist/` tracked in git introduces staleness risk, asymmetric `clean` script.

**Known deferred items at close:** 0 (audit-open scanner reported a stale false-positive on quick task `260519-ub8`; SUMMARY.md is in fact present at `.planning/quick/260519-ub8-bump-version-to-0-1-0-update-readme-crea/260519-ub8-SUMMARY.md`).

**Archives:**
- Roadmap: `.planning/milestones/v0.1.0-ROADMAP.md`
- Requirements: `.planning/milestones/v0.1.0-REQUIREMENTS.md`
- Audit: `.planning/milestones/v0.1.0-MILESTONE-AUDIT.md`

---
