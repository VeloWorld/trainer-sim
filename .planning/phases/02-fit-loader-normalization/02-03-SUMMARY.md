---
phase: 02-fit-loader-normalization
plan: 03
subsystem: fit
tags:
  - fit
  - loader
  - normalize
  - public-api
  - core

# Dependency graph
requires:
  - phase: 02-fit-loader-normalization
    plan: 01
    provides: |
      `fit-file-parser@~3.0.0` runtime dep on disk; public `RideRecord` type
      (consumed by normalize as the return shape and by index.ts as the
      type-only re-export); FitLoadError + 4 concrete leaves authored and
      ready to be thrown by the loader; deliberate non-membership of any
      typed shadow-error class in the hierarchy (D-FIT-10 enforced at the
      module level — wave 3 honors that lock).
  - phase: 02-fit-loader-normalization
    plan: 02
    provides: |
      Seven CI fixtures committed under `test/fixtures/fit/` — basic.fit,
      zero-power.fit, duplicates.fit, dev-fields-non-shadow.fit,
      autopause.fit, perf-1hr.fit, shadow.fit. All seven were used to
      smoke-verify the loader's behavior end-to-end before the source-side
      commits landed (record counts, sort-and-dedup, shadow-debuglog,
      header/CRC error paths). `test/fixtures/minimal-fit-bytes.ts` is also
      ready for plan 02-04's NoRecordMessagesError test.
provides:
  - "src/fit/normalize.ts: pure `normalize(parsed): RideRecord[]` (sort, dedup keep-first, Date->ms, debuglog drops) — the contract Wave 4 tests assert against"
  - "src/fit/loader.ts: loadFitFromPath (async) + loadFitFromBuffer (sync) entry points; header + CRC validation; FitRecordSource seam; util.debuglog shadow detection (does NOT throw)"
  - "src/index.ts: Phase 2 public surface re-exported (loadFitFromPath, loadFitFromBuffer, type-only RideRecord, FitLoadError + 4 concrete leaves) alongside Phase 1's encoder + IndoorBikeRecord"
  - "Single fit-file-parser import in src/ confined to src/fit/loader.ts (D-FIT-08 seam intact — Phase 4 ESLint rule per CONTEXT 'Deferred' will lint-enforce later)"
affects:
  - "02-04-tests (loader.test.ts + error-paths.test.ts + dev-field-shadow.test.ts assert against the loader; perf.test.ts asserts the <100 ms gate)"
  - "02-05-tests (normalize.test.ts asserts D-FIT-01..03 / D-FIT-09 directly against `normalize`)"
  - "Phase 3 replay (consumes RideRecord[] from loadFitFromPath / loadFitFromBuffer)"
  - "Phase 4 FakeTransport (consumes the same RideRecord[] stream)"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "FitRecordSource seam (compile-time-only TypeScript interface in src/fit/loader.ts) wrapping the parser dependency in a one-file adapter — D-FIT-08 swap point preserved"
    - "Sync-callback exploit: loadFitFromBuffer stays sync per D-FIT-07 by using fit-file-parser's parse(buf, callback) form (callback fires synchronously per RESEARCH §Open Questions A1)"
    - "Two-phase pre-flight validation: header (length/magic) + CRC-16/ARC trailer recomputed in our code before handing bytes to the parser, since the parser's CRC check is TODO-commented-out (RESEARCH §Pitfall 4)"
    - "util.debuglog('trainer-sim:fit') shared diagnostic channel for D-FIT-09 drop-counts AND D-FIT-10 shadow warnings — single channel, single env var (NODE_DEBUG=trainer-sim:fit)"
    - "Wire-honest optionals: `if (rec.power !== undefined)` (NOT `??`, NOT truthy) so wire `0` survives normalize per D-FIT-01"

key-files:
  created:
    - "src/fit/normalize.ts (110 lines — pure normalize function: Date->ms, sort, dedup keep-first, debuglog drops)"
    - "src/fit/loader.ts (269 lines — loadFitFromBuffer/Path entry points, header+CRC validation, FitRecordSource seam, shadow debuglog)"
  modified:
    - "src/index.ts (5 -> 22 lines: re-exports loadFitFromPath, loadFitFromBuffer, type-only RideRecord, FitLoadError + 4 leaves alongside the existing Phase 1 encoder + IndoorBikeRecord exports)"

key-decisions:
  - "FIT_FIELDS registry pattern (Phase 1 analog) DEFERRED to v2 — with only `power` and `cadence` as optional fields the conditional-mapping shape is shorter and equally auditable; reintroduce when v2 widens RideRecord to speed/heart_rate per FTMS-06/07"
  - "FitRecordSource is a compile-time TypeScript interface (NOT a runtime object) per CONTEXT 'Claude's Discretion' — lighter than runtime; promote only if the test seam demands it"
  - "Module-level shared adapter instance (`const source = makeFitFileParserSource()`) — the parser itself is constructed per-parse since it is stateful; the adapter just routes"
  - "Filesystem errors from loadFitFromPath (ENOENT, EACCES, EISDIR) bubble up as Node's standard `Error` — deliberately NOT wrapped in FitLoadError subclasses because they describe filesystem failures, not FIT-format failures (plan 02-04 documents in test expectations)"

requirements-completed:
  # Plan provides the SOURCE LAYER for these requirements; the BEHAVIORAL
  # TESTS land in plans 02-04 (loader/error-paths/dev-field-shadow/perf) and
  # 02-05 (normalize).
  - FIT-01
  - FIT-02
  - FIT-03
  - FIT-04
  - FIT-05

# Metrics
duration: ~30min
completed: 2026-05-16
---

# Phase 2 Plan 03: FIT Loader & Normalize Source Layer Summary

**Wave 3 ships the Phase 2 source layer: pure `normalize` (Date->ms, sort, dedup, debuglog), `loader` entry points (header+CRC validation, FitRecordSource seam, shadow debuglog), and the public-API re-exports — all locked decisions (D-FIT-01, D-FIT-02, D-FIT-03, D-FIT-06, D-FIT-07, D-FIT-08, D-FIT-09, D-FIT-10) reflected in source.**

## Performance

- **Tasks:** 3
- **Files created:** 2 (`src/fit/normalize.ts`, `src/fit/loader.ts`)
- **Files modified:** 1 (`src/index.ts`)
- **Total source lines added:** 401 (110 normalize + 269 loader + 22 index — index up from 5)

## Accomplishments

- **`src/fit/normalize.ts` (110 lines)**: pure `normalize(parsed: ParsedFitMinimal): RideRecord[]`. Maps records to `RideRecord[]` via `Date.getTime()` (FIT-03), conditionally sets `power`/`cadence` only when explicitly `!== undefined` (preserves wire `0` per D-FIT-01), counts out-of-order before sorting, sorts ascending, dedups exact-duplicate timestamps keep-first (D-FIT-03), and emits drop+reorder counts via `util.debuglog('trainer-sim:fit')` only when anything was dropped (D-FIT-09). NO `fit-file-parser` import — parser-agnostic by design (D-FIT-08 seam).
- **`src/fit/loader.ts` (269 lines)**: the bulk of the wave. The single `import FitParser from 'fit-file-parser'` in all of `src/` lives here. Validates header (length 12 or 14, magic `.FIT`) and recomputes CRC-16/ARC trailer over `[crcRangeStart, crcStart)` (with `crcRangeStart=0` for 12-byte headers and `crcRangeStart=14` for 14-byte headers — same convention plan 02-02's scrubber/writer module honors). Throws all four `FitLoadError` subclasses on appropriate corruption: `FitTruncatedError` (buffer < 14 bytes or buffer < total expected), `InvalidFitHeaderError` (bad header length or magic mismatch), `FitCrcError` (computed CRC mismatch), `NoRecordMessagesError` (parser returned zero records). `loadFitFromBuffer` is sync (no `async` keyword); `loadFitFromPath` awaits `fs/promises.readFile` and delegates to the sync entry. `mode: 'list'` pinned per RESEARCH §Pitfall 2; `force: false` so the parser doesn't try to recover header errors silently. Sync-callback `parse(buf, callback)` form is used so `loadFitFromBuffer` can stay sync per D-FIT-07. Compile-time-only `FitRecordSource` interface seam is the parser-swap point (D-FIT-08); not exported. **`detectAndLogShadow` emits `util.debuglog('trainer-sim:fit')` and CONTINUES — does NOT throw** per D-FIT-10 (FIT-05 amended 2026-05-16); RESEARCH §Pattern 3's "throw the typed shadow-error class" guidance is documented as superseded.
- **`src/index.ts` (5 → 22 lines)**: extends Phase 1's encoder + `IndoorBikeRecord` exports with Phase 2's surface — value re-exports of `loadFitFromPath`, `loadFitFromBuffer`, `FitLoadError`, `InvalidFitHeaderError`, `FitCrcError`, `FitTruncatedError`, `NoRecordMessagesError`, plus type-only re-export of `RideRecord` (verbatimModuleSyntax compliance). Does NOT export `FitRecordSource` (D-FIT-08 internal seam) or any typed shadow-error class (D-FIT-10). All relative specifiers carry `.js` extensions per Phase 1 convention. No `export *`; named exports only — keeps `publint` clean.
- **End-to-end correctness verified against all seven Wave 2 fixtures** before commits landed:
  | Fixture                       | Records via dist CJS | Notes                                                                         |
  | ----------------------------- | -------------------- | ----------------------------------------------------------------------------- |
  | basic.fit                     | 443                  | clean 1Hz                                                                     |
  | zero-power.fit                | 541                  | preserves real `0` watts per D-FIT-01                                         |
  | duplicates.fit                | **689** (source 702) | D-FIT-03 dedup keep-first dropped 13 duplicates (matches D-FIT-05 mapping)    |
  | dev-fields-non-shadow.fit     | 2501                 | dev fields present but non-shadow names — no debuglog warning                 |
  | autopause.fit                 | 3172                 | autopause gaps preserved as plain timestamp jumps per D-FIT-02                |
  | perf-1hr.fit                  | 4562                 | ~76 min file ready for Wave 4's <100 ms gate                                  |
  | shadow.fit                    | 30                   | dev-power shadow case — debuglog emitted, NO throw, returns parser's value    |
- **Error paths smoke-verified:** empty buffer → `FitTruncatedError`; bad magic bytes → `InvalidFitHeaderError`; corrupted CRC trailer of `basic.fit` → `FitCrcError`. All instances of the abstract `FitLoadError` base class for `instanceof FitLoadError` catch-surface use.

## Task Commits

Each task committed atomically on `worktree-agent-a44775616c052725e`:

1. **Task 1: Implement `src/fit/normalize.ts`** — `0f20d12` (`feat(02-03): add FIT normalize (sort, dedup, Date->ms, debuglog) per D-FIT-01..03/09`)
2. **Task 2: Implement `src/fit/loader.ts`** — `802965b` (`feat(02-03): add FIT loader entry points (header/CRC, shadow-debuglog, FitRecordSource seam) per D-FIT-06..08, D-FIT-10`)
3. **Task 3: Re-export FIT public API from `src/index.ts`** — `16997f9` (`feat(02-03): re-export FIT loader public API from src/index.ts`)

The orchestrator commits SUMMARY.md (and any shared-file updates) post-merge — this agent does NOT touch STATE.md / ROADMAP.md from inside the worktree.

## Confirmation Items (per plan `<output>`)

- **Line counts**: `src/fit/normalize.ts` = 110 lines (plan estimate ~50; came in higher because the JSDoc/comments thoroughly cite each locked decision and the relevant RESEARCH pitfalls per the project's documentation style). `src/fit/loader.ts` = 269 lines (plan estimate ~140; same reason — the inlined CRC table is 8 lines, the validation function is heavily documented because plan 02-04's tests will assert against each error path).
- **Single `fit-file-parser` import lives in `src/fit/loader.ts`**: `grep -rE "from\s+['\"]fit-file-parser['\"]" src/ | grep -v 'src/fit/loader.ts' | wc -l` → **0** (D-FIT-08 seam intact).
- **`DeveloperFieldShadowError` does NOT appear anywhere in `src/*`**: `grep -rcF 'DeveloperFieldShadowError' src/` reports `0` for every file (D-FIT-10 lock honored at the module level — plan 02-01 already grep-banned it in `src/fit/errors.ts`; this plan grep-bans it in `src/fit/loader.ts` and `src/index.ts`).
- **`npm run build`**: green (ESM 6.54 KB, CJS 6.97 KB, d.ts 10.19 KB, d.cts 10.19 KB).
- **`npm run typecheck:test`**: green (no output / exit 0).
- **`npm run validate:publint`**: `Linting... All good!`.
- **`npm run validate:attw`**: `No problems found 🌟` — `node10 / node16-CJS / node16-ESM / bundler` all green.
- **End-to-end CJS dist smoke**: `node -e "...require('./dist/index.cjs').loadFitFromBuffer(readFileSync('test/fixtures/fit/basic.fit'))..."` returns **443 records** (matches D-FIT-05 mapping).
- **Tests for the loader and normalize live in plans 02-04 and 02-05** — this plan ships the source the tests assert against (plan 02-04 tests `loader` / error paths / dev-field shadow / perf gate; plan 02-05 tests `normalize` directly for D-FIT-01..03 + D-FIT-09 debuglog).

## Decisions Made

All decisions are pre-locked in `02-CONTEXT.md` (D-FIT-01 through D-FIT-10) and Phase 1 conventions (`.js` extension on relative specifiers, dual ESM+CJS publish, `verbatimModuleSyntax`). Two execution-time decisions are recorded in the frontmatter:

- **`FIT_FIELDS` registry pattern deferred to v2** (per the plan's task-1 action note). With only `power` and `cadence` as optional fields, the conditional `!== undefined` shape is shorter and equally auditable. The pattern reappears in v2 when `RideRecord` widens to `speed` / `heart_rate` per REQUIREMENTS.md FTMS-06/07.
- **`FitRecordSource` is a compile-time TypeScript interface** per CONTEXT "Claude's Discretion" — promoting to a runtime object is deferred until a test seam demands it (Phase 4 ESLint rule on the parser-import scope is also CONTEXT-deferred).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Tightened JSDoc to satisfy literal-grep acceptance criteria**

- **Found during:** Task 1 (initial Task 1 verification grep).
- **Issue:** First draft of `src/fit/normalize.ts` used `/** ... */` JSDoc that mentioned `fit-file-parser` four times and read `elapsed_time` / `timer_time` once. The plan's acceptance criteria are literal `grep -F 'fit-file-parser' ... | grep -v '^[[:space:]]*//'` and `grep -E '(elapsed_time|timer_time)' ... | grep -v '^[[:space:]]*//'`. The `grep -v` only filters lines that START with `//` — `/** ... */` JSDoc lines (which start with ` * `) are NOT filtered, so any literal occurrence inside the JSDoc fails the check.
- **Fix:** Rewrote the file header from `/** ... */` to plain `// ...` lines, replaced literal `fit-file-parser` references with phrases like "the parser dependency", and replaced literal `elapsed_time` / `timer_time` references with a generic "elapsed-or-timer keys" phrase that still preserves the RESEARCH §Pitfall 8 cross-reference.
- **Files modified:** `src/fit/normalize.ts`.
- **Verification:** Both literal-grep counts now report `0`; the JSDoc still cites the relevant pitfall numbers and locked decisions for future readers.
- **Committed in:** `0f20d12` (the rewording was applied before the commit, not after).

**2. [Rule 1 - Bug] Same-class issue in `src/fit/loader.ts` for `DeveloperFieldShadowError`**

- **Found during:** Task 2 (initial Task 2 verification grep).
- **Issue:** First draft of `src/fit/loader.ts`'s JSDoc on `detectAndLogShadow` mentioned the literal symbol `DeveloperFieldShadowError` once when explaining that RESEARCH §Pattern 3 / Code Examples Example 1 show "throw `DeveloperFieldShadowError`" but that the guidance is superseded by D-FIT-10. The plan's acceptance criterion `grep -cF 'DeveloperFieldShadowError' src/fit/loader.ts` must report `0`.
- **Fix:** Reworded the JSDoc to read "throw the stale-name shadow-error class" — keeps the cross-reference to RESEARCH §Pattern 3 / Code Examples Example 1 intact (so future copy-paste mistakes are still grep-banned by humans reading the comment) but removes the literal symbol that would invite a future executor to import it.
- **Files modified:** `src/fit/loader.ts`.
- **Verification:** `grep -cF 'DeveloperFieldShadowError' src/fit/loader.ts` → `0`; the rest of the Task 2 acceptance greps still pass; the smoke checks against `shadow.fit` still emit the expected debuglog warning.
- **Committed in:** `802965b` (rewording applied before the commit).

---

**Total deviations:** 2 auto-fixed (both grep-driven JSDoc tightenings — same pattern as plan 02-01's deviation §1 ["Tightened JSDoc to satisfy acceptance grep regex"]).
**Impact on plan:** Neither deviation changed source-of-truth behavior. Both preserve the plan's intent more strongly (D-FIT-08 + D-FIT-10 locks tighter at the comment level too).

## Issues Encountered

None beyond the two grep-driven JSDoc tightenings above.

## TDD Gate Compliance

This plan's tasks are tagged `tdd="true"` in the frontmatter, but the plan-level `type: execute` (not `type: tdd`) and the `<behavior>` blocks explicitly state: "Tests for these behaviors live in plan 02-04 / 02-05. This task ships the implementation those tests assert against." Wave 4 is the test wave; Wave 3 is the source wave. The git log for this plan therefore correctly contains three `feat(02-03)` commits and no `test(02-03)` RED commits — the RED commits will appear in plan 02-04 (loader / error-paths / dev-field-shadow / perf) and plan 02-05 (normalize).

For the executor's MVP+TDD gate: the runtime gate is NOT active in this phase per `.planning/config.json` (no MVP_MODE / TDD_MODE flags propagated by the orchestrator), so the gate's behavior-adding-task halt does not fire here.

## Threat Flags

None. The plan implements every `<threat_model>` mitigation enumerated in source:

- **T-02-10 (Tampering / corrupt CRC):** `validateHeaderAndCrc` recomputes CRC-16/ARC over `[crcRangeStart, crcStart)` and throws `FitCrcError` on mismatch. Smoke-verified by intentionally flipping the last 2 bytes of `basic.fit`'s trailer → `FitCrcError` fires.
- **T-02-11 (DoS via large file):** accepted per CONTEXT "Deferred Ideas" — no source change.
- **T-02-12 (Spoofing / dev-field shadow):** mitigation per D-FIT-10 is *visibility*, not rejection. `detectAndLogShadow` emits `util.debuglog('trainer-sim:fit')` on every shadow event; smoke-verified against `shadow.fit` (debuglog message reaches stderr when `NODE_DEBUG=trainer-sim:fit` is set; `loadFitFromBuffer` does NOT throw and returns the parser's `record.power = 999` as-is).
- **T-02-13 (Info disclosure in errors):** accepted — error messages contain hex-formatted CRC values and offsets, which are developer-facing diagnostics.
- **T-02-14 (Future src/* file imports parser):** `grep -rE "from\s+['\"]fit-file-parser['\"]" src/ | grep -v 'src/fit/loader.ts' | wc -l` → `0` enforced at this plan's verify step. Phase 4 ESLint rule per CONTEXT "Deferred" will lint-enforce.
- **T-02-15 (`mode: 'list'` removed in future PR):** acceptance criterion `grep -E "mode:\s*['\"]list['\"]" src/fit/loader.ts` enforces the pin.
- **T-02-16 (DeveloperFieldShadowError sneaks back):** plans 02-01, 02-03 grep-ban the symbol in `src/fit/errors.ts`, `src/fit/loader.ts`, `src/index.ts` — verified `0` in all three files.

## Next Plan Readiness (02-04 / 02-05)

- Plan 02-04 (loader + error-paths + dev-field-shadow + perf tests) can:
  - import `loadFitFromPath`, `loadFitFromBuffer`, `FitLoadError`, `InvalidFitHeaderError`, `FitCrcError`, `FitTruncatedError`, `NoRecordMessagesError` from `../../src/index.js` (the public surface) OR directly from `../../src/fit/loader.js` / `../../src/fit/errors.js` (internal seams);
  - read `test/fixtures/fit/basic.fit` for FIT-01 path/buffer parity;
  - read `test/fixtures/fit/autopause.fit`, `zero-power.fit`, `dev-fields-non-shadow.fit` for FIT-04 "valid-but-weird shapes load without throwing";
  - read `test/fixtures/fit/shadow.fit` for FIT-05 / D-FIT-10 shadow-debuglog assertion (loader MUST NOT throw — the test asserts `() => loadFitFromBuffer(buf)` does not throw AND that `util.debuglog('trainer-sim:fit')` emits a message naming the field when `NODE_DEBUG=trainer-sim:fit` is set);
  - hand-corrupt `basic.fit`'s trailer to assert `FitCrcError` (smoke-verified above; the test pattern is: `Buffer.from(buf); flip(corrupt[len-2]); flip(corrupt[len-1]); expect(() => loadFitFromBuffer(corrupt)).toThrow(FitCrcError)`);
  - import `test/fixtures/minimal-fit-bytes.ts` (from plan 02-02) to construct a valid header + file_id + zero record messages buffer for the `NoRecordMessagesError` test;
  - read `test/fixtures/fit/perf-1hr.fit` for the FIT-02 <100 ms perf gate.
- Plan 02-05 (normalize tests) can:
  - import `normalize` directly from `../../src/fit/normalize.js` (the function is exported even though `src/index.ts` does NOT re-export it — internal API surface, tested directly);
  - construct `ParsedFitMinimal` POJOs in tests (no FIT bytes required) to exercise:
    - Date → Unix ms via `.getTime()` (FIT-03);
    - wire `0` preserved (D-FIT-01);
    - `undefined` omitted (D-FIT-01);
    - sort ascending (D-FIT-03);
    - dedup keep-first (D-FIT-03);
    - `util.debuglog` drop-count messages (D-FIT-09).

## Self-Check: PASSED

- `src/fit/normalize.ts` — FOUND (110 lines; exports `normalize`; no `fit-file-parser` import; uses `.getTime()`; uses `!== undefined`; no `??` on power/cadence; no `console`; no `elapsed_time`/`timer_time`)
- `src/fit/loader.ts` — FOUND (269 lines; single `from 'fit-file-parser'` import; both entry points exported with correct sync/async signatures; `mode: 'list'` pinned; `parse(buf, callback)` form used; all four FitLoadError subclasses thrown; `debuglog('trainer-sim:fit')` channel used; `FitRecordSource` interface defined and NOT exported; CRC table boundaries `0xCC01` and `0x4400` present; no `parseAsync`; no `console`; no `DeveloperFieldShadowError`)
- `src/index.ts` — FOUND (22 lines; Phase 1 exports preserved; Phase 2 value re-exports of loaders + 5 error classes; type-only re-export of RideRecord; `.js` extensions on every relative; no `export *`; no `DeveloperFieldShadowError`; no `FitRecordSource`)
- `dist/index.js` and `dist/index.cjs` both contain `loadFitFromBuffer` and `FitLoadError` symbols — VERIFIED
- `dist/index.d.ts` and `dist/index.d.cts` both contain `RideRecord` and `FitLoadError` types — VERIFIED
- D-FIT-08 seam intact: `grep -rE "from\s+['\"]fit-file-parser['\"]" src/ | grep -v 'src/fit/loader.ts' | wc -l` → `0`
- D-FIT-10 lock intact: no occurrence of `DeveloperFieldShadowError` anywhere in `src/`
- Commit `0f20d12` (Task 1 normalize) — FOUND in `git log`
- Commit `802965b` (Task 2 loader) — FOUND in `git log`
- Commit `16997f9` (Task 3 index re-exports) — FOUND in `git log`
- `npm run build` exit 0 — VERIFIED
- `npm run typecheck:test` exit 0 — VERIFIED
- `npm run validate:publint` exit 0 — VERIFIED
- `npm run validate:attw` exit 0 — VERIFIED
- End-to-end CJS dist parses `basic.fit` to 443 RideRecords — VERIFIED
- Phase 1's existing `npm test` (17 tests) still passes — VERIFIED

---

*Phase: 02-fit-loader-normalization*
*Plan: 03*
*Completed: 2026-05-16*
