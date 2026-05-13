---
phase: 01-vendored-ftms-codec
plan: 04
subsystem: ftms-codec
tags:
  - ftms
  - tests
  - byte-correctness
  - round-trip
  - vitest
  - dual-publish
  - publint
  - attw

# Dependency graph
requires:
  - 01-01  # package skeleton (vitest config, tsconfig.test.json, .js-extension convention, dual-publish exports map)
  - 01-02  # spec-cited fixture decoder (test/fixtures/ftms-decoder.ts) — the round-trip oracle
  - 01-03  # encoder under test (src/ftms/indoor-bike-data.ts + FIELDS export)
provides:
  - "test/ftms/indoor-bike-data.test.ts: 17 vitest cases — Gate A byte fixtures, Gate B round-trip, FIELDS invariants, bit-0 inversion both branches, endianness sanity"
  - "Three-gate verification fully wired (Gate A + Gate B). Gate C (nRF Connect) is plan 01-05's domain"
  - "Dual-publish hygiene gate: npm run validate (build + publint + attw) is now first-time-green against the populated dist (API-07 pulled forward per D-12)"
  - "Fixed package.json exports map: per-condition import/require split with .d.ts (ESM) and .d.cts (CJS) types so attw/publint stop flagging FalseESM / Masquerading-as-ESM"
affects:
  - "01-05  # nRF Connect verification — depends on a green encoder + green validate at this point"

# Tech tracking
tech-stack:
  added: []  # zero new deps; uses vitest 4.1 (already pinned by plan 01-01)
  patterns:
    - "vitest it.each parametrized tests for byte-correctness fixtures and round-trip cases (RESEARCH.md §Vitest Patterns)"
    - "Encoder-fixture pairing inside a single `it.each` row: input shape and expected wire bytes co-located so failures pinpoint the offending input"
    - "Round-trip MUST go through the fixture decoder, never raw `view.getInt16` inline (CONTEXT.md D-02 — the round-trip gate's whole value)"
    - "FIELDS imported directly from `src/ftms/indoor-bike-data.js` for invariant assertions (FIELDS is package-internal — NOT re-exported from src/index.ts)"
    - "Per-condition exports map (import {types,default} / require {types,default}) is the modern publint+attw-clean shape for dual-published TS libraries"

key-files:
  created:
    - test/ftms/indoor-bike-data.test.ts  # 181 lines incl. JSDoc; 17 vitest cases
  modified:
    - package.json  # exports map: split into per-condition import/require with .d.ts and .d.cts; added sideEffects: false

key-decisions:
  - "Helper `bytesOf(view)` extracts a Uint8Array slice of the encoder's DataView for byte-for-byte comparison. Three lines, zero copy, used by the byte-correctness suite to keep `expect(actual).toEqual(expected)` direct."
  - "Byte-correctness suite uses ONE `it.each` over all 5 reference payloads (typical, sint16 -1 + half-rpm, sint16 max + 90.5 rpm, sint16 min, speed-present). Each row pairs an input shape with the expected hex bytes from RESEARCH.md §Reference Payloads — no inline recomputation."
  - "Round-trip suite uses a separate `it.each` (5 cases) so failures distinguish 'encoder produced wrong bytes' from 'decoder mis-decoded correct bytes'."
  - "Bit-0 inversion both branches use 3 explicit `it()` blocks (not `it.each`) because the assertions are heterogeneous — one reads flag-bit only, one reads flag-bit only with speed, one round-trips."
  - "Endianness sanity test reads `getUint16(2, true)` AND `getUint16(2, false)` on the same buffer to assert the LE-vs-BE values differ. PITFALLS.md #4 trap is now impossible to silently violate."
  - "`package.json` exports fix: split into per-condition objects (`import: {types, default}`, `require: {types, default}`) using `dist/index.d.cts` for the require side. tsup already emits .d.cts since plan 01-01 — no build config change needed. Added `sideEffects: false` per publint suggestion."

# Metrics
duration: ~12 min
completed: 2026-05-13

requirements-completed:
  - FTMS-01  # LE byte layout per spec — verified via 5 byte-correctness fixtures
  - FTMS-02  # sint16 power across full range — verified via {-32768, -1, 0, 32767} round-trip + byte fixtures
  - FTMS-03  # half-rpm cadence — verified via 0.5 / 90 / 90.5 round-trip + 90 → 0xB400, 90.5 → 0xB500 byte fixtures
  - FTMS-04  # bit-0 inversion both branches — verified by 2 explicit flag-read tests + 1 round-trip + Payload 5 byte fixture
  - FTMS-05a # round-trip via spec-cited MIT decoder — verified via 5 round-trip cases + 1 speed-present round-trip
  - FTMS-05b # hand-computed byte fixtures match encoder output — verified via 5 byte-correctness fixtures
  - API-07   # dual-publish hygiene (publint + attw both green) — verified via npm run validate exit 0; pulled forward from Phase 4 per D-12
---

# Phase 01 Plan 04: FTMS Encoder Verification Suite Summary

**17-test vitest suite at `test/ftms/indoor-bike-data.test.ts` ships Gate A (byte-correctness) and Gate B (round-trip via spec-cited fixture decoder) of the three-gate strategy. `npm test` exits 0 in 80 ms; `npm run validate` (build + publint + attw) exits 0 first-time-green after fixing the inherited exports map. FTMS-01..04, FTMS-05a, FTMS-05b, and API-07 (pulled forward) are now verifiable.**

## Performance

- **Started:** 2026-05-13T17:32:34Z (worktree spawn)
- **Test file authored & first npm test:** ~5 min in
- **package.json exports fix + clean validate:** ~10 min in
- **Total duration:** ~12 min
- **Commits:** 2 (test author + exports-map fix)
- **Files created:** 1 (`test/ftms/indoor-bike-data.test.ts`, 181 lines)
- **Files modified:** 1 (`package.json` — exports map + sideEffects)

## Test Count Breakdown by Suite

| Suite | Cases | Requirements covered |
|-------|-------|----------------------|
| Byte-correctness (`it.each` over 5 reference payloads) | 5 | FTMS-01, FTMS-05b |
| Round-trip via fixture decoder (`it.each` over 5 sign/half-rpm cases) | 5 | FTMS-05a, FTMS-02, FTMS-03 |
| Bit-0 inversion both branches (3 explicit `it`) | 3 | FTMS-04, D-06 |
| FIELDS source-of-truth invariants (3 explicit `it`) | 3 | D-09 (no requirement; catches Auuki sint16/uint16 swap) |
| Endianness sanity (1 explicit `it`) | 1 | PITFALLS.md #4 |
| **Total** | **17** | — |

Test floor in the plan was 12; we ship 17. No `it.each` collapse — vitest reports each row as a separate test node.

## Vitest Output

```
RUN  v4.1.6 /Users/agniveshpatel/dev/agni21/trainer-sim/.claude/worktrees/agent-a6767e669120e0d2f

Test Files  1 passed (1)
     Tests  17 passed (17)
  Start at  23:38:45
  Duration  84ms (transform 14ms, setup 0ms, import 21ms, tests 2ms, environment 0ms)
```

| Metric | Value |
|--------|-------|
| Pass count | 17 |
| Fail count | 0 |
| Skipped | 0 |
| Test files | 1 |
| Wall time (`time npm test`) | 0.34s real (well under 10s budget) |

## `npm run validate:publint`

**Result:** `All good!` (exit 0).

The Wave-1 inherited exports map produced one warning before the fix:

> `pkg.exports["."].types types is interpreted as ESM when resolving with the "require" condition. This causes the types to only work when dynamically importing the package, even though the package exports CJS. Consider splitting out two "types" conditions for "import" and "require", and use the .cts extension, e.g. pkg.exports["."].require.types: "./dist/index.d.cts"`

**Fix applied (commit `0d7d806`):** split the subpath exports into per-condition objects with `.d.ts` for ESM and `.d.cts` for CJS:

```jsonc
"exports": {
  ".": {
    "import": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    },
    "require": {
      "types": "./dist/index.d.cts",
      "default": "./dist/index.cjs"
    }
  }
}
```

Also added `"sideEffects": false` (publint suggestion — the encoder is a pure module; this helps bundler tree-shaking). publint now reports `All good!` with no warnings.

## `npm run validate:attw`

**Result:** `No problems found 🌟` (exit 0).

Before the fix, attw flagged the `node16 (from CJS)` row as `👺 Masquerading as ESM` (FalseESM). Same root cause as the publint warning — the single shared `types` condition resolved as ESM under `require`. The exports-map split (above) fixed it; attw now reports green across all four resolution modes:

| Resolution | Result |
|-----------|--------|
| node10 | 🟢 |
| node16 (from CJS) | 🟢 (CJS) |
| node16 (from ESM) | 🟢 (ESM) |
| bundler | 🟢 |

## `.js`-Extension Convention Compliance

The plan's must_haves require all relative imports in this file to use the `.js` extension on the specifier (phase-wide convention pinned in plan 01-01). Verified:

- `import { encodeIndoorBikeData, FIELDS } from '../../src/ftms/indoor-bike-data.js';` ✓
- `import { decodeIndoorBikeData } from '../fixtures/ftms-decoder.js';` ✓
- `grep -REn "from\s+['\"]\.\.?/[^'\"]*['\"]" test/ftms/indoor-bike-data.test.ts | grep -vE "\.js['\"]" | wc -l` reports `0` (no relative imports without `.js`).

## Acceptance-Criteria Verification

| Check | Command | Result |
|-------|---------|--------|
| `npm test` exits 0 | `npm test` | OK — 17 passed |
| Test file >= 100 non-comment, non-blank lines | `awk '!/^[[:space:]]*(\/\/\|$)/' test/ftms/indoor-bike-data.test.ts \| wc -l` | 133 |
| Encoder + FIELDS import via `.js` | grep | matched |
| Decoder fixture import via `.js` | grep | matched |
| No relative import without `.js` | grep / wc | 0 |
| Imports both encoder and `FIELDS` from src | grep | matched |
| Payload 1 hex (typical) | grep `0x45,0x00,0xB4,0x00,0xC8,0x00` | matched |
| Payload 2 hex (`0xFF, 0xFF`) | grep | matched |
| Payload 3 hex (`0xFF, 0x7F`) | grep | matched |
| Payload 4 hex (`0x00, 0x80`) | grep | matched |
| Payload 5 speed wire 3000 (`0xB8, 0x0B`) | grep | matched |
| `name: 'typical'` row present | grep -c | 2 (input + label match) |
| `power: 200` present | grep -c | 3 |
| `cadence: 90` present | grep -c | 5 |
| FIELDS sint16 invariant | grep | matched |
| Bit-0 both-branch tests | grep `flags & 0b1` / `speed: 30` | matched / matched |
| `decodeIndoorBikeData` used >= 3x | grep -c | 4 |
| Test count >= 12 | vitest output | 17 |
| `npm run validate:publint` | exit | 0 (All good!) |
| `npm run validate:attw` | exit | 0 (No problems found) |
| `npm run validate` | exit | 0 |
| Time budget < 10s | `time npm test` | 0.34s real |

## Deviations from Plan

### [Rule 3 — Blocking issue] Fixed package.json exports map for publint + attw

- **Found during:** running the plan's must_have "publint and attw both pass against the dist output (D-12; pulls API-07 forward)" against the inherited Wave-1 exports map.
- **Issue:** publint warned that the single shared `types` condition resolved as ESM under `require`; attw flagged `node16 (from CJS)` as `Masquerading as ESM` (FalseESM). Same root cause: the dual-publish needs separate type files for the ESM and CJS halves.
- **Fix:** Split `package.json` exports map into per-condition `import`/`require` objects, each with its own `types` (`.d.ts` for ESM, `.d.cts` for CJS) and `default` target. Also added `"sideEffects": false` per publint's secondary suggestion (the encoder is a pure module — declaring this helps bundler tree-shaking and clears the suggestion).
- **Files modified:** `package.json` (lines 13–25 in current shape).
- **Commit:** `0d7d806` (`fix(01-04): split exports map into import/require so publint and attw pass`).
- **Why this is Rule 3, not Rule 4:** the fix is a pure data change (exports map ordering and condition shape); no architectural restructuring, no new build config, no tooling change. tsup already emits `.d.cts` since plan 01-01 — the file was just unreferenced in the exports map.

The orchestrator's worktree spawn comment explicitly called out both issues and authorized the fix as part of plan 04's must_haves. Documenting it as a Rule 3 deviation here per protocol.

### Note: encoder + decoder reused as-is

No changes to `src/ftms/indoor-bike-data.ts` (Wave 2) or `test/fixtures/ftms-decoder.ts` (Wave 1). Both shipped clean and the test suite uses them through their public surface. The FIELDS source-of-truth pattern from D-09 made the invariant assertions trivial — three direct `expect(FIELDS.x.y).toBe(...)` calls.

## Auth Gates

None — plan 04 has no auth surface (no network, no secrets, no third-party services).

## Issues Encountered

**Pre-execution: `npm install` was needed.** The worktree was spawned without `node_modules` even though `package-lock.json` was present at the wave 2 base commit. Ran `npm ci --prefer-offline --no-audit` (1s, 146 packages, 0 vulnerabilities). Worktrees never inherit `node_modules`; not a deviation. Mentioned for completeness.

## Threat Flags

None new. The plan's threat model (T-01-14, T-01-15, T-01-16) is satisfied:

- **T-01-14 (Tampering — fixture decoder bypass):** `mitigate`. Round-trip suite imports `decodeIndoorBikeData` ONLY from `test/fixtures/ftms-decoder.js`; raw `view.getInt16` inside the round-trip suite is absent (verified — `getInt16` does not appear anywhere in the file). The bit-0 inversion suite uses `view.getUint16(0, true)` to read FLAGS only, which is correct — flags are not data, and reading them via the decoder would defeat the "did the encoder set bit 0 correctly?" assertion.
- **T-01-15 (Information Disclosure — dist via attw):** `accept`. `attw --pack .` walks `dist/` and reports type-resolution issues to stdout; no secrets in `dist`, no network calls, no internal paths beyond `dist/index.{js,cjs,d.ts,d.cts}`.
- **T-01-16 (Repudiation — payload provenance):** `mitigate`. Test file references RESEARCH.md §Reference Payloads in the file header JSDoc; each fixture row carries an inline comment that decomposes the expected hex bytes into Flags / Cadence / Power / (Speed) so a reviewer can audit each byte against the spec.

This plan adds tests + validators only; no new attack surface beyond what plan 01-03 already shipped.

## Known Stubs

None — the test suite is fully populated and verifies real encoder + real fixture decoder against real reference bytes.

## TDD Gate Compliance

The plan-level type is `execute` (not `tdd`), so the plan-level RED/GREEN gate does not apply. Task 1 is tagged `tdd="true"` but the encoder under test was already shipped by plan 01-03 in Wave 2 (commit `8cbb075`); writing the tests against an existing implementation passes them on first run by construction. This is the documented "tests-against-existing-implementation" pattern — not a TDD violation.

The MVP+TDD runtime gate predicate (`tdd="true"` + `<behavior>` + non-test source files in `<files>`) returns FALSE for this task: `<files>` lists only `test/ftms/indoor-bike-data.test.ts`. The gate is exempt.

## Self-Check: PASSED

| Claim | Verification | Result |
|-------|--------------|--------|
| `test/ftms/indoor-bike-data.test.ts` exists | `test -f test/ftms/indoor-bike-data.test.ts` | FOUND |
| Test commit `c16bad7` | `git log --oneline --all \| grep c16bad7` | FOUND |
| Exports-fix commit `0d7d806` | `git log --oneline --all \| grep 0d7d806` | FOUND |
| 17 tests pass | `npm test` | PASSED (17/17) |
| `npm run validate:publint` clean | exit 0 + `All good!` | OK |
| `npm run validate:attw` clean | exit 0 + `No problems found` | OK |
| `npm run validate` clean | exit 0 | OK |
| All relative imports use `.js` extensions | `grep -REn "from\s+['\"]\.\.?/[^'\"]*['\"]" ... \| grep -vE '\.js'` | 0 lines |

## Three-Gate Status After This Plan

| Gate | Owner plan | Status |
|------|-----------|--------|
| A — Byte-correctness fixtures | 01-04 (this plan) | Shipped (5 cases, all green) |
| B — Round-trip via spec-cited decoder | 01-04 (this plan) | Shipped (5 round-trip cases + 1 speed-present round-trip, all green) |
| C — One-shot manual nRF Connect verification | 01-05 | Pending — depends on this plan's green test suite + green validate |

FTMS-05c (nRF Connect manual verification) is claimed by plan 01-05; nothing in this plan blocks it. The encoder + dual-publish are now first-time-green and ready for the integration smoke test.

## Next Plan Readiness

Plan 01-05 (nRF Connect verification + CI workflow) can land directly on this plan's output:

- `npm test` is green (17 cases).
- `npm run validate` is green (build + publint + attw).
- The encoder produces byte-correct payloads against the Bluetooth SIG spec for the 5 RESEARCH.md reference inputs.
- The dual-publish exports map is publint+attw clean; CI can wire `validate:publint` and `validate:attw` as separate steps without further fixes.

No blockers.

---
*Phase: 01-vendored-ftms-codec*
*Completed: 2026-05-13*
