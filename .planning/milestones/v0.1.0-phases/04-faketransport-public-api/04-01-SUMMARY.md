---
phase: 04
plan: 01
subsystem: test-infrastructure
tags: [test-helpers, refactor, phase-3-followup]

dependency_graph:
  requires:
    - "test/replay/scheduler.test.ts (Phase 3 source-of-truth body)"
    - "test/replay/abort.test.ts (byte-identical duplicate)"
    - "test/replay/replay.test.ts (byte-identical duplicate)"
    - "test/replay/loop.test.ts (byte-identical duplicate)"
  provides:
    - "test/_helpers/fake-aware-sleep.ts — single source of truth for `fakeAwareSleep`"
  affects:
    - "Wave 2's test/transport/fake-transport.test.ts (later plan) — can import from the same helper without re-introducing a 5th duplicate"

tech_stack:
  added: []
  patterns:
    - "Pattern TH1 — verbatim lift of test helper into shared `test/_helpers/` directory"
    - "Pattern TH2 — drop local definition + add single import (`from '../_helpers/<name>.js'`)"

key_files:
  created:
    - "test/_helpers/fake-aware-sleep.ts"
  modified:
    - "test/replay/scheduler.test.ts"
    - "test/replay/abort.test.ts"
    - "test/replay/replay.test.ts"
    - "test/replay/loop.test.ts"

decisions:
  - "Phase 3 followup IN-01 closed (D-API-25): `fakeAwareSleep` lifted from 4 byte-identical copies into `test/_helpers/fake-aware-sleep.ts`."
  - "Helper directory pattern established: `test/_helpers/` is the shared location for cross-suite test utilities (Phase 4 transport tests will follow)."

metrics:
  duration_seconds: 221
  duration_human: "3m 41s"
  task_count: 2
  files_created: 1
  files_modified: 4
  commits:
    - hash: "21d7f08"
      type: refactor
      summary: "lift fakeAwareSleep helper to test/_helpers/"
    - hash: "b021b4e"
      type: refactor
      summary: "migrate 4 Phase 3 replay tests to lifted helper"
  completed_date: "2026-05-16"
---

# Phase 4 Plan 1: fakeAwareSleep helper lift Summary

**One-liner:** Lifted the byte-identical 32-line `fakeAwareSleep` helper out of four Phase 3 replay test files (`scheduler.test.ts`, `abort.test.ts`, `replay.test.ts`, `loop.test.ts`) into a single shared module at `test/_helpers/fake-aware-sleep.ts`, closing Phase 3 followup IN-01 and pre-empting a fifth duplication in Wave 2's upcoming `test/transport/fake-transport.test.ts`.

## What This Accomplished

Pure refactor — zero behavioral change, zero test regressions, zero typecheck regressions. The four Phase 3 tests now consume the shared helper via:

```typescript
import { fakeAwareSleep } from '../_helpers/fake-aware-sleep.js';
```

The helper itself is byte-for-byte identical to the four source copies (verified via `diff` before lifting — see Task 1 verification). It uses `globalThis.setTimeout` (which Vitest 4's `vi.useFakeTimers()` DOES intercept), sets `name = 'AbortError'` on rejection in both abort branches, and uses `{ once: true }` on the abort listener — preserving the contract the production `node:timers/promises.setTimeout` honors.

## Tasks Completed

### Task 1 — Create `test/_helpers/fake-aware-sleep.ts`

- **Commit:** `21d7f08`
- Created `test/_helpers/` directory.
- Wrote `test/_helpers/fake-aware-sleep.ts` with one named export, signature `(delay: number, _value?: undefined, options?: { signal?: AbortSignal }) => Promise<void>`.
- File preamble JSDoc cites Phase 3 followup IN-01, Phase 4 D-API-24 / D-API-25, and the Pitfall 6 root cause (`vi.useFakeTimers` does NOT intercept `node:timers/promises` module-level binding).
- Body verified byte-for-byte identical against all 4 source files via `awk` extraction + `diff`.
- Acceptance verified: `tsc --noEmit -p tsconfig.test.json` exits 0; required substrings present (`export function fakeAwareSleep`, `globalThis.setTimeout`, `AbortError`).

### Task 2 — Migrate 4 Phase 3 test files

- **Commit:** `b021b4e`
- For each of `test/replay/{scheduler,abort,replay,loop}.test.ts`:
  - Removed the local `function fakeAwareSleep(...)` block (and its preceding JSDoc preamble).
  - Added one import line `import { fakeAwareSleep } from '../_helpers/fake-aware-sleep.js';` placed in the existing relative-import group.
- All other content (describe blocks, test bodies, `fakeAwareSleep` call sites, the local `makeRecords` helper) preserved unchanged.
- Net diff: **4 insertions, 131 deletions** across 4 files.

## Verification Results

All four items from the plan's `<verification>` block pass:

| Check | Expected | Actual |
|-------|----------|--------|
| `npm test -- test/replay` (test counts) | match Phase 3 baseline | 27 passed / 1 skipped (28) — same as pre-lift baseline |
| `npm test` (full suite) | match Phase 3 historical baseline (77/79) | **77 passed / 2 skipped (79)** ✓ |
| `tsc --noEmit -p tsconfig.test.json` | exits 0 | exits 0 ✓ |
| `grep -rn "function fakeAwareSleep" test/replay/ test/_helpers/` | exactly ONE match | exactly ONE match (`test/_helpers/fake-aware-sleep.ts:25`) ✓ |
| `grep -rln "from '\\.\\./_helpers/fake-aware-sleep\\.js'" test/replay/` | 4 files | 4 files (scheduler, abort, replay, loop) ✓ |

## Decisions Made

- **D-API-25 fold confirmed.** Phase 3 advisory followup IN-01 (`fakeAwareSleep` duplicated in 4 test files) is now closed via Phase 4 D-API-25 — no separate cleanup phase needed.
- **`test/_helpers/` is the canonical shared-test-utility location.** Wave 2's `test/transport/fake-transport.test.ts` will import from here (per `04-PATTERNS.md` Pattern TR1 import block), preventing a 5th duplicate from being introduced.

## Deviations from Plan

None — plan executed exactly as written. The historical "77/79" baseline cited in the plan acceptance criteria matches the post-lift full-suite count exactly.

## Phase 4 Wave 2 Handoff

Wave 2's `test/transport/fake-transport.test.ts` will use the same import (per Pattern TR1):

```typescript
import { fakeAwareSleep } from '../_helpers/fake-aware-sleep.js';
```

The helper is now ready for that consumer with zero further work — single export, stable signature, identical contract.

## Self-Check: PASSED

**Files claimed created:**
- `test/_helpers/fake-aware-sleep.ts` — FOUND ✓

**Files claimed modified:**
- `test/replay/scheduler.test.ts` — present, contains lifted import ✓
- `test/replay/abort.test.ts` — present, contains lifted import ✓
- `test/replay/replay.test.ts` — present, contains lifted import ✓
- `test/replay/loop.test.ts` — present, contains lifted import ✓

**Commits claimed:**
- `21d7f08` — FOUND in `git log` (refactor(04-01): lift fakeAwareSleep helper to test/_helpers/) ✓
- `b021b4e` — FOUND in `git log` (refactor(04-01): migrate 4 Phase 3 replay tests to lifted helper) ✓
