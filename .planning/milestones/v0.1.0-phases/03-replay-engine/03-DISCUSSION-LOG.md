# Phase 3: Replay Engine - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-16
**Phase:** 03-replay-engine
**Mode:** `--auto` (recommended-option selection across all gray areas)
**Areas discussed:** scheduler primitive, drift correction, speed/cap semantics, loop boundary, completion signal, cancellation, subscriber surface, module boundary, testing strategy

---

## Scheduler Primitive

| Option | Description | Selected |
|--------|-------------|----------|
| setTimeout chain (recursive re-arm per emission) | Standard Node drift-corrected pattern; one pending timeout at a time; clean cancellation. | ✓ |
| setInterval | Simple but cumulative drift; teardown more awkward; not used for sub-second precision in idiomatic Node. | |
| setImmediate tight loop | CPU pinning at idle; only useful for `speed=Infinity` extremes; loses real-time semantics. | |

**Auto-selected:** setTimeout chain (recommended default).
**Notes:** Each tick computes `target - performance.now()` and arms `setTimeout` with the delta. One `clearTimeout` is sufficient for full cancellation (REPL-06).

---

## Drift Correction Algorithm

| Option | Description | Selected |
|--------|-------------|----------|
| Per-tick recalibration vs `performance.now()` baseline | Each tick recomputes from absolute target — bounds error to one event-loop turn. | ✓ |
| Windowed running offset | Smooths jitter but adds state; harder to reason about across loop boundaries. | |
| `Date.now()`-based scheduling | Wall-clock; can jump backward on NTP correction → drift correction blows up. | |

**Auto-selected:** per-tick recalibration vs `performance.now()`.
**Notes:** Math is ~10 lines; no library needed.

---

## Speed = Infinity & Emission Cap

| Option | Description | Selected |
|--------|-------------|----------|
| Configurable max emission Hz (default 1000) with delay clamp | Single code path for all speeds; no branch on `Infinity`. | ✓ |
| Token-bucket cap | More complex; benefits only matter for bursty input — replay input is monotonic. | |
| Hard-coded 1 ms minimum delay | No way to dial down for soak tests of sparse-record load. | |

**Auto-selected:** configurable max Hz default 1000.
**Notes:** Delay clamp is `max(0, 1000/maxEmissionHz)`. Naturally degrades real-time → fast → capped.

---

## Loop Boundary Behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Re-base baseline on each loop iteration | Eliminates drift accumulation across boundaries (REPL-04 gate). | ✓ |
| Continuous offset across loops | Compounds any tick-level drift — fails REPL-04 over many loops. | |
| Hybrid: re-base every N loops | Premature complexity; no requirement asks for it. | |

**Auto-selected:** re-base each loop iteration.
**Notes:** Cursor → 0; baseline = `performance.now()`; first record of new iteration emits at its FIT timestamp relative to new baseline.

---

## Completion Signal

| Option | Description | Selected |
|--------|-------------|----------|
| `Promise<void>` (`replay.completed`) | Tests `await replay.completed`; Phase 4 wires `EventEmitter` shim on top for REPL-05. | ✓ |
| `EventEmitter` only (`.on('complete', …)`) | Forces Phase 3 to depend on `node:events` even though replay is internal; Phase 4 owns the public event API. | |
| Both natively | Surface bloat at the wrong layer. | |

**Auto-selected:** Promise-first.
**Notes:** Phase 4's FakeTransport will translate `replay.completed.then(() => emit('complete'))`.

---

## Cancellation Mechanism

| Option | Description | Selected |
|--------|-------------|----------|
| AbortController / AbortSignal | Idiomatic Node 24; composes with `fetch`-style cancellation; Phase 4 derives its disconnect-controller from this. | ✓ |
| Custom cancel flag + setter | Reinvents AbortController; harder to compose with Phase 4. | |
| `replay.stop()` only (no signal) | No way for upstream FakeTransport to cancel via existing AbortController patterns. | |

**Auto-selected:** AbortController.
**Notes:** Replay accepts `{ signal? }` in start config. Internal `replay.stop()` is a thin wrapper that aborts the local controller.

---

## Subscriber Surface

| Option | Description | Selected |
|--------|-------------|----------|
| Single subscriber (`onRecord(handler)`) | Minimal; Phase 4's FakeTransport handles multi-subscriber fan-out. | ✓ |
| Multi-subscriber list | Duplicates Phase 4 work and complicates Replay state machine. | |

**Auto-selected:** single subscriber.

---

## Module Boundary

| Option | Description | Selected |
|--------|-------------|----------|
| `src/replay/` internal, no public exports yet | Phase 3 ends green but `dist/index.js` exports unchanged; Phase 4 decides public surface. | ✓ |
| Re-export from `src/index.ts` immediately | Locks public API before FakeTransport's needs are known. | |

**Auto-selected:** internal only.
**Notes:** Files: `src/replay/scheduler.ts`, `src/replay/replay.ts`, `src/replay/types.ts`.

---

## Testing Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Vitest fake timers for unit tests + one real-clock soak gate | Deterministic + fast for the 95% case; one slow test for REPL-03 drift gate. | ✓ |
| All real-clock | CI-slow; fragile for jitter-sensitive assertions. | |
| All fake timers | Cannot verify the actual REPL-03 250 ms drift gate. | |

**Auto-selected:** fake timers for units + 1 real-clock soak.
**Notes:** Soak may use a 30-second proxy at `speed=60` over `perf-1hr.fit` to fit in CI; defer to planning to confirm.

---

## Claude's Discretion

- Restart-after-stop semantics (single-use Replay vs `start()`-able again).
- AbortController error semantics: reject `replay.completed` with `signal.reason` vs resolve with sentinel.
- Whether to expose `replay.cursor` / `replay.elapsedMs` accessors (only if tests need them; YAGNI default).

## Deferred Ideas

- `compactGaps: true` config to collapse long autopause gaps — Phase 4/5 if VeloWorld E2E finds real-time gaps too slow.
- Multi-subscriber fan-out — Phase 4 FakeTransport.
- Deterministic-order (timestamp-ignoring) replay — Phase 4+.
- Resistance → power scaling — explicitly out-of-scope per PROJECT.md.
- CLI (`trainer-sim play`) — v2.
