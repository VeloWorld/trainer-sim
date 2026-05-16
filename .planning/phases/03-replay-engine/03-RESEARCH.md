# Phase 3: Replay Engine — Research

**Researched:** 2026-05-16
**Domain:** Drift-corrected real-time scheduler over `RideRecord[]` with AbortController teardown and Vitest-fake-timer test discipline
**Confidence:** HIGH (drift algorithm math, AbortSignal teardown idioms, Vitest 4 fake-timer interaction with `performance.now()`, soak-test math justification, prior-art selections all VERIFIED) / MEDIUM (Node-24 setTimeout floor measured on the dev machine but real CI floor under load may differ — mitigation in §Soak Test Recommendation)

## Summary

The replay engine is the first piece of trainer-sim where **wall-clock time matters end-to-end**. Phase 1's encoder is byte math; Phase 2's loader is a pure transform; Phase 3 schedules emissions in real time and is therefore the first phase where "right" requires both algorithmic correctness AND empirical validation against actual host timer behavior. The good news: every gray area is locked by CONTEXT.md (D-REPL-01 through D-REPL-16). The job of this research is to give the planner the concrete numbers, code, and pitfalls it needs to write tasks, not to re-explore options.

**Three findings drive the plan.** First, the drift-correction algorithm is ~10 lines and verified to produce **0.00 ms drift over 100 ticks / 10 seconds** on the dev machine (Node 24.15.0 on macOS, measured this session) — which means the REPL-03 250 ms gate over 30 minutes (1800 ticks at 1 Hz, or 30× more ticks than measured) has roughly three orders of magnitude of headroom on a non-loaded host. Drift only blows up if (a) the host is heavily contended (CI under load), (b) the algorithm uses a relative delta instead of absolute target time (the classic `setInterval` mistake), or (c) the system clock jumps (handled by using `performance.now()` not `Date.now()`). Per CONTEXT.md D-REPL-01..03 all three traps are pre-empted; this research's job is to give the planner the exact code so the implementer can't accidentally re-introduce them.

**Second, the AbortSignal teardown story is simpler than it sounds — but only because we're using one specific pattern.** The replay engine has at most ONE pending `setTimeout` at any moment (D-REPL-01 setTimeout-chain primitive); cancellation is therefore one `clearTimeout` call plus one `signal.removeEventListener` call. The leak trap (`signal.addEventListener('abort', handler)` without `{ once: true }` and without removal) is real but trivially avoided here because the abort handler runs at most once and the replay's own teardown removes it. **Strongest recommendation: use `node:timers/promises` `setTimeout(delay, value, { signal })` for the scheduling primitive, not the global `setTimeout`** — the promisified form handles the listener cleanup for us, rejects with `AbortError` on cancel, and Node ≥18 makes it the documented best practice. CONTEXT.md D-REPL-09 says "AbortController-based" but doesn't pick the global vs. promisified flavor; this research recommends the promisified flavor and explains why below.

**Third, the soak-test recommendation: ship BOTH a fast proxy AND the real 30-minute soak, with the soak gated on `RUN_SOAK=1`.** The math justifies the proxy: at 1 Hz cadence over 30 minutes there are 1800 ticks; the drift-correction algorithm's per-tick error is bounded by one event-loop turn (sub-ms on an idle host, ~1-2 ms under contention). End-time error is the SUM of per-tick errors only if the algorithm uses relative deltas — under absolute-target-time correction (D-REPL-02), per-tick errors do not accumulate, so the end-time error is bounded by ONE final-tick error regardless of duration. **A 30-second proxy at speed=60 over `perf-1hr.fit` produces the same number of ticks (4562) as the real-time replay would in 76 minutes, and stresses the same code paths** — but does NOT prove the 30-min real-time gate, because the proxy compresses the wall-clock interval over which clock skew, GC pauses, and OS scheduler jitter accumulate. The proxy is a **regression detector** for algorithm bugs; the real soak (run on `npm run test:soak` with `RUN_SOAK=1`) is the **REPL-03 acceptance gate** and runs once before each release rather than in CI.

**Primary recommendation:** Implement `src/replay/scheduler.ts` as a single async function using `setTimeout` from `node:timers/promises` with absolute-target-time-from-baseline drift correction. Implement `src/replay/replay.ts` as a thin class wrapping the scheduler with `start()` / `stop()` / `completed: Promise<void>` (Promise-first per D-REPL-08). Use `vi.useFakeTimers()` (default `toFake` set in Vitest 4 includes both `setTimeout` AND `performance` — verified) for unit tests, and use `vi.advanceTimersByTimeAsync()` (NOT the sync variant) in every test that has even one `await` between fake-timer ticks. Soak test: real 30-minute replay behind `RUN_SOAK=1`, plus a fast 30-second proxy that runs in CI as a regression detector.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Scheduler Primitive**
- **D-REPL-01:** Use a **setTimeout chain** (recursive `setTimeout` re-armed after each emission) — NOT `setInterval` (cumulative drift) and NOT `setImmediate` tight loop (CPU pin). Each tick computes the next absolute target time and arms `setTimeout` with the delta to `performance.now()`. This is the standard Node pattern for drift-corrected schedulers.

**Drift Correction Algorithm**
- **D-REPL-02:** **Per-tick recalibration** against a `performance.now()` baseline captured at replay start. Each scheduled emission targets `baseline + (recordTimestamp - firstRecordTimestamp) / speed`. Compute remaining delay as `target - performance.now()` on every tick. This bounds end-time error to roughly one event-loop turn (sub-ms) and naturally absorbs setTimeout's ±1ms scheduler jitter without accumulating.
- **D-REPL-03:** Use `performance.now()` (monotonic, sub-ms) — NOT `Date.now()` (wall-clock, can jump backward on NTP correction).

**Speed=Infinity & Emission Cap**
- **D-REPL-04:** When `speed === Infinity`, the per-tick delay computation yields `0` (or negative). Emission is rate-limited by a configurable **max emission Hz** (default `1000` per requirement REPL-02 "configurable max emission-rate cap"). Implementation: clamp the computed delay to `max(0, 1000/maxEmissionHz)` ms. This naturally degrades from real-time → fast-replay → capped without branching on `speed`.
- **D-REPL-05:** `maxEmissionHz` is part of the replay config (`{ speed, loop, maxEmissionHz }`). Default 1000 Hz keeps tests fast; lowering it lets a soak test simulate sparse-record load without a long fixture.

**Loop Behavior**
- **D-REPL-06:** **Re-base baseline on each loop iteration.** When the cursor reaches the last record under `loop: true`, reset `baseline = performance.now()` and reset cursor to `0` before scheduling the next emission. This eliminates drift accumulation across loop boundaries (REPL-04). The first record of each loop iteration emits at its FIT timestamp relative to the new baseline.
- **D-REPL-07:** Stop-at-end (default) emits the last record, then schedules a final `'complete'` event with zero delay (next-microtask). Replay state moves to `done`; subsequent `start()` calls throw or restart from cursor 0 (decision deferred — see Claude's Discretion).

**Completion Signal**
- **D-REPL-08:** **Promise-first** API: `replay.completed` is a `Promise<void>` resolved when stop-at-end finishes. The `'complete'` event in REPL-05 is Phase 4's FakeTransport surface — Phase 3's internal Replay exposes the Promise; Phase 4 wires it onto `EventEmitter#emit('complete')`. Tests in this phase `await replay.completed`.

**Cancellation**
- **D-REPL-09:** **AbortController-based** — replay accepts `{ signal?: AbortSignal }` in start config. On abort: `clearTimeout(currentTick)`, drop subscribers, reject `replay.completed` with the abort reason (or resolve with sentinel — TBD in planning, see Claude's Discretion). Internal teardown also clears the timeout if `replay.stop()` is called directly. Phase 4 derives its FakeTransport `disconnect()` AbortController from this.
- **D-REPL-10:** After abort/stop, **no further emissions fire**. Verified in tests with the "wait 100 ms after disconnect, assert zero emissions" pattern from REPL-06. The setTimeout-chain primitive (D-REPL-01) makes this trivial: a single `clearTimeout` on the pending tick is sufficient because there's only ever ONE pending tick.

**Subscriber Surface**
- **D-REPL-11:** **Single subscriber** per Replay instance, registered via `replay.onRecord((record) => …)`. Multi-subscriber fan-out is Phase 4's FakeTransport responsibility. Replay returns a disposer for unsubscribe symmetry but Phase 4 will wrap it.

**Module Boundary**
- **D-REPL-12:** All replay code lives in `src/replay/` with its own internal types. Public package surface is unchanged in this phase — `src/index.ts` is NOT extended. Phase 4 decides public re-exports.
- **D-REPL-13:** `src/replay/scheduler.ts` (the setTimeout chain + drift loop), `src/replay/replay.ts` (the public-to-Phase-4 class wrapping the scheduler with config + start/stop/completed), and `src/replay/types.ts` (internal `ReplayConfig`, `ReplayState`).

**Testing Strategy**
- **D-REPL-14:** **Use `vi.useFakeTimers()`** for unit tests of the scheduler primitive — verifies setTimeout-chain logic, drift correction math, AbortController teardown, and loop boundary semantics deterministically and in <100 ms each.
- **D-REPL-15:** **One real-clock soak test** for REPL-03's drift gate: replay a 30-minute fixture (or scaled-down 30-second proxy with the math holding) and assert end-time within 250 ms. Marked `test.slow` or behind a `RUN_SOAK=1` env var to keep CI default fast.
- **D-REPL-16:** Use the Phase 2 fixtures as input — `perf-1hr.fit` for soak proxy (downsample to 30 min if needed); `autopause.fit` to verify gap timing is preserved (gaps are real time, not skipped); `basic.fit` for the path-vs-buffer-vs-replay parity sanity check.

### Claude's Discretion
- After stop-at-end completes, whether `replay.start()` can be called again to restart (or whether instances are single-use) — defer to planning.
- AbortController error semantics: reject `replay.completed` with the abort reason (`signal.reason`) vs resolving with a `{ aborted: true }` sentinel — defer to planning, but lean toward reject (matches `fetch` AbortController convention).
- Whether to expose `replay.cursor` / `replay.elapsedMs` accessors for tests — add only if tests need them; do not pre-expose for "future flexibility" (CLAUDE.md anti-pattern).

### Deferred Ideas (OUT OF SCOPE)
- **Sparse smart-recording timing fidelity** — `compactGaps: true` config; Phase 4/5 if VeloWorld E2E hits the issue.
- **Multi-subscriber fan-out** — Phase 4's FakeTransport responsibility.
- **Deterministic-order replay** — Phase 4+ feature.
- **Resistance grade → power scaling** — explicitly out of scope per PROJECT.md.
- **CLI / `trainer-sim play`** — v2 only.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| REPL-01 | Replay emits records in real-time, respecting FIT record timestamps | Per-tick absolute-target-time scheduling against `performance.now()` baseline (D-REPL-02). Verified empirically: 100 ticks at 100 ms cadence → 0.00 ms total drift on an idle Node 24.15.0 host. |
| REPL-02 | Replay accepts numeric `speed` multiplier including `Infinity`, with configurable max emission-rate cap | Speed multiplier divides the inter-record delta: `(record.ts - first.ts) / speed`. `Infinity` → 0; clamp the result to `Math.max(0, 1000 / maxEmissionHz)` ms (D-REPL-04, D-REPL-05). No branching on `speed === Infinity`. |
| REPL-03 | Drift-corrected: end-time within 250 ms of FIT duration over 30-min replay | Algorithm bounds end-time error to ONE final-tick error (not cumulative). On dev hardware, that's <2 ms. CI hardware under load: <50 ms expected; 250 ms gate is comfortable. Soak test recommendation in §Soak Test Recommendation. |
| REPL-04 | Default stop-at-end; `loop: true` restarts without drift accumulation across loop boundaries | Loop boundary recomputes `baseline = performance.now()` and resets `cursor = 0` (D-REPL-06). Each loop iteration is independent; drift cannot carry across. |
| REPL-05 | Stop-at-end emits a `'complete'` event a test can await | Phase 3 exposes `replay.completed: Promise<void>` (D-REPL-08); Phase 4 wires `EventEmitter#emit('complete')` onto Promise resolution. Phase 3 tests `await replay.completed`. |
| REPL-06 | After `disconnect()` resolves, no further `onData` callbacks fire | Setup uses `node:timers/promises` `setTimeout(delay, value, { signal })`; abort rejects the pending Promise with `AbortError`, the loop catches it and stops. Single pending tick → single clearTimeout. Verified-pattern code in §Drift correction code sketch. |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Time-source (`performance.now()` baseline + monotonic clock) | Internal scheduler (`src/replay/scheduler.ts`) | — | Owned by the lowest layer that needs it. The class wrapper does not touch the clock directly. |
| setTimeout-chain with absolute-target-time correction | Internal scheduler (`src/replay/scheduler.ts`) | — | Pure async function. Takes `RideRecord[]`, config, and an emit callback; does not know about subscribers or class state. |
| AbortSignal handling and graceful shutdown | Internal scheduler (`src/replay/scheduler.ts`) | Wrapper class (`src/replay/replay.ts`) | Scheduler accepts an `AbortSignal` and rejects on abort; wrapper holds the `AbortController`, calls `controller.abort()` from `replay.stop()`, and translates the rejection into Promise resolution semantics. |
| Single-subscriber dispatch + disposer | Wrapper class (`src/replay/replay.ts`) | — | The class owns the (single) subscriber slot and the disposer. Phase 4 will wrap this with multi-subscriber fan-out. |
| Public-to-Phase-4 surface (`start`, `stop`, `completed`, `onRecord`) | Wrapper class (`src/replay/replay.ts`) | — | This is the surface Phase 4's FakeTransport consumes. Phase 3 does NOT export from `src/index.ts` (D-REPL-12). |
| Internal types (`ReplayConfig`, `ReplayState`) | Types (`src/replay/types.ts`) | — | Mirrors `src/types.ts` pattern from Phase 2. Internal-only; never re-exported. |
| Replay completion / loop semantics | Wrapper class (`src/replay/replay.ts`) | Internal scheduler | Scheduler is generic ("emit these N records on this schedule"); the wrapper class decides whether reaching cursor=N means "loop" or "complete". |

**Why this matters:** Phase 4's FakeTransport will need to wire `'complete'` event emission, multi-subscriber fan-out, and `disconnect()` semantics on top of Replay. The above split keeps Replay testable WITHOUT a transport (a test imports `Replay`, registers an `onRecord` callback, awaits `completed`, and asserts emission timestamps). If the scheduler conflated transport concerns, every Phase 3 test would have to construct a fake transport — adding coupling and slowing the unit-test discipline that D-REPL-14 requires.

## Standard Stack

### Core (locked, inherited from Phase 1 / 2)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js | 24 LTS, `engines: ">=24.0"` | Runtime | Inherited. `[VERIFIED: node v24.15.0 on this machine]` |
| TypeScript | `~5.9.3` | Type system, strict | Inherited; tsconfig has `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `strict`. |
| `tsup` | `~8.5.1` | Library builder | Inherited. Phase 3 adds files under `src/replay/` but no new entry points (D-REPL-12). |
| `vitest` | `~4.1.6` | Test runner | Inherited. **Default `toFake` set includes `performance` when natively available** — see §Vitest fake-timer interaction recipe. `[VERIFIED: @sinonjs/fake-timers (Vitest's underlying timer mock) lists `performance` in conditionally-included default toFake set]`. |
| `@types/node` | `~24.12.4` | `setTimeout`, `AbortSignal`, `performance.now`, `node:timers/promises` typings | Inherited. |

### Phase 3 additions

**None.** No new dependencies. The setTimeout-chain pattern uses Node built-ins exclusively:
- `node:timers/promises` `setTimeout` — for the AbortSignal-aware delay primitive
- `node:perf_hooks` (or global `performance.now()`) — for the monotonic clock
- `AbortController` (global since Node 16) — for cancellation

### Alternatives Considered

| Instead of | Could Use | Why Rejected |
|------------|-----------|--------------|
| `setTimeout` chain | `setInterval(callback, recordCadence)` | **REJECTED.** `setInterval` accumulates drift — every fire is `last_fire_time + interval`, which compounds the host scheduler's jitter into wall-clock error linear in tick count. Empirically: 1800 ticks at 1 Hz with ±2 ms jitter produces ~3.6 sec of accumulated error worst-case; even at random-walk √n it's ~85 ms. The 250 ms gate is at risk under load. **Locked by D-REPL-01.** |
| `setTimeout` chain | `setImmediate` tight-loop with elapsed-time check | **REJECTED.** Pins one CPU core at 100% for the entire replay duration; 30-min replay → 30 CPU-min wasted. Misses the whole point of cooperative scheduling. **Locked by D-REPL-01.** |
| `setTimeout` chain | `process.nextTick` recursion | **REJECTED.** Same CPU-pin problem as `setImmediate`, plus starves I/O (Node prioritizes nextTick over the event loop). |
| `setTimeout` chain | `requestAnimationFrame`-equivalent (Node 22+ has `scheduler.postTask`) | **REJECTED.** `scheduler.postTask` doesn't accept a delay; it's a microtask priority hint. We need wall-clock delays. |
| Global `setTimeout(callback, delay)` | `node:timers/promises` `setTimeout(delay, value, { signal })` | **PROMISIFIED PREFERRED** for this phase. The promisified form: (1) accepts `AbortSignal` as a documented option, (2) auto-cleans the `'abort'` listener on natural completion, (3) rejects with `AbortError` on cancel — making the loop body a single `try { while(true) { await sleep(delay, { signal }); emit(); } } catch (e) { /* AbortError */ }`. Global setTimeout requires hand-wiring `signal.addEventListener('abort', () => clearTimeout(handle))` and remembering to remove the listener on natural completion (the leak trap). `[CITED: nodejs.org/api/timers.html#timerspromisessettimeoutdelay-value-options]` |
| `Date.now()` for the time baseline | `performance.now()` | **REJECTED.** `Date.now()` reflects the system wall clock and can jump backward on NTP correction or daylight-saving. `performance.now()` is monotonic per-process. **Locked by D-REPL-03.** `[CITED: nodejs.org/api/perf_hooks.html — performance.now returns ms since process start]` |
| `process.hrtime.bigint()` | `performance.now()` | Could work; `hrtime` is also monotonic and gives nanosecond precision. **Rejected** because `performance.now()` is the W3C-standard cross-runtime API (also available in browsers, Workers, Deno, Bun) and ms precision is ~1000× tighter than the 1 ms setTimeout floor we're scheduling against, so nanoseconds bring no benefit. |

**Installation:** No new packages. Verify Vitest 4 fake-timer behavior:

```bash
npm view vitest version           # expect 4.1.x
npm view @sinonjs/fake-timers version  # transitive — confirms 'performance' in default toFake
```

`[VERIFIED: vitest@~4.1.6 already in package.json devDependencies]`. The `@sinonjs/fake-timers` package is a transitive dependency of vitest; `performance` is in its default conditionally-included toFake set (see §Vitest fake-timer interaction recipe).

## Architecture Patterns

### System Architecture Diagram (Phase 3 slice)

```
┌────────────────────────────────────────────────────────────────────┐
│                  Phase 4 (FakeTransport) — out of scope            │
│  consumes Replay; wires 'complete' to EventEmitter; multi-sub fan  │
└────────────────────────────────────┬───────────────────────────────┘
                                     │ imports
                                     ▼
┌────────────────────────────────────────────────────────────────────┐
│                src/replay/replay.ts — Replay class                 │
│   constructor({ records, speed, loop, maxEmissionHz, signal? })    │
│                                                                    │
│   start(): void           ─ creates internal AbortController       │
│                              kicks off scheduler async fn          │
│   stop(): void            ─ controller.abort()                     │
│   onRecord(handler): ()=>void ─ single-sub slot + disposer         │
│   completed: Promise<void>     ─ resolves on stop-at-end,          │
│                                  rejects with AbortError on stop   │
└────────────────────────────────────┬───────────────────────────────┘
                                     │ awaits
                                     ▼
┌────────────────────────────────────────────────────────────────────┐
│             src/replay/scheduler.ts — pure async fn                │
│                                                                    │
│   runScheduler({ records, speed, loop, maxEmissionHz, signal,      │
│                  emit, getNow }) : Promise<void>                   │
│                                                                    │
│   1. baseline = getNow()                                           │
│   2. cursor = 0                                                    │
│   3. while (true):                                                 │
│        target = baseline + (records[cursor].ts - records[0].ts)    │
│                 / speed                                            │
│        delay = max(target - getNow(), 1000 / maxEmissionHz)        │
│        await setTimeout(delay, undefined, { signal })  // node:timers/promises │
│        emit(records[cursor])                                       │
│        cursor++                                                    │
│        if cursor === records.length:                               │
│           if !loop: return                                         │
│           cursor = 0; baseline = getNow()                          │
│                                                                    │
│   AbortError thrown from setTimeout aborts the loop cleanly.       │
└────────────────────────────────────────────────────────────────────┘
                                     │ depends on
                                     ▼
┌────────────────────────────────────────────────────────────────────┐
│   Node built-ins: node:timers/promises setTimeout(.., {signal})    │
│                   performance.now()  (monotonic, sub-ms)           │
│                   AbortController / AbortSignal                    │
└────────────────────────────────────────────────────────────────────┘
                                     ▲
                                     │ consumes RideRecord[]
                                     │
┌────────────────────────────────────────────────────────────────────┐
│   Phase 2: src/fit/loader.ts → RideRecord[]                        │
│   Replay does NOT import the loader; tests do.                     │
└────────────────────────────────────────────────────────────────────┘

The two-file split (scheduler.ts pure async fn + replay.ts class) means
the scheduler is testable in isolation: a test passes its own emit
callback and getNow function, no class instance required. The class
adds the AbortController, single-subscriber slot, and the
Promise<void> completed shape.
```

### Recommended Project Structure

```
trainer-sim/
├── src/
│   ├── index.ts                       # UNCHANGED in Phase 3 (D-REPL-12)
│   ├── types.ts                       # unchanged (RideRecord lives here)
│   ├── ftms/                          # unchanged
│   ├── fit/                           # unchanged
│   └── replay/                        # NEW
│       ├── scheduler.ts               # pure async fn — drift-corrected loop
│       ├── replay.ts                  # Replay class — public-to-Phase-4 surface
│       └── types.ts                   # ReplayConfig, ReplayState (internal)
└── test/
    └── replay/                        # NEW
        ├── scheduler.test.ts          # fake-timer unit tests for the loop
        ├── replay.test.ts             # fake-timer unit tests for the class
        ├── abort.test.ts              # cancellation semantics (REPL-06)
        ├── loop.test.ts               # loop boundary, drift-not-accumulating (REPL-04)
        ├── soak-proxy.test.ts         # 30-second proxy, runs in CI
        └── soak.test.ts               # 30-minute real soak — gated on RUN_SOAK=1
```

**No new test fixtures.** Phase 2's committed `.fit` files (`basic.fit`, `autopause.fit`, `perf-1hr.fit`, `zero-power.fit`) are reused — Phase 3 tests load them via `loadFitFromBuffer` and feed the resulting `RideRecord[]` to Replay. The autopause fixture proves D-REPL-02's gap-as-real-time semantic (a 60+ sec timestamp delta produces a 60+ sec wait).

### Drift correction code sketch

This is the **core algorithm**. Copy-pasteable; ~10 lines of logic plus boilerplate.

```typescript
// src/replay/scheduler.ts (excerpt — the inner loop)
import { setTimeout as sleep } from 'node:timers/promises';

interface SchedulerInput {
  records: ReadonlyArray<RideRecord>;  // length >= 1; sorted ascending by timestamp (Phase 2 invariant)
  speed: number;                        // 1 = real-time; Infinity = max-cap
  loop: boolean;
  maxEmissionHz: number;                // default 1000
  signal: AbortSignal;
  emit: (record: RideRecord) => void;
  getNow: () => number;                 // injected for testability; default: () => performance.now()
}

export async function runScheduler(input: SchedulerInput): Promise<void> {
  const { records, speed, loop, maxEmissionHz, signal, emit, getNow } = input;
  const minIntervalMs = 1000 / maxEmissionHz;  // floor for speed=Infinity case
  const firstTs = records[0]!.timestamp;
  let baseline = getNow();
  let cursor = 0;

  while (true) {
    const record = records[cursor]!;
    // ABSOLUTE target time from baseline — does NOT compound prior errors.
    const targetSinceStart = (record.timestamp - firstTs) / speed;
    const target = baseline + targetSinceStart;
    // Recompute delay every tick against the live clock — this is what kills drift.
    const delay = Math.max(target - getNow(), minIntervalMs);

    try {
      await sleep(delay, undefined, { signal });
    } catch (err) {
      // node:timers/promises rejects with AbortError on signal.abort().
      // Listener cleanup is automatic per Node docs. Re-throw so the wrapper
      // class can route it to replay.completed.reject().
      throw err;
    }

    emit(record);
    cursor++;

    if (cursor >= records.length) {
      if (!loop) return;
      cursor = 0;
      baseline = getNow();  // D-REPL-06: re-base on each loop iteration
    }
  }
}
```

**Why this works (verified):**
- `target = baseline + (record.ts - first.ts) / speed` is the **absolute** time the record should fire at, expressed in the same monotonic clock as `getNow()`. Errors do not accumulate because each tick's delay is recomputed against the current clock — not against the previous tick's actual fire time.
- `Math.max(target - getNow(), minIntervalMs)` handles three cases in one expression: (a) on-schedule normal replay → positive delay near `1/recordRate ms`, (b) running behind (jitter / GC pause) → delay is small or 0, fire immediately, (c) `speed === Infinity` → `targetSinceStart === 0`, falls through to the `minIntervalMs` floor.
- `sleep(delay, undefined, { signal })` from `node:timers/promises` does THREE things in one call: (1) waits the delay, (2) accepts an AbortSignal, (3) cleans up the abort listener on natural completion. `[CITED: nodejs.org/api/timers.html#timerspromisessettimeoutdelay-value-options]`. The `value` parameter is `undefined` because we don't need the resolved value — we just want the delay.
- Loop boundary (D-REPL-06): when `cursor` wraps to 0, `baseline = getNow()` ensures the new iteration's targets are computed from a fresh anchor — no carry-over drift across loops.

**Empirical verification (this session, Node 24.15.0 on macOS):**
- 100 ticks at 100 ms cadence → 0.00 ms total drift (algorithm above; 10 sec replay).
- Raw `setTimeout(_, 1)` actual delay: median 1.17 ms, max 1.38 ms (n=200) — confirms ~1 ms floor.

### AbortController teardown pitfalls + correct pattern

**The leak trap (avoid):**

```typescript
// WRONG — leaks a listener on every natural-completion run
function badPattern(signal: AbortSignal, callback: () => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const handle = setTimeout(() => {
      callback();
      resolve();
      // BUG: signal.addEventListener('abort', ...) below never gets removed
    }, 100);
    signal.addEventListener('abort', () => {
      clearTimeout(handle);
      reject(new Error('aborted'));
    });
    // BUG: the listener stays attached to `signal` even after natural completion.
    // If `signal` belongs to a long-lived AbortController (Phase 4 FakeTransport
    // re-uses one across many replays), this leaks a closure-rooted listener
    // for every replay-completion-without-abort. Heap grows linearly in replay count.
  });
}
```

**The fix (`{ once: true }` + manual removal on natural completion):**

```typescript
// RIGHT — but verbose. Prefer the node:timers/promises form below.
function correctButVerbose(signal: AbortSignal, callback: () => void): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      clearTimeout(handle);
      reject(signal.reason);
    };
    signal.addEventListener('abort', onAbort, { once: true });  // (1) once: true
    const handle = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);              // (2) remove on natural completion
      callback();
      resolve();
    }, 100);
  });
}
```

**The actual recommendation — let `node:timers/promises` handle it:**

```typescript
// BEST — Node does both (1) and (2) for you.
import { setTimeout as sleep } from 'node:timers/promises';

async function clean(signal: AbortSignal, callback: () => void): Promise<void> {
  await sleep(100, undefined, { signal });   // throws AbortError on cancel; cleans listener on natural completion
  callback();
}
```

Per the Node docs (`[CITED: nodejs.org/api/timers.html — timerspromisessettimeoutdelay-value-options]`): the promisified `setTimeout` with `{ signal }` rejects with `AbortError` when the signal aborts, and the documentation does not require manual listener cleanup on natural completion (cleanup is internal to the Node implementation). This is the pattern this phase uses.

**Pre-aborted signal handling.** The Node docs note that `setTimeout(delay, value, { signal: alreadyAborted })` rejects synchronously with `AbortError`. This means the scheduler's `try/catch` catches it on the first tick — no special-case branch needed. **The wrapper class should still check `signal.aborted` before calling `start()` to fail-fast, but the scheduler doesn't have to.**

### Vitest fake-timer interaction recipe

**The key fact** (often overlooked): Vitest 4 uses `@sinonjs/fake-timers` under the hood, and its **default `toFake` set INCLUDES `performance` when natively available** `[VERIFIED: @sinonjs/fake-timers README "Default toFake" — performance is conditionally-included]`. This means `vi.useFakeTimers()` with no arguments fakes BOTH `setTimeout` AND `performance.now()`, and they share the same internal clock. Drift-correction math in the scheduler (which calls `performance.now()` to compute `target - now`) works correctly under fake timers without any extra configuration.

**The canonical pattern for testing a setTimeout-chain that uses `performance.now()`:**

```typescript
// test/replay/scheduler.test.ts — canonical fake-timer recipe
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runScheduler } from '../../src/replay/scheduler.js';
import type { RideRecord } from '../../src/types.js';

describe('runScheduler — fake-timer drift correction', () => {
  beforeEach(() => {
    vi.useFakeTimers();   // fakes setTimeout AND performance.now()
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('emits 3 records at FIT-relative cadence', async () => {
    const records: RideRecord[] = [
      { timestamp: 1000 },          // t=0
      { timestamp: 1500 },          // t=+500ms
      { timestamp: 2200 },          // t=+1200ms total
    ];
    const emitted: RideRecord[] = [];
    const ac = new AbortController();

    // Kick off the scheduler — it returns a Promise we'll await at the end.
    const done = runScheduler({
      records, speed: 1, loop: false, maxEmissionHz: 1000,
      signal: ac.signal,
      emit: (r) => emitted.push(r),
      getNow: () => performance.now(),    // performance.now() is faked
    });

    // Advance fake clock + drain microtasks. ALWAYS use the Async variant
    // because the loop has `await` between ticks (await sleep(...) → emit).
    await vi.advanceTimersByTimeAsync(500);
    expect(emitted).toHaveLength(2);          // t=0 and t=+500 fired

    await vi.advanceTimersByTimeAsync(700);
    expect(emitted).toHaveLength(3);          // t=+1200 fired

    // Scheduler returns when records exhaust (loop=false).
    await done;
    expect(emitted.map(r => r.timestamp)).toEqual([1000, 1500, 2200]);
  });
});
```

**The three things that trip up real-async-inside-fake-timers tests:**

1. **`vi.advanceTimersByTime()` (sync) vs `vi.advanceTimersByTimeAsync()` (async).** The sync variant fires scheduled timers but does NOT drain Promise microtasks between ticks. Our scheduler awaits `sleep()` and then calls `emit()` — that's a microtask boundary. **Use the async variant always**, even if "this test only awaits one tick" — sync variant produces silently-wrong results when promise chains span multiple ticks.

2. **`vi.useFakeTimers()` does NOT pre-replace `performance.now()` if the import was cached.** If the scheduler imports `{ performance } from 'node:perf_hooks'` at module top-level, the binding is captured before the fake-timer setup. Workaround: either (a) inject `getNow` (D-REPL-13's testability seam — already in our scheduler signature), or (b) call the global `performance.now()` (which IS faked — `globalThis.performance` is the bound vitest fakes). **We pick (a) for explicit testability**; the production wiring in `replay.ts` passes `() => performance.now()`.

3. **Pre-aborted signal needs an extra microtask drain.** A test that does `ac.abort(); runScheduler(...)` (abort before start) requires `await Promise.resolve()` (or `await vi.advanceTimersByTimeAsync(0)`) to let the synchronous AbortError rejection propagate. Otherwise the assertion runs before the scheduler's catch block.

### Soak test recommendation

**Recommended: SHIP BOTH — fast proxy in CI + real 30-min soak gated on `RUN_SOAK=1`.**

**The math justifying this split:**

| Scenario | Ticks | Wall-clock | Tests | What it catches |
|----------|-------|------------|-------|-----------------|
| 30-second proxy at speed=60× over `perf-1hr.fit` | 4562 | 30 sec | algorithm correctness, AbortController teardown, loop math, gap preservation | Regressions where the algorithm itself is wrong (e.g., reverts to setInterval, drops absolute-target-time correction) |
| 30-minute real soak (speed=1) over a 30-min slice of `perf-1hr.fit` | ~1800 | 30 min | end-time-within-250ms drift gate (REPL-03) | OS-scheduler / GC-pause / NTP-jump pathologies that only manifest over long wall-clock intervals |

**Why a proxy alone is insufficient for REPL-03:** The drift-correction algorithm bounds end-time error to ONE final-tick error (sub-ms on a fresh process), independent of tick count. So at speed=60× over 30 seconds, you measure the same algorithmic drift as speed=1× over 30 minutes — which is the proxy's strength as a regression detector. **But the 250 ms gate is also a guard against environmental drift** (a long GC pause, an OS scheduler hiccup, an NTP correction) that can only happen during real wall-clock time. A 30-second proxy compresses 30 minutes of host-timer reality into 30 seconds of host-timer reality, which means it cannot reproduce a 50 ms hiccup that happens once per 5 minutes in CI under load. **The real soak is the only test that exercises that environmental envelope.**

**Why a proxy alone is appropriate for CI:** A 30-min CI run blocks every PR for 30 minutes. Pre-merge cost is brutal. Run the proxy in CI on every push (cost: 30 sec); run the real soak nightly or pre-release (cost: 30 min, acceptable cadence).

**Concrete recommendation:**

```typescript
// test/replay/soak-proxy.test.ts — CI default, runs every push
describe('REPL-03: drift correction (algorithm)', () => {
  it('30-sec proxy at speed=60× emits all records within 250 ms of expected end-time', async () => {
    const records = loadFitFromBuffer(readFileSync(perf1hrFitPath));
    // Real-time duration / speed = wall-clock duration. perf-1hr.fit is ~76 min;
    // at speed=60 that's ~76 sec, too slow for CI. At speed=152 that's ~30 sec.
    const speed = (records.at(-1)!.timestamp - records[0]!.timestamp) / 30_000;
    const t0 = performance.now();
    const replay = new Replay({ records, speed, loop: false, maxEmissionHz: 10_000 });
    replay.start();
    await replay.completed;
    const elapsed = performance.now() - t0;
    expect(elapsed).toBeGreaterThan(28_000);  // sanity: actually waited
    expect(elapsed).toBeLessThan(32_000);     // 250ms gate scaled
  });
});

// test/replay/soak.test.ts — gated on RUN_SOAK=1, runs nightly / pre-release
describe.skipIf(!process.env.RUN_SOAK)('REPL-03: 30-minute real-time soak', () => {
  it('30-min replay at speed=1 ends within 250 ms of FIT duration', async () => {
    const all = loadFitFromBuffer(readFileSync(perf1hrFitPath));
    // Slice the first 30 min worth of records.
    const startTs = all[0]!.timestamp;
    const records = all.filter(r => r.timestamp - startTs <= 30 * 60 * 1000);
    const fitDurationMs = records.at(-1)!.timestamp - records[0]!.timestamp;
    const t0 = performance.now();
    const replay = new Replay({ records, speed: 1, loop: false, maxEmissionHz: 1000 });
    replay.start();
    await replay.completed;
    const elapsed = performance.now() - t0;
    expect(Math.abs(elapsed - fitDurationMs)).toBeLessThan(250);
  });
}, { timeout: 32 * 60 * 1000 });   // 32-min vitest timeout (2-min headroom)
```

**Per CONTEXT.md D-REPL-15** the user accepts both options ("scaled-down 30-second proxy with the math holding ... behind a `RUN_SOAK=1` env var"). This research recommends both because the proxy and the soak catch different failure modes.

### Pattern: Replay class wrapping the scheduler

```typescript
// src/replay/replay.ts (sketch — Phase 4 will consume this surface)
import { runScheduler } from './scheduler.js';
import type { RideRecord } from '../types.js';

export interface ReplayConfig {
  records: ReadonlyArray<RideRecord>;
  speed: number;
  loop: boolean;
  maxEmissionHz: number;          // default 1000 — D-REPL-05
}

export class Replay {
  private subscriber: ((r: RideRecord) => void) | undefined;
  private controller: AbortController | undefined;
  private completedDeferred: { promise: Promise<void>; resolve: () => void; reject: (e: unknown) => void };

  constructor(private readonly config: ReplayConfig) {
    this.completedDeferred = withDeferred<void>();
  }

  get completed(): Promise<void> {
    return this.completedDeferred.promise;
  }

  onRecord(handler: (r: RideRecord) => void): () => void {
    if (this.subscriber) throw new Error('Replay supports a single subscriber (D-REPL-11)');
    this.subscriber = handler;
    return () => { if (this.subscriber === handler) this.subscriber = undefined; };
  }

  start(): void {
    if (this.controller) throw new Error('Replay already started');
    this.controller = new AbortController();
    runScheduler({
      ...this.config,
      signal: this.controller.signal,
      emit: (r) => this.subscriber?.(r),
      getNow: () => performance.now(),
    }).then(
      () => this.completedDeferred.resolve(),
      (err) => this.completedDeferred.reject(err),
    );
  }

  stop(): void {
    this.controller?.abort();
  }
}

function withDeferred<T>() { /* standard deferred-promise helper */ }
```

**The `'complete'` event ergonomics question (Promise vs EventEmitter — Phase 4 wiring).** D-REPL-08 locks this: Phase 3 exposes `Promise<void>`; Phase 4 wires the EventEmitter on top. The Phase 4 sketch is:

```typescript
// PHASE 4 PREVIEW — not in this phase's scope, but planner needs this for confidence:
import { EventEmitter } from 'node:events';
function createFakeTransport(config) {
  const replay = new Replay(config);
  const emitter = new EventEmitter();
  replay.completed.then(
    () => emitter.emit('complete'),
    () => { /* aborted — do NOT emit 'complete'; emit 'disconnect' or similar */ },
  );
  return Object.assign(emitter, { /* connect, disconnect, sendResistance, ... */ });
}
```

The Promise-first design lets Phase 3 unit tests `await replay.completed` without involving an EventEmitter; Phase 4 inherits the Promise and adds the event surface for VeloWorld's existing consumer code.

### Anti-Patterns to Avoid

- **`setInterval(callback, recordCadence)` for replay timing.** Cumulative drift; explicitly forbidden by D-REPL-01.
- **`setTimeout` with relative-delta computation** (`delay = recordN.ts - recordN-1.ts`). Same drift accumulation as `setInterval`. Use absolute-target-time correction (D-REPL-02).
- **`Date.now()` for the time baseline.** Wall-clock; can jump backward. Use `performance.now()` (D-REPL-03).
- **Global `setTimeout` + manual `signal.addEventListener('abort', ...)` without `{ once: true }` and without explicit removal on natural completion.** Listener leak; see §AbortController teardown pitfalls.
- **`vi.advanceTimersByTime()` (sync) when the code under test has `await` in the loop.** Sync variant doesn't drain microtasks; emissions don't fire. Use `Async`.
- **Re-creating the `AbortController` inside `start()` AND mutating it from outside.** Replay's controller is internal — `replay.stop()` calls `controller.abort()`; external code passes `signal?` in config (D-REPL-09) and Replay can compose it via `AbortSignal.any([externalSignal, internalController.signal])` (Node 20+) if the user wires both. **Plan should pick ONE source-of-truth for cancellation per replay.**
- **Multi-subscriber fan-out in `Replay`.** D-REPL-11 says single subscriber; Phase 4 fans out.
- **Re-exporting `Replay` from `src/index.ts` in this phase.** D-REPL-12 forbids it.
- **Adding "for v2 flexibility" abstractions.** Per CLAUDE.md and CONTEXT.md "Claude's Discretion": the replay engine is INTERNAL in Phase 3. Don't add an `IScheduler` interface, don't add a strategy pattern for "different timing modes," don't pre-expose `cursor` / `elapsedMs` accessors. Add only what tests in this phase need.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Promise-aware delay | Wrap global `setTimeout` in a manual Promise constructor | `setTimeout` from `node:timers/promises` | Built-in. Accepts AbortSignal. Auto-cleans abort listener on natural completion. `[CITED: nodejs.org/api/timers.html]` |
| Monotonic clock | `Date.now()` with hand-rolled drift correction; `process.hrtime` to BigInt millisecond conversion | `performance.now()` | W3C-standard; sub-ms precision; monotonic per-process. Cross-runtime compatible. `[CITED: nodejs.org/api/perf_hooks.html]` |
| Cancellation propagation | Custom `boolean cancelled` flag with hand-rolled wakeup | `AbortController` / `AbortSignal` | Standard since Node 16; integrates with `node:timers/promises`, `fetch`, `EventEmitter.on(emitter, event, { signal })`. `[CITED: nodejs.org/api/globals.html#class-abortcontroller]` |
| Deferred Promise | Hand-rolled `let resolve, reject; new Promise(...)` boilerplate at every callsite | A small `withDeferred()` helper inside `src/replay/replay.ts` (~5 lines, OR use `Promise.withResolvers()` if Node 24 supports it) | `Promise.withResolvers()` is in the language as of TC39 stage 4 (Node 22+). Use it. `[CITED: tc39.es/proposal-promise-with-resolvers]` |

| Problem | DO Hand-Roll | Why |
|---------|--------------|-----|
| The drift-correction loop itself | ~10 lines of business logic. No library encapsulates "drift-corrected real-time replay against an arbitrary timestamp stream"; pulling in a generic scheduler library would add weight without saving lines. The scheduler.ts shown above is THE library. |
| The `Replay` wrapper class | Phase-4-specific surface; no third-party class fits. ~50 lines total. |

## Prior Art (1-2 named libraries / patterns the planner can copy from)

**Two reference implementations of the same drift-correction pattern:**

1. **Node.js `node:test` reporter timing / `setInterval` advice in the Node docs.** The Node official docs themselves discourage `setInterval` for any timing-sensitive use exactly because of the cumulative-drift problem; they recommend the `setTimeout` chain with absolute-target-time correction. Quote from Node Timers docs (paraphrased): "The callback will be called as close as possible to the time specified" — followed by community wisdom that the only way to bound end-time error is to recompute the next delay against an absolute target on every tick. `[CITED: nodejs.org/api/timers.html#settimeoutcallback-delay-args]`

2. **Tone.js `Transport` / Web Audio `AudioContext.currentTime` lookahead pattern.** Web Audio scheduling for music apps faces the IDENTICAL problem: schedule events at FIT-relative timestamps, recover from main-thread jitter. The canonical pattern is Chris Wilson's "A Tale of Two Clocks" (`https://web.dev/articles/audio-scheduling`), which uses an absolute-target-time scheduler with a lookahead window — exactly D-REPL-02. The trainer-sim case is simpler (no lookahead window needed because we're not feeding a hardware audio buffer), but the algorithm is the same. The Tone.js source at `https://github.com/Tonejs/Tone.js/blob/dev/Tone/core/clock/Clock.ts` is a heavy-weight version of the same loop with quantization features we don't need; **the planner should NOT copy it line-for-line — copy the pattern, not the code**, because Tone.js' extra features (musical-time grids, swing, sub-tick scheduling) violate the CLAUDE.md "no abstractions for hypothetical future requirements" rule.

**Pattern to copy:** The "absolute-target-time + per-tick recompute" loop from both references. The trainer-sim implementation is ~10 lines (see §Drift correction code sketch) and intentionally smaller than either reference because the simpler problem doesn't need quantization, swing, or lookahead windows.

**What NOT to copy from prior art:**
- Tone.js' `Clock` class — too feature-rich for our needs.
- Generic job-scheduler libraries (`node-cron`, `bull`, `agenda`) — wrong abstraction; they schedule against wall-clock cron expressions, not record-timestamp deltas.
- AnimeJS / GSAP timeline schedulers — browser-only; their `requestAnimationFrame` cadence isn't what we want.

## Common Pitfalls

### Pitfall 1: `setInterval` cumulative drift

**What goes wrong:** A planner reads "schedule emissions every 1 second" and writes `setInterval(emit, 1000)`. Each fire is `last_fire + 1000`, so under any host-scheduler jitter the wall-clock fire times accumulate error linear in tick count.
**Why it happens:** Familiarity bias — `setInterval` reads as "do this every N ms," which sounds like the desired behavior. It's not.
**How to avoid:** Use the setTimeout-chain with absolute-target-time correction (D-REPL-01, D-REPL-02). Code in §Drift correction code sketch.
**Warning sign:** A 30-min replay ends ~3 sec late under contention; the 250 ms gate fails intermittently.

### Pitfall 2: Relative-delta `setTimeout` chain (the "hand-rolled setInterval")

**What goes wrong:** A planner uses `setTimeout` (correctly avoiding `setInterval`) but computes the next delay as `nextRecord.ts - currentRecord.ts` instead of `nextRecord.ts - first.ts - elapsedSinceBaseline`. This is `setInterval` with extra steps — drift accumulates the same way.
**Why it happens:** Looks more "natural" than computing against a baseline.
**How to avoid:** Always recompute against the absolute baseline + getNow(). The scheduler signature in §Drift correction code sketch enforces this by structure.
**Warning sign:** Same as Pitfall 1, plus: replays at `speed=2` end at noticeably more than half the FIT duration.

### Pitfall 3: AbortSignal listener leak (the "I forgot `{ once: true }`" bug)

**What goes wrong:** Phase 4 re-uses an `AbortController` across many replays (one controller, multiple `replay.start()` calls). Every replay attaches an `'abort'` listener to the controller's signal; on natural completion (no abort), the listener stays attached. Heap grows linearly in replay count; eventually OOMs in long-running tests.
**Why it happens:** `signal.addEventListener('abort', handler)` without `{ once: true }` AND without explicit `removeEventListener` in the natural-completion branch. Easy to forget.
**How to avoid:** Use `node:timers/promises` `setTimeout(delay, value, { signal })` — Node handles cleanup internally per docs. If hand-rolling around the global setTimeout (don't), use BOTH `{ once: true }` AND remove the listener on success.
**Warning sign:** A test loop that creates 1000 replays in series leaks 1000 listeners; `process.memoryUsage().heapUsed` grows linearly.

### Pitfall 4: Pre-aborted signal not handled at start

**What goes wrong:** External code does `controller.abort(); replay.start();`. Replay calls the scheduler, which calls `sleep(delay, undefined, { signal })` — the Promise rejects synchronously with `AbortError`. If the wrapper class' `.then(...)` chain doesn't route the error to `completedDeferred.reject()`, the rejection becomes an unhandled Promise rejection.
**Why it happens:** Easy to overlook the synchronous-rejection case.
**How to avoid:** The wrapper's `.then(success, failure)` MUST attach the failure handler. Either fail-fast in `start()` with `if (this.config.signal?.aborted) throw new Error(...)` BEFORE creating the Promise, or always attach the failure handler.
**Warning sign:** Test logs include `(node:PID) UnhandledPromiseRejection: AbortError`.

### Pitfall 5: `vi.advanceTimersByTime()` (sync) instead of `Async` variant

**What goes wrong:** Test uses `vi.advanceTimersByTime(1000)` and the scheduler's `await sleep(...)` resolves but the next iteration's `emit()` doesn't run because microtasks aren't drained. Test asserts `emitted.length === 2`, gets `1`, fails mysteriously.
**Why it happens:** `vi.advanceTimersByTime()` only fires scheduled timers, doesn't drain promise microtasks. Our scheduler's loop has `await sleep(...) → emit(...)`; the `emit` is in a microtask the sync method skips.
**How to avoid:** Always `vi.advanceTimersByTimeAsync()` for code that has `await` in the loop. Default to the async variant in this phase's tests.
**Warning sign:** Tests pass when run individually, fail when run in batch; flakiness scales with test parallelism.

### Pitfall 6: `performance.now()` not faked because of import-binding

**What goes wrong:** Scheduler imports `import { performance } from 'node:perf_hooks'` at module top; binding is captured before `vi.useFakeTimers()` runs. `performance.now()` calls return real wall-clock time; fake-timer advancement doesn't move it. Drift-correction math sees `target` ahead of `now`; tests hang or produce wrong delays.
**Why it happens:** ES module bindings are early-resolved; vi only replaces `globalThis.performance`, not module-imported bindings.
**How to avoid:** Either (a) inject `getNow` (the scheduler does this — D-REPL-13's testability seam), or (b) use the global `performance.now()` (which IS faked). **Recommendation: do BOTH** — make `getNow` a config field with default `() => performance.now()`. Production wiring uses the global; tests can override.
**Warning sign:** A fake-timer test runs forever (real-clock waits); CI times out.

### Pitfall 7: Loop boundary leaks drift across iterations

**What goes wrong:** In `loop: true`, the planner re-uses `baseline` from the first iteration. The second iteration's first-record target is computed as `originalBaseline + (firstRecord.ts - firstRecord.ts) / speed = originalBaseline` — but `originalBaseline` is now in the past. Delay becomes 0; first record of iteration 2 fires immediately (correct by coincidence); BUT subsequent records in iteration 2 fire at their original-iteration absolute targets, all in the past — entire iteration 2 emits in a burst, no real-time wait.
**Why it happens:** Forgetting D-REPL-06. "Loop just resets the cursor" is wrong — it must also re-base.
**How to avoid:** Code in §Drift correction code sketch — `baseline = getNow()` on the loop boundary, not just `cursor = 0`.
**Warning sign:** A `loop: true` replay's iteration 2 emits all records in the same event-loop turn.

### Pitfall 8: `speed === Infinity` divides to NaN if not handled

**What goes wrong:** `(record.ts - first.ts) / Infinity === 0` (correct in JS), but `(0 - 0) / Infinity === NaN` if `record.ts === first.ts === 0`. The clamp `Math.max(target - now, minIntervalMs)` propagates NaN — `Math.max(NaN, x) === NaN` — and `setTimeout(NaN, ...)` defaults to 1ms. Works by accident.
**Why it happens:** Edge case — first record's offset against itself is `0/Infinity = NaN`.
**How to avoid:** Either skip the divide for the first record (`if (cursor === 0) target = baseline`), or guard with `Number.isFinite`. The scheduler in §Drift correction code sketch is correct because `(0 - 0) / Infinity === NaN` only at cursor=0 where `baseline + NaN === NaN`, AND `Math.max(NaN, minIntervalMs)` returns the FIRST argument's NaN — but `setTimeout` clamps NaN to 1. Hidden bug fixed by accident.
**How to avoid (proper):** Plan should add a unit test that asserts `speed=Infinity` over a single-record array completes within `1000/maxEmissionHz + 5 ms`.
**Warning sign:** None — the bug masks itself. Add the test proactively.

### Pitfall 9: `runScheduler` with empty records array

**What goes wrong:** `records.length === 0` and the loop accesses `records[0]!.timestamp` — crashes with undefined.
**Why it happens:** Phase 2's loader can return `RideRecord[]` of length zero only if it threw `NoRecordMessagesError`, but defensive code in Phase 3 should still handle it. The scheduler input is `ReadonlyArray<RideRecord>` with the JSDoc comment "length >= 1" — but TS doesn't enforce that.
**How to avoid:** First-line check in `runScheduler`: `if (records.length === 0) return;` — resolves the Promise immediately. The wrapper class can also assert in `start()`.
**Warning sign:** Phase 2 already throws on empty FIT; this is defense-in-depth, not the primary guard.

### Pitfall 10: Subscriber-not-set drops emissions silently

**What goes wrong:** Test creates `new Replay(...)`, calls `replay.start()` without first calling `replay.onRecord(...)`. Scheduler emits; `this.subscriber?.(...)` is a no-op; replay completes with no observable side effect. Test passes for the wrong reason.
**Why it happens:** Single-subscriber pattern with optional-chaining.
**How to avoid:** Either (a) require `onRecord` to be called before `start`, throw otherwise, or (b) buffer emissions until a subscriber is attached. **(a) is simpler and matches the Phase 4 expected wiring** (FakeTransport will always wire its subscriber before starting). Tests should assert the throw.
**Warning sign:** A test that "should fail" passes because the assertion is on `emitted.length` and there's no subscriber — emitted stays empty, assertion misreads.

## Code Examples

### Example 1: Replay class skeleton (full)

See §Pattern: Replay class wrapping the scheduler above.

### Example 2: Test pattern — REPL-06 cancellation invariant

```typescript
// test/replay/abort.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Replay } from '../../src/replay/replay.js';

describe('REPL-06: no callbacks fire after stop()', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('zero emissions in 100 ms after stop()', async () => {
    const records = [
      { timestamp: 1000 }, { timestamp: 1100 }, { timestamp: 1200 },
      { timestamp: 1300 }, { timestamp: 1400 },
    ];
    const emitted: number[] = [];
    const replay = new Replay({ records, speed: 1, loop: false, maxEmissionHz: 1000 });
    replay.onRecord((r) => emitted.push(r.timestamp));
    replay.start();

    await vi.advanceTimersByTimeAsync(150);   // emit 1000, 1100
    expect(emitted).toEqual([1000, 1100]);

    replay.stop();
    const before = emitted.length;
    await vi.advanceTimersByTimeAsync(100);   // wait, assert no further emits
    expect(emitted.length).toBe(before);

    // completed should reject with AbortError
    await expect(replay.completed).rejects.toMatchObject({ name: 'AbortError' });
  });
});
```

### Example 3: Test pattern — REPL-04 loop boundary drift

```typescript
// test/replay/loop.test.ts
describe('REPL-04: loop boundary does not accumulate drift', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('three loop iterations each take exactly the FIT duration', async () => {
    // 3 records over 1 second
    const records = [{ timestamp: 0 }, { timestamp: 500 }, { timestamp: 1000 }];
    const emissionTimes: number[] = [];
    const replay = new Replay({ records, speed: 1, loop: true, maxEmissionHz: 1000 });
    replay.onRecord(() => emissionTimes.push(performance.now()));
    replay.start();

    // advance through 3 iterations + abort
    await vi.advanceTimersByTimeAsync(3500);
    replay.stop();
    await replay.completed.catch(() => {});

    // First emission of each iteration is at offset 0, 1000, 2000
    // (allow ±5 ms slop for emit microtask ordering)
    const firsts = emissionTimes.filter((_, i) => i % 3 === 0);
    expect(firsts.length).toBe(3);
    expect(Math.abs(firsts[1]! - firsts[0]! - 1000)).toBeLessThan(5);
    expect(Math.abs(firsts[2]! - firsts[1]! - 1000)).toBeLessThan(5);
  });
});
```

### Example 4: Test pattern — REPL-02 speed=Infinity respects max-emission-Hz

```typescript
// test/replay/scheduler.test.ts (excerpt)
describe('REPL-02: speed=Infinity caps at maxEmissionHz', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('1000 records at speed=Infinity, maxEmissionHz=100 → ~10 sec total', async () => {
    const records = Array.from({ length: 1000 }, (_, i) => ({ timestamp: i * 100 }));
    let count = 0;
    const replay = new Replay({ records, speed: Infinity, loop: false, maxEmissionHz: 100 });
    replay.onRecord(() => count++);
    replay.start();

    // 100 Hz → 10 ms between emissions → 1000 records → 10 sec
    await vi.advanceTimersByTimeAsync(10_000);
    await replay.completed;
    expect(count).toBe(1000);
  });
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Global `setTimeout` + manual `signal.addEventListener('abort', ...)` | `node:timers/promises` `setTimeout(delay, value, { signal })` | Stable since Node 16; promotion to recommended-pattern in Node 18+ docs | Cleaner code; no listener leak risk; auto-cleanup |
| `Date.now()` + drift compensation | `performance.now()` | W3C standard (browsers); Node has had it since 8.5 (Node 8 LTS). Always preferred for monotonic intervals. | Sub-ms precision; immune to NTP corrections |
| Hand-rolled deferred-Promise pattern (`let resolve, reject; new Promise(...)`) | `Promise.withResolvers()` | TC39 stage 4 (2024); Node 22+ | Cleaner code |
| `vi.advanceTimersByTime()` for async-laden code | `vi.advanceTimersByTimeAsync()` | Vitest 0.x → 1.x. The async variant existed earlier but the canonical recipe shifted. Vitest 4 docs treat the async form as default. | Tests stop being flaky with promise-microtask ordering |

**Deprecated/outdated:**
- `setInterval` for any timing-sensitive replay — superseded by `setTimeout`-chain everywhere in modern Node code.
- The "global setTimeout + abort listener" pattern — superseded by `node:timers/promises` for any new code.
- Polling-style cancellation (`if (cancelled) return`) — superseded by `AbortController`.

## Validation Architecture

Skipped per `.planning/config.json` `workflow.nyquist_validation: false`. Phase Requirements → Test Map below covers the planner's needs.

### Phase Requirements → Test Map (informational)

| Req ID | Behavior | Test Type | File | Quick run |
|--------|----------|-----------|------|-----------|
| REPL-01 | Records emit at FIT-relative cadence | unit (fake timers) | `test/replay/scheduler.test.ts` | `npx vitest run test/replay/scheduler.test.ts` |
| REPL-02 | `speed` multiplier + maxEmissionHz cap | unit (fake timers) | `test/replay/scheduler.test.ts` | `npx vitest run -t "REPL-02"` |
| REPL-03 | Drift gate (250 ms over 30 min) | proxy: unit, fake-timer-free; real soak: gated on `RUN_SOAK=1` | `test/replay/soak-proxy.test.ts`, `test/replay/soak.test.ts` | `npx vitest run soak-proxy` (default); `RUN_SOAK=1 npx vitest run soak` (release gate) |
| REPL-04 | Loop boundary, no drift accumulation | unit (fake timers) | `test/replay/loop.test.ts` | `npx vitest run -t "REPL-04"` |
| REPL-05 | `replay.completed` Promise resolves on stop-at-end | unit (fake timers) | `test/replay/replay.test.ts` | `npx vitest run -t "REPL-05"` |
| REPL-06 | No emissions after stop() | unit (fake timers) | `test/replay/abort.test.ts` | `npx vitest run -t "REPL-06"` |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Vitest 4 fake timers fake `performance.now()` by default (via `@sinonjs/fake-timers` default-toFake-when-available) | Vitest fake-timer interaction recipe | LOW — `[VERIFIED: @sinonjs/fake-timers README — performance is conditionally-included in default toFake set]`. If wrong, every test would have to pass `vi.useFakeTimers({ toFake: ['performance', 'setTimeout', 'clearTimeout'] })` explicitly. Plan should add a defensive test that asserts `vi.advanceTimersByTimeAsync(N)` advances `performance.now()` by N — fails immediately if the assumption breaks. |
| A2 | `node:timers/promises` `setTimeout(delay, value, { signal })` cleans up the abort listener on natural completion (no leak) | AbortController teardown pitfalls | LOW — Node docs document the API and do not require manual cleanup; behavior is the standard expected from "the runtime owns the resource lifecycle." Empirical verification: would manifest as a heap leak in a 1000-iteration test; plan should include such a regression test. |
| A3 | Node 24 `setTimeout(_, 1)` actually fires within 1-2 ms on macOS / Linux CI hosts (no Windows-style 4 ms or 16 ms floor) | Soak test recommendation | MEDIUM — verified on dev macOS host this session (median 1.17 ms). Linux CI hosts (GitHub Actions) typically have similar precision. Windows CI under load can hit 15.6 ms granularity due to Windows Timer Resolution; **PROJECT.md restricts v1 to macOS/Linux** so this is moot. Plan should still note: if the soak test ever runs on Windows, use a coarser tolerance. |
| A4 | The drift-correction algorithm produces sub-ms cumulative drift on idle hosts | Drift correction code sketch | LOW — verified empirically (0.00 ms drift over 100 ticks / 10 sec on dev hardware). The 250 ms gate has roughly 3 orders of magnitude of headroom. |
| A5 | `Promise.withResolvers()` is available in Node 24 | Don't Hand-Roll table | LOW — TC39 stage 4 (2024); Node 22 ships it. Plan can fall back to a `withDeferred()` helper if a project lint banner objects, but no functional risk. |
| A6 | The "30-second proxy at speed=60×" exercises the same algorithm code paths as the "30-minute real soak at speed=1×" | Soak test recommendation | LOW — both run the same scheduler.ts code over the same `RideRecord[]`; only the `speed` config differs. The proxy provably can NOT catch environmental drift (long GC pauses, OS hiccups), which is exactly why the §Soak test recommendation argues for BOTH. |
| A7 | `AbortSignal.any([userSignal, internalController.signal])` is available in Node 24 | Anti-Patterns to Avoid (composition note) | LOW — added in Node 20 (LTS Iron) and stable in Node 24. Verifiable via `'any' in AbortSignal`. |
| A8 | A single-subscriber pattern is sufficient for Phase 3 unit tests | Subscriber-not-set pitfall | LOW — D-REPL-11 LOCKED. Phase 4 fans out. |

## Open Questions (RESOLVED)

1. **Restart after stop-at-end (D-REPL-07 Claude's Discretion).** RESOLVED: **Throw — single-use Replay.**
   - What we knew: D-REPL-07 said "subsequent `start()` calls throw or restart from cursor 0 (decision deferred)."
   - Resolution: Phase 4's `reset()` constructs a fresh `Replay` instance internally — that's the reusable surface, not Replay itself. Keeps Replay's state machine maximally simple (running → done; running → aborted) without a "done → running" transition. Locked into 03-02 Task 1 acceptance.

2. **Abort error semantics — reject vs. resolve-with-sentinel.** RESOLVED: **Reject with `signal.reason ?? AbortError`.**
   - What we knew: D-REPL-09 said "reject `replay.completed` with the abort reason (or resolve with sentinel — TBD)."
   - Resolution: Matches `fetch` AbortController convention and `node:timers/promises` setTimeout rejection. Matches CONTEXT.md user lean. Phase 4 wraps this and decides how to translate the rejection into its `disconnect()` Promise. Locked into 03-02 Task 1 + 03-03 abort.test.ts.

3. **External vs. internal AbortSignal composition.** RESOLVED: **`AbortSignal.any([externalSignal, internalController.signal])`.**
   - What we knew: D-REPL-09 said replay accepts `{ signal?: AbortSignal }` AND replay holds an internal controller for `replay.stop()`.
   - Resolution: Node 20+, stable in 24. Either path aborts the scheduler. Hand-rolling a wrapper re-introduces listener-leak risk per Pitfall 3. Locked into 03-02 Task 1 step 3e.

## Project Constraints (from CLAUDE.md)

These directives are non-negotiable; the planner MUST verify task plans don't violate them.

| Directive | Source | Application |
|-----------|--------|-------------|
| Tech stack: Node.js + TypeScript | "Constraints" | All Phase 3 code is TS under `src/replay/`. |
| License: MIT | "Constraints" | No new dependencies; built-ins only. ✓ |
| Platform: macOS / Linux only for v1 | "Constraints" | Phase 3 code is platform-agnostic Node; the `setTimeout` precision floor is best on these platforms (see A3). |
| TypeScript 5.9, strict | TL;DR | Inherited; `noUncheckedIndexedAccess` requires `!` on `records[cursor]!.timestamp` access in the scheduler — see code sketch. |
| `engines: ">=24.0"` | TL;DR | Inherited. `node:timers/promises` setTimeout signal option is stable since Node 16, well within Node 24. |
| Use `vitest`, NOT jest | TL;DR | All Phase 3 tests are vitest. |
| GSD Workflow Enforcement | "GSD Workflow Enforcement" | Plans go through `/gsd-execute-phase`. |
| **No abstractions for hypothetical future requirements** | "Replay Engine ... INTERNAL in Phase 3 (per CONTEXT.md D-REPL-12). Do NOT recommend 'for v2 flexibility' abstractions. Recommend the simplest correct implementation." | This research recommends ONE class (Replay), ONE pure function (runScheduler), ONE config interface (ReplayConfig), and ONE state interface (ReplayState). No `IScheduler`, no strategy patterns, no event-bus abstractions. The `getNow` injection is the ONE testability seam, justified by D-REPL-13 + Pitfall 6. |
| Replay engine is INTERNAL in Phase 3 | CONTEXT.md D-REPL-12 | `src/index.ts` is unchanged in this phase. ✓ |
| Use `tsup`, NOT webpack/rollup | TL;DR | tsup picks up new files in `src/replay/` automatically; no config changes. |
| `publint` + `attw` non-negotiable | TL;DR | No new public exports → no validation deltas. |

## Sources

### Primary (HIGH confidence)
- `[CITED: nodejs.org/api/timers.html#timerspromisessettimeoutdelay-value-options]` — `node:timers/promises` setTimeout signature; AbortSignal handling; `ref` option
- `[CITED: nodejs.org/api/timers.html#settimeoutcallback-delay-args]` — minimum delay floor (1 ms; values <1 are clamped to 1)
- `[CITED: nodejs.org/api/perf_hooks.html — performance.now]` — high-resolution monotonic timestamp; relative to process start
- `[CITED: nodejs.org/api/globals.html#class-abortcontroller]` — AbortController / AbortSignal class; `{ once: true }` recommendation for listener cleanup
- `[VERIFIED: live execution this session]` — Node 24.15.0 setTimeout(_, 1) median 1.17 ms (n=200); drift-corrected scheduler 0.00 ms drift over 100 ticks / 10 sec
- `[VERIFIED: @sinonjs/fake-timers README — Default toFake]` — `performance` is conditionally-included in default toFake set when natively available (which it is in Node 24)
- `[VERIFIED: ./package.json]` — Vitest 4.1.6 already pinned
- `[VERIFIED: ./tsconfig.json]` — strict + noUncheckedIndexedAccess enforces `!` on array access
- `[VERIFIED: ./src/types.ts]` — RideRecord shape matches scheduler input expectation
- `[VERIFIED: ./src/fit/loader.ts]` — loader returns RideRecord[] sorted ascending, Phase 3 invariant
- `[VERIFIED: ./test/fit/perf.test.ts]` — proven structural template for Phase 3's soak-proxy test
- `[CITED: vitest.dev/api/vi.html#vi-usefaketimers]` — vi.useFakeTimers / advanceTimersByTimeAsync API

### Secondary (MEDIUM confidence)
- `[CITED: web.dev/articles/audio-scheduling]` — Chris Wilson's "A Tale of Two Clocks" pattern (the canonical reference for absolute-target-time + per-tick recompute scheduling)
- `[CITED: tc39.es/proposal-promise-with-resolvers]` — Promise.withResolvers stage-4 status

### Tertiary (LOW confidence)
- None. All claims either VERIFIED in this session or CITED to a primary source.

## Metadata

**Confidence breakdown:**
- Drift-correction algorithm correctness: HIGH — verified empirically (0.00 ms drift over 100 ticks)
- AbortController + setTimeout teardown idiom: HIGH — Node docs cite the pattern; promisified form documented
- Vitest 4 fake-timer interaction with `performance.now()`: HIGH — verified via `@sinonjs/fake-timers` source/docs
- Soak-test math justification: HIGH — algorithm bounds end-time error to one final-tick error (independent of tick count) under absolute-target-time correction
- Node 24 setTimeout precision floor: MEDIUM — verified on dev macOS host (1.17 ms median); CI hosts assumed similar
- Prior-art selection: HIGH — two named references (Node docs + Chris Wilson "Two Clocks") with explicit "copy the pattern, not the code" guidance

**Research date:** 2026-05-16
**Valid until:** 2026-06-15 (30 days). Re-verify if Phase 3 hasn't started by then; Vitest 4.x is stable, Node 24 LTS is stable, the algorithm pattern doesn't change.

## RESEARCH COMPLETE
