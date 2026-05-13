# trainer-sim

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

Status: Phase 1 in progress.

See [.planning/ROADMAP.md](./.planning/ROADMAP.md) for the milestone plan.
