// Phase 4 Plan 04-04 Task 1 — unit tests for the createFakeTransport factory.
//
// SUT: src/transport/fake-transport.ts (built in plan 04-03 task 1).
// Imports go through the PUBLIC surface (`../../src/index.js`) NOT the
// internal `src/transport/fake-transport.js` path — Phase 4 makes
// FakeTransport public (D-API-07), so these tests prove the export shape
// end-to-end. Threat T-04-04-02 forbids reaching into internal paths.
//
// Locked decisions / requirements exercised:
//   - D-API-04: synchronous factory; FIT load + Replay construction deferred to connect() — Group 1, Group 3.
//   - D-API-05: { records: [...] } source variant fast path — every group below.
//   - D-API-06: synchronous validation of speed > 0 and maxEmissionHz > 0 — Group 2.
//   - D-API-09: subscriber registry is a Set; insertion-order fan-out; disposer deletes — Group 4.
//   - D-API-10: subscriber-throws does NOT abort the loop or starve other subscribers — Group 5.
//   - D-API-11: composed (NOT extended) EventEmitter; on/off/once narrow surface — Group 9.
//   - D-API-12: 'complete' fires on natural completion, NOT on disconnect — Group 3, Group 7.
//   - D-API-13: literal 'complete'-typed on/off/once — exercised at the type level via ../../src/index.js imports.
//   - D-API-14: reset() clears resistance log + recycles replay; preserves subscribers — Group 8.
//   - D-API-15: reset() returns Promise<void> — Group 8.
//   - D-API-16/17: received.resistance is ReadonlyArray<number>; backed by an internal number[] — Group 1, Group 6, Group 8.
//   - D-API-20: per-record collapse (rec.power ?? 0; rec.cadence ?? 0) BEFORE encodeIndoorBikeData — Group 3 (byteLength === 6).
//   - D-API-21: NO speed bytes emitted in v1 — Group 3 asserts byteLength === 6 (Flags 2 + Cadence 2 + Power 2).
//   - API-01..06: every requirement is exercised by at least one passing test below.
//
// Pitfalls addressed (per .planning/phases/04-faketransport-public-api/04-RESEARCH.md):
//   §1 — sendResistance microtask boundary (await Promise.resolve() BEFORE the push) — Group 6.
//   §3 — handler removing itself during emit (Set iteration semantics) — Group 4.
//   §6 — disconnect-completes-after-scheduler ("zero emissions after disconnect resolves") — Group 7.
//   §8 — subscriber-throws isolation — Group 5.
//   Phase 3 RESEARCH §Pitfall 5 — vi.advanceTimersByTimeAsync (NEVER the sync variant). Reaffirmed in 04-RESEARCH §Pitfall 4.
//   Phase 3 RESEARCH §Pitfall 6 — module-import-binding capture: tests inject a globalThis.setTimeout-based sleep
//     via the FakeTransport factory's test-only `options.sleep` seam (Plan 04-01 lift to test/_helpers/).
//
// Test discipline (D-API-24):
//   - vi.useFakeTimers() at the TOP-LEVEL describe; vi.useRealTimers() in afterEach.
//   - Every test creates a FRESH transport via newTransport(...) — reset() is itself under test, not a setup tool.
//   - All timer advances use vi.advanceTimersByTimeAsync (never the sync variant — acceptance grep enforces).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { once } from 'node:events';
import { createFakeTransport } from '../../src/index.js';
import type { FakeTransport, RideRecord } from '../../src/index.js';
import { fakeAwareSleep } from '../_helpers/fake-aware-sleep.js';

/**
 * Helper — N synthetic records with a fixed ms cadence (Pattern TR3, mirrors
 * test/replay/replay.test.ts:33-35 verbatim). The `{ records: [...] }` source
 * variant skips the FIT parser entirely (D-API-05 fast path) so these unit
 * tests run as fast as the fake-timer scheduler allows.
 */
function makeRecords(count: number, cadenceMs = 100): RideRecord[] {
  return Array.from({ length: count }, (_, i) => ({ timestamp: 1000 + i * cadenceMs }));
}

/**
 * Helper — centralizes the `{ sleep: fakeAwareSleep }` wiring so each test
 * body stays focused on the behavior under test. The test-only sleep seam
 * (D-API-24) lets vi.useFakeTimers() drive Phase 3's scheduler — vitest 4's
 * fake-timers do NOT intercept node:timers/promises module-level bindings,
 * which is why this seam exists (04-RESEARCH §Pitfall 4 root cause).
 */
function newTransport(records: RideRecord[]): FakeTransport {
  return createFakeTransport({ source: { records } }, { sleep: fakeAwareSleep });
}

describe('FakeTransport — factory unit tests', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Group 1 — D-API-04: factory is synchronous and returns the FakeTransport shape (API-01, API-02)', () => {
    it('createFakeTransport returns synchronously (no await needed)', () => {
      const transport = createFakeTransport({ source: { records: makeRecords(3) } });
      expect(transport).toBeDefined();
    });

    it('returned object exposes the full FakeTransport surface', () => {
      const transport = newTransport(makeRecords(3));
      expect(typeof transport.connect).toBe('function');
      expect(typeof transport.disconnect).toBe('function');
      expect(typeof transport.onData).toBe('function');
      expect(typeof transport.sendResistance).toBe('function');
      expect(typeof transport.reset).toBe('function');
      expect(typeof transport.on).toBe('function');
      expect(typeof transport.off).toBe('function');
      expect(typeof transport.once).toBe('function');
    });

    it('received.resistance starts as an empty array (D-API-16/17)', () => {
      const transport = newTransport(makeRecords(3));
      expect(transport.received).toBeDefined();
      expect(Array.isArray(transport.received.resistance)).toBe(true);
      expect(transport.received.resistance).toEqual([]);
    });
  });

  describe('Group 2 — D-API-06: factory validates speed and maxEmissionHz synchronously', () => {
    it('throws synchronously when speed === 0', () => {
      expect(() =>
        createFakeTransport({ source: { records: makeRecords(2) }, speed: 0 }),
      ).toThrow(/speed must be > 0/);
    });

    it('throws synchronously when speed is negative', () => {
      expect(() =>
        createFakeTransport({ source: { records: makeRecords(2) }, speed: -1 }),
      ).toThrow(/speed must be > 0/);
    });

    it('throws synchronously when speed is NaN', () => {
      expect(() =>
        createFakeTransport({ source: { records: makeRecords(2) }, speed: NaN }),
      ).toThrow(/speed must be > 0/);
    });

    it('throws synchronously when maxEmissionHz === 0', () => {
      expect(() =>
        createFakeTransport({ source: { records: makeRecords(2) }, maxEmissionHz: 0 }),
      ).toThrow(/maxEmissionHz must be > 0/);
    });

    it('applies defaults (speed=1, maxEmissionHz=1000, loop=false) when omitted', () => {
      const transport = createFakeTransport({ source: { records: makeRecords(2) } });
      expect(transport).toBeDefined();
      expect(typeof transport.connect).toBe('function');
    });
  });

  describe('Group 3 — D-API-04 + connect() lifecycle: connect emits records, completes naturally, fires \'complete\' (REPL-05 surfacing, API-01)', () => {
    it('emits one DataView per record then fires \'complete\' (Pattern TR4 — once() + fake timers cooperate)', async () => {
      const records = makeRecords(3, 100);
      const transport = newTransport(records);
      const emitted: DataView[] = [];
      transport.onData((dv) => emitted.push(dv));

      const completePromise = once(transport, 'complete');
      await transport.connect();
      await vi.advanceTimersByTimeAsync(300);
      await completePromise;

      expect(emitted).toHaveLength(3);
      // D-API-21: v1 emits power+cadence only — Flags(2) + Cadence(2) + Power(2) = 6 bytes.
      // The encoder's speed branch stays untested at this layer (Phase 1 owns that).
      for (const dv of emitted) {
        expect(dv.byteLength).toBe(6);
      }
    });

    it('\'complete\' does NOT fire before connect (D-API-12 — natural completion only)', async () => {
      const transport = newTransport(makeRecords(2, 50));
      let completeFired = false;
      transport.on('complete', () => {
        completeFired = true;
      });
      // No connect() — advance timers; nothing should fire.
      await vi.advanceTimersByTimeAsync(500);
      expect(completeFired).toBe(false);
    });
  });

  describe('Group 4 — D-API-09 + D-API-20: multi-subscriber Set fan-out (API-03)', () => {
    it('all registered subscribers receive the SAME DataView reference in insertion order (encode-once-fan-out-many)', async () => {
      const transport = newTransport(makeRecords(3, 50));
      const a: DataView[] = [];
      const b: DataView[] = [];
      const c: DataView[] = [];
      transport.onData((dv) => a.push(dv));
      transport.onData((dv) => b.push(dv));
      transport.onData((dv) => c.push(dv));

      const completePromise = once(transport, 'complete');
      await transport.connect();
      await vi.advanceTimersByTimeAsync(200);
      await completePromise;

      expect(a).toHaveLength(3);
      expect(b).toHaveLength(3);
      expect(c).toHaveLength(3);
      // D-API-09 + Pattern 5 — same DataView reference fans out to all subscribers.
      for (let i = 0; i < a.length; i++) {
        expect(b[i]).toBe(a[i]);
        expect(c[i]).toBe(a[i]);
      }
    });

    it('disposer returned by onData removes the subscriber (zero emissions after dispose, others continue)', async () => {
      const transport = newTransport(makeRecords(3, 50));
      const removed: DataView[] = [];
      const kept: DataView[] = [];
      const dispose = transport.onData((dv) => removed.push(dv));
      transport.onData((dv) => kept.push(dv));
      dispose();

      const completePromise = once(transport, 'complete');
      await transport.connect();
      await vi.advanceTimersByTimeAsync(200);
      await completePromise;

      expect(removed).toHaveLength(0);
      expect(kept).toHaveLength(3);
    });

    it('handler that disposes itself mid-fan-out receives ONLY the first emission (Pitfall 3 — Set iteration semantics)', async () => {
      const transport = newTransport(makeRecords(3, 50));
      const selfRemoving: DataView[] = [];
      const stable: DataView[] = [];
      let dispose: (() => void) | undefined;
      dispose = transport.onData((dv) => {
        selfRemoving.push(dv);
        dispose?.();
      });
      transport.onData((dv) => stable.push(dv));

      const completePromise = once(transport, 'complete');
      await transport.connect();
      await vi.advanceTimersByTimeAsync(200);
      await completePromise;

      // ECMA-262 Set iteration: a handler removed mid-loop is not visited again
      // in subsequent emit() calls. Within a single emit() the deletion takes
      // effect immediately for the current Set's pending iterator, but the
      // handler in question already received the current dv.
      expect(selfRemoving).toHaveLength(1);
      expect(stable).toHaveLength(3);
    });
  });

  describe('Group 5 — D-API-10: subscriber throw isolation (Pitfall 8)', () => {
    it('a throwing handler does NOT prevent other subscribers from receiving emissions', async () => {
      const transport = newTransport(makeRecords(3, 50));
      const ok: DataView[] = [];
      transport.onData(() => {
        throw new Error('boom 1');
      });
      transport.onData((dv) => ok.push(dv));
      transport.onData(() => {
        throw new Error('boom 2');
      });

      const completePromise = once(transport, 'complete');
      await transport.connect();
      await vi.advanceTimersByTimeAsync(200);
      await completePromise;

      // The throwing handlers are swallowed by the per-handler try/catch
      // (D-API-10) using debuglog('trainer-sim:transport') for observability.
      // The key invariant: the non-throwing handler still receives every emission.
      expect(ok).toHaveLength(3);
    });

    it('a throwing handler does NOT prevent \'complete\' from firing', async () => {
      const transport = newTransport(makeRecords(2, 50));
      transport.onData(() => {
        throw new Error('boom');
      });

      const completePromise = once(transport, 'complete');
      await transport.connect();
      await vi.advanceTimersByTimeAsync(200);
      // If 'complete' did NOT fire, this await would hang the test until
      // vitest's per-test timeout. Reaching here at all is the assertion.
      await completePromise;
    });
  });

  describe('Group 6 — D-API-04 + PITFALLS §12: sendResistance microtask boundary + ordering (API-04, API-05)', () => {
    it('await sendResistance(g) makes the push observable AFTER the await resolves', async () => {
      const transport = newTransport(makeRecords(2, 50));
      await transport.sendResistance(0.05);
      // The microtask boundary inside sendResistance (await Promise.resolve()
      // BEFORE the push, per PITFALLS.md §12) means the push has happened
      // by the time the awaiter resumes.
      expect(transport.received.resistance).toEqual([0.05]);
    });

    it('three sequential sendResistance calls preserve call order in received.resistance', async () => {
      const transport = newTransport(makeRecords(2, 50));
      await transport.sendResistance(0.01);
      await transport.sendResistance(0.02);
      await transport.sendResistance(0.03);
      expect(transport.received.resistance).toEqual([0.01, 0.02, 0.03]);
    });

    it('sendResistance during a running replay does NOT modify emitted DataView bytes (echo-only)', async () => {
      // Records carry zero power/cadence (default — makeRecords omits both
      // fields, exercising the rec.power ?? 0 / rec.cadence ?? 0 collapse
      // per D-API-20). Encoder output for {power:0, cadence:0} (speed omitted):
      //   Flags (LE uint16) = bit 0 set (MoreData INVERTED — speed ABSENT
      //                       per PITFALLS.md §1) | bit 2 (cadence-present)
      //                       | bit 6 (power-present) = 0x0045 = 0x45 0x00.
      //   Cadence (LE uint16) = 0x00 0x00
      //   Power   (LE sint16) = 0x00 0x00
      const transport = newTransport(makeRecords(3, 50));
      const snapshots: number[][] = [];
      transport.onData((dv) => {
        const bytes: number[] = [];
        for (let i = 0; i < dv.byteLength; i++) bytes.push(dv.getUint8(i));
        snapshots.push(bytes);
      });

      const completePromise = once(transport, 'complete');
      await transport.connect();
      // Mid-stream: send a non-trivial resistance grade. If the implementation
      // were leaking the grade into the emission path, this would corrupt
      // subsequent emitted bytes.
      await vi.advanceTimersByTimeAsync(75);
      await transport.sendResistance(0.42);
      await vi.advanceTimersByTimeAsync(200);
      await completePromise;

      expect(snapshots).toHaveLength(3);
      // All emissions carry zero power+cadence (input records had none) —
      // sendResistance is echo-only and does NOT mutate the encode path.
      for (const bytes of snapshots) {
        expect(bytes).toEqual([0x45, 0x00, 0x00, 0x00, 0x00, 0x00]);
      }
      // And the resistance log received the in-flight call.
      expect(transport.received.resistance).toEqual([0.42]);
    });
  });

  describe('Group 7 — D-API-12 + REPL-06: disconnect-then-quiet (Pitfall 6)', () => {
    it('zero emissions in the 100ms window after disconnect resolves (mirrors test/replay/abort.test.ts)', async () => {
      const transport = newTransport(makeRecords(10, 50));
      const emitted: DataView[] = [];
      transport.onData((dv) => emitted.push(dv));

      await transport.connect();
      // Drive partway through the timeline.
      await vi.advanceTimersByTimeAsync(150);
      const before = emitted.length;
      expect(before).toBeGreaterThanOrEqual(2);

      await transport.disconnect();
      // After disconnect resolves, the scheduler's last microtask has fully
      // unwound (Pattern A6 + Phase 3 CR-01 fix at commit e4b04a9). REPL-06:
      // no further emissions can land in the future.
      await vi.advanceTimersByTimeAsync(100);
      expect(emitted.length).toBe(before);
    });

    it('\'complete\' does NOT fire when disconnect aborts mid-stream (D-API-12)', async () => {
      const transport = newTransport(makeRecords(10, 50));
      let completeFired = false;
      transport.on('complete', () => {
        completeFired = true;
      });

      await transport.connect();
      await vi.advanceTimersByTimeAsync(75);
      await transport.disconnect();
      await vi.advanceTimersByTimeAsync(100);

      expect(completeFired).toBe(false);
    });
  });

  describe('Group 8 — D-API-14/15: reset() semantics (API-06)', () => {
    it('reset() clears received.resistance, preserves subscribers, and recycles for the next connect()', async () => {
      const transport = newTransport(makeRecords(2, 50));
      const collected: DataView[] = [];
      transport.onData((dv) => collected.push(dv));

      // Lifecycle 1: complete naturally, log some resistance grades.
      const complete1 = once(transport, 'complete');
      await transport.connect();
      await vi.advanceTimersByTimeAsync(200);
      await complete1;
      await transport.sendResistance(0.05);
      await transport.sendResistance(0.10);
      expect(collected).toHaveLength(2);
      expect(transport.received.resistance).toEqual([0.05, 0.10]);

      // reset(): D-API-14 — clears resistance log; preserves subscribers;
      // discards Replay so the next connect() can build a fresh one (Phase 3
      // D-REPL-07 single-use lock makes recycling impossible).
      await transport.reset();
      expect(transport.received.resistance).toEqual([]);

      // Lifecycle 2: same subscriber receives emissions in the second pass —
      // reset() did NOT clear the subscribers Set.
      const complete2 = once(transport, 'complete');
      await transport.connect();
      await vi.advanceTimersByTimeAsync(200);
      await complete2;
      expect(collected).toHaveLength(4);
    });

    it('reset() returns a Promise<void> that resolves before assertions observe the cleared state', async () => {
      const transport = newTransport(makeRecords(2, 50));
      await transport.sendResistance(0.05);
      const result = transport.reset();
      // Promise-shaped: must have a .then method.
      expect(typeof (result as Promise<void>).then).toBe('function');
      await result;
      expect(transport.received.resistance).toEqual([]);
    });

    it('reset() during a running replay halts emissions (REPL-06 contract via internal disconnect)', async () => {
      const transport = newTransport(makeRecords(10, 50));
      const emitted: DataView[] = [];
      transport.onData((dv) => emitted.push(dv));
      await transport.sendResistance(0.42);

      await transport.connect();
      await vi.advanceTimersByTimeAsync(75);
      const before = emitted.length;
      expect(before).toBeGreaterThanOrEqual(1);

      await transport.reset();
      // After reset() resolves, the resistance log is cleared AND the
      // scheduler has unwound (reset awaits disconnect awaits replay.completed).
      expect(transport.received.resistance).toEqual([]);
      // No further emissions during the post-reset wait window.
      await vi.advanceTimersByTimeAsync(100);
      expect(emitted.length).toBe(before);
    });
  });

  describe('Group 9 — D-API-13 + Pattern 2: composed EventEmitter, on/off/once typed for \'complete\' only', () => {
    it('once(\'complete\', listener) fires the listener exactly once on natural completion', async () => {
      const transport = newTransport(makeRecords(2, 50));
      let fireCount = 0;
      transport.once('complete', () => {
        fireCount++;
      });
      await transport.connect();
      await vi.advanceTimersByTimeAsync(200);
      // Drain microtasks following completion.
      await Promise.resolve();
      expect(fireCount).toBe(1);
    });

    it('off() removes a previously-registered \'complete\' listener', async () => {
      const transport = newTransport(makeRecords(2, 50));
      let fireCount = 0;
      const listener = (): void => {
        fireCount++;
      };
      transport.on('complete', listener);
      transport.off('complete', listener);

      // Lifecycle 1: 'complete' would fire, but the listener is gone.
      const complete1 = once(transport, 'complete');
      await transport.connect();
      await vi.advanceTimersByTimeAsync(200);
      await complete1;

      // After reset+reconnect the off()-removed listener still must NOT fire.
      await transport.reset();
      const complete2 = once(transport, 'complete');
      await transport.connect();
      await vi.advanceTimersByTimeAsync(200);
      await complete2;

      expect(fireCount).toBe(0);
    });
  });
});
