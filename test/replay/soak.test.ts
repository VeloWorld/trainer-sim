/**
 * Phase 3 Plan 03-04 Task 2 — REPL-03 drift gate (real 30-min soak).
 *
 * REPL-03 says "end time within 250 ms of FIT duration over a 30-minute
 * replay". This file IS the acceptance gate for that requirement. It
 * loads perf-1hr.fit (76 minutes), slices the first 30 min worth of
 * records, replays them at speed=1 in real time, and asserts the
 * wall-clock duration matches FIT duration to within 250 ms.
 *
 * Wall-clock cost: 30 minutes per run. Gated on `RUN_SOAK=1` env var per
 * D-REPL-15. Run pre-release: `RUN_SOAK=1 npm test` or
 * `RUN_SOAK=1 npx vitest run test/replay/soak.test.ts`.
 *
 * Per RESEARCH §Soak test recommendation: this test catches environmental
 * drift (long GC pauses, OS scheduler hiccups, NTP corrections) that the
 * 30-second proxy in soak-proxy.test.ts cannot reproduce.
 *
 * Vitest per-test timeout: 32 minutes (2-min headroom over 30-min target).
 *
 * Real timers ONLY (no fake-timer mocking — see plan 03-04).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { loadFitFromBuffer } from '../../src/index.js';
import { Replay } from '../../src/replay/replay.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = resolve(__dirname, '../fixtures/fit');

// describe.skipIf takes a boolean: `!process.env.RUN_SOAK` is `true` when
// unset (skip), `false` when set (run). When the suite skips, vitest reports
// it cleanly without noise — that's the locked D-REPL-15 contract (analog of
// D-FIT-04 used by test/fit/local.test.ts).
describe.skipIf(!process.env.RUN_SOAK)(
  'Phase 3 REPL-03 drift gate (real 30-min soak)',
  () => {
    it('replays a 30-min slice of perf-1hr.fit at speed=1; ends within 250 ms of FIT duration', async () => {
      // Step 1 — Load the fixture and slice to the first 30 minutes of
      // FIT-relative time. perf-1hr.fit is 76 min, so the slice is well-
      // defined. Slicing by timestamp delta (not by index/count) keeps
      // the math correct for non-1Hz fixtures.
      const buf = readFileSync(resolve(FIXTURE_DIR, 'perf-1hr.fit'));
      const all = loadFitFromBuffer(buf);
      const startTs = all[0]!.timestamp;
      const thirtyMinMs = 30 * 60 * 1000;
      const records = all.filter((r) => r.timestamp - startTs <= thirtyMinMs);
      const fitDurationMs =
        records.at(-1)!.timestamp - records[0]!.timestamp;

      // Step 2 — Construct Replay at speed=1 (real time). maxEmissionHz
      // default of 1000 is fine for 1Hz-source records — no clamping needed.
      const replay = new Replay({
        records,
        speed: 1,
        loop: false,
        maxEmissionHz: 1000,
      });

      // Step 3 — Subscribe before start() (D-REPL-11 single-subscriber slot).
      let count = 0;
      replay.onRecord(() => {
        count++;
      });

      // Step 4 — Bracket and run. Real timers only — fake-timer mocking
      // would defeat the wall-clock measurement this soak exists to make.
      const t0 = performance.now();
      replay.start();
      await replay.completed;
      const elapsed = performance.now() - t0;

      // Step 5 — Diagnostic console.log so the actual measured drift is
      // captured in test runner output for future regression triage
      // (PATTERNS analog test/fit/perf.test.ts L62).
      // eslint-disable-next-line no-console
      console.log(
        `[soak] 30-min slice of perf-1hr.fit: fitDuration=${fitDurationMs}ms ` +
          `elapsed=${elapsed.toFixed(2)}ms drift=${(elapsed - fitDurationMs).toFixed(2)}ms ` +
          `records=${count}/${records.length}`,
      );

      // Step 6 — Assertions.
      // 6a — All sliced records were emitted.
      expect(count).toBe(records.length);
      // 6b — Final state transitioned to 'done'.
      expect(replay.currentState).toBe('done');
      // 6c — REPL-03 acceptance gate: wall-clock within 250 ms of FIT
      //      duration. This is the literal threshold; widening it defeats
      //      the requirement (T-03-16 in the threat register).
      expect(Math.abs(elapsed - fitDurationMs)).toBeLessThan(250);
    }, 32 * 60 * 1000); // 32-min vitest per-test timeout (2-min headroom)
  },
);
