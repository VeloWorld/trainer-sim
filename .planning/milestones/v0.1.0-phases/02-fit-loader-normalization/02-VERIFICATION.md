---
phase: 02-fit-loader-normalization
verified: 2026-05-16T03:40:00Z
status: passed
score: 4/4 must-haves verified
overrides_applied: 0
---

# Phase 2: FIT Loader & Normalization — Verification Report

**Phase Goal:** Library turns a real Garmin/Wahoo FIT file (path or Buffer) into a normalized, time-ordered `RideRecord[]` that the replay engine can consume without surprises.
**Verified:** 2026-05-16T03:40:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Loading a FIT file by filesystem path and by in-memory Buffer both yield the same normalized `RideRecord[]` | VERIFIED | Live exec via `dist/index.cjs`: `loadFitFromBuffer(readFileSync('basic.fit'))` returns 443 records, `loadFitFromPath('basic.fit')` returns 443 records, `JSON.stringify(p) === JSON.stringify(buf)` is `true`. `src/fit/loader.ts:266-269` shows `loadFitFromPath` delegates directly to `loadFitFromBuffer` after `readFile`, so byte-for-byte parity is structural. |
| 2 | Timestamps are Unix epoch ms, not FIT epoch (1989-12-31 UTC offset applied) | VERIFIED | `out[0].timestamp === 1735689600000` and `new Date(out[0].timestamp).toISOString() === '2025-01-01T00:00:00.000Z'`; `typeof timestamp === 'number'`. `src/fit/normalize.ts:65` calls `rec.timestamp.getTime()` on the parser's pre-converted `Date` object. JSDoc on `RideRecord.timestamp` (`src/types.ts:26-30`) cites FIT-03. |
| 3 | A real Garmin export with autopause gaps, sparse smart-recording records, and null power values loads without throwing and produces a usable record stream | VERIFIED | `autopause.fit` (3172 records) loads with max gap = 68000 ms = 68 s preserved (D-FIT-02); `zero-power.fit` (541 records) preserves 142 records with `power === 0` (wire-honest D-FIT-01); `dev-fields-non-shadow.fit` (2501 records) loads cleanly with non-shadowing dev fields; `duplicates.fit` source 702 → output 689 (13 duplicates dropped per D-FIT-03). All four load through `dist/index.cjs` without throwing. |
| 4 | A FIT file with developer-defined `power` fields loads without throwing AND emits a `util.debuglog('trainer-sim:fit')` warning naming the affected fields (FIT-05 / D-FIT-10) | VERIFIED | `NODE_DEBUG=trainer-sim:fit` subprocess on `shadow.fit` produces stderr line: `TRAINER-SIM:FIT <pid>: developer field shadow detected on standard field power (developer_data_index=0, field_definition_number=0) — fit-file-parser collides developer value onto record.power; returning whatever parser produced (D-FIT-10)` — and returns 30 records with `power = 999` (the dev value). `src/fit/loader.ts:218-234` `detectAndLogShadow` does NOT throw. |

**Score:** 4/4 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/types.ts` | `RideRecord` interface, JSDoc cites D-FIT-01 + FIT-03 | VERIFIED | 46 lines; exports `RideRecord` with required `timestamp: number`, optional `power?: number`, optional `cadence?: number`; JSDoc names FIT-03 and the absent-vs-zero distinction. |
| `src/fit/errors.ts` | Abstract `FitLoadError` + 4 concrete subclasses; NO `DeveloperFieldShadowError` | VERIFIED | 57 lines; `abstract class FitLoadError extends Error` (line 30) sets `this.name = this.constructor.name`; four concrete subclasses (lines 41, 48, 51, 57); zero matches for `DeveloperFieldShadowError` anywhere in `src/`. |
| `src/fit/normalize.ts` | Pure `normalize(parsed): RideRecord[]`; sort+dedup+Date→ms+debuglog; no parser import | VERIFIED | 110 lines; uses `!== undefined` for power/cadence (no `??`); calls `.getTime()`; sorts ascending; dedups keep-first; `debuglog('trainer-sim:fit')` emits drop+reorder counts only when `outOfOrder + duplicates > 0`. NO `fit-file-parser` import. |
| `src/fit/loader.ts` | `loadFitFromBuffer` (sync) + `loadFitFromPath` (async); single parser import; header+CRC validation; FitRecordSource seam; shadow debuglog non-fatal | VERIFIED | 269 lines. The single `import FitParser from 'fit-file-parser'` in all of `src/`. Pins `mode: 'list'`. CRC-16/ARC table inlined with boundary entries `0xCC01` / `0x4400`. Throws all four `FitLoadError` subclasses on appropriate corruption. `detectAndLogShadow` emits debuglog and returns (does NOT throw). `loadFitFromBuffer` is sync (no `async` keyword); `loadFitFromPath` awaits `readFile` and delegates. |
| `src/index.ts` | Re-exports of `loadFitFromPath`, `loadFitFromBuffer`, type-only `RideRecord`, four FitLoadError classes; preserves Phase 1 encoder | VERIFIED | 22 lines. CJS dist exports observed at runtime: `['FitCrcError', 'FitLoadError', 'FitTruncatedError', 'InvalidFitHeaderError', 'NoRecordMessagesError', 'encodeIndoorBikeData', 'loadFitFromBuffer', 'loadFitFromPath']`. `dist/index.d.ts` declares `RideRecord` as a type. No `DeveloperFieldShadowError`, no `FitRecordSource`. |
| `package.json` | `fit-file-parser ~3.0.0` under `dependencies` | VERIFIED | `dep: ~3.0.0`, `disk: 3.0.0`. |
| `test/fixtures/fit/basic.fit` | Scrubbed ROUVY 443-record fixture | VERIFIED | 11267 bytes; loads to 443 records; first ts 2025-01-01T00:00:00.000Z. |
| `test/fixtures/fit/zero-power.fit` | 541-record / 142 zero-power | VERIFIED | 14176 bytes; loads to 541 records; 142 records have `power === 0`. |
| `test/fixtures/fit/duplicates.fit` | 702-record / 13 dupes | VERIFIED | 11179 bytes; source 702 records → output 689 records (13 dropped). Debuglog: "13 duplicates dropped". |
| `test/fixtures/fit/dev-fields-non-shadow.fit` | 2501-record / 4 non-shadow dev fields | VERIFIED | 63121 bytes; loads to 2501 records cleanly. |
| `test/fixtures/fit/autopause.fit` | 3172-record / 2 gaps max 68s | VERIFIED | 325268 bytes; loads to 3172 records; max inter-record delta 68000 ms = 68 s. |
| `test/fixtures/fit/perf-1hr.fit` | 4562-record perf gate fixture | VERIFIED | 170520 bytes; perf test asserts <50 ms median (passes). |
| `test/fixtures/fit/shadow.fit` | Hand-rolled, dev `power` field, ~30 records | VERIFIED | 441 bytes; loads to 30 records; `power === 999` (dev value); `field_descriptions[0].field_name === 'power'`. |
| `test/fixtures/fit/README.md` | Per-fixture provenance, PII attestation, repro commands | VERIFIED | 205 lines; mentions all 7 fixtures, scrub date 2026-05-16, synthetic epoch 2025-01-01, MIT license, "do not modify by hand", smart-recording carve-out. |
| `test/fixtures/scrub.ts` | Dev-only scrubber not run in CI | VERIFIED | Committed; no reference from `package.json` scripts; no import from `src/`. |
| `test/fixtures/minimal-fit-bytes.ts` | Shared FIT-byte writers (CRC + header + file_id + trailer) | VERIFIED | Committed; exports `CRC16_ARC_TABLE`, `crc16Arc`, `FIT_EPOCH_OFFSET_SECONDS`, `writeFitHeader`, `writeFileIdDefinitionAndData`, `writeCrcTrailer` etc.; no import from `src/`; no `fit-file-parser` import. Consumed by `test/fit/error-paths.test.ts`. |
| `test/fixtures/generate-shadow.ts` | Dev-only shadow.fit generator | VERIFIED | Committed; imports from `./minimal-fit-bytes.js`; not run in CI. |
| `test/fit/loader.test.ts` | FIT-01 parity + FIT-04 quirks + sync invariant | VERIFIED | 7 tests pass. |
| `test/fit/error-paths.test.ts` | Each FitLoadError subclass + instanceof FitLoadError | VERIFIED | 6 tests pass; imports byte writers from `minimal-fit-bytes.js` (no inlined CRC table). |
| `test/fit/dev-field-shadow.test.ts` | shadow.fit non-fatal + debuglog | VERIFIED | 3 tests pass; uses `npx tsx` subprocess + `NODE_DEBUG=trainer-sim:fit`. |
| `test/fit/perf.test.ts` | <50 ms median over 11 runs after 3 warm-ups | VERIFIED | 1 test passes. |
| `test/fit/normalize.test.ts` | FIT-02 + FIT-03 + D-FIT-01..03 + D-FIT-09 | VERIFIED | 16 tests pass. |
| `test/fit/local.test.ts` | TEST_FIT_DIR opt-in; skipped silently when unset | VERIFIED | `env -u TEST_FIT_DIR npx vitest run` reports 1 skipped, exit 0. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `src/fit/errors.ts` | `Error` | `abstract class FitLoadError extends Error` | WIRED | Confirmed at line 30. |
| `src/fit/loader.ts` | `fit-file-parser` | `import FitParser from 'fit-file-parser'` | WIRED | Single src/ import (line 23); zero other matches. |
| `src/fit/loader.ts` | `src/fit/normalize.ts` | `import { normalize } from './normalize.js'` | WIRED | Line 25; called at line 254. |
| `src/fit/loader.ts` | `src/fit/errors.ts` | named imports of all four leaves | WIRED | Lines 26-31; thrown at lines 97, 103, 110, 119, 131, 250. |
| `src/index.ts` | `src/fit/loader.ts`, `src/fit/errors.ts`, `src/types.ts` | re-exports with `.js` extension | WIRED | Lines 14-22; CJS dist exposes all 8 expected runtime symbols + RideRecord type. |
| `test/fit/error-paths.test.ts` | `test/fixtures/minimal-fit-bytes.js` | named import of byte writers | WIRED | Per code review; tests pass. |
| `test/fit/dev-field-shadow.test.ts` | `npx tsx` subprocess | `spawnSync` + `NODE_DEBUG=trainer-sim:fit` | WIRED | Test passes; verified live at the verifier's own subprocess invocation. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `loadFitFromBuffer` | `RideRecord[]` | parser → `normalize` | Yes — confirmed via dist CJS smoke (basic 443, autopause 3172, zero-power 541, dev-fields-non-shadow 2501, duplicates 689, perf-1hr 4562, shadow 30) | FLOWING |
| `loadFitFromPath` | `RideRecord[]` | `readFile` → `loadFitFromBuffer` | Yes — `JSON.stringify(p) === JSON.stringify(buf)` for basic.fit | FLOWING |
| `normalize` | `RideRecord[]` | `parsed.records[]` (Date, power, cadence) | Yes — `power === 0` preserved (142 in zero-power.fit), `power === 999` preserved (shadow.fit), gap of 68 s preserved (autopause.fit), 13 dupes dropped (duplicates.fit) | FLOWING |
| `detectAndLogShadow` | (side effect: debuglog stderr) | `parsed.field_descriptions[]` | Yes — verified subprocess emits the message naming `power` | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Build produces dual ESM + CJS dist | `npm run build` | `ESM dist/index.js 6.54 KB`, `CJS dist/index.cjs 6.97 KB`, `DTS 10.19 KB` | PASS |
| Full test suite | `npm test` | 6 passed + 1 skipped (50 passed + 1 skipped tests) | PASS |
| FIT-01 path/buffer parity | `node -e "...JSON.stringify(p)===JSON.stringify(buf)..."` for basic.fit | `parity: true`, both 443 records | PASS |
| FIT-03 epoch conversion | First record timestamp of basic.fit | `1735689600000` = `2025-01-01T00:00:00.000Z` | PASS |
| FIT-04 autopause gap preservation (D-FIT-02) | Walk autopause.fit deltas | max gap = 68000 ms (68 s) | PASS |
| FIT-04 wire-honest 0 (D-FIT-01) | Count `power===0` in zero-power.fit | 142/541 | PASS |
| FIT-05 dev-field shadow (D-FIT-10) | NODE_DEBUG subprocess on shadow.fit | Emits `developer field shadow detected on standard field power ... (D-FIT-10)`; returns 30 records | PASS |
| D-FIT-03 dedup keep-first | NODE_DEBUG subprocess on duplicates.fit | Emits `normalize: 13 duplicates dropped, 0 out-of-order records reordered (input 702 -> output 689)` | PASS |
| Single parser import (D-FIT-08) | `grep -rE "from\s+['\"]fit-file-parser['\"]" src/` | 1 match (`src/fit/loader.ts`) | PASS |
| No DeveloperFieldShadowError (D-FIT-10) | Recursive grep across `src/` and `test/` | Zero matches | PASS |
| TEST_FIT_DIR unset-skip (D-FIT-04) | `env -u TEST_FIT_DIR npx vitest run test/fit/local.test.ts` | 1 skipped, exit 0 | PASS |
| Mode 'list' pinned (RESEARCH §Pitfall 2) | `grep -nE "mode:\s*['\"]list['\"]" src/fit/loader.ts` | line 182 | PASS |

### Probe Execution

No formal probes declared in the PLANs (`scripts/*/tests/probe-*.sh`) and the phase is a library/loader phase, not a migration/tooling phase. SKIPPED.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| FIT-01 | 02-01..05 | Library loads a FIT file from a filesystem path or an in-memory Buffer | SATISFIED | `loadFitFromPath` + `loadFitFromBuffer` both exposed in dist CJS; parity verified live (443 records identical) |
| FIT-02 | 02-01..05 | `record` messages exposed as a normalized, time-ordered `RideRecord[]` (timestamp + optional power + optional cadence) | SATISFIED | `RideRecord` type matches; `normalize` sorts ascending; `test/fit/normalize.test.ts` exercises sort + dedup with hand-rolled inputs |
| FIT-03 | 02-01..05 | FIT timestamp (sec since 1989-12-31 UTC) → Unix epoch correctly | SATISFIED | First-record ts of basic.fit = `1735689600000` ms = 2025-01-01T00:00:00.000Z; `normalize.ts:65` calls `getTime()` on parser's pre-converted Date |
| FIT-04 | 02-01..05 | Real-world Garmin/Wahoo files with autopause gaps + sparse smart-recording + null power load without throwing | SATISFIED | autopause.fit (gap 68 s preserved), zero-power.fit (142 zero-power preserved), dev-fields-non-shadow.fit (2501 records), duplicates.fit (689 records, 13 dropped) all load via dist CJS without throwing |
| FIT-05 | 02-01..05 | Loader returns usable `record.power` AND emits util.debuglog warning naming affected fields; does NOT throw | SATISFIED | `shadow.fit` returns 30 records with power=999, NO throw; debuglog emits "developer field shadow detected on standard field power ... (D-FIT-10)" |

All 5 requirement IDs present in REQUIREMENTS.md for Phase 2 are covered by at least one PLAN's `requirements:` field; no orphaned requirements.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/fit/errors.ts` | 45 | `TODO-commented-out` | Info | Descriptive comment about an EXTERNAL library quirk (`fit-file-parser` 3.0 having its CRC verification commented out upstream). NOT a trainer-sim debt marker — it's documentation of the external behavior that motivates trainer-sim's own CRC implementation. No action required. |
| `src/fit/loader.ts` | 4, 58 | `TODO-commented-out` | Info | Same as above — documents external library state, not actionable trainer-sim work. |

No `TBD` / `FIXME` / `XXX` markers found in any phase-modified file. No `console.log`/stub patterns. No empty implementations. No hardcoded empty data flowing to UI/output. The phase produces real working code.

### Code Review Followups (informational)

Per the supplied note, the 02-REVIEW.md report flagged 5 advisory warnings (no critical/blockers). These do not affect goal achievement and are surfaced here for traceability:

| ID | File | Concern | Severity | Disposition |
|----|------|---------|----------|-------------|
| WR-01 | `src/fit/loader.ts:115-118` | Signed-shift on `dataLength` — high-bit sets it negative; truncation guard bypassed; would route deliberate-malformed `data_length=0xFFFFFFFF` to `FitCrcError` instead of `FitTruncatedError` | Warning | Doesn't affect any of the four phase Success Criteria (real Garmin/Wahoo files don't reach 2 GB body). Recommend addressing in a Phase 2 followup or before Phase 3 ships. |
| WR-02 | `test/fit/dev-field-shadow.test.ts`, `test/fit/normalize.test.ts` | `npx tsx` subprocess assumes PATH availability and no offline-network failure mode; missing `result.error` defensive check | Warning | Local CI runs are passing today; risk surfaces only on locked-down CI runners. Recommend adding `--no-install` and `if (result.error) throw result.error` defensive check. |
| WR-03 | `src/fit/normalize.ts:62-69, 99-107` | Records lacking `timestamp` are silently dropped; the loader checks `parsed.records.length === 0` BEFORE normalize, so a FIT file with all-timestamp-less records would return `[]` with no debuglog and no NoRecordMessagesError | Warning | Doesn't affect today's six committed real-world fixtures (all have valid timestamps). Recommend moving the `length === 0` check to AFTER normalize. |
| WR-04 | `src/fit/loader.ts:186-189` | `else if` chain in adapter callback drops parser data when both `err` and `data` are populated (latent under `force: false`) | Warning | Latent — current parser version never delivers both; fix would track future `force: true` behavior. |
| WR-05 | `src/fit/loader.ts:50-74`, `test/fixtures/minimal-fit-bytes.ts:28-46`, `test/fixtures/scrub.ts:40-56` | CRC-16/ARC implementation duplicated across three files | Warning | Drift risk over time, but currently identical bytes verified by all three files passing their respective verifications. Recommend hoisting to `src/fit/_crc.ts`. |

None of the five warnings break a Success Criterion or block the phase goal. They are tracked technical-debt items appropriate for a follow-up plan.

### Human Verification Required

None. All four ROADMAP Success Criteria are independently verifiable through the codebase via:
- Live execution of `dist/index.cjs` (path/buffer parity, real fixture parsing)
- Bytecount/timestamp inspection (Unix epoch ms conversion)
- Subprocess `NODE_DEBUG` capture (shadow debuglog emission)
- Vitest run (50 passed + 1 skipped)

No subjective UI/UX behavior is in scope for this phase.

### Gaps Summary

None. Every must-have truth is observably true in the codebase; every artifact exists, is substantive, and is wired; every key link is verified; every requirement is satisfied; every behavioral spot-check passes; the build is green and tests pass (50 passed + 1 skipped, the skip being the binding D-FIT-04 contract for `local.test.ts` when `TEST_FIT_DIR` is unset).

The phase goal — "Library turns a real Garmin/Wahoo FIT file (path or Buffer) into a normalized, time-ordered RideRecord[] that the replay engine can consume without surprises" — is achieved.

---

_Verified: 2026-05-16T03:40:00Z_
_Verifier: Claude (gsd-verifier)_
