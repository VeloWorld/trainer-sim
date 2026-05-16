/**
 * Replay lifecycle class — wraps `runScheduler` with a single-subscriber slot,
 * an internal AbortController, and a `Promise<void>` completion surface. This
 * is the public-to-Phase-4 layer that Phase 4's `createFakeTransport` will
 * instantiate; Phase 3 itself does NOT re-export it from `src/index.ts`
 * (D-REPL-12 lock).
 *
 * Lifecycle:
 *   - `idle` → `running` on `start()`.
 *   - `running` → `done` when the underlying scheduler resolves naturally
 *     (cursor exhaustion with `loop === false`).
 *   - `running` → `aborted` when the underlying scheduler rejects (either
 *     `stop()` triggers the internal `AbortController`, or an external
 *     `signal` aborts).
 *   - Once a Replay reaches `done` or `aborted` it is single-use — calling
 *     `start()` again rejects synchronously. Phase 4's `reset()` (API-06)
 *     constructs a fresh `Replay` rather than recycling the state machine
 *     (RESEARCH §Open Questions Q1).
 *
 * Implements (per .planning/phases/03-replay-engine/03-CONTEXT.md):
 *   - D-REPL-07: stop-at-end → state moves to `done`; subsequent `start()`
 *     throws (single-use lock — RESEARCH §Open Questions Q1).
 *   - D-REPL-08: Promise-first completion surface — `replay.completed` is a
 *     `Promise<void>` backed by `Promise.withResolvers()`. Phase 4 wires the
 *     `'complete'` event onto this Promise's resolution; Phase 3 does NOT.
 *   - D-REPL-09: cancellation via internal `AbortController` plus optional
 *     external `AbortSignal`, composed via `AbortSignal.any([...])`. Either
 *     source aborts the scheduler.
 *   - D-REPL-10: after abort/stop, NO further emissions fire. The scheduler
 *     in `./scheduler.ts` owns this guarantee (single pending sleep with
 *     `node:timers/promises`, signal-aware); plan 03-03's abort.test.ts
 *     verifies it end-to-end.
 *   - D-REPL-11: single-subscriber slot. `onRecord(handler)` throws if
 *     called twice; Phase 4 wraps for fan-out.
 *   - D-REPL-12: this file is internal — no addition to `src/index.ts`.
 *   - D-REPL-13: file split — types in `./types.ts`, scheduler in
 *     `./scheduler.ts`, lifecycle class HERE.
 *
 * Open question resolutions (per 03-RESEARCH §Open Questions, all RESOLVED):
 *   1. Restart-after-stop: THROW. Replay instances are single-use. Phase 4's
 *      `reset()` constructs a fresh Replay internally — that's the reusable
 *      surface, not Replay itself.
 *   2. Abort error semantics: REJECT `replay.completed` with the underlying
 *      rejection (`signal.reason ?? AbortError` from `node:timers/promises`).
 *      Matches `fetch` AbortController convention.
 *   3. External + internal signal composition: `AbortSignal.any([external,
 *      internalController.signal])` (Node 20+, stable in 24). No hand-rolled
 *      `'abort'` listener plumbing — RESEARCH §Pitfall 3 listener-leak risk.
 *
 * Pitfalls addressed (per 03-RESEARCH §Common Pitfalls):
 *   §4 — Pre-aborted external signal — `start()` checks `signal.aborted`
 *        and throws synchronously instead of letting the scheduler reject
 *        on the first tick (which would land in `replay.completed` as an
 *        AbortError before the caller had a chance to await it).
 *   §6 — Import-binding capture under fake timers — production passes
 *        `() => globalThis.performance.now()` (NOT `performance.now`
 *        captured at import time). Vitest's fake-timer setup replaces
 *        `globalThis.performance.now`, so a test calling
 *        `vi.useFakeTimers()` faking the clock is what production reads.
 *   §10 — Subscriber-not-set silent drop — `start()` throws if
 *        `onRecord(...)` was never called. Silent emission drops would
 *        be a worst-of-both-worlds bug class for Phase 4 to debug.
 *
 * References:
 *   - .planning/phases/03-replay-engine/03-CONTEXT.md (D-REPL-07..13)
 *   - .planning/phases/03-replay-engine/03-RESEARCH.md
 *       §AbortController teardown pitfalls + correct pattern (lines 294–357)
 *       §Pattern: Replay class wrapping the scheduler (lines 474–525)
 *       §Open Questions (lines 798–810) — all three resolved here.
 *   - .planning/phases/03-replay-engine/03-PATTERNS.md
 *       §src/replay/replay.ts (module-doc style mirroring
 *       src/ftms/indoor-bike-data.ts; private-field JSDoc style).
 */

import { runScheduler } from './scheduler.js';
import type { ReplayConfig, ReplayState } from './types.js';
import type { RideRecord } from '../types.js';

/**
 * Lifecycle wrapper around `runScheduler`. Phase 4's `createFakeTransport`
 * instantiates this and wires the `'complete'` event-emitter event onto the
 * `completed` Promise resolution (D-REPL-08). Plan 03-03's tests instantiate
 * it directly to exercise abort semantics and state transitions.
 */
export class Replay {
  /**
   * Frozen at construction; not mutated. `ReplayConfig` is internal — see
   * `./types.ts`. The scheduler reads `records` as `ReadonlyArray`, so no
   * defensive copy is needed.
   */
  private readonly config: ReplayConfig;

  /**
   * D-REPL-11 — single subscriber slot. Phase 4 wraps for fan-out. `undefined`
   * until `onRecord(handler)` is called; `start()` throws if still undefined.
   */
  private subscriber: ((r: RideRecord) => void) | undefined = undefined;

  /**
   * D-REPL-09 — internal AbortController; `stop()` calls `.abort()`.
   * Initialized lazily in `start()` so a never-started instance has nothing
   * to clean up.
   */
  private controller: AbortController | undefined = undefined;

  /**
   * D-REPL-07 + single-use lock — see `start()`. Public read access via the
   * `currentState` getter (the sole accessor — RESEARCH §Open Questions Q3).
   */
  private state: ReplayState = 'idle';

  /**
   * D-REPL-08 — Promise-first completion surface. Constructed via
   * `Promise.withResolvers()` (Node 22+; RESEARCH §Don't Hand-Roll + A5)
   * instead of a hand-rolled `withDeferred` helper.
   */
  private readonly completedDeferred: {
    promise: Promise<void>;
    resolve: () => void;
    reject: (e: unknown) => void;
  };

  constructor(config: ReplayConfig) {
    this.config = config;
    this.completedDeferred = Promise.withResolvers<void>();
  }

  /**
   * D-REPL-08 — resolves on natural completion (`done`); rejects with the
   * scheduler's underlying rejection (`signal.reason ?? AbortError`) on
   * `stop()` or external abort (`aborted`). Stable identity across the
   * Replay's lifetime — callers may `await` it before or after `start()`.
   */
  get completed(): Promise<void> {
    return this.completedDeferred.promise;
  }

  /**
   * Read-only state accessor — the ONE accessor we expose
   * (RESEARCH §Open Questions Q3 — `cursor` and `elapsedMs` deliberately
   * omitted per CLAUDE.md "no abstractions for hypothetical future
   * requirements"). Plan 03-03's tests use this to assert
   * `'idle' → 'running' → ('done' | 'aborted')` transitions.
   */
  get currentState(): ReplayState {
    return this.state;
  }

  /**
   * D-REPL-11 — register the single subscriber. Returns a disposer that
   * clears the slot if (and only if) the registered handler is still the
   * one in residence; Phase 4 will wrap this disposer for its own fan-out
   * subscriber map.
   *
   * Throws if called twice on the same instance (single-subscriber lock —
   * D-REPL-11) or after `start()` (subscribers attach BEFORE start, not
   * after — RESEARCH §Pitfall 10 silent-drop avoidance).
   */
  onRecord(handler: (r: RideRecord) => void): () => void {
    if (this.subscriber !== undefined) {
      throw new Error('Replay.onRecord: single-subscriber slot already taken (D-REPL-11). Phase 4 wraps for fan-out.');
    }
    if (this.state !== 'idle') {
      throw new Error('Replay.onRecord: must be called before start() (D-REPL-11)');
    }
    this.subscriber = handler;
    return () => {
      if (this.subscriber === handler) {
        this.subscriber = undefined;
      }
    };
  }

  /**
   * Kick off the scheduler. Single-use per D-REPL-07 (RESEARCH §Open
   * Questions Q1) — calling `start()` after `done`/`aborted` throws.
   *
   * Fail-fast guards (in order):
   *   1. `subscriber === undefined` — RESEARCH §Pitfall 10, silent emission
   *      drops are forbidden.
   *   2. `state !== 'idle'` — D-REPL-07 single-use lock.
   *   3. `records.length === 0` — defense-in-depth (the scheduler also
   *      handles this; RESEARCH §Pitfall 9). Throwing here gives Phase 4 a
   *      clearer error than a silently-resolved completed Promise.
   *   4. `config?.signal?.aborted` — RESEARCH §Pitfall 4. A pre-aborted
   *      signal would otherwise reject the scheduler synchronously; failing
   *      fast surfaces the misuse cleanly.
   *
   * Signal composition (RESEARCH §Open Questions Q3): if an external signal
   * is supplied, `AbortSignal.any([external, internal])` produces the
   * composite signal the scheduler awaits. Either source aborts cleanly.
   *
   * `sleep` is an optional test-only injection seam — production callers
   * never pass it. Plan 03-03's tests pass a `globalThis.setTimeout`-based
   * variant because Vitest 4 cannot fake the `node:timers/promises`
   * module-level binding (RESEARCH §Pitfall 6 parallel — same fix as
   * `getNow` and the scheduler's `sleep` seam from plan 03-03 fix commit).
   */
  start(config?: {
    signal?: AbortSignal;
    sleep?: (
      delay: number,
      value?: undefined,
      options?: { signal?: AbortSignal },
    ) => Promise<void>;
  }): void {
    if (this.subscriber === undefined) {
      throw new Error('Replay.start: onRecord must be called before start() (D-REPL-11)');
    }
    if (this.state !== 'idle') {
      throw new Error(`Replay.start: instance is single-use; state is ${this.state} (D-REPL-07). Construct a new Replay to replay again.`);
    }
    if (this.config.records.length === 0) {
      throw new Error('Replay.start: records cannot be empty (D-REPL-13)');
    }
    if (config?.signal?.aborted) {
      throw new Error('Replay.start: external signal is already aborted (D-REPL-09)');
    }

    this.controller = new AbortController();
    const signal = config?.signal
      ? AbortSignal.any([config.signal, this.controller.signal])
      : this.controller.signal;

    this.state = 'running';

    // Capture the subscriber locally so the disposer (which may be invoked
    // from inside the emit callback) cannot null out the reference the
    // scheduler will continue to invoke for the remainder of this start().
    const sub = this.subscriber;

    // `.then(success, failure)` attaches BOTH handlers eagerly so any
    // synchronous AbortError rejection (RESEARCH §Pitfall 4 — already
    // guarded above; defense-in-depth) is never an unhandled rejection.
    runScheduler({
      records: this.config.records,
      speed: this.config.speed,
      loop: this.config.loop,
      maxEmissionHz: this.config.maxEmissionHz,
      signal,
      emit: (r) => sub(r),
      // RESEARCH §Pitfall 6 + Vitest fake-timer recipe: read through
      // `globalThis.performance` at call time so `vi.useFakeTimers()` (which
      // replaces the global) takes effect for tests.
      getNow: () => globalThis.performance.now(),
      sleep: config?.sleep,
    }).then(
      () => {
        this.state = 'done';
        this.completedDeferred.resolve();
      },
      (err) => {
        this.state = 'aborted';
        this.completedDeferred.reject(err);
      },
    );
  }

  /**
   * D-REPL-09 — abort the scheduler. Idempotent: calling `stop()` while
   * `idle`, `done`, or `aborted` is a safe no-op so Phase 4 can call it
   * defensively without guarding state. The actual transition to `aborted`
   * happens in `start()`'s `.then` failure branch when the scheduler's
   * `node:timers/promises` rejection lands (D-REPL-10 — no emissions after
   * abort, owned by the scheduler).
   */
  stop(): void {
    if (this.state !== 'running') {
      return;
    }
    this.controller?.abort();
  }
}
