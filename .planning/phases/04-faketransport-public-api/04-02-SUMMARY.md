---
phase: 04
plan: 02
subsystem: public-types
tags: [types, public-surface, ITrainerTransport, FakeTransport, discriminated-union]
dependency_graph:
  requires:
    - "src/types.ts (existing RideRecord — unchanged)"
    - "src/replay/types.ts (sibling — ReplayConfig field-name parity check)"
  provides:
    - "ITrainerTransport (canonical four-method transport contract — D-API-01/02/13)"
    - "FakeTransportSource (discriminated union {path}|{buffer}|{records} — D-API-05)"
    - "FakeTransportConfig (factory config; defaults applied in factory body — D-API-06)"
    - "FakeTransport (ITrainerTransport + received/reset/on/off/once — D-API-13/16/17)"
  affects:
    - "Plan 04-03 (createFakeTransport factory imports these types and adds runtime + public re-export atomically)"
    - "Plan 04-04 / 04-05 (transport tests `import type` for handler annotations)"
    - "Phase 5 (VeloWorld imports `ITrainerTransport` from trainer-sim per ARCHITECTURE.md Pattern 4 + Anti-Pattern 6)"
tech_stack:
  added: []
  patterns:
    - "Pattern T1 — decision-cited JSDoc on each interface/type (Phase 1+ convention)"
    - "Pattern T2 — `import type { Buffer } from 'node:buffer'` (verbatimModuleSyntax — type-position-only import)"
    - "S2 — `verbatimModuleSyntax` discipline (type-only imports use `import type`)"
key_files:
  created: []
  modified:
    - "src/types.ts (preamble extended with D-API citations; +4 top-level types alongside existing RideRecord)"
decisions:
  - "Implemented D-API-01: trainer-sim is the canonical definer of `ITrainerTransport` (the interface lives in src/types.ts next to RideRecord; consumers import the type from this package rather than defining their own)."
  - "Implemented D-API-02: `connect()` / `disconnect()` / `sendResistance()` all return `Promise<void>` at the type level — async semantics are owned by the interface, not the implementation."
  - "Implemented D-API-05: `FakeTransportSource` is a three-variant discriminated union — `{ path }` | `{ buffer }` | `{ records }`. JSDoc on the type carries the consumer-vs-internal-test note (records variant is for trainer-sim's own tests; consumer-facing tests should use path or buffer)."
  - "Implemented D-API-06: every `FakeTransportConfig` field except `source` is optional at the type level — defaults (speed=1, loop=false, maxEmissionHz=1000) apply in the factory body, not the type system. Allows consumers to pass `{ source }` alone."
  - "Implemented D-API-13: `ITrainerTransport` does NOT include event-emitter methods. The `'complete'` event lives on the wider `FakeTransport` subtype, leaving v2's BlenoTransport free to add transport-specific events (e.g., a `'disconnect'` event for BLE link-loss) without widening the interface."
  - "Implemented D-API-13 / D-API-16 / D-API-17: `FakeTransport.on/off/once` use the LITERAL `'complete'` event-name with literal `() => void` listeners — not `Pick<EventEmitter, 'on'|'off'|'once'>`, which would inherit the loose `string | symbol` overloads. This kills the spoofing threat T-04-02-02 (consumer narrows their own variable, inherits loose overloads)."
  - "Implemented D-API-17: `received.resistance` is exposed as `ReadonlyArray<number>` at the type level only — no `Object.freeze`. Same posture as Phase 3's `private readonly config` (frozen by convention, not by `Object.freeze`)."
  - "Used `import type { Buffer } from 'node:buffer'` (Pattern T2) — `Buffer` appears only in a type position inside `FakeTransportSource`; `verbatimModuleSyntax: true` requires the `type` keyword so tsup does not emit a runtime no-op import."
  - "Updated the file preamble to enumerate the five new D-API citations (01/02/05/06/13/16/17) alongside the existing D-FIT-01 / FIT-03 citations — preserves the project's self-documenting traceability discipline."
metrics:
  duration: "~5 min"
  completed_date: "2026-05-16"
---

# Phase 04 Plan 02: ITrainerTransport / FakeTransport Public Types Summary

Added the four public TypeScript types — `ITrainerTransport`, `FakeTransport`, `FakeTransportConfig`, `FakeTransportSource` — to `src/types.ts` alongside the existing `RideRecord`, establishing the type-only foundation that Plan 04-03's runtime factory will satisfy and Plans 04-04/04-05's tests will `import type` from.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add ITrainerTransport / FakeTransport / FakeTransportConfig / FakeTransportSource to src/types.ts | `527ceda` | `src/types.ts` |

## Implementation

### `src/types.ts` — extended in-place

The existing module preamble was extended with seven new locked-decision citations (D-API-01, D-API-02, D-API-05, D-API-06, D-API-13, D-API-16, D-API-17) alongside the pre-existing D-FIT-01 / FIT-03 citations. The preamble's "Future phases (Phase 4 ITrainerTransport, library-wide Config) extend this file..." sentence was updated to reflect that Phase 4 has now landed.

A single `import type { Buffer } from 'node:buffer'` line was added between the preamble and the type definitions (Pattern T2 — type-only import per `verbatimModuleSyntax: true`).

Four new top-level declarations were appended below the unchanged `RideRecord`:

1. **`export interface ITrainerTransport`** — the four-method canonical contract:
   - `connect(): Promise<void>`
   - `disconnect(): Promise<void>`
   - `onData(handler: (data: DataView) => void): () => void`
   - `sendResistance(grade: number): Promise<void>`

   No `received`, no `reset`, no `on/off/once` — those live exclusively on the wider `FakeTransport` subtype per D-API-13.

2. **`export type FakeTransportSource`** — discriminated union of `{ path: string }` | `{ buffer: Buffer | Uint8Array }` | `{ records: ReadonlyArray<RideRecord> }`. The `Buffer` reference in the second variant is what justifies the `import type { Buffer }` at the top of the file.

3. **`export interface FakeTransportConfig`** — required `source: FakeTransportSource` plus optional `speed?` / `loop?` / `maxEmissionHz?`. Defaults are deliberately NOT in the type — they are factory-body concerns per D-API-06.

4. **`export interface FakeTransport extends ITrainerTransport`** — inherits the four canonical methods and adds five FakeTransport-specific members: `readonly received: { resistance: ReadonlyArray<number> }`, `reset(): Promise<void>`, and `on`/`off`/`once` with the literal `'complete'` event-name and literal `() => void` listener (NOT `Pick<EventEmitter, ...>` — that would inherit loose `string | symbol` overloads and silently re-introduce the spoofing threat T-04-02-02).

Each declaration carries a JSDoc preamble citing the D-API decisions it implements (Pattern T1) plus rationale prose that traces back to PROJECT.md / CLAUDE.md / 04-RESEARCH.md / 04-CONTEXT.md. Per CLAUDE.md "default to no comments", the JSDoc lives only at the type/method level — there are no line-by-line comments inside field bodies.

### `src/index.ts` — INTENTIONALLY UNCHANGED

Per the plan's `<output>` section and the wider Phase 4 sequencing, `src/index.ts` is not touched in this plan. The public re-export of these four types (and the runtime `createFakeTransport` value) is one atomic commit owned by Plan 04-03 — landing the type re-exports here without the runtime would publish a header without a body.

## Verification Results

All eleven plan acceptance criteria pass:

| Criterion | Result |
|-----------|--------|
| `tsc --noEmit -p tsconfig.test.json` exits 0 | PASS (`npm run typecheck:test` completes with exit 0) |
| `grep -c "export interface ITrainerTransport" src/types.ts` == 1 | PASS |
| `grep -c "export type FakeTransportSource" src/types.ts` == 1 | PASS |
| `grep -c "export interface FakeTransportConfig" src/types.ts` == 1 | PASS |
| `grep -c "export interface FakeTransport extends ITrainerTransport" src/types.ts` == 1 | PASS |
| `grep -E "bleno\|gatt\|advertis" src/types.ts` returns zero matches | PASS (clean) |
| `grep "connect(): Promise<void>" src/types.ts` matches once | PASS (line 113 — `disconnect` substring matches but is a different method) |
| `grep "disconnect(): Promise<void>" src/types.ts` matches once | PASS (line 120) |
| `grep "sendResistance(grade: number): Promise<void>" src/types.ts` matches once | PASS |
| `grep "onData(handler: (data: DataView) => void): () => void" src/types.ts` matches once | PASS |
| on/off/once signatures use literal `'complete'` event-name | PASS (`grep -c "event: 'complete'"` == 3) |
| `import type { Buffer }` (NOT `import { Buffer }`) appears in src/types.ts | PASS |

## BLE-Type-Leak Enforcement Status

**Partial enforcement landed in this plan; full enforcement deferred to Plan 04-03.**

Plan 04-02 only modifies `src/types.ts`, so the acceptance grep (per D-API-03) ran against that single file and returned zero matches:

```bash
grep -E "bleno|gatt|advertis" src/types.ts   # clean
```

Plan 04-03 will add `src/transport/fake-transport.ts` and re-run the full grep against all three files in the public-surface graph (`src/index.ts`, `src/types.ts`, `src/transport/fake-transport.ts`) — that is the canonical enforcement form per D-API-03 / threat T-04-02-01. Plan 04-06 will run the final `publint` + `attw` validation against the built `dist/` for end-to-end coverage including the dual ESM/CJS publish artifacts.

## Requirements Addressed

| Requirement | Status | Notes |
|-------------|--------|-------|
| **API-02** — `ITrainerTransport` exported as a TypeScript type from the package root | Implemented (interface defined; public re-export ships in Plan 04-03) | The interface and its three structural siblings (`FakeTransport`, `FakeTransportConfig`, `FakeTransportSource`) now exist in `src/types.ts` with the four-method shape locked by D-API-01/02/13. The barrel re-export from `src/index.ts` is the Plan 04-03 atomic commit (paired with the `createFakeTransport` runtime value). |
| **API-08** — strict-mode TypeScript Node 24 import works without `@types/*` shim | Proven by `tsc --noEmit -p tsconfig.test.json` exit 0 | The four new types compile cleanly under `strict: true`, `verbatimModuleSyntax: true`, `noUncheckedIndexedAccess: true`, `module: ESNext` with `moduleResolution: bundler`, and the project's only `@types/*` dependency is `@types/node` (which is non-negotiable for any Node library and not what the requirement excludes). |

## Deviations from Plan

**None — plan executed exactly as written.** The action body, verification block, and acceptance criteria all matched the implementation 1:1. No Rule 1/2/3 auto-fixes were needed; no Rule 4 architectural decisions surfaced.

## Authentication Gates

None — this is a pure type-only edit to a single source file.

## Threat Flags

None. The change is contained to `src/types.ts`; no new endpoints, no new file-access patterns, no new schema or trust boundary surface. The two threats this plan was responsible for mitigating (T-04-02-01 BLE-type leak — partial; T-04-02-02 spoofing via loose EE overloads) are addressed in-line by the literal-`'complete'` typing and the no-BLE-tokens grep.

## Known Stubs

None. The four types are fully populated and exported. No placeholder strings, no hardcoded empty values flowing to UI, no "TODO/FIXME" markers introduced.

## Self-Check: PASSED

**Files claimed created/modified:**

```
$ [ -f src/types.ts ] && echo "FOUND: src/types.ts"
FOUND: src/types.ts
```

**Commit claimed:**

```
$ git log --oneline --all | grep -q "527ceda" && echo "FOUND: 527ceda"
FOUND: 527ceda
```

**Strict-mode typecheck:**

```
$ npm run typecheck:test
> tsc --noEmit -p tsconfig.test.json
(exit 0)
```

All claims verified.
