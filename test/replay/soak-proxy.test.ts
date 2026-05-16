/**
 * Phase 3 Plan 03-04 Task 1 — REPL-03 drift gate (algorithm proxy).
 *
 * REPL-03 says "drift-corrected scheduler: end time within 250 ms of FIT
 * duration over a 30-minute replay". This file is the CI-TIER PROXY for
 * that gate. It runs in ~30 seconds by replaying perf-1hr.fit at
 * speed=~152 (compressing the 76-minute fixture to 30 seconds wall-clock).
 *
 * The proxy is a regression detector for algorithm bugs (e.g., a future
 * change reverts to setInterval, or drops absolute-target-time correction).
 * It CANNOT prove REPL-03 by itself — environmental drift (long GC pauses,
 * OS scheduler hiccups, NTP corrections) only manifests over real
 * wall-clock time. The 30-minute real soak (soak.test.ts, gated on
 * RUN_SOAK=1) is the actual REPL-03 acceptance gate.
 *
 * Per RESEARCH §Soak test recommendation we ship BOTH because they catch
 * different failure modes.
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

describe('Phase 3 REPL-03 drift gate (algorithm proxy)', () => {
  it('replays perf-1hr.fit compressed to ~30 sec; wall-clock within ±2000 ms of target', async () => {
    // Step 1 — Load the fixture via the public surface (D-REPL-12 keeps
    // Replay internal, but loadFitFromBuffer is Phase 2's public loader).
    const buf = readFileSync(resolve(FIXTURE_DIR, 'perf-1hr.fit'));
    const records = loadFitFromBuffer(buf);

    // Step 2 — Compute the speed multiplier dynamically from the fixture's
    // actual FIT duration. perf-1hr.fit is 76 minutes (4562 records); a
    // 30-second wall-clock target gives speed≈152. Computing from the
    // fixture (rather than hard-coding 152) keeps the math correct if the
    // fixture's duration ever changes in a future re-scrub.
    const fitDurationMs =
      records.at(-1)!.timestamp - records[0]!.timestamp;
    const targetWallClockMs = 30_000;
    const speed = fitDurationMs / targetWallClockMs;

    // Step 3 — Construct Replay with a high maxEmissionHz so the per-tick
    // floor (1000/maxEmissionHz ms) does NOT throttle dense records during
    // compression. At speed=152 the average inter-emission delay for
    // 1Hz-source records is ~6.6 ms — well above the 0.1 ms floor at
    // maxEmissionHz=10_000. Emissions complete naturally without clamping.
    const replay = new Replay({
      records,
      speed,
      loop: false,
      maxEmissionHz: 10_000,
    });

    // Step 4 — Subscribe before start() (D-REPL-11 single-subscriber slot;
    // see replay.ts §Pitfall 10 silent-drop avoidance).
    let count = 0;
    replay.onRecord(() => {
      count++;
    });

    // Step 5 — Bracket the replay with performance.now() per the
    // test/fit/perf.test.ts analog. Real timers only — fake-timer mocking
    // would defeat the wall-clock measurement this proxy exists to make.
    const t0 = performance.now();
    replay.start();
    await replay.completed;
    const elapsed = performance.now() - t0;

    // Step 6 — Diagnostic console.log so a slow-but-passing run is visible
    // in the test runner output (PATTERNS analog test/fit/perf.test.ts L62).
    // eslint-disable-next-line no-console
    console.log(
      `[soak proxy] perf-1hr.fit @ speed=${speed.toFixed(2)} ` +
        `elapsed=${elapsed.toFixed(2)}ms target=${targetWallClockMs}ms ` +
        `records-emitted=${count}/${records.length}`,
    );

    // Step 7 — Assertions.
    // 7a — All records were emitted (algorithm did not silently drop tail).
    expect(count).toBe(records.length);
    // 7b — Final state transitioned to 'done' (natural completion, not
    //      aborted; D-REPL-07 single-use lock).
    expect(replay.currentState).toBe('done');
    // 7c — Actually waited (sanity check: not a no-op that resolved
    //      immediately because of a setInterval-style fast-loop bug).
    expect(elapsed).toBeGreaterThan(targetWallClockMs - 2000);
    // 7d — Algorithm not pathologically slow (catches O(N²) or excessive
    //      per-tick overhead). The ±2000 ms tolerance (~7%) covers up to
    //      25× CI slowdown over RESEARCH's 0.00 ms drift baseline.
    expect(elapsed).toBeLessThan(targetWallClockMs + 2000);
  }, 60_000);
});
