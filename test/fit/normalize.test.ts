// Phase 2 Plan 02-05 Task 1 — unit tests for the pure `normalize` function.
//
// SUT: src/fit/normalize.ts (built in plan 02-03 task 1).
// Direct unit-test import is acceptable here (NOT public-surface) because:
//   - normalize is a pure function with a well-defined input/output contract
//     (ParsedFitMinimal -> RideRecord[]).
//   - Most test inputs are hand-constructed `ParsedFitMinimal`-shaped objects,
//     so we avoid coupling tests to the parser dependency's internal output
//     shape changing.
//   - The plan acceptance criteria require this exact import path.
//
// Locked decisions exercised:
//   - FIT-02 (sort + dedup keep-first; time-ordered output).
//   - FIT-03 (FIT timestamp -> Unix epoch ms via Date.getTime()).
//   - D-FIT-01 (wire-honest: real `0` preserved; missing fields produce
//     omitted properties not explicit `undefined`).
//   - D-FIT-02 (autopause gaps preserved as plain timestamp jumps; no
//     backfill).
//   - D-FIT-03 (drop count: 13 duplicates in duplicates.fit).
//   - D-FIT-09 (drop count via util.debuglog on NODE_DEBUG=trainer-sim:fit).
//
// Subprocess approach for Group 4 (D-FIT-09):
//   We invoke `npx tsx` because the subprocess imports
//   `'./src/fit/loader.ts'`, which itself imports `'./normalize.js'`
//   (Phase 1 .js-extension convention). Node's built-in TS-stripping loader
//   has incomplete `.js`->`.ts` resolution rewriting; tsx handles it.
//   Plan 02-04 task 3 carries the same constraint and CLAUDE.md documents
//   the rationale ("tsx is in devDeps because Node's built-in TS loader
//   doesn't yet handle tsconfig paths or all syntax").

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { normalize } from '../../src/fit/normalize.js';

// Synthetic anchor — same convention plan 02-02's scrubber uses for its
// scrubbed CI fixtures. Using Date.UTC pins FIT-03's getTime() conversion
// expectation: a Date constructed from a known UTC anchor must round-trip
// to the corresponding Unix-epoch-ms integer.
const ANCHOR_MS = Date.UTC(2025, 0, 1); // 2025-01-01T00:00:00.000Z

describe('normalize() — pure function unit tests', () => {
  describe('Group 1 — FIT-03: Date -> Unix epoch ms via getTime()', () => {
    it('returns timestamp as a JS number (not a string per RESEARCH §Pitfall 7)', () => {
      const result = normalize({
        records: [{ timestamp: new Date('2025-01-01T00:00:00Z') }],
      });
      expect(result).toHaveLength(1);
      expect(typeof result[0]!.timestamp).toBe('number');
    });

    it('applies Date.getTime() so a 2025-01-01 UTC Date becomes Date.UTC(2025,0,1)', () => {
      const result = normalize({
        records: [{ timestamp: new Date('2025-01-01T00:00:00Z') }],
      });
      expect(result[0]!.timestamp).toBe(Date.UTC(2025, 0, 1));
    });

    it('preserves millisecond precision', () => {
      const d = new Date(Date.UTC(2025, 5, 15, 12, 34, 56, 789));
      const result = normalize({ records: [{ timestamp: d }] });
      expect(result[0]!.timestamp).toBe(d.getTime());
    });
  });

  describe('Group 2 — D-FIT-01: wire-honest power/cadence semantics', () => {
    it('preserves real `power: 0` as `0` (rider coasting, NOT no-signal)', () => {
      const t = new Date(ANCHOR_MS);
      const result = normalize({ records: [{ timestamp: t, power: 0 }] });
      expect(result).toHaveLength(1);
      expect(result[0]!.power).toBe(0);
    });

    it('preserves both `power: 0` AND `cadence: 0` (both zeros wire-honest)', () => {
      const t = new Date(ANCHOR_MS);
      const result = normalize({
        records: [{ timestamp: t, power: 0, cadence: 0 }],
      });
      expect(result).toHaveLength(1);
      expect(result[0]!.power).toBe(0);
      expect(result[0]!.cadence).toBe(0);
    });

    it('omits `power` and `cadence` keys entirely when missing (not explicit undefined)', () => {
      const t = new Date(ANCHOR_MS);
      const result = normalize({ records: [{ timestamp: t }] });
      expect(result).toHaveLength(1);
      // The 'in' operator confirms the key isn't present — not just falsy.
      // Phase 1's encoder uses `value === undefined` to gate flag bits;
      // an omitted key satisfies that, but the contract per D-FIT-01 is
      // that the property is genuinely absent.
      expect('power' in result[0]!).toBe(false);
      expect('cadence' in result[0]!).toBe(false);
    });

    it('collapses explicit-undefined input to omitted-key output (D-FIT-01: undefined and missing are equivalent)', () => {
      const t = new Date(ANCHOR_MS);
      const result = normalize({
        records: [{ timestamp: t, power: undefined, cadence: undefined }],
      });
      expect(result).toHaveLength(1);
      expect('power' in result[0]!).toBe(false);
      expect('cadence' in result[0]!).toBe(false);
    });

    it('passes through non-zero values unchanged', () => {
      const t = new Date(ANCHOR_MS);
      const result = normalize({
        records: [{ timestamp: t, power: 200, cadence: 90 }],
      });
      expect(result).toHaveLength(1);
      expect(result[0]!.power).toBe(200);
      expect(result[0]!.cadence).toBe(90);
    });
  });

  describe('Group 3 — FIT-02 + D-FIT-03: sort + dedup keep-first', () => {
    it('sorts out-of-order input ascending by timestamp', () => {
      const t = ANCHOR_MS;
      const result = normalize({
        records: [
          { timestamp: new Date(t + 2000), power: 300 },
          { timestamp: new Date(t), power: 100 },
          { timestamp: new Date(t + 1000), power: 200 },
        ],
      });
      expect(result).toHaveLength(3);
      // Ascending order
      expect(result[0]!.timestamp).toBe(t);
      expect(result[1]!.timestamp).toBe(t + 1000);
      expect(result[2]!.timestamp).toBe(t + 2000);
      // Values follow the records they were attached to, not the input order
      expect(result[0]!.power).toBe(100);
      expect(result[1]!.power).toBe(200);
      expect(result[2]!.power).toBe(300);
    });

    it('dedups exact-duplicate timestamps keeping the first occurrence (keep-first wins)', () => {
      const t = new Date(ANCHOR_MS);
      const result = normalize({
        records: [
          { timestamp: t, power: 100 },
          { timestamp: t, power: 200 },
        ],
      });
      expect(result).toHaveLength(1);
      // First-occurrence value (100) survives; second (200) is dropped.
      expect(result[0]!.power).toBe(100);
    });

    it('applies dedup AFTER sort: sorted-first-T+1 wins after reordering', () => {
      // Input order: [T+1, p=200], [T, p=100], [T+1, p=999]
      // After sort:  [T, p=100], [T+1, p=200], [T+1, p=999]
      // After dedup keep-first: [T, p=100], [T+1, p=200] — the 999 is dropped.
      const t = ANCHOR_MS;
      const result = normalize({
        records: [
          { timestamp: new Date(t + 1000), power: 200 },
          { timestamp: new Date(t), power: 100 },
          { timestamp: new Date(t + 1000), power: 999 },
        ],
      });
      expect(result).toHaveLength(2);
      expect(result[0]!.timestamp).toBe(t);
      expect(result[0]!.power).toBe(100);
      expect(result[1]!.timestamp).toBe(t + 1000);
      // The post-sort first occurrence of T+1 had power=200; the duplicate
      // (power=999) is dropped per D-FIT-03 keep-first semantics.
      expect(result[1]!.power).toBe(200);
    });

    it('returns [] for empty records array (no throw, no debuglog emit)', () => {
      const result = normalize({ records: [] });
      expect(result).toEqual([]);
    });

    it('returns [] when records is undefined', () => {
      const result = normalize({ records: undefined });
      expect(result).toEqual([]);
    });

    it('defensively skips records with no timestamp', () => {
      const t = new Date(ANCHOR_MS);
      const result = normalize({
        records: [
          { timestamp: t, power: 100 },
          // Missing timestamp — normalize's `if (!rec.timestamp) continue` drops this.
          { power: 200 },
        ],
      });
      expect(result).toHaveLength(1);
      expect(result[0]!.power).toBe(100);
    });
  });

  describe('Group 4 — D-FIT-03 + D-FIT-09: dedup count via debuglog (real fixture coverage)', () => {
    // Subprocess + NODE_DEBUG capture, mirroring plan 02-04 task 3's pattern.
    // Spawn `npx tsx` per CLAUDE.md and the file-header rationale: tsx
    // handles `.js`->`.ts` import-specifier rewriting that Node's built-in
    // TS-stripping loader does not.
    it('emits "duplicates dropped" debuglog and produces 689 records from 702-record duplicates.fit', () => {
      const fixturePath = resolve(__dirname, '../fixtures/fit/duplicates.fit');
      const result = spawnSync(
        'npx',
        [
          'tsx',
          '-e',
          `import {loadFitFromBuffer} from './src/fit/loader.ts';
           import {readFileSync} from 'node:fs';
           const out = loadFitFromBuffer(readFileSync(${JSON.stringify(fixturePath)}));
           console.log('records=' + out.length);`,
        ],
        {
          env: { ...process.env, NODE_DEBUG: 'trainer-sim:fit' },
          encoding: 'utf8',
          // Ride is small; 60s is plenty for cold-start tsx + parse.
          timeout: 60_000,
        },
      );

      expect(result.status).toBe(0);
      // The util.debuglog channel writes to stderr. Loader's normalize emits
      // a "%d duplicates dropped" message when any duplicates were dropped.
      // The duplicates.fit fixture has 13 dupes per D-FIT-05 mapping; allow
      // ±2 tolerance for any scrub-induced minor count drift.
      expect(result.stderr).toMatch(/normalize.*duplicates.*dropped/i);
      // Output records: 702 input - 13 dupes = 689; ±2 tolerance.
      expect(result.stdout).toMatch(/records=68[7-9]|records=69[0-1]/);
    });
  });

  describe('Group 5 — D-FIT-02: gaps preserved as plain timestamp jumps', () => {
    it('preserves a 60-second gap (no backfill, no phantom records)', () => {
      const t = ANCHOR_MS;
      const result = normalize({
        records: [
          { timestamp: new Date(t), power: 100 },
          // 60_000 ms (60 s) gap — typical autopause shape.
          { timestamp: new Date(t + 60_000), power: 200 },
        ],
      });
      // No backfill: still 2 records, gap preserved.
      expect(result).toHaveLength(2);
      // The gap delta is intact.
      expect(result[1]!.timestamp - result[0]!.timestamp).toBe(60_000);
    });
  });
});
