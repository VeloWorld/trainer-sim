---
phase: 05-veloworld-end-to-end-validation
plan: 02
status: blocked-replan-required
discovered: 2026-05-18
---

# Plan 05-02 Deviations — Replan Required

Plan 05-02 was attempted in interactive mode on 2026-05-18 and aborted at Task 1 sub-step B (lockfile regen) and the subsequent "no other consumers" grep audit. Two material gaps in the plan's research / context blocks were discovered. Both require the plan to be re-cut before execution can resume.

## Gap 1 — pnpm 10 strict-mode `onlyBuiltDependencies` allowlist

**Symptom.** First `pnpm install` in VW after pinning the trainer-sim git-ref errored:

```
ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED Failed to prepare git-hosted package fetched from "git@github.com:VeloWorld/trainer-sim.git": The git-hosted package "trainer-sim@0.0.1" needs to execute build scripts but is not in the "onlyBuiltDependencies" allowlist.
```

**Root cause.** VW is on pnpm 10.33.0 (per root `package.json`'s `packageManager`). pnpm 10's strict mode blocks lifecycle scripts (`prepare`, `postinstall`, etc.) for any dependency not explicitly listed in `pnpm.onlyBuiltDependencies` (root `package.json`) — see VW's existing entry: `"onlyBuiltDependencies": ["electron", "esbuild"]`. trainer-sim's Wave 0 `prepare` hook (which materializes `dist/` for git-ref consumers) is the entire point of Plan 05-01, but pnpm 10 silently refuses to run it without consumer opt-in.

**Fix.** Add `"trainer-sim"` to VW's root `package.json` `pnpm.onlyBuiltDependencies` list:

```jsonc
"pnpm": {
  "onlyBuiltDependencies": ["electron", "esbuild", "trainer-sim"]
}
```

Verified locally during the aborted attempt: with this one-line addition, `pnpm install` ran the `prepare` hook on consumer install, producing all 4 dual-publish artifacts (`dist/index.{js,cjs,d.ts,d.cts}`) inside `apps/desktop/node_modules/trainer-sim/dist/`. The lockfile recorded 5 `VeloWorld/trainer-sim` entries.

**Plan-impact.**

- Add `/Users/agniveshpatel/dev/agni21/veloworld-ride/package.json` (root, NOT `apps/desktop/package.json`) to Plan 05-02's `files_modified` list.
- Add a Task 1 sub-step "B0" before sub-step B: edit root `package.json` to extend `pnpm.onlyBuiltDependencies` with `"trainer-sim"`.
- Add an acceptance criterion: `grep -c '"trainer-sim"' /Users/agniveshpatel/dev/agni21/veloworld-ride/package.json` is at least `1`.
- The threat model should explicitly call out: pnpm 10 strict-mode is the consumer's defense against runaway git-ref `prepare` hooks; allowlisting trainer-sim is a documented opt-in (the trust-boundary tax already accepted in Plan 05-01's threat register T-05-01-01 / T-05-01-05).

## Gap 2 — `dev-mode-save-flow.test.ts` integration coupling

**Symptom.** Plan 05-02's `<vw_repo_paths>` block lists `apps/desktop/src/renderer/src/lib/__tests__/dev/dev-mode-save-flow.test.ts` under "Files NOT to touch". A pre-execution audit (`grep -rln 'dev/fit-loader\|dev/replay-scheduler' apps/desktop/src/`) revealed it as the 4th consumer of the modules the plan deletes — not just `fake-trainer-transport.test.ts` as the plan claims.

**Root cause.** This is VW Phase 10's CR-01..CR-04 regression integration test. Its lines 49, 64, 90, 105, 143, 150 reference both deleted modules:

```text
49: import type { RideRecord } from '../../dev/replay-scheduler';
64: mockLoadFitFromBytes,                       // hoisted mock symbol
90: mockLoadFitFromBytes: vi.fn(),
105: vi.mock('../../dev/fit-loader', () => ({   // direct path mock
106:   loadFitFromBytes: mockLoadFitFromBytes,
107: }));
143: mockLoadFitFromBytes.mockReset();
150: mockLoadFitFromBytes.mockResolvedValue(SAMPLE_RECORDS);
```

The test also asserts behaviors that disappear with the adapter rewrite:

- `vi.advanceTimersByTime(5000)` triggers natural-exhaustion through VW's vendored `ReplayScheduler` (gone). trainer-sim's `'complete'` event semantics differ — the test's `expect(handlerSpy).toHaveBeenCalledTimes(2)` and `expect(unsubSpy).toHaveBeenCalledTimes(1)` assertions need to be reconciled with trainer-sim's emitter-based completion path.
- `expect(disconnectedCalls).toHaveLength(1)` (line 254) asserts the natural-exhaustion onComplete callback fires `setSensorState('trainer', 'disconnected')` exactly once. The current adapter does NOT wire `'complete'` → `'disconnected'`; that wiring would need to be added in Task 2's adapter rewrite (the rideStateUnsub teardown plan covers part of CR-03 but not the explicit disconnected-transition CR-04).
- The test asserts the adapter's private `teardownReplay()` semantics by observing side effects. After the rewrite, the equivalent method is `teardown()` — naming-only, but the side effects must be preserved.

**Plan-impact (much larger than Gap 1).**

- Add `/Users/agniveshpatel/dev/agni21/veloworld-ride/apps/desktop/src/renderer/src/lib/__tests__/dev/dev-mode-save-flow.test.ts` to Plan 05-02's `files_modified` list and remove it from the "do not touch" list.
- Add a 4th task (or expand Task 3) covering the integration test rewrite. The rewrite must:
  1. Replace `import type { RideRecord } from '../../dev/replay-scheduler'` with `import type { RideRecord } from 'trainer-sim'` (verify trainer-sim exports `RideRecord` at the package root — it does, per Phase 4's `src/index.ts`).
  2. Replace `vi.mock('../../dev/fit-loader', ...)` with `vi.mock('trainer-sim', ...)` mocking `createFakeTransport` (NOT `loadFitFromBytes`, which doesn't exist in VW anymore).
  3. Replace the natural-exhaustion timer mechanism. Two options:
     - Drive the inner `FakeTransport`'s emitter directly from the mock (capture the `'complete'` listener, fire it manually). Cleanest test boundary; doesn't depend on trainer-sim's real timer behavior.
     - Use the real `createFakeTransport` (no mock) and let trainer-sim's scheduler drive completion through `vi.advanceTimersByTime`. More integrated, but requires trainer-sim's `node:timers/promises` `sleep` injection seam to be reachable — which works in Vitest 4 only via the surgical seam Phase 3 added; verify this path.
  4. Adjust the adapter rewrite (Plan 05-02 Task 2) to wire `'complete'` → `setSensorState('trainer', 'disconnected')` so CR-04 still passes. Currently Task 2 omits this; the adapter just disconnects on rideState transitions.
- The plan's `<verification>` block is wrong about `git diff --name-only HEAD~1 HEAD` listing exactly 9 files; the count is 11 (added: VW root `package.json`, integration test).
- Threat-model entry for Path-A pause/resume (`T-05-02-05`) is unaffected, but a new entry should cover the natural-exhaustion CR-04 path: trainer-sim's `'complete'` event MUST be wired through to VW's `setSensorState('trainer', 'disconnected')` or the integration test CR-04 assertion fires a regression.

## Recommended replan path

```
/gsd-plan-phase 05 --plan 02 --replan
```

The replan should:

1. Fold both gaps into the plan's `<context>`, `<vw_repo_paths>`, `files_modified`, `<tasks>`, `<verification>`, and `<threat_model>` blocks.
2. Add a Pitfall section ("pnpm 10 strict-mode + git-ref prepare hooks") to RESEARCH.md so the gap doesn't re-surface in future trainer-sim consumer integrations.
3. Either:
   - Expand the integration-test rewrite to a full 4th task (Task 3.5 or shifted to Task 4) with its own acceptance criteria, OR
   - Treat `dev-mode-save-flow.test.ts` as a dependent integration that needs adapter `'complete'` → `disconnected` wiring (Task 2 amendment) plus mock-target updates (Task 3 amendment).
4. Re-run `gsd-plan-checker` (the plan-quality reviewer) on the replanned 05-02 — it should have caught the "files not to touch" lie via a `grep` cross-check.

## Rollback applied

VW repo state on 2026-05-18 19:48 IST:

```
$ cd /Users/agniveshpatel/dev/agni21/veloworld-ride
$ git checkout -- apps/desktop/package.json package.json pnpm-lock.yaml
$ git checkout main && git branch -D feat/phase-5-trainer-sim-canonical
Switched to branch 'main' (cd342f9 — same as origin/main)
Deleted branch feat/phase-5-trainer-sim-canonical (was cd342f9).
$ git status
nothing to commit, working tree clean
```

trainer-sim Wave 0 commits on `main` (`e2479c9`, `768d6eb`, `6afd1d8`, `7550e0b`) are intact and pushed. Plan 05-01 is genuinely complete; only Plan 05-02 needs replanning.

## Status of this phase's task list

| Plan | Status | Blocker |
|------|--------|---------|
| 05-01 | ✓ complete | — |
| 05-02 | blocked | this memo |
| 05-03 | blocked | depends on 05-02 |
| 05-04 | blocked | depends on 05-03 |
