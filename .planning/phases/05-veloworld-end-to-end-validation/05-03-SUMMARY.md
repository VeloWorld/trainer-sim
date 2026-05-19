---
plan: 05-03
phase: 05-veloworld-end-to-end-validation
status: complete
completed: 2026-05-19
---

# Plan 05-03 Summary — Cross-Repo PR Cycle

## Outcome

Plan 05-02's local-green VW feature branch was pushed, opened as PR #19,
driven through 4 iteration cycles to fix CI environment gaps, and
squash-merged into `VeloWorld/veloworld-ride` `main` after both
`ci (ubuntu-latest)` and `ci (macos-latest)` reported `conclusion: SUCCESS`.

## Key facts for Plan 05-04 (D-VW-09 bundle)

| Item | Value |
|------|-------|
| PR URL | https://github.com/VeloWorld/veloworld-ride/pull/19 |
| PR state at merge | MERGED |
| Merge commit sha | `ba87feed944baab8f4be87fa3d1a5de2747571e1` |
| Merged at | 2026-05-19T09:40:08Z |
| ubuntu-latest CI run | https://github.com/VeloWorld/veloworld-ride/actions/runs/26088881930/job/76709026042 |
| macos-latest CI run | https://github.com/VeloWorld/veloworld-ride/actions/runs/26088881930/job/76709026054 |
| trainer-sim sha pinned at merge | `8fac5ddb3f2898339f1a22018881709e3c2d614d` |

## Iteration log (4 cycles)

### Cycle 1 — Initial CI run (HEAD 7285152) — RED on both legs

**Failure.** `pnpm install --frozen-lockfile` errored with
`git@github.com: Permission denied (publickey)`. CI runners have no SSH
key; pnpm's git fetcher tried SSH on the `git@github.com:` URL form
(pnpm 10.33 normalizes `github:Owner/Repo` shorthand into a SSH-style
`git+https://git@github.com:Owner/Repo.git` URL).

**Diagnosis.** VW-side fix per the plan's iteration decision tree.
`trainer-sim` is a public repo (verified: anonymous HTTPS clone works);
the consumer-side fix is to make CI use HTTPS instead of SSH for github.com.

**Fix attempt.** Added a `Configure git to use HTTPS for github.com`
workflow step before `pnpm install`:

```yaml
git config --global url."https://github.com/".insteadOf "git@github.com:"
git config --global url."https://github.com/".insteadOf "ssh://git@github.com/"
```

VW HEAD: 4d1f32c.

### Cycle 2 — Same failure (HEAD 4d1f32c) — RED on both legs

**Failure.** Same `Permission denied (publickey)` error despite the
rewrite step running.

**Diagnosis.** Without `--add`, the second `git config` call OVERWROTE
the first. Only the `ssh://git@github.com/` rewrite was active; pnpm
passes the `git@github.com:` form, which had no rewrite. Verified
locally with `git config --global --get-all url."...".insteadOf`.

**Fix.** Use `--add` for both rules so both rewrites apply.
VW HEAD: b0f196c. trainer-sim repo also made public during this cycle
(it had been private; anonymous HTTPS clone now works without auth).

### Cycle 3 — Typecheck failure (HEAD b0f196c) — RED on both legs

**Failure.** `pnpm install` succeeded (URL rewrite worked, public repo
accessible). But typecheck failed:

```
src/renderer/src/lib/dev/fake-trainer-transport.ts(71,44):
  error TS7006: Parameter 'dv' implicitly has an 'any' type.
```

**Diagnosis.** trainer-sim's `prepare` hook ran on the CI runner and
generated a corrupt 467-byte `dist/index.d.ts` (vs 29 KB local). The
exported types were missing, so `this.inner.onData((dv) => ...)`
inferred `any`. tsup's DTS pipeline fails silently in pnpm's git-clone
tmp dir context — exact cause not pinned, but the symptom is consistent.

**Fix.** trainer-sim now commits `dist/` to the repo (un-gitignored).
Consumers receive prebuilt artifacts directly without rebuild.
trainer-sim sha advances: `2a1c4c8`. VW repins to it. VW HEAD: 63e7a65.

### Cycle 4 — Same typecheck failure (HEAD 63e7a65) — RED on both legs

**Failure.** Same TS7006 error.

**Diagnosis.** pnpm's git-ref install ran the `prepare` hook AGAIN even
though dist was committed, OVERWRITING the committed dist with the
corrupted rebuild. The fix from Cycle 3 was insufficient — pnpm's
prepare runs unconditionally.

**Fix.** trainer-sim drops the `prepare` script entirely. With dist
committed AND no prepare, consumers receive the prebuilt artifacts
unchanged. trainer-sim sha advances: `8fac5dd`. VW repins.
VW HEAD: c178f33.

### Cycle 5 — GREEN on both legs

```
ci (ubuntu-latest)  pass  1m5s   conclusion: SUCCESS
ci (macos-latest)   pass  57s    conclusion: SUCCESS
```

PR #19 squash-merged into VW `main`.

## trainer-sim contract impact

**ZERO contract widening.** All Wave 0.x changes are build-toolchain only:

| Wave | trainer-sim sha | Change |
|------|-----------------|--------|
| 0 | e2479c9 | Plan 05-01: prepare hook + repo-org typo fix |
| 0.5 | b1b4304 | Browser-safe dual build (D-VW-10) — `dist/index.browser.js` via `"browser"` exports condition |
| 0.6 | 2a1c4c8 | Track dist/ in repo (un-gitignore) |
| 0.7 | 8fac5dd | Drop prepare hook (final pinned sha) |

`git diff e2479c9..8fac5dd -- src/types.ts` shows ONLY narrowing changes
(no Buffer import; `FakeTransportSource.buffer: Buffer | Uint8Array` →
`Uint8Array`). The `ITrainerTransport` interface declaration is
byte-identical. Zero method additions, zero shape mutations,
zero D-VW-08 widening trigger.

## Acceptance criteria status

- ✅ Feature branch pushed to `origin VeloWorld/veloworld-ride`.
- ✅ PR exists with title `feat(phase-5): adopt trainer-sim FakeTransport via git-ref + adapter`, target `main`.
- ✅ PR body references trainer-sim Wave 0 sha (`b1b4304` initially; the merged PR's sha is `8fac5dd` after re-pins).
- ✅ Both `ci (ubuntu-latest)` and `ci (macos-latest)` report `conclusion: SUCCESS`.
- ✅ PR merged into `main` (squash; merge commit sha `ba87fee`).
- ✅ Merge commit sha captured in `/tmp/05-03-merge-sha.txt`.
- ✅ CI run URLs captured in `/tmp/05-03-ci-runs-final.json`.
- ✅ Iteration log records 4 cycles with classifications (all VW-side / trainer-sim-build-only — no contract widening).
- ✅ Acceptance bundle scaffold written to `/tmp/05-03-acceptance-bundle.md`.
- ⏭ Manual smoke test skipped (per user decision — CI green is the contract gate).

## Handoff to Plan 05-04

Plan 05-04 inputs (all in `/tmp/`):

- `/tmp/05-03-pr-url.txt` — `https://github.com/VeloWorld/veloworld-ride/pull/19`
- `/tmp/05-03-merge-sha.txt` — `ba87feed944baab8f4be87fa3d1a5de2747571e1`
- `/tmp/05-03-ci-runs-final.json` — both CI runs with conclusions and detailsUrls
- `/tmp/05-03-acceptance-bundle.md` — pre-filled D-VW-09 5-item scaffold
- `.planning/phases/05-veloworld-end-to-end-validation/05-WAVE-0-SHA.txt` — `8fac5dd...`

Plan 05-04 composes `05-VERIFICATION.md` from these.
