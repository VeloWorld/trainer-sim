# Roadmap: trainer-sim

## Overview

trainer-sim is built bottom-up along a strictly linear dependency chain: a vendored
FTMS encoder is the foundation (its byte-level traps are silent and downstream-fatal),
the FIT loader normalizes real Garmin/Wahoo exports into a clean record stream, the
replay engine drives those records through a drift-corrected scheduler, the
FakeTransport wraps the engine in the public `ITrainerTransport` contract, and the v1
ships only when VeloWorld's existing decoder consumes a real FIT replay end-to-end on
both macOS and Linux.

## Milestones

- ✅ **v0.1.0 — FakeTransport MVP** — Phases 1-5 (shipped 2026-05-19). See [milestones/v0.1.0-ROADMAP.md](./milestones/v0.1.0-ROADMAP.md).

## Phases

<details>
<summary>✅ v0.1.0 FakeTransport MVP (Phases 1-5) — SHIPPED 2026-05-19</summary>

- [x] Phase 1: Vendored FTMS Codec (5/5 plans) — completed 2026-05-14
- [x] Phase 2: FIT Loader & Normalization (5/5 plans) — completed 2026-05-16
- [x] Phase 3: Replay Engine (4/4 plans) — completed 2026-05-16
- [x] Phase 4: FakeTransport & Public API (6/6 plans) — completed 2026-05-16
- [x] Phase 5: VeloWorld End-to-End Validation (4/4 plans) — completed 2026-05-19

Full phase details archived to [milestones/v0.1.0-ROADMAP.md](./milestones/v0.1.0-ROADMAP.md).

</details>

### 📋 Next Milestone (Planned)

Run `/gsd-new-milestone` to define the next milestone (questioning → research → requirements → roadmap).

## Progress

| Phase | Milestone | Plans Complete | Status   | Completed  |
|-------|-----------|----------------|----------|------------|
| 1. Vendored FTMS Codec | v0.1.0 | 5/5 | Complete | 2026-05-14 |
| 2. FIT Loader & Normalization | v0.1.0 | 5/5 | Complete | 2026-05-16 |
| 3. Replay Engine | v0.1.0 | 4/4 | Complete | 2026-05-16 |
| 4. FakeTransport & Public API | v0.1.0 | 6/6 | Complete | 2026-05-16 |
| 5. VeloWorld End-to-End Validation | v0.1.0 | 4/4 | Complete | 2026-05-19 |
