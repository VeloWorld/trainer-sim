---
phase: 01-vendored-ftms-codec
plan: 02
subsystem: ftms-codec
tags:
  - ftms
  - decoder
  - test-fixture
  - spec-cited
  - mit-license
requires: []
provides:
  - "test/fixtures/ftms-decoder.ts: spec-cited MIT FTMS IndoorBikeData decoder used by plan 04 as the round-trip oracle"
  - "test/fixtures/README.md: provenance + Auuki AGPL rejection rationale"
affects:
  - "plan 04 (round-trip semantic gate FTMS-05a) — depends on this fixture"
tech-stack:
  added: []
  patterns:
    - "Spec-cited fixture pattern: decoder authored line-by-line from FTMS v1.0.1 §4.9 with citations in source comments (independence-by-construction per CONTEXT.md D-02)"
    - "PITFALLS.md citations inline in source: each field decision (type, resolution, inversion) tagged with the matching PITFALLS.md item so a future spec mis-read review is one grep away"
key-files:
  created:
    - "test/fixtures/ftms-decoder.ts"
    - "test/fixtures/README.md"
  modified: []
decisions:
  - "Implemented bit-0 inversion as `(flags & (1 << SPEED_BIT)) === 0` (preferred form); comment names the equivalent `((flags >> SPEED_BIT) & 1) === 0` so reviewers don't mistake the `=== 0` for a bug"
  - "Decoder is fully standalone (zero imports) — guarantees independence from the not-yet-written src/ftms/indoor-bike-data.ts encoder"
  - "Required-fields check throws on missing cadence/power rather than returning a partial DecodedIndoorBike — surfaces a missing flag bit as a hard failure for the round-trip gate, not silent NaN coercion"
metrics:
  duration_minutes: 7
  completed: "2026-05-13"
  tasks_completed: 1
  files_changed: 2
  lines_added: 176
---

# Phase 01 Plan 02: Spec-Cited FTMS Decoder Fixture Summary

Authored a MIT-licensed, spec-cited FTMS IndoorBikeData decoder at
`test/fixtures/ftms-decoder.ts` derived directly from Bluetooth SIG FTMS
v1.0.1 §4.9 — the round-trip oracle that plan 04 will use to deliver
FTMS-05a. This plan does NOT itself claim FTMS-05a; it produces the
spec-cited oracle that makes the gate trustworthy.

## Independence (CONTEXT.md D-02)

The decoder MUST be authored from the spec, not by inverting the encoder, or
the round-trip gate degrades to a self-consistency check. Independence is
verified three ways:

1. **Temporal independence:** Plan 02 ran in Wave 1 in parallel with
   plan 01-01 (the project skeleton). The encoder lands in Wave 2 plan 03.
   At write time, `src/ftms/indoor-bike-data.ts` did not exist in the
   repository on any branch this worktree could see — the file could not be
   inverted because the file did not exist.
2. **Static independence:** `grep -c "from.*src/ftms" test/fixtures/ftms-decoder.ts`
   reports 0. The decoder has zero imports of any kind (verified with
   `grep -E '^import |^from '`); it stands fully alone.
3. **Provenance documentation:** `test/fixtures/README.md` records that this
   fixture was authored from the FTMS v1.0.1 spec and that any future PR
   rewriting it by reading the encoder violates D-02.

## Four PITFALLS.md Traps Addressed

| # | Trap | Decoder handling | Source line citation |
|---|------|------------------|----------------------|
| 1 | Bit 0 ("More Data") is INVERTED — speed PRESENT when bit == 0 | `const speedPresent = (flags & (1 << SPEED_BIT)) === 0;` (the `=== 0` is load-bearing); comment names the equivalent `((flags >> SPEED_BIT) & 1) === 0` form | `// FTMS §4.9: bit 0 'More Data' — INVERTED ... PITFALLS.md #1.` |
| 2 | Auuki's `Uint16` power is the bug we MUST NOT replicate; spec says sint16 | `power = view.getInt16(offset, true);` (signed 16-bit, LE) | `// PITFALLS.md #2: Auuki encodes power as Uint16 — that is the spec violation we MUST NOT replicate.` |
| 3 | Cadence is uint16 with 0.5 rpm resolution; wire = rpm × 2 | `cadence = view.getUint16(offset, true) * 0.5;` | `// FTMS §4.9: Instantaneous Cadence = uint16, resolution 0.5 rpm. ... PITFALLS.md #3` |
| 4 | DataView defaults to BIG-endian; LE flag must be explicit | Every multi-byte read passes `true` as the second arg (5 occurrences in source: 1 in flags read, 1 each in the speed/cadence/power branches, plus 1 in the file's prelude comment showing the canonical pattern). `grep -nE 'get(Int16\|Uint16)\([^)]*\)' \| grep -v 'true)'` reports 0 non-LE getter calls. | `// PITFALLS.md #4: DataView defaults to BIG-endian; the second 'true' arg is the little-endian flag and is mandatory ...` |

A spec field-order anchor comment is also present (`// FTMS §4.9.1
field-order: Flags -> Speed -> Cadence -> Power`) so a future refactor that
quietly reorders the field reads can be caught by a static grep.

## Auuki Rejection (CONTEXT.md D-03c)

Auuki's `src/ble/ftms/indoor-bike-data.js` is **AGPL-3.0** (verified via
GitHub API `license.spdx_id == 'AGPL-3.0'`). Vendoring or submoduling it
into this MIT repo would force the entire repo to AGPL or a compatibility
review. PyFTMS (`dudanov/python-pyftms`, Apache-2.0) is spec-compliant but
Python and out of scope per D-01 (in-process JS only).

`test/fixtures/README.md` documents this explicitly. The "What NOT to add
here" section makes the prohibition discoverable for future contributors.

## Acceptance-Criteria Verification

| Check | Command | Result |
|-------|---------|--------|
| Exports `decodeIndoorBikeData` | `grep -c '^export function decodeIndoorBikeData' test/fixtures/ftms-decoder.ts` | 1 |
| Exports `DecodedIndoorBike` interface | `grep -c '^export interface DecodedIndoorBike' test/fixtures/ftms-decoder.ts` | 1 |
| Bit-0 inversion present | acceptance regex | 2 matches (preferred form + comment form) |
| Power decoded as sint16 | `grep -E 'getInt16\(' ...` | matched |
| LE flag on every multi-byte read | `grep -E 'get(Int16\|Uint16)\([^,]+, *true\)' ... \| wc -l` | 5 |
| No non-LE getter calls | `grep -nE 'get(Int16\|Uint16)\([^)]*\)' ... \| grep -v 'true)' \| grep -v '^\s*//' \| wc -l` | 0 |
| No `src/ftms` imports | `grep -c "from.*src/ftms" ...` | 0 |
| No Auuki uint16-power pattern | `grep -nE 'getUint16\([^)]*\)\s*(\*\|;\|/\/)' ... \| grep -i power \| wc -l` | 0 |
| Spec citation present | `grep -E '§4\.9\|FTMS.*1\.0\.1\|Indoor Bike Data' ...` | matched |
| INVERTED / More Data / PITFALLS comment | `grep -E 'INVERTED\|More Data\|PITFALLS' ...` | matched |
| Field-order anchor present | `grep -F 'FTMS §4.9.1 field-order: Flags -> Speed -> Cadence -> Power' ...` | matched |
| Speed reference precedes cadence reference | line-number test | speed@19 < cadence@43 — OK |
| README contains "MIT" | `grep MIT test/fixtures/README.md` | matched |
| README contains "AGPL" | `grep AGPL test/fixtures/README.md` | matched |

## TypeScript Project-Mode Strict Check (`npm run typecheck:test`)

**Not run in this worktree** — and that is intentional and per protocol.

Plan 02 ran in Wave 1 **in parallel** with plan 01-01 (the project
skeleton). The orchestrator's worktree-spawn comment was explicit:

> "Plan 01-01 (skeleton) is running in parallel. Your worktree is forked
> from the same base commit, so package.json/tsconfig.json/vitest.config.ts
> will not exist in your working tree yet. ... do not attempt to run vitest
> or tsc against your worktree."

The acceptance criterion `npm run typecheck:test` exits 0 will be exercised
**post-merge** when plans 01 and 02 land together on the integration branch
and the wave's verifier runs the full type-check across the merged tree.
The decoder file itself is small (~125 lines), uses only built-in types
(`DataView`, `number`), and exports a typed `interface` + `function`
signature — there are no exotic syntax features that would fail strict
mode. If the post-merge typecheck flags anything, it will be a workspace
configuration issue (e.g., `tsconfig.test.json` not yet including
`test/**`) rather than a decoder defect, and the fix lives in plan 01.

## Round-Trip Gate (FTMS-05a) — NOT delivered here

Plan 02 only authors the oracle. FTMS-05a — "Encoded payloads round-trip
cleanly through a spec-cited hand-rolled MIT decoder" — is delivered by
plan 04 (depends_on `[01, 02, 03]`), which:

- imports `decodeIndoorBikeData` from this fixture,
- imports `encodeIndoorBikeData` from the plan-03 encoder,
- runs `decode(encode(record))` over the parametrized cases (sign-edge power,
  half-rpm cadence, both branches of the bit-0 inversion per D-06), and
- asserts equality.

The independence guarantee from this plan is what makes that gate
informative. Plan 04 is also where the bit-0 inversion gets exercised in
both branches (CONTEXT.md D-06), since the decoder accepts both shapes but
the encoder must be tested against both.

## Deviations from Plan

None. Plan executed exactly as written; the typecheck step is documented as
deferred-to-merge per the orchestrator's parallel-execution instructions, not
skipped.

## Self-Check: PASSED

- File `test/fixtures/ftms-decoder.ts` — FOUND (124 lines)
- File `test/fixtures/README.md` — FOUND (52 lines)
- Commit `b030272` — FOUND in `git log`
- All acceptance-criteria greps verified prior to commit (see table above)
- Decoder verified standalone: zero imports
- HEAD on per-agent branch `worktree-agent-aa935f412938dbf8b`; no
  modifications to STATE.md or ROADMAP.md (per parallel-execution rules)
