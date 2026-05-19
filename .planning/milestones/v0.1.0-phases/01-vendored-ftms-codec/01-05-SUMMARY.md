---
phase: 01-vendored-ftms-codec
plan: 05
subsystem: testing
tags:
  - ci
  - github-actions
  - nrf-connect
  - manual-verification
  - phase-gate
  - ftms

# Dependency graph
requires:
  - phase: 01-vendored-ftms-codec
    provides: "encodeIndoorBikeData() encoder (plan 03), Reference Payload byte fixtures + spec-cited round-trip decoder (plan 04 — gates A and B)"
provides:
  - "GitHub Actions CI workflow on macOS + Ubuntu, Node 24 (build → test → publint → attw)"
  - "scripts/nrf-connect-demo.ts — tsx-runnable demo that prints live encoder bytes for canonical Payloads 1 and 5"
  - "nrf-connect-verification.png — operator-captured screenshot evidencing FTMS-05c gate C closure"
  - "nrf-connect-verification.md — signed-off verification record (date, device, method, observed values)"
  - "Phase 1 done: all three FTMS-05 gates (A byte fixtures, B spec-cited round-trip, C nRF Connect) green"
affects:
  - "phase-02 (FIT replay) inherits the CI skeleton — every later phase will gate green builds on macOS + Ubuntu"
  - "phase-04 (transport) will reuse the publint + attw validation contract"
  - "v2 BLE peripheral phase will rerun a similar nRF Connect verification via BlenoTransport (Option C)"

# Tech tracking
tech-stack:
  added: []  # No new runtime deps; CI uses actions/checkout@v4 and actions/setup-node@v4 (GitHub-hosted)
  patterns:
    - "CI matrix: ubuntu-latest + macos-latest, Node 24 only (D-13), fail-fast: false so OS-specific failures surface"
    - "publint + attw run as separate CI steps so the UI shows distinct red/green per check (D-12)"
    - "Dev scripts under scripts/ run via npx tsx, import sources with .js extension per phase-wide convention (plan 01-01)"
    - "Three-gate FTMS verification (A byte fixtures + B spec-cited round-trip + C nRF Connect screenshot) — the only genuinely third-party gate is C"

key-files:
  created:
    - ".github/workflows/ci.yml"
    - "scripts/nrf-connect-demo.ts"
    - ".planning/phases/01-vendored-ftms-codec/nrf-connect-verification.png"
    - ".planning/phases/01-vendored-ftms-codec/nrf-connect-verification.md"
    - ".planning/phases/01-vendored-ftms-codec/01-05-SUMMARY.md"
  modified: []

key-decisions:
  - "CI matrix is OS-only (ubuntu + macos), not (OS × node-version). Node 24 is locked single-version per D-13/D-16; the multi-Node-version idea remains in CONTEXT.md Deferred Ideas."
  - "publint and attw are wired as separate steps, not bundled under `npm run validate`, so a regression in either shows up as a distinct red square in the GitHub Actions UI."
  - "Operator chose Method B (hex viewer / manual decode) for the nRF Connect verification — the most self-contained option that does not require a second phone or peripheral-mode advertising."

patterns-established:
  - "Pattern: dev/demo scripts live under scripts/, are run via npx tsx, and import source modules with .js extensions (matches src/ convention pinned in plan 01-01)."
  - "Pattern: CI executes the publish-hygiene tools (publint, attw) on every push, not just at release — catches exports-map regressions early."
  - "Pattern: human-verified gates are evidenced by (a) a real screenshot artifact ≥ 50 KB stored next to the phase artifacts, AND (b) a markdown sign-off record with date, device, method, and observed values."

requirements-completed:
  - FTMS-05c

# Metrics
duration: ~12min active executor work (2h 17m elapsed wall clock spanning a human-action checkpoint pause)
completed: 2026-05-14
---

# Phase 1 Plan 05: CI matrix + nRF Connect verification gate Summary

**GitHub Actions CI on macOS + Ubuntu Node 24 (build/test/publint/attw), tsx demo script printing live encoder bytes for Reference Payloads 1 and 5, and operator-captured nRF Connect screenshot closing the third (and only third-party) FTMS-05 verification gate.**

## Performance

- **Duration:** ~12 min active executor work (Tasks 1+2 sequential then a human-action checkpoint pause for screenshot capture; Task 3 was a one-shot commit on resume)
- **Started:** 2026-05-13T23:33:51+05:30 (Task 1 commit timestamp)
- **Completed:** 2026-05-14T01:50:34+05:30 (Task 3 commit timestamp)
- **Tasks:** 3
- **Files created:** 4 (+ this SUMMARY)
- **Files modified:** 0

## Accomplishments

- **CI skeleton stood up:** `.github/workflows/ci.yml` runs `npm ci → build → test → validate:publint → validate:attw` on macOS + Ubuntu Node 24, on push and pull_request to `main`, with `fail-fast: false` so a platform-specific failure on one OS does not mask a failure on the other. Phase 2 onward inherits this matrix unchanged.
- **Live encoder demo script:** `scripts/nrf-connect-demo.ts` calls `encodeIndoorBikeData()` for Reference Payload 1 (`{power:200, cadence:90}`) and Payload 5 (`{power:100, cadence:60, speed:30}`), prints the bytes computed at runtime as both space-separated hex and `Uint8Array(...)` literals (no hard-coded hex strings — the whole point is to demonstrate the live encoder), and embeds a 6-step operator procedure for nRF Connect verification (Options A/B/C).
- **Third FTMS-05 gate closed (FTMS-05c):** Operator captured a real PNG screenshot at `.planning/phases/01-vendored-ftms-codec/nrf-connect-verification.png` (245898 bytes, 1058×1104, well above the 50 KB real-screenshot floor) and signed off `nrf-connect-verification.md` recording method B (hex viewer / manual decode), observed cadence + power matching the source for both Reference Payloads, Outcome=`matched`, signed by Agnivesh Patel.
- **Phase 1 complete:** With FTMS-05c closed, the three-gate FTMS-05 verification strategy from CONTEXT.md D-03 / D-03b is fully operational. See "Three-Gate Roll-up" below.

## Task Commits

Each task was committed atomically on the `worktree-agent-ad61237b58f94d42b` branch:

1. **Task 1: GitHub Actions CI workflow** — `9f3e400` (`ci`)
   `ci(01-05): add GitHub Actions workflow for macOS + Ubuntu Node 24`

2. **Task 2: Author scripts/nrf-connect-demo.ts dev script + verification template** — `19c16f9` (`feat`)
   `feat(01-05): add nRF Connect demo script and verification template`

3. **Task 3: nRF Connect manual verification capture and sign-off** — `bcfbfe0` (`test`)
   `test(01-05): record nRF Connect manual verification (FTMS-05c)`

**Plan metadata:** committed separately as the SUMMARY commit (`docs(01-05): plan 05 SUMMARY ...`).

## Files Created/Modified

- `.github/workflows/ci.yml` — CI workflow; matrix `[ubuntu-latest, macos-latest]` × Node 24; runs `actions/checkout@v4` + `actions/setup-node@v4` + `npm ci` + `npm run build` + `npm test` + `npm run validate:publint` + `npm run validate:attw` on push/PR to `main`. `fail-fast: false` per RESEARCH.md note.
- `scripts/nrf-connect-demo.ts` — tsx-runnable demo. Imports `encodeIndoorBikeData` and the `IndoorBikeRecord` type from `../src/ftms/indoor-bike-data.js` (with `.js` extension per phase convention). Computes hex bytes for two canonical payloads at runtime, prints both alongside a 6-step nRF Connect verification procedure block. Header line includes "trainer-sim — nRF Connect verification helper" and explicitly references "FTMS-05c manual verification". No `bleno` reference (D-14 — no native deps in Phase 1).
- `.planning/phases/01-vendored-ftms-codec/nrf-connect-verification.md` — verification record with date 2026-05-14, method B, decoded values matching source for cadence + power on both Payloads 1 and 5, Outcome=`matched`, signed by Agnivesh Patel. Screenshot link points at `nrf-connect-verification.png`.
- `.planning/phases/01-vendored-ftms-codec/nrf-connect-verification.png` — 245898 bytes, PNG 1058×1104, 8-bit/color RGBA, captured by the operator showing the decoded values. Real screenshot, not a placeholder.

## Three-Gate Roll-up

Phase 1's FTMS-05 strategy required three independent gates, each catching a different failure mode:

| Gate | Built in | What it catches | Status |
| ---- | -------- | --------------- | ------ |
| A — Hand-computed byte fixtures | Plan 01-04 (encoder + decoder spec-citation suite) | Spec mis-reads (encoder produces wrong bytes for a known input) | green — automated in vitest |
| B — Spec-cited round-trip via hand-rolled MIT decoder | Plan 01-04 (`test/fixtures/ftms-decoder.ts`) | Encoder/decoder asymmetry and regressions from future field additions; D-02 mandates the decoder be authored from the spec PDF, not by inverting the encoder, so a shared mis-read has to happen in two places to slip through | green — automated in vitest |
| C — One-shot manual nRF Connect verification | Plan 01-05 (this plan, FTMS-05c) | Spec mis-reads that gates A and B both share, since both depend on us reading the spec correctly; nRF Connect reads the spec the way the BLE ecosystem does | green — operator-signed, screenshot committed |

If gate C had shown wrong values while gates A and B passed, that would have indicated a shared spec mis-read in OUR code (encoder + hand-rolled decoder), not a bug in nRF Connect — and the fix would have rewound to plan 01-03. It did not; values matched.

## Phase 1 Completion Checklist

All Phase 1 requirements from `.planning/REQUIREMENTS.md` §FTMS Codec are now claimed and evidenced on this branch:

- **FTMS-01** — Project skeleton (TypeScript strict, dual ESM/CJS, vitest) → plan 01-01
- **FTMS-02** — `IndoorBikeRecord` type + `encodeIndoorBikeData` API → plan 01-03
- **FTMS-03** — Field table as single source of truth (`FIELDS` const) → plan 01-03
- **FTMS-04** — `publint` + `attw` validation wired → plan 01-02 (defined) + this plan (CI execution)
- **FTMS-05a** — Hand-computed byte fixtures (gate A) → plan 01-04
- **FTMS-05b** — Spec-cited round-trip via hand-rolled decoder (gate B) → plan 01-04
- **FTMS-05c** — One-shot nRF Connect verification (gate C) → this plan, closed by commit `bcfbfe0`

The Phase 1 boundary is reached: byte-correct FTMS IndoorBikeData payloads, gated on a third-party-decoder round-trip beyond just internal byte assertions, with the project skeleton in place. Phase 2 (FIT replay) can begin against this stable encoder + CI.

## Decisions Made

- **Verification method choice (Task 3):** Operator chose Method B (hex viewer / manual decode in nRF Connect) over Method A (Advertiser-mode peripheral) for self-containment — Method B does not require a second phone or peripheral-mode capability and produces an equally evidenced screenshot. Method C (real BLE peripheral over a radio) remains out of scope for v1 per D-14; v2 BlenoTransport will exercise that path.
- **Ordering note:** Followed plan as specified for Tasks 1 and 2 (CI workflow, demo script). No structural deviations.

## Deviations from Plan

None — plan executed exactly as written.

### Note (not a deviation): screenshot filename rename

The orchestrator renamed the operator's originally-saved file `manual-verification.png` to `nrf-connect-verification.png` to match the plan's `must_haves` artifact path (`at .planning/phases/01-vendored-ftms-codec/nrf-connect-verification.png`) and updated the Markdown's "Screenshot" link in the same step. This is a path normalization to honor a path the plan explicitly asserts on, not a Rule 3 (blocking-issue) deviation — there is no scope or behavior change, only a filename consistency fix. The verification record markdown contains zero references to `manual-verification.png` and exactly one screenshot link pointing at `nrf-connect-verification.png` (relative path `./nrf-connect-verification.png`).

## Issues Encountered

None.

## User Setup Required

None — no external services, no environment variables. The CI workflow uses only GitHub-hosted runners and standard `actions/*` actions.

The first push of `.github/workflows/ci.yml` to GitHub will trigger the matrix run; CI confirmation is naturally a one-time manual gate the next time the branch is pushed.

## Next Phase Readiness

- **Phase 2 (FIT replay):** unblocked. The encoder is stable and triple-gated; the CI skeleton runs build/test/validate on every push/PR. Phase 2 only needs to add new test files and source files; no skeleton work.
- **v2 (BLE peripheral via `@stoprocent/bleno`):** still gated on Phase 4 transport interface. The nRF Connect verification approach can be reused — Method C (Advertiser via real radio) replaces Method B (hex viewer) once a peripheral is available.
- **Open follow-ups:** none from this plan. Plan 04's SUMMARY is not yet committed on this branch, but plan 04's PLAN exists and its acceptance criteria are inherited as gates A and B per the three-gate roll-up. The orchestrator is responsible for state and roadmap reconciliation post-merge.

## Self-Check: PASSED

**Files:**
- `.github/workflows/ci.yml` — FOUND
- `scripts/nrf-connect-demo.ts` — FOUND
- `.planning/phases/01-vendored-ftms-codec/nrf-connect-verification.png` — FOUND (245898 bytes)
- `.planning/phases/01-vendored-ftms-codec/nrf-connect-verification.md` — FOUND
- `.planning/phases/01-vendored-ftms-codec/01-05-SUMMARY.md` — FOUND (this file)

**Commits (worktree-agent-ad61237b58f94d42b):**
- `9f3e400` — FOUND (Task 1: CI workflow)
- `19c16f9` — FOUND (Task 2: demo script + verification template)
- `bcfbfe0` — FOUND (Task 3: nRF Connect verification capture + sign-off)

**Acceptance criteria for Task 3 (all 7 green):**
1. PNG exists — yes
2. PNG ≥ 50 KB — yes (245898 bytes, 4.8× threshold)
3. PNG is real PNG — yes (`PNG image data, 1058 x 1104, 8-bit/color RGBA, non-interlaced`)
4. Zero `__REPLACE` placeholders in MD — yes (count=0)
5. Outcome = `matched` — yes
6. Sign-off filled — yes (`Verified by `Agnivesh Patel``)
7. Screenshot link references `nrf-connect-verification.png` (not `manual-verification.png`) — yes (zero references to the old name)

**Plan-defined automated `<verify>` block reproduced:**
- 2026 date present — yes
- "cadence" mentioned — yes
- "power" mentioned — yes
- "matched"|"verified" mentioned — yes

---

*Phase: 01-vendored-ftms-codec*
*Completed: 2026-05-14*
