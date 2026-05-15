# Phase 3: Replay Engine - Context

**Gathered:** 2026-05-16
**Status:** Ready for planning
**Mode:** auto (recommended-option selection across all gray areas; see Discussion Log)

<domain>
## Phase Boundary

Build the **internal replay scheduler** that consumes a `RideRecord[]` (from Phase 2) and emits records over time according to FIT timestamps. Surface in this phase is internal to the package (`src/replay/`) — Phase 4's FakeTransport owns the public `ITrainerTransport` API and decides what of the replay surface to re-export.

**In scope (from ROADMAP Phase 3):**
- Real-time emission respecting FIT record timestamps (REPL-01)
- Numeric `speed` multiplier including `Infinity`, with configurable max emission-rate cap (REPL-02)
- Drift-corrected scheduler — end within 250 ms of FIT duration over 30-min replay (REPL-03)
- Default stop-at-end; `loop: true` opt-in restarts from first record without drift accumulation across loop boundaries (REPL-04)
- `'complete'` event a test can await on stop-at-end (REPL-05)
- Clean cancellation: after `disconnect()` resolves, no further `onData` callbacks fire (REPL-06)

**Out of scope (deferred to Phase 4):**
- `ITrainerTransport` shape (`connect`, `disconnect`, `onData`, `sendResistance`, `received.resistance`, `reset()`)
- FTMS encoding wrapper around emitted `RideRecord` (Phase 4 wires the encoder from Phase 1 over the replay stream)
- Public package exports of replay primitives (Phase 4 decides surface)

</domain>

<decisions>
## Implementation Decisions

### Scheduler Primitive
- **D-REPL-01:** Use a **setTimeout chain** (recursive `setTimeout` re-armed after each emission) — NOT `setInterval` (cumulative drift) and NOT `setImmediate` tight loop (CPU pin). Each tick computes the next absolute target time and arms `setTimeout` with the delta to `performance.now()`. This is the standard Node pattern for drift-corrected schedulers.

### Drift Correction Algorithm
- **D-REPL-02:** **Per-tick recalibration** against a `performance.now()` baseline captured at replay start. Each scheduled emission targets `baseline + (recordTimestamp - firstRecordTimestamp) / speed`. Compute remaining delay as `target - performance.now()` on every tick. This bounds end-time error to roughly one event-loop turn (sub-ms) and naturally absorbs setTimeout's ±1ms scheduler jitter without accumulating.
- **D-REPL-03:** Use `performance.now()` (monotonic, sub-ms) — NOT `Date.now()` (wall-clock, can jump backward on NTP correction).

### Speed=Infinity & Emission Cap
- **D-REPL-04:** When `speed === Infinity`, the per-tick delay computation yields `0` (or negative). Emission is rate-limited by a configurable **max emission Hz** (default `1000` per requirement REPL-02 "configurable max emission-rate cap"). Implementation: clamp the computed delay to `max(0, 1000/maxEmissionHz)` ms. This naturally degrades from real-time → fast-replay → capped without branching on `speed`.
- **D-REPL-05:** `maxEmissionHz` is part of the replay config (`{ speed, loop, maxEmissionHz }`). Default 1000 Hz keeps tests fast; lowering it lets a soak test simulate sparse-record load without a long fixture.

### Loop Behavior
- **D-REPL-06:** **Re-base baseline on each loop iteration.** When the cursor reaches the last record under `loop: true`, reset `baseline = performance.now()` and reset cursor to `0` before scheduling the next emission. This eliminates drift accumulation across loop boundaries (REPL-04). The first record of each loop iteration emits at its FIT timestamp relative to the new baseline.
- **D-REPL-07:** Stop-at-end (default) emits the last record, then schedules a final `'complete'` event with zero delay (next-microtask). Replay state moves to `done`; subsequent `start()` calls throw or restart from cursor 0 (decision deferred — see Claude's Discretion).

### Completion Signal
- **D-REPL-08:** **Promise-first** API: `replay.completed` is a `Promise<void>` resolved when stop-at-end finishes. The `'complete'` event in REPL-05 is Phase 4's FakeTransport surface — Phase 3's internal Replay exposes the Promise; Phase 4 wires it onto `EventEmitter#emit('complete')`. Tests in this phase `await replay.completed`.

### Cancellation
- **D-REPL-09:** **AbortController-based** — replay accepts `{ signal?: AbortSignal }` in start config. On abort: `clearTimeout(currentTick)`, drop subscribers, reject `replay.completed` with the abort reason (or resolve with sentinel — TBD in planning, see Claude's Discretion). Internal teardown also clears the timeout if `replay.stop()` is called directly. Phase 4 derives its FakeTransport `disconnect()` AbortController from this.
- **D-REPL-10:** After abort/stop, **no further emissions fire**. Verified in tests with the "wait 100 ms after disconnect, assert zero emissions" pattern from REPL-06. The setTimeout-chain primitive (D-REPL-01) makes this trivial: a single `clearTimeout` on the pending tick is sufficient because there's only ever ONE pending tick.

### Subscriber Surface
- **D-REPL-11:** **Single subscriber** per Replay instance, registered via `replay.onRecord((record) => …)`. Multi-subscriber fan-out is Phase 4's FakeTransport responsibility. Replay returns a disposer for unsubscribe symmetry but Phase 4 will wrap it.

### Module Boundary
- **D-REPL-12:** All replay code lives in `src/replay/` with its own internal types. Public package surface is unchanged in this phase — `src/index.ts` is NOT extended. Phase 4 decides public re-exports.
- **D-REPL-13:** `src/replay/scheduler.ts` (the setTimeout chain + drift loop), `src/replay/replay.ts` (the public-to-Phase-4 class wrapping the scheduler with config + start/stop/completed), and `src/replay/types.ts` (internal `ReplayConfig`, `ReplayState`).

### Testing Strategy
- **D-REPL-14:** **Use `vi.useFakeTimers()`** for unit tests of the scheduler primitive — verifies setTimeout-chain logic, drift correction math, AbortController teardown, and loop boundary semantics deterministically and in <100 ms each.
- **D-REPL-15:** **One real-clock soak test** for REPL-03's drift gate: replay a 30-minute fixture (or scaled-down 30-second proxy with the math holding) and assert end-time within 250 ms. Marked `test.slow` or behind a `RUN_SOAK=1` env var to keep CI default fast.
- **D-REPL-16:** Use the Phase 2 fixtures as input — `perf-1hr.fit` for soak proxy (downsample to 30 min if needed); `autopause.fit` to verify gap timing is preserved (gaps are real time, not skipped); `basic.fit` for the path-vs-buffer-vs-replay parity sanity check.

### Claude's Discretion
- After stop-at-end completes, whether `replay.start()` can be called again to restart (or whether instances are single-use) — defer to planning.
- AbortController error semantics: reject `replay.completed` with the abort reason (`signal.reason`) vs resolving with a `{ aborted: true }` sentinel — defer to planning, but lean toward reject (matches `fetch` AbortController convention).
- Whether to expose `replay.cursor` / `replay.elapsedMs` accessors for tests — add only if tests need them; do not pre-expose for "future flexibility" (CLAUDE.md anti-pattern).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & roadmap
- `.planning/REQUIREMENTS.md` §Replay Engine — REPL-01 through REPL-06 (the binding requirement contracts)
- `.planning/ROADMAP.md` §Phase 3 — goal, dependencies, success criteria, "scheduler is keystone for v2 BlenoTransport too" note
- `.planning/PROJECT.md` — `ITrainerTransport` shape (consumed in Phase 4), real-time-only constraint, MIT/Node-24/TS stack

### Phase 2 outputs (the consumer of Phase 2's output is this phase)
- `src/types.ts` — `RideRecord` shape (`{ timestamp: number; power?: number; cadence?: number }`); replay scheduler iterates this exact type
- `src/fit/loader.ts` — `loadFitFromBuffer` / `loadFitFromPath` (input source for tests; replay does NOT import the loader directly — tests do)
- `src/fit/normalize.ts` §normalize — confirms timestamps are sorted ascending Unix-ms with no exact duplicates (Phase 3 relies on this invariant)
- `.planning/phases/02-fit-loader-normalization/02-VERIFICATION.md` — confirms FIT-03 "Unix epoch milliseconds" is true on the wire

### Phase 3 internal seams (will be created)
- `src/replay/scheduler.ts` — setTimeout chain + drift correction (per D-REPL-01, D-REPL-02)
- `src/replay/replay.ts` — public-to-Phase-4 class (per D-REPL-13)
- `src/replay/types.ts` — internal `ReplayConfig`, `ReplayState`

### Test fixtures (Phase 2)
- `test/fixtures/fit/basic.fit` — 443 records, 7 minutes — fast unit-test input
- `test/fixtures/fit/autopause.fit` — 3172 records with 2 gaps (max 68s) — verifies gap timing is preserved as real wait, not skipped
- `test/fixtures/fit/perf-1hr.fit` — 4562 records over 76 minutes — soak/drift gate input

### Node platform docs (no need to fetch — these are stable contracts)
- Node 24 `setTimeout` / `clearTimeout` / `AbortController` / `AbortSignal`
- Node 24 `performance.now()` (monotonic high-resolution timer)
- Vitest `vi.useFakeTimers()` / `vi.advanceTimersByTimeAsync()` (deterministic time control for unit tests)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`RideRecord` (src/types.ts)** — exact iteration target for the scheduler; no mapping/transform needed in Phase 3.
- **`util.debuglog('trainer-sim:fit')` pattern (Phase 2 D-FIT-09)** — reuse the same `debuglog` namespace bumped to `'trainer-sim:replay'` for drift-warning / cap-throttle observability (consistent across the package; opt-in via NODE_DEBUG).
- **Vitest 4 + `vi.useFakeTimers()` discipline (Phase 1 + Phase 2 tests)** — every Phase 1 test using time-based assertions used fake timers; Phase 3 follows the same pattern. Phase 2 already has a real-clock perf test (`test/fit/perf.test.ts`) — use it as the structural template for the REPL-03 soak test.
- **CRC-table-style isolation (Phase 2 lesson)** — when a primitive (here: drift math) is used in multiple places, define it once. Phase 3 is itself the canonical home for the scheduler; Phase 4's FakeTransport must NOT reimplement timing.

### Established Patterns
- **`.js` extensions on relative imports** — Phase 1 + Phase 2 convention; replay code follows.
- **No-`undefined`-vs-omitted distinction (Phase 2 D-FIT-01)** — `RideRecord.power` may be `undefined`; Phase 3 emits the record as-is, including absent fields. Replay does NOT inject defaults.
- **Sync-default-with-async-when-needed (Phase 2 D-FIT-07)** — `start()` returns synchronously; `replay.completed` is the Promise. Mirrors `loadFitFromBuffer` (sync) + `loadFitFromPath` (async).
- **Single seam for cross-cutting concerns (Phase 2 D-FIT-08)** — wrap any future scheduler-swap (e.g. `setImmediate` for low-latency tests) behind one internal interface.

### Integration Points
- **Phase 4 connection point:** `Replay` class instances are constructed inside Phase 4's `createFakeTransport(config)` factory. Phase 4 owns the lifecycle (start on `connect()`, stop on `disconnect()`).
- **Phase 5 connection point:** Replay is the only timing-sensitive primitive; VeloWorld E2E asserts that real-time replay produces FTMS frames at human-plausible cadence. No new code in Phase 5 — just observation through FakeTransport.
- **v2 BlenoTransport (out of scope):** ROADMAP note flags this scheduler as the keystone for v2. Design choices that make v2 hard (e.g., requiring a Node-only API that doesn't compose with Bleno's event loop) should be flagged in planning. AbortController + setTimeout-chain are both fine for v2.

</code_context>

<specifics>
## Specific Ideas

- **Drift-correction algorithm reference:** the "absolute target time + per-tick recompute" pattern is the same one used by `requestAnimationFrame`-style schedulers and by Node's own `setTimeout` cluster scheduling. No need for a third-party library — the math is ~10 lines.
- **30-second soak proxy:** if the 30-minute soak is too slow for CI, a 30-second proxy with `speed=60` over `perf-1hr.fit` traverses the same number of ticks — preserves the drift-correction stress profile but completes in CI time. Decide in planning.
- **No new public package exports.** Phase 3 ends with `npm run build` and `npm test` green, but `dist/index.js` does not gain a single new export. Phase 4 owns that.

</specifics>

<deferred>
## Deferred Ideas

- **Sparse smart-recording timing fidelity** — Phase 2's `autopause.fit` proves the loader preserves gaps. Phase 3 emits them as real time waits. Whether to add a `compactGaps: true` config (collapse gaps >Ns) is a Phase 4 / Phase 5 question if VeloWorld's E2E tests find the real-time gaps too slow.
- **Multi-subscriber fan-out** — Phase 4's FakeTransport handles multi-`onData` subscribers; the replay primitive itself is single-subscriber.
- **Deterministic-order replay** — if a future test wants "replay records in cursor order, ignoring timestamp" (e.g., for golden-file assertions), that's a Phase 4+ feature; Phase 3 is timestamp-driven only.
- **Resistance grade → power scaling** — explicitly out of scope per PROJECT.md ("Resistance affecting replayed power couples sim to physics; replay stays faithful"). Replay never modifies record values.
- **CLI / `trainer-sim play`** — v2 only.

</deferred>

---

*Phase: 03-replay-engine*
*Context gathered: 2026-05-16*
