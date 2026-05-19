# Phase 5: VeloWorld End-to-End Validation - Context

**Gathered:** 2026-05-16
**Status:** Ready for planning

<domain>
## Phase Boundary

Prove that VeloWorld's existing `ITrainerTransport`-consuming code runs unchanged when `FakeTransport` (from this repo) replaces VW's real BLE transport, with VW's existing FTMS decoder reading correct power and cadence values across the full ride, on both macOS and Linux running Node 24. Phase 5 is the v1 acceptance gate — until it passes, v1 is not done (PROJECT.md, ROADMAP.md Phase 5 Notes).

The deliverable is **cross-repo**: the actual proving artifact is a merged PR in the VeloWorld repository. trainer-sim's role in Phase 5 is (a) producing a stable, pinnable git commit of `createFakeTransport` + `ITrainerTransport`, and (b) recording the integration-side decisions and verification artifacts here so a future contributor can retrace why and how the contract was canonicalized.

**In scope (from ROADMAP Phase 5):**
- VW-01: VW's existing `ITrainerTransport`-consuming code (ride scene + physics) runs **unchanged** when FakeTransport is swapped in for the real BLE transport. "Unchanged" = no edits to ride scene or physics code; the only diffs in VW are (i) the test/dev wiring that picks the transport implementation and (ii) the interface declaration migration locked below.
- VW-02: A real Garmin/Wahoo FIT replayed through FakeTransport produces power and cadence values that VW's existing FTMS decoder reads correctly across the full ride.
- VW-03: VW's E2E suite runs green on macOS and Linux on Node 24 in VW's CI.

**Out of scope (per PROJECT.md, REQUIREMENTS.md, ROADMAP.md, and the discussion locks below):**
- BlenoTransport / real BLE peripheral advertising — v2.
- CLI (`trainer-sim play`) — v2.
- HR / speed FTMS fields — v2 (REQUIREMENTS.md FTMS-06, FTMS-07; PROJECT.md "Power + cadence only for v1 IndoorBikeData fields").
- npm publish of trainer-sim — v1.x. Phase 5 uses a git-ref dependency in VW (D-VW-04). Publishing before Phase 5 closes is awkward (PROJECT.md gates v1 on Phase 5 passing).
- An in-tree harness inside trainer-sim that vendors VW's decoder/ride-loop — explicitly rejected (D-VW-01). Passing in-tree does not prove VW actually consumes the contract.
- A trainer-sim CI job that clones VW and runs a slice of VW's E2E — explicitly rejected (D-VW-06). Reintroduces the in-tree-harness coupling under a different name.
- Resolution of trainer-sim's outstanding advisory followups (Phase 2 WR-01/WR-03/WR-05, Phase 3 WR-02/WR-04 — see STATE.md). These are loader/scheduler-internal and don't surface through FakeTransport's contract; they stay in the followup queue past v1 close.
- A migration plan for v1.x npm publishing — recorded in Deferred Ideas, not planned in Phase 5.

</domain>

<decisions>
## Implementation Decisions

### Integration test form (the central question ROADMAP flagged)
- **D-VW-01:** Phase 5 lands a **coordinated PR against the VeloWorld repository**, not an in-tree harness inside trainer-sim. The PR wires VW's test/dev build to install trainer-sim and runs VW's existing E2E suite green against `createFakeTransport`. Rationale: passing an in-tree harness does not prove that real VW actually consumes trainer-sim's contract — only the cross-repo gate proves that. The in-tree-harness option was considered and rejected during Area 1 of discussion.
- **D-VW-02:** The PR runs **VW's full top-level E2E suite** with FakeTransport swapped in for the BLE transport — ride scene + physics + decoder all exercised. A "transport+decoder seam only" test is insufficient because it does not prove VW-01's "no edits to ride scene or physics code" claim. The full E2E is what makes "VW dev/test build runs green" (the phase goal verbatim) provable.
- **D-VW-03:** VeloWorld commits its own **small real Garmin/Wahoo FIT fixture** (e.g., `test/fixtures/short-ride.fit`, ~30s–2min stripped from a real export) inside VW's repo. trainer-sim ships zero FIT bytes for VW. This honors PROJECT.md "Bundled fixture FIT files — consumers (incl. VeloWorld) bring their own" and matches REQUIREMENTS.md "Real Garmin/Wahoo FIT files only" (synthesized minimal FIT was considered and rejected as too close to "synthetic data"). Trimming a real ride down to ~30s–2min keeps VW's CI fast while preserving real ride dynamics (FIT autopause, sparse smart-recording, optional `null` power) — exactly the corpus shape Phase 2's loader (`src/fit/loader.ts`) was hardened against.

### Cross-repo wiring
- **D-VW-04:** VeloWorld installs trainer-sim via a **git-ref dependency** pinned to a specific commit:
  ```jsonc
  // VW's package.json devDependencies
  "trainer-sim": "github:VeloWorld/trainer-sim#<sha>"
  ```
  No npm publish in Phase 5. Updating trainer-sim from VW's perspective is "bump the sha". Reproducible (sha pin), works on macOS+Linux GitHub Actions runners (`npm ci` resolves git deps), no offline-CI concerns for the v1 scale. The local-tarball alternative (`npm pack` → committed `.tgz` in VW) was considered and rejected as heavier ops without a v1 benefit. The npm-publish alternative was rejected because PROJECT.md gates v1 on Phase 5 passing — publishing 0.x before the integration validation passes is awkward sequencing.
- **D-VW-05:** Phase 5's VW PR **fully canonicalizes `ITrainerTransport`** in VeloWorld. VW deletes its internal interface declaration (whatever shape it has today) and replaces it with `import type { ITrainerTransport } from 'trainer-sim'`. This realizes Phase 4's D-API-01 ("trainer-sim is the canonical definer of `ITrainerTransport`") and ARCHITECTURE.md Anti-Pattern 6 ("don't define `ITrainerTransport` in consumer"). If VW's current shape diverges from trainer-sim's, **the resolution is in trainer-sim's favor** (per Anti-Pattern 6) — VW's adapter code (the BLE wrapper, the FakeTransport call site) bends to trainer-sim's contract, not the other way round. Trainer-sim's contract does NOT widen to absorb VW idiosyncrasies. The structural-typing-only and the hybrid type-test alternatives were both considered and rejected — they defer the canonicalization that Phase 4 already promised.
- **D-VW-06:** **trainer-sim's CI stays independent.** Phase 5 adds NO CI jobs to trainer-sim's `.github/workflows/ci.yml`. Phase 5 "done" is a manual gate: the VW PR is merged with green VW CI on macOS+Linux Node 24. The artifact recorded in `05-VERIFICATION.md` is (i) a link to the merged VW PR, (ii) the VW CI run URL showing macOS + Linux green, and (iii) the trainer-sim git sha that the VW PR pins. trainer-sim's CI never imports anything from VeloWorld — that would reintroduce the in-tree-harness coupling rejected in D-VW-01 under a different name.

### What Phase 5 produces inside trainer-sim
- **D-VW-07:** trainer-sim's Phase 5 deliverable inside this repo is **documentation + a stable commit**, not new source code. Specifically:
  - `05-RESEARCH.md` (phase research before planning): how VW's current transport/decoder is shaped today (read-only reconnaissance from VW's repo), what `ITrainerTransport` shape diffs (if any) the canonicalization will surface, what `npm install` shape works for VW's CI, where VW's existing E2E suite lives.
  - `05-PLAN-XX.md` files: the work decomposition for the VW-side PR (a checklist of edits in VW's tree, the FIT fixture sourcing, the dev-script that hot-swaps the transport, the CI gating).
  - `05-VERIFICATION.md`: the v1 acceptance evidence — VW PR URL, merged sha, CI run URLs, trainer-sim sha pinned by the PR.
  - No new files under `src/` or `test/` in trainer-sim. Every Phase 5 plan task that "writes code" writes that code in the VeloWorld repo, not here.
- **D-VW-08:** The trainer-sim git commit that VW pins MUST be the post-Phase-4 tip (or later) — it must contain `createFakeTransport` and the `ITrainerTransport`/`FakeTransport`/`FakeTransportConfig`/`FakeTransportSource` exports from `src/types.ts`. No new public API is added in Phase 5. If Phase 5 research surfaces a contract gap (e.g., VW needs a method trainer-sim doesn't yet ship), that triggers a contract-widening fix in trainer-sim BEFORE the VW PR pins a sha — Phase 5 then pins the post-fix sha. This is a deliberate one-way door: VW's needs reshape trainer-sim's contract, not vice versa (D-VW-05 + Anti-Pattern 6).

### Acceptance evidence (what proves Phase 5 done)
- **D-VW-09:** The 05-VERIFICATION.md acceptance bundle is the following five items, recorded after the VW PR merges green:
  1. VW PR URL (merged).
  2. VW CI run URL on macOS, status: success, Node 24.
  3. VW CI run URL on Linux, status: success, Node 24.
  4. The trainer-sim commit sha pinned by the merged PR's `package.json`.
  5. A short narrative: which VW E2E suite was run, what FIT fixture VW committed, what (if any) shape diffs the `ITrainerTransport` canonicalization surfaced, and how they were resolved (in trainer-sim's favor per D-VW-05).
  No screenshots of nRF Connect, no Auuki round-trip — those are Phase 1 artifacts. Phase 5's evidence is the merged-PR + green-CI bundle.
- **D-VW-10:** The phase is closeable even if VW's E2E surfaces a real bug in trainer-sim — *as long as the bug is fixed in trainer-sim, the trainer-sim sha pinned by the VW PR is bumped to the post-fix sha, and the VW PR re-runs green*. Phase 5 close = the post-fix end state, not "no bugs found". This is consistent with the Phase 4 close pattern (CR-01/02/03 fixed inline).

### Claude's Discretion
- **Plan decomposition strategy.** How many plans Phase 5 splits into (a single integration plan? one for VW reconnaissance + one for the PR + one for verification?), and which are wave-parallel vs strictly serial, is a planning decision left to `gsd-plan-phase`. The VW PR itself is sequential by nature (read VW → write VW → run VW CI), but the trainer-sim-side reconnaissance and the FIT fixture sourcing decisions can run in parallel with VW-repo recon.
- **Where the "hot-swap" mechanism lives in VW.** Whether VW gates the transport choice on an env var (`TRAINER=fake`), a build flag, a separate test entry point, or a DI factory inside VW's existing code — that's a VW-architecture call surfaced by phase research. trainer-sim's contract doesn't constrain it; any approach that lets VW's tests choose between BLE and FakeTransport works.
- **Whether VW's PR also updates the trainer-sim sha as a follow-up cycle.** If Phase 5 research surfaces a contract gap that triggers D-VW-08's "fix in trainer-sim first" path, the sequencing of (i) the trainer-sim fix commit, (ii) bumping the VW PR's sha pin, and (iii) re-running VW CI is a planning detail, not a context decision.
- **Whether `05-RESEARCH.md` accesses the VW repo via local clone, GitHub web UI, or `gh` CLI.** Operational; pick whatever the researcher agent is set up for.
- **Whether Phase 5's planner emits a single combined plan for "VW PR" or splits the in-VW edits into per-file plans.** Either approach satisfies the GSD plan structure; the planner agent decides based on task atomicity.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 5 binding requirements & scope
- `.planning/REQUIREMENTS.md` §VeloWorld Integration — VW-01, VW-02, VW-03 (the binding requirement contracts for this phase)
- `.planning/ROADMAP.md` §Phase 5 — goal, dependencies, success criteria, "cross-repo coordination" note (the trigger for this discussion)
- `.planning/PROJECT.md` §Active Requirements — "VeloWorld's dev/test build runs end-to-end against FakeTransport with a real FIT file — Phase 5"; §Out of Scope — "Bundled fixture FIT files — consumers bring their own"; §Constraints — TypeScript Node 24, MIT, dual ESM/CJS, macOS/Linux only for v1
- `.planning/STATE.md` — Phase 4 close confirmed (status: ready_to_plan, completed_phases: 4); outstanding Phase 2/3 advisory followups recorded as NOT in Phase 5 scope

### Phase 4 outputs (the contract Phase 5 validates against)
- `src/types.ts` — `ITrainerTransport`, `FakeTransport`, `FakeTransportConfig`, `FakeTransportSource`, `RideRecord`. The types VW imports from `trainer-sim` per D-VW-05. Read the JSDoc — it explicitly documents D-API-01 ("canonical definer"), D-API-02 (microtask boundary on `sendResistance`), D-API-13 (`'complete'` event lives on `FakeTransport`, not `ITrainerTransport`).
- `src/transport/fake-transport.ts` — `createFakeTransport` factory (267 LOC). The runtime artifact VW pins.
- `src/index.ts` — public surface map; the `export type { ITrainerTransport, ... }` line is what VW's `import type` resolves to.
- `.planning/phases/04-faketransport-public-api/04-CONTEXT.md` §Decisions — D-API-01 (canonical definer), D-API-02 (microtask), D-API-03 (no BLE-types in import graph), D-API-05 (source discriminated union — VW will use `{ path }` since VW commits its own FIT per D-VW-03), D-API-13 (event-emitter affordance lives on `FakeTransport` only)
- `.planning/phases/04-faketransport-public-api/04-CONTEXT.md` §Phase 5 Connection Point — the explicit hand-off note from Phase 4 to Phase 5 about contract-direction resolution
- `.planning/phases/04-faketransport-public-api/04-VERIFICATION.md` — Phase 4 close evidence (115/117 tests passing — 2 intentional opt-in skips); confirms the contract is stable enough to pin

### Phase 3 outputs (relevant via Phase 4)
- `src/replay/replay.ts` — `Replay` class. Phase 5 does not touch this directly, but VW's E2E exercises it through FakeTransport. The drift-corrected scheduler (Phase 3 D-REPL-01..06) is what makes "yields power and cadence values across the full ride" deterministic.

### Phase 2 outputs (relevant via Phase 4)
- `src/fit/loader.ts` — `loadFitFromPath` + `loadFitFromBuffer`. VW's E2E hits `loadFitFromPath` because VW commits a path-shaped fixture per D-VW-03.
- `src/fit/errors.ts` — `FitLoadError` family. If VW's CI hits one, it bubbles through `connect()` (Phase 4 D-API-04) and surfaces in VW's E2E test output unmodified.

### Phase 1 outputs (relevant via Phase 4)
- `src/ftms/indoor-bike-data.ts` — `encodeIndoorBikeData`. The wire bytes VW's existing FTMS decoder consumes. VW-02 is provable because Phase 1 gated correctness on a hand-rolled spec-cited MIT decoder + hand-computed byte fixtures + nRF Connect manual verification (REQUIREMENTS.md FTMS-05a/b/c).

### Architecture & stack research (the "why" behind the discussion locks)
- `.planning/research/ARCHITECTURE.md` §Pattern 4 — "Define `ITrainerTransport` here" (canonical definer)
- `.planning/research/ARCHITECTURE.md` §Anti-Pattern 6 — "don't define `ITrainerTransport` in consumer" (the rule that drives D-VW-05's "trainer-sim's favor on shape diffs")
- `.planning/research/PITFALLS.md` §12 — `sendResistance` async semantics (microtask boundary in Fake) — VW's E2E indirectly verifies this works because VW awaits sendResistance the same way it awaits a real Bleno send
- `.planning/research/PITFALLS.md` §13 — BLE types must not leak into `ITrainerTransport`'s import graph — relevant because VW removing its internal interface and importing trainer-sim's would surface any leak; D-API-03's grep gate caught this in Phase 4

### CI infrastructure (trainer-sim side — unchanged in Phase 5)
- `.github/workflows/ci.yml` — macOS + Ubuntu matrix on Node 24, fail-fast: false (so a macOS-only failure doesn't mask Linux). Phase 5 adds NOTHING here per D-VW-06.

### Cross-repo references (read during 05-RESEARCH.md)
- VeloWorld repository (lives outside this monorepo) — phase research is the right step to enumerate exact paths inside VW. Researcher agent fetches: VW's current transport interface declaration, VW's existing E2E suite entry point, VW's CI workflow, VW's `package.json`. trainer-sim does NOT clone or vendor any of these.

### State & followups
- `.planning/STATE.md` §Blockers/Concerns — explicitly lists "Phase 5: VeloWorld lives in a separate repo; integration-test form to be decided in plan-phase" — this discussion resolves it.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`createFakeTransport` (src/transport/fake-transport.ts)** — the runtime artifact VW pins. VW's E2E swap path is `createFakeTransport({ path: 'test/fixtures/short-ride.fit' })` (D-VW-03 + Phase 4 D-API-05 `{ path }` source variant) → assign that as the transport in VW's existing test wiring → run VW's E2E unchanged.
- **`ITrainerTransport` type (src/types.ts)** — the type VW imports per D-VW-05. The `verbatimModuleSyntax: true` setting in trainer-sim's tsconfig means VW must use `import type` — runtime `import { ITrainerTransport }` would be a TS error on the VW side.
- **`FakeTransport` type (src/types.ts)** — wider than `ITrainerTransport`. VW only narrows to `FakeTransport` if it wants the `'complete'` event hook or the `received.resistance` log; the bare `ITrainerTransport` type is sufficient for the existing ride-scene/physics consumers (which is what VW-01 specifically asserts is "unchanged").

### Established Patterns
- **`.js` extensions on relative imports** — VW's import path will be `import type { ITrainerTransport } from 'trainer-sim'` (bare specifier — picked up via `package.json` `exports` map). No relative-path concern; the .js extension convention is internal to trainer-sim.
- **Dual ESM/CJS publish via `package.json` exports map** — VW will resolve to `dist/index.js` (ESM) or `dist/index.cjs` (CJS) automatically based on its own module type. Phase 1 wired this; Phase 4's `publish.test.ts` validates it on every trainer-sim build. VW gets it for free via the git-ref install.
- **Strict-mode TS Node 24, no `@types/*` shim** (API-08 from Phase 4) — VW's tsconfig with strict-mode resolves trainer-sim's types out of the box from `dist/index.d.ts` (ESM) / `dist/index.d.cts` (CJS). Verified by Phase 4's `attw` step.

### Integration Points
- **VW's `package.json`** — gets one new `devDependencies` entry per D-VW-04. The git-ref form `github:VeloWorld/trainer-sim#<sha>` is npm-resolvable on GitHub Actions macOS + Linux runners without extra setup.
- **VW's transport-selection wiring** — wherever VW today decides "real BLE transport vs mock for tests", that's the seam where `createFakeTransport(...)` is plugged in. The exact location is VW-architecture-internal and surfaces during 05-RESEARCH.md.
- **VW's existing internal `ITrainerTransport`-like declaration** — gets deleted per D-VW-05; replaced with the `import type { ITrainerTransport } from 'trainer-sim'`. Any consumer code that referenced VW's internal type by name keeps working unchanged because the names match (`ITrainerTransport`); shape diffs (if any) get resolved in trainer-sim's favor per D-VW-05.
- **VW's CI workflow** — gets either no edits (if VW's existing E2E job already runs the suite that exercises FakeTransport) or one new step / one new env var. The macOS+Linux matrix already exists in VW (per phase goal "CI runs the VeloWorld E2E suite green on both macOS and Linux"); Phase 5 doesn't add platforms, only adds the FakeTransport-driven entry point.
- **VW's FIT fixture path** — new file under VW's `test/fixtures/` (D-VW-03). trainer-sim's Phase 2 fixture set (`test/fixtures/fit/{basic,autopause,shadow,perf-1hr}.fit`) is NOT shared with VW (PROJECT.md "consumers bring their own"); VW makes its own.

### Non-edits (what Phase 5 explicitly does NOT change in trainer-sim)
- `package.json` — no version bump in Phase 5. v1.x npm publish is post-Phase-5.
- `tsup.config.ts` — no change. The v2 forward-shape comment for `./bleno` stays as-is.
- `src/types.ts` — no new type added in Phase 5. Phase 4's contract is the contract VW pins. If a contract gap surfaces, it's a contract-widening fix per D-VW-08, not a Phase 5 deliverable per se.
- `src/index.ts` — no new export. Same rationale.
- `.github/workflows/ci.yml` — explicitly not modified per D-VW-06.
- `test/` — no new test files in trainer-sim. The proving runs in VW's CI.

</code_context>

<specifics>
## Specific Ideas

- **The git-ref pin is the immutable evidence trail.** Once VW's `package.json` commits `github:VeloWorld/trainer-sim#<sha>`, the trainer-sim sha is locked into VW's git history. Anyone reading VW years later can `git show` that sha and see exactly the trainer-sim source code VW v1 was validated against. This is the "no published artifact yet" workaround that's actually more durable than an npm version.
- **Sha pin sequencing is a one-way door** (D-VW-08): if Phase 5 finds a real bug, fix lands in trainer-sim first → trainer-sim sha advances → VW PR's sha pin advances → VW CI re-runs green. The reverse direction (widening trainer-sim's contract to absorb a VW shape that doesn't conform to D-VW-05) is forbidden by ARCHITECTURE.md Anti-Pattern 6.
- **Phase 5 "done" is the merged-PR + green-CI bundle, not the absence of bugs.** Mirrors Phase 4's close pattern (CR-01/02/03 fixed inline before close). The acceptance gate is "the post-fix end state is green," not "no fix was needed."
- **The full-VW-E2E choice (D-VW-02) is what makes VW-01 provable.** A seam-only test would have proven the decoder side but left "no edits to ride scene or physics" unverified. Running VW's existing top-level E2E suite is the only way to demonstrate that ride-scene and physics code is unchanged — those layers exist above the decoder and only run when the full E2E runs.
- **VW's FIT fixture at ~30s–2min is small enough for CI but long enough to surface real-FIT shape concerns** (autopause gaps, sparse smart-recording, optional null power) that Phase 2's loader was specifically hardened against (FIT-04, FIT-05). This is the same fixture posture that makes VW's CI honest about real-world FIT files without the multi-MB overhead of a 1-hour ride.

</specifics>

<deferred>
## Deferred Ideas

- **npm publish of trainer-sim 0.1.0+** — v1.x. After Phase 5 closes (v1 done), publish to npm and replace VW's git-ref dep with a real version. This is the natural successor to D-VW-04 but explicitly NOT in Phase 5 scope.
- **VW's E2E split into seam-only fast tier + full E2E nightly tier** — considered as the "hybrid" option in Area 2 of discussion; rejected for Phase 5 in favor of the simpler full-E2E-every-build (D-VW-02). If VW's full E2E becomes a CI bottleneck post-Phase-5, splitting tiers is a VW-side optimization, not a trainer-sim concern.
- **trainer-sim CI smoke job that mirrors a slice of VW's E2E** — explicitly rejected as D-VW-06's alternative. Reintroduces the in-tree-harness coupling. Not deferred to a later phase; this is permanent rejection.
- **TEST_FIT_DIR opt-in for VW's E2E** — Phase 2 uses this pattern for trainer-sim's local-dev tests. Considered for VW in Area 3; rejected because VW's CI needs a deterministic committed fixture (D-VW-03). VW could add a TEST_FIT_DIR opt-in for local-dev FIT exploration as a follow-up, but it's not Phase 5 work.
- **Local tarball install (`npm pack` → committed `.tgz` in VW)** — considered as the alternative to git-ref in Area 4a; rejected as heavier ops without v1 benefit. If GitHub goes down or VW needs offline CI, revisit; otherwise leave deferred.
- **Synthesized minimal FIT from Phase 2's scrubber** — considered as the alternative to a real-stripped fixture in Area 3; rejected because it borders on "synthetic data" which PROJECT.md/REQUIREMENTS.md explicitly rule out.
- **Structural-typing-only validation (without the canonicalization migration)** — considered as the alternative to D-VW-05; rejected because it defers Phase 4 D-API-01's promise. The hybrid type-test variant was also considered and rejected for the same reason.
- **Phase 2 advisory followups** (WR-01 signed-shift on dataLength for ≥2GB files; WR-03 records lacking timestamp silently dropped; WR-05 CRC-16/ARC table duplicated) — loader-internal; don't surface through VW's E2E; carry past v1 close per STATE.md.
- **Phase 3 advisory followups** (WR-02 currentState async transition not documented; WR-04 config "frozen" claim without Object.freeze; WR-05 Replay.start input validation already folded into Phase 4 D-API-25) — same disposition; remaining items don't block VW E2E.
- **`@stoprocent/bleno` PROJECT.md update** (Phase 1 / Phase 4 carry-forward) — handle at milestone close, not as Phase 5 work.
- **`received.controlPoint[]` for v2 GATT FMCP opcodes** — Phase 4 D-API-16 explicitly defers this to v2. VW's E2E in Phase 5 only uses `received.resistance` (echo-only), so the absence of `controlPoint` does not surface.
- **CLI (`trainer-sim play`)** — v2; gated on BlenoTransport. PROJECT.md / REQUIREMENTS.md.
- **Heart rate / speed FTMS fields** — v2 (REQUIREMENTS.md FTMS-06, FTMS-07).

</deferred>

---

*Phase: 05-veloworld-end-to-end-validation*
*Context gathered: 2026-05-16*
