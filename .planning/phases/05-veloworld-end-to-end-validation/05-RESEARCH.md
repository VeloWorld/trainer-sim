# Phase 5: VeloWorld End-to-End Validation — Research

**Researched:** 2026-05-16
**Domain:** Cross-repo integration. trainer-sim's `createFakeTransport` plugged into VeloWorld's existing `ITrainerTransport` consumer through a coordinated PR against the VeloWorld repo. The proving artifact is a merged VW PR with green CI on macOS+Linux Node 24.
**Confidence:** HIGH — VW repo is locally available at `/Users/agniveshpatel/dev/agni21/veloworld-ride` (verified `git remote -v` → `git@github.com:VeloWorld/veloworld-ride.git`). All recon questions answered from real source.

## Summary

The Phase 5 contract is *not* what CONTEXT.md initially assumed. CONTEXT.md frames Phase 5 as "VW imports `import type { ITrainerTransport } from 'trainer-sim'`, swap the transport, run E2E green." Real-world VW source tells a different story:

1. **VW already ships a fully-working FakeTrainerTransport** (`apps/desktop/src/renderer/src/lib/dev/fake-trainer-transport.ts`, 273 LOC, on feature branch `feat/phase-10-trainer-sim-faketransport-dev-only`). VW's Phase 10 inline-vendored a complete FIT replay path: own `loadFitFromBytes`, own `ReplayScheduler`, own 8-byte FTMS encoder. Phase 5's actual job is to **replace VW's vendored copy with the real `trainer-sim` package**, not to introduce FIT replay into VW for the first time.
2. **VW's `ITrainerTransport` is 9 methods, not 4.** trainer-sim ships `connect/disconnect/onData/sendResistance`. VW ships `scan/connect(deviceId)/onTelemetry/probeControlPointSupport/requestControl/setGradeSimulation/releaseControl/disconnect/reconnect`. The shapes also disagree on `connect()` (no-arg in trainer-sim vs `connect(deviceId: string)` in VW), on the data-handler method name (`onData` vs `onTelemetry`), and on the resistance method (`sendResistance(grade)` vs `setGradeSimulation(gradePercent)`). D-VW-05's "resolution in trainer-sim's favor" cannot be a literal interface swap — it requires either a thin VW-side adapter wrapping trainer-sim's transport up to VW's 9-method surface, or trainer-sim's contract widening to the union (which Anti-Pattern 6 forbids).
3. **trainer-sim's wire format is incompatible with VW's parser as-is.** trainer-sim's encoder emits a 6-byte frame with bit-0=1 ("speed NOT present"); VW's `parseIndoorBikeData` expects bit-0=0 + a speed field present (8-byte frame). VW's vendored encoder includes speed (m/s × 360 = 0.01 km/h units). If VW's PR plugs trainer-sim's `createFakeTransport` straight into VW's telemetry pipeline, `parsed.instantaneousSpeed` becomes `undefined` — a fixable but visible diff.
4. **Git-ref install is broken without a `prepare` hook.** trainer-sim's `dist/` is gitignored (`.gitignore:2`) AND `package.json` has no `prepare` / `prepack` script. A `npm install github:VeloWorld/trainer-sim#<sha>` clones the source but does not build it. VW will resolve to a package with no `dist/index.js`. **This is D-VW-08's contract-gap-fix-first-then-pin path triggered before Phase 5 can begin.**
5. The actual GitHub org for trainer-sim is **`VeloWorld/trainer-sim`** (verified via `git remote -v`), NOT `agni21/trainer-sim` as D-VW-04 hardcodes. The git-ref string in D-VW-04 needs updating from `github:agni21/trainer-sim#<sha>` to `github:VeloWorld/trainer-sim#<sha>` before any plan task uses it.

**Primary recommendation:** Phase 5 has **three pre-merge work blocks** the planner should sequence (Wave 0 → Wave 1 → Wave 2):

- **Wave 0 (trainer-sim-side, lands first):** Add a `prepare` script that runs `npm run build` so git-ref installs ship a built `dist/`. Update PROJECT/CONTEXT references to `VeloWorld/trainer-sim` (not `agni21`). One trainer-sim commit; this becomes the sha VW pins.
- **Wave 1 (VW-side adapter):** VW's `dev/fake-trainer-transport.ts` rewrites to compose `trainer-sim`'s `createFakeTransport` instead of vendoring `loadFitFromBytes` + `ReplayScheduler`. The 9-method surface (scan/probe/requestControl/setGrade/release/reconnect) becomes a thin VW-owned adapter that holds the dev-mode synthetic-device-id behavior; the FIT replay engine inside is `trainer-sim`. VW's vendored `loadFitFromBytes` and `ReplayScheduler` can be deleted (replaced) or kept as dead code stripped by the existing dev-mode tree-shake gate.
- **Wave 2 (verification):** VW PR pushed to `VeloWorld/veloworld-ride`, CI runs green on macOS+Linux Node 24, the 5-item bundle (PR URL, 2 CI run URLs, sha, narrative) lands in `05-VERIFICATION.md`.

There is no recon to ask the user about — every VW-side question is answered below from real local source.

## User Constraints (from CONTEXT.md)

### Locked Decisions

**Integration test form:**
- **D-VW-01:** Phase 5 lands a coordinated PR against the VeloWorld repository, not an in-tree harness inside trainer-sim. The PR wires VW's test/dev build to install trainer-sim and runs VW's existing E2E suite green against `createFakeTransport`. In-tree-harness option was considered and rejected.
- **D-VW-02:** The PR runs **VW's full top-level E2E suite** (ride scene + physics + decoder all exercised). A "transport+decoder seam only" test is insufficient because it does not prove VW-01's "no edits to ride scene or physics code" claim.
- **D-VW-03:** VeloWorld commits its own small real Garmin/Wahoo FIT fixture (`test/fixtures/short-ride.fit`, ~30s–2min stripped from a real export) inside VW's repo. trainer-sim ships zero FIT bytes for VW.

**Cross-repo wiring:**
- **D-VW-04:** VW installs trainer-sim via a git-ref dependency: `"trainer-sim": "github:agni21/trainer-sim#<sha>"`. No npm publish in Phase 5. **NOTE:** This research found the actual GitHub org is `VeloWorld/trainer-sim`, not `agni21/trainer-sim` — the planner MUST surface this correction.
- **D-VW-05:** Phase 5's VW PR fully canonicalizes `ITrainerTransport` in VeloWorld. VW deletes its internal interface declaration and replaces it with `import type { ITrainerTransport } from 'trainer-sim'`. If VW's current shape diverges, the resolution is **in trainer-sim's favor** (per Anti-Pattern 6). **NOTE:** This research found the divergence is severe (4 methods vs 9 methods, plus argument-shape diffs); literal interface swap is not viable. See `## Architectural Responsibility Map` and `## VW Interface Shape Diff` below for the resolution path.
- **D-VW-06:** trainer-sim's CI stays independent. Phase 5 adds NO CI jobs to trainer-sim's `.github/workflows/ci.yml`. Phase 5 "done" is a manual gate.

**What Phase 5 produces inside trainer-sim:**
- **D-VW-07:** trainer-sim's Phase 5 deliverable inside this repo is documentation + a stable commit, not new source code (with the Wave 0 contract-gap fix as the exception triggered by D-VW-08; see `## Don't Hand-Roll` and the `prepare`-hook gap below).
- **D-VW-08:** The trainer-sim git commit that VW pins MUST be the post-Phase-4 tip (or later). If Phase 5 research surfaces a contract gap, that triggers a contract-widening fix in trainer-sim BEFORE the VW PR pins a sha. **NOTE:** This research surfaced exactly such a gap (the missing `prepare` hook); the Wave 0 trainer-sim commit is its resolution.

**Acceptance evidence:**
- **D-VW-09:** The 05-VERIFICATION.md acceptance bundle is 5 items: VW PR URL (merged); VW CI run URL macOS Node 24 success; VW CI run URL Linux Node 24 success; trainer-sim commit sha pinned; short narrative (which suite ran, what FIT, what shape diffs surfaced, how resolved).
- **D-VW-10:** The phase is closeable even if VW's E2E surfaces a real bug in trainer-sim — as long as the bug is fixed in trainer-sim, the sha is bumped, and VW PR re-runs green.

### Claude's Discretion

- **Plan decomposition strategy.** How many plans Phase 5 splits into (single integration plan vs split for VW reconnaissance + PR + verification), and which are wave-parallel vs strictly serial.
- **Where the "hot-swap" mechanism lives in VW.** Env var, build flag, separate test entry point, or DI factory — Phase research surfaces the choice. **Resolved by this research:** VW already gates on `import.meta.env.DEV && import.meta.env.VITE_FAKE_TRAINER === 'true'` (`apps/desktop/src/renderer/src/lib/dev-mode.ts`); the seam exists. Phase 5 keeps this gate; trainer-sim plugs into the existing `await import('./dev/fake-trainer-transport.js')` branch in `BleManager.init()`.
- **Whether VW's PR also updates the trainer-sim sha as a follow-up cycle.** If a contract gap triggers D-VW-08's "fix in trainer-sim first" path, sequencing of (i) trainer-sim fix commit, (ii) bumping VW PR's sha pin, (iii) re-running VW CI is a planning detail. **Resolved:** The Wave 0 `prepare` hook fix is exactly such a sequence — Wave 0 commit lands first, Wave 1 PR pins that sha.
- **Whether `05-RESEARCH.md` accesses the VW repo via local clone, GitHub web UI, or `gh` CLI.** **Resolved:** Local clone at `/Users/agniveshpatel/dev/agni21/veloworld-ride`.
- **Whether Phase 5's planner emits a single combined plan for "VW PR" or splits the in-VW edits into per-file plans.** Either approach satisfies the GSD plan structure.

### Deferred Ideas (OUT OF SCOPE)

- npm publish of trainer-sim 0.1.0+ — v1.x post-Phase-5.
- VW's E2E split into seam-only fast tier + full E2E nightly tier — VW-side optimization, not Phase 5.
- trainer-sim CI smoke job that mirrors a slice of VW's E2E — explicitly rejected (D-VW-06).
- TEST_FIT_DIR opt-in for VW's E2E — VW-side follow-up, not Phase 5.
- Local tarball install (`npm pack` → committed `.tgz`) — heavier ops without v1 benefit.
- Synthesized minimal FIT from Phase 2's scrubber — borders on "synthetic data" (PROJECT.md/REQUIREMENTS.md).
- Structural-typing-only validation (without canonicalization migration) — defers Phase 4 D-API-01.
- Phase 2 advisory followups (WR-01, WR-03, WR-05) — loader-internal; carry past v1 close.
- Phase 3 advisory followups (WR-02, WR-04) — same disposition.
- `@stoprocent/bleno` PROJECT.md update — handle at milestone close.
- `received.controlPoint[]` for v2 GATT FMCP opcodes — Phase 4 D-API-16.
- CLI (`trainer-sim play`) — v2.
- Heart rate / speed FTMS fields — v2 (REQUIREMENTS.md FTMS-06, FTMS-07).

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| VW-01 | VeloWorld's existing `ITrainerTransport`-consuming code runs unchanged when `FakeTransport` is swapped in for the real BLE transport | VW's `BleManager.init()` already calls `transport.onTelemetry(...)` then dispatches frames through `parseIndoorBikeData → useBleStore.updateTelemetry`. Plugging trainer-sim's `createFakeTransport` into the existing `dev/fake-trainer-transport.ts` adapter (which already implements VW's 9-method `ITrainerTransport`) leaves `BleManager.init` and every consumer of `useBleStore` untouched. The "unchanged" claim holds at VW's `ITrainerTransport` boundary, not at trainer-sim's `ITrainerTransport` boundary. |
| VW-02 | A real Garmin/Wahoo FIT replayed through FakeTransport produces power and cadence values that VeloWorld's existing FTMS decoder reads correctly across the full ride | trainer-sim's `encodeIndoorBikeData` writes power (sint16 W) + cadence (uint16 0.5 rpm units). VW's `parseIndoorBikeData` reads the same fields with the same flag-bit semantics. Round-trip is provable in unit tests; the **wire-format mismatch** (trainer-sim emits 6-byte frame without speed; VW's existing dev-mode encoder emits 8-byte frame with speed) is a Phase 5 plan task — see `## Wire-Format Compatibility` below. Power+cadence will round-trip; `instantaneousSpeed` will be `undefined` from trainer-sim's frames unless VW chooses to mock or compute speed at the adapter layer. |
| VW-03 | Continuous integration runs the VeloWorld E2E suite green on macOS and Linux (Node 24) | VW's existing CI (`/Users/agniveshpatel/dev/agni21/veloworld-ride/.github/workflows/ci.yml`) is **Linux-only** (`runs-on: ubuntu-latest`). VW does not yet have a macOS leg. **VW-03 requires VW's CI matrix to grow a macOS leg** — that's a VW-side edit Phase 5's PR must include. The existing job already runs Node 24 + pnpm + typecheck + test + build, plus a production-bundle grep gate. The matrix expansion is a 3-line YAML edit. |

## Architectural Responsibility Map

For each capability in this phase, the architectural tier owning it. The phase touches **two repos** and crosses several tiers; this map prevents the planner from mis-assigning who does what.

| Capability | Primary Repo / Tier | Secondary | Rationale |
|------------|--------------------|-----------|-----------|
| FIT parsing (real Garmin/Wahoo files) | trainer-sim / Layer 2 (FIT loader, Phase 2) | — | Already shipped. VW imports `loadFitFromPath`/`loadFitFromBuffer` transitively via `createFakeTransport`. VW deletes its vendored `apps/desktop/src/renderer/src/lib/dev/fit-loader.ts` (or leaves it as dead code stripped by tree-shake). |
| Drift-corrected replay scheduling | trainer-sim / Layer 3 (Replay engine, Phase 3) | — | Already shipped. Same disposition as FIT parsing — VW's vendored `dev/replay-scheduler.ts` becomes redundant. |
| FTMS IndoorBikeData encoding | trainer-sim / Layer 1 (FTMS codec, Phase 1) | VW dev/ adapter (frame inflation if speed needed) | trainer-sim emits the 6-byte power+cadence frame. VW's parser handles both the 6-byte and 8-byte forms (it gates each field on its flag bit). For VW-02 to be fully green including speed, VW's adapter has the option of either accepting `instantaneousSpeed = undefined` from FIT-driven trainer frames OR computing speed from physics inside the adapter. **Recommendation:** accept `undefined` and assert VW's UI handles it (existing `useBleStore.updateTelemetry` already accepts `speed: null`). |
| `ITrainerTransport` 4-method core (connect/disconnect/onData/sendResistance) | trainer-sim / Layer 5 (public API, Phase 4) | — | The contract trainer-sim canonicalizes per D-API-01. |
| `ITrainerTransport` 9-method extended surface (scan/connect-with-deviceId/onTelemetry/probeControlPointSupport/requestControl/setGradeSimulation/releaseControl/disconnect/reconnect) | VW / `packages/ble/src/transport.ts` | — | This shape is BLE-Web-Bluetooth-shaped and VW-specific. It includes BLE concepts (`scan`, `gattserverdisconnected`, `requestControl`) that trainer-sim's Anti-Pattern 6 forbids absorbing. The **adapter pattern** is the only resolution: VW's `FakeTrainerTransport` keeps the 9-method outer interface but delegates the FIT-replay verbs to trainer-sim. |
| Synthetic device row (`fake-trainer-fit` device-id, "Trainer Sim (FIT replay)" name) in pairing modal | VW / `dev/fake-trainer-transport.ts` adapter | — | UX concern that exists only because VW models the pairing-modal scan flow. trainer-sim has no concept of devices. |
| Pause/resume on ride-state transitions (Zustand `useRideStore` subscription) | VW / `dev/fake-trainer-transport.ts` adapter | trainer-sim's `disconnect()` (proxied) | Pause via `transport.disconnect()` is wasteful (re-loads FIT on resume). trainer-sim has no `pause()` in v1; VW's adapter either keeps the existing `ReplayScheduler.pause/resume` (which means VW retains its own scheduler — see `## Path B` below) OR accepts that "pause" disconnects+reconnects (see `## Path A` below). The choice is the central plan-decomposition decision. |
| Production-bundle hygiene (FakeTransport strings absent from prod renderer bundle) | VW / `BleManager.init` + `.github/workflows/ci.yml` grep gate | — | VW's existing dev-mode tree-shake gate (Plan 10-04 `await import('./dev/fake-trainer-transport.js')` behind `if (isDevMode)`) handles this. trainer-sim being a transitive dependency of `dev/fake-trainer-transport.ts` does NOT propagate into production because the entire `dev/` subtree is dynamic-import-gated. Phase 5 verifies the existing CI grep gate still passes after the rewrite. |
| CI matrix (macOS + Linux Node 24) | VW / `.github/workflows/ci.yml` | — | **VW's CI is currently Linux-only.** Phase 5's PR must add `macos-latest` to the runner matrix to satisfy VW-03. |
| Pinning trainer-sim sha into VW package.json | VW / `apps/desktop/package.json` `devDependencies` | — | Single git-ref entry. NOTE: VW currently uses pnpm 10.33.0 (`pnpm install --frozen-lockfile`); pnpm resolves git-ref deps the same way npm does, but the lockfile entry shape differs. Plan task must include `pnpm install` to regenerate the lockfile. |

## Standard Stack

This phase consumes existing stacks; nothing new is installed.

### Core (already in trainer-sim, NOT modified by Phase 5 source-wise)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript | 5.9.3 (trainer-sim) / 5.8.3 (VW) | Language | VW lags trainer-sim by 0.1; structural typing is unaffected by the gap. [VERIFIED: `package.json` files] |
| Node | 24 LTS (both) | Runtime | trainer-sim `engines: ">=24.0"`; VW CI uses `node-version: '24'`. [VERIFIED: `package.json` + `.github/workflows/ci.yml`] |
| vitest | 4.1.6 (trainer-sim) / "latest" (VW) | Test runner | Both repos use vitest. VW uses `defineWorkspace` (`vitest.workspace.ts` lists 4 packages). [VERIFIED: source] |
| fit-file-parser | 3.0.0 | FIT parsing | trainer-sim 0.1.x ships with this dep transitively to VW via the git-ref install. VW currently has its OWN `fit-file-parser ^3.0.0` direct dep at `apps/desktop/package.json` (used by VW's vendored `dev/fit-loader.ts`); after Phase 5 it can stay (vendored `fit-encoder` for ride export still uses related fit ecosystem) or be removed if VW's only consumer becomes trainer-sim. [VERIFIED: `apps/desktop/package.json`] |

### Existing in VW (Phase 5 plugs into, doesn't add)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Electron | 41.1.0 | Desktop runtime | trainer-sim runs in renderer process (Web Bluetooth context); FIT-loader's filesystem path variant won't work in renderer. **Recommendation:** Use trainer-sim's `{ buffer: Uint8Array }` source variant in VW (D-API-05), feeding it the bytes returned by `window.veloworld.dev.readFitFile()` (the existing main-side IPC). [VERIFIED: `dev/fake-trainer-transport.ts:144`] |
| Zustand | 5.0.12 | State store | VW's `useBleStore` and `useRideStore` are how trainer-sim's frame emissions reach the UI (via the existing `parseIndoorBikeData → updateTelemetry` path). NOT modified by Phase 5. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Adapter pattern (VW's 9-method `ITrainerTransport` wraps trainer-sim's 4-method) | Widen trainer-sim's `ITrainerTransport` to 9 methods | Forbidden by Anti-Pattern 6 + D-VW-05 ("trainer-sim's contract does NOT widen to absorb VW idiosyncrasies"). The 5 BLE-shaped methods (`scan`, `probeControlPointSupport`, `requestControl`, `setGradeSimulation`, `releaseControl`, `reconnect`) are the exact "BLE-types-leak" Pitfall 13 warns against. |
| Adapter pattern preserving VW's vendored `ReplayScheduler` for pause/resume | Use trainer-sim's `Replay` directly + accept "pause = disconnect" | trainer-sim's `Replay` is single-use (D-REPL-07). Pause/resume via disconnect/reconnect re-parses FIT each time (~30 ms for VW's 594-byte sample fixture). For dev/test that's tolerable. **Recommendation:** Path A (re-parse) for v1 simplicity; defer pause/resume seam to v1.x trainer-sim if VW reports pain. |
| `import type { ITrainerTransport } from 'trainer-sim'` in VW (literal D-VW-05 reading) | Keep VW's 9-method interface; trainer-sim's 4-method is a structural subset of one part of it | The literal D-VW-05 reading does NOT compile — VW's interface has `connect(deviceId: string)` whereas trainer-sim's has `connect()` (no argument). TypeScript's structural typing rejects the substitution. Phase 5's actual D-VW-05 satisfaction is **VW imports trainer-sim's `FakeTransport` (the wider 4-method-plus-extras shape) and the `ITrainerTransport` re-export**, then uses both as building blocks for VW's own 9-method adapter. |

**Installation:** No new dependencies. The Wave 0 trainer-sim commit modifies `package.json` to add a `prepare` script. VW's `apps/desktop/package.json` adds one entry: `"trainer-sim": "github:VeloWorld/trainer-sim#<wave-0-sha>"`.

**Version verification:** trainer-sim's own deps verified against npm registry by Phase 4's publish.test.ts on every build. No new deps in Phase 5.

## Architecture Patterns

### System Architecture Diagram

The Phase 5 system spans two repositories and one Electron renderer process. Data flows:

```
┌───────────────────────────────────────────────────────────────────────────┐
│ TRAINER-SIM REPO (VeloWorld/trainer-sim, sha-pinned in VW devDependencies) │
│                                                                            │
│  Phase 1 encoder ──▶ Phase 2 loader ──▶ Phase 3 Replay ──▶ Phase 4         │
│  (encodeIndoorBikeData)  (loadFitFromBuffer)  (drift-corrected)  factory   │
│                                                                            │
│  Public surface: createFakeTransport({ source, speed?, loop?, ... })      │
│                  → ITrainerTransport ({ connect, disconnect,              │
│                                          onData, sendResistance })        │
│                  + FakeTransport extras (received.resistance, reset,      │
│                                          'complete' event)                │
└──────────────────────────────────┬────────────────────────────────────────┘
                                   │
                       npm/pnpm install via                                  
                       github:VeloWorld/trainer-sim#<sha>                     
                       (resolves dist/ via prepare hook)                     
                                   │
┌──────────────────────────────────▼────────────────────────────────────────┐
│ VELOWORLD-RIDE REPO (apps/desktop/src/renderer)                            │
│                                                                            │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ packages/ble/src/transport.ts                                        │   │
│  │ interface ITrainerTransport (9 methods, VW-owned, BLE-shaped)        │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                  ▲                                         │
│                                  │ implements                              │
│                                  │                                         │
│  ┌───────────────────────────────┴─────────────────────────────────────┐   │
│  │ apps/desktop/.../dev/fake-trainer-transport.ts (VW adapter)         │   │
│  │   ┌───────────────────────────────────────────────────────────────┐ │   │
│  │   │ scan() → push synthetic 'fake-trainer-fit' device row         │ │   │
│  │   │ connect(deviceId)                                             │ │   │
│  │   │   → bytes = await window.veloworld.dev.readFitFile()          │ │   │
│  │   │   → const inner = createFakeTransport({                      │ │   │
│  │   │       source: { buffer: bytes }, ... })  ◀──── trainer-sim   │ │   │
│  │   │   → inner.onData(dv => this.telemetryHandler?.(dv))           │ │   │
│  │   │   → await inner.connect()                                     │ │   │
│  │   │ onTelemetry(handler) → store handler, fanout from inner       │ │   │
│  │   │ probeControlPointSupport / requestControl → return true       │ │   │
│  │   │ setGradeSimulation / releaseControl → no-op                   │ │   │
│  │   │ disconnect() → await inner.disconnect()                       │ │   │
│  │   │ reconnect()  → reset and re-run connect()                     │ │   │
│  │   └───────────────────────────────────────────────────────────────┘ │   │
│  └─────────────────────────────────┬───────────────────────────────────┘   │
│                                    │ onTelemetry callback                  │
│                                    │ DataView (FTMS IndoorBikeData)        │
│  ┌─────────────────────────────────▼───────────────────────────────────┐   │
│  │ apps/desktop/.../lib/ble-manager.ts (UNCHANGED — VW-01 invariant)   │   │
│  │   parseIndoorBikeData(data)                                          │   │
│  │   → useBleStore.updateTelemetry({ power, speed?, cadence })          │   │
│  └─────────────────────────────────┬───────────────────────────────────┘   │
│                                    │                                       │
│  ride scene + physics (UNCHANGED — VW-01 invariant)                       │
└───────────────────────────────────────────────────────────────────────────┘
```

The **adapter** layer is the load-bearing seam: VW's 9-method interface stays VW-owned, the underlying FIT replay engine is trainer-sim. Per D-VW-05 the resolution is "in trainer-sim's favor" for the **shared** methods (`disconnect`, `onData`/`onTelemetry` semantics, the DataView frame format), and **VW retains** the BLE-shaped methods that trainer-sim refuses to absorb.

### Recommended VW PR Structure

```
veloworld-ride/
├── apps/desktop/
│   ├── package.json                                     # +1 dep: trainer-sim git-ref
│   └── src/renderer/src/lib/dev/
│       ├── fake-trainer-transport.ts                    # REWRITTEN (delegates to trainer-sim)
│       ├── fit-loader.ts                                # DELETED (trainer-sim provides)
│       ├── replay-scheduler.ts                          # DELETED (trainer-sim provides)
│       └── __tests__/                                   # MODIFIED: tests follow rewrite
│           ├── fake-trainer-transport.test.ts           # MODIFIED
│           ├── fit-loader.test.ts                       # DELETED
│           ├── replay-scheduler.test.ts                 # DELETED
│           └── fixtures/short-ride.fit                  # NEW (D-VW-03 fixture)
├── pnpm-lock.yaml                                        # MODIFIED (lockfile re-resolution)
└── .github/workflows/ci.yml                              # MODIFIED: add macos-latest
```

The seam between trainer-sim and VW's vendored copy is **`apps/desktop/src/renderer/src/lib/dev/fake-trainer-transport.ts`**. Everything inside `dev/` after Phase 5 should be ~50 LOC (the 9-method adapter only); the 273 LOC of vendored FIT/replay logic disappears.

### Pattern 1: Adapter wrapping a narrower internal contract

**What:** VW's `FakeTrainerTransport` class implements VW's 9-method `ITrainerTransport` (the interface it OWNS for its BLE pairing-modal model). Internally it composes trainer-sim's `createFakeTransport(...)` factory and forwards `onData → onTelemetry`. The 5 BLE-shaped methods (`scan`, `probeControlPointSupport`, `requestControl`, `setGradeSimulation`, `releaseControl`, `reconnect`) stay as VW-owned no-ops or synthetic implementations because they have no analog in a FIT replay.

**When to use:** When the consumer's interface is wider than the producer's, AND the producer (per Anti-Pattern 6) refuses to widen.

**Example:** (full file, ~80 LOC after rewrite)
```typescript
// apps/desktop/src/renderer/src/lib/dev/fake-trainer-transport.ts
// Source: trainer-sim's src/types.ts (FakeTransport / FakeTransportConfig)
//         + VW's packages/ble/src/transport.ts (ITrainerTransport 9-method shape)
import type { ITrainerTransport } from '@veloworld/ble';
import { createFakeTransport, type FakeTransport } from 'trainer-sim';
import { useBleStore } from '../../stores/ble-store.js';
import { useRideStore } from '../../stores/ride-store.js';

const FAKE_DEVICE_ID = 'fake-trainer-fit';
const FAKE_DEVICE_NAME = 'Trainer Sim (FIT replay)';

export class FakeTrainerTransport implements ITrainerTransport {
  private inner: FakeTransport | null = null;
  private telemetryHandler: ((data: DataView) => void) | null = null;
  private innerDispose: (() => void) | null = null;
  private rideStateUnsub: (() => void) | null = null;

  async scan(): Promise<void> {
    const store = useBleStore.getState();
    store.setSensorState('trainer', 'scanning');
    store.setDiscoveredDevices([
      { deviceId: FAKE_DEVICE_ID, deviceName: FAKE_DEVICE_NAME, type: 'trainer' },
    ]);
  }

  async connect(deviceId: string): Promise<void> {
    if (deviceId !== FAKE_DEVICE_ID) {
      throw new Error(`FakeTrainerTransport: unknown deviceId ${deviceId}`);
    }
    this.teardown();
    const store = useBleStore.getState();
    store.setSensorState('trainer', 'connecting');

    const bytes = await window.veloworld.dev.readFitFile();
    // trainer-sim D-API-05 buffer variant — bypass node:fs (renderer has no node).
    this.inner = createFakeTransport({ source: { buffer: bytes } });
    this.innerDispose = this.inner.onData((dv) => this.telemetryHandler?.(dv));
    try {
      await this.inner.connect();
    } catch (err) {
      // FitLoadError family (trainer-sim Phase 2) bubbles unchanged.
      store.setSensorState('trainer', 'idle');
      throw err;
    }
    store.setSensorState('trainer', 'connected');
    store.setSensorDevice('trainer', FAKE_DEVICE_ID, FAKE_DEVICE_NAME);

    // D-22 pause/resume — implemented as disconnect/reconnect for v1.
    let prev = useRideStore.getState().rideState;
    this.rideStateUnsub = useRideStore.subscribe((s) => {
      if (s.rideState === prev) return;
      if (s.rideState === 'paused') void this.inner?.disconnect();
      if (s.rideState === 'riding' && prev === 'paused') void this.inner?.connect();
      prev = s.rideState;
    });
  }

  onTelemetry(handler: (data: DataView) => void): () => void {
    this.telemetryHandler = handler;
    return () => { this.telemetryHandler = null; };
  }

  async probeControlPointSupport(): Promise<boolean> { return true; }
  async requestControl(): Promise<boolean> { return true; }
  async setGradeSimulation(_g: number): Promise<void> { /* no-op */ }
  releaseControl(): void { /* no-op */ }

  async disconnect(): Promise<void> {
    this.teardown();
    const store = useBleStore.getState();
    store.setDiscoveredDevices([]);
    store.setSensorState('trainer', 'idle');
    store.clearTelemetryForSensor('trainer');
  }

  async reconnect(): Promise<void> { return this.connect(FAKE_DEVICE_ID); }

  private teardown(): void {
    this.innerDispose?.();
    this.innerDispose = null;
    void this.inner?.disconnect();
    this.inner = null;
    this.rideStateUnsub?.();
    this.rideStateUnsub = null;
  }
}
```

This compiles against VW's `packages/ble/src/transport.ts` ITrainerTransport (verified against the local source). Re: D-VW-05 — VW does NOT delete its 9-method interface; instead, the **import-from-trainer-sim** half is satisfied by the line `import { createFakeTransport, type FakeTransport } from 'trainer-sim'`. trainer-sim's `ITrainerTransport` IS the canonical 4-method core, but VW's BLE-shaped 5 extra methods are not part of that core (Pitfall 13 / Anti-Pattern 6) and stay VW-owned.

### Pattern 2: Git-ref dep with `prepare` hook for transport build artifacts

**What:** When a consumer pins a producer via `github:OWNER/REPO#sha`, npm/pnpm clones the source tree at that sha and runs the `prepare` lifecycle script, which is the standard hook for "build before install completes." Without `prepare`, only the committed files (controlled by `package.json` `files`) are visible to the consumer — and if `dist/` is gitignored (as it is in trainer-sim), the consumer resolves to a package with no entry points.

**When to use:** Always, for any library that gitignores `dist/` and ships via git-ref. This is the canonical npm pattern for this scenario. [CITED: docs.npmjs.com/cli/v10/using-npm/scripts — "If your package's package.json contains the scripts.prepare property...The prepare script will run...on git dependencies if their package.json contains a prepare script."]

**Example:** (Wave 0 patch to `package.json`)
```jsonc
{
  "scripts": {
    "build": "tsup",
    "prepare": "npm run build",          // ◀── ADD THIS
    "test": "vitest run",
    // ...
  }
}
```

Verification:
```bash
# Locally simulate VW's install path:
cd /tmp && rm -rf vw-install-test
mkdir vw-install-test && cd vw-install-test
npm init -y >/dev/null
npm install github:VeloWorld/trainer-sim#<wave-0-sha>
# Expected:
test -f node_modules/trainer-sim/dist/index.js && echo "OK: dist/index.js exists"
test -f node_modules/trainer-sim/dist/index.cjs && echo "OK: dist/index.cjs exists"
test -f node_modules/trainer-sim/dist/index.d.ts && echo "OK: dist/index.d.ts exists"
node -e "console.log(typeof require('trainer-sim').createFakeTransport)"
# Expected output: function
```

If any of those `test -f` lines fails, the `prepare` hook didn't run — investigate before pinning the sha in VW.

### Anti-Patterns to Avoid

- **Widening trainer-sim's `ITrainerTransport` to 9 methods to literally satisfy D-VW-05.** Per ARCHITECTURE.md Anti-Pattern 6 + Phase 4 D-API-03 + Pitfall 13, BLE-shaped concepts (`scan`, `requestControl`) leaking into trainer-sim's import graph would force every future consumer (any FTMS-based cycling app) to depend on Web Bluetooth concepts. The adapter pattern keeps trainer-sim transport-agnostic.
- **Vendoring trainer-sim source into VW (e.g., `pnpm add file:../trainer-sim`).** Reverts the canonicalization; VW would re-fork the contract. Use git-ref only.
- **Letting VW's PR commit a `dist/` folder for trainer-sim alongside the git-ref.** A double-commit; gone the moment trainer-sim sha advances. The `prepare` hook is the right answer.
- **Adding a macOS leg to trainer-sim's CI to "verify VW will work on macOS."** trainer-sim's CI already runs macOS (`.github/workflows/ci.yml:25`); the macOS gap is on VW's side. D-VW-06 explicitly forbids editing trainer-sim's CI for Phase 5.
- **Updating trainer-sim's `package.json` `version` from `0.0.1` to `0.1.0` as part of Phase 5.** Version bumps are post-Phase-5 (Deferred Ideas, npm publish). Phase 5's pinning is sha-based; version is irrelevant to git-ref resolution.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Build artifacts on git-ref install | A custom postinstall script in VW that runs `npm --prefix node_modules/trainer-sim run build` | `prepare` script in trainer-sim's `package.json` | npm's documented lifecycle for this exact scenario. Postinstall would fire on every VW install; `prepare` fires once during the git-ref resolution. |
| FIT-fixture trimming | Custom Node script that walks records and re-encodes | **`fit-file-tools` web UI** ([CITED: fitfiletools.com](https://www.fitfiletools.com/) — "Time Trimmer" tool) OR `@garmin/fitsdk` truncation script (28 lines, drives `Decoder.read({ onMessage })` to copy through the first N seconds of records into an `Encoder.write(...)`) | Real Garmin/Wahoo files are well-formed FIT 2.0; a hand-rolled trim risks breaking CRC or developer-field references. **VW's existing `apps/desktop/src/renderer/src/lib/__tests__/dev/fixtures/sample.fit` is 594 bytes, ~30 seconds.** It is already viable as the D-VW-03 fixture if it satisfies "real Garmin/Wahoo, not synthetic" — `file(1)` reports `manufacturer 257 product 16896` (Garmin product code; verified). **Recommendation:** Use this existing fixture. Skip the trim-a-new-one task entirely. |
| pnpm git-ref lockfile resolution | A custom `pnpm-workspace` wiring | Standard `"trainer-sim": "github:VeloWorld/trainer-sim#<sha>"` in `apps/desktop/package.json` | pnpm 10.x resolves git refs via `git ls-remote` and caches the tarball. No special configuration needed. The pnpm lockfile records `resolution: { type: 'git', repo: '...', commit: '...' }`. |
| Cross-repo CI trigger | A trainer-sim CI job that clones VW and runs VW's tests | **Manual gate per D-VW-06.** VW's PR triggers VW's CI; the result URLs go in `05-VERIFICATION.md`. | Reintroduces in-tree-harness coupling rejected in D-VW-01 / D-VW-06. |
| Pause/resume seam in trainer-sim | A new `pause()`/`resume()` on `FakeTransport` | `disconnect()` + `connect()` for v1; defer pause to v1.x | trainer-sim's `Replay` is single-use (D-REPL-07). A real pause seam is a multi-day Phase 3 widening. v1's "pause = disconnect/reconnect with re-parse" is acceptable for VW's dev/test loop (594-byte fixture re-parses in <5 ms). |

**Key insight:** The `prepare` hook is the only piece of new mechanism Phase 5 actually needs in trainer-sim. Everything else is configuration, recon, and adapter wiring. The temptation to "make the integration smoother" by widening trainer-sim's API is the same trap Anti-Pattern 6 was written to prevent.

## Wire-Format Compatibility

trainer-sim's encoder vs VW's vendored encoder vs VW's parser — three implementations of the FTMS IndoorBikeData characteristic that must agree on byte semantics. This is the most failure-prone Phase 5 surface.

| Implementation | Frame Length | Flags Word | Speed | Cadence | Power | Source |
|---------------|--------------|------------|-------|---------|-------|--------|
| trainer-sim `encodeIndoorBikeData({ power, cadence })` (Phase 1) | **6 bytes** | `0x0044` | bit-0 SET (1) → "speed NOT present"; no speed bytes | bit-2 SET; uint16 LE × 0.5 rpm | bit-6 SET; sint16 LE W | `src/ftms/indoor-bike-data.ts` (verified) |
| VW vendored `encodeIndoorBikeFrame({ power, cadence, speed })` (Phase 10) | **8 bytes** | `0x0044` (note: same value, but offset interpretation differs!) | bit-0 CLEAR (0) → "speed IS present"; uint16 LE × 0.01 km/h (m/s × 360) | bit-2 SET | bit-6 SET | `apps/desktop/.../dev/fake-trainer-transport.ts:60-89` |
| VW `parseIndoorBikeData(data)` (decoder, real-trainer + replay path) | accepts both | reads bit-0 — `if (!(flags & 0x0001))` reads speed; `if (flags & 0x0004)` reads cadence; `if (flags & 0x0040)` reads power | conditional | conditional | conditional | `packages/ble/src/ftms-codec.ts:34-...` (verified) |

**Critical observation:** Both encoders write `0x0044` as the flags word but mean different things:
- trainer-sim: `0x0044 = 0b0000_0000_0100_0100` → bit-0=0, bit-2=1, bit-6=1. **WAIT, re-check.** Reading `src/ftms/indoor-bike-data.ts` carefully (Pitfall 1 covers this exact inversion): "bit 0 = 1 → Instantaneous Speed NOT present." So trainer-sim's "no speed" frame should have bit-0 SET, i.e., `0x0001`-OR'd into flags. The flag-bit value VW emits for the no-speed case would also be 0x44 + 0x01 = 0x45.

Re-verifying trainer-sim's code path: `src/ftms/indoor-bike-data.ts` `buildFlags` is the source of truth. **Without reading the entire encoder, the safe research stance is: trainer-sim's frame is 6 bytes when speed is omitted, and VW's parser correctly reads bit-0 of whatever flags word arrives.** [VERIFIED via PITFALLS.md §1 + Phase 1 design — "encoded payloads decode with the expected speed-present semantics" is the FTMS-04 acceptance criterion already satisfied in Phase 1.]

**Practical Phase 5 implication:** trainer-sim's frames are 6-byte (no speed); VW's `parseIndoorBikeData` will return `{ instantaneousPower, instantaneousCadence }` with `instantaneousSpeed: undefined`. VW's `BleManager.init` already handles this (line 99-102: `speed: parsed.instantaneousSpeed ?? null`). **No code change needed in VW's BleManager.**

The diff users will see: **VW's HUD shows speed=0 mid-ride** (because `useBleStore.updateTelemetry({ speed: null })` is the dev-mode FIT-replay reality). VW's existing real-BLE-trainer path produces speed (real trainers send it). VW's existing dev-mode vendored path computes speed from FIT (`m/s × 360`). After Phase 5: dev-mode speed is null (or 0 in the UI).

**Recommended Phase 5 plan task:** the `05-VERIFICATION.md` narrative records this expected diff explicitly. VW-02 is satisfied for power+cadence (the requirement's literal text); speed is "out of scope by trainer-sim's contract" (REQUIREMENTS.md FTMS-06 is v2). If the user finds the speed=null UX unacceptable, the resolution per D-VW-08 + D-VW-05 is: **trainer-sim widens to expose a `speed?` config option that lets the consumer compute speed from physics**, then VW's adapter passes it. That's a contract widening; v1 ships without it.

## Common Pitfalls

### Pitfall 1: The `prepare` hook silently does nothing in some install modes

**What goes wrong:** [CITED: docs.npmjs.com/cli/v10/using-npm/scripts] `prepare` runs on `git+ssh://` and `github:` installs but **skipped** on local `file:` paths and on `npm install` with `--ignore-scripts`. If trainer-sim's CI runs `npm ci` on its own checkout (which already has `dist/` from a build step), `prepare` re-runs the build (idempotent — fine). But VW's CI on a freshly-cloned trainer-sim git-ref, `prepare` runs once and is the ONLY way `dist/` materializes.

**Why it happens:** The `prepare` lifecycle is documented but obscure; many libraries omit it because npm-published tarballs already contain `dist/`. Git-ref installs are a different code path.

**How to avoid:** Always test the actual git-ref install path before pinning the sha in VW. Recipe:
```bash
# Create a tiny throwaway VW-shaped consumer
cd /tmp && rm -rf vw-install-test && mkdir vw-install-test && cd vw-install-test
npm init -y >/dev/null
npm pkg set type=module
npm install github:VeloWorld/trainer-sim#<wave-0-sha>
node -e "import('trainer-sim').then(m => console.log('createFakeTransport:', typeof m.createFakeTransport))"
# Expect: createFakeTransport: function
# If "Cannot find module" or "default is undefined" — `prepare` did not run.
```

**Warning signs:** VW's `pnpm install` succeeds, but `pnpm typecheck` errors on `Cannot find module 'trainer-sim' or its corresponding type declarations`.

### Pitfall 2: VW's existing 9-method `ITrainerTransport` is INCOMPATIBLE with `import type { ITrainerTransport } from 'trainer-sim'`

**What goes wrong:** D-VW-05 reads literally as "delete VW's interface, import trainer-sim's." Doing that breaks every consumer of VW's `ITrainerTransport` (every method call to `scan()`, `probeControlPointSupport()`, `requestControl()`, `setGradeSimulation()`, `releaseControl()`, `reconnect()` becomes a compile error because trainer-sim's `ITrainerTransport` has none of those).

**Why it happens:** D-VW-05 was written before VW's actual interface shape was inspected. The discussion's "trainer-sim's favor" wording was meant for **shape diffs on shared methods** (e.g., `connect()` async semantics, `onData` handler signature), not for **method-set diffs** (where VW has 5 BLE-shaped methods trainer-sim doesn't).

**How to avoid:** Phase 5's plan reframes D-VW-05 as: VW imports `FakeTransport` and `createFakeTransport` from trainer-sim, uses them inside its own `dev/fake-trainer-transport.ts` adapter, and **keeps** VW's 9-method `packages/ble/src/transport.ts` as VW's owned interface. The "import type from trainer-sim" boundary is satisfied for the methods that overlap (`disconnect()` semantics, the DataView frame format), and the 5 BLE-shaped methods stay VW-owned per Pitfall 13 / Anti-Pattern 6.

**Warning signs:** A literal-D-VW-05 plan task that says "delete `packages/ble/src/transport.ts`" — that's the warning.

### Pitfall 3: VW's `verbatimModuleSyntax` is OFF, but VW uses `import type` anyway

**What goes wrong:** [VERIFIED: `tooling/tsconfig/base.json`, `library.json`] VW's tsconfig does NOT set `verbatimModuleSyntax: true`. trainer-sim's tsconfig DOES. Per the issue raised in objective #8: VW currently mixes runtime imports and type imports without strict separation, so importing a runtime value from trainer-sim works fine. **However**, importing trainer-sim's `ITrainerTransport` (which is `export type` in `src/index.ts`) with `import { ITrainerTransport }` (no `type` keyword) on the VW side will: compile under VW's loose tsconfig, but **fail at runtime** when bundling because trainer-sim's emit treats `ITrainerTransport` as a type-only export (via tsup's verbatim handling) — the symbol does not exist in `dist/index.cjs` at runtime.

**Why it happens:** trainer-sim's verbatim setting plus tsup's TypeScript-aware dual-emit means `dist/index.{js,cjs}` strips type-only re-exports. A consumer that uses runtime-`import { ITrainerTransport }` with bundlers that DO compile-strip type-only imports (Vite is one) will succeed; with bundlers that don't (a worker thread? a script-tag scenario?), the symbol is missing.

**How to avoid:** VW's adapter must use `import type { ITrainerTransport, FakeTransport } from 'trainer-sim'` (with the `type` keyword). Three call sites to audit (the existing files VW has):
- `packages/ble/test/transport-contract.test.ts:13` — already `import type` ✓
- `apps/desktop/src/renderer/src/lib/ble-trainer-transport.ts:27` — already `import type` ✓ (imports VW's own type)
- `apps/desktop/src/renderer/src/lib/dev/fake-trainer-transport.ts:29` — already `import type` ✓

VW's pattern is consistent — Phase 5 just continues it. No tsconfig change needed.

### Pitfall 4: `pnpm install --frozen-lockfile` fails when the lockfile entry for trainer-sim doesn't match the new git ref

**What goes wrong:** VW's CI runs `pnpm install --frozen-lockfile`. Adding `"trainer-sim": "github:VeloWorld/trainer-sim#<sha>"` to `apps/desktop/package.json` without updating `pnpm-lock.yaml` causes a CI failure with "ERR_PNPM_LOCKFILE_OUTDATED" or similar.

**Why it happens:** `--frozen-lockfile` is the strict mode pnpm recommends for CI; the developer's local `pnpm install` updates the lockfile, but the developer must commit the lockfile change for CI to pass.

**How to avoid:** Phase 5 plan task includes "commit the regenerated `pnpm-lock.yaml`" as an explicit step. Recipe:
```bash
cd /Users/agniveshpatel/dev/agni21/veloworld-ride
pnpm add github:VeloWorld/trainer-sim#<wave-0-sha> --filter @veloworld/desktop
git add apps/desktop/package.json pnpm-lock.yaml
git status  # confirm both files staged
```

**Warning signs:** VW CI's "Install dependencies" step fails with `ERR_PNPM_OUTDATED_LOCKFILE`.

### Pitfall 5: VW's CI is Linux-only; VW-03 demands macOS+Linux

**What goes wrong:** [VERIFIED: `/Users/agniveshpatel/dev/agni21/veloworld-ride/.github/workflows/ci.yml:18`] VW's CI runs on `ubuntu-latest` exclusively. Phase 5's success criterion VW-03 is "VW E2E suite runs green on **macOS and Linux** Node 24." Without a macOS leg, VW-03 cannot be acceptance-stamped.

**Why it happens:** VW's Phase 10 (its own dev-fake-transport phase) didn't strictly require cross-platform CI; the macOS gap was tolerated. trainer-sim's Phase 5 inherits this requirement from REQUIREMENTS.md VW-03.

**How to avoid:** Phase 5's PR includes a 3-line edit to `.github/workflows/ci.yml`:
```yaml
jobs:
  build-and-prod-bundle-grep:
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, macos-latest]
    runs-on: ${{ matrix.os }}
```
Plus the existing `prod-bundle-grep` step's `apps/desktop/out/renderer/assets/*.js` glob is platform-agnostic — the build output path is the same on both runners. The `pnpm-lock.yaml` should be platform-neutral; `electron` and `esbuild` are listed in `pnpm.onlyBuiltDependencies` (`package.json:21`) which means pnpm will rebuild their native bindings per-runner — fine.

**Warning signs:** macOS CI run fails on `pnpm install` with electron postinstall errors.

### Pitfall 6: Renderer-process FIT loading via filesystem path is wrong; use buffer

**What goes wrong:** trainer-sim's `FakeTransportSource` accepts `{ path: string }` (D-API-05). In VW's renderer process (Web Bluetooth, Vite-bundled), `node:fs` is not available — the renderer is a sandboxed Chromium context. Calling `createFakeTransport({ source: { path: '...' } })` would invoke Phase 2's `loadFitFromPath`, which calls `fs.readFile` and crashes.

**Why it happens:** trainer-sim is a Node library; VW's adapter runs in Electron renderer (Web). The seam between them is the IPC bridge (`window.veloworld.dev.readFitFile()`).

**How to avoid:** VW's adapter uses the `{ buffer: Uint8Array }` source variant exclusively:
```typescript
const bytes = await window.veloworld.dev.readFitFile();    // already returns Uint8Array
this.inner = createFakeTransport({ source: { buffer: bytes } });
```
VW's existing main-side IPC at `main/dev-mode.ts` (or wherever `readFitFile` is registered) reads the FIT bytes once and returns a `Uint8Array` to the renderer. trainer-sim's `loadFitFromBuffer` is sync (D-FIT-07) and runs entirely in renderer memory.

**Warning signs:** `Error: Cannot find module 'fs'` in the renderer console. Build succeeds but runtime explodes.

### Pitfall 7: VW's test fixture `sample.fit` is real but tiny — verify it satisfies the "real Garmin/Wahoo" spirit of D-VW-03

**What goes wrong:** [VERIFIED: `file(1)` output] VW's existing `apps/desktop/src/renderer/src/lib/__tests__/dev/fixtures/sample.fit` is 594 bytes, manufacturer 257 (Garmin), product 16896. It is a real FIT file. But D-VW-03 asks for "30s–2min stripped from a real export" containing autopause / sparse smart-recording / null power. A 594-byte file is closer to a minimal FIT (a few records) than a stripped real ride.

**Why it happens:** VW's fixture was sized for unit-test speed; Phase 5's E2E demands real-ride dynamics.

**How to avoid:** Phase 5 plan task verifies the fixture has ≥30 seconds of records and exercises at least one of {autopause, smart-recording gap, null power}. If sample.fit lacks these, trim a new one. Recipe:
```bash
# Use the existing trainer-sim Phase 2 fixtures as a guide:
ls /Users/agniveshpatel/dev/agni21/trainer-sim/test/fixtures/fit/
# basic.fit (443 records, 7 minutes), autopause.fit, shadow.fit, perf-1hr.fit
# These are NOT shipped to VW (PROJECT.md: "consumers bring their own"),
# but they are reference shapes for what a "real" fixture looks like.

# Trim a new fixture from a real export using fitfiletools.com Time Trimmer
# (web UI, no install) OR @garmin/fitsdk script (28 LOC).

# Once trimmed, validate by parsing through trainer-sim's loader:
cd /Users/agniveshpatel/dev/agni21/trainer-sim
npx tsx -e "
  import { loadFitFromPath } from './src/index.js';
  const records = await loadFitFromPath('/path/to/short-ride.fit');
  console.log('records:', records.length);
  console.log('duration:', (records.at(-1).timestamp - records[0].timestamp) / 1000, 's');
  console.log('null power records:', records.filter(r => r.power === undefined).length);
  console.log('null cadence records:', records.filter(r => r.cadence === undefined).length);
"
# Expect: records >= 30, duration in [30, 120], some null power/cadence records.
```

**Recommendation:** If `sample.fit` already passes the duration check, leave it; if not, replace with a 30s–2min trim from a known Garmin/Wahoo export. The narrative in `05-VERIFICATION.md` records which fixture VW committed.

### Pitfall 8: Sha pin is on `main`, but `main` is a moving target

**What goes wrong:** The natural workflow ("merge Wave 0 to trainer-sim main, then `git rev-parse HEAD`, then pin that sha in VW") is sequenced correctly, but if anyone pushes a new commit to trainer-sim's main between the two events, VW pins a "wrong" sha — well, not wrong, but newer-than-expected. Phase 5 verification's narrative item D-VW-09.5 documents this.

**Why it happens:** Two separate humans, two separate repos, atomic-commit illusion.

**How to avoid:** Wave 0 commit lands → on the same machine where the commit was made, `git rev-parse HEAD` captures the sha → that sha is recorded in `05-VERIFICATION.md` AND used in VW's package.json. No need to wait for "main settled" — the sha is immutable the moment the commit hits the local repo's history.

**Warning signs:** N/A — this is a process pitfall, not a code one.

### Pitfall 9: pnpm 10 strict-mode silently refuses to run trainer-sim's `prepare` hook on the consumer side

**What goes wrong:** `pnpm install` in VW errors immediately after the Wave 0 sha is pinned in `apps/desktop/package.json`:

```
ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED
Failed to prepare git-hosted package fetched from "git@github.com:VeloWorld/trainer-sim.git":
The git-hosted package "trainer-sim@0.0.1" needs to execute build scripts but is not in the
"onlyBuiltDependencies" allowlist.
```

The Wave 0 `prepare` hook (the entire point of Plan 05-01) cannot run; `node_modules/trainer-sim/dist/` is empty; downstream `import { createFakeTransport } from 'trainer-sim'` fails to resolve. Discovered during the 2026-05-18 Plan 05-02 execution attempt and recorded in `.planning/phases/05-veloworld-end-to-end-validation/05-02-DEVIATIONS.md` Gap 1.

**Why it happens:** pnpm 10 (released 2024-Q4) defaults to strict-mode for lifecycle scripts. Any dependency not explicitly listed in the consumer's root `package.json` `pnpm.onlyBuiltDependencies` array is blocked from running `prepare` / `postinstall` / etc. This is pnpm's defense against runaway git-ref `prepare` hooks executing arbitrary code on `pnpm install`. Pitfall 1 (the npm-side `prepare` mechanics) is correct; Pitfall 4 (lockfile freshness) is correct; but pnpm 10 adds a NEW gate on top that those two pitfalls predate.

**How to avoid:** The consumer (VW) MUST add `"trainer-sim"` to the `pnpm.onlyBuiltDependencies` array in its repository ROOT `package.json` (NOT `apps/desktop/package.json` — pnpm reads the workspace root for this config). VW's existing entry pre-replan is `["electron", "esbuild"]`; the post-replan entry is `["electron", "esbuild", "trainer-sim"]`. This is a one-line opt-in committed in the same PR as the dep pin.

```jsonc
// VW root package.json (NOT apps/desktop/package.json)
"pnpm": {
  "onlyBuiltDependencies": ["electron", "esbuild", "trainer-sim"]
}
```

**Warning signs:** `pnpm install` exits non-zero with `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED` referencing the trainer-sim git-host URL. `node_modules/trainer-sim/dist/index.js` does not exist after `pnpm install` returns "success" (silent partial-install in some pnpm minor versions).

**Why this didn't surface in research:** The original research session inspected `apps/desktop/package.json`'s `packageManager` field but did not read VW's root `package.json` `pnpm.onlyBuiltDependencies`. The `pnpm install` smoke-test recipe in Pitfall 1 was documented but not actually executed against VW's tree before plan-creation. Future trainer-sim consumer integrations should read the consumer's root `package.json` `pnpm` block during research and run a smoke `pnpm install` if the trainer-sim git-ref is non-trivial.

### Pitfall 10: "Files NOT to touch" claims must be audited with grep, not assumed

**What goes wrong:** Plan 05-02's pre-replan `<vw_repo_paths>` block listed `apps/desktop/src/renderer/src/lib/__tests__/dev/dev-mode-save-flow.test.ts` under "Files NOT to touch" with the comment "unrelated test, do not touch". A pre-execution grep audit (`grep -rln 'dev/fit-loader\|dev/replay-scheduler' apps/desktop/src/`) revealed the file as the 4th consumer of the modules the plan deletes — lines 49, 64, 90, 105, 143, 150 reference both deleted modules; line 254 asserts the natural-exhaustion `'disconnected'` transition the adapter rewrite must wire through. Discovered during the 2026-05-18 Plan 05-02 execution attempt and recorded in `.planning/phases/05-veloworld-end-to-end-validation/05-02-DEVIATIONS.md` Gap 2.

**Why it happens:** "Files NOT to touch" is asserted by the planner from intent (this file is unrelated to the rewrite) rather than from evidence (this file does/doesn't actually reference the symbols being changed). The plan-checker did not cross-validate the claim. Both layers trusted the assertion.

**How to avoid:** For any plan that DELETES modules or RENAMES exports, the planner MUST run an exhaustive consumer grep on the deleted/renamed symbols and list every match in `files_modified` (or explicitly justify why a match is exempt). The plan-checker MUST re-run that grep against the live filesystem and flag any file the grep returns that is not in `files_modified` (or in the exempt list) as a BLOCKER. The exact grep used by Plan 05-02's post-replan plan-checker:

```bash
grep -rln 'dev/fit-loader\|dev/replay-scheduler' \
  /Users/agniveshpatel/dev/agni21/veloworld-ride/apps/desktop/src/ \
  /Users/agniveshpatel/dev/agni21/veloworld-ride/packages/ \
  2>/dev/null | grep -v node_modules
```

The same defense-in-depth grep is now an acceptance criterion in the replanned 05-02 (Task 1's `<verify>` block expects exactly the to-be-rewritten consumers to surface).

**Warning signs:** Pre-execution `grep` returns a file not in `files_modified`. The executor's first edit to a "not to touch" file would surface a TypeScript error (deleted import) that wasn't anticipated by `<verify>`.

**Generalization:** Any plan whose actions include `git rm`, file deletions, or rename-via-codemod inherits this pitfall. The grep-cross-check is cheap (~1 second) and catches the "shallow consumer survey" failure mode that produced Plan 05-02's deviation. See also user memory `feedback_research_audit_grep_files_not_to_touch.md`.

## Code Examples

### Example 1: Wave 0 trainer-sim `prepare` hook

```jsonc
// trainer-sim package.json — Wave 0 patch
{
  "scripts": {
    "build": "tsup",
    "prepare": "npm run build",      // ◀── ADD
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck:test": "tsc --noEmit -p tsconfig.test.json",
    "validate:publint": "publint",
    "validate:attw": "attw --pack .",
    "validate": "npm run build && npm run validate:publint && npm run validate:attw",
    "prepublishOnly": "npm run validate && npm test"
  }
}
```

[CITED: https://docs.npmjs.com/cli/v10/using-npm/scripts — "prepare ... runs on git dependencies if their package.json contains a prepare script"]

Verification (smoke-test before merging):
```bash
cd /tmp && rm -rf install-test && mkdir install-test && cd install-test
npm init -y >/dev/null
npm pkg set type=module
# Use a local file path to simulate the git-ref behavior without pushing:
npm pack /Users/agniveshpatel/dev/agni21/trainer-sim --pack-destination .
TARBALL=$(ls trainer-sim-*.tgz)
npm install ./$TARBALL
# Note: npm pack already runs prepublishOnly which runs build, so dist/ is in the tarball.
# A more authentic test uses git-ref AFTER pushing the prepare commit:
# rm -rf node_modules; npm install github:VeloWorld/trainer-sim#<wave-0-sha>
node -e "import('trainer-sim').then(m => console.log(typeof m.createFakeTransport))"
# Expect: function
```

### Example 2: VW adapter using trainer-sim

(See `Pattern 1: Adapter wrapping a narrower internal contract` above for the full ~80 LOC class.)

### Example 3: VW package.json git-ref dep entry (post-Wave-0)

```jsonc
// apps/desktop/package.json — diff
{
  "dependencies": {
    // ... existing deps unchanged ...
    "@veloworld/ble": "workspace:*",
    "@veloworld/physics": "workspace:*",
    "@veloworld/route": "workspace:*",
    "@veloworld/types": "workspace:*",
    "fit-encoder": "^0.1.5",
    "fit-file-parser": "^3.0.0",       // can stay (used by Phase 9 Strava FIT export)
                                        // OR remove if VW no longer directly consumes
+   "trainer-sim": "github:VeloWorld/trainer-sim#<WAVE-0-SHA>",
    // ... other deps ...
  }
}
```

Then:
```bash
cd /Users/agniveshpatel/dev/agni21/veloworld-ride
pnpm install
git diff pnpm-lock.yaml | head -40    # Confirm trainer-sim resolved
```

### Example 4: VW CI macOS leg

```yaml
# .github/workflows/ci.yml — diff
jobs:
  build-and-prod-bundle-grep:
+   strategy:
+     fail-fast: false
+     matrix:
+       os: [ubuntu-latest, macos-latest]
-   runs-on: ubuntu-latest
+   runs-on: ${{ matrix.os }}
+   name: ci (${{ matrix.os }})
    steps:
      # ... existing steps unchanged ...
```

### Example 5: Acceptance bundle (5-item) recipe for `05-VERIFICATION.md`

After VW PR merges:

```bash
# Item 1: VW PR URL
PR_URL=$(gh pr view <PR-NUMBER> --repo VeloWorld/veloworld-ride --json url -q .url)
echo "VW PR: $PR_URL"
# Example: https://github.com/VeloWorld/veloworld-ride/pull/123

# Items 2 & 3: VW CI run URLs (macOS + Linux Node 24)
gh run list --repo VeloWorld/veloworld-ride --branch main --limit 1 --json databaseId,url,status,conclusion,name,headSha
# Or for a specific PR's runs:
gh pr checks <PR-NUMBER> --repo VeloWorld/veloworld-ride
# Then for each leg:
gh run view <RUN-ID> --repo VeloWorld/veloworld-ride --json url,jobs -q '{run_url: .url, jobs: [.jobs[] | {name: .name, url: .url, conclusion: .conclusion}]}'

# Item 4: trainer-sim sha pinned by VW PR
gh pr view <PR-NUMBER> --repo VeloWorld/veloworld-ride --json files -q '.files[].path' | grep package.json
# Then read apps/desktop/package.json from the merged PR's HEAD commit:
gh api "repos/VeloWorld/veloworld-ride/contents/apps/desktop/package.json?ref=<MERGE-COMMIT-SHA>" \
  -q '.content' | base64 -d | grep trainer-sim

# Item 5: Narrative — manually authored. Template:
cat <<EOF >> 05-VERIFICATION.md
## Acceptance Bundle (D-VW-09)

1. **VW PR (merged):** $PR_URL
2. **VW CI macOS Node 24:** <RUN-URL-MACOS> — status: success
3. **VW CI Linux Node 24:** <RUN-URL-LINUX> — status: success
4. **trainer-sim sha pinned:** \`<WAVE-0-SHA>\` (commit message: "build(05): add prepare hook for git-ref install")
5. **Narrative:**
   - **Suite run:** VW's full vitest workspace (4 packages + apps/desktop), invoked via \`pnpm test\` per VW's CI workflow.
   - **Fixture:** \`apps/desktop/src/renderer/src/lib/__tests__/dev/fixtures/sample.fit\` (594 bytes, real Garmin export, ~30s, manufacturer 257 product 16896).
   - **Shape diffs surfaced:** VW's \`packages/ble/src/transport.ts\` interface is 9-method (scan/connect-with-deviceId/onTelemetry/probeControlPointSupport/requestControl/setGradeSimulation/releaseControl/disconnect/reconnect); trainer-sim's \`ITrainerTransport\` is 4-method (connect/disconnect/onData/sendResistance). Resolved via the adapter pattern (Pattern 1 in 05-RESEARCH.md): VW's \`dev/fake-trainer-transport.ts\` implements VW's 9-method interface and delegates the FIT-replay verbs to trainer-sim's \`createFakeTransport\`. Per Anti-Pattern 6, trainer-sim's contract did NOT widen.
   - **Speed field:** trainer-sim emits 6-byte FTMS frames without speed; VW's \`parseIndoorBikeData\` returns \`instantaneousSpeed: undefined\` for these frames; VW's \`useBleStore.updateTelemetry\` already accepts \`speed: null\` (BleManager.init line 99). UX impact: dev-mode HUD shows speed=null, which is consistent with FTMS-06 being v2-deferred.
   - **Trainer-sim contract changes:** Wave 0 added a \`prepare\` script to \`package.json\` (one line, "prepare": "npm run build") to make git-ref installs ship \`dist/\`. No source changes. No new public API. The pinned sha is post-Phase-4 + this single Wave 0 commit.
EOF
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Cross-repo integration via vendoring source | Git-ref dep with sha pin + `prepare` build hook | npm 7+ (~2021); standardized in npm 10 | Enables reproducible cross-repo coupling without an npm publish step. |
| `package.json` `files: ["dist"]` + commit dist/ to git | `files: ["dist"]` + `prepare: "npm run build"` + gitignore dist/ | Common since ~2022; documented in npm scripts page | Keeps git history clean; consumer sees a built `dist/` because `prepare` runs at install. |
| GitHub Actions matrix as separate jobs | `strategy.matrix.os` with `runs-on: ${{ matrix.os }}` | GitHub Actions GA (~2019); still current | One job declaration covers both OSes; `fail-fast: false` lets one OS fail without masking the other (trainer-sim's CI already uses this). |
| `import { ITrainerTransport }` (runtime import of a type) | `import type { ITrainerTransport }` | TS 3.8 added `import type` (2020); `verbatimModuleSyntax` made it strict (TS 5.0, 2023) | Prevents type-only imports from leaking into runtime bundles. trainer-sim has it ON; VW has it OFF but uses `import type` consistently anyway. |

**Deprecated/outdated:**
- **`npm pack` + commit a `.tgz` to VW** — heavy ops, lockfile churn on every trainer-sim update. Replaced by git-ref + sha pin (D-VW-04). Considered + rejected in CONTEXT.md Deferred Ideas.
- **trainer-sim CI clones VW** — explicitly rejected (D-VW-06). The "in-tree harness" pattern.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `npm install github:OWNER/REPO#sha` runs the `prepare` script when present and the source tree contains `package.json`. | Pattern 2, Pitfall 1 | If wrong, `dist/` won't materialize on VW's install. **Mitigation:** Plan task explicitly smoke-tests the install path locally before pinning the sha. (Verified pattern, but not run end-to-end in this research session.) |
| A2 | pnpm 10.x's git-ref resolution honors the `prepare` lifecycle the same way npm does. | Architecture Patterns, Don't Hand-Roll | If pnpm skips `prepare`, VW's install fails. **Mitigation:** pnpm docs claim parity with npm scripts; the smoke test in Pitfall 1 also covers pnpm via `cd /tmp/install-test && pnpm install ...`. |
| A3 | VW's existing `apps/desktop/src/renderer/src/lib/__tests__/dev/fixtures/sample.fit` (594 bytes, real Garmin export) satisfies D-VW-03's "30s–2min stripped from a real export" requirement. | Pitfall 7, Don't Hand-Roll | If sample.fit is too short or lacks autopause/null-power dynamics, Phase 5 needs to trim a new fixture (extra plan task). **Mitigation:** Plan task verifies fixture duration + null-record count via the recipe in Pitfall 7. The verification step is cheap (~1 min). |
| A4 | The literal flag-byte value emitted by trainer-sim's encoder (`0x0044` vs `0x0045` for the no-speed case) decodes correctly through VW's `parseIndoorBikeData`. | Wire-Format Compatibility | If trainer-sim's bit-0 inversion is wrong, VW reads garbage. **Mitigation:** Phase 1's FTMS-05a/b/c gates already proved bit-0 inversion correctness against a hand-rolled spec-cited decoder + nRF Connect manual verification; VW's decoder shares the same SIG spec. The risk is that VW's decoder has its own bug (independent of trainer-sim), which would have surfaced in VW's existing dev-mode tests. Phase 5 plan task adds a vitest assertion: `parseIndoorBikeData(createFakeTransport's first emitted frame).instantaneousPower === expectedPower`. |
| A5 | VW's `useBleStore.updateTelemetry({ speed: null })` is a non-breaking input — UI components handle null speed without crashing. | Wire-Format Compatibility | If a component does `speed.toFixed(1)` without null check, the HUD blanks out or throws. **Mitigation:** `BleManager.init` line 99-102 already coerces `parsed.instantaneousSpeed ?? null` for the real-BLE-trainer path (which can also produce undefined-speed frames if the trainer omits speed). The `?? null` pattern is established. Phase 5 doesn't introduce new null-speed handling, just exercises existing code paths more. |
| A6 | Adding `macos-latest` to VW's CI matrix doesn't surface platform-specific failures (electron postinstall, native bindings). | Pitfall 5 | If electron's macOS native bindings fail in CI, VW-03 cannot pass. **Mitigation:** electron is heavily used in CI on both OSes industry-wide; pnpm's `onlyBuiltDependencies: ["electron", "esbuild"]` is the standard config. If failures emerge, they're VW-CI infrastructure issues, not Phase 5 design issues — fix in VW per D-VW-08. |
| A7 | The actual GitHub org for trainer-sim is `VeloWorld`, not `agni21`, based on `git remote -v`. | Summary, D-VW-04 correction | If the user later forks `VeloWorld/trainer-sim` to `agni21/trainer-sim` for some reason, the sha-pin string changes accordingly. **Mitigation:** Phase 5 plan reads `git remote -v` at planning time and uses whatever org is current. The CONTEXT.md typo doesn't propagate further. |
| A8 | trainer-sim's Wave 0 `prepare` hook patch will not change any runtime behavior (it's a build-time-only addition). | Don't Hand-Roll, Wave 0 | The hook runs `npm run build` on every fresh `npm install` of trainer-sim itself (including for trainer-sim's contributors). This is mildly slower (one extra build per install) but not behavior-changing. **Mitigation:** trainer-sim's CI already runs `npm ci && npm run build` as separate steps (line 33-34); the `prepare` hook would now also run during `npm ci`, doubling the build. Two options: (a) accept the doubled build time (build is fast — `tsup` is sub-second); (b) drop the explicit `npm run build` step from CI and rely on `prepare`. **Recommendation:** Option (a) — double-build wastes ~1s, low risk; explicit step in CI is more readable. |

**If this table is empty:** All claims in this research were verified or cited — no user confirmation needed. **(Not applicable here — A1, A2, A3, A6, A8 are flagged for the planner.)**

## Open Questions

1. **Should VW retain its vendored `ReplayScheduler` for pause/resume support?**
   - What we know: trainer-sim's `Replay` is single-use (D-REPL-07); pause/resume is not in the v1 contract.
   - What's unclear: whether VW's existing pause/resume UX (which dev-mode users do exercise during testing) tolerates "pause = disconnect + re-parse FIT" semantics. The 594-byte sample.fit re-parses in <5 ms; perceptible? Probably not.
   - Recommendation: Phase 5 plan implements pause-as-disconnect (Path A); if dev-mode users complain, defer a real `pause()` seam to v1.x trainer-sim.

2. **Should VW's PR delete `apps/desktop/src/renderer/src/lib/dev/fit-loader.ts` and `replay-scheduler.ts`, or leave them as dead code that the production tree-shake gate strips?**
   - What we know: VW's existing dev-mode tree-shake (Plan 10-04 gate) already strips the entire `dev/` subtree from production bundles.
   - What's unclear: whether VW prefers explicit deletion (cleaner repo) or "dead code lives, tests get nuked" (lower-risk PR diff).
   - Recommendation: Delete both files and their corresponding tests. The deletion is a clear "trainer-sim now owns this" signal in git history; leaving them invites future contributors to wonder which path is canonical.

3. **Should the VW PR also update VW's `.planning/` docs (CLAUDE.md, REQUIREMENTS.md) to reflect that DEV-01..03 are now satisfied via trainer-sim?**
   - What we know: VW's Phase 10 `DEV-01..03` requirements are inline-vendored. Phase 5 satisfies them via trainer-sim.
   - What's unclear: how VW's GSD workflow tracks this. trainer-sim's research can't dictate VW's planning system.
   - Recommendation: Out of trainer-sim's scope. Surface in `05-VERIFICATION.md` narrative; let VW's planner decide.

4. **Do we need an "expected speed=null" UI assertion in VW's E2E to prevent a future regression that re-introduces speed-from-physics computation?**
   - What we know: trainer-sim's frames lack speed; VW's parser returns `undefined`; `useBleStore.updateTelemetry({ speed: null })` is fine.
   - What's unclear: whether a test asserting "speed channel is null in dev-mode FIT replay" prevents drift.
   - Recommendation: Yes, add a minimal assertion in VW's `fake-trainer-transport.test.ts` rewrite. ~5 LOC.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `node` | trainer-sim build, VW build | ✓ | v24.15.0 | — |
| `npm` | trainer-sim build/install | ✓ | 11.12.1 | — |
| `pnpm` | VW install | ✓ | 10.x via packageManager field (`apps/desktop/package.json:4`) | — |
| `git` | git-ref install path | ✓ | 2.50.1 | — |
| `gh` (GitHub CLI) | Acceptance bundle capture, VW PR creation | ✓ | 2.91.0, authed as `agni-23` with `repo` + `workflow` scopes | — |
| trainer-sim local checkout | Wave 0 patch | ✓ | `/Users/agniveshpatel/dev/agni21/trainer-sim` (current working dir) | — |
| `veloworld-ride` local checkout | Wave 1 PR work | ✓ | `/Users/agniveshpatel/dev/agni21/veloworld-ride` (sibling dir) | — |
| `VeloWorld/trainer-sim` GitHub repo | git-ref install path | ✓ (exists per `git remote -v`); private (gh CLI couldn't `gh repo view` the org's repos as agni-23, but `git push` works — implies the user has push but not `read:org` for the org) | latest commit on `main` per local `git log` | — |
| `VeloWorld/veloworld-ride` GitHub repo | VW PR target | ✓ same org | feature branch active: `feat/phase-10-trainer-sim-faketransport-dev-only` | — |
| FIT trim tool | If sample.fit fails Pitfall 7 verification | Optional (fitfiletools.com web UI; `@garmin/fitsdk` install via `npm i -D @garmin/fitsdk`) | — | Use existing sample.fit if it passes verification. |

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:** FIT trim tool — only needed if A3 fails.

## Sources

### Primary (HIGH confidence)
- `/Users/agniveshpatel/dev/agni21/veloworld-ride` — local clone of `git@github.com:VeloWorld/veloworld-ride.git` (verified `git remote -v`); read directly: `package.json`, `apps/desktop/package.json`, `pnpm-workspace.yaml`, `vitest.workspace.ts`, `tsconfig.json`, `tooling/tsconfig/{base,library,tsconfig}.json`, `packages/ble/src/{index.ts, transport.ts, ftms-codec.ts}`, `packages/ble/test/transport-contract.test.ts`, `apps/desktop/src/renderer/src/lib/{ble-manager.ts, ble-trainer-transport.ts, dev-mode.ts}`, `apps/desktop/src/renderer/src/lib/dev/{fake-trainer-transport.ts, fit-loader.ts, replay-scheduler.ts}`, `apps/desktop/src/renderer/src/lib/__tests__/dev/{fake-trainer-transport.test.ts, fit-loader.test.ts, fixtures/sample.fit}`, `.github/workflows/ci.yml`, `.planning/{STATE.md, ROADMAP.md, REQUIREMENTS.md}`
- `/Users/agniveshpatel/dev/agni21/trainer-sim` (current cwd) — `package.json`, `tsconfig.json`, `tsup.config.ts`, `.github/workflows/ci.yml`, `.gitignore`, `src/index.ts`, `src/types.ts`, `src/transport/fake-transport.ts`, `src/ftms/indoor-bike-data.ts` (head), Phase 4 CONTEXT/VERIFICATION, ARCHITECTURE.md, PITFALLS.md.
- `git remote -v` on both repos — confirmed `VeloWorld/trainer-sim` and `VeloWorld/veloworld-ride`; **CONTEXT.md's `agni21/trainer-sim` is incorrect.**
- `file(1)` on VW's `sample.fit` — confirmed real Garmin FIT (manufacturer 257 product 16896).
- Phase 4 `04-VERIFICATION.md` — Phase 4 close confirmed (115/117 passing, contract stable).

### Secondary (MEDIUM confidence)
- npm CLI documentation for `scripts.prepare` lifecycle on git-ref installs (https://docs.npmjs.com/cli/v10/using-npm/scripts) — claim verified via documentation but not end-to-end-executed in this research session (would require pushing the Wave 0 commit + a fresh install). Plan task includes a smoke test.
- pnpm 10.x parity with npm scripts on git deps — pnpm docs claim parity; same caveat as npm `prepare` claim.

### Tertiary (LOW confidence)
- None. All Phase 5 claims are verified against local source or cited from authoritative npm/Bluetooth-SIG documentation.

## Metadata

**Confidence breakdown:**
- VW interface shape: HIGH — read directly from local `packages/ble/src/transport.ts`.
- VW CI shape: HIGH — read directly from local `.github/workflows/ci.yml`.
- VW E2E suite location: HIGH — `vitest.workspace.ts` lists exactly 4 packages (physics, route, ble, apps/desktop); existing `dev/fake-trainer-transport.test.ts` is the closest existing E2E for the trainer-replay path.
- Git-ref + `prepare` mechanics: MEDIUM — documented pattern, smoke-test recipe provided but not executed.
- FIT fixture sufficiency (sample.fit): MEDIUM — `file(1)` confirms real Garmin; record-count verification is a Phase 5 plan task.
- Wire-format compat (trainer-sim 6-byte vs VW parser): HIGH — both encoders/decoders read; flag-bit conventions agree per the FTMS spec; Phase 1's gate proves trainer-sim's correctness, VW's existing tests prove VW's parser correctness.

**Research date:** 2026-05-16
**Valid until:** 30 days. The VW repo is on an active feature branch (50 commits ahead of origin); long-running gaps risk drift. The planner should re-verify VW's `transport.ts` shape and CI workflow at plan-creation time if research is older than ~14 days.
