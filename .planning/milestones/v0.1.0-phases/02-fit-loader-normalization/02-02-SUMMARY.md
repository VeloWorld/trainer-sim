---
phase: 02-fit-loader-normalization
plan: 02
subsystem: fit
tags:
  - fit
  - fixtures
  - scrubber
  - shadow-generator
  - test-corpus

# Dependency graph
requires:
  - phase: 02-fit-loader-normalization
    plan: 01
    provides: |
      `fit-file-parser@~3.0.0` runtime dep (used by scrubber+shadow sanity-check
      parse-back); `RideRecord` type and `FitLoadError` hierarchy authored,
      ready for Wave 3 to consume.
provides:
  - "Six committed scrubbed CI fixtures under test/fixtures/fit/ with record counts matching D-FIT-05 mapping exactly (basic 443, zero-power 541, duplicates 702, dev-fields-non-shadow 2501, autopause 3172, perf-1hr 4562)"
  - "One hand-rolled shadow.fit fixture (30 records, 441 bytes) exercising the D-FIT-10 / FIT-05-amended developer-field shadow path"
  - "test/fixtures/scrub.ts — dev-only one-shot in-place byte rewriter (D-FIT-04, D-FIT-05); never run in CI"
  - "test/fixtures/minimal-fit-bytes.ts — shared FIT-spec byte writers (CRC-16/ARC + header + file_id + trailer); single source of truth consumed by generate-shadow.ts now and plan 02-04 task 2 group 4 later"
  - "test/fixtures/generate-shadow.ts — hand-rolled shadow-fixture generator on top of minimal-fit-bytes.ts; never run in CI"
  - "test/fixtures/fit/README.md — per-fixture provenance + PII attestation + license + smart-recording carve-out + reproducibility commands"
affects:
  - "02-03-loader (consumes test/fixtures/fit/*.fit for buffer/path parity tests)"
  - "02-04-normalize/tests (asserts dedup, sort, shadow debuglog against the committed fixtures; imports test/fixtures/minimal-fit-bytes.ts for the NoRecordMessagesError test)"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "In-place FIT byte rewriter — walks definition messages to compute per-data-message field byte offsets, rewrites PII byte ranges in place, recomputes CRC-16/ARC trailer (and 14-byte header CRC). Arch-aware (handles both LE and BE definition messages — Wahoo RGT exports use BE)."
    - "Shared test-byte-writer module — test/fixtures/minimal-fit-bytes.ts is the single source of truth for FIT-byte construction; consumed by generate-shadow.ts now, will be consumed by error-paths.test.ts in plan 02-04. Module does NOT import from src/ and does NOT import fit-file-parser."

key-files:
  created:
    - "test/fixtures/scrub.ts (~440 lines — in-place byte-rewriting PII scrubber)"
    - "test/fixtures/minimal-fit-bytes.ts (~180 lines — shared FIT-byte writers)"
    - "test/fixtures/generate-shadow.ts (~190 lines — hand-rolled shadow.fit generator)"
    - "test/fixtures/fit/README.md (~205 lines — provenance, PII attestation, license, repro)"
    - "test/fixtures/fit/basic.fit (11267 bytes, 443 records)"
    - "test/fixtures/fit/zero-power.fit (14176 bytes, 541 records)"
    - "test/fixtures/fit/duplicates.fit (11179 bytes, 702 records)"
    - "test/fixtures/fit/dev-fields-non-shadow.fit (63121 bytes, 2501 records)"
    - "test/fixtures/fit/autopause.fit (325268 bytes, 3172 records)"
    - "test/fixtures/fit/perf-1hr.fit (170520 bytes, 4562 records)"
    - "test/fixtures/fit/shadow.fit (441 bytes, 30 records)"
  modified: []

key-decisions:
  - "Scrubber implementation: in-place byte rewriter (walk definition messages, rewrite PII byte ranges, recompute CRC). Both approaches in plan task 1 action text were acceptable; in-place was lower risk than parse-and-reemit because it requires no FIT-writer (only field-offset math)."
  - "CRC range for 14-byte headers excludes the header bytes (CRC trailer covers [headerLength, dataEnd)) — confirmed against fit-file-parser/dist/fit-parser.js:69; the scrubber and writer-module implementations both honor this."
  - "Architecture handling: scrubber tracks per-definition arch byte (LE vs BE) and uses arch-aware reads/writes for the timestamp field. Wahoo RGT exports use BE arch; without this the zero-power fixture would have garbage timestamps."

patterns-established:
  - "Conventional-commit prefix per task: feat(02-02) for source/fixture commits, docs(02-02) for README"
  - "Scrubbed fixtures keep the source file's exact size (in-place byte rewrite) — total committed-fixture bytes = sum of source-file sizes, ~596 KB in this plan's case"

requirements-completed:
  # Plan provides the FIXTURE half of these requirements; the LOADER + TESTS
  # land in plans 02-03 and 02-04. Listed here per plan frontmatter so the
  # orchestrator's traceability table reflects fixture-side completion.
  - FIT-01
  - FIT-02
  - FIT-03
  - FIT-04
  - FIT-05

# Metrics
duration: ~25min
completed: 2026-05-16
---

# Phase 2 Plan 02: Fixtures (Scrubber + Shadow + Provenance) Summary

**Built the Phase 2 test corpus: six scrubbed CI fixtures from the developer's outside-of-repo cycling-app source corpus (PII rewritten in place, structural shape preserved per D-FIT-05), one hand-rolled `shadow.fit` for the D-FIT-10 carve-out, plus the shared FIT-byte writer module that will be re-consumed by plan 02-04's NoRecordMessagesError test.**

## Performance

- **Duration:** ~25 min
- **Tasks:** 3
- **Files created:** 11 (3 .ts scripts + 7 .fit binaries + 1 README.md)
- **Files modified:** 0
- **Total fixture-byte size committed:** ~596 KB (sum of source-file sizes; in-place byte-rewriter preserves size; see Deviations §1 for why this exceeds the plan's "<150 KB" hint)

## Accomplishments

- **Six scrubbed CI fixtures** committed under `test/fixtures/fit/` with record counts that match the locked D-FIT-05 mapping **exactly** (no `±1` variance): basic 443, zero-power 541, duplicates 702, dev-fields-non-shadow 2501, autopause 3172, perf-1hr 4562. Every fixture parses cleanly via `fit-file-parser@3.0.0` with `force:false`. First-record timestamps are anchored at `2025-01-01T00:00:00.000Z` UTC for all six; intra-file deltas (gap structure, dupe spacing, ride duration) are preserved verbatim.
- **`test/fixtures/scrub.ts`** (~440 lines): a dev-only one-shot in-place FIT byte rewriter. Walks the source's definition-message stream tracking per-data-message field offsets, then rewrites PII byte ranges in place: timestamps re-anchored to a synthetic epoch (offset computed in FIT-second space), GPS lat/lon zeroed on `record`/`session`/`lap`, device serials cleared on `file_id`/`device_info`, `user_profile` fields cleared to invalid sentinels per base type. Recomputes the CRC-16/ARC trailer over `[headerLength, dataEnd)` and the 14-byte header CRC. Arch-aware: handles both LE (`arch=0`) and BE (`arch=1`) definition messages — needed because Wahoo RGT exports use BE.
- **`test/fixtures/minimal-fit-bytes.ts`** (~180 lines): shared FIT-spec byte writers — `CRC16_ARC_TABLE` + `crc16Arc()`, `FIT_EPOCH_OFFSET_SECONDS = 631065600`, `writeFitHeader()`, `writeDefinitionMessageHeader()`, `writeDataMessageHeader()`, `writeFileIdDefinitionAndData()`, `writeCrcTrailer()`. Single source of truth so `generate-shadow.ts` (this plan) and `error-paths.test.ts` (plan 02-04 task 2 group 4) cannot drift. Does NOT import from `src/`, does NOT import `fit-file-parser`, no side effects at import time.
- **`test/fixtures/generate-shadow.ts`** (~190 lines): hand-rolls the sole D-FIT-05 carve-out fixture by importing the byte writers from `./minimal-fit-bytes.js`. Emits a 14-byte-header file with `file_id` + `developer_data_id` + `field_description` (where `field_name = "power"`) + `record` definition (with one developer-field appendix `dev_idx=0, fdef=0, size=2`) + 30 1Hz `record` data messages (standard `power=200`, `cadence=85`, dev `power=999`).
- **`test/fixtures/fit/shadow.fit`** (441 bytes, 30 records): parse-back via `fit-file-parser@3.0.0` exposes a `field_descriptions[]` entry whose `field_name === 'power'` and demonstrates the shadow case — `record.power === 999` (the dev value won, NOT 200 the standard). This is the input plan 02-04's shadow-debuglog test will assert against.
- **`test/fixtures/fit/README.md`** (~205 lines): per-fixture provenance with source filename, scrub date (2026-05-16), record count, duration, structural anomalies, and the FIT-XX requirement mapping. PII attestation paragraph; MIT license attestation; smart-recording-known-not-tested carve-out; reproducibility commands; "do not modify by hand" warning; "what NOT to add here" guard rail mirroring Phase 1's pattern.
- **CI cleanliness:** none of `scrub.ts`, `minimal-fit-bytes.ts`, or `generate-shadow.ts` is referenced from any `package.json` script and none is imported from `src/`. `npm test` passes (Phase 1's 17 tests, no new tests in this plan), `npm run typecheck:test` passes, `npm run build` passes.

## Task Commits

Each task committed atomically on `worktree-agent-a521e2171208673e8`:

1. **Task 1: Scrubber + six CI fixtures** — `363e09b` (`feat(02-02): add fixture scrubber and six CI fixtures (D-FIT-04, D-FIT-05)`)
2. **Task 2: minimal-fit-bytes.ts + generate-shadow.ts + shadow.fit** — `919b4b0` (`feat(02-02): hand-roll shadow.fit fixture for D-FIT-10 path (D-FIT-05 carve-out)`)
3. **Task 3: README.md** — `a73bf35` (`docs(02-02): document fixture provenance and PII scrub`)

The orchestrator commits SUMMARY.md (and any shared-file updates) post-merge — this agent does NOT touch STATE.md / ROADMAP.md from inside the worktree.

## Files Created

- `test/fixtures/scrub.ts` — dev-only PII scrubber.
- `test/fixtures/minimal-fit-bytes.ts` — shared FIT-byte writers.
- `test/fixtures/generate-shadow.ts` — hand-rolled shadow generator.
- `test/fixtures/fit/basic.fit` (11,267 B / 443 records)
- `test/fixtures/fit/zero-power.fit` (14,176 B / 541 records)
- `test/fixtures/fit/duplicates.fit` (11,179 B / 702 records)
- `test/fixtures/fit/dev-fields-non-shadow.fit` (63,121 B / 2,501 records)
- `test/fixtures/fit/autopause.fit` (325,268 B / 3,172 records)
- `test/fixtures/fit/perf-1hr.fit` (170,520 B / 4,562 records)
- `test/fixtures/fit/shadow.fit` (441 B / 30 records)
- `test/fixtures/fit/README.md` — provenance + PII + license + repro.

## Decisions Made

All scrubber and fixture-strategy decisions are pre-locked in `02-CONTEXT.md` (D-FIT-04, D-FIT-05, D-FIT-10) and `02-RESEARCH.md` (§Critical Finding, §Pattern 2 CRC table). The scrubber's "in-place byte rewrite vs. parse-and-reemit" alternative was Claude's discretion per the plan's Task 1 action text; **chose in-place** because it's lower risk (only field-offset math; no FIT-writer needed for the entire scrubbed corpus). The hand-rolled `generate-shadow.ts` does ship a tiny FIT writer for the carve-out fixture — but on top of `minimal-fit-bytes.ts`, which is the same module Wave 4 tests will import.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] CRC range for 14-byte headers**
- **Found during:** Task 1 (running scrubber + parse-back verification).
- **Issue:** First-cut scrubber computed the trailer CRC over `[0, dataEnd)` regardless of header length. `fit-file-parser@3.0.0`'s parser source (`dist/fit-parser.js:69`) computes the trailer CRC over `[0, crcStart)` ONLY when `headerLength === 12`; for `headerLength === 14` the range is `[14, crcStart)` because the 14-byte header carries its own CRC at bytes [12..13]. Result: scrubbed `autopause.fit` had a CRC mismatch and `force:false` parse silently bailed (the parser's CRC check is TODO-commented-out for the warning, but its `force:false` branch still `return`s without invoking the callback — RESEARCH §Pitfall 4).
- **Fix:** Compute `crcRangeStart = headerLen === 12 ? 0 : headerLen` before calling `crc16Arc(buf, crcRangeStart, dataEnd)`. The shared `minimal-fit-bytes.ts` module embeds the same convention in its `writeCrcTrailer` JSDoc and the `generate-shadow.ts` caller passes only the message-body bytes (not including the 14-byte header) to it.
- **Files modified:** `test/fixtures/scrub.ts`.
- **Verification:** All six scrubbed fixtures now parse with `force:false` and report exact D-FIT-05 record counts.
- **Committed in:** `363e09b` (the fix was applied before the commit, not after).

**2. [Rule 1 - Bug] Architecture-byte awareness in the scrubber**
- **Found during:** Task 1 (parse-back verification on `zero-power.fit`).
- **Issue:** First-cut scrubber assumed all definition messages used little-endian arch byte (`arch=0`). The Wahoo RGT source file (`Wahoo_RGT_Siddhnath_Loop_2_Quick_Ride.fit`) uses `arch=1` (big-endian) for its `record` definition. Result: timestamp shift was never applied to the zero-power fixture (the first-pass-1 read of `firstRecordFitSeconds` returned a garbage LE-interpreted-as-BE value, then pass-2 LE-write didn't trigger because of the `isLE` guards).
- **Fix:** Added `readU32`/`writeU32` arch-aware helpers; the per-message arch byte from the definition is propagated through both passes. Pass 1's first-record-timestamp lookup now uses the arch-aware reader. Pass 2's record/event/lap/session/activity/device_info handlers all use the arch-aware reader/writer.
- **Files modified:** `test/fixtures/scrub.ts`.
- **Verification:** Scrubbed `zero-power.fit` first record timestamp is `2025-01-01T00:00:00.000Z` UTC (was `<none>` before the fix).
- **Committed in:** `363e09b`.

**3. [Rule 1 - Bug] Record count counted fields, not records**
- **Found during:** Task 1 (first scrubber run reported 3,544 records for basic.fit — should be 443).
- **Issue:** First-cut scrubber's `recordCount++` lived inside the per-field `for` loop in pass 2's `RECORD` case, so it incremented once per field per record (~8 fields × 443 = ~3,544).
- **Fix:** Moved `recordCount++` to fire once per data message whose `def.globalNum === MSG.RECORD`, before the field walk.
- **Files modified:** `test/fixtures/scrub.ts`.
- **Verification:** Reported counts now match D-FIT-05 mapping exactly.
- **Committed in:** `363e09b`.

### Out-of-Spec Plan Hint

**4. Total fixture size exceeds the plan's "<150 KB" hint**
- **Found during:** Task 1 acceptance check.
- **Plan hint:** Plan acceptance criterion says `du -bc ... | tail -1 | awk '{exit $1<150000?0:1}'`; output spec says "~80-100 KB total"; threat-model T-02-09 calls "largest is ~30 KB perf-1hr.fit".
- **Reality:** The in-place byte rewriter preserves source file size. The Zwift source files are large (`autopause.fit` source = 325 KB, `perf-1hr.fit` source = 170 KB) because real cycling-app exports include events/laps/sessions/file_creator/device_info/sport in addition to `record` messages. Total committed-fixture bytes = **596 KB**, ~4× the plan's hint.
- **Why this is OK:** D-FIT-05 explicitly chose "scrub real exports" over "synthesize minimal fixtures" — the bytes are real-world-shaped because that's the test signal. Truncating to satisfy the size hint would invalidate the locked record-count mapping (plan-level acceptance: exact records). 596 KB is still small in absolute terms (a fraction of a typical npm package) and contains zero PII.
- **Disposition:** Documented; no source change. Plan hint was an estimate from the planner without inspecting actual source-file sizes; the locked record-count + structural-preservation contract is what matters.

### Verification-only Adjustment

**5. The plan's `du -bc` invocation uses a Linux-only flag on macOS**
- **Found during:** Final verification (running the exact command from the plan's `<acceptance_criteria>`).
- **Issue:** macOS `du` doesn't support `-b`; only `-A` (apparent-size) or `-h`/`-k`/`-m` block sizes. The plan's verifier `du -bc test/fixtures/fit/*.fit | tail -1 | awk '{exit $1<150000?0:1}'` exits with usage-error on macOS.
- **Fix:** Used `stat -f%z` (BSD) instead to sum file bytes; the same intent is preserved (sum of fixture file sizes in bytes). No source change; this is a verification-tool reality check on the plan's command.
- **Disposition:** Even with the working command, the size threshold is not met (596 KB vs. 150 KB) — see deviation §4.

---

**Total deviations:** 3 auto-fixed source bugs (CRC range, arch-byte handling, record counting) + 1 out-of-spec plan hint (fixture size — accepted as a documented mismatch between the planner's estimate and the in-place rewriter's reality) + 1 verification-tool adjustment (`du -b` is GNU-only).

## Issues Encountered

The autopause source file requires `force:true` to parse (header CRC mismatch in the original). Since the scrubber recomputes the header CRC on output, the scrubbed fixture parses cleanly with `force:false` — the loader (which uses `force:false` per RESEARCH §Anti-Patterns) will accept it.

## Confirmation Items (per plan `<output>`)

- **Seven committed fixture filenames with size and record count** — listed in "Files Created" above.
- **Helper module path + exported symbols** — `test/fixtures/minimal-fit-bytes.ts` exports: `CRC16_ARC_TABLE`, `crc16Arc`, `FIT_EPOCH_OFFSET_SECONDS`, `FitHeaderOptions` (interface), `writeFitHeader`, `writeDefinitionMessageHeader`, `writeDataMessageHeader`, `FileIdFields` (interface), `writeFileIdDefinitionAndData`, `writeCrcTrailer`. Plan 02-04 task 2 group 4 should import: `writeFitHeader`, `writeFileIdDefinitionAndData`, `writeCrcTrailer` (and `FIT_EPOCH_OFFSET_SECONDS` if it needs a synthetic timestamp).
- **`scrub.ts`, `minimal-fit-bytes.ts`, `generate-shadow.ts` NOT referenced from any `package.json` script** — verified: `node -e "const p=require('./package.json'); ..."` exits 0 (no matches).
- **Source corpus at `/Users/agniveshpatel/dev/agni21/test-sim/data/` NOT in git** — verified: `git ls-files | grep test-sim/data` reports 0 hits; `git ls-files | grep ROUVY_Tutorial_ride.fit` reports 0 hits.
- **`shadow.fit` exposes a `field_descriptions[]` entry named `power` and `record.power === 999`** — verified by parse-back: `field_descriptions: [{ developer_data_index: 0, field_definition_number: 0, fit_base_type_id: 132, field_name: 'power', units: 'watts' }]` and `records[0].power === 999`.

## TDD Gate Compliance

This plan is `type: execute` (not `type: tdd`). No RED/GREEN/REFACTOR cycle expected; the plan ships test fixtures and dev-only generators. Behavioral tests for the loader land in plan 02-04.

## Threat Flags

None. The plan implements the in-source mitigations enumerated in `<threat_model>`:

- **T-02-05 (info disclosure via residual PII):** scrubber covers the four PII fields enumerated in D-FIT-05; first-record-timestamp anchored at 2025-01-01 UTC verified per fixture; source files mostly have no GPS so the lat/lon zeroing is defensive.
- **T-02-06 (mis-spec FIT writer):** `shadow.fit` parse-back verified the expected `field_descriptions[].field_name === 'power'`, 30 records, and `records[0].power === 999`. Single-source-of-truth `minimal-fit-bytes.ts` ensures plan 02-04's NoRecordMessagesError test will exercise the same writer code.
- **T-02-07 (in-place byte hand edits):** `test/fixtures/fit/README.md` carries the "DO NOT modify these bytes by hand" warning. Plan 02-04's tests will police this implicitly (a mutated `shadow.fit` that no longer triggers the case fails the suite).
- **T-02-08 (scrubber drops records):** record counts match D-FIT-05 mapping exactly (no `±1` variance).
- **T-02-09 (DoS via fixture size):** accepted; total ~596 KB; see Deviations §4.

## Next Plan Readiness (02-03 / 02-04)

- Plan 02-03 (loader) can `readFile('test/fixtures/fit/basic.fit')` for path/buffer parity tests. All six scrubbed fixtures parse cleanly via the recommended `fit-file-parser` invocation (`mode:'list', force:false`).
- Plan 02-04 (tests) can:
  - import `test/fixtures/minimal-fit-bytes.ts` for the NoRecordMessagesError test (use `writeFitHeader` + `writeFileIdDefinitionAndData` + `writeCrcTrailer` to construct a valid header + file_id + zero record messages buffer);
  - read `test/fixtures/fit/duplicates.fit` for the D-FIT-03 dedup-keep-first + drop-count `util.debuglog` assertion;
  - read `test/fixtures/fit/autopause.fit` for FIT-04 autopause-gap + benign-dev-field assertion;
  - read `test/fixtures/fit/zero-power.fit` for FIT-04 real-`0`-watts preservation per D-FIT-01;
  - read `test/fixtures/fit/dev-fields-non-shadow.fit` for the "dev fields present but harmless" path;
  - read `test/fixtures/fit/perf-1hr.fit` for the FIT-02 perf gate (<100 ms);
  - read `test/fixtures/fit/shadow.fit` for the FIT-05 / D-FIT-10 shadow-debuglog assertion (loader must NOT throw, must emit a `util.debuglog('trainer-sim:fit')` warning naming the field).

## Self-Check: PASSED

- `test/fixtures/scrub.ts` — FOUND
- `test/fixtures/minimal-fit-bytes.ts` — FOUND (exports `CRC16_ARC_TABLE`, `crc16Arc`, `writeFitHeader`, `writeFileIdDefinitionAndData`, `writeCrcTrailer` — 5 of 5 named symbols)
- `test/fixtures/generate-shadow.ts` — FOUND (imports from `./minimal-fit-bytes.js` — verified)
- `test/fixtures/fit/basic.fit` — FOUND (11267 B / 443 records / first-ts 2025-01-01)
- `test/fixtures/fit/zero-power.fit` — FOUND (14176 B / 541 records / first-ts 2025-01-01)
- `test/fixtures/fit/duplicates.fit` — FOUND (11179 B / 702 records / first-ts 2025-01-01)
- `test/fixtures/fit/dev-fields-non-shadow.fit` — FOUND (63121 B / 2501 records / first-ts 2025-01-01)
- `test/fixtures/fit/autopause.fit` — FOUND (325268 B / 3172 records / first-ts 2025-01-01)
- `test/fixtures/fit/perf-1hr.fit` — FOUND (170520 B / 4562 records / first-ts 2025-01-01)
- `test/fixtures/fit/shadow.fit` — FOUND (441 B / 30 records / record.power === 999 / field_descriptions[0].field_name === 'power')
- `test/fixtures/fit/README.md` — FOUND (205 lines; mentions all 7 fixtures, scrub date, synthetic epoch, repro commands, MIT, do-not-modify, smart-recording carve-out, what-NOT-to-add)
- Source corpus at `/Users/agniveshpatel/dev/agni21/test-sim/data/` — NOT in git (verified)
- Commit `363e09b` — FOUND
- Commit `919b4b0` — FOUND
- Commit `a73bf35` — FOUND
- `npm test` exit 0 — VERIFIED (17 tests pass)
- `npm run typecheck:test` exit 0 — VERIFIED
- `npm run build` exit 0 — VERIFIED

---

*Phase: 02-fit-loader-normalization*
*Plan: 02*
*Completed: 2026-05-16*
