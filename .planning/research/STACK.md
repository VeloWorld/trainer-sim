# Stack Research

**Domain:** Node.js/TypeScript library + (later) CLI for BLE FTMS smart trainer simulation via FIT replay
**Researched:** 2026-05-13
**Confidence:** HIGH

## TL;DR — Prescriptive Stack

| Concern | Pick | Confidence |
|---|---|---|
| Language | TypeScript 5.9.x, strict mode | HIGH |
| Runtime | Node.js 24 LTS (Krypton), engines `>=24.0` | HIGH |
| Module format | ESM-first, dual-publish ESM + CJS | HIGH |
| Bundler / library builder | `tsup` 8.5.x | HIGH |
| Test runner | `vitest` 4.1.x (stay on 4 — 5 is beta) | HIGH |
| TS execution / scripts | `tsx` 4.21.x | HIGH |
| Lint / format | ESLint 9 flat config + `@antfu/eslint-config` (or Biome if you want one tool) | MEDIUM |
| Package publish hygiene | `publint` + `@arethetypeswrong/cli` | HIGH |
| FIT parser (v1) | **`fit-file-parser` 3.0.0** — see comparison below | MEDIUM |
| FTMS IndoorBikeData encoder | **Hand-rolled** (`Buffer`/`DataView`, vendored in this repo) — no usable npm package exists | HIGH |
| BLE peripheral (v2) | **`@stoprocent/bleno` 0.12.x** — NOT `@abandonware/bleno` | HIGH |
| Package manager | npm (matches VeloWorld and the FIT parser/SDK ecosystem); pnpm fine if VeloWorld uses it | LOW |

> **`BlenoTransport` is v2, but the v1 stack must accommodate it.** The choices above let v2 add `@stoprocent/bleno` as an *optional* dependency (peer or `optionalDependencies`) and a separate subpath export (`trainer-sim/bleno`) without restructuring the build.

---

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|---|---|---|---|
| Node.js | 24.x LTS ("Krypton"), `engines: ">=24.0"` | Runtime | Active LTS (entered late 2025), supports VeloWorld parity (VeloWorld is on Node 24). Ships native `--test`, native `fetch`, stable `node:test`, ESM stable, broader `--experimental-strip-types` coverage for `.ts`. Avoid 20 (LTS ends April 2026, already past for this project); 22 ("Jod") is fine but VeloWorld parity drives the pick. |
| TypeScript | 5.9.x | Type system, types-first library API | VeloWorld's stack; `@stoprocent/bleno` ships `.d.ts`; `fit-file-parser` 3.0 ships generated `.d.ts`; modern `moduleResolution: "bundler"` or `"node20"` makes dual-publish trivial. |
| Module format | ESM-first, dual ESM/CJS publish via `exports` field | Importable from any consumer | `@garmin/fitsdk`, `fit-file-parser` v3, and most modern libs are ESM-first. VeloWorld is "Electron-ish" — Electron 28+ supports ESM, but renderer/main both load CJS too, so dual-publish removes the friction. |
| `tsup` | 8.5.1 | Library builder | esbuild-powered, zero-config dual ESM+CJS output, generates `.d.ts` and `.d.cts`, splits entry points trivially (`src/index.ts` + `src/bleno.ts` as separate exports for v2). Standard choice for TS libraries in 2025–2026. |
| `vitest` | 4.1.6 (stay on 4.x — 5.0 is beta) | Test runner | Native ESM and TS, drop-in Jest API, watch mode, fast. `@garmin/fitsdk` and `fit-file-parser` both use vitest themselves — your testing pattern matches the libraries you depend on. |
| `tsx` | 4.21.0 | Run TS scripts and the future CLI in dev | Replaces `ts-node`; near-native startup; needed because `node --experimental-strip-types` doesn't yet handle `tsconfig` paths or all syntax |

### Domain Libraries

| Library | Version | Purpose | When to Use |
|---|---|---|---|
| `fit-file-parser` | 3.0.0 | Parse FIT files into JS objects (v1) | **Primary FIT parser recommendation** — see deferred-decision section. MIT, ESM+CJS, ships TS types, last released 2026-05-05 (active), ~14k weekly / ~63k monthly downloads. |
| `@stoprocent/bleno` | 0.12.5 | BLE peripheral (advertising as FTMS device) | **v2 only.** MIT-licensed maintained fork of `@abandonware/bleno`. Native macOS bindings fixed. Promise/async API. TypeScript types built in. ~57k weekly downloads (vs `@abandonware/bleno`'s ~740 — community has migrated). Released within the last week (2026-05-07). |
| `@stoprocent/noble` | 2.5.3 | Reference only — VeloWorld likely uses this on the consumer side | Not a dependency of trainer-sim. Listed because the same author maintains both halves of the BLE stack and they share an HCI layer; useful if you want to test trainer-sim ↔ a real central later. |

### Development Tools

| Tool | Purpose | Notes |
|---|---|---|
| `tsup` | Build dual ESM/CJS + `.d.ts`/`.d.cts` | Configure two entry points for v2: `src/index.ts` (FakeTransport + codec, no native deps) and `src/bleno.ts` (BlenoTransport, imports `@stoprocent/bleno`). Mark `@stoprocent/bleno` as `external` so consumers who only import `trainer-sim` (not `trainer-sim/bleno`) never hit native compilation. |
| `vitest` | Unit + integration tests | `setupFiles` to seed deterministic clock; use `vi.useFakeTimers()` for replay timing tests so they don't take real-time. |
| `tsx` | Run example scripts and the future CLI in dev | `npm run play -- some.fit` style scripts. |
| ESLint 9 (flat) + `@antfu/eslint-config` (or Biome 2.x) | Lint + format | Either works. `fit-file-parser` itself uses `@antfu/eslint-config`; pick Biome only if you want a single tool with no plugin ecosystem. |
| `publint` | Validate `package.json` `exports` map | Catches the "subpath export forgot CJS" class of bug that breaks consumers; non-negotiable for a dual-published lib. |
| `@arethetypeswrong/cli` (`attw`) | Validate types resolve correctly in both ESM and CJS | Ditto; run in CI before publish. |
| GitHub Actions (or equivalent) | CI on macOS + Linux, Node 24 (matches VeloWorld) | Don't run BLE tests in CI — peripherals can't be exercised without a real adapter. v2 can add a manual macOS runner with a USB BTLE dongle if needed. |
| `changesets` | Release management | Optional but standard for 2026 TS libraries; lets v2 land BLE without breaking v1 consumers. |

## Installation

```bash
# Production deps (v1)
npm install fit-file-parser

# Production deps (v2 — added when BlenoTransport ships)
npm install @stoprocent/bleno          # mark as optionalDependencies in package.json

# Dev deps (full)
npm install -D typescript@5 tsup@8 vitest@4 tsx@4 \
  @types/node@24 \
  publint @arethetypeswrong/cli \
  eslint@9 @antfu/eslint-config
```

`package.json` shape (v1):

```json
{
  "type": "module",
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
  "engines": { "node": ">=24.0" },
  "files": ["dist"]
}
```

For v2, add a `"./bleno"` subpath export and put `@stoprocent/bleno` in `optionalDependencies` so `import 'trainer-sim'` (FakeTransport only) never triggers a native build.

---

## The Deferred Decision: FIT Parser Comparison

PROJECT.md explicitly defers this to research. Here is the concrete comparison.

| Criterion | `fit-file-parser` 3.0.0 | `@garmin/fitsdk` 21.202.0 |
|---|---|---|
| **License** | **MIT** | Garmin FIT Protocol License (custom — non-transferable, non-sublicensable, royalty-free, with field-of-use restrictions) |
| Maintainer | Community (jimmykane, Dimitrios Kanellopoulos) | Garmin International (official) |
| Last release | 3.0.0 on **2026-05-05** | 21.202.0 on **2026-04-28** |
| Release cadence | Steady community pace; ~16 releases in 2025–2026 | Tracks the FIT profile; ~10 releases in 2025–2026 (sync'd to profile updates) |
| Weekly downloads | ~14,600 | ~8,600 |
| Monthly downloads | ~63,200 | ~32,400 |
| Module format | ESM **and** CJS (dual exports as of 3.0) | ESM only (`"type": "module"`) |
| TypeScript types | **Yes** — autogenerated from FIT profile, shipped as `.d.ts` | **No first-party types** — JS-only SDK |
| API style | `new FitParser({ ... }).parseAsync(buffer)` → POJO with all messages | `new Decoder(stream).read({ ... })` → `{ messages, errors }`, with rich options (sub-field expansion, scale/offset, type-name conversion, listeners) |
| Profile completeness | Good for power/cadence/HR/speed/timestamp on common Garmin/Wahoo files; community-maintained, occasional gaps on niche message types | **Authoritative** — Garmin defines the spec; SDK is generated from the same source |
| Integrity validation | Best-effort | Full CRC + header validation built in (`isFIT()`, `checkIntegrity()`) |
| Bundle size (parser only) | Smaller; depends on `buffer@^6` polyfill | Larger (~1 MB unpacked); includes generated profile tables |
| Repo signal | 116 stars, last push 2026-05-05, 12 open issues | 74 stars, last push 2026-04-28, 0 open issues |

### Recommendation: Start with `fit-file-parser`

**Why:**

1. **License compatibility is the dominant factor.** PROJECT.md's constraints say "MIT-licensed dependencies." Garmin's FIT SDK ships under a custom Garmin license, not an OSI-approved one. The license is permissive in practice (royalty-free) and is what you'd accept for a personal project, but for an open-source MIT-licensed dev tool intended to be redistributed (and embedded in any FTMS-based cycling app, including potentially commercial ones), `fit-file-parser`'s plain MIT is materially cleaner. **Confidence: HIGH** that this is the deciding factor; **MEDIUM** confidence that the Garmin license would actually cause practical problems — read it yourself before publishing.
2. **TypeScript types out of the box.** `@garmin/fitsdk` would force you to either write a `@types/garmin__fitsdk` shim or call into JS untyped. For a TS-first library that VeloWorld imports, that's friction.
3. **Dual ESM+CJS** matches VeloWorld's "Electron-ish" reality — main process tends toward CJS, renderer toward ESM. `@garmin/fitsdk` is ESM-only.
4. **Power/cadence/timestamp coverage is fine.** v1 only needs `record` messages with `power`, `cadence`, and `timestamp` (PROJECT.md scope). `fit-file-parser` handles these on real Garmin/Wahoo exports without issues.

### When to switch to `@garmin/fitsdk`

- You hit a real Wahoo/Garmin FIT file that `fit-file-parser` mis-decodes (bad scale, missing field, unknown message). The Garmin SDK is the authoritative reference.
- You need fields beyond v1 scope (developer-defined fields, memo globs, sub-field expansion, gear change components) — Garmin's SDK has richer options.
- The license review concludes the Garmin license is acceptable for your distribution model.

### Mitigation: keep the parser behind an interface

Whatever you pick, **isolate it behind a `FitRecordSource` interface** that yields `{ timestampMs, powerW, cadenceRpm }` tuples. This makes parser swapping a one-file change and lets v2 add a `@garmin/fitsdk`-backed source side-by-side without touching the replay engine. This is small and worth doing in v1.

### Alternatives explicitly ruled out

| Package | Why ruled out |
|---|---|
| `js-fit-sdk` | Last release 2021-01; abandoned; v0.0.1 |
| `easy-fit` | Old wrapper around an even older parser; not maintained |
| `fit-decoder` | Browser-focused, no clear maintenance signal, much lower download share |

---

## The (Non-)Decision: FTMS IndoorBikeData Encoder

**There is no usable npm package for encoding FTMS IndoorBikeData (UUID 0x2AD2) payloads.** Searching npm for "ftms", "fitness machine service", "indoor bike data" turns up:

- `ble-ftms` — **client/decoder**, not encoder; ISC; last release 2022; abandoned
- `incyclist-devices` — heavyweight cycling-app device library; consumer-side (Zwift-style), not peripheral-side
- `@thefloodteam/ftms-components` — unrelated React UI components (name collision)
- `@peripherals/ble-core` — React Native, advertised types, not a Node FTMS encoder

**Conclusion: hand-roll the encoder.** This is what every Node FTMS peripheral project (Gymnasticon, FortiusANT, various smart-trainer hacks) does, and it's exactly the right call for trainer-sim because:

1. The IndoorBikeData layout is a stable, public Bluetooth SIG spec — a hand-rolled encoder is a few dozen lines of `Buffer.allocUnsafe` + `writeUInt16LE`/`writeInt16LE` writes preceded by a flags `uint16le` header.
2. PROJECT.md scope is **power + cadence only** for v1, so the encoder is genuinely tiny: flags = `(cadence_present | power_present)`, then `instantaneousSpeed:uint16` (always present, can be 0), `instantaneousCadence:uint16` (1/2 RPM resolution), `instantaneousPower:int16` (1 W resolution). Total payload for v1 ≤ 8 bytes.
3. Vendoring matches PROJECT.md's "vendor the FTMS encoder inside trainer-sim for v1" decision and avoids any npm-package-license question.

The codec lives at `src/ftms/indoorBikeData.ts`. Tests assert byte-for-byte equality against pre-computed buffers. Pull the spec from the Bluetooth SIG GATT Specification Supplement (`GATT Specification Supplement, "Indoor Bike Data"` section) — that's the source of truth, not a blog post.

---

## The BLE Decision: `@stoprocent/bleno`, not `@abandonware/bleno`

PROJECT.md names `@abandonware/bleno`. **Switch the recommendation to `@stoprocent/bleno` for v2.** Evidence:

| Signal | `@abandonware/bleno` | `@stoprocent/bleno` |
|---|---|---|
| Latest release | 0.6.2, **2025-02-05** (no 2026 releases) | 0.12.5, **2026-05-07** (released this week) |
| Weekly downloads | ~740 | **~57,000** (~80x) |
| TypeScript types | Yes (basic `index.d.ts`) | Yes (full, modern, with async API) |
| macOS native bindings | Original — known stability issues on Apple Silicon | **Explicitly fixed** by this fork |
| Promise/async API | No (event-emitter only) | Yes (`waitForPoweredOnAsync`, `startAdvertisingAsync`, etc.) |
| Multi-connection support | No | Yes |
| Repo activity | `pushed: 2025-02-05` | `pushed: 2026-05-08` |
| License | MIT | MIT |
| Platforms | darwin, linux (+ partial others) | darwin, linux (+ partial others) |
| Native deps | `@abandonware/bluetooth-hci-socket` | `@stoprocent/bluetooth-hci-socket` (newer, maintained alongside) |

The community has effectively migrated. `@abandonware/bleno` was itself a fork of the original abandoned `bleno`; `@stoprocent/bleno` is the next generation. **Confidence: HIGH** based on download counts, release recency, and explicit macOS fix that PROJECT.md cares about.

### Update PROJECT.md

The "Constraints" section says BLE will use `@abandonware/bleno`. That should be updated to `@stoprocent/bleno` at the next phase transition. Same platform support (darwin/linux), same license (MIT), better API.

---

## Stack Patterns by Variant

**Default — VeloWorld on Node 24 (current):**
- Engines pinned to `>=24.0`. Use the broader `node:test` features. CI is single-version (Node 24); widen to a 22+24 matrix only if a future consumer demands Node 22 parity.

**If a future consumer needs Node 22 parity:**
- Lower engines to `>=22.12` and add a Node 22 leg to the GitHub Actions matrix. Would require avoiding any Node-24-only API in the codebase (`util.parseArgs` extensions, newer `node:test` mocks). Not a v1 concern.

**If VeloWorld is pure ESM:**
- Drop the CJS half of the dual publish. Saves a tiny amount of build time. Don't do this just for v1 — there's no cost to dual-publishing and it future-proofs against any consumer that wants CJS.

**If you decide to skip `tsup`:**
- Use `tsc` for ESM build + a second `tsc --module commonjs` for CJS, plus a tiny script to write `dist/cjs/package.json` `{"type":"commonjs"}`. This is what `fit-file-parser` does. It works but is more boilerplate; only choose this if you want zero non-Node tooling in the build.

**If v2 needs Windows BLE:**
- Out of scope per PROJECT.md ("Windows BLE peripheral — historically unreliable; not a v1 target"). `@stoprocent/bleno` lists win32 in `os` but the HCI socket layer is not first-class. Don't build for it.

---

## Version Compatibility

| Package A | Compatible With | Notes |
|---|---|---|
| `@stoprocent/bleno@0.12` | Node `>=14`, declares darwin/linux/android/freebsd/win32 | Use Node 24 LTS for VeloWorld parity. macOS 10.9+, Linux kernel 3.6+. Requires `libbluetooth-dev` on Linux and `bluetoothd` stopped/disabled. |
| `fit-file-parser@3` | Node `>=20` | Engines line says `node >= 20.0.x`. v3 is the first release with proper dual ESM+CJS exports — don't pin to `^2.x` (CJS-only). |
| `tsup@8.5` | Node `>=18` | Fine on 22/24. Uses esbuild internally. |
| `vitest@4.1` | Node `>=18` | Avoid 5.0 betas. v4 is stable. |
| `typescript@5.9` | Node `>=18` | `moduleResolution: "bundler"` is the simplest config for a `tsup`-built lib. |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|---|---|---|
| `@abandonware/bleno` | Last release Feb 2025, ~740 weekly downloads, no async API, no macOS Apple Silicon fix | `@stoprocent/bleno` |
| Original `bleno` (Sandeep Mistry) | Last release 2018; predates Node 16+; broken on modern macOS | `@stoprocent/bleno` |
| `@garmin/fitsdk-javascript` | **Doesn't exist on npm** under that name (PROJECT.md has the package name slightly wrong) | `@garmin/fitsdk` if you choose Garmin's SDK; otherwise `fit-file-parser` |
| `js-fit-sdk` | v0.0.1 since 2021, abandoned | `fit-file-parser` |
| `ts-node` | Slower startup, dual-CJS-ESM headaches | `tsx` for dev runs; native `node --experimental-strip-types` is available on the Node 24 floor (still gated behind a flag, so `tsx` remains the safer default) |
| `jest` | Slower; ESM/TS story still painful in 2026; not what the FIT libraries you depend on use | `vitest` |
| `webpack`/`rollup` for a lib build | Heavy, configuration-heavy, slow | `tsup` (esbuild under the hood) |
| `node-ble` (chrvadala) | **Central-only** (it consumes peripherals via BlueZ DBus); cannot advertise as a peripheral | `@stoprocent/bleno` for peripheral; `@stoprocent/noble` for central |
| Bundling FIT fixture files into the library | PROJECT.md explicit out-of-scope ("Bundled fixture FIT files — consumers bring their own") | Generate minimal FIT for tests; let consumers point at their own files |
| Sharing the FTMS codec via a separate npm package | PROJECT.md explicit out-of-scope for v1 ("start with vendored copy") | Vendor `src/ftms/` in this repo |
| Synthetic CSV ride data | PROJECT.md explicit out-of-scope ("Real Garmin/Wahoo FIT files only") | Real FIT files only |

---

## Sources

- npm registry — `fit-file-parser` 3.0.0 (modified 2026-05-05), `@garmin/fitsdk` 21.202.0 (modified 2026-04-28), `@abandonware/bleno` 0.6.2 (modified 2025-02-05), `@stoprocent/bleno` 0.12.5 (modified 2026-05-07), `node-ble` 1.13.0, `bleno` 0.5.0 (legacy). HIGH confidence.
- npm downloads API (`api.npmjs.org/downloads/point/last-week`) — confirmed download share Apr–May 2026. HIGH confidence.
- GitHub API — repo health for `garmin/fit-javascript-sdk`, `jimmykane/fit-parser`, `stoprocent/bleno`, `abandonware/bleno`. HIGH confidence.
- `https://nodejs.org/dist/index.json` — current LTS lineup (22 Jod, 24 Krypton). HIGH confidence.
- `https://github.com/garmin/fit-javascript-sdk` README + LICENSE.txt — confirmed ESM-only, no TS types, custom Garmin FIT Protocol License. HIGH confidence.
- `https://github.com/jimmykane/fit-parser` README + `package.json` (raw) — confirmed v3 dual ESM+CJS, MIT, ships generated `.d.ts`, `engines: node >= 20.0.x`. HIGH confidence.
- `https://github.com/stoprocent/bleno` README — confirmed Promise/async API, TS types, multi-connection, macOS native bindings fix. HIGH confidence.
- npm search for `ftms`, `indoor bike data`, `fitness machine service` — no encoder package exists; only consumer-side libs and unrelated name collisions. HIGH confidence in the negative finding.
- Bluetooth SIG GATT Specification Supplement (FTMS 1.0) — referenced for IndoorBikeData byte layout. HIGH confidence in spec stability; LOW confidence that you should rely on a blog post — read the SIG spec directly when implementing the encoder.

---

*Stack research for: Node.js BLE FTMS smart trainer simulator (FIT replay)*
*Researched: 2026-05-13*
