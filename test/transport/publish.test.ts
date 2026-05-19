// Phase 4 Plan 04-06 Task 1 — publish-hygiene smoke test against the BUILT dist/.
//
// SUT: the BUILT package shape under `dist/index.{js,cjs,d.ts,d.cts}` (produced
//   by `npm run build` → `tsup`), plus the `package.json` exports map and
//   `tsup.config.ts` build configuration that govern that shape.
//
// This test does NOT fix current state — per 04-RESEARCH §Tooling Validation,
// `publint` and `attw --pack .` are both currently GREEN against `dist/`.
// The test exists to GUARD against future regressions: if a later plan
// accidentally breaks the dual-publish exports map, the types-first
// conditional, or the single-rooted exports invariant, this test fails loudly.
//
// Locked decisions exercised (.planning/phases/04-faketransport-public-api/04-CONTEXT.md):
//   - D-API-07 — public exports list (createFakeTransport + ITrainerTransport
//     + FakeTransport + FakeTransportConfig + FakeTransportSource).
//   - D-API-08 — `package.json` and `tsup.config.ts` are NOT modified in
//     Phase 4. The single-rooted (`"."`-only) exports map stays intact;
//     the v2 subpath (`./bleno`) is not introduced until BlenoTransport lands.
//   - D-API-22 — this file is the slow integration test (it shells out to
//     `npm run build` which costs several seconds). Vitest 4.1.x does not
//     expose `describe.slow` / `test.slow`; the `[slow]` suffix in the
//     describe-block title is the documentation-only convention used here,
//     and per-test `{ timeout: 60_000 }` defeats Vitest's default 5s timeout
//     for the build and attw steps (see threat T-04-06-03).
//
// Requirements addressed (.planning/REQUIREMENTS.md §FakeTransport API):
//   - API-07 — dual ESM/CJS publish validated by `publint` + `attw`.
//   - API-08 — strict-mode TypeScript Node 24 import works without
//     `@types/*` shim. `attw` exercises all six resolution modes
//     (node10, node16-CJS, node16-ESM, bundler, ESM consumer, CJS consumer).
//
// Threat mitigations exercised (04-06-PLAN.md <threat_model>):
//   - T-04-06-01 (mitigate) — `publint` + `attw` + structural exports-map
//     assertion catch any regression to the dual-publish form.
//   - T-04-06-02 (mitigate) — `attw` would surface a CJS-side type-resolution
//     break introduced by an accidental `@stoprocent/bleno` import reaching
//     `src/index.ts`. Defense-in-depth complement to Plan 04-03's grep guard.
//   - T-04-06-05 (mitigate) — `stdio: 'pipe'` keeps npm output out of the
//     test runner stream; failures still surface stdout/stderr via the
//     thrown error's properties.
//   - T-04-06-06 (mitigate) — Test 5's `tsup.config.ts` content assertion
//     pins the single-entry build (entry: ['src/index.ts']).
//
// Note on slow-marker: this entire file shells out to `npm run build` and
// takes ~5–30 seconds depending on machine. Local-iteration tip — skip it
// via `npm test -- --exclude '**/publish.test.ts'`.

import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');

/**
 * Run a `package.json` script via `npm run`. Uses `stdio: 'pipe'` rather than
 * `'inherit'` (T-04-06-05 mitigation) so the captured output stays out of the
 * Vitest reporter stream while still being attached to the thrown error's
 * `stdout` / `stderr` properties on failure — making CI logs clean on success
 * and informative on failure.
 */
function runScript(script: string): void {
  execSync(`npm run ${script}`, {
    cwd: REPO_ROOT,
    stdio: 'pipe',
    encoding: 'utf8',
  });
}

describe('FakeTransport publish hygiene (API-07 / API-08) [slow]', () => {
  it(
    'npm run build emits all four dual-publish artifacts',
    { timeout: 60_000 },
    () => {
      expect(() => runScript('build')).not.toThrow();
      expect(existsSync(resolve(REPO_ROOT, 'dist/index.js'))).toBe(true);
      expect(existsSync(resolve(REPO_ROOT, 'dist/index.cjs'))).toBe(true);
      expect(existsSync(resolve(REPO_ROOT, 'dist/index.d.ts'))).toBe(true);
      expect(existsSync(resolve(REPO_ROOT, 'dist/index.d.cts'))).toBe(true);
    },
  );

  it('built artifacts contain the Phase 4 public surface', () => {
    const distEsm = readFileSync(resolve(REPO_ROOT, 'dist/index.js'), 'utf8');
    const distCjs = readFileSync(resolve(REPO_ROOT, 'dist/index.cjs'), 'utf8');
    expect(distEsm).toContain('createFakeTransport');
    expect(distCjs).toContain('createFakeTransport');

    const dtsEsm = readFileSync(resolve(REPO_ROOT, 'dist/index.d.ts'), 'utf8');
    const dtsCjs = readFileSync(resolve(REPO_ROOT, 'dist/index.d.cts'), 'utf8');
    expect(dtsEsm).toContain('ITrainerTransport');
    expect(dtsEsm).toContain('FakeTransportConfig');
    expect(dtsEsm).toContain('FakeTransportSource');
    expect(dtsCjs).toContain('ITrainerTransport');
    expect(dtsCjs).toContain('FakeTransportConfig');
    expect(dtsCjs).toContain('FakeTransportSource');
  });

  it('publint exits 0 against the built dist/', () => {
    expect(() => runScript('validate:publint')).not.toThrow();
  });

  it(
    'attw --pack . exits 0 against the built dist/ (API-08)',
    { timeout: 60_000 },
    () => {
      expect(() => runScript('validate:attw')).not.toThrow();
    },
  );

  it('package.json + tsup.config.ts unchanged in Phase 4 (D-API-08 invariant)', () => {
    const pkgRaw = readFileSync(resolve(REPO_ROOT, 'package.json'), 'utf8');
    const pkg: {
      engines?: { node?: string };
      files?: string[];
      exports?: Record<string, unknown>;
    } = JSON.parse(pkgRaw);

    // Single-rooted exports map (D-API-08): only `"."` — no `./bleno` yet.
    expect(pkg.exports).toBeDefined();
    const rootExport = pkg.exports?.['.'] as
      | {
          import?: { types?: string; default?: string };
          require?: { types?: string; default?: string };
        }
      | undefined;
    expect(rootExport).toBeDefined();

    // Types-first conditional (publint-enforced; this is the structural sanity).
    expect(rootExport?.import?.types).toBe('./dist/index.d.ts');
    expect(rootExport?.import?.default).toBe('./dist/index.js');
    expect(rootExport?.require?.types).toBe('./dist/index.d.cts');
    expect(rootExport?.require?.default).toBe('./dist/index.cjs');

    // Node 24 LTS pin (Phase 1 D-16).
    expect(pkg.engines?.node).toBe('>=24.0');

    // Publish whitelist (Phase 1) — no source/test files leak into the tarball.
    expect(pkg.files).toEqual(['dist', 'README.md', 'LICENSE.md']);

    // tsup.config.ts: dual-target build (Node + browser) per D-API-08 +
    // D-VW-10. Node entry produces dual-format (ESM + CJS) with .d.ts/.d.cts;
    // browser entry produces a single ESM bundle with internal alias swaps
    // for the `_internal/*.browser.ts` shim variants.
    const tsupConfig = readFileSync(
      resolve(REPO_ROOT, 'tsup.config.ts'),
      'utf8',
    );
    expect(tsupConfig).toContain("entry: { index: 'src/index.ts' }");
    expect(tsupConfig).toContain("format: ['esm', 'cjs']");
    expect(tsupConfig).toContain('dts: true');
    expect(tsupConfig).toContain("entry: { 'index.browser': 'src/index.ts' }");
    expect(tsupConfig).toContain("platform: 'browser'");
  });
});
