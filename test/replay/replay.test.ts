// Phase 3 Plan 03-03 Task 2 — unit tests for the Replay class lifecycle.
//
// SUT: src/replay/replay.ts (built in plan 03-02 task 1; sleep-passthrough
//   added by plan 03-03 fix commit).
// Direct unit-test import via the internal path is acceptable because
// D-REPL-12 keeps the entire replay surface internal in this phase —
// `src/index.ts` is NOT extended.
//
// Locked decisions / requirements exercised:
//   - REPL-05 (replay.completed Promise resolves on stop-at-end — Group 1).
//   - D-REPL-07 (single-use lock — Group 3).
//   - D-REPL-08 (Promise-first completion surface — Group 1).
//   - D-REPL-11 (single-subscriber lock; subscriber-not-set throw — Group 2).
//   - D-REPL-10 partial (idempotent stop — Group 5).
//   - D-REPL-14 (vi.useFakeTimers throughout — beforeEach / afterEach).
//   - RESEARCH §Pitfall 4 — pre-aborted external signal causes synchronous
//     throw from start() (Group 4).
//   - RESEARCH §Pitfall 5 — vi.advanceTimersByTimeAsync (NEVER the sync variant).
//   - RESEARCH §Pitfall 6 — module-import-binding capture: tests inject a
//     `globalThis.setTimeout`-based sleep via `replay.start({ sleep })`.
//   - RESEARCH §Pitfall 10 — subscriber-not-set silent-drop avoidance:
//     start() throws if onRecord was never called (Group 2).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Replay } from '../../src/replay/replay.js';
import type { RideRecord } from '../../src/types.js';
import { fakeAwareSleep } from '../_helpers/fake-aware-sleep.js';

/**
 * Helper — construct N synthetic records with a fixed ms cadence. Mirrors the
 * test/ftms/indoor-bike-data.test.ts module-local helper pattern (PATTERNS
 * §Helper functions defined inside the test file).
 */
function makeRecords(count: number, cadenceMs = 100): RideRecord[] {
  return Array.from({ length: count }, (_, i) => ({ timestamp: 1000 + i * cadenceMs }));
}

describe('Replay — fake-timer lifecycle tests', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Group 1 — D-REPL-08 + REPL-05: completed Promise resolves on stop-at-end', () => {
    it('completed resolves AND currentState transitions to "done" on natural completion', async () => {
      // 3 records over 200ms; speed=1 → 200ms total fake-clock time.
      const records: RideRecord[] = [
        { timestamp: 1000 },
        { timestamp: 1100 },
        { timestamp: 1200 },
      ];
      const emitted: RideRecord[] = [];
      const replay = new Replay({
        records,
        speed: 1,
        loop: false,
        maxEmissionHz: 1000,
      });
      replay.onRecord((r) => emitted.push(r));
      replay.start({ sleep: fakeAwareSleep });

      // Drive past the end of the FIT timeline.
      await vi.advanceTimersByTimeAsync(300);
      // completed must resolve (does NOT reject).
      await replay.completed;
      expect(replay.currentState).toBe('done');
      // All 3 records emitted by the time completed resolves.
      expect(emitted).toHaveLength(3);
    });

    it('emission count matches records.length BEFORE completed resolves', async () => {
      // The Promise resolution semantics — completed only fires AFTER the
      // last record is emitted, not before. Asserts the ordering invariant.
      const records = makeRecords(3, 50);
      const emitted: RideRecord[] = [];
      const replay = new Replay({
        records,
        speed: 1,
        loop: false,
        maxEmissionHz: 1000,
      });
      replay.onRecord((r) => emitted.push(r));
      replay.start({ sleep: fakeAwareSleep });

      // Push past the end so the scheduler returns naturally.
      await vi.advanceTimersByTimeAsync(200);

      // At THIS point, before awaiting completed — but we still await it for
      // the test to finish. The key invariant is: when completed resolves,
      // emitted.length === records.length. We assert by awaiting completed
      // and immediately reading emitted (which cannot have grown further
      // because the scheduler has returned).
      await replay.completed;
      expect(emitted.length).toBe(records.length);
    });
  });

  describe('Group 2 — D-REPL-11: single-subscriber lock + RESEARCH §Pitfall 10: subscriber-not-set throw', () => {
    it('onRecord throws on the second call (single-subscriber lock)', () => {
      const replay = new Replay({
        records: makeRecords(2),
        speed: 1,
        loop: false,
        maxEmissionHz: 1000,
      });
      replay.onRecord(() => undefined);
      expect(() => replay.onRecord(() => undefined)).toThrow(/D-REPL-11|single.subscriber/i);
    });

    it('start() throws when subscriber not set (Pitfall 10 silent-drop avoidance)', () => {
      const replay = new Replay({
        records: makeRecords(2),
        speed: 1,
        loop: false,
        maxEmissionHz: 1000,
      });
      // No onRecord call — subscriber is undefined.
      expect(() => replay.start({ sleep: fakeAwareSleep })).toThrow(/subscriber|onRecord/i);
    });

    it('disposer + re-attach contract — observe and lock the actual semantics', async () => {
      // The plan flagged this as discovery: per plan 03-02 task 1 step 3d's
      // implementation, onRecord throws if state !== 'idle' regardless of
      // subscriber slot freedom. So even after dispose(), if the state has
      // moved on, re-attach fails for the state reason. While the slot is
      // empty AND state is still 'idle', re-attach must succeed.
      const replay = new Replay({
        records: makeRecords(2),
        speed: 1,
        loop: false,
        maxEmissionHz: 1000,
      });
      const dispose = replay.onRecord(() => undefined);
      // Subscriber slot occupied — second onRecord throws (single-subscriber
      // lock, NOT state lock — verified by the order of guards in the SUT
      // src/replay/replay.ts: `subscriber !== undefined` checks before
      // `state !== 'idle'`).
      expect(() => replay.onRecord(() => undefined)).toThrow();
      // Free the slot via the disposer.
      dispose();
      // While state is still 'idle', re-attach succeeds.
      expect(replay.currentState).toBe('idle');
      const dispose2 = replay.onRecord(() => undefined);
      // And the new disposer is callable.
      expect(typeof dispose2).toBe('function');
    });
  });

  describe('Group 3 — D-REPL-07: single-use lock (start() throws after done/aborted)', () => {
    it('start() throws after natural completion (state === "done")', async () => {
      const replay = new Replay({
        records: makeRecords(2, 50),
        speed: 1,
        loop: false,
        maxEmissionHz: 1000,
      });
      replay.onRecord(() => undefined);
      replay.start({ sleep: fakeAwareSleep });
      await vi.advanceTimersByTimeAsync(200);
      await replay.completed;
      expect(replay.currentState).toBe('done');
      // Second start() must throw — single-use lock.
      expect(() => replay.start({ sleep: fakeAwareSleep })).toThrow(/D-REPL-07|single.use|state/i);
    });

    it('start() throws after stop() mid-replay (state === "aborted")', async () => {
      const replay = new Replay({
        records: makeRecords(10, 50),
        speed: 1,
        loop: false,
        maxEmissionHz: 1000,
      });
      replay.onRecord(() => undefined);
      replay.start({ sleep: fakeAwareSleep });
      // Begin replay; abort mid-flight.
      await vi.advanceTimersByTimeAsync(75);
      replay.stop();
      // Let the scheduler's AbortError land in the .then failure branch.
      await replay.completed.catch(() => undefined);
      expect(replay.currentState).toBe('aborted');
      expect(() => replay.start({ sleep: fakeAwareSleep })).toThrow(/D-REPL-07|single.use|state/i);
    });
  });

  describe('Group 4 — RESEARCH §Pitfall 4: pre-aborted external signal throws synchronously', () => {
    it('start({ signal }) with a pre-aborted signal throws synchronously', () => {
      const replay = new Replay({
        records: makeRecords(2),
        speed: 1,
        loop: false,
        maxEmissionHz: 1000,
      });
      replay.onRecord(() => undefined);
      const controller = new AbortController();
      controller.abort('reason X');
      // Synchronous throw — does NOT become an unhandled-rejection on
      // replay.completed (per plan 03-02 task 1 step 3e guard 4).
      expect(() => replay.start({ signal: controller.signal, sleep: fakeAwareSleep })).toThrow(/aborted|D-REPL-09/i);
    });
  });

  describe('Group 5 — D-REPL-10 partial: stop() before/after start() is idempotent', () => {
    it('stop() before start() is a no-op (currentState stays "idle")', () => {
      const replay = new Replay({
        records: makeRecords(2),
        speed: 1,
        loop: false,
        maxEmissionHz: 1000,
      });
      // Multiple stop() calls before start: idempotent.
      replay.stop();
      replay.stop();
      replay.stop();
      expect(replay.currentState).toBe('idle');
    });

    it('stop() after natural completion is a no-op (currentState stays "done")', async () => {
      const replay = new Replay({
        records: makeRecords(2, 50),
        speed: 1,
        loop: false,
        maxEmissionHz: 1000,
      });
      replay.onRecord(() => undefined);
      replay.start({ sleep: fakeAwareSleep });
      await vi.advanceTimersByTimeAsync(200);
      await replay.completed;
      expect(replay.currentState).toBe('done');
      // stop() after done — idempotent no-op.
      replay.stop();
      replay.stop();
      expect(replay.currentState).toBe('done');
    });
  });
});
