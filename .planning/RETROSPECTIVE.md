# Retrospective: trainer-sim

Living document. Each milestone appends a new section. Cross-milestone trends grow at the bottom.

---

## Milestone: v0.1.0 — FakeTransport MVP

**Shipped:** 2026-05-19
**Phases:** 5 | **Plans:** 24 | **Tasks:** 36 | **Requirements:** 29/29 satisfied

### What Was Built

A standalone Node.js + TypeScript library that impersonates a BLE FTMS smart trainer in-process by replaying real Garmin/Wahoo FIT files. Public surface: `createFakeTransport(config)` returning an `ITrainerTransport`-shaped object. Vendored FTMS IndoorBikeData encoder, FIT loader (path or Buffer) producing a normalized `RideRecord[]`, drift-corrected replay engine, dual ESM/CJS publish with browser-renderer support. VeloWorld consumes via git-ref pin; cross-platform CI green on macOS + Linux Node 24.

### What Worked

- **Bottom-up linear roadmap (encoder → loader → engine → transport → e2e).** Each phase exercised the layer below it, so regressions surfaced locally instead of at the integration gate. Phase 5 was a thin verification phase, not a debugging marathon.
- **Three-gate FTMS encoder verification.** Spec-cited hand-rolled MIT decoder + hand-computed byte fixtures + nRF Connect manual check. Caught FTMS encoding traps (sint16 sign, half-rpm, inverted bit-0, little-endian) at unit-test time, not at integration.
- **`FitRecordSource` seam.** Wrapping the FIT parser behind a single seam meant the eventual library swap (or Garmin SDK migration) is a one-file change. Same posture for `_internal/*` shims when browser support landed in Phase 5.
- **Audit-before-close discipline.** Running `/gsd-audit-milestone` first surfaced four documentation drifts (ROADMAP checkboxes, REQUIREMENTS traceability, STATE frontmatter, SUMMARY frontmatter sparsity) that would have shipped silently otherwise.

### What Was Inefficient

- **`audit-open` SDK scanner false-positive on quick task `260519-ub8`.** SUMMARY.md is in fact present and well-formed; scanner reports `missing`. Ate cycles diagnosing a non-issue. Worth filing against the SDK.
- **`milestone.complete` accomplishment auto-extraction was noisy.** Pulled in low-quality one-liners ("Failure.", "complete", "Outcome: identical.") because phase SUMMARY.md frontmatter `one_liner` slots weren't curated. Required manual rewrite of MILESTONES.md.
- **Phase 5 build infrastructure thrash (Wave-0 × 4 revisions).** VW's Vite-bundled Electron renderer surfaced four cumulative gaps (dist/ tracked, dual Node+browser tsup builds, `_internal/*` shim layer, Buffer→DataView migration). Each revision discovered the next, none caught upfront. Phase research did not exercise the renderer-bundle path.
- **`dist/` tracked in git.** Necessary for git-ref consumers but introduces staleness drift if a developer rebuilds without committing. Carried as v1.x tech debt; revisit at npm-publish boundary.

### Patterns Established

- **Acceptance-bundle phase verification.** Phase 5 closed on a 5-item D-VW-09 acceptance bundle (cross-repo PR sha, both CI runs green, file-list shows consumer code unchanged, prod-bundle grep gate clean, lockfile pin matches). Higher signal than checkbox-only verification.
- **Typed error hierarchies for I/O boundaries.** `FitLoadError` + 4 concrete leaves (D-FIT-06) made loader failure modes test-grippable and consumer-friendly. Apply to v2 BLE peripheral surface.
- **Sleep-injection seam for fake-timer testability.** Vitest 4 cannot intercept `node:timers/promises` ESM bindings; surgical `sleep?` injection seam in scheduler/replay kept production path unchanged while letting tests run under `vi.useFakeTimers()`.
- **Single-line-edit release commits.** `chore(release): v0.1.0` touched only `package.json` + `CHANGELOG.md` + `README.md` (explicit paths, no `-A`). Tag-pointed snapshot is self-contained.

### Key Lessons

- **Browser/renderer support is not a flag — it's a build target.** When the consumer is a Vite-bundled Electron renderer, Node-only primitives (`Buffer`, `node:util.debuglog`, `node:events.EventEmitter`, `node:fs`) all need browser variants. Plan for it at Phase 0, not Phase 5.
- **Audit-then-close beats close-then-audit.** Running `/gsd-audit-milestone` before `/gsd-complete-milestone` surfaced documentation drift that would otherwise have been frozen into the milestone archive.
- **Three-gate verification is worth the upfront cost** for any silent-failure surface (byte-level encoders, BLE protocols, drift-corrected schedulers). Two of the three gates are cheap (round-trip + hand fixtures); the third (manual nRF Connect / soak) is the expensive one but catches the spec mis-reads the cheap ones can't.
- **Cross-repo integration discovers contract gaps.** trainer-sim's `ITrainerTransport` did not widen during Phase 5, but build infrastructure thrashed four times. The contract was right; the packaging wasn't. Treat the cross-repo PR cycle as the integration test, not the unit tests.

### Cost Observations

- Total plans: 24 across 5 phases. Phase 5 (3 plans + 1 verification) consumed ~33% of plan effort due to Wave-0 build-infra iterations.
- `/gsd-quick` used for the v0.1.0 release task (260519-ub8) — single atomic commit + tag. Right tool for the job.

---

## Cross-Milestone Trends

*(Will populate from v0.2.0 onward.)*

| Milestone | Phases | Plans | Days | Notable |
|-----------|--------|-------|------|---------|
| v0.1.0 FakeTransport MVP | 5 | 24 | ~7 | First release; cross-repo VW integration; browser/renderer support added in Phase 5 |

---
*Living document. Append a new milestone section at each `/gsd-complete-milestone`.*
