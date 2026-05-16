// Phase 3 Plan 03-03 Task 1 — unit tests for the pure runScheduler function.
//
// SUT: src/replay/scheduler.ts (built in plan 03-01 task 2; sleep injection
//   seam added by plan 03-03 task 1 deviation §1 — see 03-03-SUMMARY.md).
// Direct unit-test import is acceptable here (NOT public-surface) because:
//   - runScheduler is a pure async function with a well-defined input/output
//     contract (SchedulerInput → Promise<void>) — D-REPL-13 file split puts
//     the algorithm in its own module specifically so it is unit-testable in
//     isolation, with no class instance / no AbortController plumbing.
//   - D-REPL-12 keeps the entire replay surface internal in this phase —
//     `src/index.ts` is NOT extended. Tests therefore import via the
//     internal path `../../src/replay/scheduler.js` rather than through
//     `../../src/index.js`.
//
// Locked decisions / requirements exercised:
//   - REPL-01 (records emit at FIT-relative cadence — Group 1).
//   - REPL-02 (numeric speed multiplier including Infinity, with maxEmissionHz
//     cap — Groups 2, 3, 4).
//   - D-REPL-04 (speed === Infinity falls through to the maxEmissionHz floor
//     via Math.max clamp — Group 3).
//   - D-REPL-14 (vi.useFakeTimers throughout — beforeEach / afterEach).
//   - RESEARCH §Pitfall 5 — vi.advanceTimersByTimeAsync (NEVER the sync
//     variant — silently-wrong results when promise chains span ticks).
//   - RESEARCH §Pitfall 6 — module-import-binding capture: tests inject a
//     `globalThis.setTimeout`-based sleep because Vitest 4 only fakes the
//     global setTimeout, NOT the `node:timers/promises` static-import binding.
//     The injection seam mirrors `getNow`'s seam (same root cause).
//   - RESEARCH §Pitfall 8 — speed === Infinity at cursor === 0 deterministic
//     guard (the single-record array case).
//   - RESEARCH §Pitfall 9 — empty-records early return (Group 5).
//   - RESEARCH Assumptions A1 — vi.useFakeTimers fakes globalThis.performance.now()
//     by default (setup-sanity test below — fails immediately if Vitest 4
//     ever silently drops `performance` from default toFake).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runScheduler } from '../../src/replay/scheduler.js';
import type { RideRecord } from '../../src/types.js';
import { fakeAwareSleep } from '../_helpers/fake-aware-sleep.js';

/**
 * Helper — construct N synthetic records with a fixed ms cadence. Mirrors the
 * test/ftms/indoor-bike-data.test.ts "helper functions defined inside the
 * test file" pattern (PATTERNS §Helper functions). Used by Group 3's Infinity
 * test to keep the array construction noise out of the it() body.
 */
function makeRecords(count: number, cadenceMs = 100): RideRecord[] {
  return Array.from({ length: count }, (_, i) => ({ timestamp: i * cadenceMs }));
}

describe('runScheduler — fake-timer unit tests', () => {
  beforeEach(() => {
    // vi.useFakeTimers() (no args) fakes setTimeout, clearTimeout, AND
    // globalThis.performance.now() per @sinonjs/fake-timers default toFake set
    // (RESEARCH Assumptions A1). The setup-sanity test below verifies this
    // assumption defensively.
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('sanity: vi.advanceTimersByTimeAsync advances globalThis.performance.now (RESEARCH Assumptions A1)', async () => {
    const t0 = globalThis.performance.now();
    await vi.advanceTimersByTimeAsync(100);
    const t1 = globalThis.performance.now();
    const delta = t1 - t0;
    // ±1 ms tolerance for fake-timer arithmetic; in practice the math is exact.
    expect(delta).toBeGreaterThanOrEqual(99);
    expect(delta).toBeLessThanOrEqual(101);
  });

  describe('Group 1 — REPL-01: emission cadence at FIT-relative timestamps', () => {
    it('emits 3 records at FIT-relative cadence (t=0, t=+500ms, t=+1200ms)', async () => {
      // RESEARCH §Vitest fake-timer interaction recipe (lines 379-408) — canonical pattern.
      const records: RideRecord[] = [
        { timestamp: 1000 }, // t=0 (firstTs anchor)
        { timestamp: 1500 }, // t=+500ms
        { timestamp: 2200 }, // t=+1200ms total
      ];
      const emitted: RideRecord[] = [];
      const ac = new AbortController();

      // Kick off the scheduler — its returned Promise we'll await at the end.
      const done = runScheduler({
        records,
        speed: 1,
        loop: false,
        maxEmissionHz: 1000,
        signal: ac.signal,
        emit: (r) => emitted.push(r),
        getNow: () => globalThis.performance.now(),
        sleep: fakeAwareSleep,
      });

      // Always Async (Pitfall 5).
      await vi.advanceTimersByTimeAsync(500);
      // First record fires at t=0; second at t=+500. 500ms after start → 2 emitted.
      expect(emitted).toHaveLength(2);

      await vi.advanceTimersByTimeAsync(700);
      // 1200ms after start → 3rd record (t=+1200) fires.
      expect(emitted).toHaveLength(3);

      // Scheduler returns naturally on records exhaustion.
      await done;
      expect(emitted.map((r) => r.timestamp)).toEqual([1000, 1500, 2200]);
    });
  });

  describe('Group 2 — REPL-02: speed multiplier (1x, 2x, 0.5x)', () => {
    it('speed=2 — 2-record 1-second gap completes in 500ms wall-clock', async () => {
      const records: RideRecord[] = [
        { timestamp: 0 },
        { timestamp: 1000 }, // 1-second FIT gap
      ];
      const emitted: RideRecord[] = [];
      const ac = new AbortController();

      const done = runScheduler({
        records,
        speed: 2,
        loop: false,
        maxEmissionHz: 1000,
        signal: ac.signal,
        emit: (r) => emitted.push(r),
        getNow: () => globalThis.performance.now(),
        sleep: fakeAwareSleep,
      });

      // 1-second FIT gap at speed=2 → 500ms wall-clock.
      await vi.advanceTimersByTimeAsync(500);
      expect(emitted).toHaveLength(2);
      await done;
      expect(emitted.map((r) => r.timestamp)).toEqual([0, 1000]);
    });

    it('speed=0.5 — 2-record 1-second gap takes 2000ms wall-clock', async () => {
      const records: RideRecord[] = [
        { timestamp: 0 },
        { timestamp: 1000 },
      ];
      const emitted: RideRecord[] = [];
      const ac = new AbortController();

      const done = runScheduler({
        records,
        speed: 0.5,
        loop: false,
        maxEmissionHz: 1000,
        signal: ac.signal,
        emit: (r) => emitted.push(r),
        getNow: () => globalThis.performance.now(),
        sleep: fakeAwareSleep,
      });

      // After 1500ms wall-clock the 2nd record (FIT t=+1000ms at speed=0.5
      // = 2000ms wall-clock) has not fired yet.
      await vi.advanceTimersByTimeAsync(1500);
      expect(emitted).toHaveLength(1);

      // After another 500ms (2000ms total) the 2nd record fires.
      await vi.advanceTimersByTimeAsync(500);
      expect(emitted).toHaveLength(2);
      await done;
      expect(emitted.map((r) => r.timestamp)).toEqual([0, 1000]);
    });
  });

  describe('Group 3 — REPL-02: speed=Infinity + maxEmissionHz cap (RESEARCH §Code Examples 4)', () => {
    it('1000 records at speed=Infinity, maxEmissionHz=100 → 10s wall-clock', async () => {
      // 100 Hz cap → 10ms minimum delay between emissions → 1000 × 10ms = 10000ms.
      const records = makeRecords(1000, 100);
      let count = 0;
      const ac = new AbortController();

      const done = runScheduler({
        records,
        speed: Infinity,
        loop: false,
        maxEmissionHz: 100,
        signal: ac.signal,
        emit: () => {
          count++;
        },
        getNow: () => globalThis.performance.now(),
        sleep: fakeAwareSleep,
      });

      await vi.advanceTimersByTimeAsync(10_000);
      await done;
      expect(count).toBe(1000);
    });
  });

  describe('Group 4 — RESEARCH §Pitfall 8: speed=Infinity at cursor=0 single-record case', () => {
    it('1-record array at speed=Infinity, maxEmissionHz=1000 fires within 1ms', async () => {
      // RESEARCH §Pitfall 8: (0 - 0) / Infinity === NaN at cursor=0. The
      // scheduler's explicit `speed === Infinity ? 0 : ...` guard makes this
      // deterministic; with maxEmissionHz=1000 the floor is exactly 1ms.
      const records: RideRecord[] = [{ timestamp: 5000 }];
      let count = 0;
      const ac = new AbortController();

      const done = runScheduler({
        records,
        speed: Infinity,
        loop: false,
        maxEmissionHz: 1000,
        signal: ac.signal,
        emit: () => {
          count++;
        },
        getNow: () => globalThis.performance.now(),
        sleep: fakeAwareSleep,
      });

      // 1000Hz cap → 1ms floor; advancing 2ms is plenty.
      await vi.advanceTimersByTimeAsync(2);
      await done;
      expect(count).toBe(1);
    });
  });

  describe('Group 5 — RESEARCH §Pitfall 9: empty-records early return', () => {
    it('0-record array resolves immediately without emitting', async () => {
      const records: RideRecord[] = [];
      let count = 0;
      const ac = new AbortController();

      const done = runScheduler({
        records,
        speed: 1,
        loop: false,
        maxEmissionHz: 1000,
        signal: ac.signal,
        emit: () => {
          count++;
        },
        getNow: () => globalThis.performance.now(),
        sleep: fakeAwareSleep,
      });

      // No need to advance any fake timers — the scheduler must return on
      // the very first line of the function body. A single microtask drain
      // is enough.
      await Promise.resolve();
      await done;
      expect(count).toBe(0);
    });
  });
});
