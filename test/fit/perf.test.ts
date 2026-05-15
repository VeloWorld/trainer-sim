/**
 * Phase 2 Plan 04 Task 4 — ROADMAP perf gate.
 *
 * ROADMAP says "<100 ms parse for typical 1-hour file" for Phase 2. This
 * test asserts a tighter <50 ms median (2x margin under the gate) so a
 * regression is caught before it eats the headroom.
 *
 * Fixture: `test/fixtures/fit/perf-1hr.fit` (4562 records, 76 minutes —
 * Zwift FTP Test, scrubbed by plan 02-02). Denser than the synthetic
 * 3600-record file RESEARCH measured against (1.85 ms median); even at
 * 25x slowdown on a slow CI host the 50 ms threshold holds.
 *
 * Methodology (RESEARCH §Code Examples Example 7):
 *   - Read the file once, outside the timed loop.
 *   - Run 3 warm-up iterations to let V8's JIT kick in.
 *   - Run 11 timed iterations; sort the times array and pick the
 *     6th element (index 5) as the median.
 *   - Console-log min / median / max so a future regression is visible
 *     in the test output even when the assertion still passes.
 *
 * NOT skipped on CI. The perf gate is part of the ROADMAP success
 * criteria. If it flakes, widen the threshold in a follow-up plan or
 * improve the fixture; do NOT bypass the gate by disabling this test.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { loadFitFromBuffer } from '../../src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = resolve(__dirname, '../fixtures/fit');

describe('Phase 2 perf gate (<100 ms parse for ~1-hour file)', () => {
  it('parses perf-1hr.fit in <50 ms median over 11 runs after 3 warm-up runs', () => {
    const buf = readFileSync(resolve(FIXTURE_DIR, 'perf-1hr.fit'));

    // Warm-up: V8 JIT cold-path can dominate the first few runs. 3
    // throwaway iterations let the inliner settle before timing.
    for (let i = 0; i < 3; i++) loadFitFromBuffer(buf);

    // Timed iterations: median of 11. Standard pattern; one extreme
    // outlier on either end leaves a stable middle.
    const N = 11;
    const times: number[] = [];
    for (let i = 0; i < N; i++) {
      const t0 = performance.now();
      loadFitFromBuffer(buf);
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    const median = times[Math.floor(N / 2)]!;
    const min = times[0]!;
    const max = times[N - 1]!;

    // Visible diagnostic so a slow-but-passing run is surfaced in the
    // test runner output. RESEARCH measured 1.85 ms median on synthetic
    // data; real perf-1hr.fit will be slower but still well under 50.
    // eslint-disable-next-line no-console
    console.log(
      `[perf gate] perf-1hr.fit parse times (ms): min=${min.toFixed(2)} ` +
        `median=${median.toFixed(2)} max=${max.toFixed(2)} (n=${N})`,
    );

    expect(median).toBeLessThan(50);
  });
});
