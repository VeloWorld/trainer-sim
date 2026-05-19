# Phase 5: VeloWorld End-to-End Validation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-16
**Phase:** 05-veloworld-end-to-end-validation
**Areas discussed:** Integration test form, VeloWorld surface depth, FIT fixture sourcing, Cross-repo install + interface reconciliation, trainer-sim CI vs VW CI gating

---

## Integration test form

| Option | Description | Selected |
|--------|-------------|----------|
| In-tree harness in trainer-sim | A test inside trainer-sim that imports a vendored copy of VW's FTMS-decoder + ride-loop logic and asserts power/cadence values across a full FIT replay. Self-contained CI; no VW write access needed. Risk: harness drifts from real VW; passing here doesn't prove VW build runs clean. | |
| Coordinated PR against VeloWorld | A PR in the VeloWorld repo that switches VW's test/dev build to install trainer-sim (git ref or tarball) and runs VW's existing E2E suite green against FakeTransport. Actually proves VW-01..03 against real VW; requires cross-repo coordination. | ✓ |
| Both — in-tree harness + coordinated VW PR | Land in-tree first for fast feedback, then a VW PR as the v1-done gate. Two artifacts; risks the in-tree becoming the de facto check and the VW PR slipping. | |

**User's choice:** Coordinated PR against VeloWorld
**Notes:** Drives D-VW-01. The in-tree-harness option was decisively rejected — passing in-tree does not prove VW actually consumes the contract, which is exactly what VW-01..03 require.

---

## VeloWorld surface depth

| Option | Description | Selected |
|--------|-------------|----------|
| Full VW E2E — ride scene + physics + decoder | Run VW's existing top-level E2E test with FakeTransport swapped in for the BLE transport. Asserts the entire ride pipeline consumes the FIT-driven signal correctly. Highest fidelity; proves VW-01's "no edits to ride scene or physics code". | ✓ |
| Transport + decoder seam only | A new minimal VW test that imports VW's FTMS decoder, wires it to FakeTransport's onData, asserts decoded power/cadence across the full ride. Cheaper PR, faster CI; doesn't prove VW-01's "unchanged ride scene/physics" claim. | |
| Both — minimal seam + opt-in full E2E | Fast seam test every CI build + opt-in full E2E nightly. Hybrid; more moving parts in the PR. | |

**User's choice:** Full VW E2E — ride scene + physics + decoder
**Notes:** Drives D-VW-02. Full E2E is what makes VW-01's "unchanged ride scene/physics" claim provable — those layers exist above the decoder and only run when the full E2E runs. Hybrid recorded as a deferred VW-side optimization in Deferred Ideas.

---

## FIT fixture sourcing

| Option | Description | Selected |
|--------|-------------|----------|
| VW commits a small real FIT fixture in its own repo | VW supplies its own committed FIT (e.g., test/fixtures/short-ride.fit, ~30s–2min stripped from a real Garmin/Wahoo export). Honors PROJECT.md "consumers bring their own". trainer-sim ships nothing FIT-related for VW. | ✓ |
| VW uses TEST_FIT_DIR opt-in (Phase 2 pattern) | VW's E2E reads from an env-var-pointed local path; CI provides fixture via repo asset or download step. No FIT committed in VW. Heavier ops; mirrors trainer-sim's Phase 2 dev pattern. | |
| VW commits a synthesized minimal FIT | VW commits a tiny generated/scrubbed FIT (Phase 2 scrubber output). Smallest committed bytes; deterministic. But verges on "synthetic data" which PROJECT.md/REQUIREMENTS.md explicitly rule out. | |

**User's choice:** VW commits a small real FIT fixture in its own repo
**Notes:** Drives D-VW-03. Real-stripped fixture preserves real ride dynamics (autopause, sparse smart-recording, optional null power) which Phase 2's loader is specifically hardened against. Synthesized minimal FIT was correctly identified as too close to "synthetic data".

---

## Cross-repo install (Area 4a)

| Option | Description | Selected |
|--------|-------------|----------|
| Git ref dependency (`github:agni21/trainer-sim#<sha>`) | VW's package.json points at a specific trainer-sim commit. No publish needed. Reproducible (sha pin). Works on macOS+Linux GitHub Actions runners. Updating trainer-sim from VW = bump the sha. | ✓ |
| Local file: dependency + npm pack tarball | trainer-sim runs `npm pack`, VW depends on `file:./vendor/trainer-sim-0.0.1.tgz` (committed). Maximally reproducible; CI fully offline. Cons: committed binary, manual bump cycle. | |
| Publish to npm (even as 0.0.x prerelease) | Bump trainer-sim to 0.1.0 / 0.0.2-beta.0, publish to npm, VW depends normally. Cleanest long-term. But PROJECT.md gates v1 on Phase 5 passing — publishing 0.x before validation is awkward. | |

**User's choice:** Git ref dependency
**Notes:** Drives D-VW-04. The git-ref pin is the immutable evidence trail — the trainer-sim sha is locked into VW's git history; anyone reading VW years later can `git show` that sha and see the exact source code v1 was validated against. npm publish becomes a v1.x successor (deferred).

---

## ITrainerTransport reconciliation in VeloWorld (Area 4b)

| Option | Description | Selected |
|--------|-------------|----------|
| Phase 5 PR also switches VW to `import type { ITrainerTransport } from 'trainer-sim'` | The PR replaces VW's internal interface declaration with the trainer-sim import. D-API-01 fully realized. Bigger PR; may surface real shape mismatches that Phase 5 then resolves in trainer-sim's favor (Anti-Pattern 6). | ✓ |
| Phase 5 PR validates against VW's existing shape; canonicalization is a follow-up | Only proves FakeTransport's runtime shape satisfies VW's existing interface (structural typing wins). VW's interface declaration stays in VW. Smallest PR; defers D-API-01. | |
| Hybrid — type-test that VW's interface is structurally assignable to trainer-sim's | TS type-test that fails at compile time on shape drift; doesn't delete VW's declaration. Splits the difference. | |

**User's choice:** Phase 5 PR also switches VW to `import type { ITrainerTransport } from 'trainer-sim'`
**Notes:** Drives D-VW-05. Realizes Phase 4 D-API-01's promise. Shape diffs (if any) resolve in trainer-sim's favor per ARCHITECTURE.md Anti-Pattern 6. Structural-only and hybrid options were both correctly rejected as deferring the canonicalization Phase 4 already committed to.

---

## trainer-sim CI vs VW CI gating

| Option | Description | Selected |
|--------|-------------|----------|
| trainer-sim CI stays independent; Phase 5 done = VW PR merged green | trainer-sim CI keeps doing what it does today (build + unit + publint + attw on macOS+Linux). Phase 5 done is a manual gate: VW PR merged with green CI. Artifact: link to merged VW PR + CI URL. trainer-sim never has to know VW exists in CI. | ✓ |
| trainer-sim CI gains a smoke job that mirrors a slice of VW's E2E | trainer-sim CI clones a known-good VW commit, runs just enough of VW's E2E to catch contract drift. Catches breaks before consumers do; ties trainer-sim CI to VW repo state. | |
| Phase 5 deliverable is purely cross-repo — no trainer-sim CI changes | trainer-sim CI unchanged. Phase 5's only artifact in trainer-sim is docs (CONTEXT/RESEARCH/PLAN/VERIFICATION). The actual proving runs in VW's CI on the merged PR. | |

**User's choice:** trainer-sim CI stays independent; Phase 5 done = VW PR merged green
**Notes:** Drives D-VW-06. The mirroring-smoke-job option was rejected as effectively reintroducing the in-tree-harness coupling that was already rejected in Area 1. Note the chosen option is functionally close to "purely cross-repo" — both leave trainer-sim CI alone — but the chosen option's framing ("VW PR merged green") is the operative completion gate; it folds D-VW-09's evidence bundle (PR URL + 2 CI URLs + sha + narrative) into the close criterion.

---

## Claude's Discretion

- Plan decomposition strategy for Phase 5 — number of plans, wave parallelism between trainer-sim-side recon and VW-repo recon — left to gsd-plan-phase.
- Where in VeloWorld the "hot-swap" mechanism lives (env var? build flag? DI factory?) — VW-architecture-internal; surfaces during 05-RESEARCH.md.
- Sequencing of trainer-sim fix → sha bump → VW CI re-run if a contract gap surfaces (D-VW-08 path) — planning detail.
- Operational mechanism researcher uses to read VW (local clone vs gh CLI vs GitHub web) — pick whatever the agent is configured for.
- Single combined "VW PR" plan vs per-file split inside VW — planner agent decides.

## Deferred Ideas

- npm publish of trainer-sim 0.1.0+ (v1.x; natural successor to D-VW-04 after Phase 5 closes).
- VW's E2E split into seam-only fast tier + full E2E nightly tier (VW-side optimization if full E2E becomes a CI bottleneck post-Phase-5).
- trainer-sim CI smoke job mirroring VW's E2E — permanent rejection, not deferred.
- TEST_FIT_DIR opt-in for VW's local-dev FIT exploration (post-Phase-5; not blocking).
- Local tarball install — only revisit if GitHub goes down or VW needs offline CI.
- Synthesized minimal FIT — permanent rejection per PROJECT.md/REQUIREMENTS.md.
- Structural-typing-only / hybrid-type-test reconciliation — rejected; the canonicalization happens in Phase 5.
- Phase 2 / Phase 3 advisory followups — carry past v1 close per STATE.md; don't surface through VW's E2E.
- `@stoprocent/bleno` PROJECT.md update — handle at milestone close.
- v2 concerns: `received.controlPoint[]`, BlenoTransport, CLI, HR/speed FTMS fields — all gated on v2.
