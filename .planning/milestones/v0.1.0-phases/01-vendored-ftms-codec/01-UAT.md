---
status: complete
phase: 01-vendored-ftms-codec
source:
  - 01-01-SUMMARY.md
  - 01-02-SUMMARY.md
  - 01-03-SUMMARY.md
  - 01-04-SUMMARY.md
  - 01-05-SUMMARY.md
started: 2026-05-14T00:00:00Z
updated: 2026-05-16T00:00:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Cold Start Smoke Test
expected: |
  In a fresh shell from the repo root, run:
    rm -rf node_modules dist
    npm ci
    npm run build
    npm test
    npm run validate

  All four commands should exit 0. `npm test` should report "17 passed (17)".
  `npm run validate` should print "All good!" (publint) and "No problems found" (attw).
result: pass

### 2. Encoder importable as ESM
expected: |
  In a temporary scratch directory, after `npm pack` from the trainer-sim repo
  produces a tarball, install it elsewhere and write:

    import { encodeIndoorBikeData } from 'trainer-sim';
    const view = encodeIndoorBikeData({ power: 200, cadence: 90 });
    console.log([...new Uint8Array(view.buffer)].map(b => b.toString(16).padStart(2,'0')).join(' '));

  Run with `node --input-type=module`. Output should be: `45 00 b4 00 c8 00`
  (Flags=0x0045 inverted-bit-0, cadence wire=180, power=200).

  (For a quick check without packing, you can run the equivalent locally:
   `node --input-type=module -e "import('./dist/index.js').then(m => { ... })"`.)
result: pass

### 3. Encoder importable as CJS
expected: |
  Same payload, CommonJS path. From a CJS scratch:

    const { encodeIndoorBikeData } = require('trainer-sim');
    const view = encodeIndoorBikeData({ power: 200, cadence: 90 });

  Output should match Test 2 exactly: `45 00 b4 00 c8 00`. attw confirmed
  this resolves correctly (no "Masquerading as ESM" warning); verify it
  works in practice.
result: pass

### 4. Demo script prints reference payloads
expected: |
  Run: `npx tsx scripts/nrf-connect-demo.ts`

  Output should include both reference payloads with their hex bytes:
    Payload 1 ({power: 200, cadence: 90})         → 45 00 B4 00 C8 00
    Payload 5 ({power: 100, cadence: 60, speed: 30}) → 44 00 B8 0B 78 00 64 00

  Plus a procedure block describing nRF Connect verification steps.
result: pass

### 5. CI workflow is well-formed
expected: |
  Open `.github/workflows/ci.yml`. Confirm:
    - matrix has both `macos-latest` and `ubuntu-latest`
    - node-version is `24`
    - fail-fast: false
    - steps run npm ci, npm run build, npm test, and the publint + attw validation

  This file will only actually run when pushed to GitHub — the structural check
  is what we want here, not a live run.
result: pass

### 6. nRF Connect verification artifacts in place
expected: |
  Confirm:
    - `.planning/phases/01-vendored-ftms-codec/nrf-connect-verification.png`
      exists, ≥ 50 KB, is a real PNG (not a placeholder)
    - `nrf-connect-verification.md` outcome=matched, sign-off filled in,
      no `__REPLACE` placeholders remain

  This was already approved during plan 01-05 execution; this UAT step
  re-confirms the artifacts are still on disk after worktree merge.
result: pass

## Summary

total: 6
passed: 6
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps

[none yet]
