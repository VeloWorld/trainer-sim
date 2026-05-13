---
phase: 01-vendored-ftms-codec
plan: 01
subsystem: infra
tags: [typescript, tsup, vitest, dual-publish, skeleton, publint, attw, node24]

# Dependency graph
requires: []  # First code commit in repo
provides:
  - Working dual-publish TypeScript library skeleton (Node 24, ESM + CJS, .d.ts + .d.cts)
  - tsup 8.5 build pipeline with dts emission (entry: src/index.ts)
  - vitest 4.1 test runner wired to test/**/*.test.ts (no test files yet — plan 02 lands first)
  - tsconfig.test.json project-mode tsconfig for `npm run typecheck:test` (used by plans 02 and 04)
  - publint + @arethetypeswrong/cli installed and runnable via `npm run validate:{publint,attw}` (full validation deferred to plan 04 once src/index.ts has real exports)
  - Phase-wide convention: cross-module relative imports use `.js` extension on the specifier
affects: [01-02, 01-03, 01-04, 01-05, 02-loader, 03-replay, 04-transport, 05-veloworld-integration]

# Tech tracking
tech-stack:
  added:
    - typescript@5.9.3
    - tsup@8.5.1
    - vitest@4.1.6
    - tsx@4.21.0
    - "@types/node@24.12.4"
    - publint@0.3.21
    - "@arethetypeswrong/cli@0.18.2"
  patterns:
    - Dual ESM/CJS publish via package.json exports map with types-condition-first ordering
    - tsup-as-builder (no raw tsc, no rollup, no webpack) — D-11
    - tsconfig project-mode split (tsconfig.json for build, tsconfig.test.json extending it for type-checking tests)
    - moduleResolution=bundler (vs node16) for tsup-built libraries
    - .js-extension convention on cross-module relative imports (Node ESM standard, tsup-stripped)

key-files:
  created:
    - package.json
    - package-lock.json
    - .gitignore
    - tsconfig.json
    - tsconfig.test.json
    - tsup.config.ts
    - vitest.config.ts
    - src/index.ts
  modified:
    - README.md  # extended with project description and Phase 1 status link to ROADMAP

key-decisions:
  - "Pinned dev deps via tilde ranges per RESEARCH.md — exact versions installed match pins (no drift)"
  - "tsup target=node24 matches package.json engines (>=24.0) per D-16"
  - "src/index.ts uses `export {}` to remain a valid TS+ESM module while still empty per D-11 (encoder lands in plan 01-03)"
  - "tsconfig.test.json adds rootDir=., noEmit=true, types=[node], include=src/**/* + test/**/* — extends base tsconfig.json to inherit every strict flag"
  - "v2 BlenoTransport multi-entry tsup shape captured as commented-out reference in tsup.config.ts to prevent future restructuring"

patterns-established:
  - "Source-map keys order in package.json exports: types → import → require (types FIRST per attw FalseCJS gotcha; D-12)"
  - "Dual-publish hygiene baked into the validate script: build → publint → attw, with prepublishOnly = validate && test"
  - "Phase 1 ships zero native deps and zero bleno references (D-14 — bleno is v2-only)"
  - "ESLint deferred to Phase 4 (D-15) — Phase 1 has no lint config and no @antfu/eslint-config dep"

requirements-completed: [API-07]  # Pulled forward from Phase 4 per D-12: dual-publish hygiene (publint + attw) bootstrapped here, fully verified in plan 04

# Metrics
duration: 4min
completed: 2026-05-13
---

# Phase 01 Plan 01: TypeScript Library Skeleton Bootstrap Summary

**Dual-publish (ESM + CJS) TypeScript 5.9 skeleton with Node 24 engines, tsup 8.5 build pipeline, vitest 4.1, and publint+attw validation — ready for plan 02 to land the FTMS encoder fixtures.**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-05-13T17:39:49Z
- **Completed:** 2026-05-13T17:44:00Z (approx)
- **Tasks:** 2
- **Files created:** 8 (`package.json`, `package-lock.json`, `.gitignore`, `tsconfig.json`, `tsconfig.test.json`, `tsup.config.ts`, `vitest.config.ts`, `src/index.ts`)
- **Files modified:** 1 (`README.md`)

## Accomplishments

- `package.json` declares Node 24 engines, MIT license, dual-publish exports map with types-condition-first ordering, and pinned dev deps via tilde ranges.
- `npm install` succeeded — all seven dev deps install at the exact pinned versions from RESEARCH.md (no drift).
- `npm run build` produces `dist/index.{js,cjs}` and `dist/index.d.{ts,cts}` cleanly via tsup with treeshake + clean.
- `npm run typecheck:test` exits 0 (vacuous pass; the test tsconfig is wired and ready for plans 02/04 to use).
- `tsconfig.test.json` extends the base config and widens `include` to `test/**/*` — proven working before any test files exist, satisfying plan 02's prerequisite.
- `src/index.ts` is a valid TypeScript+ESM module (`export {}`) ready for plan 01-03 to populate with `encodeIndoorBikeData` and `IndoorBikeRecord` re-exports.
- `.js`-extension convention for cross-module relative imports is documented in plan 01-01's `must_haves` and applies to plans 02–05 (no relative imports yet — first cross-module import lands in plan 02 when the test fixture decoder imports from src or the encoder lands in plan 03).

## Task Commits

Each task was committed atomically:

1. **Task 1: Initialize package.json with dual-publish exports map and Node 24 engines** — `5286a05` (chore)
2. **Task 2: Author tsconfig.json, tsconfig.test.json, tsup.config.ts, vitest.config.ts, and src/index.ts stub** — `4895301` (chore)

## Final Dependency Versions Installed

All exactly match RESEARCH.md pins — **no drift**:

| Package | Pinned (RESEARCH.md) | Installed |
|---------|----------------------|-----------|
| typescript | ~5.9.3 | 5.9.3 |
| tsup | ~8.5.1 | 8.5.1 |
| vitest | ~4.1.6 | 4.1.6 |
| tsx | ~4.21.0 | 4.21.0 |
| @types/node | ~24.12.4 | 24.12.4 |
| publint | ~0.3.21 | 0.3.21 |
| @arethetypeswrong/cli | ~0.18.2 | 0.18.2 |

Total install: 145 packages added, 0 vulnerabilities reported by `npm audit`.

## Build & Type-Check Status

| Command | Result |
|---------|--------|
| `npm install` | OK — 145 packages, 0 vulnerabilities |
| `npm run build` | OK — emits `dist/index.{js,cjs}` + `dist/index.d.{ts,cts}` (CJS 84B, ESM 68B, tsup reports "empty chunk" because src/index.ts is intentionally `export {}` per D-11) |
| `npm run typecheck:test` | OK — exits 0, vacuous pass (no test files yet); proves tsconfig.test.json wiring for plans 02/04 |
| `npm run validate:publint` | NOT RUN — full validation deferred to plan 04 once src/index.ts has real exports (per the plan's "publint/attw full validation runs in plan 04" note) |
| `npm run validate:attw` | NOT RUN — same deferral |

## Files Created/Modified

- `package.json` — package metadata; engines >=24.0 (D-16); MIT license; dual-publish exports map with types-first ordering; scripts `build`, `test`, `test:watch`, `typecheck:test`, `validate:publint`, `validate:attw`, `validate`, `prepublishOnly`; pinned tilde-range dev deps.
- `package-lock.json` — generated by `npm install`; commits the resolved dep tree.
- `.gitignore` — `node_modules`, `dist`, `coverage`, `.DS_Store`, `*.log`, `.env*`.
- `tsconfig.json` — TS 5.9 strict, target/lib ES2023, module ESNext, moduleResolution=bundler, declaration+sourcemap on, rootDir=./src, types=[node], excludes test/.
- `tsconfig.test.json` — extends ./tsconfig.json, rootDir=., noEmit=true, types=[node], include=src/**/* + test/**/* — used by plans 02 and 04 for `tsc --noEmit -p tsconfig.test.json`.
- `tsup.config.ts` — single entry src/index.ts, format ['esm','cjs'], dts true, sourcemap, treeshake, clean, target=node24, outDir=dist; v2 multi-entry shape captured as commented-out reference.
- `vitest.config.ts` — node env, globals=false, include=test/**/*.test.ts, v8 coverage with fixtures/dist excluded.
- `src/index.ts` — `export {}` stub with comment explaining plan 01-03 will populate it.
- `README.md` — extended with one-paragraph project description (from CLAUDE.md core value), explicit "Status: Phase 1 in progress" line, and link to .planning/ROADMAP.md (preserving the existing two-modes section).

## Decisions Made

- **Pinned versions match RESEARCH.md exactly.** Tilde ranges resolve to the exact `[VERIFIED]` versions in RESEARCH.md §Standard Stack. No drift to report.
- **README extended, not overwritten.** The existing README already had the project name, two-modes section, and a status line — extended it with the explicit `trainer-sim` package name (acceptance criterion `grep -i trainer-sim`), a one-paragraph description from CLAUDE.md, and an explicit ROADMAP.md link. The two-modes section was preserved as-is.
- **Followed RESEARCH.md `tsconfig.test.json` shape verbatim.** Three-line compilerOptions override (`rootDir`, `noEmit`, `types`) over the base config; `include` widens to `test/**/*`. This proved out before any test files exist (vacuous pass) — exactly what plan 01-02 expects.
- **`src/index.ts` uses `export {}`.** A bare `export {}` keeps the file a valid TS+ESM module without exporting anything; tsup builds it cleanly (reports "Generated an empty chunk" — informational, not an error). Plan 01-03 will replace this with real re-exports.
- **No `@antfu/eslint-config` or other ESLint deps installed.** D-15 defers ESLint setup to Phase 4. CLAUDE.md TL;DR table mentions ESLint at MEDIUM confidence, but the locked phase decision overrides that.

## Deviations from Plan

None — plan executed exactly as written.

The acceptance criteria, the `<verify>` commands, and all `<verification>` items pass without modification. No deviation rules (1–4) triggered. No auth gates encountered. The `dist/` files are git-ignored and not committed (per the plan's `.gitignore` requirement).

## Issues Encountered

None.

## Threat Flags

None — Phase 1 introduces no new network endpoints, auth paths, file access patterns, or schema changes beyond the trust boundaries already enumerated in the plan's `<threat_model>` (T-01-01 through T-01-05). All five mitigations from that table are implemented:

- **T-01-01 (Tampering — devDependencies):** mitigated via tilde-range pins in `package.json` + committed `package-lock.json`.
- **T-01-02 (Information Disclosure — files array):** mitigated via explicit `"files": ["dist", "README.md", "LICENSE.md"]`.
- **T-01-03 (Information Disclosure — source maps):** accepted; tsup emits relative paths only.
- **T-01-04 (DoS — npm install):** accepted; all seven dev deps are well-known TS-library tooling.
- **T-01-05 (Spoofing — repository URL):** placeholder `git+https://github.com/agni21/trainer-sim.git` per RESEARCH.md template; will be corrected at first publish.

## Known Stubs

- **`src/index.ts`** is a deliberate stub (`export {}`) per CONTEXT.md D-11. Plan 01-03 ("encoder implementation") populates it with `encodeIndoorBikeData` and `IndoorBikeRecord` re-exports. Documented here for completeness; this is not an undocumented stub.

## Self-Check: PASSED

All claims verified against the actual repo state:

| Claim | Verification | Result |
|-------|--------------|--------|
| `package.json` exists | `test -f package.json` | FOUND |
| `package-lock.json` exists | `test -f package-lock.json` | FOUND |
| `.gitignore` exists | `test -f .gitignore` | FOUND |
| `tsconfig.json` exists | `test -f tsconfig.json` | FOUND |
| `tsconfig.test.json` exists | `test -f tsconfig.test.json` | FOUND |
| `tsup.config.ts` exists | `test -f tsup.config.ts` | FOUND |
| `vitest.config.ts` exists | `test -f vitest.config.ts` | FOUND |
| `src/index.ts` exists | `test -f src/index.ts` | FOUND |
| `dist/index.js` builds | `npm run build && test -f dist/index.js` | FOUND |
| `dist/index.cjs` builds | `test -f dist/index.cjs` | FOUND |
| `dist/index.d.ts` builds | `test -f dist/index.d.ts` | FOUND |
| `dist/index.d.cts` builds | `test -f dist/index.d.cts` | FOUND |
| Task 1 commit `5286a05` | `git log --oneline --all \| grep 5286a05` | FOUND |
| Task 2 commit `4895301` | `git log --oneline --all \| grep 4895301` | FOUND |

## User Setup Required

None — no external services involved.

## Next Phase Readiness

- Plan 01-02 (decoder fixture) can land directly on this skeleton — `tsconfig.test.json` is wired, `vitest.config.ts` includes `test/**/*.test.ts`, and `npm run typecheck:test` already exits cleanly on an empty test set.
- Plan 01-03 (encoder implementation) replaces `src/index.ts`'s `export {}` with real re-exports; tsup will emit non-empty `dist/index.{js,cjs}` once that lands.
- Plan 01-04 (round-trip + byte-correctness tests + first real `npm run validate` against populated dist).
- Plan 01-05 (CI workflow + nRF Connect verification — depends on plans 02–04 producing a green test suite).

No blockers. publint/attw deferred to plan 04 as planned. The phase-wide `.js`-extension convention is documented and ready for the first cross-module import to land in plan 02.

---
*Phase: 01-vendored-ftms-codec*
*Completed: 2026-05-13*
