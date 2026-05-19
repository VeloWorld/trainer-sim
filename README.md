# trainer-sim

![CI](https://github.com/VeloWorld/trainer-sim/actions/workflows/ci.yml/badge.svg)

Simulate a BLE FTMS smart trainer by replaying pre-recorded FIT files.
Use it to test cycling apps (VeloWorld, Zwift, TrainerRoad) without hardware.

A standalone Node.js library that impersonates a BLE FTMS smart trainer by replaying
pre-recorded FIT files. A cycling app developer can run their app end-to-end against
a realistic trainer signal — no hardware, no BLE, no flaky integration loop — by
importing one library and pointing it at a real Garmin/Wahoo FIT file.

## Two modes
- **FakeTransport** — in-process library, no BLE. Import into tests.
- **BLE peripheral** — advertises as real FTMS trainer (macOS/Linux).

## Status

Status: v0.1.0 — first milestone (FakeTransport path; BLE peripheral deferred to v2).

## Install

trainer-sim is consumed by git-ref (no npm publish yet). Pin to the v0.1.0 tag:

```
npm install github:VeloWorld/trainer-sim#v0.1.0
```

## What's shipped in v0.1.0

- **Phase 1** — Vendored FTMS IndoorBikeData encoder (`encodeIndoorBikeData`, `IndoorBikeRecord`) verified against a third-party decoder and an nRF Connect manual gate.
- **Phase 2** — FIT loader + normalization (`loadFitFromPath`, `loadFitFromBuffer`, `RideRecord`) with a typed `FitLoadError` hierarchy.
- **Phase 3** — Drift-corrected replay engine (`Replay` with `speed`, `loop`, `maxEmissionHz`, `AbortController` cancellation, awaitable `completed`).
- **Phase 4** — `createFakeTransport(config)` public API and `ITrainerTransport` contract; dual ESM/CJS publish via tsup; publint + attw clean; CI on macOS + Ubuntu, Node 24.
- **Phase 5** — VeloWorld end-to-end validation green on macOS + Linux; v1 surface proven against a real consumer.

See [CHANGELOG.md](./CHANGELOG.md) for the full release notes.

See [.planning/ROADMAP.md](./.planning/ROADMAP.md) for the milestone plan.
