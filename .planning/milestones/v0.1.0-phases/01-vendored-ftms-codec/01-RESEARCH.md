# Phase 1: Vendored FTMS Codec — Research

**Researched:** 2026-05-13
**Domain:** FTMS IndoorBikeData (0x2AD2) byte-correct encoder + dual-published TS library skeleton
**Confidence:** HIGH (FTMS spec, encoder math, stack versions, attw catalog) / MEDIUM (Auuki license interaction with MIT) / LOW (none — every claim traced to a source or marked `[ASSUMED]`)

## Summary

This phase produces a hand-rolled little-endian FTMS IndoorBikeData encoder for `{power, cadence, speed?}` records and stands up the full dual ESM/CJS package skeleton (TypeScript 5.9 strict, tsup 8.5, vitest 4.1, publint, attw, Node 24-only CI). The encoder math is well-understood and the stack is the standard 2026 TS-library stack — none of that is the risk. **The risk is in two places: (a) the silent FTMS encoding traps that PITFALLS.md catalogs, all of which require third-party-decoder round-trip to surface; (b) a license incompatibility between Auuki (AGPL-3.0) and trainer-sim (MIT) that CONTEXT.md D-03 mis-states as MIT-compatible. The license issue must be resolved before any test fixture lands.**

**Primary recommendation:** Treat the encoder as ~80 lines of `Buffer.write{U,}Int16LE` driven by the `FIELDS` source-of-truth table from CONTEXT.md D-09. Hand-compute the byte-correctness reference payloads (provided below) so the unit tests don't depend on a decoder. For the round-trip gate, **do not vendor Auuki's file** — it is AGPL-3.0, which contaminates an MIT repo's test suite and downstream consumers. Use one of (in order of preference): a hand-rolled MIT decoder in `test/fixtures/`, vetted against the spec; or a process-isolated git submodule of Auuki used only at test time. This decision needs user sign-off before planning.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Third-Party Decoder Harness (FTMS-05 gate)**
- **D-01:** The round-trip gate runs against the **Auuki JS decoder**, in-process inside vitest. Round-trip is one assertion in a unit test; runs unmodified in CI on macOS/Linux.
- **D-02:** Auuki is used as a **decoder only**. Auuki itself encodes power as `Uint16` (PITFALLS.md #2) — that bug does not affect us because we read its decode path, not its encode path.
- **D-03:** Open question for research/planning: how to consume Auuki's `indoor-bike-data.js`. Options the planner must choose between:
  - **Vendor a copy** under `test/fixtures/auuki-decoder.js` with attribution and the upstream commit hash committed alongside (license is MIT — compatible).
  - **Git submodule** of `dvmarinoff/Auuki` pinned to a commit (heavier; pulls Auuki's whole repo).
  - **`npm install github:dvmarinoff/Auuki#<sha>`** (relies on Auuki's `package.json` being importable; not currently structured as a publishable lib).
  Recommended path is vendor-a-copy with a `README.md` next to it explaining provenance and pinned commit. Defer the final call to research.

**Speed-Field Encoding Strategy**
- **D-04:** Encoder accepts `{power: number, cadence: number, speed?: number}`. v1 callers always pass `speed: undefined`, so bit-0 = 1 ("more data — speed NOT present"), but the inversion logic is real and tested.
- **D-05:** Bit-0 logic is `flags |= (speed === undefined ? 1 : 0) << 0` with a one-line comment citing FTMS spec inversion. Hard-coding `bit0 = 1` is **not** acceptable.
- **D-06:** Round-trip tests MUST cover both branches of the inversion: encode `{power, cadence}` (no speed) → decoder reads no speed; encode `{power, cadence, speed}` → decoder reads speed back equal.

**Encoder API Shape**
- **D-07:** Public surface from `src/ftms/indoor-bike-data.ts`:
  ```ts
  export interface IndoorBikeRecord {
    power: number;     // watts, sint16, may be negative across full sint16 range
    cadence: number;   // rpm, encoded as uint16 with 0.5 rpm resolution (wire = rpm * 2)
    speed?: number;    // km/h, uint16 with 0.01 km/h resolution; v1 callers omit
  }
  export function encodeIndoorBikeData(record: IndoorBikeRecord): DataView;
  ```
- **D-08:** Pure function. Stateless. No buffer pool. New `Buffer` (or `ArrayBuffer`) per call.
- **D-09:** Internal field-table source of truth (`const FIELDS`) inside the encoder module — tests assert directly against it.
- **D-10:** Implementation uses `Buffer.writeInt16LE` / `Buffer.writeUInt16LE`, then exposes the result as a `DataView`. **Raw `DataView.setUint16` is forbidden** (PITFALLS.md #4 — LE is not the default).

**Project Bootstrap Scope**
- **D-11:** Phase 1 stands up the **full package skeleton**: `package.json`, `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts`, `src/index.ts`, exports map, `.gitignore`, `README.md`.
- **D-12:** `publint` and `@arethetypeswrong/cli` (`attw`) wired into `npm run validate` and run in CI on every push (pulls API-07 forward from Phase 4).
- **D-13:** GitHub Actions CI on **macOS + Linux**, Node 24 only.
- **D-14:** No native deps in Phase 1.
- **D-15:** ESLint setup is **deferred to Phase 4** unless lint-blocking patterns emerge.

**Node Version**
- **D-16:** `engines: ">=24.0"` (Node 24 LTS "Krypton"). CI on Node 24 only.

### Claude's Discretion
- File-level layout inside `src/ftms/` (single file vs splitting `fields.ts` / `encode.ts`) — pick what reads cleanest.
- Vitest test file naming (`*.test.ts` next to source vs `__tests__/`) — pick one and stay consistent.
- Internal helper names (`writeU16LE`, `MORE_DATA_BIT`, etc.) — taste-level.

### Deferred Ideas (OUT OF SCOPE)
- Node 22 + 24 CI matrix.
- Buffer pool / pre-allocation in encoder.
- Second decoder (PyFTMS) in CI alongside Auuki.
- Lint-ban on raw `DataView.setUint16`.
- Update PROJECT.md with `@stoprocent/bleno` (modern fork) and Node 24 floor.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| FTMS-01 | Library encodes FTMS Indoor Bike Data characteristic payloads as little-endian binary (DataView/Buffer) per Bluetooth SIG spec v1.0.1 | Hand-computed reference payloads (§Reference Payloads); `Buffer.writeInt16LE`/`writeUInt16LE` API guarantees LE; FIELDS table from D-09 codifies the spec |
| FTMS-02 | Encoder includes Instantaneous Power (sint16, watts) when power is present | PyFTMS confirms `s2` (sint16); reference payloads cover `-1`, `-32768`, `+32767`; `Buffer.writeInt16LE` writes signed range correctly |
| FTMS-03 | Encoder includes Instantaneous Cadence (uint16, 0.5 rpm resolution; wire = rpm × 2) | PyFTMS confirms `u2.5`; reference payload for `cadence=90` writes `0x00B4` (180 = 90 × 2); reference payload for `cadence=90.5` writes `0x00B5` (181 = 90.5 × 2) |
| FTMS-04 | Encoder sets the inverted bit-0 "More Data" flag correctly (0 = speed present, 1 = NOT present) and all other flag bits per spec | PITFALLS.md #1; Auuki source confirms `speedPresent = (flags >> 0 & 1) === 0`; test covers both branches per D-06 |
| FTMS-05 | Encoded payloads round-trip cleanly through at least one third-party FTMS decoder | Resolved: Auuki's decoder is AGPL-3.0 (license blocker — see §Auuki Decoder Consumption); hand-rolled MIT decoder in test fixtures recommended over vendoring AGPL |
</phase_requirements>

## Architectural Responsibility Map

This is a single-tier Node.js library with no client/server split. The "tiers" are internal layers per ARCHITECTURE.md:

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| FTMS IndoorBikeData byte encoding | Codec layer (`src/ftms/`) | — | Pure function, no I/O, no transport awareness; vendored to allow eventual extraction to `@veloworld/ftms-codec` |
| `IndoorBikeRecord` type | Types layer (`src/types.ts` or co-located in `src/ftms/`) | Public API (`src/index.ts` re-export) | Type is authored once, re-exported from the package root for consumers |
| Public API surface | Public API (`src/index.ts`) | — | Single entry point; named re-exports of `encodeIndoorBikeData` and `IndoorBikeRecord` |
| Build / dual ESM+CJS output | Build tooling (`tsup.config.ts`) | Package metadata (`package.json` `exports` map) | tsup produces both formats; package.json `exports` map routes consumers |
| Type-resolution validation | CI (`.github/workflows/ci.yml`) | publint + attw | Every push runs the validators; gate before publish |
| Round-trip decoding | Test fixtures (`test/fixtures/`) | Test runner (vitest) | The decoder lives in `test/`, NEVER in `src/` (FTMS_decode is explicit non-goal per REQUIREMENTS.md "Out of Scope") |

**Why this matters:** If a future developer adds the decoder to `src/`, they re-introduce decode as a public capability that REQUIREMENTS.md and PROJECT.md both forbid. Keeping the decoder in `test/fixtures/` enforces the "encoder-only" boundary.

## Standard Stack

### Core (locked by CONTEXT.md / CLAUDE.md / STACK.md)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js | 24 LTS ("Krypton"), `engines: ">=24.0"` | Runtime | VeloWorld parity (D-16). `[VERIFIED: ~/dev/agni21/trainer-sim Bash → node v24.15.0]` available locally. |
| TypeScript | `5.9.3` (latest in 5.x line) | Type system | CLAUDE.md/CONTEXT.md lock 5.9; do not adopt 6.x in this phase. `[VERIFIED: npm registry → typescript@5.9.3 published 2025-09-30; latest dist-tag is 6.0.3 (2026-04-16) — out of scope per CLAUDE.md TL;DR]` |
| tsup | `8.5.1` | Library builder (dual ESM/CJS, .d.ts/.d.cts) | `[VERIFIED: npm view tsup dist-tags → latest: 8.5.1; published 2025-11-12]` Beta 5.0 exists; v1 stays on 8.5. |
| vitest | `4.1.6` | Test runner | `[VERIFIED: npm view vitest dist-tags → latest: 4.1.6; published 2026-05-11]` 5.0 is beta — stay on 4. |
| tsx | `4.21.0` | TS execution for scripts | `[VERIFIED: npm view tsx dist-tags → latest: 4.21.0; published 2025-11-30]` |
| publint | `0.3.21` | Validates `package.json` `exports` map | `[VERIFIED: npm view publint dist-tags → latest: 0.3.21; published 2026-05-13]` (released today) |
| @arethetypeswrong/cli | `0.18.2` | Validates types resolve in ESM and CJS | `[VERIFIED: npm view @arethetypeswrong/cli dist-tags → latest: 0.18.2; published 2025-06-09]` |
| @types/node | `^24.12.4` (24.x line) | Node typings | `[VERIFIED: npm view @types/node@24 — 24.12.4 is current 24.x]` Match runtime major. |

### Supporting (Phase 1 needs none)
None. Phase 1 has zero runtime dependencies. The encoder uses only `node:buffer` (built-in).

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| tsup | dual `tsc` + post-process script (what `fit-file-parser` does) `[CITED: github.com/jimmykane/fit-parser/blob/master/package.json]` | More boilerplate, but zero non-Node tooling. tsup is simpler — chose tsup. |
| vitest | Node's native `node:test` runner | `node:test` is fine but vitest gives `it.each` parameterization, watch mode, snapshot support out of the box — and STACK.md confirms `fit-file-parser`/`@garmin/fitsdk` both use vitest. |
| `Buffer.write*LE` | `DataView.set*(o, v, true)` | PITFALLS.md #4 forbids raw `DataView` writes — LE is not the default and the trap is silent. CONTEXT.md D-10 locks `Buffer.write*LE`. |

### Installation

```bash
# Phase 1 install (dev only — no runtime deps)
npm install -D \
  typescript@~5.9.3 \
  tsup@~8.5.1 \
  vitest@~4.1.6 \
  tsx@~4.21.0 \
  '@types/node@~24.12.4' \
  publint@~0.3.21 \
  '@arethetypeswrong/cli@~0.18.2'
```

**Version verification command (run during execution to confirm):**
```bash
npm view typescript@5 version    # expect 5.9.x current
npm view tsup version            # expect 8.5.x
npm view vitest version          # expect 4.1.x
npm view publint version         # expect 0.3.x
npm view @arethetypeswrong/cli version  # expect 0.18.x
```

## Architecture Patterns

### System Architecture Diagram (Phase 1 slice only)

```
┌────────────────────────────────────────────────────────────────────┐
│                  Public API (src/index.ts)                         │
│             encodeIndoorBikeData, IndoorBikeRecord                 │
└─────────────────────────────┬──────────────────────────────────────┘
                              │ re-export
                              ▼
┌────────────────────────────────────────────────────────────────────┐
│              Codec module (src/ftms/indoor-bike-data.ts)           │
│                                                                    │
│   IndoorBikeRecord ───▶ buildFlags ──▶ Buffer (LE writes) ───▶    │
│                                ▲                                   │
│                          FIELDS table                              │
│                          (source of truth)                         │
│                                                                    │
└─────────────────────────────┬──────────────────────────────────────┘
                              │ DataView (LE-encoded)
                              ▼
                       [consumer code]

Test slice (parallel, never imported by src/):
┌────────────────────────────────────────────────────────────────────┐
│  test/ftms/indoor-bike-data.test.ts                                │
│      ├── byte-correctness:  encode(record) === expected Uint8Array │
│      ├── parametrized edges: it.each([...sint16/half-rpm...])      │
│      └── round-trip:        decode(encode(record)) ≈ record        │
│                                       ▲                            │
│  test/fixtures/{decoder}.js  ─────────┘                            │
│      (license-vetted FTMS decoder — choice resolved below)         │
└────────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure

```
trainer-sim/
├── src/
│   ├── index.ts                        # Public API: re-exports encoder + type
│   └── ftms/
│       ├── indoor-bike-data.ts         # encodeIndoorBikeData + FIELDS + flags
│       └── README.md                   # "Why this is vendored — see PROJECT.md"
├── test/
│   ├── ftms/
│   │   └── indoor-bike-data.test.ts    # byte-correctness + round-trip + edges
│   └── fixtures/
│       ├── ftms-decoder.{js|ts}        # in-test decoder (provenance/license documented)
│       └── README.md                   # decoder provenance, pinned upstream SHA
├── package.json                        # type:module, exports map, engines >=24
├── tsconfig.json                       # strict, moduleResolution:bundler, ESM
├── tsup.config.ts                      # entry src/index.ts, esm+cjs, dts
├── vitest.config.ts                    # node env
├── .gitignore                          # node_modules, dist, coverage
├── .github/workflows/ci.yml            # macOS+Linux, Node 24, build+test+validate
├── README.md                           # project README
└── LICENSE.md                          # MIT (already present)
```

**Note (Claude's discretion per CONTEXT.md):** A single-file encoder (`src/ftms/indoor-bike-data.ts`) is recommended over splitting into `fields.ts` / `flags.ts` / `encode.ts` — for ~80 lines, separation hurts readability and makes the FIELDS-as-source-of-truth invariant (D-09) harder to assert in one test.

### Pattern 1: FIELDS Table as Single Source of Truth (CONTEXT.md D-09)

**What:** A single `const FIELDS` object describes type/resolution/flag-bit/inversion for every IndoorBikeData field. Encoder reads from it; tests assert against it.
**When to use:** Anywhere a wire-format spec maps multiple fields to multiple flag bits — common-case spec compliance benefits hugely from a declarative table.
**Example (matches D-09 verbatim):**
```typescript
// src/ftms/indoor-bike-data.ts
const FIELDS = {
  instantaneousSpeed:   { type: 'uint16', resolution: 0.01, flagBit: 0, inverted: true  },
  instantaneousCadence: { type: 'uint16', resolution: 0.5,  flagBit: 2, inverted: false },
  instantaneousPower:   { type: 'sint16', resolution: 1,    flagBit: 6, inverted: false },
} as const;
```
Tests should `import { FIELDS }` (or read it via a test-only export) and assert: `FIELDS.instantaneousPower.type === 'sint16'`. This catches the silent uint16/sint16 swap if anyone "fixes" the table to match Auuki's buggy version.

### Pattern 2: Encode-then-View — `Buffer` for writes, `DataView` for return

**What:** Allocate a `Buffer`, write fields with `Buffer.writeUInt16LE` / `Buffer.writeInt16LE`, and return a `DataView` over the buffer's `ArrayBuffer`.
**Why:** PROJECT.md mandates `DataView` as the consumer-facing payload type, but PITFALLS.md #4 forbids raw `DataView.setUint16` because LE is not the default. `Buffer.write*LE` is unambiguous.
**Example:**
```typescript
import { Buffer } from 'node:buffer';

export function encodeIndoorBikeData(record: IndoorBikeRecord): DataView {
  const buf = Buffer.alloc(payloadByteLength(record));
  let offset = 0;

  const flags = buildFlags(record);
  buf.writeUInt16LE(flags, offset); offset += 2;

  if (record.speed !== undefined) {
    buf.writeUInt16LE(Math.round(record.speed / FIELDS.instantaneousSpeed.resolution), offset);
    offset += 2;
  }
  buf.writeUInt16LE(Math.round(record.cadence / FIELDS.instantaneousCadence.resolution), offset);
  offset += 2;
  buf.writeInt16LE(record.power, offset);
  offset += 2;

  // DataView over the same memory; no copy.
  return new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
}
```

### Pattern 3: Bit-0 "More Data" Inversion as Named Constant (CONTEXT.md D-05)

**What:** Encode the inversion explicitly, with a one-line spec citation:
```typescript
// FTMS spec 4.9: bit 0 is "More Data" — INVERTED. 0 = speed PRESENT, 1 = NOT PRESENT.
const MORE_DATA_BIT = 0;
const CADENCE_PRESENT_BIT = 2;
const POWER_PRESENT_BIT = 6;

function buildFlags(record: IndoorBikeRecord): number {
  let flags = 0;
  flags |= (record.speed === undefined ? 1 : 0) << MORE_DATA_BIT;
  flags |= 1 << CADENCE_PRESENT_BIT;
  flags |= 1 << POWER_PRESENT_BIT;
  return flags;
}
```
**Forbidden alternative** (per CONTEXT.md D-05): `flags = 0x0044` (hard-coded). Tests cannot detect the inversion bug if the bit is hard-coded.

### Anti-Patterns to Avoid

- **Raw `DataView.setUint16(o, v)` (no `true` arg):** Writes big-endian; produces silently wrong bytes. PITFALLS.md #4. Use `Buffer.write*LE`.
- **Encoding power as `Uint16`:** Auuki does this; spec says sint16. PITFALLS.md #2. Use `Buffer.writeInt16LE`.
- **Encoding cadence as integer rpm without ×2:** PITFALLS.md #3. Always divide by `FIELDS.instantaneousCadence.resolution` (= 0.5).
- **Hard-coding flag bytes:** D-05 forbids; tests cannot validate inversion logic.
- **Putting the decoder in `src/`:** Decoder is a test-only fixture. Consumers never see it.
- **Using `tsc` directly when CLAUDE.md/CONTEXT.md say `tsup`:** Diverges from STACK.md; produces no `.d.cts`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Dual ESM/CJS build | Custom rollup config or two `tsc` invocations | `tsup` (D-11; STACK.md) | tsup handles `.d.ts`/`.d.cts`, esbuild for speed, single entry point declaration |
| `package.json` `exports` validation | Manual review | `publint` (D-12) | Catches ~12 categories of subpath-export bugs; standard 2026 hygiene |
| Type resolution validation | Manual ESM+CJS install in fresh repo | `@arethetypeswrong/cli` (D-12) | Catches FalseExportDefault, CJSResolvesToESM, NamedExports, MissingExportEquals, FalseCJS, FalseESM, FallbackCondition, InternalResolutionError, NoResolution, UnexpectedModuleSyntax, UntypedResolution `[CITED: github.com/arethetypeswrong/arethetypeswrong.github.io/tree/main/docs/problems]` |
| Little-endian Buffer writes | Manual byte-shifting (`buf[0] = v & 0xFF; buf[1] = (v >> 8) & 0xFF`) | `Buffer.writeUInt16LE` / `writeInt16LE` (D-10) | Built-in, named LE, zero-cost, tested by Node |
| Parametrized edge-case tests | `for` loop with `assert` | `it.each(...)` from vitest | Generates one test per case with a readable name; failures surface independently |

| Problem | DO Hand-Roll | Why |
|---------|--------------|-----|
| FTMS IndoorBikeData encoder | Yes — vendored, ~80 lines | No usable npm package exists `[VERIFIED: STACK.md npm search; PROJECT.md key decision]` |
| FTMS decoder for round-trip test | Lean toward yes (license issue with Auuki) | License compatibility (see §Auuki Decoder Consumption); ~50 lines for power+cadence+flags subset |

## Auuki Decoder Consumption (CONTEXT.md D-03 resolution)

**This section resolves CONTEXT.md D-03 and surfaces a license issue that contradicts D-03's parenthetical.**

### Critical Finding — Auuki License is AGPL-3.0, NOT MIT

`[VERIFIED: GitHub API → GET /repos/dvmarinoff/Auuki returns license.spdx_id = "AGPL-3.0", license.name = "GNU Affero General Public License v3.0"]`

CONTEXT.md D-03 states *"(license is MIT — compatible)"* — **this is incorrect**. Auuki is AGPL-3.0. AGPL has strong copyleft semantics:
- AGPL §5 ("Conveying Modified Source Versions") obligates anyone who **conveys** a covered work to license the entire combined work under AGPL.
- AGPL §13 (network use clause) requires offering source code to network users — irrelevant for a local test fixture, but flags the license's overall posture.
- For an MIT-licensed library, vendoring an AGPL file into the repo creates a "combined work" question that, at minimum, requires legal review and at worst forces the entire repo to relicense as AGPL.

**This is a hard-blocker that needs user confirmation before planning.** The locked decision (D-01: "round-trip gate runs against the Auuki JS decoder") may need to soften from "Auuki specifically" to "an FTMS-compliant decoder" — the engineering goal (round-trip through a non-trainer-sim decoder) is preserved either way.

### Other Verified Facts About Auuki

- `[VERIFIED: github.com/dvmarinoff/Auuki master tip] = c0d1d4a045f0262604a8c85a4f6b088a4d6f4178 (committed 2026-03-05)`
- `[VERIFIED: github.com/dvmarinoff/Auuki commits affecting src/ble/ftms/indoor-bike-data.js]` — file last touched at SHA `1ad944a4c4c268a5ec70474fe9ab6620b5d7fd8d` (2024-03-20, "add Uint24 getter for indoor bike data distance field"). Stable.
- `[VERIFIED: raw.githubusercontent.com/dvmarinoff/Auuki/master/src/ble/ftms/indoor-bike-data.js]` — file imports `equals` and `getUint24LE` from `'../../functions.js'`. Both are tiny (10 lines combined) and have no transitive npm deps. Pulling in `indoor-bike-data.js` requires either (a) inlining/replacing the two helpers, or (b) also pulling `functions.js`.
- `[VERIFIED: github.com/dvmarinoff/Auuki/blob/master/package.json]` — Auuki has **no `name` field, no `license` field, no `main`/`exports` entry**. **`npm install github:dvmarinoff/Auuki#sha` is NOT a viable option** (no name = npm rejects). This rules out CONTEXT.md D-03 option 3 entirely.
- The Auuki decoder confirms the field layout used here:
  - `speedPresent = (flags >> 0 & 1) === 0` — confirms bit-0 inversion
  - `InstantaneousCadence: {resolution: 0.5, type: 'Uint16'}` — confirms half-rpm
  - `InstantaneousPower: {resolution: 1, type: 'Uint16'}` — **Auuki's known bug**: spec says sint16, Auuki decodes as Uint16. Round-trip test for negative power will read `65535` from Auuki when we encode `-1`. Handle by: (a) reading the raw bytes from the test buffer and calling `getInt16(o, true)` ourselves for the power field; (b) using a different decoder for the sign-edge cases; or (c) using a hand-rolled decoder that respects sint16.

### Resolution: Recommended Path

Given the AGPL issue, here is the option matrix re-evaluated:

| Option | Works in vitest in-process? | License-clean for MIT repo? | Resilient to Auuki being archived/moved? | Verdict |
|--------|----------------------------|----------------------------|------------------------------------------|---------|
| **A. Vendor Auuki's `indoor-bike-data.js` + `functions.js` excerpts under `test/fixtures/`** | Yes | **NO** — vendoring AGPL into MIT contaminates the test suite; downstream consumers running our tests pull AGPL code | Yes (we own the copy) | **REJECTED** on license grounds |
| **B. Git submodule of `dvmarinoff/Auuki` pinned to a SHA, imported only at test time** | Yes (vitest runs JS from submodule) | **Marginal** — submodule keeps Auuki's repo intact (separate `LICENSE`, `git history`); arguably the test runner uses Auuki "as-is" without conveying it. Still requires legal review. | Yes (pinned SHA) | **CONDITIONAL** — pending legal sign-off |
| **C. `npm install github:dvmarinoff/Auuki#sha`** | Unknown — Auuki has no `package.json` `main`/`exports`/`name` | n/a | n/a | **REJECTED** — not technically possible |
| **D. Hand-roll a tiny MIT-licensed FTMS decoder under `test/fixtures/ftms-decoder.ts` (~60 lines), validated against the Bluetooth SIG spec** | Yes (no dep) | Yes (we author it as MIT) | n/a (we own it) | **RECOMMENDED** — clean, tiny, and we already need to validate the spec for the encoder; the decoder is the inverse function |
| **E. PyFTMS via subprocess** | No — Python in vitest is heavyweight; CONTEXT.md D-01 says in-process JS | n/a | n/a | **REJECTED** — violates D-01 |

**Strongest recommendation: Option D (hand-rolled MIT decoder).** It satisfies the engineering intent of D-01 (FTMS-05 gate), avoids the license issue, and is small (the decode function is the inverse of the encode function — they share the same FIELDS table). It also preserves D-02's spirit (use a decoder we trust, not one with a known bug).

**If user prefers to keep "Auuki specifically": Option B (submodule + legal sign-off).** Provides external validation but inherits Auuki's Uint16-power bug and forces a license-review gate. The submodule SHA to pin is the file-touching SHA: `1ad944a4c4c268a5ec70474fe9ab6620b5d7fd8d` (last change to indoor-bike-data.js). Master HEAD `c0d1d4a045f0262604a8c85a4f6b088a4d6f4178` is also valid but adds churn from unrelated commits.

**Attribution snippet (if Option B is chosen) for `test/fixtures/README.md`:**
```markdown
# FTMS Decoder Test Fixtures

This directory uses an FTMS IndoorBikeData decoder from the Auuki project
(https://github.com/dvmarinoff/Auuki), at submodule SHA
`1ad944a4c4c268a5ec70474fe9ab6620b5d7fd8d` (file: src/ble/ftms/indoor-bike-data.js).

Auuki is licensed under AGPL-3.0. This decoder is consumed only at test time
and is NOT part of the trainer-sim library distribution. The trainer-sim
library itself is MIT-licensed.

KNOWN ISSUE: Auuki decodes InstantaneousPower as Uint16 (the FTMS spec
specifies sint16). For negative-power round-trip tests, decode the power
field separately via DataView.getInt16(offset, true).
```

**Surface this to the user via /gsd-discuss-phase amendment before planning.** The planner should not commit to a path until D-03's "MIT — compatible" parenthetical is corrected.

## Reference Payloads (FTMS-01 byte-correctness fixtures)

These are hand-computed reference payloads against the FTMS spec for the v1 `{power, cadence}`-only field set. Tests in `test/ftms/indoor-bike-data.test.ts` will compare encoder output to these byte-for-byte.

### Frame layout (v1, `{power, cadence}` only — no speed)

```
Offset  Bytes  Field         Type    Notes
------  -----  ------------  ------  ------------------------------------------
0       2      Flags         uint16  bit 0 = 1 (speed NOT present, INVERTED)
                                     bit 2 = 1 (cadence present)
                                     bit 6 = 1 (power present)
                                     → 0b0000000001000101 = 0x0045
2       2      Cadence       uint16  wire = round(rpm / 0.5) = round(rpm * 2)
4       2      Power         sint16  wire = power_w (1 W resolution)
                                     ── total 6 bytes ──
```

Flags value: `(1 << 0) | (1 << 2) | (1 << 6) = 0x0045`. On the wire (LE): `0x45 0x00`.

### Reference Payload 1 — typical `{power: 200, cadence: 90}`

| Field   | Logical  | Wire (decimal) | Wire (hex, LE bytes) |
|---------|----------|----------------|----------------------|
| Flags   | 0x0045   | 69             | `45 00`              |
| Cadence | 90 rpm   | 180            | `B4 00`              |
| Power   | 200 W    | 200            | `C8 00`              |

**Expected payload:** `45 00 B4 00 C8 00`
**As `Uint8Array([0x45, 0x00, 0xB4, 0x00, 0xC8, 0x00])`** — total 6 bytes.

### Reference Payload 2 — sint16 negative edge `{power: -1, cadence: 0.5}`

| Field   | Logical    | Wire (decimal) | Wire (hex, LE bytes) |
|---------|------------|----------------|----------------------|
| Flags   | 0x0045     | 69             | `45 00`              |
| Cadence | 0.5 rpm    | 1              | `01 00`              |
| Power   | -1 W       | 0xFFFF (sint16 -1) | `FF FF`          |

**Expected payload:** `45 00 01 00 FF FF`
*(sint16 -1 is two's-complement 0xFFFF; writeInt16LE encodes correctly.)*

### Reference Payload 3 — sint16 positive max + half-rpm `{power: 32767, cadence: 90.5}`

| Field   | Logical    | Wire (decimal) | Wire (hex, LE bytes) |
|---------|------------|----------------|----------------------|
| Flags   | 0x0045     | 69             | `45 00`              |
| Cadence | 90.5 rpm   | 181            | `B5 00`              |
| Power   | 32767 W    | 0x7FFF         | `FF 7F`              |

**Expected payload:** `45 00 B5 00 FF 7F`

### Reference Payload 4 — sint16 negative min `{power: -32768, cadence: 0}`

| Field   | Logical    | Wire (decimal) | Wire (hex, LE bytes) |
|---------|------------|----------------|----------------------|
| Flags   | 0x0045     | 69             | `45 00`              |
| Cadence | 0 rpm      | 0              | `00 00`              |
| Power   | -32768 W   | 0x8000         | `00 80`              |

**Expected payload:** `45 00 00 00 00 80`

### Reference Payload 5 — speed-present branch `{power: 100, cadence: 60, speed: 30}` (covers D-06)

When `speed` is provided, bit 0 = 0 ("speed PRESENT"). Field order: Flags, Speed, Cadence, Power. (Speed is bit-0 = "More Data" inversion target; per the spec field order, Speed precedes Cadence.)

| Field   | Logical    | Wire (decimal) | Wire (hex, LE bytes) |
|---------|------------|----------------|----------------------|
| Flags   | 0x0044     | 68             | `44 00`              | bit 0 = 0 (speed present), bit 2 cadence, bit 6 power
| Speed   | 30 km/h    | 3000           | `B8 0B`              | wire = round(30 / 0.01)
| Cadence | 60 rpm     | 120            | `78 00`              |
| Power   | 100 W      | 100            | `64 00`              |

**Expected payload:** `44 00 B8 0B 78 00 64 00` — total 8 bytes.

**Spec confirmation:** `[CITED: github.com/dvmarinoff/Auuki/blob/master/src/ble/ftms/indoor-bike-data.js]` — Auuki's `order` array places `InstantaneousSpeed` immediately after `Flags`, `InstantaneousCadence` after `AverageSpeed` (skipped when not present), and `InstantaneousPower` later. Skipping not-present fields shifts the layout. PyFTMS confirms the same field order `[CITED: github.com/dudanov/python-pyftms/blob/master/src/pyftms/models/realtime_data/indoor_bike.py]`.

**Spec citation:** Bluetooth SIG Fitness Machine Service v1.0.1, §4.9 "Indoor Bike Data" `[CITED: bluetooth.com/specifications/specs/fitness-machine-service-1-0/]` — the spec PDF is gated behind a SIG download but the layout above is cross-confirmed by Auuki and PyFTMS. `[ASSUMED]` that the spec PDF text matches what these two independent implementations produce; an executor implementing the encoder should download the SIG PDF for direct quote in code comments.

## Stack-Config Concrete Templates

### `package.json` (paste-and-tweak)

```json
{
  "name": "trainer-sim",
  "version": "0.0.1",
  "description": "Standalone Node.js library that impersonates a BLE FTMS smart trainer by replaying pre-recorded FIT files.",
  "license": "MIT",
  "type": "module",
  "engines": {
    "node": ">=24.0"
  },
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.cjs"
    }
  },
  "files": [
    "dist",
    "README.md",
    "LICENSE.md"
  ],
  "scripts": {
    "build": "tsup",
    "test": "vitest run",
    "test:watch": "vitest",
    "validate:publint": "publint",
    "validate:attw": "attw --pack .",
    "validate": "npm run build && npm run validate:publint && npm run validate:attw",
    "prepublishOnly": "npm run validate && npm test"
  },
  "devDependencies": {
    "@arethetypeswrong/cli": "~0.18.2",
    "@types/node": "~24.12.4",
    "publint": "~0.3.21",
    "tsup": "~8.5.1",
    "tsx": "~4.21.0",
    "typescript": "~5.9.3",
    "vitest": "~4.1.6"
  },
  "publishConfig": {
    "access": "public"
  },
  "repository": {
    "type": "git",
    "url": "git+https://github.com/agni21/trainer-sim.git"
  }
}
```

**Note on v2 forward-compatibility:** When BlenoTransport ships, add a second exports key:
```json
"./bleno": {
  "types": "./dist/bleno.d.ts",
  "import": "./dist/bleno.js",
  "require": "./dist/bleno.cjs"
}
```
…and add `src/bleno.ts` as a second tsup entry. The above `package.json` does not need restructuring.

### `tsconfig.json` (paste-and-tweak)

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "forceConsistentCasingInFileNames": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "types": ["node"]
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "test"]
}
```

**Justification for `moduleResolution: "bundler"` over `"node16"`:**
- tsup uses esbuild internally — `bundler` matches the build behavior (no extension requirements in source imports).
- `node16` forces explicit `.js` extensions in source imports (e.g., `import { x } from './y.js'`), which works but is friction for a small library where the build does the resolution.
- attw's "FalseExportDefault" / "CJSResolvesToESM" errors are caught by attw itself, not by `node16` resolution mode — so we don't lose validation.
- TypeScript 5.9's `bundler` mode handles `.d.cts` correctly.
- `[CITED: github.com/jimmykane/fit-parser/blob/master/package.json]` uses neither `bundler` nor `node16` (it predates `bundler`); but modern tsup-based libs in 2026 default to `bundler`.

A separate `tsconfig.test.json` for the test suite (extends the main one with `include: ["test/**/*", "src/**/*"]`) is optional — vitest doesn't strictly need it because vitest does its own TS handling.

### `tsup.config.ts` (paste-and-tweak)

```typescript
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  treeshake: true,
  clean: true,
  target: 'node24',
  outDir: 'dist',
  // For v2 BlenoTransport: add a second entry point as a separate sub-export.
  // entry: { index: 'src/index.ts', bleno: 'src/bleno.ts' },
  // and mark @stoprocent/bleno as `external: ['@stoprocent/bleno']`.
});
```

**Future (v2) note:** the commented-out `entry` form (object with named keys) emits `dist/index.js`, `dist/index.cjs`, `dist/bleno.js`, `dist/bleno.cjs` — matches the v2 `package.json` exports map. Single-entry array form for v1 is simpler and produces the same `dist/index.{js,cjs}`.

`[CITED: tsup.egoist.dev]` confirms the above options for dual ESM/CJS with .d.ts/.d.cts generation.

### `vitest.config.ts` (paste-and-tweak)

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,             // require explicit imports of `it`, `expect`, etc.
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      exclude: ['test/fixtures/**', 'dist/**'],
    },
  },
});
```

**Discretion area:** if Phase 1 ends up using vitest's `vi.useFakeTimers()` (it shouldn't — encoder is pure), add a `setupFiles: ['./test/setup.ts']` entry. Phase 1 has no time-sensitive code; skip it.

### `.github/workflows/ci.yml` (paste-and-tweak; honors D-13)

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    name: test (${{ matrix.os }})
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, macos-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '24'
          cache: 'npm'
      - run: npm ci
      - run: npm run build
      - run: npm test
      - run: npm run validate:publint
      - run: npm run validate:attw
```

**Notes:**
- D-13 locks Node 24 only; no version matrix dimension.
- `fail-fast: false` so a macOS-only failure doesn't mask a Linux-only failure.
- `actions/checkout@v4` and `actions/setup-node@v4` are stable as of 2026-05-13 `[ASSUMED — common knowledge; an executor should `gh api repos/actions/setup-node/releases/latest` to confirm during execution]`.
- `cache: 'npm'` uses `package-lock.json` hash for cache keying.
- `validate:publint` and `validate:attw` are separate steps (not bundled into `validate`) so CI shows distinct red/green per check.

## publint + attw — Common Gotchas for Dual-Published TS Libraries

`[CITED: github.com/arethetypeswrong/arethetypeswrong.github.io/tree/main/docs/problems]` — attw catalogs 12 problem categories. The most common first-run failures for a tsup-built library:

| Error | What attw reports | Common cause | Fix |
|-------|-------------------|--------------|-----|
| **FalseExportDefault** | "Types declare a default export but the JS does not" | A TS source uses `export default fn` while consumer uses CJS `require` — interop expects `module.exports = fn` not `module.exports = { default: fn }` | Either use named exports only (`export function encodeIndoorBikeData(...)`) — recommended for this project — or use `export = fn` syntax (rare). |
| **NamedExports** | "Named exports declared in types don't exist in the JS module" | Hand-authored types or weird tsup config that desyncs `.d.ts` from `.js` | Use named exports throughout; let tsup generate `.d.ts`/`.d.cts` from source. |
| **CJSResolvesToESM** | "A `require` call resolved to an ESM JavaScript file" | Missing `"require"` condition in `exports` map, or the CJS file has wrong `"type"` | Ensure `package.json` has `"require": "./dist/index.cjs"` AND that `index.cjs` is actually CJS-flavored (tsup with `format: ['cjs']` produces this correctly). |
| **MissingExportEquals** | "JS uses `module.exports = X` but TS uses `export default`" | Mismatch between source and emitted CJS | Same as FalseExportDefault — use named exports. |
| **InternalResolutionError** | "Import in a .d.ts file doesn't resolve" | Source imports like `from './foo'` (no extension) generate `.d.ts` with the same form, which fails under `node16` resolution | Either use `moduleResolution: "bundler"` (chosen here) or add `.js` extensions to source imports. |
| **FalseCJS / FalseESM** | Type file claims one format but the JS is the other | exports map condition keys are wrong order (types must precede import/require) | Order conditions: `"types"` first, then `"import"`, then `"require"`. The template above does this. |

**publint** common warnings:
- `"main"` field points to ESM but `"type": "module"` is set → publint expects `"main"` to be CJS in dual-published libs (the template above puts CJS at `main`).
- `"exports"` map doesn't include a `"types"` condition first.
- `dist/` files referenced in `exports` don't exist at publish time → run `npm run build` before publint.
- Missing `"files"` array → npm includes everything; pin `["dist", "README.md", "LICENSE.md"]`.

**Live example reference:** `fit-file-parser` uses a dual-tsc build (not tsup) and a slightly different exports map: `[CITED: github.com/jimmykane/fit-parser/blob/master/package.json]`
```json
"main": "dist/cjs/fit-parser.js",
"type": "module",
"exports": {
  ".": {
    "types": "./dist/fit-parser.d.ts",
    "import": "./dist/fit-parser.js",
    "require": "./dist/cjs/fit-parser.js"
  }
}
```
…with a build script that creates `dist/cjs/package.json` containing `{"type":"commonjs"}` so Node treats the CJS files as CJS even though the parent `package.json` says `"type": "module"`. tsup handles this automatically (it emits `.cjs` extension, which Node treats as CJS regardless of parent `type`), so the template above doesn't need the `dist/cjs/package.json` workaround.

**Recommended first-run sequence:**
1. `npm run build`
2. `npm run validate:publint` (fix all errors before proceeding)
3. `npm run validate:attw` (fix all errors)
4. Add both to CI

## Vitest Patterns for Parametrized Tests

`[CITED: vitest.dev/api/#test-each]` — vitest 4.x supports four `it.each` forms.

### Pattern: Parametrized sint16 sign edges

```typescript
import { describe, it, expect } from 'vitest';
import { encodeIndoorBikeData } from '../src/ftms/indoor-bike-data.js';
import { decodeIndoorBikeData } from './fixtures/ftms-decoder.js'; // license-vetted decoder

describe('FTMS encoder — sint16 power sign edges', () => {
  it.each([
    { power: 200,    cadence: 90,   label: 'typical' },
    { power: -1,     cadence: 0.5,  label: 'sint16 -1' },
    { power: 32767,  cadence: 90.5, label: 'sint16 max' },
    { power: -32768, cadence: 0,    label: 'sint16 min' },
  ])('round-trips power=$power cadence=$cadence ($label)', ({ power, cadence }) => {
    const encoded = encodeIndoorBikeData({ power, cadence });
    const decoded = decodeIndoorBikeData(encoded);

    expect(decoded.power).toBe(power);
    expect(decoded.cadence).toBe(cadence);
  });
});
```

The `$power` / `$cadence` / `$label` placeholders generate readable test names: `round-trips power=200 cadence=90 (typical)`, etc. Each case is a separate test — failures don't cascade.

### Pattern: Byte-correctness against reference fixtures

```typescript
describe('FTMS encoder — byte-correctness', () => {
  it.each([
    {
      label: 'typical',
      record: { power: 200, cadence: 90 },
      expected: new Uint8Array([0x45, 0x00, 0xB4, 0x00, 0xC8, 0x00]),
    },
    {
      label: 'sint16 -1, half-rpm 0.5',
      record: { power: -1, cadence: 0.5 },
      expected: new Uint8Array([0x45, 0x00, 0x01, 0x00, 0xFF, 0xFF]),
    },
    {
      label: 'sint16 max, 90.5 rpm',
      record: { power: 32767, cadence: 90.5 },
      expected: new Uint8Array([0x45, 0x00, 0xB5, 0x00, 0xFF, 0x7F]),
    },
    {
      label: 'sint16 min',
      record: { power: -32768, cadence: 0 },
      expected: new Uint8Array([0x45, 0x00, 0x00, 0x00, 0x00, 0x80]),
    },
  ])('encodes $label byte-for-byte', ({ record, expected }) => {
    const view = encodeIndoorBikeData(record);
    const actual = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
    expect(actual).toEqual(expected);
  });
});
```

### Pattern: Bit-0 inversion both branches (D-06)

```typescript
describe('FTMS encoder — bit-0 inversion (FTMS-04)', () => {
  it('sets bit 0 = 1 when speed is omitted (more data, NOT present)', () => {
    const view = encodeIndoorBikeData({ power: 100, cadence: 60 });
    const flags = view.getUint16(0, true);
    expect(flags & 0b1).toBe(1);
  });

  it('sets bit 0 = 0 when speed IS present (inversion: 0 means present)', () => {
    const view = encodeIndoorBikeData({ power: 100, cadence: 60, speed: 30 });
    const flags = view.getUint16(0, true);
    expect(flags & 0b1).toBe(0);
  });

  it('round-trips speed-present payload through decoder', () => {
    const encoded = encodeIndoorBikeData({ power: 100, cadence: 60, speed: 30 });
    const decoded = decodeIndoorBikeData(encoded);
    expect(decoded.speed).toBeCloseTo(30, 2);
    expect(decoded.cadence).toBe(60);
    expect(decoded.power).toBe(100);
  });
});
```

### Pattern: FIELDS table invariants (D-09 source-of-truth assertion)

```typescript
import { FIELDS } from '../src/ftms/indoor-bike-data.js';

describe('FIELDS source-of-truth', () => {
  it('declares power as sint16 (NOT uint16 — Auuki bug check)', () => {
    expect(FIELDS.instantaneousPower.type).toBe('sint16');
  });

  it('declares cadence resolution as 0.5 rpm', () => {
    expect(FIELDS.instantaneousCadence.resolution).toBe(0.5);
  });

  it('declares speed bit-0 as inverted', () => {
    expect(FIELDS.instantaneousSpeed.flagBit).toBe(0);
    expect(FIELDS.instantaneousSpeed.inverted).toBe(true);
  });
});
```

This makes silent FIELDS mutation impossible (a developer who "fixes" `'sint16'` to `'uint16'` to match Auuki fails this test).

## Common Pitfalls

(All sourced from `.planning/research/PITFALLS.md` §1–4 plus encoder-specific gotchas surfaced during this research.)

### Pitfall 1: bit-0 "More Data" inversion (PITFALLS.md #1)

**What goes wrong:** Treat bit 0 like every other flag bit (1 = present). Result: encoder sets bit 0 = 1 to mean "speed present," decoder reads "speed NOT present," bytes after the flag are misaligned.
**Why it happens:** Every other GATT characteristic uses "1 = present"; FTMS bit 0 is the exception.
**How to avoid:** D-05 named constant `MORE_DATA_BIT = 0`; explicit `(speed === undefined ? 1 : 0) << MORE_DATA_BIT`; round-trip test both branches (D-06).
**Warning sign:** Auuki decoder reads `speed = some-cadence-value` because bytes are off by 2.

### Pitfall 2: sint16 vs uint16 power (PITFALLS.md #2)

**What goes wrong:** Encoder uses `Buffer.writeUInt16LE` for power. `power = -1` becomes `65535` because JS coerces.
**How to avoid:** D-09 FIELDS table marks power as `'sint16'`; encoder dispatches on type string; use `Buffer.writeInt16LE`. Test sign edges `-1`, `-32768`, `+32767` (Reference Payloads 2, 3, 4).
**Warning sign:** Negative power round-trips as 65535 (Auuki's known bug — see §Auuki Decoder Consumption).

### Pitfall 3: cadence half-rpm (PITFALLS.md #3)

**What goes wrong:** `wire = cadence_rpm` instead of `wire = cadence_rpm * 2`.
**How to avoid:** D-09 FIELDS resolution = 0.5; encoder always divides by `FIELDS.instantaneousCadence.resolution`. Test 90.5 rpm round-trips as 90.5, not 45 (Reference Payload 3).

### Pitfall 4: little-endian byte order (PITFALLS.md #4)

**What goes wrong:** `DataView.setUint16(0, 180)` (no `true`) writes `0x00 0xB4` — big-endian — which decodes as 46080.
**How to avoid:** D-10 mandates `Buffer.write*LE`; reject raw `DataView.setUint16` in code review.
**Warning sign:** Cadence shows up as 46080 instead of 90 in nRF Connect.

### Pitfall 5 (encoder-specific): Forgetting to round before writing

**What goes wrong:** `cadence = 90.5; wire = cadence / 0.5 = 181`. JavaScript happens to produce an integer here, but for `cadence = 73.3` (sensor noise), `wire = 146.6`, which `Buffer.writeUInt16LE` truncates silently to 146 — losing 0.3 rpm.
**How to avoid:** Always `Math.round(value / resolution)` before passing to `writeUInt16LE`. Document expected input precision in JSDoc.

### Pitfall 6 (encoder-specific): Trying to encode `NaN` or `undefined`

**What goes wrong:** Future caller passes `{power: NaN, cadence: 0}`; `Buffer.writeInt16LE(NaN, 0)` writes `0x00 0x00` (not `throw`) on Node 24 — silent zero. Or passes `{cadence: undefined}` — `undefined / 0.5 = NaN`.
**How to avoid:** Validate inputs at function entry. Throw `RangeError` for `NaN`/`undefined`/out-of-int16-range. v1 callers (Phase 3 replay) will pass real numbers, but defending the encoder boundary is cheap.
**This is likely a `[ASSUMED]`** that v1 callers always pass valid numbers — Phase 2 (FIT loader) and Phase 3 (replay) need to guarantee non-NaN power and cadence values. Encoder validation is defensive depth.

## Code Examples

Verified patterns. Sources cited inline.

### Example 1: Complete encoder skeleton (synthesized from D-09 + D-10)

```typescript
// src/ftms/indoor-bike-data.ts
// Source: synthesized from CONTEXT.md D-07..D-10, PITFALLS.md §1-4,
// Bluetooth SIG FTMS spec v1.0.1 §4.9 (Indoor Bike Data characteristic).

import { Buffer } from 'node:buffer';

export interface IndoorBikeRecord {
  /** Watts, sint16 (-32768..+32767), 1 W resolution. */
  power: number;
  /** RPM, encoded as uint16 with 0.5 rpm resolution (wire = rpm * 2). */
  cadence: number;
  /** km/h, uint16 with 0.01 km/h resolution. v1 callers omit. */
  speed?: number;
}

// Source-of-truth field table (CONTEXT.md D-09).
// DO NOT change `instantaneousPower.type` to 'uint16' (Auuki bug; PITFALLS.md #2).
export const FIELDS = {
  instantaneousSpeed:   { type: 'uint16', resolution: 0.01, flagBit: 0, inverted: true  },
  instantaneousCadence: { type: 'uint16', resolution: 0.5,  flagBit: 2, inverted: false },
  instantaneousPower:   { type: 'sint16', resolution: 1,    flagBit: 6, inverted: false },
} as const;

// FTMS spec 4.9: bit 0 is "More Data" — INVERTED. (PITFALLS.md #1)
// 0 = InstantaneousSpeed PRESENT, 1 = NOT present.
const MORE_DATA_BIT = FIELDS.instantaneousSpeed.flagBit;
const CADENCE_PRESENT_BIT = FIELDS.instantaneousCadence.flagBit;
const POWER_PRESENT_BIT = FIELDS.instantaneousPower.flagBit;

function buildFlags(record: IndoorBikeRecord): number {
  let flags = 0;
  flags |= (record.speed === undefined ? 1 : 0) << MORE_DATA_BIT;
  flags |= 1 << CADENCE_PRESENT_BIT;
  flags |= 1 << POWER_PRESENT_BIT;
  return flags;
}

function payloadByteLength(record: IndoorBikeRecord): number {
  // Flags (2) + Cadence (2) + Power (2) + optional Speed (2)
  return 6 + (record.speed !== undefined ? 2 : 0);
}

export function encodeIndoorBikeData(record: IndoorBikeRecord): DataView {
  const buf = Buffer.alloc(payloadByteLength(record));
  let offset = 0;

  // Flags (uint16 LE)
  buf.writeUInt16LE(buildFlags(record), offset);
  offset += 2;

  // Speed (uint16 LE, 0.01 km/h) — when present, comes BEFORE cadence
  if (record.speed !== undefined) {
    const wireSpeed = Math.round(record.speed / FIELDS.instantaneousSpeed.resolution);
    buf.writeUInt16LE(wireSpeed, offset);
    offset += 2;
  }

  // Cadence (uint16 LE, 0.5 rpm)
  const wireCadence = Math.round(record.cadence / FIELDS.instantaneousCadence.resolution);
  buf.writeUInt16LE(wireCadence, offset);
  offset += 2;

  // Power (sint16 LE, 1 W) — sign matters!
  buf.writeInt16LE(record.power, offset);
  offset += 2;

  // Return a DataView over the same memory (PROJECT.md mandates DataView).
  return new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
}
```

### Example 2: Hand-rolled MIT decoder for test fixtures (~50 lines, Option D)

```typescript
// test/fixtures/ftms-decoder.ts
// MIT-licensed in-test decoder. Inverts encodeIndoorBikeData for round-trip.
// Validated against Bluetooth SIG FTMS v1.0.1 §4.9.

export interface DecodedIndoorBike {
  speed?: number;
  cadence: number;
  power: number;
}

const SPEED_BIT = 0;        // INVERTED
const CADENCE_BIT = 2;
const POWER_BIT = 6;

export function decodeIndoorBikeData(view: DataView): DecodedIndoorBike {
  const flags = view.getUint16(0, true);
  const speedPresent = (flags & (1 << SPEED_BIT)) === 0;        // inverted
  const cadencePresent = (flags & (1 << CADENCE_BIT)) !== 0;
  const powerPresent = (flags & (1 << POWER_BIT)) !== 0;

  let offset = 2;
  let speed: number | undefined;
  let cadence: number | undefined;
  let power: number | undefined;

  if (speedPresent) {
    speed = view.getUint16(offset, true) * 0.01;
    offset += 2;
  }
  if (cadencePresent) {
    cadence = view.getUint16(offset, true) * 0.5;
    offset += 2;
  }
  if (powerPresent) {
    power = view.getInt16(offset, true); // sint16!
    offset += 2;
  }

  if (cadence === undefined || power === undefined) {
    throw new Error('decodeIndoorBikeData: required fields missing in flags');
  }
  return { speed, cadence, power };
}
```

This decoder is the inverse of the encoder above — same FIELDS, same bit positions, sint16 for power. ~30 lines after stripping comments. **MIT-clean** (we authored it).

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `tsc` + manual CJS shim script | `tsup` for dual ESM/CJS with `.d.ts`/`.d.cts` | ~2023 | tsup is now the default for new TS libraries; avoids ~50 LOC of build glue |
| `ts-node` for dev runs | `tsx` (or native `node --experimental-strip-types` on Node 24) | ~2024 | ~10× faster startup; tsx handles ESM + CJS + TS uniformly |
| `jest` for TS testing | `vitest` | ~2023 | Native ESM + TS; matches the libs we depend on (`fit-file-parser`, `@garmin/fitsdk` use vitest) |
| `moduleResolution: "node"` | `moduleResolution: "bundler"` (or `"node16"`/`"nodenext"` for stricter) | TS 5.0 (2023) | Removes the `.js` extension requirement for source imports in bundler-targeted libs |
| `package.json` `main` only | `package.json` `exports` map with conditions (`types`, `import`, `require`) | Node 12+ (mainstream by 2022) | Consumers get the right format; types resolve correctly |
| Hand-checked types-publishing | `@arethetypeswrong/cli` in CI | ~2023 | Catches 12 categories of dual-publishing bugs that publint doesn't see |

**Deprecated/outdated:**
- `@abandonware/bleno` → `@stoprocent/bleno` (v2 concern, not Phase 1) — STACK.md handles this.
- `ts-node` → `tsx` — Phase 1 uses `tsx` for any dev scripts.
- TS `5.9.x` → `6.0.x` — TS 6 is now `latest` `[VERIFIED: npm view typescript dist-tags → latest 6.0.3 (2026-04-16)]` but CLAUDE.md and CONTEXT.md lock TS 5.9. Do not adopt TS 6 in this phase. Re-evaluate at next phase transition.

## Validation Architecture

This project's `workflow.nyquist_validation` is `false` in `.planning/config.json`, so the section is informational. FTMS encoding correctness is too important to skip a structured test plan, however — surface this for the planner to derive must-haves.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest 4.1.6 |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run test/ftms/indoor-bike-data.test.ts` |
| Full suite command | `npm test` (= `vitest run`) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| FTMS-01 | LE byte layout matches spec | unit (byte-correctness) | `npx vitest run -t "byte-correctness"` | ❌ Wave 0 (`test/ftms/indoor-bike-data.test.ts`) |
| FTMS-02 | Power sint16 across full range | unit (parametrized) | `npx vitest run -t "sint16 power"` | ❌ Wave 0 |
| FTMS-03 | Cadence ×2 (half-rpm) | unit (parametrized) | `npx vitest run -t "half-rpm"` | ❌ Wave 0 |
| FTMS-04 | Bit-0 inversion both branches | unit + round-trip | `npx vitest run -t "bit-0 inversion"` | ❌ Wave 0 |
| FTMS-05 | Round-trip through 3rd-party (or hand-rolled MIT) decoder | round-trip | `npx vitest run -t "round-trip"` | ❌ Wave 0 (depends on §Auuki Decoder Consumption resolution) |
| API-07 (pulled forward, D-12) | Dual-publish hygiene | tooling | `npm run validate:publint && npm run validate:attw` | ❌ Wave 0 (`package.json` scripts + CI workflow) |

### Invariants the test suite must enforce

1. **Encoded byte length** = `2 + 2 + 2 + (speed ? 2 : 0)` — assert in every byte-correctness test
2. **Flag bits set match record contents** — assert via `flags & (1 << bit)` for each present field
3. **Decoder echoes input** — `decode(encode(record)).{power,cadence,speed} === record.{...}` (within FP tolerance for speed)
4. **FIELDS table is unchanged** — test asserts `FIELDS.instantaneousPower.type === 'sint16'` etc. (catches silent mutation)
5. **Endianness** — for at least one fixture, manually decode the byte at `offset+1` as the high byte (LE), assert it matches expected high byte

### Test categories

- **Byte-correctness:** 4–5 reference payloads (this doc §Reference Payloads), `Uint8Array.toEqual`
- **Round-trip:** ≥4 cases through the chosen decoder (sint16 edges + half-rpm + speed-present)
- **Edge cases:** parametrized via `it.each` — `power ∈ {-32768, -1, 0, 1, 200, 32767}`, `cadence ∈ {0, 0.5, 90, 90.5, 180}`
- **Branch coverage of bit-0 inversion:** explicit `speed=undefined` AND `speed=30` cases (D-06)
- **FIELDS invariants:** assert table values directly

### Sampling Rate (informational, since nyquist_validation: false)

- **Per task commit:** `npx vitest run` (full suite — encoder is small, runs in <1s)
- **Per wave merge:** `npm run validate` (build + publint + attw)
- **Phase gate:** All of the above green; CI (Linux + macOS) green on the merge commit

### Wave 0 Gaps

- [ ] `test/ftms/indoor-bike-data.test.ts` — covers FTMS-01..05
- [ ] `test/fixtures/ftms-decoder.ts` (or `.js`) — depends on §Auuki Decoder Consumption resolution
- [ ] `test/fixtures/README.md` — provenance / license attribution if Auuki path chosen
- [ ] Framework install: `npm install -D vitest@~4.1.6` (and other dev deps per §Standard Stack)

## Runtime State Inventory

**Not applicable** — Phase 1 is greenfield (the first code commit per CONTEXT.md "Existing Code Insights: None"). There is no rename, refactor, or migration in this phase. No stored data, live service config, OS-registered state, secrets/env vars, or build artifacts to inventory.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js 24 | Runtime + tsup target | ✓ | 24.15.0 `[VERIFIED: node --version]` | None — Phase 1 cannot proceed without Node ≥24 |
| npm | Package management | ✓ | 11.12.1 `[VERIFIED: npm --version]` | `pnpm` or `yarn` could substitute (CLAUDE.md says LOW confidence on npm specifically) |
| git | Version control + GitHub Actions checkout | ✓ | 2.50.1 `[VERIFIED: git --version]` | None |
| GitHub Actions runners (macos-latest, ubuntu-latest) | CI per D-13 | ✓ `[ASSUMED — standard GitHub-hosted runners]` | — | Self-hosted runners if GH Actions is unavailable; not Phase 1 scope |
| Internet access for npm registry | Initial dep install | `[ASSUMED — present during execution]` | — | If offline, install from a local mirror |

**Missing dependencies with no fallback:** None.
**Missing dependencies with fallback:** None.

## Project Constraints (from CLAUDE.md)

These directives from CLAUDE.md are non-negotiable for this phase. The planner MUST verify task plans don't violate them.

| Directive | Source (CLAUDE.md section) | Application |
|-----------|---------------------------|-------------|
| Tech stack: Node.js + TypeScript | "Constraints" | All code is TS; no Python/Ruby/etc. |
| License: MIT | "Constraints" | All vendored code must be MIT-compatible. **AGPL-3.0 (Auuki) is NOT MIT-compatible — see §Auuki Decoder Consumption.** |
| Platform: macOS / Linux only for v1 | "Constraints" | CI matrix is `[ubuntu-latest, macos-latest]`; no Windows. |
| Compatibility: payloads match real FTMS encoding | "Constraints" | Round-trip test through external decoder is mandatory (FTMS-05). |
| Data format: Real Garmin/Wahoo FIT only | "Constraints" | Phase 2 concern; no FIT in Phase 1. |
| Repo layout: standalone, not monorepo | "Constraints" | Single `package.json`, no workspaces. |
| Hand-roll FTMS encoder | "Tech Stack" TL;DR + STACK.md | Vendored under `src/ftms/`; no npm dep. |
| Use `Buffer.write*LE`, NOT raw `DataView.setUint16` | PITFALLS.md #4 + CONTEXT.md D-10 | Encoder body never calls `DataView.setUint16` directly. |
| Use `tsup` 8.5 for builds | TL;DR | No webpack, rollup, or hand-rolled build script. |
| Use `vitest` 4.1 for tests | TL;DR | No jest. |
| TypeScript 5.9 (NOT 6.x) | TL;DR | Pin `~5.9.3` in devDependencies; reconsider only at next phase transition. |
| `engines: ">=24.0"` | TL;DR + CONTEXT.md D-16 | `package.json` engines field set; CI runs Node 24. |
| Dual-publish ESM + CJS | TL;DR + CONTEXT.md D-11 | tsup `format: ['esm', 'cjs']`; exports map has both conditions. |
| `publint` + `attw` non-negotiable | TL;DR + CONTEXT.md D-12 | Both wired into `npm run validate` and CI. |
| GSD Workflow Enforcement: edits go through GSD commands | "GSD Workflow Enforcement" | Plan tasks through `/gsd-execute-phase`; no direct repo edits in this phase. |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The Bluetooth SIG FTMS v1.0.1 spec PDF text matches the field layout/order/types described by Auuki + PyFTMS independently | Reference Payloads, FIELDS table | **HIGH** — wire format would be wrong; whole encoder fails round-trip. Mitigation: an executor downloads the SIG PDF and quotes §4.9 directly in encoder source comments. The dual-source agreement (Auuki + PyFTMS) is strong corroboration but not the spec itself. |
| A2 | `actions/checkout@v4` and `actions/setup-node@v4` are still current/stable on 2026-05-13 | CI workflow template | LOW — at worst, CI fails until upgraded; trivial fix. Verify with `gh api repos/actions/checkout/releases/latest`. |
| A3 | v1 callers (Phase 3 replay engine) will always pass non-NaN, in-range `power` and `cadence` to the encoder | Pitfall 5/6 — encoder validation | LOW — adding defensive checks at the encoder entry point is cheap; the assumption is just "we don't strictly need it for v1." Phase 2/3 will re-validate. |
| A4 | TypeScript 6.0.x is intentionally NOT yet adopted because CLAUDE.md/CONTEXT.md lock 5.9 | Standard Stack table | LOW — research surfaces this for the user; no action required this phase. |
| A5 | Internet access for npm registry is available at execution time | Environment Availability | LOW — without it, `npm ci` fails; standard developer workflow assumes online. |
| A6 | `moduleResolution: "bundler"` is the right choice over `"node16"` for this tsup-built library | tsconfig template | LOW — both work; `bundler` is simpler for tsup-built libs in 2026; switching is a one-line config change. |
| A7 | Auuki's GPL/AGPL contamination concern is enough of a blocker to recommend hand-rolled decoder over vendoring | Auuki Decoder Consumption | **MEDIUM** — this is a license-interpretation judgment. The user may decide the AGPL test fixture is acceptable; surface the question via `/gsd-discuss-phase` amendment. The technical recommendation (hand-rolled MIT decoder) is sound either way. |

## Open Questions (RESOLVED)

1. **D-03 license correction.** CONTEXT.md D-03 originally stated Auuki is MIT-compatible; verified findings show it is **AGPL-3.0**. Does the user want to (a) hand-roll a tiny MIT decoder under `test/fixtures/`, (b) submodule Auuki and accept legal review, or (c) pick a different decoder source (PyFTMS subprocess, etc.)?
   - What we know: Auuki is AGPL-3.0, has no `name` in `package.json`, and `npm install github:` is therefore impossible.
   - What's unclear: User's tolerance for AGPL test fixtures in an MIT repo.
   - Recommendation: Surface via discuss-phase amendment; default to Option D (hand-rolled MIT decoder).
   - **RESOLVED (2026-05-13):** CONTEXT.md D-01/D-02/D-03/D-03b/D-03c — Auuki rejected as AGPL; FTMS-05 is now a three-gate strategy (hand-computed byte fixtures + spec-cited hand-rolled MIT decoder at `test/fixtures/ftms-decoder.ts` + one-shot manual nRF Connect verification). Reflected in plans 01-02 (decoder fixture), 01-04 (round-trip), 01-05 (nRF Connect).

2. **TypeScript 6 adoption (deferred but flagged).** TS 6.0.3 is now `latest` on npm (2026-04-16). CLAUDE.md and CONTEXT.md lock 5.9. Should Phase 1 reconfirm 5.9 or open a side-question for the user?
   - What we know: 5.9.3 is the current 5.x maximum (2025-09-30); 6.0.3 is the absolute latest (2026-04-16).
   - What's unclear: Whether VeloWorld is on TS 5 or 6 — parity matters.
   - Recommendation: Stay on 5.9 for Phase 1 (the lock); note this in the plan-phase output for re-evaluation at next phase transition.
   - **RESOLVED (2026-05-13):** Phase 1 stays on TypeScript 5.9 per the existing CLAUDE.md / CONTEXT.md lock; plan 01-01 pins `typescript@~5.9.3`. Re-evaluate at next phase transition once VeloWorld TS version is confirmed.

3. **Speed-field encoding edge cases.** D-06 requires testing the speed-present branch, but the field-order in the payload (Speed precedes Cadence per Auuki/PyFTMS) means a speed-present payload is 8 bytes, not 6. Does the planner need additional reference payloads beyond Reference Payload 5?
   - What we know: One speed-present payload is enough to validate the inversion logic and the additional 2-byte offset.
   - What's unclear: Whether Phase 1's success criteria (which mention only `{power, cadence}` payloads in success criterion 1) want speed-present byte-correctness coverage too.
   - Recommendation: Include Reference Payload 5 as a byte-correctness fixture; the planner can downscope if it conflicts with task budget.
   - **RESOLVED (2026-05-13):** Reference Payload 5 (`{power: 100, cadence: 60, speed: 30}`) is included as a byte-correctness fixture in plan 01-04 Task 1, satisfying both the bit-0 inversion branch (D-06) and speed-field byte coverage. No additional payloads required for Phase 1.

## Sources

### Primary (HIGH confidence)
- `[VERIFIED: npm registry]` — typescript@5.9.3 (2025-09-30), tsup@8.5.1 (2025-11-12), vitest@4.1.6 (2026-05-11), tsx@4.21.0 (2025-11-30), publint@0.3.21 (2026-05-13), @arethetypeswrong/cli@0.18.2 (2025-06-09), @types/node@24.12.4
- `[VERIFIED: GitHub API → /repos/dvmarinoff/Auuki]` — license.spdx_id = "AGPL-3.0", default_branch = "master", master HEAD = `c0d1d4a045f0262604a8c85a4f6b088a4d6f4178` (2026-03-05)
- `[VERIFIED: GitHub commits API → src/ble/ftms/indoor-bike-data.js]` — last-touch SHA `1ad944a4c4c268a5ec70474fe9ab6620b5d7fd8d` (2024-03-20)
- `[VERIFIED: raw.githubusercontent.com/dvmarinoff/Auuki/master/src/ble/ftms/indoor-bike-data.js]` — confirms field-order, half-rpm cadence, Uint16-power Auuki bug, bit-0 inversion check `=== 0`
- `[VERIFIED: github.com/dvmarinoff/Auuki/blob/master/package.json]` — no name, no license, no main/exports → not npm-installable
- `[VERIFIED: github.com/dudanov/python-pyftms/blob/master/src/pyftms/models/realtime_data/indoor_bike.py]` — confirms `s2` (sint16) power, `u2.5` (uint16 with 0.5 resolution) cadence
- `[VERIFIED: ./CLAUDE.md, .planning/{PROJECT,REQUIREMENTS,ROADMAP,STATE}.md, .planning/research/{PITFALLS,ARCHITECTURE,STACK}.md, .planning/phases/01-vendored-ftms-codec/01-CONTEXT.md]` — all project authority docs read in full
- `[CITED: github.com/arethetypeswrong/arethetypeswrong.github.io/tree/main/docs/problems]` — 12 attw error categories enumerated
- `[CITED: github.com/jimmykane/fit-parser/blob/master/package.json]` — dual-publish exports map reference example
- `[CITED: tsup.egoist.dev]` — tsup config options for dual ESM+CJS
- `[CITED: vitest.dev/api/#test-each]` — `it.each` syntax forms

### Secondary (MEDIUM confidence)
- `[CITED: bluetooth.com/specifications/specs/fitness-machine-service-1-0/]` — FTMS spec page (PDF behind SIG download); content cross-confirmed via Auuki + PyFTMS independent implementations (see Assumption A1)
- `[CITED: PITFALLS.md sources]` — encoder traps cross-checked against Auuki + PyFTMS + SIG spec at original research time

### Tertiary (LOW confidence)
- None. All claims either VERIFIED in this session or CITED to a primary source.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every version verified against npm registry; compat checked against STACK.md
- Architecture / patterns: HIGH — synthesized from CONTEXT.md decisions + verified Auuki source layout
- Reference payloads: HIGH — hand-computed against published spec layout, sint16 two's-complement, half-rpm math; cross-checked with Auuki decoder behavior
- Auuki license interaction: MEDIUM — license is HIGH-confidence AGPL-3.0; the legal interpretation of "vendoring AGPL into MIT test fixtures" is conservative and recommends user confirmation
- attw / publint gotchas: HIGH — error catalog enumerated from upstream docs; example fixes cited from `fit-file-parser`
- CI workflow: MEDIUM — template is correct; specific action versions assumed current (A2)

**Research date:** 2026-05-13
**Valid until:** 2026-06-13 (30 days — stack is stable; re-verify if Phase 1 hasn't started by then). Re-verify Auuki SHAs and license at execution time in case the upstream repo changes.
