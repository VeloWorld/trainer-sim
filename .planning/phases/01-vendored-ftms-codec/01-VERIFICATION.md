---
phase: 01-vendored-ftms-codec
verified: 2026-05-14T00:00:00Z
status: passed
score: 6/6 must-haves verified
overrides_applied: 0
re_verification:
  previous_status: none
  previous_score: n/a
  gaps_closed: []
  gaps_remaining: []
  regressions: []
---

# Phase 01: Vendored FTMS Codec Verification Report

**Phase Goal:** Library produces byte-correct FTMS IndoorBikeData payloads that any spec-compliant decoder can consume.
**Verified:** 2026-05-14
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP.md Success Criteria)

| #  | Truth                                                                                                                                                                                          | Status     | Evidence |
| -- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | -------- |
| 1  | Encoder with `{power, cadence}` produces a little-endian `DataView` matching hand-computed reference payload byte-for-byte (FTMS-05b)                                                          | VERIFIED   | `npm test` passes 17/17. Test file `test/ftms/indoor-bike-data.test.ts` lines 51–95 assert all 5 RESEARCH.md reference payloads byte-for-byte (P1: `45 00 B4 00 C8 00`, P2: `45 00 01 00 FF FF`, P3: `45 00 B5 00 FF 7F`, P4: `45 00 00 00 00 80`, P5: `44 00 B8 0B 78 00 64 00`). Live demo script confirms identical output. |
| 2  | Encoded payloads round-trip cleanly through spec-cited hand-rolled MIT decoder at `test/fixtures/ftms-decoder.ts`, each field annotated with FTMS v1.0.1 §4.9 spec citation, authored from the spec rather than by inverting the encoder (FTMS-05a) | VERIFIED   | Decoder file exists at `test/fixtures/ftms-decoder.ts` (124 lines). Header JSDoc explicitly attests MIT license + independence from `src/ftms/indoor-bike-data.ts`. Each field carries FTMS §4.9 spec citation (lines 53–55 SPEED_BIT/CADENCE_BIT/POWER_BIT comments; lines 96–113 each field-read comment). `grep -c "from.*src/ftms" test/fixtures/ftms-decoder.ts` → 0 (no encoder imports — decoder is standalone with zero imports). Round-trip suite (test file lines 97–116) exercises 5 cases through `decodeIndoorBikeData`. |
| 3  | Power values across the sint16 sign edge (`-1`, `-32768`, `+32767`) round-trip with correct sign and value                                                                                     | VERIFIED   | Test cases in round-trip suite explicitly cover `power: -1` (line 103), `power: 32767` (line 104), `power: -32768` (line 105). All pass. Encoder uses `buf.writeInt16LE` (signed); decoder uses `view.getInt16(o, true)` (signed). Byte fixtures confirm sint16 wire encoding: `-1 → 0xFFFF`, `32767 → 0x7FFF`, `-32768 → 0x8000`. |
| 4  | Cadence at half-rpm resolution (e.g., 90.5 rpm) round-trips through the decoder as 90.5, not 45 or 181                                                                                         | VERIFIED   | Round-trip test "sint16 max + half-rpm 90.5" (line 104) decodes back to `cadence === 90.5`. Encoder line 156 uses `Math.round(record.cadence / FIELDS.instantaneousCadence.resolution)` with `resolution=0.5` (FIELDS line 95). Decoder line 104 multiplies by `0.5`. Byte fixture P3 confirms wire = 181 = 0x00B5 (90.5 × 2). |
| 5  | "More Data" flag bit-0 inversion is set correctly: encoded payloads decode with expected speed-present semantics                                                                               | VERIFIED   | Encoder line 113: `flags \|= (record.speed === undefined ? 1 : 0) << MORE_DATA_BIT;` — both branches active (D-05 verbatim). Test suite "bit-0 inversion both branches" (lines 118–147) explicitly verifies: bit 0 = 1 when speed omitted; bit 0 = 0 when speed present; round-trip preserves speed=30 km/h. Byte fixture P5 (flags 0x44 vs P1 flags 0x45) confirms the inversion is real, not hardcoded. |
| 6  | One-shot manual nRF Connect verification — dev script encodes `{power, cadence}`, nRF Connect reads back same values, screenshot attached (FTMS-05c)                                            | VERIFIED   | `scripts/nrf-connect-demo.ts` exists, runs via `npx tsx`, prints live encoder bytes (`45 00 B4 00 C8 00` for P1 + `44 00 B8 0B 78 00 64 00` for P5) — confirmed via direct execution. Screenshot `nrf-connect-verification.png` exists, 245898 bytes (4.8× the 50 KB floor), real PNG (1058×1104 RGBA). Sign-off in `nrf-connect-verification.md`: outcome `matched`, signed by Agnivesh Patel, zero `__REPLACE` placeholders, both Payload 1 and Payload 5 decoded values match source. Per the verifier prompt's instruction, the screenshot capture was a real human action with operator sign-off recorded — accepted as evidence. |

**Score:** 6/6 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `src/ftms/indoor-bike-data.ts` | Encoder + IndoorBikeRecord + FIELDS | VERIFIED | 165 lines. Exports `IndoorBikeRecord` (interface), `FIELDS` (`as const`), `encodeIndoorBikeData` (function). Confirmed via `grep ^export`. |
| `src/index.ts` | Re-exports encoder + type | VERIFIED | 4 lines (header + 2 re-exports). `export { encodeIndoorBikeData } from './ftms/indoor-bike-data.js';` and `export type { IndoorBikeRecord }` both with `.js` extensions per phase convention. |
| `test/fixtures/ftms-decoder.ts` | Spec-cited MIT decoder, independent | VERIFIED | 124 lines. Exports `decodeIndoorBikeData` and `DecodedIndoorBike`. Zero imports from `src/`. FTMS §4.9 citations on every field. Bit-0 inversion `=== 0` form present. `getInt16` for power, `getUint16` for cadence/speed, all with `, true` (LE). |
| `test/fixtures/README.md` | MIT/AGPL provenance documentation | VERIFIED | Documents MIT license, Auuki AGPL rejection rationale, "What NOT to add" section. |
| `test/ftms/indoor-bike-data.test.ts` | Byte-correctness + round-trip + FIELDS + bit-0 + endianness | VERIFIED | 181 lines. 17 tests across 5 suites. Imports use `.js` extensions. All 5 reference payload hex sequences present verbatim. |
| `package.json` | Dual-publish, Node 24, MIT, exports map | VERIFIED | `engines.node: ">=24.0"`, `license: "MIT"`, exports map with per-condition import/require + types-first ordering, `sideEffects: false`. |
| `tsconfig.json` + `tsconfig.test.json` | Strict TS + project-mode test config | VERIFIED | Both exist; strict mode on; `tsconfig.test.json` extends base, includes `test/**/*`. |
| `tsup.config.ts` | Dual ESM+CJS build with dts | VERIFIED | `format: ['esm', 'cjs']`, `dts: true`, target node24. Build emits `dist/index.{js,cjs,d.ts,d.cts}` (1.33/1.37/4.73/4.73 KB). |
| `vitest.config.ts` | Node env, `test/**/*.test.ts` include | VERIFIED | Config present and active (vitest runs 17 tests in 83ms). |
| `.github/workflows/ci.yml` | macOS + Ubuntu × Node 24 matrix | VERIFIED | 38 lines. Matrix `[ubuntu-latest, macos-latest]`, `node-version: '24'`, `fail-fast: false`. Steps: checkout v4 → setup-node v4 → npm ci → build → test → validate:publint → validate:attw. No Windows runner. No node-version matrix. |
| `scripts/nrf-connect-demo.ts` | Live encoder demo via tsx | VERIFIED | Imports encoder via `.js` extension. Computes hex from live encoder (not hardcoded). Prints both Payload 1 and Payload 5 bytes. References "FTMS-05c manual verification". Successfully executed during verification. |
| `nrf-connect-verification.png` | Real screenshot ≥ 50 KB | VERIFIED | 245898 bytes, PNG 1058×1104 RGBA. ~4.8× the 50 KB floor. |
| `nrf-connect-verification.md` | Verification record, outcome=matched, no placeholders | VERIFIED | Outcome `matched`. Zero `__REPLACE` placeholders (`grep -c __REPLACE` → 0). Date `2026-05-14`, method B, observed values for both Payloads 1 and 5 match source, signed by Agnivesh Patel. References screenshot filename. |

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | -- | --- | ------ | ------- |
| `src/index.ts` | `src/ftms/indoor-bike-data.ts` | named re-export with `.js` extension | WIRED | Two `export ... from './ftms/indoor-bike-data.js'` lines confirmed. |
| `package.json` | `tsup.config.ts` | `scripts.build = tsup` | WIRED | `npm run build` produces dual ESM+CJS bundles. |
| `package.json` | `vitest.config.ts` | `scripts.test = vitest run` | WIRED | `npm test` runs 17 tests. |
| `package.json` | `publint + attw` | `scripts.validate` | WIRED | `npm run validate` exits 0. publint reports "All good!". attw reports "No problems found 🌟" across all 4 resolution modes (node10, node16-CJS, node16-ESM, bundler). |
| `tsconfig.test.json` | `tsconfig.json` | `extends` | WIRED | Confirmed in summary; vitest 4.1 type-checks fixtures and tests cleanly. |
| `test/ftms/indoor-bike-data.test.ts` | `src/ftms/indoor-bike-data.ts` | `import { encodeIndoorBikeData, FIELDS } from '../../src/ftms/indoor-bike-data.js'` | WIRED | Line 38 of test file. |
| `test/ftms/indoor-bike-data.test.ts` | `test/fixtures/ftms-decoder.ts` | `import { decodeIndoorBikeData } from '../fixtures/ftms-decoder.js'` | WIRED | Line 39 of test file. Round-trip suite uses `decodeIndoorBikeData` 4 times. |
| `scripts/nrf-connect-demo.ts` | `src/ftms/indoor-bike-data.ts` | relative `.js` import | WIRED | Demo script executes successfully and prints live-computed bytes. |
| `.github/workflows/ci.yml` | `package.json` scripts | `run: npm ...` lines | WIRED | All 5 npm command steps present: `npm ci`, `npm run build`, `npm test`, `npm run validate:publint`, `npm run validate:attw`. Build precedes validate. |

### Data-Flow Trace (Level 4)

The encoder produces dynamic data from caller-supplied input. The "data flow" is `IndoorBikeRecord input → buildFlags + payloadByteLength → Buffer.write*LE → DataView return`. Verified:

| Artifact | Data Variable | Source | Produces Real Data | Status |
| -------- | ------------- | ------ | ------------------ | ------ |
| `encodeIndoorBikeData` | `buf` (Buffer) | `Buffer.alloc(payloadByteLength(record))` per call (D-08) | Yes — fresh buffer per invocation, populated via `writeUInt16LE`/`writeInt16LE` | FLOWING |
| `decodeIndoorBikeData` (oracle) | `flags`, `cadence`, `power`, `speed` | `view.getUint16/getInt16(offset, true)` reads | Yes — actual byte reads from caller-supplied DataView | FLOWING |
| Test suite | `view`, `actual`, `decoded` | Live `encodeIndoorBikeData(record)` invocation | Yes — assertions pass on real-encoded values | FLOWING |
| Demo script | `bytes` | Live `encodeIndoorBikeData(payload)` (NOT hardcoded) | Yes — confirmed by inspecting source: `Buffer.from(view.buffer, ...).toString('hex')` of live encoder output | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| `npm test` (full vitest suite) | `npm test` | 17 passed (17), Duration 83ms | PASS |
| `npm run build` (tsup dual-publish) | `npm run build` | ESM 1.33 KB, CJS 1.37 KB, d.ts 4.73 KB, d.cts 4.73 KB, all chunks emit | PASS |
| `npm run validate:publint` | publint v0.3.21 | "All good!" exit 0 | PASS |
| `npm run validate:attw` | attw via npm pack | "No problems found 🌟" — node10/node16-CJS/node16-ESM/bundler all 🟢 | PASS |
| `npm run validate` (build + publint + attw) | full chain | exit 0 | PASS |
| CJS resolution smoke | `node -e "require('./dist/index.cjs').encodeIndoorBikeData"` | typeof === function | PASS |
| ESM resolution smoke | `node --input-type=module -e "import('./dist/index.js')..."` | typeof === function | PASS |
| `npx tsx scripts/nrf-connect-demo.ts` | Demo helper invocation | Prints `45 00 B4 00 C8 00`, `44 00 B8 0B 78 00 64 00`, `200 W`, "FTMS-05c manual verification" — all from live encoder | PASS |

### Probe Execution

No conventional `scripts/*/tests/probe-*.sh` probes exist in this repo (Phase 1 is the first code commit; probes are a downstream-phase pattern). The phase's authoritative pass signals — `npm test` and `npm run validate` — are exercised in the Behavioral Spot-Checks section above and both exit 0.

| Probe | Command | Result | Status |
| ----- | ------- | ------ | ------ |
| (none discovered) | n/a | n/a | N/A — no probes declared by PLAN/SUMMARY; npm test + npm run validate cover the equivalent behavioral checks. |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| ----------- | ----------- | ----------- | ------ | -------- |
| FTMS-01 | 01-03, 01-04 | LE byte layout per Bluetooth SIG spec v1.0.1 | SATISFIED | All 5 byte fixtures pass (encoder uses `Buffer.write*LE` exclusively); endianness sanity test asserts `getUint16(2, false) === 46080` to pin LE-vs-BE invariant. |
| FTMS-02 | 01-03, 01-04 | sint16 power | SATISFIED | `FIELDS.instantaneousPower.type === 'sint16'` test passes; `writeInt16LE` used in encoder line 160; `getInt16` in decoder; sign-edge round-trip tests for `-1`, `-32768`, `0`, `32767` all pass. |
| FTMS-03 | 01-03, 01-04 | uint16 cadence with 0.5 rpm resolution | SATISFIED | `FIELDS.instantaneousCadence.resolution === 0.5` test passes; encoder divides by resolution before `Math.round`; 90.5 rpm round-trips faithfully. |
| FTMS-04 | 01-03, 01-04 | Inverted bit-0 "More Data" | SATISFIED | Encoder line 113 implements D-05 verbatim. Two explicit bit-0 tests (lines 125–135) verify both branches: speed-omitted → bit 0 = 1; speed-present → bit 0 = 0. Speed-present round-trip test verifies semantic equivalence. |
| FTMS-05a | 01-04 (decoder authored in 01-02) | Round-trip via spec-cited hand-rolled MIT decoder | SATISFIED | Round-trip suite (5 cases + 1 speed-present) decodes via `test/fixtures/ftms-decoder.ts`. Decoder has zero imports from `src/` — independence verified. Each field carries FTMS §4.9 spec comment. |
| FTMS-05b | 01-04 | Hand-computed byte fixtures match | SATISFIED | 5 byte fixtures from RESEARCH.md §Reference Payloads asserted byte-for-byte. |
| FTMS-05c | 01-05 | nRF Connect manual verification | SATISFIED | Screenshot 245898 bytes, sign-off `matched` by Agnivesh Patel, both payload methods documented and verified. Demo script runs and prints live bytes. |
| API-07 (pulled forward per D-12) | 01-04 | Dual ESM/CJS publish, publint + attw clean | SATISFIED | `npm run validate` exit 0. publint "All good!". attw "No problems found 🌟" across all four resolution modes. Per-condition exports map (import/require with .d.ts/.d.cts) is publint+attw clean. |

All 8 requirements declared in PLAN frontmatter (FTMS-01..05c + API-07) are satisfied. No orphaned requirements detected (REQUIREMENTS.md maps FTMS-01..05c to Phase 1; API-07 is pulled forward from Phase 4 per D-12 with explicit traceability).

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| (none) | — | — | — | All anti-pattern scans clean: no `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER` markers (other than docstring references for context); no empty implementations; no hardcoded empty data; no console.log-only stubs; no raw `setUint16`/`setInt16` non-comment matches; no hardcoded `flags = 0x00..` literals (the inversion is a real branch). |

### Human Verification Required

None — all six ROADMAP success criteria are programmatically verifiable via `npm test`, `npm run validate`, file existence checks, and the live demo script. The nRF Connect manual verification (FTMS-05c) was already executed by the operator with sign-off recorded; per the verifier prompt's explicit instruction, this human-action checkpoint is accepted as completed evidence and is not re-classified as `human_needed`.

### Gaps Summary

No gaps. Every observable truth from the ROADMAP success criteria is satisfied with concrete codebase evidence:

- **Encoder correctness:** `npm test` 17/17 green; all 5 RESEARCH.md reference payloads match byte-for-byte; sign-edge sint16 power and half-rpm cadence round-trip cleanly through the spec-cited MIT decoder; bit-0 inversion is a real branch (not hardcoded) verified in both directions.
- **Architecture hygiene:** Encoder is standalone (only imports `node:buffer`); decoder is standalone (zero imports); both extract cleanly to a future `@veloworld/ftms-codec` package. `src/index.ts` re-exports via `.js`-extension specifiers per phase convention.
- **Dual-publish hygiene:** publint reports "All good!"; attw reports "No problems found 🌟" across all four resolution modes (API-07 pulled forward per D-12).
- **CI:** `.github/workflows/ci.yml` exists with macOS+Ubuntu × Node 24 matrix, `fail-fast: false`, runs build → test → publint → attw as separate steps.
- **Third-party gate:** nRF Connect verification screenshot (245898 bytes, real PNG) and sign-off (outcome `matched`) close FTMS-05c.

The phase goal — "Library produces byte-correct FTMS IndoorBikeData payloads that any spec-compliant decoder can consume" — is achieved. Phase 2 (FIT loader) can begin against this stable encoder + CI skeleton.

---

_Verified: 2026-05-14_
_Verifier: Claude (gsd-verifier)_
