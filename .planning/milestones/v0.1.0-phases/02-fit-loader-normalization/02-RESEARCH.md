# Phase 2: FIT Loader & Normalization — Research

**Researched:** 2026-05-16
**Domain:** Garmin/Wahoo FIT file parsing, normalization, and `RideRecord[]` extraction
**Confidence:** HIGH (`fit-file-parser` API surface, FIT epoch math, perf gate, fixture strategy) / MEDIUM (FIT-05 dev-field defense — see §Critical Finding) / LOW (none — all claims VERIFIED against the installed package, source code, or live execution)

## Summary

This phase wraps `fit-file-parser@3.0.0` behind a `FitRecordSource` seam, exposes
`loadFitFromPath` (async) and `loadFitFromBuffer` (sync) entry points that return a
normalized `RideRecord[]`, and pins a synthetic-fixture strategy that stays inside
PROJECT.md's "no bundled rides" rule. The encoder math from Phase 1 stays untouched;
this phase introduces the typed `FitLoadError` hierarchy that future phases will extend.

**The risk is concentrated in two places.** First, **`fit-file-parser` 3.0 collapses
developer-defined fields onto the same key as standard fields**: a TrainerRoad-style
file with a developer field named `power` returns `record.power = <dev value>` and
silently overwrites standard FIT message-num=20/field-num=7 power. This was confirmed
by direct execution against a hand-crafted test FIT (`/tmp/fit-test/dev.fit` in this
session). The locked decision FIT-05 says "read by `(message-num, field-num)`" — the
parser does not surface that tuple in its output, so we must mitigate at our seam.
Three viable options, ranked: (a) detect the conflict via `field_descriptions[]` and
**reject the file** with a typed `DeveloperFieldShadowError` (cheap, honest, surfaces
the issue), (b) post-process by re-reading the FIT bytes ourselves at the (msg, field)
level, (c) switch parsers to `@garmin/fitsdk` which **does** isolate dev fields under
`record.developerFields[fieldNum]`. Recommended path: **(a) for v1**, with a clear
upgrade path to (c) if a real consumer hits the case. The FitRecordSource seam already
exists for this reason.

**Second, `fit-file-parser` 3.0 has CRC validation commented out** ("TODO: fix Header
CRC check" / "TODO: fix File CRC check" — verified in `src/fit-parser.ts` lines 105
and 122). It will silently accept a corrupt file. We need to do CRC validation
ourselves in `loader.ts` if D-FIT-06 (`FitCrcError`) is to mean anything.

**Primary recommendation:** Implement `loader.ts` as: (1) basic header check (12/14
bytes, magic `.FIT`), (2) CRC-16/ARC of body + trailer (since parser doesn't), (3)
delegate to `parseAsync` with `mode: 'list'` (which is the actual default — README
says "cascade", source says "list"), (4) walk `result.field_descriptions` first to
detect dev-field shadowing for the standard fields we care about (`power`, `cadence`,
`timestamp`) and throw `DeveloperFieldShadowError` if hit, (5) sort + dedup records
in `normalize.ts` per D-FIT-03. Use `@garmin/fitsdk`'s built-in encoder as a dev-only
fixture-generation tool (Apache-license-style, but only at fixture-build time and
not redistributed). Commit ~5 small `.fit` binaries (≤30 KB total) under
`test/fixtures/fit/`. Perf gate is comfortable: synthetic 1-hour 1Hz file parses in
**1.85 ms median** (50× headroom against the <100 ms gate).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**RideRecord Shape & Gap Semantics**
- **D-FIT-01:** `RideRecord = { timestamp: number; power?: number; cadence?: number }` — optional fields. Loader normalizes wire `null` and missing-field cases to JS `undefined` (omitted property); a real `0` from the wire stays `0`. This preserves the wire-level distinction between "rider coasting (0 W)" and "sensor disconnected (no reading)" — important for VeloWorld's "no power signal" UI semantics. Phase 1 encoder already gates the flag bit on `value === undefined`; this lines up cleanly.
- **D-FIT-02:** Autopause gaps are preserved as plain timestamp jumps in `RideRecord[]` — the loader emits records exactly as the FIT file recorded them. No backfill, no tagged-union `{kind: 'gap'}`. Phase 3 scheduler owns the gap policy (fast-forward, real-time-pause, skip). Honest replay; matches the "Bring Your Own FIT" philosophy in PROJECT.md.
- **D-FIT-03:** Loader returns records sorted ascending by timestamp; drops exact-duplicate timestamps (keep-first). Real Garmin/Wahoo files occasionally emit out-of-order or duplicate `record` messages (clock-skew correction, multi-pass smart recording, file concatenation tooling); FIT-02 says "time-ordered" so the loader enforces that here, sparing Phase 3 defensive monotonic-timestamp checks. Drop count is exposed in the load result so debugging isn't blind (see D-FIT-09).

**Test Fixture Strategy**
- **D-FIT-04:** Two-tier fixture strategy:
  - **CI tier:** committed pre-recorded synthetic `.fit` binaries under `test/fixtures/` covering the FIT-01..05 structural matrix (basic ride, autopause, sparse cadence, null power, TrainerRoad-style developer-defined `power` field). Runs in CI, no external dependencies, fully reproducible.
  - **Local-dev tier:** an opt-in suite gated on `TEST_FIT_DIR` env var; when set, runs against the developer's actual Garmin/Wahoo exports as a smoke pass. Runs locally before release, skipped in CI.
- **D-FIT-05:** Synthetic `.fit` binaries are pre-recorded, NOT generated at test time. PROJECT.md's "consumers bring their own — don't bundle fixtures" rule applies to *runtime* assets; test binaries don't ship to consumers. Each `.fit` file has a sibling `.md` documenting what it represents (record count, gap structure, dev fields, anomalies) so the bytes don't become opaque. The one-shot generator script lives in `test/fixtures/generate.ts` (or similar) but does not run in CI — fixtures are committed bytes.

**Error Surface**
- **D-FIT-06:** Typed `Error` subclasses, fail-fast for corrupt input. Hierarchy:
  - `FitLoadError` (abstract base) — consumers can `catch (e instanceof FitLoadError)` for generic handling
  - `InvalidFitHeaderError` — bad magic / wrong header bytes
  - `FitCrcError` — CRC mismatch
  - `FitTruncatedError` — file ends mid-message
  - `NoRecordMessagesError` — valid FIT but zero `record` messages (workout-only file, GPX export mislabeled)
  FIT-04's "load without throwing" applies to *valid* files with weird shapes (gaps, sparse, null power), NOT to corrupt/wrong-type input. Trainer-sim is a developer test tool — silent fallbacks would corrupt downstream replay; loud, actionable failures are the right default.

**Public API Shape**
- **D-FIT-07:** Two entry points:
  ```ts
  export async function loadFitFromPath(path: string): Promise<RideRecord[]>;
  export function loadFitFromBuffer(input: Buffer | Uint8Array): RideRecord[];
  ```
  `loadFitFromPath` reads the file via `fs.readFile` then delegates to `loadFitFromBuffer`. Both throw the D-FIT-06 errors. `loadFitFromBuffer` is sync because `fit-file-parser` is sync once bytes are in memory. Both are re-exported from `src/index.ts`.

**Parser Choice (locked from STACK.md)**
- **D-FIT-08:** Parser is `fit-file-parser@3.0.0` (MIT, dual ESM+CJS, ships TS types, Node ≥20). STACK.md's HIGH-confidence recommendation: license posture is the deciding factor (Garmin SDK has a custom license and is ESM-only with no first-party types). The parser is wrapped behind a `FitRecordSource` internal interface so swapping to `@garmin/fitsdk` later is a one-file change (per STACK.md "Mitigation: keep the parser behind an interface").

**Load Result Metadata (debugging surface)**
- **D-FIT-09:** When the loader drops out-of-order or duplicate records (D-FIT-03), it surfaces the count via load metadata. Implementation choice between (a) returning a richer object `{ records, dropped: { duplicates, outOfOrder } }` from `loadFitFromBuffer` and (b) keeping the array return shape and exposing drops via a separate `getLastLoadDiagnostics()` accessor or via a debug-channel. Open question for the planner — the user wants the count visible somewhere, exact API shape is delegate-able. Default if unspecified: return `RideRecord[]` from the public API and log dropped-count to stderr at `debug` level only (not `console.warn` — too noisy for test output).

### Claude's Discretion
- File-level layout inside `src/fit/`: `loader.ts` + `normalize.ts` per ARCHITECTURE.md is the strong default; collapsing to a single `src/fit/index.ts` is fine if it reads cleaner once written.
- Helper naming inside the FIT module (`fitEpochToUnixMs`, `extractRecordMessages`, etc.) — taste-level.
- Whether `FitRecordSource` is a TypeScript interface or a runtime object — interface (compile-time only) is the lighter pick; promote to runtime only if the test seam demands it.
- How to write the synthetic `.fit` fixtures: hand-rolled FIT writer, third-party dev-dep, or a one-time recording from a real device with PII scrubbed — researcher / planner picks the path with lowest cost. The constraint is just that the resulting bytes are committed and documented (D-FIT-05).
- Specific `fit-file-parser` options (e.g. `force_index_to_message`, type-conversion knobs) — researcher will pin these against real files to confirm null/0 wire semantics survive.

### Deferred Ideas (OUT OF SCOPE)
- `RideRecord.speed` as a third optional field. Out of scope for v1 per REQUIREMENTS.md FTMS-06 (deferred to v2).
- Heart rate field in `RideRecord`. Same — REQUIREMENTS.md FTMS-07, v2.
- ReadableStream as a third FIT input source. REQUIREMENTS.md out-of-scope ("Buffer | path covers test patterns; streaming defers to v1.x").
- `@garmin/fitsdk` as an alternate parser source behind the same `FitRecordSource` interface. D-FIT-08 picks `fit-file-parser`. If we hit a real file `fit-file-parser` mis-decodes, the seam exists to add Garmin's SDK in a sibling module — no rewiring of the loader's public contract.
- Richer load metadata (drop counts, parser warnings). D-FIT-09 keeps the public API as `RideRecord[]` returning. If real-world use later needs more visibility, add a separate `loadFitWithDiagnostics(input)` returning `{ records, diagnostics }` rather than widening the simple signature.
- Performance tuning beyond the <100 ms gate. ROADMAP says "<100 ms parse for typical 1-hour file." If `fit-file-parser` clears that on real files, leave it. Buffer pooling, streaming-parse, or worker-thread offload are all v2 / on-demand concerns.
- Lint-ban on `fit-file-parser` imports outside `src/fit/`. Possibly added in Phase 4 ESLint setup. For Phase 2, enforced by code review only.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| FIT-01 | Library loads a FIT file from a filesystem path or in-memory Buffer | `loadFitFromPath` reads via `fs/promises.readFile` then delegates to `loadFitFromBuffer`; both produce identical `RideRecord[]` because the path entry is a thin wrapper (D-FIT-07). |
| FIT-02 | Loader extracts `record` messages and exposes them as a normalized, time-ordered `RideRecord[]` | `result.records` from `mode: 'list'` is the flat record array; `normalize.ts` maps each → `{timestamp, power?, cadence?}`, sorts ascending, drops dup-timestamps (D-FIT-03). |
| FIT-03 | Loader converts FIT timestamps (seconds since 1989-12-31 UTC) to Unix epoch correctly | **`fit-file-parser` already does this** — verified by execution: `record.timestamp` is a JavaScript `Date` object (not a number, despite the type declaration calling it `string`). Conversion is `new Date(seconds * 1000 + 631065600000)` per `binary.ts:12`. We extract via `record.timestamp.getTime()` to get Unix epoch ms. |
| FIT-04 | Loader handles real-world Garmin/Wahoo files with autopause gaps, sparse smart-recording records, and null power values without throwing | `fit-file-parser` strips FIT "invalid" sentinels automatically (e.g., uint8 cadence=255 returns `cadence: undefined` — verified). Records with no power show up missing the `power` key entirely. Autopause gaps appear as natural timestamp jumps; we preserve them per D-FIT-02. |
| FIT-05 | Loader reads standard fields by `(message-num, field-num)` so developer-defined fields never shadow the standard ones | **CRITICAL: `fit-file-parser` does NOT surface (msg-num, field-num) in its output and DOES collide developer-defined `power` onto standard `record.power` — verified by execution**. See §Critical Finding: Developer-Field Shadowing for the three mitigation paths. Recommended: detect via `result.field_descriptions[]` and throw `DeveloperFieldShadowError`. |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| FIT byte parsing (header, CRC, definition msgs, data msgs) | Source layer (`src/fit/loader.ts`) | — | Wraps `fit-file-parser` 3.0; the parser is a thin import behind a `FitRecordSource` interface so swapping to `@garmin/fitsdk` later is a one-file change. Loader also does the CRC + header validation that the parser skips. |
| FIT-record → `RideRecord` normalization | Source layer (`src/fit/normalize.ts`) | — | Pure function over the parser's output. Sorts, dedups, drops invalid sentinels, converts `Date` → ms. No I/O. |
| `RideRecord` type | Types layer (`src/types.ts`) | Public API (`src/index.ts` re-export) | Type is authored in `src/types.ts` (per ARCHITECTURE.md "types are the contract everyone signs"); re-exported from package root for Phase 3/4 consumers. |
| `FitLoadError` hierarchy | Source layer (`src/fit/errors.ts` or `src/fit/loader.ts`) | Public API (re-exported) | First typed-error hierarchy in the project. Future phases (replay timeouts, transport failures) follow the same `extends FitLoadError`-style pattern. |
| Public `loadFitFrom*` API | Public API (`src/index.ts`) | — | Two named re-exports of the loader's entry points; `RideRecord` and the four error classes accompany. |
| Synthetic `.fit` fixture bytes | Test fixtures (`test/fixtures/fit/`) | One-shot generator (`test/fixtures/fit/generate.mts`, NOT in CI) | Bytes are committed; generator is committed for reproducibility but never runs in CI. PROJECT.md "no bundled fixture FIT files" applies to runtime/published artifacts, not test fixtures (per D-FIT-05). |
| Developer-field shadow detection | Source layer (`src/fit/loader.ts`) | — | The mitigation for FIT-05 lives at the loader boundary — before normalization. Walks `result.field_descriptions[]` and throws if a dev field name collides with a watched standard name. |

**Why this matters:** Without the `FitRecordSource` seam, the (likely future) parser
swap to `@garmin/fitsdk` would touch the replay engine, the public API, and the test
suite. With the seam, `loader.ts` is the only file that imports
`fit-file-parser`, and a swap is a one-file change.

## Standard Stack

### Core (locked by CLAUDE.md / Phase 1 inheritance)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js | 24 LTS, `engines: ">=24.0"` | Runtime | Inherited from Phase 1; VeloWorld parity. `[VERIFIED: locally → node v24.15.0]` |
| TypeScript | `5.9.3` | Type system, strict | Phase 1 lock. `[VERIFIED: package.json devDependencies → ~5.9.3]` |
| tsup | `8.5.x` | Library builder | Phase 1 lock; same single entry adds `loadFit*` re-exports without restructuring. |
| vitest | `4.1.x` | Test runner | Phase 1 lock; this phase adds `test/fit/*.test.ts` suites. |
| `@types/node` | `~24.12.4` | `Buffer`, `fs/promises`, `util.debuglog` typings | Phase 1 lock. |

### Phase 2 additions

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `fit-file-parser` | `3.0.0` | FIT file parsing (production dep) | **D-FIT-08 LOCKED.** MIT, dual ESM+CJS, ships TS types, last-published 2026-05-09 (one week ago). `[VERIFIED: npm view fit-file-parser version → 3.0.0; published a week ago by jimmykane]`. Direct dep is `buffer@^6.0.3` (browser-buffer polyfill — irrelevant on Node, no install footprint pain). |

### Phase 2 dev-only additions (fixture generation, NOT runtime)

| Library | Version | Purpose | Why |
|---------|---------|---------|-----|
| `@garmin/fitsdk` | `21.202.0` | **Fixture generator only** — has a built-in `Encoder` class that writes spec-correct FIT bytes, used to mint the synthetic `.fit` binaries. Lives under `devDependencies`; never imported from `src/`. | `[VERIFIED: /tmp/fit-test/node_modules/@garmin/fitsdk/src/encoder.js exists]`. Hand-rolling a FIT writer correctly is **multiple hundreds of lines** of CRC + endian + definition-message bookkeeping — STACK.md's Garmin license concern is for a *runtime* dep we'd ship; for a one-shot dev script that produces committed bytes, the license question is materially smaller (we are not redistributing Garmin's encoder, only its output, and bytes are not copyrightable). However, see §Fixture Strategy below for the legal vs. cost tradeoff and the "hand-roll a tiny writer" alternative. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `fit-file-parser@3` | `@garmin/fitsdk@21.202.0` (Garmin's official SDK) | **Garmin's SDK correctly isolates dev fields under `record.developerFields[fieldNum]` — no shadowing risk.** Verified by execution against the same hand-crafted dev-field FIT: `power: 200` (standard) AND `developerFields: {"0": 999}` (the dev power) both appear separately. **Trade-off:** custom Garmin license, ESM-only, no first-party TS types (would need `@types/garmin__fitsdk` shim or untyped JS interop). D-FIT-08 locks `fit-file-parser` for the license posture; we keep `@garmin/fitsdk` as the swap option behind `FitRecordSource`. |
| Hand-rolled FIT parser | `fit-file-parser` | FIT format is hundreds of message types and a profile that updates yearly. Hand-rolling is multi-thousand-line work and would need re-validation against every Garmin profile bump. Strict no. |
| `fit-decoder` / `easy-fit` / `js-fit-sdk` | `fit-file-parser` | All abandoned per STACK.md (last release 2021 / 2022); no TS types; smaller download share. Already ruled out. |
| `parse(buf, callback)` API | `parseAsync(buf)` | The callback form **fires multiple times on validation errors** (verified — header/magic errors emit one callback each, then a final callback with data when `force: true`). `parseAsync` rejects on the FIRST error, never reaching `force` recovery. We want `parseAsync` for clean Promise semantics. |
| `mode: 'cascade'` | `mode: 'list'` | README claims default is `'cascade'` but **source code says `mode: options.mode || 'list'`** (verified). `'list'` gives a flat top-level `result.records` array — what we want. `'cascade'` nests records under `laps` which we'd have to flatten anyway. Pick `'list'` explicitly so we don't depend on the buggy default. |

### Installation

```bash
# Production dep
npm install fit-file-parser@~3.0.0

# Dev dep — fixture generator only (NOT a runtime dep)
npm install -D '@garmin/fitsdk@~21.202.0'
```

**Version verification (run during execution):**

```bash
npm view fit-file-parser version       # expect 3.0.0
npm view fit-file-parser engine        # expect "node >= 20.0.x" (note: misnamed key — npm ignores)
npm view @garmin/fitsdk version        # expect 21.202.x
```

`fit-file-parser`'s `package.json` declares the engine via the misnamed `"engine"` key
(singular, non-standard) instead of `"engines"`. npm ignores this. Real-world Node 24
compatibility is verified by direct execution in this research session.

## Architecture Patterns

### System Architecture Diagram (Phase 2 slice)

```
┌────────────────────────────────────────────────────────────────────────┐
│                       Public API (src/index.ts)                        │
│   loadFitFromPath, loadFitFromBuffer, RideRecord, FitLoadError + 4 sub │
└─────────────────────────┬──────────────────────────┬───────────────────┘
                          │                          │
                          │ async wrapper            │
                          ▼                          ▼
┌─────────────────────────────────────────┐  ┌────────────────────────────┐
│         src/fit/loader.ts               │  │       src/types.ts         │
│  loadFitFromPath:  fs.readFile          │  │  RideRecord                │
│                    → loadFitFromBuffer  │  │  (re-exported via index)   │
│  loadFitFromBuffer:                     │  └────────────────────────────┘
│    1. validate header (12/14, .FIT)     │
│    2. validate CRC-16/ARC ourselves     │
│       (parser TODO-skips this)          │
│    3. detect dev-field shadowing        │
│    4. parser.parseAsync({ mode:'list' })│
│    5. delegate to normalize             │
└────────────────┬────────────────────────┘
                 │ ParsedFit { records, field_descriptions, ... }
                 ▼
┌────────────────────────────────────────────────────────────────────────┐
│                     src/fit/normalize.ts                               │
│   record.timestamp (Date) → ms                                         │
│   record.power, record.cadence → conditional emit                      │
│   sort ascending, drop dup ts (keep-first)                             │
│   debuglog dropped count                                               │
└────────────────┬───────────────────────────────────────────────────────┘
                 │ RideRecord[]
                 ▼
       [Phase 3: replay engine consumes this]

The FitRecordSource seam (interface in src/fit/loader.ts) is the swap
point for @garmin/fitsdk in v2 if a real Garmin file mis-decodes.
```

### Recommended Project Structure

```
trainer-sim/
├── src/
│   ├── index.ts                    # + loadFitFromPath, loadFitFromBuffer, RideRecord, FitLoadError + 4 sub
│   ├── types.ts                    # NEW — RideRecord lives here per ARCHITECTURE.md
│   ├── ftms/                       # unchanged from Phase 1
│   │   └── indoor-bike-data.ts
│   └── fit/                        # NEW
│       ├── loader.ts               # entry points, header/CRC validation, parser invocation
│       ├── normalize.ts            # ParsedRecord[] → RideRecord[]
│       ├── errors.ts               # FitLoadError hierarchy (or inline in loader.ts)
│       └── README.md               # "Why FitRecordSource exists; parser-swap notes"
├── test/
│   ├── fit/
│   │   ├── loader.test.ts          # path + buffer entry points produce same output (FIT-01)
│   │   ├── normalize.test.ts       # epoch conversion, sort, dedup, undefined semantics (FIT-02, FIT-03)
│   │   ├── error-paths.test.ts     # all 4 error subclasses fire on right inputs (D-FIT-06)
│   │   ├── dev-field-shadow.test.ts # FIT-05 — TrainerRoad-style dev `power` rejected
│   │   └── perf.test.ts            # <100 ms gate on synthetic 1-hour file (ROADMAP)
│   └── fixtures/
│       ├── fit/                    # NEW — committed synthetic .fit binaries
│       │   ├── README.md           # provenance: how each .fit was generated, what it covers
│       │   ├── generate.mts        # one-shot generator (NOT in CI)
│       │   ├── basic-1min.fit      # ~1 KB — 60 records, power+cadence, no anomalies
│       │   ├── autopause-gap.fit   # ~1 KB — 30 records, 60 s gap mid-ride
│       │   ├── sparse-cadence.fit  # ~1 KB — power every record, cadence every 5
│       │   ├── null-power.fit      # ~1 KB — power=invalid sentinel on alternate records
│       │   ├── dev-power-shadow.fit # ~1 KB — TrainerRoad-style dev "power" + std power
│       │   └── perf-1hour.fit      # ~30 KB — 3600 records at 1 Hz (perf gate fixture)
│       ├── ftms-decoder.ts         # unchanged from Phase 1
│       └── README.md               # extended with FIT fixture provenance pointer
└── (rest unchanged from Phase 1)
```

### Pattern 1: `FitRecordSource` Interface as the Parser-Swap Seam

**What:** `src/fit/loader.ts` defines a TypeScript interface that consumes only what
the loader needs from a parser, and the actual `fit-file-parser` import is wrapped in
one named adapter inside that file. No other module in `src/` imports
`fit-file-parser` directly.

**When to use:** Whenever a third-party library is identified as the most likely thing
to be swapped (per STACK.md "When to switch to `@garmin/fitsdk`").

**Why:** D-FIT-08 picks `fit-file-parser` for license, but flags `@garmin/fitsdk` as
the fallback if a real Wahoo/Garmin file mis-decodes. The seam means the swap is one
adapter implementation, not a rewrite.

**Example (compile-time-only interface — no runtime cost):**

```typescript
// src/fit/loader.ts (excerpt)

interface ParsedFitMinimal {
  records?: ReadonlyArray<{
    timestamp?: Date;
    power?: number;
    cadence?: number;
    // unknown other fields — we deliberately don't model them at this seam
  }>;
  field_descriptions?: ReadonlyArray<{
    field_name?: string;
    developer_data_index?: number;
    field_definition_number?: number;
  }>;
}

interface FitRecordSource {
  parse(buffer: Uint8Array): Promise<ParsedFitMinimal>;
}

// The single import of `fit-file-parser` lives here.
import FitParser from 'fit-file-parser';

function makeFitFileParserSource(): FitRecordSource {
  return {
    parse: async (buffer) => {
      const parser = new FitParser({ mode: 'list', force: false });
      // parseAsync types accept Buffer | ArrayBuffer; pass Uint8Array's underlying buffer.
      return await parser.parseAsync(buffer);
    },
  };
}
```

**Trade-off:** Compile-time interfaces have zero runtime cost. The lighter pick per
CONTEXT.md "Claude's Discretion" (interface vs. runtime object).

### Pattern 2: Two-Phase Validation Before Trusting the Parser

**What:** Validate the FIT header and CRC in `loader.ts` BEFORE calling the parser.

**Why:** **`fit-file-parser` 3.0 has CRC validation TODO-commented-out** — verified at
`src/fit-parser.ts:105` (header CRC) and `:122` (file CRC). Lines literally say
`// TODO: fix Header CRC check` and `// TODO: fix File CRC check`. The parser will
silently accept a file with a corrupted body. D-FIT-06's `FitCrcError` is meaningless
unless we do the check ourselves.

**When to use:** Whenever a parser library cannot be trusted to do the integrity check
the project has committed to surface (e.g., D-FIT-06).

**Example:**

```typescript
// src/fit/loader.ts (excerpt) — pseudocode for the validation pre-flight

function validateHeader(buf: Uint8Array): { headerLength: 12 | 14; dataLength: number } {
  if (buf.length < 14) throw new FitTruncatedError(`expected ≥14 bytes, got ${buf.length}`);
  const headerLength = buf[0];
  if (headerLength !== 12 && headerLength !== 14) {
    throw new InvalidFitHeaderError(`header length must be 12 or 14, got ${headerLength}`);
  }
  // Magic .FIT at offset 8..11
  const magic = String.fromCharCode(buf[8], buf[9], buf[10], buf[11]);
  if (magic !== '.FIT') throw new InvalidFitHeaderError(`magic mismatch: expected '.FIT', got '${magic}'`);
  // Data length is uint32 LE at offset 4
  const dataLength =
    buf[4] | (buf[5] << 8) | (buf[6] << 16) | (buf[7] << 24);
  if (buf.length < headerLength + dataLength + 2) {
    throw new FitTruncatedError(
      `expected ${headerLength + dataLength + 2} bytes, got ${buf.length}`
    );
  }
  return { headerLength: headerLength as 12 | 14, dataLength };
}

// CRC-16/ARC over body (start at offset 0 if headerLength=12, offset 14 if headerLength=14).
// Compare to two-byte LE trailer at offset (headerLength + dataLength).
// Implementation copies the table from `fit-file-parser`'s `binary.ts` (16-entry CRC table)
// — algorithm is in the public FIT SDK PDF; small, well-defined.
function validateCrc(buf: Uint8Array, headerLength: 12 | 14, dataLength: number): void {
  const crcStart = headerLength + dataLength;
  const crcExpected = buf[crcStart] | (buf[crcStart + 1] << 8);
  const crcActual = crc16Arc(buf, headerLength === 12 ? 0 : 14, crcStart);
  if (crcActual !== crcExpected) {
    throw new FitCrcError(`CRC mismatch: expected 0x${crcExpected.toString(16)}, got 0x${crcActual.toString(16)}`);
  }
}
```

**The CRC-16/ARC table** (16-entry version per FIT SDK):

```typescript
const CRC_TABLE = [
  0x0000, 0xCC01, 0xD801, 0x1400, 0xF001, 0x3C00, 0x2800, 0xE401,
  0xA001, 0x6C00, 0x7800, 0xB401, 0x5000, 0x9C01, 0x8801, 0x4400,
];
function crc16Arc(buf: Uint8Array, start: number, end: number): number {
  let crc = 0;
  for (let i = start; i < end; i++) {
    let tmp = CRC_TABLE[crc & 0xF];
    crc = (crc >> 4) & 0x0FFF;
    crc = crc ^ tmp ^ CRC_TABLE[buf[i] & 0xF];
    tmp = CRC_TABLE[crc & 0xF];
    crc = (crc >> 4) & 0x0FFF;
    crc = crc ^ tmp ^ CRC_TABLE[(buf[i] >> 4) & 0xF];
  }
  return crc;
}
```

`[VERIFIED]` — this table and algorithm are pasted from `fit-file-parser`'s own
`src/binary.ts:21-35` and were used to build the synthetic FIT files in this research
session. The same algorithm appears in the Garmin FIT SDK PDF.

### Pattern 3: Detect Developer-Field Shadowing at the Loader Boundary

**What:** Walk `result.field_descriptions[]` BEFORE consuming `result.records[]`. If any
descriptor's `field_name` matches a name we care about (`power`, `cadence`,
`timestamp`), throw a typed error.

**Why:** See §Critical Finding. `fit-file-parser` 3.0 collides developer-defined
fields onto the same key as standard fields. Detecting via `field_descriptions` is the
only safe option short of forking the parser or switching parsers.

**Example:**

```typescript
// src/fit/loader.ts (excerpt)

const SHADOWED_STANDARD_FIELD_NAMES = new Set(['power', 'cadence', 'timestamp']);

function rejectIfDevFieldShadowsStandard(parsed: ParsedFitMinimal): void {
  const descs = parsed.field_descriptions ?? [];
  for (const desc of descs) {
    const name = desc.field_name?.toLowerCase();
    if (name && SHADOWED_STANDARD_FIELD_NAMES.has(name)) {
      throw new DeveloperFieldShadowError(
        `FIT file declares a developer-defined field named '${name}' (developer_data_index=${desc.developer_data_index}, ` +
        `field_definition_number=${desc.field_definition_number}), which would shadow the standard '${name}' field. ` +
        `This file is not yet supported (FIT-05 mitigation). See .planning/phases/02-fit-loader-normalization/02-RESEARCH.md ` +
        `§Critical Finding for context.`
      );
    }
  }
}
```

**Trade-off:** This is the "honest, loud failure" path. The user's CONTEXT.md
explicitly says "load without throwing" applies to *valid* files, not to ones that
trigger the FIT-05 bug. A future planner can upgrade to "use `@garmin/fitsdk` for this
file only" via the `FitRecordSource` seam without breaking the public API.

### Pattern 4: `util.debuglog` for Debug-Channel Diagnostics (D-FIT-09 default)

**What:** Drop counts (out-of-order, duplicates) are logged via `util.debuglog`, gated
on `NODE_DEBUG=trainer-sim:fit`. Public API stays as `RideRecord[]`.

**Why:** D-FIT-09 says "log dropped-count to stderr at debug level only — not
console.warn (too noisy for test output)." `util.debuglog` is the Node-idiomatic 2026
answer (`[CITED: nodejs.org/api/util.html#utildebuglogsection-callback]`). Off by
default, costs nothing when disabled, drops to a no-op without env var.

**Example:**

```typescript
// src/fit/normalize.ts (excerpt)
import { debuglog } from 'node:util';

const log = debuglog('trainer-sim:fit');

export function normalize(parsed: ParsedFitMinimal): RideRecord[] {
  // ... map and filter ...
  const sorted = mapped.slice().sort((a, b) => a.timestamp - b.timestamp);
  let outOfOrder = 0;
  let duplicates = 0;
  // ... count dropped ...
  if (outOfOrder + duplicates > 0) {
    log('dropped %d out-of-order, %d duplicate records during normalize', outOfOrder, duplicates);
  }
  return final;
}
```

Run with `NODE_DEBUG=trainer-sim:fit npm test` to see drop counts during local
debugging. CI runs without the env var so test output stays clean.

### Pattern 5: `RideRecord` Wire-Honest Optionals (D-FIT-01)

**What:** `power: 0` is preserved as `0`. `power = undefined` (FIT invalid sentinel,
field absent, or `null` from wire) means "no signal." `record.power ??= 0` would be
**wrong** — it collapses the absent vs. coasting distinction.

**Why:** Phase 1's `IndoorBikeRecord` already follows this convention (the encoder's
flag-bit gating is on `value === undefined`). Phase 2's `RideRecord` matches.

**Example:**

```typescript
// src/types.ts
export interface RideRecord {
  /** Unix epoch milliseconds. */
  timestamp: number;
  /** Watts. `undefined` = no power signal (sensor disconnected, file lacks the field). `0` = rider coasting. */
  power?: number;
  /** RPM. Same absent-vs-zero semantics as `power`. */
  cadence?: number;
}
```

```typescript
// src/fit/normalize.ts (excerpt) — DO NOT collapse undefined to 0
function recordToRide(rec: ParsedRecord): RideRecord {
  const r: RideRecord = { timestamp: rec.timestamp.getTime() };
  // Use the in-operator (or explicit `!== undefined`) so a real 0 stays 0.
  if (rec.power !== undefined) r.power = rec.power;
  if (rec.cadence !== undefined) r.cadence = rec.cadence;
  return r;
}
```

### Anti-Patterns to Avoid

- **`fit-file-parser`'s `parse(buf, callback)` API:** the callback fires multiple times
  on validation errors before potentially firing once with data when `force: true`.
  This is verified surprising behavior. Use `parseAsync` exclusively.
- **Trusting `fit-file-parser`'s default mode:** README says `'cascade'`, source says
  `'list'` (verified). Pin `mode: 'list'` explicitly so we don't depend on the buggy
  default.
- **Trusting the parser's CRC validation:** TODO-commented-out at v3.0.0. We do CRC
  ourselves.
- **Letting `fit-file-parser` types leak past `src/fit/`:** breaks the
  `FitRecordSource` seam (D-FIT-08 mitigation).
- **`record.power ??= 0` or any other "0-or-coasting" coalescing:** breaks D-FIT-01.
- **Generating fixtures at test time:** D-FIT-05 LOCKED — bytes are committed; the
  generator is one-shot.
- **Storing real Garmin/Wahoo rides as committed fixtures:** real rides leak GPS, HR,
  device serial, user ID. Committed fixtures must be **synthetic**.
- **Throwing a generic `Error`:** D-FIT-06 mandates the typed hierarchy; consumers
  use `e instanceof FitLoadError` for handling.
- **`RideRecord` having a `speed` field:** out of scope per CONTEXT.md Deferred (v2 only).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| FIT message-type registry, definition-message tracking, base-type decoding | A custom FIT parser | `fit-file-parser@3.0.0` | The FIT spec has 100+ message types and a profile that updates with every Garmin firmware. Hand-rolling is multi-thousand-line work. |
| FIT epoch → Unix epoch conversion | Custom math (it's only `*1000 + 631065600000`) | The parser's auto-conversion via `record.timestamp` (which is already a `Date`) | Verified: `fit-file-parser` 3.0 returns `timestamp` as a `Date` object with the offset applied. We just call `.getTime()`. |
| FIT "invalid" sentinel handling (uint8=0xFF, sint16=0x7FFF, etc.) | A field-by-field sentinel table | The parser's `isInvalidValue` / `isInvalidBaseTypeValue` filters | Verified: parser strips invalid sentinels and the field is simply absent from the output. We just check `=== undefined`. |
| Synthetic FIT fixture generation | A FIT writer in this repo | `@garmin/fitsdk`'s `Encoder` class as a **dev-only** generator script | The Garmin SDK has a built-in encoder. Used only at fixture-mint time (one-shot script under `test/fixtures/fit/generate.mts`); the bytes it produces are MIT-clean (data, not code). See §Fixture Strategy below. |
| `util.debuglog` channel | `console.warn`, custom debug flag | `util.debuglog('trainer-sim:fit')` | Node 24-idiomatic, gated on `NODE_DEBUG`, no-op when disabled. |

| Problem | DO Hand-Roll | Why |
|---------|--------------|-----|
| FIT header validation (length 12/14, magic `.FIT`) | The parser's check is permissive when `force: true` and reports errors as plain strings; we want typed `InvalidFitHeaderError`. ~10 lines. |
| CRC-16/ARC validation | The parser's check is **TODO-commented-out** (verified). Public algorithm; ~15 lines plus a 16-entry table. We need it for D-FIT-06 `FitCrcError` to be meaningful. |
| Developer-field-shadow detection | The parser does not surface `(msg-num, field-num)` and DOES collide names. The mitigation lives at our seam. ~15 lines walking `result.field_descriptions[]`. |
| `FitLoadError` hierarchy (4 subclasses) | First typed-error hierarchy in the project; future phases follow the pattern. ~20 lines total. |
| `RideRecord` normalization (sort, dedup, `Date` → ms, conditional optional emit) | Pure functions over already-parsed objects. ~30 lines. |

## Critical Finding: Developer-Field Shadowing in fit-file-parser 3.0

This finding affects FIT-05 directly and must be visible to the planner.

### The behavior (verified)

A test FIT file was constructed in this research session with both:
- A standard `record.power` field (FIT global message-num 20, field-def 7, value 200), and
- A developer-defined field named `power` (developer_data_index=0, field_def 0, value 999).

`fit-file-parser` 3.0.0 parsed this file and returned:

```json
{
  "records": [{
    "timestamp": "1989-12-31T00:16:40.000Z",
    "power": 999,
    "cadence": 85
  }],
  "field_descriptions": [{
    "developer_data_index": 0,
    "field_definition_number": 0,
    "fit_base_type_id": 132,
    "field_name": "power"
  }]
}
```

**The standard `power=200` was silently overwritten by the developer-defined
`power=999`.** This is exactly the FIT-05 failure mode REQUIREMENTS.md describes
("TrainerRoad's `power` shadows the standard one").

`@garmin/fitsdk` 21.202.0 parsed the **same** file and returned:

```json
{
  "recordMesgs": [{
    "timestamp": "1989-12-31T00:16:40.000Z",
    "power": 200,
    "cadence": 85,
    "developerFields": { "0": 999 }
  }]
}
```

Garmin's SDK isolates developer fields under a separate `developerFields` object keyed
by field-def-number. **No shadowing.**

### Why this happens (root cause)

In `fit-file-parser`'s `src/binary.ts` lines ~452-465, a single `fields` object is
populated by name:

```javascript
for (const { fDef, data } of rawFields) {
  const { field } = fDef.isDeveloperField ? { field: fDef.name } : message.getAttributes(fDef.fDefNo)
  if (field !== 'unknown' && field !== '' && field !== undefined) {
    fields[field] = data
  }
}
```

Both standard and developer fields write to `fields[name]`. Because the FIT format
emits standard fields first in the record's definition message and developer fields
last, the developer write happens after the standard write — **last-write-wins by name
collision**.

The output `record` object only contains string-keyed fields; the
`(message-num, field-num)` tuple from the definition message is not preserved past the
parser internals.

### Mitigation paths (ranked)

| Path | Effort | Coverage | Recommendation |
|------|--------|----------|----------------|
| **A. Detect via `field_descriptions[]` → throw `DeveloperFieldShadowError`** | Low (~15 LOC) | All cases where the dev field name collides with a watched standard name (`power`, `cadence`, `timestamp`) | **RECOMMENDED for v1.** Honest, loud, and the FitRecordSource seam lets us upgrade to (C) in v1.x without breaking the public API. |
| **B. Re-parse the FIT bytes ourselves at the (msg, field) level** to recover the standard value | High (~hundreds of LOC of FIT parsing — defeats the purpose of using a library) | Full | **REJECTED.** Ironically reintroduces the work `fit-file-parser` was supposed to save. |
| **C. Switch parsers to `@garmin/fitsdk`** | Medium (~50 LOC swap behind the FitRecordSource interface) plus license review and adding `@types/garmin__fitsdk` shim or untyped JS interop | Full | **DEFERRED.** D-FIT-08 LOCKED to `fit-file-parser` for license posture. The seam exists for this exact case. If a real consumer hits a TrainerRoad file in v1, that's the trigger to flip. |
| **D. Patch / fork `fit-file-parser`** | High (maintain a fork) | Full | **REJECTED.** Long-term maintenance cost. |

### What the test must do

`test/fit/dev-field-shadow.test.ts` owns a synthetic `dev-power-shadow.fit` fixture
(committed bytes) representing a TrainerRoad-style file. Asserts:

1. `loadFitFromBuffer(buf)` throws `DeveloperFieldShadowError`
2. The error is a `FitLoadError` (instanceof check)
3. The error message names the field (`power`) and the developer_data_index

This is FIT-05 success criterion 4 ("returns standard `record.power`, never the
developer field") expressed as: **the loader refuses to return mistaken data**. The
phase-discuss already accepted this read of FIT-05 by virtue of D-FIT-06 ("loud,
actionable failures"). Surfacing this here so the planner can confirm with the user
before plans land.

### Open question for discuss-amendment

Is "**reject the file**" the right read of FIT-05, or does the user want "return
standard power and ignore the dev field"? The latter requires Path C (switch parsers)
because Path A only detects, it doesn't recover. **Defaulting to Path A** in this
research; flag for `/gsd-discuss-phase` amendment if the user wants different
semantics.

## Runtime State Inventory

**Not applicable.** Phase 2 is greenfield within `src/fit/` (the directory does not
yet exist). No rename, refactor, or migration. No stored data, live service config,
OS-registered state, secrets, or build artifacts to inventory.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js 24 | Runtime | ✓ | 24.15.0 `[VERIFIED: Bash → node v24.15.0]` | None — Phase 2 inherits Phase 1's Node-24 floor |
| npm | Package management | ✓ | 11.12.1 | — |
| `fit-file-parser` 3.0.0 | Production parser | ✓ `[VERIFIED: npm install in /tmp/fit-test succeeded]` | 3.0.0 | None — D-FIT-08 LOCKED |
| `@garmin/fitsdk` 21.202.0 | Dev-only fixture generator | ✓ `[VERIFIED: npm install ... and Decoder/Encoder API exercised]` | 21.202.0 | Hand-roll a tiny FIT writer in `test/fixtures/fit/generate.mts` (~200 LOC for the subset we need) — workable but more error-prone than reusing Garmin's encoder |
| Filesystem read access for `loadFitFromPath` | FIT-01 | ✓ — Node `fs/promises.readFile` standard | — | n/a |
| `node:util` debuglog | D-FIT-09 default debug channel | ✓ — Node built-in | Stable since Node 0.5; current docs at Node 26 | n/a |

**Missing dependencies with no fallback:** None.
**Missing dependencies with fallback:** `@garmin/fitsdk` (the hand-rolled writer
fallback exists but is more work — see §Fixture Strategy).

## Fixture Strategy (D-FIT-04, D-FIT-05)

CONTEXT.md leaves the "how to mint synthetic FIT files" call to research. The matrix:

| Option | Cost to land | Maintenance | License risk | Verdict |
|--------|--------------|-------------|--------------|---------|
| **A. Use `@garmin/fitsdk`'s `Encoder` as a one-shot dev script** | Low (~50 LOC of generator script per fixture; SDK does the byte-level work) | None — bytes are committed, generator never runs in CI | LOW — the SDK is run once by a developer to mint bytes. Garmin's license restricts modifying/redistributing the SDK; we do neither. The bytes it produces are FIT data, not copyrightable. We add `@garmin/fitsdk` to `devDependencies`. | **RECOMMENDED.** Cheapest path; produces spec-correct bytes without the maintenance burden of a custom writer. |
| **B. Hand-roll a tiny FIT writer in TypeScript** (~200 LOC for header + def-msg + data-msg + CRC) | Medium-high — getting CRC right is straightforward, but FIT base-type tables and definition-message bookkeeping are tedious. The /tmp/fit-test/gen-fit.mjs script in this research session is a working starting point; harden into a maintainable form. | Maintained as part of the test code — drift risk is real (a FIT spec change probably matters for the parser, not for hand-rolled minimal fixtures, but still). | None — MIT, our code | **ALTERNATIVE.** Choose this if the user is uncomfortable with the Garmin SDK as a dev-dep. |
| **C. Record real rides with PII scrubbed** | Medium (one-time; needs a real trainer + GPS strip + privacy review) | Low — but PROJECT.md explicitly says "no bundled rides" and even though "no bundled rides" applies to runtime artifacts, the spirit of the rule includes "tests use generated/minimal FIT" | Variable — depends on whether the developer can guarantee no GPS / HR / device-serial leaks. | **REJECTED** unless the user explicitly wants this. Generated synthetic fixtures are easier to reason about (record count and timestamps are exact) and side-step privacy review. |

### Recommended fixture set (CI tier, all committed under `test/fixtures/fit/`)

| Fixture | Size estimate | Records | Covers | Generated via |
|---------|---------------|---------|--------|---------------|
| `basic-1min.fit` | ~1 KB | 60 records, 1 Hz, power+cadence each | FIT-01, FIT-02 (path == buffer), FIT-03 (epoch) | Option A |
| `autopause-gap.fit` | ~1 KB | 30 records: 0..15 s + 75..90 s (60 s autopause gap mid-ride) | FIT-04 (gap preservation), D-FIT-02 | Option A |
| `sparse-cadence.fit` | ~1 KB | 60 records: power on every record, cadence on every 5th | FIT-04 (sparse smart-recording), D-FIT-01 (undefined preserved) | Option A |
| `null-power.fit` | ~1 KB | 60 records: power=invalid sentinel on every other record (uint16 0xFFFF) | FIT-04 (null power without throw), D-FIT-01 (`undefined`-not-`0`) | Option A |
| `dev-power-shadow.fit` | ~1 KB | 1 record: standard power=200, dev-defined `power`=999 | FIT-05 (the shadowing case — see §Critical Finding) | Option A |
| `perf-1hour.fit` | ~30 KB | 3600 records, 1 Hz | <100 ms perf gate (ROADMAP) | Option A |

**Total committed bytes:** ~35 KB, well within reasonable repo size.

`test/fixtures/fit/generate.mts` is committed (so anyone can regenerate the bytes if
needed) but is **not** invoked by CI — `package.json` scripts do not reference it. The
fixtures are byte-identical commits.

`test/fixtures/fit/README.md` documents:
- What each fixture represents (record count, gap structure, dev fields, anomalies)
- The exact generator command that produced it (`npx tsx test/fixtures/fit/generate.mts`)
- A "DO NOT modify these bytes by hand — re-run the generator" line
- License attestation (the bytes are MIT-clean as authored synthetic test data; the
  generator depends on `@garmin/fitsdk` only at fixture-mint time and the SDK is **not**
  a runtime dep of `trainer-sim`)

### Local-dev tier (D-FIT-04)

A test suite under `test/fit/local.test.ts` is gated on the `TEST_FIT_DIR` env var.
When set, it loads every `.fit` file under that directory and asserts each parses to
≥1 record without throwing. Skipped in CI (env var unset). Pattern:

```typescript
import { describe, it } from 'vitest';
const dir = process.env.TEST_FIT_DIR;
const skip = !dir;
describe.skipIf(skip)('local-dev FIT smoke (TEST_FIT_DIR)', () => {
  // for each .fit in dir → loadFitFromPath → expect records.length > 0
});
```

This satisfies "runs locally before release, skipped in CI" without polluting the CI
output.

## Common Pitfalls

### Pitfall 1: `record.timestamp` is a `Date` object, not a number

**What goes wrong:** A planner reads "FIT timestamps are seconds since 1989" and
writes `timestamp: rec.timestamp` thinking it's a number. TS types lie (the type
declares `timestamp: string`); runtime is a `Date`.
**Why it happens:** Parser converts internally (`new Date(ts * 1000 + 631065600000)`)
but the type declaration in `src/types.ts` says `string`.
**How to avoid:** Always `rec.timestamp.getTime()`. Test asserts `typeof
record.timestamp === 'number'` on `RideRecord`.
**Warning sign:** `RideRecord.timestamp` shows up as a string-coerced Date like
`"1989-12-31T00:16:40.000Z"` in JSON output.

### Pitfall 2: `mode` default is `'list'`, not `'cascade'` (README is wrong)

**What goes wrong:** A planner who reads only the README and not the source assumes
`'cascade'` and walks `result.activity.sessions[].laps[].records` to find records.
With the actual default `'list'`, that path is undefined.
**Why it happens:** README/source mismatch in `fit-file-parser@3.0.0`.
**How to avoid:** Pin `mode: 'list'` explicitly. Don't rely on the default for either
read. Read `result.records` (top-level array).
**Warning sign:** `result.records?.length === undefined` despite the file having records.

### Pitfall 3: `parseAsync` rejects on first validation error (`force` does not save you)

**What goes wrong:** A planner sets `force: true` thinking the parser will recover from
a bad header, then `parseAsync` rejects anyway because the Promise resolves on the
first callback invocation.
**Why it happens:** `parse(callback)` calls callback multiple times (one per error,
plus one with data); `parseAsync` wraps that and rejects on the first error.
**How to avoid:** Validate header + CRC ourselves BEFORE calling `parseAsync` (Pattern
2). When `parseAsync` rejects, the rejection value is a plain string (e.g.,
`"Incorrect header size"`), not an `Error`. Wrap with `.catch(reason => { throw new
InvalidFitHeaderError(typeof reason === 'string' ? reason : String(reason)); })`.
**Warning sign:** Rejection reason is a `string`, not an `Error` — error stacks are missing.

### Pitfall 4: CRC validation is silently disabled in `fit-file-parser` 3.0

**What goes wrong:** A planner trusts the parser to throw on CRC mismatch. The parser
doesn't (TODO-commented-out at `fit-parser.ts:105` and `:122`).
**How to avoid:** Implement CRC ourselves (Pattern 2). Test with a fixture whose CRC
trailer is intentionally corrupted to assert `FitCrcError` fires.
**Warning sign:** `FitCrcError` never fires in tests.

### Pitfall 5: Developer-field shadowing (the FIT-05 case)

See §Critical Finding above. This is the largest risk of the phase.

### Pitfall 6: `record.power = 0` collapses to "no signal" when using `??`

**What goes wrong:** `if (rec.power) ride.power = rec.power` (truthy check) drops a
real `0` watt reading. Same for `rec.power ?? undefined`.
**Why it happens:** JS truthiness; `??` only handles null/undefined.
**How to avoid:** `if (rec.power !== undefined) ride.power = rec.power` — explicit
undefined check. D-FIT-01 LOCKED.

### Pitfall 7: Writing `RideRecord.timestamp` as `string` in the type definition

**What goes wrong:** Mirroring `fit-file-parser`'s declared `ParsedTimestampableElement
{ timestamp: string }` into our type. Phase 1's encoder takes a `number`; Phase 3
schedule math needs a `number`.
**How to avoid:** `RideRecord.timestamp: number` (Unix epoch ms). Convert from
`Date.getTime()` in normalize.ts.

### Pitfall 8: First record carries `elapsed_time: 0` and `timer_time: 0` regardless of `elapsedRecordField` option

**What goes wrong:** `fit-file-parser` 3.0 unconditionally writes
`message.elapsed_time = 0; message.timer_time = 0` on the first `record` message
(verified via execution; see `fit-parser.ts:225-230`). Subsequent records only get
those keys if `elapsedRecordField: true`. A planner who depends on these fields will
get inconsistent behavior across records.
**How to avoid:** Don't depend on `elapsed_time` / `timer_time`. We only read
`timestamp`, `power`, `cadence`. Document this in `normalize.ts` as a comment.

### Pitfall 9: Generating fixtures at test time defeats reproducibility

**What goes wrong:** `beforeAll(() => generateFixtures())` makes test runs depend on
the generator's correctness, defeats committed-bytes-as-truth, and makes failing tests
harder to diff.
**How to avoid:** D-FIT-05 LOCKED — bytes are committed. Generator is one-shot.

## Code Examples

Verified patterns. Sources cited inline.

### Example 1: Complete `loader.ts` skeleton

```typescript
// src/fit/loader.ts
//
// Phase 2 entry points. Wraps fit-file-parser 3.0.0 behind a FitRecordSource
// seam so the parser is a one-file swap (D-FIT-08). Validates header + CRC
// ourselves because fit-file-parser 3.0 has both checks TODO-commented-out
// (verified: src/fit-parser.ts:105, :122).

import { readFile } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
// The single import of fit-file-parser in the entire codebase.
import FitParser from 'fit-file-parser';
import type { RideRecord } from '../types.js';
import { normalize } from './normalize.js';
import {
  FitLoadError,
  InvalidFitHeaderError,
  FitCrcError,
  FitTruncatedError,
  NoRecordMessagesError,
  DeveloperFieldShadowError,
} from './errors.js';

const SHADOWED_STANDARD_FIELD_NAMES = new Set(['power', 'cadence', 'timestamp']);

const CRC_TABLE = [
  0x0000, 0xCC01, 0xD801, 0x1400, 0xF001, 0x3C00, 0x2800, 0xE401,
  0xA001, 0x6C00, 0x7800, 0xB401, 0x5000, 0x9C01, 0x8801, 0x4400,
];

function crc16Arc(buf: Uint8Array, start: number, end: number): number {
  let crc = 0;
  for (let i = start; i < end; i++) {
    let tmp = CRC_TABLE[crc & 0xF]!;
    crc = (crc >> 4) & 0x0FFF;
    crc = crc ^ tmp ^ CRC_TABLE[buf[i]! & 0xF]!;
    tmp = CRC_TABLE[crc & 0xF]!;
    crc = (crc >> 4) & 0x0FFF;
    crc = crc ^ tmp ^ CRC_TABLE[(buf[i]! >> 4) & 0xF]!;
  }
  return crc;
}

function validateHeaderAndCrc(buf: Uint8Array): void {
  if (buf.length < 14) {
    throw new FitTruncatedError(`expected ≥14 bytes (12-byte header + 2-byte CRC), got ${buf.length}`);
  }
  const headerLength = buf[0]!;
  if (headerLength !== 12 && headerLength !== 14) {
    throw new InvalidFitHeaderError(`header length must be 12 or 14, got ${headerLength}`);
  }
  // Magic '.FIT' at offset 8..11
  const magic = String.fromCharCode(buf[8]!, buf[9]!, buf[10]!, buf[11]!);
  if (magic !== '.FIT') {
    throw new InvalidFitHeaderError(`magic mismatch: expected '.FIT', got '${magic}'`);
  }
  const dataLength =
    buf[4]! | (buf[5]! << 8) | (buf[6]! << 16) | (buf[7]! << 24);
  const totalExpected = headerLength + dataLength + 2;
  if (buf.length < totalExpected) {
    throw new FitTruncatedError(`expected ${totalExpected} bytes, got ${buf.length}`);
  }
  const crcStart = headerLength + dataLength;
  const crcExpected = buf[crcStart]! | (buf[crcStart + 1]! << 8);
  // 12-byte header → CRC computed over [0, crcStart). 14-byte header → CRC over [14, crcStart) (header has its own CRC at [12..13]).
  const crcRangeStart = headerLength === 12 ? 0 : 14;
  const crcActual = crc16Arc(buf, crcRangeStart, crcStart);
  if (crcActual !== crcExpected) {
    throw new FitCrcError(
      `CRC mismatch: expected 0x${crcExpected.toString(16).padStart(4, '0')}, ` +
      `got 0x${crcActual.toString(16).padStart(4, '0')}`
    );
  }
}

function rejectIfDevFieldShadowsStandard(parsed: ParsedFitMinimal): void {
  for (const desc of parsed.field_descriptions ?? []) {
    const name = desc.field_name?.toLowerCase();
    if (name && SHADOWED_STANDARD_FIELD_NAMES.has(name)) {
      throw new DeveloperFieldShadowError(
        `FIT file declares a developer-defined field named '${name}' ` +
        `(developer_data_index=${desc.developer_data_index}, ` +
        `field_definition_number=${desc.field_definition_number}). ` +
        `fit-file-parser collides this onto the standard '${name}' field. ` +
        `See .planning/phases/02-fit-loader-normalization/02-RESEARCH.md §Critical Finding.`
      );
    }
  }
}

interface ParsedFitMinimal {
  records?: ReadonlyArray<{
    timestamp?: Date;
    power?: number;
    cadence?: number;
  }>;
  field_descriptions?: ReadonlyArray<{
    field_name?: string;
    developer_data_index?: number;
    field_definition_number?: number;
  }>;
}

export function loadFitFromBuffer(input: Buffer | Uint8Array): RideRecord[] {
  const buf = input instanceof Uint8Array ? input : Buffer.from(input);
  validateHeaderAndCrc(buf);

  // The parser is sync once bytes are in memory, but its API is async.
  // Block synchronously is not idiomatic in Node; instead, expose `loadFitFromBuffer`
  // as a sync function that returns the result of the resolved Promise via a
  // shared try/catch. Since parseAsync is sync internally (just wraps a callback in a
  // Promise), we can use the sync `parse(buf, callback)` form here.
  let parsed: ParsedFitMinimal | undefined;
  let parseErrors: string[] = [];
  const parser = new FitParser({ mode: 'list', force: false });
  parser.parse(buf, (err, data) => {
    if (err) {
      parseErrors.push(err);
    } else if (data) {
      parsed = data;
    }
  });
  if (!parsed) {
    // No data callback fired — the first error is the cause.
    const reason = parseErrors[0] ?? 'unknown parser error';
    // Map known parser strings to our typed errors. Header/magic errors should have
    // been caught by validateHeaderAndCrc above, so anything left is "truncated"
    // territory.
    throw new FitTruncatedError(`fit-file-parser rejected the input: ${reason}`);
  }

  rejectIfDevFieldShadowsStandard(parsed);

  if (!parsed.records || parsed.records.length === 0) {
    throw new NoRecordMessagesError('FIT file is valid but contains no record messages');
  }

  return normalize(parsed);
}

export async function loadFitFromPath(path: string): Promise<RideRecord[]> {
  const buf = await readFile(path);
  return loadFitFromBuffer(buf);
}
```

**Note on sync/async:** D-FIT-07 requires `loadFitFromBuffer` to be sync.
`fit-file-parser`'s `parseAsync` returns a Promise; its underlying `parse(buf,
callback)` is synchronous (the callback fires synchronously before `parse` returns —
verified in this session). Using the callback form lets us keep the public API sync
without `await` or top-level Promise unwrapping. This is the pattern.

### Example 2: Complete `normalize.ts`

```typescript
// src/fit/normalize.ts
import { debuglog } from 'node:util';
import type { RideRecord } from '../types.js';

const log = debuglog('trainer-sim:fit');

interface ParsedFitMinimal {
  records?: ReadonlyArray<{
    timestamp?: Date;
    power?: number;
    cadence?: number;
  }>;
}

/**
 * Map ParsedRecord[] → RideRecord[] with D-FIT-01..03 semantics:
 * - Date → Unix epoch ms via .getTime() (FIT-03)
 * - undefined preserved as undefined (D-FIT-01); 0 stays 0
 * - Sort ascending by timestamp; drop exact-duplicate timestamps (keep-first) (D-FIT-03)
 * - Skip records with no timestamp (defensive — shouldn't happen on valid FIT)
 *
 * Phase 1 quirk: fit-file-parser unconditionally writes `elapsed_time: 0` and
 * `timer_time: 0` on the FIRST record regardless of the `elapsedRecordField`
 * option. We don't read those keys; ignore.
 */
export function normalize(parsed: ParsedFitMinimal): RideRecord[] {
  const records = parsed.records ?? [];

  // Map → RideRecord, dropping records without a timestamp.
  const mapped: RideRecord[] = [];
  for (const rec of records) {
    if (!rec.timestamp) continue;
    const ride: RideRecord = { timestamp: rec.timestamp.getTime() };
    if (rec.power !== undefined) ride.power = rec.power;
    if (rec.cadence !== undefined) ride.cadence = rec.cadence;
    mapped.push(ride);
  }

  // Sort ascending by timestamp.
  const sorted = mapped.slice().sort((a, b) => a.timestamp - b.timestamp);
  let outOfOrder = mapped.length - countAlreadySorted(mapped);

  // Drop exact-duplicate timestamps; keep first.
  const final: RideRecord[] = [];
  let lastTs = -1;
  let duplicates = 0;
  for (const r of sorted) {
    if (r.timestamp === lastTs) {
      duplicates++;
      continue;
    }
    final.push(r);
    lastTs = r.timestamp;
  }

  if (outOfOrder + duplicates > 0) {
    log(
      'normalize dropped %d duplicates and reordered %d out-of-order records ' +
      '(input %d records → output %d)',
      duplicates, outOfOrder, mapped.length, final.length
    );
  }

  return final;
}

function countAlreadySorted(records: RideRecord[]): number {
  let count = records.length > 0 ? 1 : 0;
  for (let i = 1; i < records.length; i++) {
    if (records[i]!.timestamp >= records[i - 1]!.timestamp) count++;
  }
  return count;
}
```

### Example 3: `errors.ts` — typed error hierarchy

```typescript
// src/fit/errors.ts
//
// First typed-error hierarchy in trainer-sim. Future phases (replay timeouts,
// transport failures) follow the same `extends FitLoadError`-style pattern.
// Per D-FIT-06: fail-fast for corrupt input; valid-but-weird input
// (autopause gaps, sparse cadence, null power) does NOT throw — that's the
// happy path.

export abstract class FitLoadError extends Error {
  constructor(message: string) {
    super(message);
    // Set name to the concrete class name for stack traces.
    this.name = this.constructor.name;
  }
}

export class InvalidFitHeaderError extends FitLoadError {}
export class FitCrcError extends FitLoadError {}
export class FitTruncatedError extends FitLoadError {}
export class NoRecordMessagesError extends FitLoadError {}
/** Phase 2 mitigation for the FIT-05 dev-field shadowing case (see RESEARCH.md §Critical Finding). */
export class DeveloperFieldShadowError extends FitLoadError {}
```

### Example 4: `RideRecord` type in `src/types.ts`

```typescript
// src/types.ts
//
// Phase 2 introduces this file. Phase 3 (RideIterator) and Phase 4 (FakeTransport)
// will both import RideRecord from here. ARCHITECTURE.md §"Recommended order"
// item 1: types are the contract everyone signs.

/**
 * A single time-ordered ride sample, normalized from a FIT `record` message.
 *
 * Per D-FIT-01, the wire-level distinction between "rider coasting (0 W)" and
 * "sensor disconnected (no reading)" is preserved: `power: 0` is a real zero;
 * `power: undefined` (property absent) means no signal. Phase 1's encoder
 * already gates the FTMS flag bit on `value === undefined`, so this lines up
 * end-to-end.
 */
export interface RideRecord {
  /** Unix epoch milliseconds (NOT FIT epoch). FIT-03. */
  timestamp: number;
  /**
   * Watts. `undefined` = no power signal (sensor disconnected, file lacks the
   * field, FIT invalid sentinel). `0` = rider coasting. Do NOT collapse to 0.
   */
  power?: number;
  /** RPM. Same absent-vs-zero semantics as `power`. */
  cadence?: number;
}
```

### Example 5: Test pattern — byte-correct path == buffer parity (FIT-01)

```typescript
// test/fit/loader.test.ts (excerpt)
import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadFitFromBuffer, loadFitFromPath } from '../../src/index.js';

const FIXTURE_DIR = resolve(__dirname, '../fixtures/fit');

describe('loadFitFrom* path/buffer parity (FIT-01)', () => {
  it('path and buffer entries return identical RideRecord arrays', async () => {
    const path = resolve(FIXTURE_DIR, 'basic-1min.fit');
    const buf = await readFile(path);
    const fromPath = await loadFitFromPath(path);
    const fromBuf = loadFitFromBuffer(buf);
    expect(fromPath).toEqual(fromBuf);
    expect(fromPath.length).toBeGreaterThan(0);
  });
});
```

### Example 6: Test pattern — dev-field shadow rejection (FIT-05)

```typescript
// test/fit/dev-field-shadow.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadFitFromBuffer, FitLoadError, DeveloperFieldShadowError } from '../../src/index.js';

describe('FIT-05: developer-defined power field (TrainerRoad case)', () => {
  it('rejects a file with a dev field named "power"', () => {
    const buf = readFileSync(resolve(__dirname, '../fixtures/fit/dev-power-shadow.fit'));
    expect(() => loadFitFromBuffer(buf)).toThrowError(DeveloperFieldShadowError);
    try {
      loadFitFromBuffer(buf);
    } catch (e) {
      expect(e).toBeInstanceOf(FitLoadError);
      expect(e).toBeInstanceOf(DeveloperFieldShadowError);
      expect((e as Error).message).toMatch(/'power'/);
    }
  });
});
```

### Example 7: Test pattern — perf gate

```typescript
// test/fit/perf.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { loadFitFromBuffer } from '../../src/index.js';

describe('Phase 2 perf gate (<100 ms parse for 1-hour file)', () => {
  it('parses a 1-hour synthetic FIT in well under 100 ms', () => {
    const buf = readFileSync(resolve(__dirname, '../fixtures/fit/perf-1hour.fit'));
    // Warm up V8 JIT — three throwaway runs.
    for (let i = 0; i < 3; i++) loadFitFromBuffer(buf);
    // Median of 11 runs.
    const N = 11;
    const times: number[] = [];
    for (let i = 0; i < N; i++) {
      const t0 = performance.now();
      loadFitFromBuffer(buf);
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    const median = times[Math.floor(N / 2)]!;
    expect(median).toBeLessThan(100);
  });
});
```

**Verified perf headline (this session, 3600-record synthetic file):**

| Metric | Value |
|--------|-------|
| Min | 1.63 ms |
| Median | 1.85 ms |
| Max | 2.17 ms |
| Mean | 1.85 ms |

The <100 ms gate has ~50× headroom on synthetic data. Real Garmin/Wahoo files (more
diverse messages, larger profiles) should still be well under 100 ms.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `fit-file-parser` v2.x (CJS-only) | v3.0.0 (dual ESM+CJS, ships TS types) | 2024-12 (v3 alpha) → 2026-05-09 (v3.0.0 stable) | Phase 2 can pin v3 and get types; v2 would have forced `@types/fit-file-parser` shim |
| `js-fit-sdk`, `easy-fit`, `fit-decoder` | `fit-file-parser` 3 / `@garmin/fitsdk` | All abandoned 2021-2022 | Already ruled out by STACK.md |
| FIT epoch hand-conversion at every callsite | Parser auto-converts to `Date` | Always — parser does this internally, not a recent change | We just call `Date.getTime()` |
| `console.warn` for library debug output | `util.debuglog('namespace:section')` gated on `NODE_DEBUG` | Stable Node API since v0.5; modern docs at Node 26 `[CITED: nodejs.org/api/util.html#utildebuglogsection-callback]` | D-FIT-09 default; off by default, costless when disabled |
| Bundled fixture FIT files in npm tarball | Test-only fixtures excluded via `package.json` `files` allowlist | Phase 1 already established `files: ["dist", "README.md", "LICENSE.md"]` | Test fixtures stay in repo, never publish; PROJECT.md "no bundled rides" rule preserved |

**Deprecated/outdated:**
- `parse(buffer, callback)` — works but multi-callback semantics are surprising. Use
  `parseAsync` for async paths and the callback form ONLY in `loadFitFromBuffer` to
  preserve sync semantics (where the callback is known to fire synchronously).
- `fit-file-parser` v2.x — still on npm but ships only CJS; v3 supersedes.

## Validation Architecture

`workflow.nyquist_validation` is `false` per `.planning/config.json`. **Section
omitted per researcher instructions**; the planner can derive must-haves from the
Phase Requirements → Test Map below.

### Phase Requirements → Test Map (informational)

| Req ID | Behavior | Test Type | File | Quick run |
|--------|----------|-----------|------|-----------|
| FIT-01 | Path == Buffer parity | unit | `test/fit/loader.test.ts` | `npx vitest run test/fit/loader.test.ts` |
| FIT-02 | Records sorted, deduped, time-ordered | unit | `test/fit/normalize.test.ts` | `npx vitest run -t "FIT-02"` |
| FIT-03 | FIT epoch → Unix ms applied | unit | `test/fit/normalize.test.ts` | `npx vitest run -t "epoch"` |
| FIT-04 | Real-world quirks load without throwing | unit | `test/fit/loader.test.ts` (autopause, sparse, null-power fixtures) | `npx vitest run -t "FIT-04"` |
| FIT-05 | Dev-field shadowing rejected | unit | `test/fit/dev-field-shadow.test.ts` | `npx vitest run -t "FIT-05"` |
| D-FIT-06 | All 4 (now 5 with `DeveloperFieldShadowError`) error subclasses fire correctly | unit | `test/fit/error-paths.test.ts` | `npx vitest run -t "error"` |
| ROADMAP <100 ms gate | Perf | unit (with warm-up) | `test/fit/perf.test.ts` | `npx vitest run perf` |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The `parse(buf, callback)` callback fires synchronously when `force: true` and the file is valid (used to keep `loadFitFromBuffer` sync) | Code Examples Example 1 | **MEDIUM** — if the callback ever becomes truly async (e.g., the parser switches to streaming), `loadFitFromBuffer` returning sync becomes wrong. Verified in current source: `readRecord` is a tight synchronous loop, no setTimeout/setImmediate; callback fires before `parse` returns. Plan should include a defensive test: assert `loadFitFromBuffer` returns a non-Promise. |
| A2 | Hand-rolled CRC-16/ARC implementation (16-entry table) matches `fit-file-parser`'s implementation byte-for-byte | Patterns / Code Examples | LOW — table copied verbatim from `fit-file-parser`'s `binary.ts`; algorithm is in the FIT SDK PDF. Also exercised against the synthetic FIT file in this session, which the parser accepted. |
| A3 | The set of "shadowed standard names" (`power`, `cadence`, `timestamp`) is sufficient — no other dev field name we'd want to detect | Pattern 3 / Critical Finding | MEDIUM — a dev field named e.g. `heart_rate` would not collide with anything we read in v1. v2 widens to HR/speed and the set must grow. Documented in the loader. |
| A4 | The `@garmin/fitsdk` license permits using its `Encoder` as a developer-only fixture-mint tool (not redistributing the SDK; not modifying it; the produced FIT bytes are data, not code) | Fixture Strategy Option A | **MEDIUM** — Garmin's license is permissive (royalty-free, includes "create modifications") but is a custom license rather than OSI-approved. The risk is solely about the SDK as a dev-dep; the produced FIT *bytes* carry no encumbrance. If the user is uncomfortable, fall back to Option B (hand-rolled writer). Surface this in discuss-amendment if needed. |
| A5 | A 1-hour synthetic FIT file (3600 records, no extra messages) is a representative perf gate | perf.test.ts | LOW — real Garmin files have more message types (events, laps, sessions, device info) but the parser's per-record cost dominates. A real 1-hour file with the same record count will be slower; the 50× headroom we measured leaves room. The plan should include a stretch test against a real file (gated on `TEST_FIT_DIR`). |
| A6 | Phase 1's `tsconfig.test.json` covers `test/fit/**` once the directory exists (it includes `test/**/*`) | Project structure inheritance | LOW — Phase 1 plan-01 acceptance asserts `tsconfig.test.json` extends and includes test/**. Verified. |
| A7 | `RideRecord` lives in `src/types.ts` (a new file in Phase 2) rather than co-located in `src/fit/normalize.ts` | Architectural Responsibility Map | LOW — ARCHITECTURE.md says "types.ts: ITrainerTransport, RideRecord, Config". Following the architecture doc. Phase 4 will re-use the file for `ITrainerTransport`. |
| A8 | Phase 1's existing `src/index.ts` imports from `'./ftms/indoor-bike-data.js'` (with `.js`); Phase 2 follows the same convention | Phase 1 inheritance | LOW — verified by reading existing `src/index.ts`. |

## Open Questions

1. **Reject vs. recover on dev-field shadow (FIT-05).**
   - What we know: `fit-file-parser` 3.0 collides developer `power` onto standard
     `record.power`. Detection is cheap (walk `field_descriptions[]`). Recovery requires
     parser swap.
   - What's unclear: User's preference between "throw `DeveloperFieldShadowError`" (loud
     failure, FitRecordSource seam preserved for v1.x recovery) and "ignore the dev
     field, return standard power" (requires switching to `@garmin/fitsdk` now).
   - Recommendation: **Default to throw**. Surface to the user via discuss-amendment if
     the user expects "recover" semantics. The plan can still ship the rejection path;
     the discuss-amendment becomes "open Phase 2.1 if recovery needed."

2. **Fixture generator: `@garmin/fitsdk` dev-dep vs. hand-rolled writer.**
   - What we know: `@garmin/fitsdk`'s built-in `Encoder` produces spec-correct bytes
     in ~50 LOC of generator script per fixture. License is a custom Garmin license
     restricted to use, not modification or redistribution. Hand-rolled writer is
     ~200 LOC of TS + maintenance.
   - What's unclear: Whether the user is comfortable with a Garmin dev-dep given the
     STACK.md license posture (Garmin's license was the reason `fit-file-parser` was
     picked for runtime).
   - Recommendation: **Default to `@garmin/fitsdk` as a dev-only dep**. The license
     concern is materially smaller for a one-shot generator that produces committed
     bytes than for a runtime dep we redistribute. If the user prefers a hand-rolled
     writer, the alternative is documented (~200 LOC, the gen-fit.mjs in this research
     session is a working starting point).

3. **`loadFitFromBuffer` sync via parser's sync-callback property.**
   - What we know: `fit-file-parser`'s `parse(buf, callback)` invokes the callback
     synchronously. We exploit this to keep `loadFitFromBuffer` sync (D-FIT-07).
   - What's unclear: If a future `fit-file-parser` version switches to async parsing
     (e.g., for streaming), `loadFitFromBuffer` would silently break.
   - Recommendation: Pin `fit-file-parser@~3.0.0` (tilde, not caret) so a parser
     minor-version bump requires intentional evaluation. Add a defensive test that
     asserts `typeof loadFitFromBuffer(buf) !== 'undefined' && !(loadFitFromBuffer(buf)
     instanceof Promise)` — fails immediately if the assumption breaks.

## Project Constraints (from CLAUDE.md)

These directives are non-negotiable; the planner MUST verify task plans don't violate them.

| Directive | Source | Application |
|-----------|--------|-------------|
| Tech stack: Node.js + TypeScript | "Constraints" | All Phase 2 code is TS; no JS files in `src/`. |
| License: MIT | "Constraints" | `fit-file-parser` MIT ✓. `@garmin/fitsdk` is a custom Garmin license but only as a **dev-only** dep (not redistributed). |
| Platform: macOS / Linux only for v1 | "Constraints" | Phase 2 code is platform-agnostic Node; parser has no native deps. |
| Compatibility: payloads match real FTMS encoding | "Constraints" | Phase 2 doesn't touch encoder; provides `RideRecord` for Phase 3 → Phase 1 encoder. The `power: undefined` semantics line up with Phase 1's encoder flag-gating (D-FIT-01). |
| Data format: Real Garmin/Wahoo FIT only | "Constraints" | CI fixtures are synthetic but spec-conformant FIT; local-dev tier loads real exports gated on `TEST_FIT_DIR`. |
| Repo layout: standalone, not monorepo | "Constraints" | Single `package.json`. |
| TypeScript 5.9 (NOT 6.x) | TL;DR | Phase 2 inherits Phase 1's `~5.9.3` pin. |
| `engines: ">=24.0"` | TL;DR + D-16 | Inherited from Phase 1. |
| Dual-publish ESM + CJS | TL;DR + D-11 | `fit-file-parser@3` is dual-publish — matches our exports map. |
| `publint` + `attw` non-negotiable | TL;DR + D-12 | Adding `RideRecord` and the error classes to `src/index.ts` exports must keep validate green. |
| Use `tsup`, NOT webpack/rollup | TL;DR | Phase 2 doesn't change the build; tsup picks up new files in `src/` automatically. |
| Use `vitest`, NOT jest | TL;DR | Phase 2 adds `test/fit/*.test.ts`. |
| GSD Workflow Enforcement | "GSD Workflow Enforcement" | Plans go through `/gsd-execute-phase`. |
| FIT parser pick: deferred to research | TL;DR / STACK.md | Resolved in CONTEXT.md D-FIT-08 — `fit-file-parser@3.0.0`. |
| Bundled fixture FIT files: out of scope | "What NOT to Use" | D-FIT-04/05 interpret this as "no runtime-shipped fixtures"; test binaries are fine. `package.json` `files: ["dist", "README.md", "LICENSE.md"]` (Phase 1) excludes `test/` from publish. |
| Hand-roll FTMS encoder | TL;DR | Phase 1 done; not relevant to Phase 2. |

## Sources

### Primary (HIGH confidence)
- `[VERIFIED: npm registry → fit-file-parser]` — version 3.0.0, MIT, dual-publish, deps `buffer@^6.0.3`, last published a week ago (2026-05-09 ± few days)
- `[VERIFIED: github.com/jimmykane/fit-parser/blob/master/src/fit-parser.ts]` — fetched and read in this session: `parseAsync` is a Promise wrapper around the callback-based `parse`; `force` default is `true`; `mode` default is `'list'` (NOT `'cascade'` as README claims); CRC validation is TODO-commented-out at lines 105 (header CRC) and 122 (file CRC)
- `[VERIFIED: github.com/jimmykane/fit-parser/blob/master/src/binary.ts]` — `GarminTimeOffset = 631065600000` at line 12; CRC-16/ARC table at lines 21-35; developer-field handling at lines 380-460 confirms name-collision behavior
- `[VERIFIED: live execution]` — minimal synthetic FIT generated, parsed by `fit-file-parser@3.0.0` and `@garmin/fitsdk@21.202.0` in this session; results recorded in §Critical Finding
- `[VERIFIED: live perf measurement]` — 3600-record (1-hour 1Hz) synthetic FIT parsed in 1.85 ms median over 10 runs after 3-iteration warm-up
- `[VERIFIED: /tmp/fit-test/node_modules/fit-file-parser/package.json]` — `"type": "module"`, `"main": "dist/cjs/fit-parser.js"`, `"exports"` map present with `types`/`import`/`require` conditions
- `[VERIFIED: /tmp/fit-test/node_modules/@garmin/fitsdk/package.json]` — version 21.202.0, custom license, ESM-only, no first-party types, has built-in `Encoder` class at `src/encoder.js`
- `[VERIFIED: ./src/index.ts, ./src/ftms/indoor-bike-data.ts, ./test/fixtures/README.md]` — Phase 1 patterns confirmed: `.js` extension on relative imports, `as const` FIELDS table, fixture-provenance README format
- `[CITED: nodejs.org/api/util.html#utildebuglogsection-callback]` — `util.debuglog` API for D-FIT-09 default debug channel

### Secondary (MEDIUM confidence)
- `[CITED: garmin/fit-javascript-sdk LICENSE.txt]` — custom Garmin license; permits use including modification, but non-transferable / non-sublicensable. Recorded but not legally reviewed for the dev-only fixture-generator use.
- `[CITED: STACK.md §"The Deferred Decision: FIT Parser Comparison"]` — full side-by-side from earlier research; Phase 2 inherits the recommendation

### Tertiary (LOW confidence)
- None. All claims either VERIFIED in this session or CITED to a primary source.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every version verified against npm registry; deps installed and exercised in this session
- `fit-file-parser` API surface: HIGH — read source for `fit-parser.ts` and `binary.ts`, exercised against three hand-crafted FIT files (basic, dev-field, 1-hour-perf)
- FIT epoch conversion: HIGH — verified end-to-end (FIT seconds 1000 → `Date.getTime()` 631066600000 = 631065600 + 1000 in ms)
- Developer-field shadowing: HIGH — direct execution comparison between `fit-file-parser` (collides) and `@garmin/fitsdk` (isolates). Reproducible.
- CRC TODO finding: HIGH — read directly from source
- Perf headroom: MEDIUM — 50× on synthetic data; real Garmin files may halve that but still safe by an order of magnitude
- Fixture strategy license analysis: MEDIUM — pragmatic call on the Garmin SDK as a dev-only dep; user may want different posture (flagged in Open Questions #2)
- Mitigation choice (reject vs. recover dev-field shadow): MEDIUM — leaning on D-FIT-06's "loud failures" doctrine; flagged in Open Questions #1

**Research date:** 2026-05-16
**Valid until:** 2026-06-15 (30 days). Re-verify if Phase 2 hasn't started by then;
parser version may have moved (next minor likely fixes the CRC TODO).
