/**
 * Internal types for the Phase 3 replay engine. Mirrors the shape and
 * decision-citation discipline of `src/types.ts`, but is intentionally NOT
 * exported from `src/index.ts` — D-REPL-12 keeps the entire replay surface
 * internal in this phase. Phase 4's `FakeTransport` is the layer that decides
 * which (if any) replay primitives become public; until then, only files
 * inside `src/replay/` may import from here.
 *
 * Locked decisions (.planning/phases/03-replay-engine/03-CONTEXT.md):
 *   - D-REPL-04: `speed === Infinity` is rate-limited via `maxEmissionHz`,
 *     NOT special-cased in the scheduler — the per-tick `Math.max(target -
 *     now, 1000 / maxEmissionHz)` clamp degrades real-time → fast-replay →
 *     capped without branching on `speed`.
 *   - D-REPL-05: `maxEmissionHz` is part of `ReplayConfig`. Default 1000 Hz
 *     keeps tests fast; lowering it lets a soak test simulate sparse-record
 *     load without a long fixture.
 *   - D-REPL-06: when `loop === true`, the scheduler re-bases its baseline
 *     on each iteration so drift cannot accumulate across loop boundaries.
 *   - D-REPL-12: this file is internal. `src/index.ts` does not re-export
 *     anything from `src/replay/*` in Phase 3.
 *   - D-REPL-13: file split for the replay engine — types live HERE,
 *     algorithm in `src/replay/scheduler.ts`, lifecycle class will land in
 *     `src/replay/replay.ts` (plan 03-02).
 */

import type { RideRecord } from '../types.js';

/**
 * Replay configuration consumed by `runScheduler` (and, in plan 03-02, by the
 * `Replay` lifecycle class). Every field is required — defaults are caller
 * concerns, not type-system concerns, to keep `verbatimModuleSyntax`-friendly
 * inference simple.
 */
export interface ReplayConfig {
  /**
   * Time-ordered ride records to emit. Must satisfy Phase 2's `normalize`
   * invariants: sorted ascending by `timestamp`, no exact-duplicate
   * timestamps, and length >= 1. Empty arrays return immediately from
   * `runScheduler` per 03-RESEARCH §Pitfall 9 (defense-in-depth — Phase 2
   * already throws `NoRecordMessagesError` upstream on empty FIT input, but
   * the scheduler is the lower layer that must not crash on misuse).
   */
  records: ReadonlyArray<RideRecord>;

  /**
   * Replay speed multiplier. `1` = real-time; `2` = 2× faster than the FIT
   * timestamps; `Infinity` = as-fast-as-possible (rate-limited by
   * `maxEmissionHz`). Per D-REPL-04 the `Infinity` case falls through to the
   * `maxEmissionHz` floor via the scheduler's `Math.max` clamp — there is no
   * special-case branch. Values <= 0 are unsupported (would invert time);
   * the scheduler does not validate this — callers (plan 03-02 `Replay`
   * class, Phase 4 `FakeTransport` factory) own input validation.
   */
  speed: number;

  /**
   * When `true`, replay restarts from cursor 0 after the last record, with
   * the baseline rebased to the current monotonic clock so drift cannot
   * accumulate across iterations (D-REPL-06, REPL-04). Default behavior
   * across the codebase is `false` — stop-at-end, per D-REPL-07.
   */
  loop: boolean;

  /**
   * Maximum emission frequency in Hz. Default 1000 (D-REPL-05). The
   * scheduler clamps each per-tick delay to
   * `Math.max(target - now, 1000 / maxEmissionHz)`, which both rate-limits
   * the `speed === Infinity` case (D-REPL-04) and provides a knob for soak
   * tests to simulate sparse-record load. Must be > 0; the scheduler does
   * not validate (caller responsibility — see also threat model T-03-03 in
   * 03-01-PLAN).
   */
  maxEmissionHz: number;
}

/**
 * Replay lifecycle states surfaced by the wrapper class in plan 03-02.
 * Transitions are:
 *   - `idle` → `running` on `start()`.
 *   - `running` → `done` when the cursor exhausts with `loop === false`.
 *   - `running` → `aborted` when the internal `AbortController` fires (via
 *     `stop()`) or an external `AbortSignal` aborts.
 *
 * Per 03-RESEARCH §Open Question 1 (resolved in 03-02), once a `Replay`
 * instance reaches `done` or `aborted` it is single-use — `start()` throws
 * on re-call. Phase 4's `FakeTransport.reset()` constructs a fresh `Replay`
 * rather than recycling the state machine.
 *
 * Internal-only — D-REPL-12. Not exported from `src/index.ts`.
 */
export type ReplayState = 'idle' | 'running' | 'done' | 'aborted';
