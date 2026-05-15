/**
 * Phase 2 Plan 04 Task 1 — loader public-API verification.
 *
 * Asserts the Wave 3 loader's behavior end-to-end against four committed
 * CI-tier fixtures from plan 02-02:
 *
 *   - `basic.fit` (443 records)              FIT-01 path/buffer parity
 *                                            FIT-03 timestamps near 2025-01-01 anchor
 *   - `autopause.fit` (3172 records)         FIT-04 valid-but-weird shapes
 *                                            D-FIT-02 autopause gap preservation
 *                                            (assert at least one delta > 60_000 ms)
 *   - `zero-power.fit` (541 records)         FIT-04 valid-but-weird shapes
 *                                            D-FIT-01 wire `0` preserved
 *                                            (assert >= 50 records with `power === 0`)
 *   - `dev-fields-non-shadow.fit` (2501)     FIT-04 valid-but-weird shapes
 *                                            (assert >= 2400 records carry power)
 *
 * Plus the D-FIT-07 sync-return defensive invariant: `loadFitFromBuffer`
 * MUST NOT return a Promise. RESEARCH §Open Questions #3 / Assumptions A1
 * — fails immediately if a future parser version makes the callback async.
 *
 * Imports go through `../../src/index.js` only — the public surface.
 * Internal modules (`src/fit/loader.ts`, `src/fit/normalize.ts`) are NOT
 * imported here per T-02-20; that boundary is enforced by an acceptance
 * grep on this file.
 *
 * Out of scope (lives in plan 02-04 task 4 / plan 02-05):
 *   - perf gate (task 4)
 *   - normalize-direct unit tests (plan 02-05)
 *   - the local-dev opt-in suite (plan 02-05)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { loadFitFromPath, loadFitFromBuffer } from '../../src/index.js';
import type { RideRecord } from '../../src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = resolve(__dirname, '../fixtures/fit');

describe('FIT-01: loadFitFromPath / loadFitFromBuffer parity', () => {
  it('path and buffer entries return identical RideRecord arrays for basic.fit', async () => {
    const path = resolve(FIXTURE_DIR, 'basic.fit');
    const buf = readFileSync(path);
    const fromPath = await loadFitFromPath(path);
    const fromBuf = loadFitFromBuffer(buf);
    expect(fromPath).toEqual(fromBuf);
    expect(fromPath.length).toBeGreaterThan(0);
    // basic.fit's D-FIT-05 mapping is 443 records. The exact count from the
    // committed fixture is asserted within a small tolerance to allow for
    // normalize's dedup of any future scrubber tweaks.
    expect(fromPath.length).toBeGreaterThanOrEqual(440);
    expect(fromPath.length).toBeLessThanOrEqual(445);
  });

  it('every record exposes a numeric timestamp (RESEARCH §Pitfall 1/7)', () => {
    const buf = readFileSync(resolve(FIXTURE_DIR, 'basic.fit'));
    const records = loadFitFromBuffer(buf);
    for (const r of records) {
      expect(typeof r.timestamp).toBe('number');
    }
  });

  it('first record timestamp is anchored near the synthetic 2025-01-01 epoch', () => {
    const buf = readFileSync(resolve(FIXTURE_DIR, 'basic.fit'));
    const records = loadFitFromBuffer(buf);
    expect(records.length).toBeGreaterThan(0);
    const start = Date.UTC(2025, 0, 1);
    const oneDayMs = 86400000;
    const first = records[0]!.timestamp;
    expect(first).toBeGreaterThanOrEqual(start - oneDayMs);
    expect(first).toBeLessThanOrEqual(start + oneDayMs * 2);
  });
});

describe('D-FIT-07: loadFitFromBuffer is synchronous', () => {
  it('returns a RideRecord[] directly, not a Promise (defensive — RESEARCH A1)', () => {
    const buf = readFileSync(resolve(FIXTURE_DIR, 'basic.fit'));
    const result = loadFitFromBuffer(buf);
    // If a future fit-file-parser ever switches to async parsing this
    // assertion fails immediately rather than silently breaking
    // downstream callers.
    expect(result).not.toBeInstanceOf(Promise);
    expect(Array.isArray(result)).toBe(true);
  });
});

describe('FIT-04: real-world quirks load without throwing', () => {
  it('autopause.fit loads and preserves at least one autopause gap > 60s (D-FIT-02)', () => {
    const buf = readFileSync(resolve(FIXTURE_DIR, 'autopause.fit'));
    let records: RideRecord[] = [];
    expect(() => {
      records = loadFitFromBuffer(buf);
    }).not.toThrow();
    // D-FIT-05 mapping: 3172 records, with 2 gaps (max 68s). Tolerance
    // is wide because normalize may dedup a small number of records.
    expect(records.length).toBeGreaterThanOrEqual(3170);
    expect(records.length).toBeLessThanOrEqual(3175);

    // D-FIT-02: autopause gaps preserved as plain timestamp jumps.
    // At least one consecutive timestamp delta must exceed 60_000 ms.
    let maxDeltaMs = 0;
    for (let i = 1; i < records.length; i++) {
      const delta = records[i]!.timestamp - records[i - 1]!.timestamp;
      if (delta > maxDeltaMs) maxDeltaMs = delta;
    }
    expect(maxDeltaMs).toBeGreaterThan(60_000);
  });

  it('zero-power.fit preserves wire `power === 0` for >= 50 records (D-FIT-01)', () => {
    const buf = readFileSync(resolve(FIXTURE_DIR, 'zero-power.fit'));
    let records: RideRecord[] = [];
    expect(() => {
      records = loadFitFromBuffer(buf);
    }).not.toThrow();
    // D-FIT-05 mapping: 541 records, 142 zero-power. Tolerance is +-2 to
    // allow for any normalize dedup edge cases.
    expect(records.length).toBeGreaterThanOrEqual(539);
    expect(records.length).toBeLessThanOrEqual(543);

    // D-FIT-01 wire-honesty: a real 0x0000 watt reading must round-trip
    // as the JS number `0`, NOT collapse to undefined. The 0xFFFF FIT
    // invalid sentinel is a separate concept and is filtered to
    // undefined by the parser/normalize.
    const zeroPowerCount = records.filter((r) => r.power === 0).length;
    expect(zeroPowerCount).toBeGreaterThanOrEqual(50);
  });

  it('dev-fields-non-shadow.fit loads with >= 2400 records carrying power', () => {
    const buf = readFileSync(resolve(FIXTURE_DIR, 'dev-fields-non-shadow.fit'));
    let records: RideRecord[] = [];
    expect(() => {
      records = loadFitFromBuffer(buf);
    }).not.toThrow();
    // D-FIT-05 mapping: 2501 records. ±2 tolerance for dedup.
    expect(records.length).toBeGreaterThanOrEqual(2499);
    expect(records.length).toBeLessThanOrEqual(2503);

    // Per the plan: RESEARCH inspection showed power is `present=true`
    // across the file with `range=0..1597` (~100% presence). >= 2400
    // records must carry `power !== undefined`. This catches a
    // regression that strips power from ~4% or more of records.
    const withPower = records.filter((r) => r.power !== undefined).length;
    expect(withPower).toBeGreaterThanOrEqual(2400);
  });
});
