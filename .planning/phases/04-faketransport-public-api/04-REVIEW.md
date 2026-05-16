---
phase: 04-faketransport-public-api
reviewed: 2026-05-16T00:00:00Z
depth: standard
files_reviewed: 11
files_reviewed_list:
  - src/index.ts
  - src/types.ts
  - src/transport/fake-transport.ts
  - test/_helpers/fake-aware-sleep.ts
  - test/replay/abort.test.ts
  - test/replay/loop.test.ts
  - test/replay/replay.test.ts
  - test/replay/scheduler.test.ts
  - test/transport/fake-transport.test.ts
  - test/transport/path-and-buffer.test.ts
  - test/transport/publish.test.ts
findings:
  critical: 3
  warning: 4
  info: 2
  total: 9
status: issues_found
---

# Phase 4: Code Review Report

**Reviewed:** 2026-05-16
**Depth:** standard
**Files Reviewed:** 11
**Status:** issues_found

## Summary

Phase 4 ships the FakeTransport public surface (`createFakeTransport` + four
types) on top of Phase 3's Replay. The architectural backbone is sound:
the D-API-03 BLE-token grep returns zero matches in the source (verified),
the D-API-18 single-import seam holds (`src/transport/fake-transport.ts:107`
is the only `from '../replay/'` in `src/`), the `sendResistance` microtask
boundary uses the correct primitive (`await Promise.resolve()` — not
`queueMicrotask`), and the test discipline is consistent (no sync
`vi.advanceTimersByTime` calls, `fakeAwareSleep` lifted to `_helpers/`,
public-surface imports under `test/transport/`).

However, three correctness defects in `src/transport/fake-transport.ts`
violate documented invariants and will reach consumers if not fixed:

1. **`connect()` is non-atomic**: two concurrent `connect()` calls bypass
   the idempotency guard and orphan a Replay. Documented contract: "Idempotent:
   re-calling on a connected transport is a no-op."
2. **Empty-records deadlock**: a `{ records: [] }` source (or any FIT that
   normalizes to zero records) sets `replay`, then `replay.start()` throws
   synchronously with "records cannot be empty." After that, `disconnect()`
   awaits a Promise that will never settle. Subsequent `connect()` short-circuits
   on the stale `replay` field. The transport is permanently wedged.
3. **A throwing `'complete'` listener becomes `unhandledRejection`**: the
   `replay.completed.then(success, failure)` form does NOT trap synchronous
   throws inside the `success` handler (`() => emitter.emit('complete')`).
   `EventEmitter#emit` propagates listener throws out unchanged. The chained
   Promise rejects with no terminal `.catch`. This is the same class of bug
   Phase 3's CR-02 fix addressed for `replay.completed`; the discipline did
   not carry forward to the transport boundary.

The `received` getter constructing a fresh wrapper object on every read is
a contract ambiguity worth resolving (Warning, below) but not strictly a bug
under the current type definition.

## Critical Issues

### CR-01: `connect()` is non-atomic — concurrent calls orphan a Replay

**File:** `src/transport/fake-transport.ts:189-214`
**Issue:**
The idempotency guard is checked BEFORE the `await`:

```ts
async function connect(): Promise<void> {
  if (replay !== undefined) return;        // <-- guard
  const records = await loadRecords();     // <-- async gap
  replay = new Replay({ records, ... });   // <-- only set HERE
  ...
  replay.start(...);
}
```

Two concurrent calls — `t.connect(); t.connect();` (no `await`) — both observe
`replay === undefined`, both `await loadRecords()`, both construct a fresh
`Replay`, and the second assignment overwrites the first. The first `Replay`
has already had `onRecord` attached and `start()` called; it is now an
orphaned, running scheduler with no reference path back to it from `transport`.
A subsequent `disconnect()` only stops the second instance. The first instance
keeps emitting until natural completion, fanning out through `subscribers`
even after `disconnect()` claims to have quiesced the transport.

This violates the `ITrainerTransport.connect` docstring (`src/types.ts:111`):
> "Idempotent: re-calling on a connected transport is a no-op."

The `{ records }` fast path makes this trivially reproducible (no real I/O
delay needed — the `await` boundary is enough). The `{ path }` variant widens
the race window to filesystem-read latency.

**Fix:**
Set a sentinel BEFORE the await so the second caller observes the in-flight
state, then await the same Promise. Two common shapes — pick one:

```ts
let connectInFlight: Promise<void> | undefined;

async function connect(): Promise<void> {
  if (replay !== undefined) return;
  if (connectInFlight !== undefined) return connectInFlight;
  connectInFlight = (async () => {
    try {
      const records = await loadRecords();
      replay = new Replay({ records, speed, loop, maxEmissionHz });
      replay.onRecord((rec) => { /* ... */ });
      replay.completed.then(
        () => emitter.emit('complete'),
        () => undefined,
      );
      replay.start(options?.sleep ? { sleep: options.sleep } : undefined);
    } finally {
      connectInFlight = undefined;
    }
  })();
  return connectInFlight;
}
```

Add a regression test in `test/transport/fake-transport.test.ts`:

```ts
it('two concurrent connect() calls do not orphan a Replay (D-API-04 idempotency)', async () => {
  const transport = newTransport(makeRecords(3, 50));
  const emitted: DataView[] = [];
  transport.onData((dv) => emitted.push(dv));
  const completePromise = once(transport, 'complete');
  await Promise.all([transport.connect(), transport.connect()]);
  await vi.advanceTimersByTimeAsync(200);
  await completePromise;
  // Exactly 3 emissions — not 6 (which is what an orphaned 2nd Replay would produce).
  expect(emitted).toHaveLength(3);
});
```

---

### CR-02: Empty-records source wedges the transport (deadlock on subsequent disconnect)

**File:** `src/transport/fake-transport.ts:189-214` (interaction with `src/replay/replay.ts:213`)
**Issue:**
`loadRecords()` returns whatever the source supplies. If a consumer passes
`{ source: { records: [] } }` (or a FIT file that normalizes to zero records
after filtering), `new Replay({ records: [], ... })` succeeds (constructor
does not validate) and `replay` is assigned. Then `replay.start(...)` throws
synchronously per `src/replay/replay.ts:213`:

```ts
if (this.config.records.length === 0) {
  throw new Error('Replay.start: records cannot be empty (D-REPL-13)');
}
```

The throw propagates out of `connect()` as the awaited Promise's rejection.
But by that point:
- `replay` is set (line 192) — the next `connect()` call's guard
  `if (replay !== undefined) return` short-circuits, so the transport
  appears "already connected" forever.
- `replay.start(...)` never moved Replay state past `idle`, so `replay.completed`
  stays pending forever (the `.then(...)` handler attached at line 209 never
  fires).
- The next `disconnect()` enters the `if (replay === undefined) return` else
  branch, calls `r.stop()` (no-op — state is still `idle`), and then
  `await r.completed.catch(...)` — which hangs the consumer's caller
  indefinitely. So does any subsequent `reset()` (which awaits `disconnect()`).

A consumer who hits this once must abandon the transport instance. There is
no path to recover.

**Fix:**
Either guard empty records at the factory boundary (preferred — D-API-06
already validates `speed` and `maxEmissionHz` synchronously, so this is
type-consistent) or roll back `replay` on `start()` throw:

Option A — guard at factory boundary, but inside `connect()` after load:

```ts
async function connect(): Promise<void> {
  if (replay !== undefined) return;
  const records = await loadRecords();
  if (records.length === 0) {
    throw new Error('createFakeTransport: source produced zero records');
  }
  const r = new Replay({ records, speed, loop, maxEmissionHz });
  r.onRecord((rec) => { /* ... */ });
  r.completed.then(() => emitter.emit('complete'), () => undefined);
  try {
    r.start(options?.sleep ? { sleep: options.sleep } : undefined);
  } catch (err) {
    // Defense-in-depth: if start() throws for any reason (D-REPL-09 pre-aborted
    // signal also throws synchronously), do NOT leak `replay` — the transport
    // must remain in a re-connectable state.
    throw err;
  }
  replay = r;  // Only commit after start() succeeds.
}
```

The key invariant: do NOT assign `replay` until after `start()` returns
without throwing.

Add a regression test:

```ts
it('connect() with zero records rejects AND leaves the transport reconnectable', async () => {
  const transport = createFakeTransport({ source: { records: [] } }, { sleep: fakeAwareSleep });
  await expect(transport.connect()).rejects.toThrow();
  // Critical: a SECOND connect() must produce the SAME rejection — not silently
  // short-circuit on a stale replay reference.
  await expect(transport.connect()).rejects.toThrow();
  // And disconnect() must not hang.
  await expect(transport.disconnect()).resolves.toBeUndefined();
});
```

---

### CR-03: Throwing `'complete'` listener becomes `unhandledRejection`

**File:** `src/transport/fake-transport.ts:209-212`
**Issue:**
Phase 3's CR-02 fix (`src/replay/replay.ts:266`) defuses unhandled rejection
on `replay.completed` by attaching a no-op `.catch` to the deferred promise
itself. The same discipline does NOT apply at the FakeTransport boundary:

```ts
replay.completed.then(
  () => emitter.emit('complete'),  // <-- can throw
  () => undefined,
);
```

`EventEmitter#emit` is NOT configured with `captureRejections` and re-throws
listener exceptions synchronously. If any `'complete'` listener throws — a
realistic case under tests where assertions inside a `once('complete', ...)`
listener can fail — the throw becomes a rejection on the chained Promise
returned by `.then(success, failure)`. The `failure` arm only catches the
ORIGINAL rejection from `replay.completed`; it does NOT catch errors thrown
in the `success` arm. The chained Promise's rejection is unhandled.

This is the same bug pattern Phase 3 already fixed for the underlying
`completedDeferred.promise` — phase reviewer asked CR-02 ("two BLOCKER
bugs in this file") to be carried forward, and the discipline only
partially landed.

A subscriber-throw in the `onRecord` fan-out (line 198-204) is correctly
guarded by per-handler try/catch — the `'complete'` listener path was
missed.

**Fix:**
Attach a terminal `.catch(...)` to absorb success-arm throws. Also consider
swapping to a sequential-await form so the existing per-handler `try/catch`
in `onRecord` extends naturally to `'complete'`:

```ts
replay.completed.then(
  () => emitter.emit('complete'),
  () => undefined,
).catch((err) => {
  log("'complete' listener threw: %O", err);
});
```

Or, cleaner — wrap the emit in its own try/catch since EventEmitter has no
async semantics here:

```ts
replay.completed.then(
  () => {
    try {
      emitter.emit('complete');
    } catch (err) {
      log("'complete' listener threw: %O", err);
    }
  },
  () => undefined,
);
```

Add a regression test:

```ts
it("a throwing 'complete' listener does NOT register as unhandledRejection", async () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown): void => { unhandled.push(reason); };
  process.on('unhandledRejection', onUnhandled);
  try {
    const transport = newTransport(makeRecords(2, 50));
    transport.on('complete', () => { throw new Error('boom'); });
    await transport.connect();
    await vi.advanceTimersByTimeAsync(200);
    await Promise.resolve();
    await Promise.resolve();
    expect(unhandled).toHaveLength(0);
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});
```

## Warnings

### WR-01: `received` getter allocates a fresh wrapper object on every read

**File:** `src/transport/fake-transport.ts:252-254`
**Issue:**
The getter constructs a new outer object literal each time:

```ts
get received() {
  return { resistance: resistanceLog as ReadonlyArray<number> };
},
```

This means `transport.received !== transport.received` — referential
identity for the outer wrapper is broken. The inner `resistance` array
reference IS stable (same `resistanceLog`), but consumers who do
`Object.is(prev, transport.received)` change-detection (React/Solid/Vue
dependency-tracking idioms — VeloWorld likely runs one of these) will
see a "change" on every read.

The `src/types.ts:236-238` JSDoc and `src/transport/fake-transport.ts:160-163`
comment promise stability of the array identity ("the same array identity
stay stable" across `reset()`), but the wrapper-object identity is
unspecified. Two reasonable interpretations:
1. The wrapper is incidental — only the inner array matters. (Then it
   should still be a stable reference; allocation per call is wasteful and
   surprising.)
2. The wrapper IS part of the contract. (Then the type's
   `readonly received: { resistance: ... }` shape under strict identity is
   broken.)

Either way, returning a stable wrapper is strictly better.

**Fix:**
Hoist the wrapper to factory scope:

```ts
const received: { resistance: ReadonlyArray<number> } = {
  resistance: resistanceLog as ReadonlyArray<number>,
};
// ... in transport:
received,
// (drop the getter)
```

The `as ReadonlyArray<number>` widens the mutable array's type at one place
only; the runtime reference is the live `resistanceLog`, so `reset()`
truncating in place still reflects through `received.resistance` immediately.

---

### WR-02: `reset()` does not document or test `'complete'` listener persistence

**File:** `src/transport/fake-transport.ts:241-244`, `src/types.ts:238-247`
**Issue:**
`reset()`'s docstring explicitly addresses `onData` subscriber persistence
("Does NOT clear `onData` subscribers — vitest idiom registers handlers in
beforeEach"). It is silent on `emitter` listeners. Reading the
implementation: `reset()` never touches `emitter`, so all `'complete'`
listeners persist across `reset()` — including auto-removed `once` listeners
that already fired (those are gone by definition). This is probably the
intended behavior, but D-API-14 should say so explicitly.

The test at `test/transport/fake-transport.test.ts:437-460` ("`off()` removes
a previously-registered 'complete' listener") covers the negative path
(off-then-reset-then-reconnect → listener does NOT fire) but NOT the
positive path (on-then-reset-then-reconnect → listener DOES fire on the
second natural completion). Without that, the contract is empirically
underspecified.

**Fix:**
Add a positive-path test in Group 9:

```ts
it("on('complete', listener) persists across reset() — fires on second connect's natural completion", async () => {
  const transport = newTransport(makeRecords(2, 50));
  let count = 0;
  transport.on('complete', () => { count++; });
  // Lifecycle 1
  await transport.connect();
  await vi.advanceTimersByTimeAsync(200);
  // Lifecycle 2 after reset
  await transport.reset();
  await transport.connect();
  await vi.advanceTimersByTimeAsync(200);
  await Promise.resolve();
  expect(count).toBe(2);
});
```

And tighten the JSDoc in `src/types.ts:238-247`:
> "Does NOT clear `onData` subscribers OR `'complete'` event listeners.
> Both registries persist — only per-test state (resistance log + replay
> cursor) is cleared."

---

### WR-03: `reset()` racing with in-flight `connect()` is unobservable

**File:** `src/transport/fake-transport.ts:241-244`
**Issue:**
`reset()` calls `disconnect()`, which checks `if (replay === undefined)
return`. While `connect()` is between `await loadRecords()` (line 191) and
`replay = new Replay(...)` (line 192) — the same async gap as CR-01 — `replay`
is undefined. `reset()` returns immediately. Then `connect()`'s in-flight
promise resumes and starts a Replay. The user's call sequence
`await reset(); /* expect quiet */` does NOT actually quiet anything —
they had a connect in flight that they didn't await.

This is a thinner race than CR-01 (CR-01's two concurrent connects are
trivially reproducible; this needs an unawaited-connect-then-reset
sequence — less idiomatic). It is also fixed by CR-01's `connectInFlight`
fix: `disconnect()` would `await connectInFlight` before its early return,
and `reset()` inherits that property.

**Fix:**
Same as CR-01. After applying the `connectInFlight` fix, add a regression
test:

```ts
it('reset() correctly awaits an in-flight connect()', async () => {
  const transport = newTransport(makeRecords(10, 50));
  const emitted: DataView[] = [];
  transport.onData((dv) => emitted.push(dv));
  // Kick off connect WITHOUT awaiting; immediately reset.
  const c = transport.connect();
  await transport.reset();
  await c.catch(() => undefined);
  // Reset must have produced a quiet state — no further emissions.
  await vi.advanceTimersByTimeAsync(500);
  expect(emitted).toHaveLength(0);
});
```

---

### WR-04: Unused `value` parameter in `SleepFn` and `fakeAwareSleep`

**File:** `src/transport/fake-transport.ts:121` and `test/_helpers/fake-aware-sleep.ts:27`
**Issue:**
The `value?: undefined` parameter exists only to mirror `node:timers/promises`'
`setTimeout(delay, value, options)` signature (which accepts an arbitrary
resolution value). trainer-sim never uses it; it is permanently typed
`undefined` and ignored. In `fakeAwareSleep` it is named `_value` (correct
underscore convention); in the production `SleepFn` type it is named `value`
without the underscore — inconsistent.

This is a cosmetic mismatch; the underscore convention is documented in
ESLint config and `_value` is the right name when the parameter is a pure
shape-matcher.

**Fix:**
In `src/transport/fake-transport.ts:121`, rename `value` → `_value`:

```ts
type SleepFn = (
  delay: number,
  _value?: undefined,
  options?: { signal?: AbortSignal },
) => Promise<void>;
```

Or, since the parameter is only a shape-matcher and never actually consumed
by the production path either, drop it entirely from `SleepFn` (and update
the `replay.start({ sleep })` shape to match). The Replay-side type already
has `value?: undefined` as a positional placeholder, so either both files
keep the placeholder or both files drop it.

## Info

### IN-01: `as ReadonlyArray<number>` cast is the only `as` cast in the source

**File:** `src/transport/fake-transport.ts:253`
**Issue:**
The `resistanceLog as ReadonlyArray<number>` cast widens a mutable
`number[]` to `ReadonlyArray<number>`. This is the only `as` cast in the
Phase 4 source (verified via grep). Mechanically safe — `ReadonlyArray<T>`
is a structural supertype of `T[]` and TypeScript should accept this without
the cast in most positions. The cast may be redundant; `return { resistance:
resistanceLog }` typed as `{ resistance: ReadonlyArray<number> }` should
type-check.

If the cast IS load-bearing (because of TS variance rules in this
particular position), prefer a single `const received: { resistance:
ReadonlyArray<number> }` declaration at factory scope (per WR-01) so the
widening happens once at a typed binding site rather than on every getter
call.

**Fix:**
After applying WR-01:

```ts
const received: { resistance: ReadonlyArray<number> } = {
  resistance: resistanceLog,
};
```

The widening flows through the binding type; no explicit `as` needed.

---

### IN-02: Test helper duplicates the AbortError construction shape

**File:** `test/_helpers/fake-aware-sleep.ts:33-36, 41-44`
**Issue:**
The same five-line block:

```ts
const err = new Error('The operation was aborted');
(err as { name: string }).name = 'AbortError';
reject(err);
```

appears twice in `fakeAwareSleep` (pre-aborted check at line 32-37, then
again in `onAbort` at line 38-43). The same shape ALSO appears verbatim in
`test/replay/abort.test.ts:235-240` and `:241-246` inside the local
`raceSleep` helper.

Not a correctness issue — but if a future change tightens the AbortError
shape to match Node's `DOMException`-based `AbortError` (which it should
eventually for parity with `node:timers/promises`), four call sites will
need updating in lockstep.

**Fix:**
Inline a one-liner helper inside `fake-aware-sleep.ts`:

```ts
function abortError(): Error {
  const err = new Error('The operation was aborted');
  (err as { name: string }).name = 'AbortError';
  return err;
}
```

Then the rejection sites are `reject(abortError())`. The `raceSleep` helper
in `abort.test.ts` can import it from `_helpers/` too (the `raceSleep`
function is intentionally a local copy for the CR-01 regression scenario;
its abort-error construction is incidental to that goal).

This is purely a maintainability win; no behavior change. Phase 3
followup-equivalent.

---

_Reviewed: 2026-05-16_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
