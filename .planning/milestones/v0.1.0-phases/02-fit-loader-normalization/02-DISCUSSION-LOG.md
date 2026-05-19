# Phase 2: FIT Loader & Normalization — Discussion Log

**Date:** 2026-05-16
**Mode:** discuss (default)
**Outcome:** CONTEXT.md written, ready for `/gsd-plan-phase 2`

This is a human-readable audit trail of the discuss-phase session. NOT consumed
by downstream agents — they read `02-CONTEXT.md` directly.

---

## Gray Areas Presented

The orchestrator analyzed Phase 2 and offered four gray-area options. The user
selected three (and locked the fourth as already-decided per STACK.md):

| # | Area | User selection |
|---|------|----------------|
| 1 | FIT parser final pick | **Locked** — `fit-file-parser@3.0.0` per STACK.md HIGH-confidence recommendation; not re-discussed |
| 2 | RideRecord shape & gap semantics | Selected |
| 3 | Test fixture strategy (no bundling) | Selected |
| 4 | Error surface & validation | Selected |

---

## Discussion: RideRecord Shape & Gap Semantics

### Q: Power & cadence optionality on RideRecord
**User clarification request:** "what does a real trainer data look like, null, undefined or zero?"

Orchestrator's reformulated answer surfaced the wire-level distinctions:
- FIT spec writes invalid-sentinel (`0xFFFF` for uint16, `0xFF` for uint8) for sensor-disconnect
- `fit-file-parser@3.x` normalizes invalid-sentinel to JS `null` (or omits the field)
- Real `0` means coasting / clipped-in stopped — a genuine reading
- Autopause = entire `record` messages stop being emitted (gap in array, not null field)
- TrainerRoad / Zwift typically populate power; TrainerRoad sometimes also writes a developer-defined `power` field (FIT-05 hazard)

Options presented:
1. Optional fields (preserve absent vs zero) ← **selected**
2. Nullable fields (preserve absent vs zero, explicit)
3. Always-present numbers, lossy collapse

**Decision:** D-FIT-01 — `RideRecord = {timestamp, power?, cadence?}`. Loader normalizes wire `null`/missing to JS `undefined` (omitted property); real `0` stays `0`. Honest to the wire; lets Phase 1 encoder cleanly skip the flag bit when undefined.

### Q: Autopause gap handling
Options presented:
1. Preserve as time gaps ← **selected**
2. Backfill gap with placeholder records
3. Mark gap explicitly with a discriminator

**Decision:** D-FIT-02 — Loader emits records as-is; timestamps just jump. Phase 3 scheduler decides gap policy. Honest replay; matches "Bring Your Own FIT" philosophy.

### Q: Time ordering & dedup guarantees
Real Garmin/Wahoo files occasionally emit out-of-order or duplicate `record` messages.

Options presented:
1. Sort + dedup by timestamp ← **selected**
2. Pass through as-is
3. Sort, but throw on duplicates

**Decision:** D-FIT-03 — Sort ascending by timestamp; drop exact-duplicate timestamps (keep-first). FIT-02 says "time-ordered" so the loader enforces it. Drops surfaced in load metadata for debugging (D-FIT-09).

---

## Discussion: Test Fixture Strategy

### Q: Where does FIT test data come from, given PROJECT.md's "no bundled fixtures" rule?
Options presented:
1. Generate minimal FIT in TS at test time
2. Local-dev-only fixture path, CI skips real-world tests
3. Both — generate-on-test for CI, opt-in real for local ← **selected**

**Decision:** D-FIT-04 — Two-tier: CI tier uses synthetic FIT; local-dev tier uses `TEST_FIT_DIR` env var to opt into real Garmin/Wahoo files.

### Q: How should the synthetic FIT bytes get produced?
Options presented:
1. Hand-roll a minimal FIT writer (TS, ~150 lines, spec-cited)
2. Use a third-party FIT writer dev-dep
3. Pre-recorded synthetic `.fit` binaries in test/fixtures/ ← **selected**

**Decision:** D-FIT-05 — Pre-recorded synthetic `.fit` binaries committed under `test/fixtures/`. Each has a sibling `.md` documenting what it represents. PROJECT.md's no-bundle rule applies to runtime assets; test binaries are fine. One-shot generator script does NOT run in CI; bytes are committed.

This refines D-FIT-04: the CI tier becomes the committed binaries (not generated-at-test).

---

## Discussion: Error Surface & Validation

### Q: What happens for corrupt input or zero-record FIT files?
Options presented:
1. Throw typed errors, fail fast ← **selected**
2. Throw a single generic FitLoadError with a code
3. Result-style return (no throws)

**Decision:** D-FIT-06 — Typed Error subclasses (`FitLoadError` base + `InvalidFitHeaderError`, `FitCrcError`, `FitTruncatedError`, `NoRecordMessagesError`). FIT-04's "load without throwing" applies to *valid-but-weird* files (gaps, sparse, null power), NOT corrupt input.

### Q: Public API shape — sync/async, one entry or two?
Options presented:
1. Single async loadFit(input)
2. Two entry points: loadFitFromPath / loadFitFromBuffer ← **selected**
3. Sync everywhere with optional async helper

**Decision:** D-FIT-07 — `loadFitFromPath(path): Promise<RideRecord[]>` (async, reads file) + `loadFitFromBuffer(input): RideRecord[]` (sync). Path version delegates to buffer version internally.

---

## Locked from Upstream (Not Re-Decided)

- D-FIT-08 — Parser is `fit-file-parser@3.0.0` (per STACK.md HIGH-confidence: MIT, dual ESM+CJS, types, license posture decisive)
- Wrap parser behind `FitRecordSource` interface (one-file swap; per STACK.md mitigation)
- File layout: `src/fit/loader.ts` + `src/fit/normalize.ts` (per ARCHITECTURE.md)
- Perf gate: <100 ms parse for typical 1-hour file (per ROADMAP.md)

---

## Continue or Write?

User chose: **Write CONTEXT.md** — three selected areas covered; remaining
unknowns (perf budgeting, parser-internal options) are research-shaped, not
user-decision-shaped.

---

## Deferred Ideas Captured

(see `02-CONTEXT.md` `<deferred>` section for the full list)

- `RideRecord.speed` and heart rate fields (v2)
- ReadableStream input source (v1.x)
- `@garmin/fitsdk` alternate parser behind `FitRecordSource`
- Richer load-metadata API (`loadFitWithDiagnostics`)
- Lint-ban on `fit-file-parser` imports outside `src/fit/`

---

*Phase: 2-fit-loader-normalization*
*Discussion: 2026-05-16*
