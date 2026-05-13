# Phase 1: Vendored FTMS Codec - Context

**Gathered:** 2026-05-13
**Status:** Ready for planning

<domain>
## Phase Boundary

Library produces byte-correct FTMS IndoorBikeData payloads (`DataView`) for
power+cadence records that any spec-compliant decoder consumes faithfully. The
encoder lives at `src/ftms/`, vendored (no usable npm package exists for FTMS
encode), and is gated on a third-party-decoder round-trip — not just internal
byte assertions — because every encoding trap in this surface is silent.

This phase also stands up the project skeleton: TypeScript strict, dual ESM/CJS
build, vitest, package-publish hygiene. Subsequent phases extend the skeleton;
they do not bootstrap it.

**In scope:**
- `src/ftms/indoor-bike-data.ts` — pure encoder for power + cadence (+ optional speed at the type level)
- Field-table source-of-truth in the same module (single `FIELDS` const)
- Internal record type (encoder input shape) in `src/types.ts`
- Full project skeleton: `package.json`, `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts`, `src/index.ts`, dual ESM/CJS exports map
- `publint` + `@arethetypeswrong/cli` validation in CI
- Round-trip tests through Auuki JS decoder (in-process vitest)
- Sign-edge and half-rpm parametrized cases per ROADMAP success criteria

**Out of scope (deferred to later phases):**
- Anything FIT-related (Phase 2)
- Replay scheduling, AbortController, timing (Phase 3)
- `ITrainerTransport` interface, `createFakeTransport`, EventEmitter glue (Phase 4)
- Speed and HR field encoding paths (v2; type signature accommodates speed but encoder body never emits it in v1)
- BLE / `@stoprocent/bleno` (v2)

</domain>

<decisions>
## Implementation Decisions

### Third-Party Decoder Harness (FTMS-05 gate)
- **D-01:** The round-trip gate runs against the **Auuki JS decoder**, in-process inside vitest. Round-trip is one assertion in a unit test; runs unmodified in CI on macOS/Linux.
- **D-02:** Auuki is used as a **decoder only**. Auuki itself encodes power as `Uint16` (PITFALLS.md #2) — that bug does not affect us because we read its decode path, not its encode path.
- **D-03:** Open question for research/planning: how to consume Auuki's `indoor-bike-data.js`. Options the planner must choose between:
  - **Vendor a copy** under `test/fixtures/auuki-decoder.js` with attribution and the upstream commit hash committed alongside (license is MIT — compatible).
  - **Git submodule** of `dvmarinoff/Auuki` pinned to a commit (heavier; pulls Auuki's whole repo).
  - **`npm install github:dvmarinoff/Auuki#<sha>`** (relies on Auuki's `package.json` being importable; not currently structured as a publishable lib).
  Recommended path is vendor-a-copy with a `README.md` next to it explaining provenance and pinned commit. Defer the final call to research.

### Speed-Field Encoding Strategy
- **D-04:** Encoder accepts `{power: number, cadence: number, speed?: number}`. v1 callers always pass `speed: undefined`, so bit-0 = 1 ("more data — speed NOT present"), but the inversion logic is real and tested.
- **D-05:** Bit-0 logic is `flags |= (speed === undefined ? 1 : 0) << 0` with a one-line comment citing FTMS spec inversion. Hard-coding `bit0 = 1` is **not** acceptable (PITFALLS.md tech-debt table marks it "Never" outside an always-emit-speed encoder).
- **D-06:** Round-trip tests MUST cover both branches of the inversion: encode `{power, cadence}` (no speed) → decoder reads no speed; encode `{power, cadence, speed}` → decoder reads speed back equal. The second case is required even though v1 production code never hits it, because the inversion has no other automated check that catches the trap.

### Encoder API Shape
- **D-07:** Public surface from `src/ftms/indoor-bike-data.ts`:
  ```ts
  export interface IndoorBikeRecord {
    power: number;     // watts, sint16, may be negative across full sint16 range
    cadence: number;   // rpm, encoded as uint16 with 0.5 rpm resolution (wire = rpm * 2)
    speed?: number;    // km/h, uint16 with 0.01 km/h resolution; v1 callers omit
  }
  export function encodeIndoorBikeData(record: IndoorBikeRecord): DataView;
  ```
- **D-08:** Pure function. Stateless. No buffer pool. New `Buffer` (or `ArrayBuffer`) per call — adequate for 1 Hz emission. Performance optimization (PITFALLS.md performance #2) is a v2 concern only if soak tests show GC jank.
- **D-09:** Internal field-table is the single source of truth, defined as `const FIELDS` in the same file:
  ```ts
  const FIELDS = {
    instantaneousSpeed:   { type: 'uint16', resolution: 0.01, flagBit: 0, inverted: true  },
    instantaneousCadence: { type: 'uint16', resolution: 0.5,  flagBit: 2, inverted: false },
    instantaneousPower:   { type: 'sint16', resolution: 1,    flagBit: 6, inverted: false },
  } as const;
  ```
  Tests assert directly against this table to catch silent-mutation bugs.
- **D-10:** Implementation uses `Buffer.writeInt16LE` / `Buffer.writeUInt16LE` (LE is in the name — unambiguous), then exposes the result as a `DataView` (PROJECT.md mandates `DataView` as the consumer-facing payload type). PITFALLS.md #4 explicitly warns against raw `DataView.setUint16` because LE is not the default — encoder must not use that form.

### Project Bootstrap Scope
- **D-11:** Phase 1 stands up the **full package skeleton**: `package.json`, `tsconfig.json` (strict, `moduleResolution: "bundler"` or `"node16"` per tsup recommendation), `tsup.config.ts` (dual ESM+CJS, generates `.d.ts` and `.d.cts`), `vitest.config.ts`, `src/index.ts` (re-exports `encodeIndoorBikeData` and `IndoorBikeRecord`), `package.json` `exports` field, `.gitignore`, basic `README.md`.
- **D-12:** `publint` and `@arethetypeswrong/cli` (`attw`) wired into `npm run validate` (or equivalent) and run in CI on every push. This pulls API-07 forward from Phase 4 — Phase 4 will *verify* and not bootstrap.
- **D-13:** GitHub Actions CI matrix on **macOS + Linux**, Node 24 only initially. (Matrix-test of Node 22 + 24 was considered; deferred — re-evaluate when VeloWorld's actual Node version is confirmed.)
- **D-14:** No native deps in Phase 1. `@stoprocent/bleno` is v2; nothing in Phase 1 imports it directly or transitively.
- **D-15:** ESLint setup is **deferred to Phase 4** unless lint-blocking patterns emerge during Phase 1 (e.g., banning raw `DataView.setUint16` per D-10). If a ban is needed, add a minimal ESLint config in Phase 1 with that one rule and grow it later.

### Node Version
- **D-16:** `engines: ">=24.0"` (Node 24 LTS "Krypton"). Latest LTS pick. CI runs on Node 24 only at the start; widen to a 22+24 matrix if/when VeloWorld parity demands it. PROJECT.md and STACK.md previously suggested Node 22 for VeloWorld parity — that recommendation is overridden by this decision; downstream phases inherit Node 24.

### Claude's Discretion
- File-level layout inside `src/ftms/` (single file vs splitting `fields.ts` / `encode.ts`) — pick what reads cleanest after the encoder is written; either path satisfies the field-table-as-source-of-truth requirement (D-09).
- Vitest test file naming (`*.test.ts` next to source vs `__tests__/`) — pick one and stay consistent.
- Internal helper names (`writeU16LE`, `MORE_DATA_BIT`, etc.) — taste-level.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Spec authority
- `https://www.bluetooth.com/specifications/specs/fitness-machine-service-1-0/` — Bluetooth SIG Fitness Machine Service v1.0.1, IndoorBikeData (0x2AD2) characteristic frame layout, flag semantics, field types/resolutions, little-endian encoding. **HIGH confidence the spec is stable; read directly, not via a blog post.**

### Pitfalls and traps (MUST read before any encoder line lands)
- `.planning/research/PITFALLS.md` §Pitfall 1 — Bit-0 "More Data" inversion (D-04, D-05, D-06)
- `.planning/research/PITFALLS.md` §Pitfall 2 — `sint16` power, NOT `uint16` (D-09)
- `.planning/research/PITFALLS.md` §Pitfall 3 — Cadence 0.5 rpm = `wire * 2` (D-09)
- `.planning/research/PITFALLS.md` §Pitfall 4 — Little-endian byte order; `DataView` defaults to BE (D-10)
- `.planning/research/PITFALLS.md` §"Looks Done But Isn't" — first 4 checklist items gate Phase 1 done

### Reference implementations
- `https://github.com/dvmarinoff/Auuki/blob/master/src/ble/ftms/indoor-bike-data.js` — chosen decoder for the FTMS-05 round-trip gate (D-01); MIT-licensed
- `https://github.com/dudanov/python-pyftms` — secondary spec-compliance reference; Apache-2.0; not used in CI but useful when Auuki and the spec disagree

### Architecture and stack
- `.planning/research/ARCHITECTURE.md` §Component 5 (`FtmsEncoder`) — confirms pure-stateless `(record) → DataView` (D-08)
- `.planning/research/STACK.md` — TypeScript 5.9, tsup 8.5, vitest 4.1, hand-rolled FTMS encoder (no npm pkg exists), `publint` + `attw` non-negotiable for dual-published lib

### Project authority
- `.planning/PROJECT.md` §Constraints — `DataView` payload type; MIT license; vendored encoder for v1
- `.planning/PROJECT.md` §Key Decisions — "Vendor the FTMS encoder inside trainer-sim for v1"; "Power + cadence only for v1 IndoorBikeData fields"
- `.planning/REQUIREMENTS.md` §FTMS Codec — FTMS-01 through FTMS-05 (the requirements this phase delivers)
- `.planning/ROADMAP.md` §Phase 1 — Goal, success criteria, "Phase research flag: pick the third-party decoder harness before planning starts" (resolved here as D-01)

### Future-coupling notes (don't break these)
- Vendored `src/ftms/` directory is intended to be **a literal directory move** when `@veloworld/ftms-codec` is extracted later (PROJECT.md). Don't reach outside `src/ftms/` for project-wide utilities (config, logger) from inside the encoder — keep it standalone.
- `src/index.ts` will eventually re-export `ITrainerTransport` (Phase 4). For Phase 1, only `encodeIndoorBikeData` and `IndoorBikeRecord` ship.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- None — repo currently contains only docs (`CLAUDE.md`, `LICENSE.md`, `README.md`, `.planning/`). Phase 1 is the first code commit.

### Established Patterns
- None code-side. Documentation patterns: planning artifacts live under `.planning/`; research outputs under `.planning/research/`; phase artifacts under `.planning/phases/<NN>-<slug>/`.

### Integration Points
- `src/index.ts` will be the single public entry. Every later phase adds named exports here; nothing reaches into `src/ftms/` directly from outside the package.

</code_context>

<specifics>
## Specific Ideas

- **"Why Node 22, why not 24?"** — User flagged this during gray-area selection. Resolved by D-16: pick Node 24 LTS now, override prior STACK.md recommendation. PROJECT.md should be updated at the next phase transition to reflect Node 24 + `@stoprocent/bleno` (the latter already noted in research/SUMMARY.md as a pending PROJECT.md update).
- The encoder MUST be authored such that adding a speed-emit code path in v2 is a one-method change (the type already accepts `speed?`; bit-0 logic already branches). Don't paint future-self into a corner.
- Auuki is an app, not a published library — the planner needs a concrete answer on how to import its decoder (D-03). Recommended: vendored copy with pinned commit. Treat as a research deliverable.

</specifics>

<deferred>
## Deferred Ideas

- **Node 22 + 24 CI matrix.** D-13 picks Node 24 only initially. Re-evaluate when VeloWorld's Node version is confirmed; if VeloWorld is on 22, widen the matrix in Phase 5 (where VeloWorld parity is the gate).
- **Buffer pool / pre-allocation in encoder.** PITFALLS.md performance #2 — v2 concern; only matters at 4+ Hz emission or under multi-hour soak. v1 emission is 1 Hz; not a v1 problem.
- **Second decoder (PyFTMS) in CI alongside Auuki.** Considered as a strongest-gate option; declined because there's no current evidence Auuki's decode disagrees with the spec on the fields v1 encodes. Revisit if the FTMS-05 round-trip ever produces a false positive.
- **Lint-ban on raw `DataView.setUint16`.** Possibly added in Phase 4 ESLint setup; for Phase 1, avoided by using `Buffer.write*LE` exclusively in the encoder body (D-10). If the codec module ever uses raw `DataView` writes, add the ban then.
- **Update PROJECT.md** with `@stoprocent/bleno` (modern fork) and Node 24 floor. Not a Phase 1 task — handle at the next `/gsd-transition` per `gsd` workflow conventions.

</deferred>

---

*Phase: 1-vendored-ftms-codec*
*Context gathered: 2026-05-13*
