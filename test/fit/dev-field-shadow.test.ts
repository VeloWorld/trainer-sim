/**
 * Phase 2 Plan 04 Task 3 — developer-field shadow non-fatal behavior.
 *
 * Asserts D-FIT-10's locked behavior (REQUIREMENTS.md FIT-05 amendment
 * 2026-05-16):
 *
 *   1. shadow.fit loads without throwing.
 *   2. The loader returns >= 1 record with `power` populated.
 *   3. A util.debuglog('trainer-sim:fit') message is emitted on stderr
 *      naming the shadowed field (`power`).
 *
 * IMPORTANT — D-FIT-10 SUPERSEDES research:
 *   RESEARCH §Critical Finding §Pattern 3 (and §Code Examples Example 1)
 *   originally recommended throwing the typed shadow-error class on
 *   shadow detection. That recommendation was SUPERSEDED by user
 *   decision in /gsd-discuss-phase on 2026-05-16. This test asserts the
 *   locked behavior (debuglog + continue), NOT the rejected one (throw).
 *   Do NOT "fix" this test by re-introducing a throw assertion or by
 *   importing a deliberately-absent typed shadow-error class.
 *
 * Subprocess approach (npx tsx):
 *   util.debuglog writes to stderr. Vitest's mock facilities for
 *   util.debuglog are awkward — vi.mock would mock the import in the
 *   test module, not the loader's own binding. The cleanest path is to
 *   spawn a Node child process via npx tsx with NODE_DEBUG set, then
 *   grep its stderr. Per CLAUDE.md, tsx is in devDependencies precisely
 *   because Node's experimental TypeScript stripper does not yet handle
 *   tsconfig paths or all syntax — and the subprocess imports
 *   `./src/fit/loader.ts` which imports `./normalize.js`, a path tsx
 *   resolves cleanly. Use tsx for the subprocess; do NOT swap to a
 *   built-in TS stripper flag.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadFitFromBuffer } from '../../src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = resolve(__dirname, '../fixtures/fit');
// The subprocess runs from the repo root (cwd defaults to the test
// runner's cwd). The reference path inside the subprocess is the
// repo-relative `test/fixtures/fit/shadow.fit`.
const SHADOW_FIXTURE_REPO_PATH = 'test/fixtures/fit/shadow.fit';

describe('FIT-05 amended (D-FIT-10): shadow.fit is non-fatal', () => {
  it('Test 1 — loadFitFromBuffer(shadow.fit) does not throw and returns records', () => {
    const buf = readFileSync(resolve(FIXTURE_DIR, 'shadow.fit'));
    expect(() => loadFitFromBuffer(buf)).not.toThrow();
    const records = loadFitFromBuffer(buf);
    expect(records.length).toBeGreaterThan(0);
    // power is populated. We deliberately do NOT assert a specific value
    // (200 vs 999) — D-FIT-10's contract is "returns whatever parser
    // produced", and the underlying parser version may shift on minor
    // bumps. `power !== undefined` is the durable assertion.
    expect(records[0]!.power).toBeDefined();
  });

  it('Test 2 — emits util.debuglog message on stderr naming the shadowed field', () => {
    // Spawn npx tsx with NODE_DEBUG=trainer-sim:fit so util.debuglog
    // wakes up and writes to stderr. Capture stderr; assert it names
    // `power` as the shadowed field.
    //
    // The inline -e program imports ./src/fit/loader.ts directly so the
    // subprocess does not depend on a built dist/. tsx handles the .ts
    // extension and the .js -> .ts import-specifier rewriting that the
    // built-in Node TS stripper does not.
    const program = [
      'import {loadFitFromBuffer} from "./src/fit/loader.ts";',
      'import {readFileSync} from "node:fs";',
      `loadFitFromBuffer(readFileSync(${JSON.stringify(SHADOW_FIXTURE_REPO_PATH)}));`,
    ].join('\n');
    const result = spawnSync('npx', ['tsx', '-e', program], {
      env: { ...process.env, NODE_DEBUG: 'trainer-sim:fit' },
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toMatch(/developer field shadow/i);
    expect(result.stderr).toMatch(/power/i);
  });

  it('Test 3 — D-FIT-06 negative: shadow.fit does NOT cause a FitLoadError throw', () => {
    // Belt-and-braces: explicit fail-if-throws with a descriptive message.
    // Catches a regression that would re-introduce a throw on shadow.
    const buf = readFileSync(resolve(FIXTURE_DIR, 'shadow.fit'));
    try {
      loadFitFromBuffer(buf);
    } catch (e) {
      expect.fail(
        'shadow.fit should not throw per D-FIT-10; got error: ' +
          (e as Error).message,
      );
    }
  });
});
