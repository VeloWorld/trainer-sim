// Pure async drift-corrected setTimeout-chain scheduler — the algorithmic
// core of Phase 3's replay engine. A single `runScheduler` async function
// iterates a sorted `RideRecord[]` and invokes an injected `emit` callback
// at FIT-relative cadence, anchored to a baseline captured from an injected
// monotonic clock (`getNow`) and recomputed every tick so per-tick host
// jitter cannot accumulate into wall-clock drift.
//
// Implements (per .planning/phases/03-replay-engine/03-CONTEXT.md):
//   - D-REPL-01: setTimeout chain — each tick re-arms a single
//     `node:timers/promises` `setTimeout` AFTER the prior emission. NOT
//     setInterval (cumulative drift) and NOT setImmediate / process.nextTick
//     (CPU pin + I/O starvation).
//   - D-REPL-02: per-tick recalibration against an absolute target time
//     (`baseline + (record.timestamp - firstTs) / speed`). Each tick recomputes
//     `delay = target - getNow()` so errors cannot compound across ticks —
//     end-time error is bounded by ONE final-tick error, not a sum.
//   - D-REPL-03: monotonic time source via the injected `getNow`. Production
//     wiring (in plan 03-02 `Replay.start`) passes `() => performance.now()`;
//     tests inject a fake. RESEARCH §Pitfall 6 documents why importing
//     `performance` from the perf-hooks module at top-level would break
//     under `vi.useFakeTimers()` — the module-level binding is captured
//     before the fake-timer setup. The injection seam avoids that trap.
//   - D-REPL-04: `speed === Infinity` falls through to the `maxEmissionHz`
//     floor via the `Math.max` clamp — NO branch on `speed`. The one
//     explicit guard below converts `0/Infinity = NaN` (cursor=0 edge) into
//     a deterministic 0 so the clamp produces `minIntervalMs` instead of
//     relying on the accidental `setTimeout(NaN)` → 1ms fallback.
//   - D-REPL-05: `maxEmissionHz` is consumed via `minIntervalMs = 1000 /
//     maxEmissionHz`. Default 1000 lives in `ReplayConfig`'s caller; this
//     module never defaults — caller-supplied invariant.
//   - D-REPL-06: loop boundary re-base — when the cursor wraps under
//     `loop: true`, `baseline = getNow()` BEFORE the next iteration begins,
//     so iteration 2's targets are anchored to a fresh clock and drift
//     cannot carry across iterations.
//   - D-REPL-09: cancellation via `AbortSignal` is delegated to
//     `node:timers/promises` `setTimeout(delay, value, { signal })`, which
//     rejects with `AbortError` on abort and (per Node docs) cleans up its
//     internal `'abort'` listener on natural completion. The wrapper class
//     in plan 03-02 routes the rejection to `replay.completed.reject(err)`.
//   - D-REPL-13: file split — this module is the pure async scheduler;
//     `src/replay/types.ts` holds `ReplayConfig` / `ReplayState`; the
//     stateful `Replay` class lands in plan 03-02 (`src/replay/replay.ts`).
//
// Pitfalls addressed (per 03-RESEARCH §Common Pitfalls):
//   §1 setInterval cumulative drift — avoided by the setTimeout-chain (D-REPL-01).
//   §2 relative-delta drift — avoided by computing `target = baseline +
//      (record.timestamp - firstTs) / speed` against an absolute baseline
//      every tick, NOT against the previous tick's actual fire time (D-REPL-02).
//   §3 AbortSignal listener leak — handled by `node:timers/promises`; the
//      runtime owns the listener lifecycle. NO hand-rolled
//      `signal.addEventListener('abort', ...)` plumbing.
//   §6 import-binding capture under fake timers — `getNow` is injected, NOT
//      imported from the perf-hooks module at module scope.
//   §7 loop-boundary drift accumulation — `baseline = getNow()` on every
//      cursor-wrap iteration (D-REPL-06).
//   §8 NaN propagation when `speed === Infinity` and cursor === 0 — the
//      explicit `speed === Infinity ? 0 : ...` guard makes this deterministic
//      instead of "correct by accident via setTimeout(NaN) clamp".
//   §9 empty `records` array — guarded with an early return on the very
//      first line of the function body (defense-in-depth; Phase 2 already
//      throws `NoRecordMessagesError` upstream).
//
// SINGLE-SOURCE-OF-TRUTH IMPORT SEAM. This module is the ONLY file in `src/`
// that imports `'node:timers/promises'` — mirroring the D-FIT-08 enforcement
// from Phase 2 (only `src/fit/loader.ts` imports `fit-file-parser`). The
// 03-01-PLAN acceptance grep confirms the seam; threat T-03-01 in the plan's
// threat model documents WHY a future regression that imports the global
// `setTimeout` here would re-introduce the §3 listener-leak antipattern.

import { setTimeout as defaultSleep } from 'node:timers/promises';
import { debuglog } from 'node:util';
import type { ReplayConfig } from './types.js';
import type { RideRecord } from '../types.js';

const log = debuglog('trainer-sim:replay');

/**
 * Compile-time-only contract for `runScheduler`'s parameters. Held inside
 * scheduler.ts (NOT in `src/replay/types.ts`) because it is a function
 * signature — not a public-shape type — and the analog in
 * `src/fit/normalize.ts` (`ParsedFitMinimal`) lives next to the function it
 * serves.
 *
 * Shape: every `ReplayConfig` field plus the three injection seams the
 * scheduler needs to be testable and cancellable in isolation:
 *   - `signal`  — REQUIRED. The scheduler does not run uncancellable;
 *                  cancellation is the contract (D-REPL-09). Plan 03-02's
 *                  `Replay.start` constructs an internal AbortController and
 *                  passes its signal here. Phase 4 may compose external
 *                  signals via `AbortSignal.any([...])`.
 *   - `emit`    — synchronous. The scheduler does NOT await the emit; that
 *                  would couple the scheduler's drift correction to the
 *                  subscriber's work, which is exactly the opposite of what
 *                  D-REPL-02 wants. Subscribers that need async work should
 *                  buffer; the wrapper class will surface that pattern.
 *   - `getNow`  — monotonic clock returning ms with sub-ms precision.
 *                  Production: `() => performance.now()`. Tests: inject a
 *                  fake clock OR rely on `vi.useFakeTimers()` faking the
 *                  global `performance.now()` and pass the global form.
 */
/**
 * Type of the AbortSignal-aware delay primitive the scheduler awaits — matches
 * the `node:timers/promises` `setTimeout(delay, value, options)` signature
 * we ship in production. Tests inject a `globalThis.setTimeout`-based variant
 * because Vitest 4's `vi.useFakeTimers()` does NOT intercept the
 * `node:timers/promises` module (only `globalThis.setTimeout`). Production
 * wiring (in plan 03-02 `Replay.start`) passes the real `node:timers/promises`
 * setTimeout — RESEARCH §AbortController teardown pitfalls.
 */
type SleepFn = (
  delay: number,
  value?: undefined,
  options?: { signal?: AbortSignal },
) => Promise<void>;

interface SchedulerInput {
  /** Time-ordered ride records (sorted ascending by timestamp; length >= 1 except for the §9 defense-in-depth early return). */
  records: ReadonlyArray<RideRecord>;
  /** Replay speed multiplier (`1` real-time; `Infinity` = max-cap). D-REPL-04. */
  speed: number;
  /** Loop the records on cursor wrap. D-REPL-06 + REPL-04. */
  loop: boolean;
  /** Maximum emission frequency in Hz. D-REPL-04 / D-REPL-05. */
  maxEmissionHz: number;
  /** Cancellation signal — required, not optional. D-REPL-09. */
  signal: AbortSignal;
  /** Synchronous emit callback. */
  emit: (record: RideRecord) => void;
  /** Monotonic-clock injection seam. D-REPL-03 + RESEARCH §Pitfall 6. */
  getNow: () => number;
  /**
   * AbortSignal-aware delay primitive. Optional — defaults to the
   * `node:timers/promises` `setTimeout` import above (production wiring).
   * Tests inject a `globalThis.setTimeout`-based variant because Vitest 4
   * cannot fake the `node:timers/promises` module-level binding (parallel to
   * §Pitfall 6's `getNow` seam — same root cause: ESM static imports of
   * built-in `node:` modules are captured before `vi.useFakeTimers()` runs).
   */
  sleep?: SleepFn;
}

// Safety: ReplayConfig and SchedulerInput share four fields by design (the
// caller in 03-02 spreads `...config` into the SchedulerInput). The line
// below is a static check that re-declaring the four shared fields here did
// not drift from the canonical ReplayConfig shape — if a future plan adds a
// field to ReplayConfig, this assignment forces an explicit decision about
// whether the scheduler also needs that field.
const _schedulerInputCoversConfig: (
  c: ReplayConfig,
) => Pick<SchedulerInput, 'records' | 'speed' | 'loop' | 'maxEmissionHz'> = (
  c,
) => c;
void _schedulerInputCoversConfig;

/**
 * Drift-corrected setTimeout-chain scheduler. Resolves on natural completion
 * (cursor exhaustion with `loop === false`). Rejects with `AbortError` (from
 * `node:timers/promises`) on `signal.abort()`. Never resolves while
 * `loop === true` — the caller must abort to stop the chain.
 *
 * Implements REPL-01..REPL-04 and REPL-06 (the algorithmic core); REPL-05
 * (Promise-shaped completion surface) is handled by the wrapper class in
 * plan 03-02 — `runScheduler` is just the inner loop.
 */
export async function runScheduler(input: SchedulerInput): Promise<void> {
  // Step 1 — Defense-in-depth: empty-records early return (RESEARCH §Pitfall 9).
  // Phase 2's loader already throws `NoRecordMessagesError` on empty FIT
  // input, but the scheduler is a lower layer; resolve immediately rather
  // than crashing on `records[0]!`.
  if (input.records.length === 0) {
    return;
  }

  // Step 2 — Destructure and compute invariants. `minIntervalMs` is the
  // floor used both by D-REPL-04 (Infinity-clamp) and as a general
  // rate-limit; `firstTs` anchors the absolute-target-time math (D-REPL-02).
  // `sleep` defaults to the `node:timers/promises` import in production;
  // tests inject a `globalThis.setTimeout`-based variant (Pitfall 6 parallel —
  // Vitest 4 cannot fake the `node:timers/promises` module binding).
  const { records, speed, loop, maxEmissionHz, signal, emit, getNow } = input;
  const sleep = input.sleep ?? defaultSleep;
  const minIntervalMs = 1000 / maxEmissionHz;
  const firstTs = records[0]!.timestamp;

  // Step 3 — Initialize loop state. `baseline` is the monotonic-clock anchor
  // for "where t=firstTs maps to in real time"; `cursor` walks the records.
  let baseline = getNow();
  let cursor = 0;

  // Observability counters (RESEARCH §Pitfall 6 + PATTERNS §Logging) —
  // surfaced via debuglog only on natural completion, only when nonzero.
  let clampedTicks = 0;
  let totalTicks = 0;

  // Step 4 — Main emission loop. One pending sleep per iteration; the
  // AbortSignal aborts the pending sleep (D-REPL-09).
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const record = records[cursor]!;

    // 4a — Compute the absolute target time for this record. The §Pitfall 8
    // guard turns `(0 - 0) / Infinity = NaN` at cursor=0 into a deterministic
    // 0 so the §1 / §4 path is testable instead of relying on the
    // accidental `setTimeout(NaN)` → 1ms clamp. (When `speed === Infinity`,
    // every record's targetSinceStart collapses to 0; the `Math.max` clamp
    // below floors the delay at `minIntervalMs` per D-REPL-04.)
    const targetSinceStart =
      speed === Infinity ? 0 : (record.timestamp - firstTs) / speed;
    const target = baseline + targetSinceStart;

    // 4b — Per-tick recompute against the live clock (D-REPL-02). This is
    // what kills drift: even if the previous tick fired late, this delay is
    // measured against the current `getNow()` and the absolute `target`,
    // not against the previous fire time. The `Math.max(target - getNow(),
    // minIntervalMs)` clamp doubles as the D-REPL-04 Infinity-floor.
    const delay = Math.max(target - getNow(), minIntervalMs);
    if (target - getNow() < minIntervalMs) {
      clampedTicks++;
    }
    totalTicks++;

    // 4c — Sleep with AbortSignal (D-REPL-09). On natural delay completion
    // we proceed to emit; on `signal.abort()` the promise rejects with an
    // AbortError that propagates out of `runScheduler` for the wrapper
    // class to route to `replay.completed.reject(err)`. We do NOT swallow
    // here — RESEARCH §Pitfall 4 + 03-RESEARCH AbortController teardown.
    await sleep(delay, undefined, { signal });

    // 4d — Emit and advance. Emit is synchronous by contract.
    emit(record);
    cursor++;

    // Step 5 — Loop boundary handling (D-REPL-06, RESEARCH §Pitfall 7).
    // The natural-end branch (`!loop`) is also the only place we surface
    // the clamp summary — keep the log conditional so unsetting NODE_DEBUG
    // remains zero-overhead in production.
    if (cursor >= records.length) {
      if (!loop) {
        if (clampedTicks > 0) {
          log(
            'runScheduler: %d/%d ticks clamped to minIntervalMs=%d ms',
            clampedTicks,
            totalTicks,
            minIntervalMs,
          );
        }
        return;
      }
      cursor = 0;
      // CRITICAL — re-base to a fresh clock anchor so iteration 2's targets
      // are computed against the new wall-clock position. Without this line
      // the next iteration's target = `originalBaseline + 0`, which is in
      // the past, and the entire iteration emits in a single event-loop
      // turn (RESEARCH §Pitfall 7).
      baseline = getNow();
      log('runScheduler: loop iteration restart at baseline=%d', baseline);
    }
  }
}
