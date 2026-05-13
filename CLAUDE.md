<!-- GSD:project-start source:PROJECT.md -->
## Project

**trainer-sim**

A standalone Node.js library and (later) CLI that impersonates a BLE FTMS smart trainer
by replaying pre-recorded FIT files. It ships two transports from one codebase:
`FakeTransport` for in-process, hardware-free testing, and `BlenoTransport` for real BLE
peripheral advertising. It exists for developers building cycling apps (VeloWorld first,
then any FTMS-based app) who need to develop and test without a physical trainer.

**Core Value:** A cycling app developer can run their app end-to-end against a realistic trainer signal —
no hardware, no BLE, no flaky integration loop — by importing one library and pointing it
at a real Garmin/Wahoo FIT file.

### Constraints

- **Tech stack**: Node.js + TypeScript — VeloWorld's existing stack; FakeTransport must
  import cleanly into VeloWorld's test runner
- **License**: MIT — open-source developer tool
- **Platform**: macOS / Linux only for v1 (FakeTransport is platform-agnostic, but the v2
  BlenoTransport will be macOS/Linux because `@abandonware/bleno` only supports those)
- **Compatibility**: FakeTransport's surface must satisfy VeloWorld's `ITrainerTransport`
  interface byte-for-byte; emitted payloads must match real FTMS IndoorBikeData encoding
- **Data format**: Real Garmin/Wahoo FIT files only — no synthetic CSV, no hand-crafted JSON
- **Repo layout**: Standalone repo, not a monorepo package — independently usable and publishable
<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->
## Technology Stack

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
## Recommended Stack
### Core Technologies
| Technology | Version | Purpose | Why Recommended |
|---|---|---|---|
| Node.js | 24.x LTS ("Krypton"), `engines: ">=24.0"` | Runtime | Active LTS (entered late 2025), supports VeloWorld parity (VeloWorld is on Node 24). Ships native `--test`, native `fetch`, stable `node:test`, ESM stable, broader `--experimental-strip-types` coverage for `.ts`. Avoid 20 (LTS ends April 2026, already past for this project); 22 ("Jod") is fine but VeloWorld parity drives the pick. |
| TypeScript | 5.9.x | Type system, types-first library API | VeloWorld's stack; `@stoprocent/bleno` ships `.d.ts`; `fit-file-parser` 3.0 ships generated `.d.ts`; modern `moduleResolution: "bundler"` or `"node16"` makes dual-publish trivial. |
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
# Production deps (v1)
# Production deps (v2 — added when BlenoTransport ships)
# Dev deps (full)
## The Deferred Decision: FIT Parser Comparison
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
### When to switch to `@garmin/fitsdk`
- You hit a real Wahoo/Garmin FIT file that `fit-file-parser` mis-decodes (bad scale, missing field, unknown message). The Garmin SDK is the authoritative reference.
- You need fields beyond v1 scope (developer-defined fields, memo globs, sub-field expansion, gear change components) — Garmin's SDK has richer options.
- The license review concludes the Garmin license is acceptable for your distribution model.
### Mitigation: keep the parser behind an interface
### Alternatives explicitly ruled out
| Package | Why ruled out |
|---|---|
| `js-fit-sdk` | Last release 2021-01; abandoned; v0.0.1 |
| `easy-fit` | Old wrapper around an even older parser; not maintained |
| `fit-decoder` | Browser-focused, no clear maintenance signal, much lower download share |
## The (Non-)Decision: FTMS IndoorBikeData Encoder
- `ble-ftms` — **client/decoder**, not encoder; ISC; last release 2022; abandoned
- `incyclist-devices` — heavyweight cycling-app device library; consumer-side (Zwift-style), not peripheral-side
- `@thefloodteam/ftms-components` — unrelated React UI components (name collision)
- `@peripherals/ble-core` — React Native, advertised types, not a Node FTMS encoder
## The BLE Decision: `@stoprocent/bleno`, not `@abandonware/bleno`
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
### Update PROJECT.md
## Stack Patterns by Variant
- Bump engines to `>=24` and use the broader `node:test` features. No other changes.
- Drop the CJS half of the dual publish. Saves a tiny amount of build time. Don't do this just for v1 — there's no cost to dual-publishing and it future-proofs against any consumer that wants CJS.
- Use `tsc` for ESM build + a second `tsc --module commonjs` for CJS, plus a tiny script to write `dist/cjs/package.json` `{"type":"commonjs"}`. This is what `fit-file-parser` does. It works but is more boilerplate; only choose this if you want zero non-Node tooling in the build.
- Out of scope per PROJECT.md ("Windows BLE peripheral — historically unreliable; not a v1 target"). `@stoprocent/bleno` lists win32 in `os` but the HCI socket layer is not first-class. Don't build for it.
## Version Compatibility
| Package A | Compatible With | Notes |
|---|---|---|
| `@stoprocent/bleno@0.12` | Node `>=14`, declares darwin/linux/android/freebsd/win32 | Use Node 24 LTS for VeloWorld parity. macOS 10.9+, Linux kernel 3.6+. Requires `libbluetooth-dev` on Linux and `bluetoothd` stopped/disabled. |
| `fit-file-parser@3` | Node `>=20` | Engines line says `node >= 20.0.x`. v3 is the first release with proper dual ESM+CJS exports — don't pin to `^2.x` (CJS-only). |
| `tsup@8.5` | Node `>=18` | Fine on 22/24. Uses esbuild internally. |
| `vitest@4.1` | Node `>=18` | Avoid 5.0 betas. v4 is stable. |
| `typescript@5.9` | Node `>=18` | `moduleResolution: "bundler"` is the simplest config for a `tsup`-built lib. |
## What NOT to Use
| Avoid | Why | Use Instead |
|---|---|---|
| `@abandonware/bleno` | Last release Feb 2025, ~740 weekly downloads, no async API, no macOS Apple Silicon fix | `@stoprocent/bleno` |
| Original `bleno` (Sandeep Mistry) | Last release 2018; predates Node 16+; broken on modern macOS | `@stoprocent/bleno` |
| `@garmin/fitsdk-javascript` | **Doesn't exist on npm** under that name (PROJECT.md has the package name slightly wrong) | `@garmin/fitsdk` if you choose Garmin's SDK; otherwise `fit-file-parser` |
| `js-fit-sdk` | v0.0.1 since 2021, abandoned | `fit-file-parser` |
| `ts-node` | Slower startup, dual-CJS-ESM headaches | `tsx` for dev runs; native `node --experimental-strip-types` once Node 24 is your minimum |
| `jest` | Slower; ESM/TS story still painful in 2026; not what the FIT libraries you depend on use | `vitest` |
| `webpack`/`rollup` for a lib build | Heavy, configuration-heavy, slow | `tsup` (esbuild under the hood) |
| `node-ble` (chrvadala) | **Central-only** (it consumes peripherals via BlueZ DBus); cannot advertise as a peripheral | `@stoprocent/bleno` for peripheral; `@stoprocent/noble` for central |
| Bundling FIT fixture files into the library | PROJECT.md explicit out-of-scope ("Bundled fixture FIT files — consumers bring their own") | Generate minimal FIT for tests; let consumers point at their own files |
| Sharing the FTMS codec via a separate npm package | PROJECT.md explicit out-of-scope for v1 ("start with vendored copy") | Vendor `src/ftms/` in this repo |
| Synthetic CSV ride data | PROJECT.md explicit out-of-scope ("Real Garmin/Wahoo FIT files only") | Real FIT files only |
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
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
