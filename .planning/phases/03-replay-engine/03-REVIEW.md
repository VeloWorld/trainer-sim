---
phase: 03-replay-engine
reviewed: 2026-05-16T00:00:00Z
depth: standard
files_reviewed: 9
files_reviewed_list:
  - src/replay/replay.ts
  - src/replay/scheduler.ts
  - src/replay/types.ts
  - test/replay/abort.test.ts
  - test/replay/loop.test.ts
  - test/replay/replay.test.ts
  - test/replay/scheduler.test.ts
  - test/replay/soak-proxy.test.ts
  - test/replay/soak.test.ts
findings:
  critical: 2
  warning: 6
  info: 4
  total: 12
status: issues_found
---

# Phase 3: Code Review Report

**Reviewed:** 2026-05-16
**Depth:** standard
**Files Reviewed:** 9
**Status:** issues_found

## Summary

The replay engine implementation is well-documented, follows the locked decisions from `03-CONTEXT.md`, and the test coverage hits each D-REPL-* invariant deliberately. The drift-corrected setTimeout-chain algorithm is sound, the AbortSignal-based cancellation correctly delegates listener cleanup to `node:timers/promises`, and the file split (`scheduler.ts` / `replay.ts` / `types.ts`) matches D-REPL-13.

However, there are two BLOCKER bugs that violate documented contracts:

1. **D-REPL-10 is not actually upheld in a thin race window** — the scheduler emits the next record AFTER `await sleep(...)` returns even if the signal aborted between the sleep resolving and the synchronous `emit(record)` call. The "no further emissions after stop()" contract is violated by exactly one ghost emission in that race window. This is exactly the failure mode `D-REPL-10` exists to prevent, and the existing tests do not detect it because abort is initiated before the sleep resolves rather than between sleep-return and emit.

2. **`replay.completed` produces an unhandled-rejection warning under realistic Phase 4 usage.** The test files paper over this with eager `replay.completed.catch(() => undefined)` calls, but a Phase 4 caller that does `replay.start(); await replay.completed;` (the documented usage shape per the `completed` getter JSDoc) will fire `process.on('unhandledRejection')` if `stop()` is called before the consumer attaches its catch handler. This is an interface footgun that will trip Node 24's strict unhandled-rejection mode and any consumer that uses `--unhandled-rejections=strict`.

The remaining findings are quality issues that should be addressed but do not block.

## Critical Issues

### CR-01: D-REPL-10 violated — one ghost emission can fire after `stop()` due to race between sleep resolution and synchronous emit

**File:** `src/replay/scheduler.ts:227-231`

**Issue:**
The emit loop is:
```typescript
await sleep(delay, undefined, { signal });   // 4c
emit(record);                                  // 4d (synchronous)
cursor++;
```
If `stop()` (or external `controller.abort()`) is called in the microtask boundary between `sleep` resolving naturally and the synchronous `emit(record)` executing, the scheduler does not check `signal.aborted` and the emit fires. This violates D-REPL-10 ("after abort/stop, NO further emissions fire") and contradicts the file-header comment on lines 50–51 ("§3 AbortSignal listener leak — handled by `node:timers/promises`") which implicitly relies on the abort happening DURING the sleep.

The window is small but real:
- `await sleep` returns (signal not yet aborted)
- microtask drains
- some other microtask calls `replay.stop()` → `controller.abort()` → composed signal fires → no longer in a sleep, so no rejection is delivered
- the scheduler's next synchronous step is `emit(record)` — fires the ghost emission
- next iteration's `await sleep(...)` rejects because the signal is now aborted

The `abort.test.ts` Group 4 test ("no leftover timers / ghost emissions after abort") cannot catch this because under `vi.useFakeTimers()`, `replay.stop()` is called between `vi.advanceTimersByTimeAsync` calls (i.e., between sleeps, never between a sleep returning and the next emit) — the very window this bug occupies.

This affects Phase 4: if the FakeTransport calls `replay.stop()` from inside an `onData` handler (a realistic pattern for "stop on first record matching X"), the next record can still leak.

**Fix:**
Add an explicit abort check between the sleep and the emit:
```typescript
await sleep(delay, undefined, { signal });
// CRITICAL: signal may have aborted between sleep-return and the synchronous
// emit below. Without this guard, one ghost emission can fire after stop()
// (D-REPL-10 violation).
if (signal.aborted) {
  throw signal.reason ?? new DOMException('aborted', 'AbortError');
}
emit(record);
cursor++;
```
Also add a regression test that exercises the exact race window — call `replay.stop()` from inside an `emit` handler that is observing the *previous* tick (i.e., not the same tick), and assert the *next* tick does not emit. Under fake timers this is reproducible by scheduling the `stop()` call inside a `queueMicrotask` from within an emit.

---

### CR-02: `replay.completed` rejection generates `unhandledRejection` warnings under documented usage

**File:** `src/replay/replay.ts:117-126, 247-256`

**Issue:**
`completedDeferred = Promise.withResolvers<void>()` creates the rejection-bearing Promise eagerly in the constructor. When `runScheduler(...).then(_, err => { ... completedDeferred.reject(err); })` runs, the rejection lands on `completedDeferred.promise`. If no `.catch` / `.then(_, _)` handler is attached at the moment the rejection is delivered, Node 24 emits `unhandledRejection` (and under `--unhandled-rejections=strict` or Node 24's default for unhandled-rejection-as-warning, this is observable).

Every test file works around this by calling `replay.completed.catch(() => undefined)` immediately after `replay.start()`. Five separate test cases include this defensive pattern with comments like "Eager no-op failure handler avoids the unhandled-rejection trip". The fact that every test must defensively swallow the rejection is the symptom — production callers will hit the same trap.

The file's own JSDoc on the `completed` getter (lines 132–133) advertises:
> "Stable identity across the Replay's lifetime — callers may `await` it before or after `start()`."

A caller that follows this advice with `replay.start({ signal }); /* …other setup… */ await replay.completed;` and meanwhile `signal` aborts will see the unhandled-rejection warning before the await attaches the handler.

**Fix:**
Attach a no-op `.catch` to the deferred's Promise inside `start()` (or in the constructor once we know rejection is possible) immediately after wiring the failure handler. The original Promise identity is preserved because `.catch` returns a new Promise; the consumer's eventual `await` on `this.completedDeferred.promise` still rejects.
```typescript
).then(
  () => { this.state = 'done'; this.completedDeferred.resolve(); },
  (err) => { this.state = 'aborted'; this.completedDeferred.reject(err); },
);
// Defuse the unhandled-rejection trap. Consumers attaching .catch later
// still observe the rejection on their handler — Promise rejection is
// fan-out, not consumed.
this.completedDeferred.promise.catch(() => undefined);
```
Also remove the eager `replay.completed.catch(() => undefined)` calls in the test files and confirm they no longer warn — those defensive workarounds were masking the production bug.

## Warnings

### WR-01: `Math.max(target - getNow(), minIntervalMs)` then `target - getNow() < minIntervalMs` calls `getNow()` twice with different values — clamp counter is biased

**File:** `src/replay/scheduler.ts:216-219`

**Issue:**
```typescript
const delay = Math.max(target - getNow(), minIntervalMs);   // first getNow()
if (target - getNow() < minIntervalMs) {                     // second getNow()
  clampedTicks++;
}
```
Two separate `getNow()` invocations a few CPU cycles apart. The second is always >= the first, so `target - getNow()` (second) is always <= `target - getNow()` (first). This means the counter can over-report clamping (counts ticks that were not actually clamped by the `Math.max` above). It also means `delay` and the comparison are inconsistent — which is sloppy for an observability counter.

**Fix:**
Compute the live delta once and reuse:
```typescript
const liveDelta = target - getNow();
const delay = Math.max(liveDelta, minIntervalMs);
if (liveDelta < minIntervalMs) {
  clampedTicks++;
}
totalTicks++;
```
This is a strictly correct version of the same logic; no algorithmic change.

---

### WR-02: `currentState` reflects stale `'running'` for a microtask after `stop()` returns — undocumented contract

**File:** `src/replay/replay.ts:259-272`

**Issue:**
`stop()` calls `this.controller?.abort()` synchronously but does NOT update `this.state`. The transition to `'aborted'` only happens when `runScheduler`'s rejection lands in the `.then` failure branch on the next microtask. So:
```typescript
replay.stop();
console.log(replay.currentState); // logs 'running', not 'aborted'
```
The `stop()` JSDoc on line 262–265 acknowledges this in passing:
> "The actual transition to `aborted` happens in `start()`'s `.then` failure branch when the scheduler's `node:timers/promises` rejection lands."

…but the `currentState` getter JSDoc (lines 138–143) does not mention this asynchrony, and Phase 4 callers reading `currentState` immediately after `stop()` will get a stale value. The tests work around this by `await replay.completed.catch(...)` before checking `currentState`. Phase 4's `disconnect()` will likely have the same trap.

**Fix:**
Either:
(a) Set `this.state = 'aborted'` synchronously inside `stop()` (and guard the `.then` failure branch against double-transition), OR
(b) Document the async transition explicitly on `currentState` and/or expose an `aborting` intermediate state.

Option (a) is cleaner and matches the user-facing intuition that `stop()` is decisive.

---

### WR-03: Disposer returned by `onRecord` becomes a confusing no-op once `start()` has captured the subscriber

**File:** `src/replay/replay.ts:159-172, 230`

**Issue:**
```typescript
onRecord(handler): () => void {
  ...
  this.subscriber = handler;
  return () => {
    if (this.subscriber === handler) {
      this.subscriber = undefined;
    }
  };
}
...
start() {
  ...
  const sub = this.subscriber;            // capture
  runScheduler({ ..., emit: (r) => sub(r), ... });
}
```
After `start()`, the scheduler's emit closure holds `sub` directly. The disposer only nulls `this.subscriber`, NOT the captured `sub`. So calling dispose() during a running replay:
- silently succeeds
- emissions continue (the captured `sub` is still alive)
- subsequent `onRecord` calls fail because `state !== 'idle'`

This is a "looks like it does something but doesn't" footgun. Phase 4's wrapper will likely treat the disposer as authoritative for "stop receiving records" and be confused.

The implementation comment on line 227–229 acknowledges the capture rationale ("the disposer (which may be invoked from inside the emit callback) cannot null out the reference"), but does not surface the consequence to the disposer's contract.

**Fix:**
Either:
(a) Make the disposer also abort the running replay (semantic change — invasive), OR
(b) Document on the disposer's JSDoc that calling it after `start()` is a no-op for emissions and only frees the slot for re-attachment (which is itself useless because state-guard blocks re-attach), OR
(c) Have the disposer throw if called after `start()` to surface the misuse.

Option (c) is most consistent with the rest of the class's fail-fast posture (D-REPL-07 single-use lock, D-REPL-11 single-subscriber lock).

---

### WR-04: `private readonly config` JSDoc claims "Frozen at construction; not mutated" but no `Object.freeze` is applied; caller mutations leak into the scheduler

**File:** `src/replay/replay.ts:86-91`

**Issue:**
The JSDoc says:
> "Frozen at construction; not mutated. `ReplayConfig` is internal — see `./types.ts`. The scheduler reads `records` as `ReadonlyArray`, so no defensive copy is needed."

But `this.config = config;` is a reference assignment with no freeze. A caller that mutates `config.records` (or any field) after construction but before `start()` returns will see those mutations land in the scheduler. The "internal-only" property does not protect from accidental mutation by Phase 4's own code — and the comment promises something that isn't enforced.

The `ReadonlyArray` type on `records` is compile-time only and gives no protection from a caller that uses `as RideRecord[]` or mutates externally.

**Fix:**
Either:
(a) Apply `Object.freeze` (and `Object.freeze(config.records)` if appropriate) in the constructor — runtime enforcement matches the JSDoc claim, OR
(b) Update the JSDoc to drop the "Frozen at construction" claim — say "captured by reference; callers must not mutate after construction".

Option (b) is the lowest-cost path; option (a) is defense-in-depth.

---

### WR-05: `start()` does not validate `speed`, `maxEmissionHz`, or numeric finiteness — invalid configs reach the scheduler and produce silent or chaotic behavior

**File:** `src/replay/replay.ts:199-218`

**Issue:**
The scheduler's `Math.max(target - getNow(), minIntervalMs)` clamp does not protect against:
- `speed === 0` → `(record.timestamp - firstTs) / 0 === Infinity` → `target === Infinity` → `target - getNow() === Infinity` → `Math.max(Infinity, minIntervalMs) === Infinity` → `setTimeout(Infinity)` is implementation-defined and on Node coerces to 1ms (`> 2^31 - 1` ms). Effectively a busy-loop emitting at `minIntervalMs` cadence rather than a clear error.
- `speed < 0` → time runs backward → all `target` values are in the past → entire records array burst-emits in the first event-loop turn, contradicting REPL-02's "Replay speed multiplier" semantics.
- `speed === NaN` → all targets are NaN → the explicit `Pitfall 8` guard only handles `Infinity`; NaN bypasses it; `setTimeout(NaN)` clamps to 1ms; tight burst emit.
- `maxEmissionHz === 0` → `minIntervalMs = Infinity` → every delay is `Infinity` → the entire replay never emits anything.
- `maxEmissionHz < 0` → `minIntervalMs < 0` → `Math.max` ignores it; `target - getNow()` controls; basically silently treated as no cap.

`ReplayConfig`'s JSDoc on `speed` says "Values <= 0 are unsupported" and "the scheduler does not validate this — callers (plan 03-02 `Replay` class, Phase 4 `FakeTransport` factory) own input validation." But the `Replay` class IS the caller in Phase 3 and does not validate. So the documented owner of validation has not actually validated.

**Fix:**
Add a single validation block at the top of `start()`:
```typescript
if (!Number.isFinite(this.config.speed) && this.config.speed !== Infinity) {
  throw new Error('Replay.start: speed must be a positive finite number or Infinity');
}
if (this.config.speed <= 0) {
  throw new Error('Replay.start: speed must be > 0');
}
if (!Number.isFinite(this.config.maxEmissionHz) || this.config.maxEmissionHz <= 0) {
  throw new Error('Replay.start: maxEmissionHz must be a positive finite number');
}
```
This matches the fail-fast posture of the existing guards in `start()`.

---

### WR-06: `runScheduler` uses `while (true)` with `eslint-disable-next-line no-constant-condition` — a `for (;;)` would avoid the disable and read identically

**File:** `src/replay/scheduler.ts:197-198`

**Issue:**
```typescript
// eslint-disable-next-line no-constant-condition
while (true) {
```
ESLint's `no-constant-condition` exists to flag the exact pattern used here. The disable suppresses a legitimately useful warning. `for (;;)` reads identically to a Node engineer, has no constant-condition trip, and removes the disable.

This is minor but the surrounding code is otherwise meticulous about lint hygiene — this stands out.

**Fix:**
```typescript
for (;;) {
  ...
}
```

## Info

### IN-01: Test files duplicate `fakeAwareSleep` four times — should be a shared test helper

**File:** `test/replay/abort.test.ts:37-62`, `test/replay/loop.test.ts:28-53`, `test/replay/replay.test.ts:42-67`, `test/replay/scheduler.test.ts:57-82`

**Issue:**
Identical 25-line `fakeAwareSleep` helper is copy-pasted into four test files. Any future change (e.g., switching to `signal.reason` instead of synthesizing AbortError) requires four edits. The `'AbortError'` string and the abort-listener cleanup logic in particular drift if not maintained centrally.

**Fix:**
Extract to `test/replay/_helpers.ts` (or `test/_helpers/fake-sleep.ts`) and import. PATTERNS §Helper functions defined inside the test file applies to per-test fixtures, not to AbortSignal-aware sleep primitives that are identical across four files.

---

### IN-02: `_schedulerInputCoversConfig` is a clever compile-time check but unreadable to a future maintainer

**File:** `src/replay/scheduler.ts:148-153`

**Issue:**
```typescript
const _schedulerInputCoversConfig: (
  c: ReplayConfig,
) => Pick<SchedulerInput, 'records' | 'speed' | 'loop' | 'maxEmissionHz'> = (
  c,
) => c;
void _schedulerInputCoversConfig;
```
This relies on TypeScript's structural assignability to enforce that the four overlapping fields stay in sync. The intent is good but the construct is opaque — `void X` to silence unused-var, an underscore-prefixed name, and a function-type cast to do a static check.

A `satisfies`-based check or a single-line `type _Check = ReplayConfig extends Pick<SchedulerInput, ...> ? true : never; type _Assert = _Check extends true ? true : never;` would do the same with a clearer marker that this is a static assertion.

**Fix:**
```typescript
// Static assertion — every ReplayConfig field exists on SchedulerInput.
type _ReplayConfigCoveredBySchedulerInput =
  ReplayConfig extends Pick<SchedulerInput, 'records' | 'speed' | 'loop' | 'maxEmissionHz'>
    ? true
    : never;
```
Or use the `expect-type` library if it's already a dev dep. Lower priority than functional issues.

---

### IN-03: Test description "Group 1" / "Group 2" labels are scaffolding noise — replace with the decision they exercise

**File:** `test/replay/abort.test.ts:72, 116, 150, 203`, `test/replay/loop.test.ts:63, 110, 150`, `test/replay/replay.test.ts:77, 131, 182, 218, 235`, `test/replay/scheduler.test.ts:106, 144, 203, 229, 258`

**Issue:**
Every `describe(...)` block is named "Group N — D-REPL-XX: ...". The "Group N" prefix is plan-tracking metadata, not a behavioral group name. When a future test fails, the runner output is "Group 3 — RESEARCH §Open Question 3: external + internal abort race / composition > both controller.abort() AND replay.stop() in the same tick — only one rejection lands" which is fine, but "Group 3" adds noise without identifying a customer-visible behavior.

**Fix:**
Drop the "Group N — " prefix; keep the decision identifier and behavior summary. The plan can reference test names instead of the reverse. Lowest-priority finding — does not affect correctness.

---

### IN-04: `console.log` in soak/proxy tests should use `console.info` or be gated on a verbose flag for CI hygiene

**File:** `test/replay/soak-proxy.test.ts:79-84`, `test/replay/soak.test.ts:79-84`

**Issue:**
Both files include `// eslint-disable-next-line no-console` immediately above a `console.log` for diagnostic output. While the diagnostic is genuinely useful (drift triage), `console.log` is the wrong channel — it's stdout and conflates with vitest's own reporter output. `console.info` on stdout or `console.warn` on stderr separates intentional diagnostics from accidental debug print.

The eslint-disable-next-line is a marker that "we know this is unusual" — promote it to a more appropriate logging call to remove the special-case.

**Fix:**
Either use `console.info` (still flagged by `no-console` but semantically correct) or wrap in `if (process.env.VERBOSE) { ... }` and gate on env. Lowest-priority — current behavior is functional.

---

_Reviewed: 2026-05-16_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
