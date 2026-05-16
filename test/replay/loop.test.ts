// Phase 3 Plan 03-03 Task 4 — unit tests for REPL-04 loop boundary semantics.
//
// SUT: src/replay/replay.ts (Replay class wraps the scheduler) and the
// scheduler's loop-boundary re-base (D-REPL-06). D-REPL-12 keeps the
// surface internal — tests import via '../../src/replay/replay.js'.
//
// Locked decisions / requirements exercised:
//   - REPL-04 (loop=true restarts without drift accumulation across loop
//     boundaries — Group 1).
//   - D-REPL-06 (re-base baseline on each loop iteration — Groups 1, 2).
//   - D-REPL-14 (vi.useFakeTimers throughout).
//   - RESEARCH §Pitfall 5 — vi.advanceTimersByTimeAsync (NEVER sync).
//   - RESEARCH §Pitfall 6 — module-binding capture; tests inject sleep via
//     replay.start({ sleep }).
//   - RESEARCH §Pitfall 7 — loop boundary drift accumulation. The negative
//     test in Group 2 asserts that iteration 2 does NOT burst-emit — the
//     re-base happened correctly.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Replay } from '../../src/replay/replay.js';
import type { RideRecord } from '../../src/types.js';
import { fakeAwareSleep } from '../_helpers/fake-aware-sleep.js';

describe('Replay — loop boundary tests', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Group 1 — D-REPL-06 + REPL-04: three iterations within ±5ms drift', () => {
    it('three iterations of a 3-record/1-second fixture, each first-emission within ±5ms of expected', async () => {
      // RESEARCH §Code Examples 3 (lines 705-731) — verbatim adapted.
      // 3 records over 1 second.
      const records: RideRecord[] = [
        { timestamp: 0 },
        { timestamp: 500 },
        { timestamp: 1000 },
      ];
      const emissionTimes: number[] = [];
      const replay = new Replay({
        records,
        speed: 1,
        loop: true,
        maxEmissionHz: 1000,
      });
      replay.onRecord(() => emissionTimes.push(globalThis.performance.now()));
      replay.start({ sleep: fakeAwareSleep });
      // Eager catch — looping replay is aborted via stop() at the end and
      // we don't want the rejection to register as unhandled.
      replay.completed.catch(() => undefined);

      // Advance through 3 iterations + a bit more (3 × 1000ms + 500ms slack).
      await vi.advanceTimersByTimeAsync(3500);
      replay.stop();
      await replay.completed.catch(() => undefined);

      // First emission of each iteration is at offset 0, 1000, 2000.
      // Pick every 3rd entry (indices 0, 3, 6 — first record of each loop iter).
      const firsts: number[] = [];
      for (let i = 0; i < emissionTimes.length; i += 3) {
        firsts.push(emissionTimes[i]!);
      }
      // We expect at least 3 iterations to have completed.
      expect(firsts.length).toBeGreaterThanOrEqual(3);

      // Inter-iteration drift: each iteration's first-record-offset within
      // ±5ms of the FIT period (1000ms). Under fake timers the math is
      // exact modulo microtask ordering — the slop covers the emit-microtask
      // boundary. Tolerance is intentionally tight per plan acceptance and
      // RESEARCH §Code Examples 3 (do NOT widen — Pitfall 7's regression
      // surface depends on the tight assertion).
      expect(Math.abs(firsts[1]! - firsts[0]! - 1000)).toBeLessThan(5);
      expect(Math.abs(firsts[2]! - firsts[1]! - 1000)).toBeLessThan(5);
    });
  });

  describe('Group 2 — RESEARCH §Pitfall 7 negative test: iteration 2 does NOT burst-emit', () => {
    it('after iteration 1 completes, advancing 100ms into iteration 2 yields exactly one additional emission', async () => {
      // 3 records over 1 second; loop=true.
      const records: RideRecord[] = [
        { timestamp: 0 },
        { timestamp: 500 },
        { timestamp: 1000 },
      ];
      const emitted: number[] = [];
      const replay = new Replay({
        records,
        speed: 1,
        loop: true,
        maxEmissionHz: 1000,
      });
      replay.onRecord((r) => emitted.push(r.timestamp));
      replay.start({ sleep: fakeAwareSleep });
      replay.completed.catch(() => undefined);

      // Advance through the entirety of iteration 1 (1000ms covers 0/500/1000).
      await vi.advanceTimersByTimeAsync(1000);
      const afterIter1 = emitted.length;
      // Iteration 1 emitted 3 records.
      expect(afterIter1).toBe(3);

      // Advance 100ms into iteration 2 — between records 0 (ts=0) and 1
      // (ts=500). Expect exactly ONE additional emission (the iteration-2
      // record at ts=0). Without the loop-boundary re-base (D-REPL-06),
      // ALL THREE iteration-2 records would burst-emit instantly because
      // their absolute targets would be in the past.
      await vi.advanceTimersByTimeAsync(100);
      const afterIter2Partial = emitted.length;
      expect(afterIter2Partial - afterIter1).toBe(1);

      // Cleanly halt the looping replay.
      replay.stop();
      await replay.completed.catch(() => undefined);
    });
  });

  describe('Group 3 — loop=true does NOT auto-transition to "done"', () => {
    it('currentState stays "running" across multiple iterations until stop() is called', async () => {
      const records: RideRecord[] = [
        { timestamp: 0 },
        { timestamp: 500 },
        { timestamp: 1000 },
      ];
      const replay = new Replay({
        records,
        speed: 1,
        loop: true,
        maxEmissionHz: 1000,
      });
      replay.onRecord(() => undefined);
      replay.start({ sleep: fakeAwareSleep });
      replay.completed.catch(() => undefined);

      // Advance through 5 iterations worth of fake time (5 × 1000ms).
      await vi.advanceTimersByTimeAsync(5000);
      // loop=true never reaches 'done' on its own.
      expect(replay.currentState).toBe('running');

      // Now call stop() and assert the transition to 'aborted'.
      replay.stop();
      await replay.completed.catch(() => undefined);
      expect(replay.currentState).toBe('aborted');
    });
  });
});
