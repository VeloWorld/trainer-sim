# Phase 4: FakeTransport & Public API - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-16
**Phase:** 04-faketransport-public-api
**Areas discussed:** ITrainerTransport definition + async semantics, factory shape + source union, multi-subscriber fan-out, `'complete'` event surface, `reset()` scope, `received` shape, module layout
**Mode:** `--auto` (recommended-option selection across all gray areas — no AskUserQuestion calls; selections logged here for audit)

---

## ITrainerTransport definition site & async semantics

| Option | Description | Selected |
|--------|-------------|----------|
| Define `ITrainerTransport` in trainer-sim (`src/types.ts`); all methods async (`Promise<void>`) | Canonical definer per ARCHITECTURE.md Pattern 4 + Anti-Pattern 6; Fake forces a microtask boundary even on `sendResistance` so v2 BlenoTransport's GATT-write timing isn't a behavior diff in user code | ✓ |
| Define in trainer-sim, but `sendResistance` is sync `void` | Saves one microtask per call; risks v1↔v2 timing diff PITFALLS.md #12 explicitly warns about | |
| Have VeloWorld define it; trainer-sim "satisfies" | ARCHITECTURE.md Anti-Pattern 6 — open-source consumers have no canonical type; two definitions can drift | |

**Selected:** Define in trainer-sim with all-async semantics
**Rationale:** ROADMAP Phase 4 note explicitly locks this: "the `ITrainerTransport` interface owns the async semantics for `sendResistance` (force a microtask boundary even in Fake) and forbids any BLE-specific types in the import graph — these decisions ripple through every test and into v2's BlenoTransport, so settle them here." Captured as D-API-01..03.

---

## Factory shape & source discriminated union

| Option | Description | Selected |
|--------|-------------|----------|
| Sync factory; `connect()` defers FIT load. `source: { path } \| { buffer } \| { records }` | Stable factory signature across all 3 source variants; FS+FIT errors land in `connect()` rejection. Test-only `{ records }` fast path skips FIT parse | ✓ |
| Async factory `await createFakeTransport({ path })`; loads FIT eagerly | Surfaces FIT errors at construction time, but couples factory to async; test loops doing `for (const f of fits) { … }` get awkward | |
| Sync factory, single `source: string \| Buffer \| RideRecord[]` (no discriminator) | Less code; loses type safety on which loader to call (`Buffer` extends `Uint8Array` — easy to confuse `buffer` with `path`) | |

**Selected:** Sync factory with discriminated-union source
**Rationale:** Mirrors Phase 2's sync/async split (`loadFitFromBuffer` sync; `loadFitFromPath` async — D-FIT-07); SUMMARY.md "Pluggable internal `RecordSource` so trainer-sim's own tests skip FIT parsing without violating 'real FIT only' for consumers"; CLAUDE.md "trust internal code, validate at boundaries" — the discriminator catches mis-passed bytes at compile time. Captured as D-API-04..06.

---

## Multi-subscriber fan-out & error isolation

| Option | Description | Selected |
|--------|-------------|----------|
| `Set<handler>`; per-handler try/catch; `debuglog('trainer-sim:transport')` on swallow | Throwing handler doesn't starve others or abort replay; debuglog visibility without console noise | ✓ |
| `Array<handler>`; iterate raw, let throws propagate | Simpler; one bad handler kills the whole emit path | |
| `Set<handler>`; rethrow first error after fan-out | Preserves error visibility but only surfaces first failure; vitest tests routinely throw `expect(...).toBe()` from `onData` — first-error-rethrow gives misleading reports | |

**Selected:** Set + per-handler try/catch + debuglog
**Rationale:** vitest assertions ARE thrown errors from inside `onData` handlers — preserving isolation is the right default for a test fixture. Same `debuglog` pattern as Phase 2 (`'trainer-sim:fit'`) and Phase 3 (`'trainer-sim:replay'`). Captured as D-API-09, D-API-10.

---

## `'complete'` event surface

| Option | Description | Selected |
|--------|-------------|----------|
| Compose internal `EventEmitter`; expose only `on/off/once` for `'complete'` | `await once(transport, 'complete')` works; surface stays narrow — type doesn't bleed all 30 EventEmitter methods | ✓ |
| `extends EventEmitter` | Simpler one-liner; widens `ITrainerTransport`-shaped return to include arbitrary event surface; risks consumers binding to `'newListener'`, `'error'`, etc. | |
| Promise-only — no event; consumers `await transport.completed` | Mismatches REQUIREMENTS.md REPL-05 wording ("emits a `'complete'` event") | |

**Selected:** Composition with narrow event surface
**Rationale:** REPL-05 wording is binding ("emits a `'complete'` event a test can `await`"); composition keeps `ITrainerTransport` honest (it does NOT include event-emitter methods); test ergonomics via `node:events.once(transport, 'complete')` are unchanged from EventEmitter-extension. Captured as D-API-11..13.

---

## `reset()` scope

| Option | Description | Selected |
|--------|-------------|----------|
| Clear `received.resistance` + reconstruct internal `Replay`; preserve `onData` subscribers | Matches success-criterion 4 "single instance reused across `afterEach()` tests"; vitest idiom registers handlers in `beforeEach` (refreshed per test) | ✓ |
| Clear everything, including `onData` subscribers | "Reset" is total; surprises users who register handlers once per `describe` block | |
| Throw if called while `running` | Heavy-handed; the obvious test pattern `afterEach(() => transport.reset())` would have to first `await transport.disconnect()` | |

**Selected:** Minimal-state reset (resistance log + replay cursor only) + `Promise<void>` return
**Rationale:** Phase 3's single-use Replay (D-REPL-07) means "rewind cursor" is impossible — the only legal re-use is to construct a fresh Replay. Subscribers are external to that lifecycle. Captured as D-API-14, D-API-15.

---

## `received` shape — v1 literal vs v2-forward

| Option | Description | Selected |
|--------|-------------|----------|
| `received: { resistance: ReadonlyArray<number> }` (literal v1) | CLAUDE.md "no abstractions for hypothetical future requirements"; v2's FMCP opcodes will refactor this additively when they land | ✓ |
| Pre-design `received.controlPoint[]` with `received.resistance` as a derived view | Future-proof but speculative; SUMMARY.md flagged this gap and explicitly said "decide in Phase 4" — decision is to NOT pre-design | |
| `received: number[]` (raw array) — no nesting | Saves one property; loses room for `received.x` v2 extensions and forces a more invasive shape change later | |

**Selected:** Literal v1 shape
**Rationale:** CLAUDE.md "no abstractions for hypothetical future requirements"; SUMMARY.md gap "received shape forward-compatibility for v2" is explicitly DEFERRED here. Captured as D-API-16, D-API-17.

---

## Module layout

| Option | Description | Selected |
|--------|-------------|----------|
| `src/transport/fake-transport.ts` (new directory) | ARCHITECTURE.md "Recommended Project Structure"; v2's BlenoTransport is a sibling file in the same folder | ✓ |
| Flat `src/fake-transport.ts` | One less directory; mismatches the rest of the repo (`src/ftms/`, `src/fit/`, `src/replay/` all directory-scoped) | |
| Single-file public API in `src/index.ts` (factory inline) | No (the factory needs ~80–120 LOC); keeps `src/index.ts` as a re-export hub | |

**Selected:** `src/transport/fake-transport.ts`
**Rationale:** Pattern parity with the rest of the repo + ARCHITECTURE.md alignment + clean v2 BlenoTransport landing. Captured as D-API-18.

---

## Phase 3 followup folding

| Option | Description | Selected |
|--------|-------------|----------|
| Fold WR-05 (Replay validation) + IN-01 (`fakeAwareSleep` duplication) into Phase 4 | Phase 4 is the first transport-layer test; the helper duplication would otherwise grow to 5 files. WR-05 is naturally a public-boundary concern (factory validates, Replay stays internal) | ✓ |
| Fold all Phase 3 advisory followups (WR-02, WR-04, WR-05, IN-01) | Scope creep — WR-02 (state docstring) and WR-04 (frozen claim) don't intersect with Phase 4's contract surface | |
| Fold none — keep Phase 4 strictly to API-01..08 | Misses the natural moment to lift the helper and place the validation gate where it belongs (the public boundary) | |

**Selected:** Selective fold (WR-05 + IN-01 only)
**Rationale:** Phase 4 is the natural home for the public-boundary input validation (D-API-06) and for lifting the duplicated `fakeAwareSleep` helper before adding a 5th caller. Captured as D-API-25 + D-API-26.

---

## Claude's Discretion

- File-level layout inside `src/transport/`: single `fake-transport.ts` for v1; split only if the file exceeds ~250 LOC after implementation.
- Plain object literal vs class instance for the returned FakeTransport — default to object literal (matches ARCHITECTURE.md Pattern 5 example; avoids `instanceof` narrowing the consumer doesn't need).
- Typed `EventEmitter<{ complete: [] }>` (Node 22+) vs loose `EventEmitter` — default to typed to match the strict-mode TypeScript posture.
- Naming inside the factory closure (`subscribers`, `resistanceLog`, `replay`, `emitter`) — taste-level.

## Deferred Ideas

- `tick(ms)` virtual-clock mode — REQUIREMENTS.md out-of-scope; revisit in v1.x if demand emerges. Phase 3's existing seams (`getNow` from `globalThis.performance.now`; injectable `sleep`) already enable it.
- `received.controlPoint[]` v2-forward shape — deferred per D-API-16; v2 will add additively.
- `'data'` event surface and `notified.count` accessor — SUMMARY.md "should have" but not v1 requirements.
- ReadableStream / URL / HTTP as a fourth source variant — REQUIREMENTS.md out-of-scope.
- Multiple FakeTransport instances sharing one parsed FIT — consumers use `{ records: parsedOnce }`.
- v2 BlenoTransport subpath in `tsup.config.ts` — already documented as a comment; no Phase 4 change.
- `@stoprocent/bleno` PROJECT.md update — Phase 1 carry-forward; handle at next milestone close.
- Phase 3 advisory followups WR-02, WR-04 — leave for v1.x cleanup.
- Phase 2 followups WR-01, WR-03, WR-05 — loader-internal; out of Phase 4 scope.
- CLI (`trainer-sim play`) — v2 only.
