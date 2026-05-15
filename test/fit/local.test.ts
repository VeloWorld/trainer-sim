/**
 * Phase 2 Plan 02-05 Task 2 — local-dev TEST_FIT_DIR opt-in smoke suite.
 *
 * D-FIT-04 — local-dev tier; opt-in via TEST_FIT_DIR. CI does not set this
 * env var so the suite is silently skipped (the unset-skip behavior IS the
 * binding D-FIT-04 contract — see CONTEXT.md). Run locally before release:
 *
 *   TEST_FIT_DIR=/path/to/your/rides npm test
 *
 * When set, the suite walks the directory and asserts every `.fit` file
 * loads cleanly (>0 records, no throw). The "when set" path is a developer
 * convenience, NOT a CI guarantee — D-FIT-04 explicitly excludes it from
 * the CI contract.
 *
 * Forbidden (per plan 02-05 task 2):
 *   - No hard-coded developer-machine paths.
 *   - No assertions against specific record counts (the developer may put
 *     any files in their dir; we only smoke-check that load succeeds).
 *   - No direct parser-dependency import (we test through the public surface).
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { loadFitFromPath } from '../../src/index.js';

const dir = process.env.TEST_FIT_DIR;

// describe.skipIf takes a boolean: `!dir` is `true` when unset (skip), `false`
// when set (run). When the suite skips, vitest reports it cleanly without
// noise — that's the locked D-FIT-04 contract.
describe.skipIf(!dir)('local-dev FIT smoke (TEST_FIT_DIR)', () => {
  // Defensive directory enumeration. If TEST_FIT_DIR points at something
  // that isn't a readable directory (typo, removed mount, etc.), fail
  // ONLY this suite's tests with a clear message rather than crashing the
  // whole test run with an ENOENT at module-load time.
  let files: string[] = [];
  let enumerationError: Error | undefined;
  try {
    const stats = statSync(dir!);
    if (!stats.isDirectory()) {
      enumerationError = new Error(
        `TEST_FIT_DIR=${dir} is not a directory (statSync.isDirectory() === false)`,
      );
    } else {
      files = readdirSync(dir!).filter(
        (f) => extname(f).toLowerCase() === '.fit',
      );
    }
  } catch (err) {
    enumerationError = new Error(
      `TEST_FIT_DIR=${dir} is not a directory or is unreadable: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  if (enumerationError) {
    it('TEST_FIT_DIR points to a readable directory', () => {
      expect.fail(enumerationError!.message);
    });
  } else if (files.length === 0) {
    it('expected at least one .fit file in TEST_FIT_DIR', () => {
      expect.fail(`TEST_FIT_DIR=${dir} contains zero .fit files`);
    });
  } else {
    for (const file of files) {
      it(`${file} parses without throwing`, async () => {
        const fullPath = join(dir!, file);
        const records = await loadFitFromPath(fullPath);
        expect(records.length).toBeGreaterThan(0);
        // Light shape check: every record's timestamp is a number per
        // D-FIT-01 / FIT-03 (Unix epoch ms, not the parser's Date).
        for (const r of records) {
          expect(typeof r.timestamp).toBe('number');
        }
      });
    }
  }
});
