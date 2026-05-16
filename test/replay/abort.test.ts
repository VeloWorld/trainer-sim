// Phase 3 Plan 03-03 Task 3 — unit tests for REPL-06 cancellation invariants.
//
// SUT: src/replay/replay.ts (Replay.start({ signal? }) + Replay.stop()).
// D-REPL-12 keeps the surface internal — tests import via '../../src/replay/replay.js'.
//
// Locked decisions / requirements exercised:
//   - REPL-06 (after stop()/abort, no further onData callbacks fire — Group 1).
//   - D-REPL-09 (AbortController-based cancellation; external signal path —
//     Group 2; AbortSignal.any composition — Group 3).
//   - D-REPL-10 (no emissions after abort; single-pending-tick guarantee —
//     Group 4).
//   - D-REPL-14 (vi.useFakeTimers throughout).
//   - RESEARCH §Open Question 2 — completed rejects with `{ name: 'AbortError' }`
//     (per node:timers/promises rejection convention).
//   - RESEARCH §Open Question 3 — external + internal abort race composition.
//   - RESEARCH §Pitfall 5 — vi.advanceTimersByTimeAsync (NEVER sync variant).
//   - RESEARCH §Pitfall 6 — module-binding capture; tests inject sleep via
//     replay.start({ sleep }).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Replay } from '../../src/replay/replay.js';
import type { RideRecord } from '../../src/types.js';
import { fakeAwareSleep } from '../_helpers/fake-aware-sleep.js';

/**
 * Helper — N synthetic records with a fixed ms cadence (PATTERNS §Helper
 * functions defined inside the test file).
 */
function makeRecords(count: number, cadenceMs = 100): RideRecord[] {
  return Array.from({ length: count }, (_, i) => ({ timestamp: 1000 + i * cadenceMs }));
}

describe('Replay — abort / cancellation tests', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Group 1 — REPL-06: stop() mid-replay → zero emissions in 100ms wait + completed rejects with AbortError', () => {
    it('replay.stop() mid-flight halts further emissions; replay.completed rejects with AbortError', async () => {
      // RESEARCH §Code Examples 2 (lines 670-700) — verbatim adapted.
      const records: RideRecord[] = [
        { timestamp: 1000 },
        { timestamp: 1100 },
        { timestamp: 1200 },
        { timestamp: 1300 },
        { timestamp: 1400 },
      ];
      const emitted: number[] = [];
      const replay = new Replay({
        records,
        speed: 1,
        loop: false,
        maxEmissionHz: 1000,
      });
      replay.onRecord((r) => emitted.push(r.timestamp));
      replay.start({ sleep: fakeAwareSleep });

      // Attach a no-op failure handler eagerly so the eventual rejection
      // does NOT register as an unhandled-rejection during the intermediate
      // `await vi.advanceTimersByTimeAsync(...)` waits before the
      // `await expect(...).rejects` assertion runs. The original
      // `replay.completed` promise remains rejected — we observe it both
      // ways below.
      replay.completed.catch(() => undefined);

      // First two emissions: t=0 (1000) and t=+100 (1100).
      await vi.advanceTimersByTimeAsync(150);
      expect(emitted).toEqual([1000, 1100]);

      replay.stop();
      const before = emitted.length;
      await vi.advanceTimersByTimeAsync(100);
      // No further emissions in the 100ms wait — REPL-06 invariant.
      expect(emitted.length).toBe(before);

      // completed rejects with AbortError (RESEARCH §Open Question 2 resolution).
      await expect(replay.completed).rejects.toMatchObject({ name: 'AbortError' });
      expect(replay.currentState).toBe('aborted');
    });
  });

  describe('Group 2 — D-REPL-09: external signal abort path → completed rejects', () => {
    it('controller.abort() (NOT replay.stop()) aborts the scheduler', async () => {
      const records = makeRecords(5);
      const emitted: number[] = [];
      const replay = new Replay({
        records,
        speed: 1,
        loop: false,
        maxEmissionHz: 1000,
      });
      replay.onRecord((r) => emitted.push(r.timestamp));
      const controller = new AbortController();
      replay.start({ signal: controller.signal, sleep: fakeAwareSleep });
      // Eager no-op failure handler avoids the unhandled-rejection trip during
      // the intermediate awaits (see Group 1 comment for the full rationale).
      replay.completed.catch(() => undefined);

      // Some emissions fire.
      await vi.advanceTimersByTimeAsync(50);
      const before = emitted.length;

      // Abort via the EXTERNAL controller — exercises the AbortSignal.any
      // composition path (D-REPL-09 + RESEARCH §Open Question 3).
      controller.abort();

      await vi.advanceTimersByTimeAsync(100);
      // No further emissions after the external abort.
      expect(emitted.length).toBe(before);

      await expect(replay.completed).rejects.toMatchObject({ name: 'AbortError' });
      expect(replay.currentState).toBe('aborted');
    });
  });

  describe('Group 3 — RESEARCH §Open Question 3: external + internal abort race / composition', () => {
    it('both controller.abort() AND replay.stop() in the same tick — only one rejection lands', async () => {
      const records = makeRecords(5);
      const replay = new Replay({
        records,
        speed: 1,
        loop: false,
        maxEmissionHz: 1000,
      });
      replay.onRecord(() => undefined);
      const controller = new AbortController();
      replay.start({ signal: controller.signal, sleep: fakeAwareSleep });

      await vi.advanceTimersByTimeAsync(50);

      // Race them in the same tick — both call sites are valid; whichever
      // fires first wins. Both reach 'aborted' state without throwing a
      // second time. The completed Promise rejects exactly once.
      controller.abort();
      replay.stop();

      // Cleanly observe the single rejection.
      await replay.completed.catch(() => undefined);
      expect(replay.currentState).toBe('aborted');
    });

    it('external abort AFTER replay.stop() — second abort is a no-op', async () => {
      const records = makeRecords(5);
      const replay = new Replay({
        records,
        speed: 1,
        loop: false,
        maxEmissionHz: 1000,
      });
      replay.onRecord(() => undefined);
      const controller = new AbortController();
      replay.start({ signal: controller.signal, sleep: fakeAwareSleep });

      await vi.advanceTimersByTimeAsync(50);
      replay.stop();
      // Allow the rejection to land first.
      await replay.completed.catch(() => undefined);
      expect(replay.currentState).toBe('aborted');

      // Now abort the external controller — replay is already aborted,
      // calling controller.abort() does NOT cause a second rejection or
      // a state change.
      controller.abort();
      // State remains 'aborted'.
      expect(replay.currentState).toBe('aborted');
    });
  });

  describe('Group 4 — D-REPL-10: no leftover timers / ghost emissions after abort (single pending tick)', () => {
    it('after stop(), no further emissions even after a long wait', async () => {
      // The setTimeout-chain primitive (D-REPL-01) has at most ONE pending
      // sleep at any moment. A single clearTimeout / abort suffices to halt
      // all further emissions. If a regression added multiple timer
      // schedules, this test catches the resulting ghost emissions.
      const records = makeRecords(10);
      const emitted: number[] = [];
      const replay = new Replay({
        records,
        speed: 1,
        loop: false,
        maxEmissionHz: 1000,
      });
      replay.onRecord((r) => emitted.push(r.timestamp));
      replay.start({ sleep: fakeAwareSleep });
      replay.completed.catch(() => undefined);

      // Three emissions fire (t=0, t=+100, t=+200).
      await vi.advanceTimersByTimeAsync(250);
      const before = emitted.length;
      expect(before).toBeGreaterThanOrEqual(3);

      replay.stop();
      // Wait FAR longer than any pending timer could have been scheduled
      // for. If there were leftover timers, emissions would continue.
      await vi.advanceTimersByTimeAsync(5000);
      expect(emitted.length).toBe(before);

      // completed rejects exactly once.
      await expect(replay.completed).rejects.toMatchObject({ name: 'AbortError' });
      expect(replay.currentState).toBe('aborted');
    });
  });

  describe('Group 5 — CR-01 regression: post-sleep abort window (D-REPL-10)', () => {
    it('abort that lands BETWEEN sleep-return and synchronous emit drops the would-be emission', async () => {
      // CR-01 race-window scenario: the scheduler's `await sleep(...)`
      // resolves naturally (timer fired), and BEFORE the subsequent
      // synchronous `emit(record)` runs, signal.aborted becomes true.
      // Without the post-sleep abort guard, one ghost emission fires.
      // With the guard (scheduler.ts step 4d), the scheduler sees
      // signal.aborted and throws signal.reason instead of emitting.
      //
      // We construct the race deterministically with a custom sleep that
      // (1) resolves the inner timer normally, then (2) flips signal.aborted
      // to true by calling replay.stop() in the same microtask, BEFORE the
      // awaiter resumes. The post-sleep guard is what catches it.
      const records = makeRecords(5);
      const emitted: number[] = [];
      let replayRef: Replay | undefined;

      // Race-injecting sleep: lets the FIRST sleep resolve cleanly (one
      // emission fires at cursor=0), then on the SECOND sleep we abort
      // exactly between resolve() and the awaiter's resumption.
      let sleepCount = 0;
      const raceSleep = (
        delay: number,
        _value?: undefined,
        options?: { signal?: AbortSignal },
      ): Promise<void> => {
        return new Promise<void>((resolve, reject) => {
          const signal = options?.signal;
          if (signal?.aborted) {
            const err = new Error('The operation was aborted');
            (err as { name: string }).name = 'AbortError';
            reject(err);
            return;
          }
          const onAbort = (): void => {
            clearTimeout(handle);
            const err = new Error('The operation was aborted');
            (err as { name: string }).name = 'AbortError';
            reject(err);
          };
          const handle = globalThis.setTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            sleepCount++;
            // On the SECOND sleep: engineer the CR-01 race.
            // Order matters here: (1) call resolve() — the timer winning
            // the race over abort; (2) THEN call replay.stop() — flipping
            // signal.aborted to true synchronously. The awaiter for this
            // sleep will resume in the next microtask, and at that point
            // signal.aborted === true. The post-sleep abort guard
            // (scheduler.ts step 4d) catches it; without the guard, the
            // synchronous emit fires anyway → ghost emission.
            if (sleepCount === 2) {
              resolve();
              replayRef?.stop();
            } else {
              resolve();
            }
          }, delay);
          signal?.addEventListener('abort', onAbort, { once: true });
        });
      };

      const replay = new Replay({
        records,
        speed: 1,
        loop: false,
        maxEmissionHz: 1000,
      });
      replayRef = replay;
      replay.onRecord((r) => emitted.push(r.timestamp));
      replay.start({ sleep: raceSleep });
      replay.completed.catch(() => undefined);

      // Drive enough fake-timer time for the first two sleeps to resolve.
      await vi.advanceTimersByTimeAsync(500);

      // Sleep 1 (cursor=0) resolves cleanly → emit(t=1000). emitted=[1000].
      // Sleep 2 (cursor=1) resolves and immediately aborts in the SAME timer
      // callback. With the fix (scheduler.ts step 4d): the post-sleep guard
      // sees signal.aborted=true and throws BEFORE emit fires — the cursor=1
      // record is NOT emitted. Without the fix: emit(t=1100) fires anyway —
      // a ghost emission, violating REPL-06 / D-REPL-10.
      //
      // Strict assertion: exactly ONE emission (cursor=0 only).
      expect(emitted).toEqual([1000]);
      // And the replay ends aborted, not done.
      await expect(replay.completed).rejects.toMatchObject({ name: 'AbortError' });
      expect(replay.currentState).toBe('aborted');
    });
  });
});
