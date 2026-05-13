---
phase: 01-vendored-ftms-codec
reviewed: 2026-05-14T00:00:00Z
depth: standard
files_reviewed: 12
files_reviewed_list:
  - .github/workflows/ci.yml
  - package.json
  - scripts/nrf-connect-demo.ts
  - src/ftms/indoor-bike-data.ts
  - src/index.ts
  - test/fixtures/ftms-decoder.ts
  - test/fixtures/README.md
  - test/ftms/indoor-bike-data.test.ts
  - tsconfig.json
  - tsconfig.test.json
  - tsup.config.ts
  - vitest.config.ts
findings:
  critical: 0
  warning: 5
  info: 4
  total: 9
status: findings
---

# Phase 1: Code Review Report

**Reviewed:** 2026-05-14T00:00:00Z
**Depth:** standard
**Files Reviewed:** 12
**Status:** findings

## Summary

The Phase 1 vendored FTMS IndoorBikeData encoder is, on the spec-correctness axis,
in good shape: power is correctly written as `sint16` via `writeInt16LE`, cadence
is encoded at half-rpm resolution, speed is rounded before integer conversion, and
the bit-0 "More Data" inversion is implemented as a real branch (not a hard-coded
flags literal). The reference-payload byte fixtures, the round-trip test path
through `test/fixtures/ftms-decoder.ts`, and the `FIELDS` invariant assertions all
land. The decoder fixture is also plausibly independent of the encoder — the two
files use different idioms for the bit-0 inversion (`(speed === undefined ? 1 : 0)`
on the encoder side; `(flags & (1 << SPEED_BIT)) === 0` on the decoder side) and
neither is a mechanical inversion of the other.

The findings below are concentrated in two areas:

1. **Input validation** — `encodeIndoorBikeData` does no range/sanity checking on
   its inputs. Out-of-range power, cadence, speed, NaN, Infinity, or non-finite
   numbers either throw an opaque `RangeError` from inside `Buffer.write*LE` or
   silently coerce to zero. This is the most consequential class of issue because
   the encoder is the public API surface (`src/index.ts` re-exports it) and Phase
   3 replay code will feed it FIT-derived numbers without sanitisation.

2. **CI / packaging hygiene** — the test typecheck script exists but is not wired
   into CI, so TypeScript errors in test code can ship undetected. The legacy
   `main` and `module` fields in `package.json` may cause subtle resolution drift
   in tools that prefer them over `exports`.

No security vulnerabilities (injection, eval, unsafe deserialisation, hardcoded
secrets) were observed. The nRF Connect demo script is pure stdout output with no
shell execution, no network calls, and no file writes.

## Warnings

### WR-01: encoder accepts out-of-range power and throws an opaque RangeError

**File:** `src/ftms/indoor-bike-data.ts:160`
**Issue:** `encodeIndoorBikeData` calls `buf.writeInt16LE(record.power, offset)`
without validating that `record.power` fits sint16 (`-32768..32767`). If a caller
passes `power: 40000` (or `-40000`), Node throws a `RangeError: The value of
"value" is out of range` from inside `Buffer.writeInt16LE`. The error has no
trainer-sim context attached, mentions an "offset" the caller did not supply, and
leaks an implementation detail (that the encoder uses `Buffer`). Phase 3 replay
code will feed FIT-derived power numbers straight in; some Garmin files contain
spurious 60000+ W spikes after sensor disconnect events, and those will crash the
emitter mid-stream rather than producing a defined error.
**Fix:**
```ts
export function encodeIndoorBikeData(record: IndoorBikeRecord): DataView {
  if (!Number.isFinite(record.power) || record.power < -32768 || record.power > 32767) {
    throw new RangeError(
      `encodeIndoorBikeData: power=${record.power} out of sint16 range (-32768..32767)`,
    );
  }
  // ... rest unchanged
}
```
Apply the same pattern to `cadence` (must be finite, `>= 0`, and
`Math.round(cadence / 0.5) <= 65535`) and to `speed` when present.

### WR-02: NaN / Infinity inputs silently encode as zero or throw

**File:** `src/ftms/indoor-bike-data.ts:151,156,160`
**Issue:** `Math.round(NaN / 0.5) === NaN`; `Buffer.writeUInt16LE(NaN, ...)` in
recent Node coerces to `0` or throws depending on version, and
`Buffer.writeInt16LE(NaN, ...)` likewise behaves inconsistently. A sensor dropout
that yields `cadence: NaN` from upstream code would either silently encode
`cadence = 0 rpm` (looks like the rider stopped pedalling) or throw an opaque
RangeError. Either failure mode is worse than a clear validation error.
**Fix:** Reject non-finite values explicitly at the top of `encodeIndoorBikeData`:
```ts
for (const [name, value] of [['power', record.power], ['cadence', record.cadence],
  ...(record.speed !== undefined ? [['speed', record.speed]] : [])] as const) {
  if (!Number.isFinite(value)) {
    throw new TypeError(`encodeIndoorBikeData: ${name}=${value} is not a finite number`);
  }
}
```

### WR-03: negative cadence / speed throw an unhelpful RangeError from Buffer

**File:** `src/ftms/indoor-bike-data.ts:151,156`
**Issue:** Cadence and speed are wire-encoded as `uint16` (unsigned). Passing
`cadence: -1` evaluates `Math.round(-1 / 0.5) === -2`, then
`buf.writeUInt16LE(-2, offset)` throws `RangeError: out of range`. This is the
same error class as WR-01 but for a different field; calling it out separately
because the cadence/speed case is much more likely in practice (a misconfigured
power meter occasionally reports -1 rpm during stop-detection windows). The
encoder should reject negative cadence/speed with a domain-specific message.
**Fix:** Add `cadence < 0` and `speed < 0` (when present) to the validation block
proposed in WR-01.

### WR-04: CI does not run the test typecheck

**File:** `.github/workflows/ci.yml:33-37`
**Issue:** `package.json` defines `"typecheck:test": "tsc --noEmit -p tsconfig.test.json"`
but the CI job runs only `npm ci`, `npm run build`, `npm test`, `npm run validate:publint`,
and `npm run validate:attw`. Vitest with vite's TS pipeline does not enforce
`strict` typecheck the way `tsc --noEmit` does — type errors in `test/**/*.ts`
(implicit `any`, missing type imports, structural mismatches against the
encoder's exported types) can ship to main without anyone noticing. This
specifically defeats the value of `tsconfig.test.json`, which exists only to
typecheck tests against the same strict settings as `src/`.
**Fix:** Add a step before `npm test`:
```yaml
- run: npm run typecheck:test
```
Optionally also add `npm run typecheck` for `src/` (currently `tsup` build runs
the TS compiler internally, but a dedicated `tsc --noEmit -p tsconfig.json` step
gives a clearer CI signal when the issue is types vs. bundling).

### WR-05: legacy `main` / `module` fields may shadow `exports` for some consumers

**File:** `package.json:10-12`
**Issue:** `package.json` declares both modern `exports` (with `import`/`require`
condition split and types-first ordering) AND the legacy `main`, `module`, and
top-level `types` fields. Most modern resolvers (Node 16+, TypeScript 5.x with
`moduleResolution: "node16"` or `"bundler"`, recent webpack/vite/esbuild) prefer
`exports` and ignore the legacy fields, but a non-trivial slice of tooling still
reads `module` first (older webpack 4, some Metro configs, some bundler plugins).
That can lead to a consumer importing `dist/index.js` (ESM) under a CJS context
because `module` was preferred over the `exports.require` path. `attw` may not
flag this if both fields happen to point at compatible artefacts, but the
divergence is a latent foot-gun if the `exports` map ever changes shape.
**Fix:** Either drop `main` / `module` (rely on `exports` only — the modern
recommendation, and what `publint` will eventually warn about) or make sure their
targets remain identical to the corresponding `exports` conditions on every
release. A cleaner alternative:
```json
{
  "main": "./dist/index.cjs",
  "types": "./dist/index.d.ts",
  "exports": { "...": "..." }
}
```
Drop `module` (the field has been effectively superseded by `exports.import`).

## Info

### IN-01: `package.json` does not export `./package.json`

**File:** `package.json:14-25`
**Issue:** Some tooling (notably older webpack configurations and a handful of
Node CLIs that introspect a package's metadata) imports `<package>/package.json`
directly. With a strict `exports` map and no `"./package.json"` entry, that
import fails. `publint` will sometimes flag this depending on its rule set.
**Fix:** Add a self-export:
```json
"exports": {
  ".": { "...": "..." },
  "./package.json": "./package.json"
}
```

### IN-02: encoder's documented "rounding" behaviour is not exercised by a test

**File:** `src/ftms/indoor-bike-data.ts:34-35`, `test/ftms/indoor-bike-data.test.ts`
**Issue:** The encoder docstring (`§5 — Wire-fractional values are rounded with
Math.round before the integer write; otherwise sensor noise like cadence = 73.3
silently truncates instead of rounding`) is load-bearing — it prevents a future
"optimisation" from swapping `Math.round` for `Math.floor` or a bitwise `| 0`
truncation. But there is no test that pins `cadence: 73.3` or `speed: 27.555` and
asserts the rounded wire byte. If someone changes `Math.round` to `Math.trunc`,
all five existing fixtures still pass (they use values that round and truncate
to the same integer).
**Fix:** Add a test case to the round-trip suite:
```ts
{ name: 'cadence rounds half-up', power: 100, cadence: 73.3 },
// 73.3 / 0.5 = 146.6 → round = 147 → decode = 73.5 (NOT 73.0 as truncation would yield)
```
And assert `decoded.cadence === 73.5`. Same for a non-integer speed.

### IN-03: decoder fixture's "rejection" docstring overstates the behaviour

**File:** `test/fixtures/ftms-decoder.ts:60-66`
**Issue:** The docstring says "a payload exercising other flag bits will be
rejected by the required-fields check at the bottom because we won't reach the
cadence/power offsets." That is misleading: the decoder simply reads
cadence/power at *whatever offset it has accumulated*. If the input payload
declares (e.g.) bit 1 (Average Speed) present, the decoder will silently misread
the next two bytes as cadence — there's no rejection, just a wrong number. Since
this is a test-only artefact and the encoder never produces such payloads, it's
not a runtime bug, but the comment misleads anyone trying to extend the decoder.
**Fix:** Replace the comment with the truth:
```
// Phase 1 supports Speed/Cadence/Power only. The decoder does not validate
// other flag bits; passing a payload with bit 1, 3, 4, etc. set will silently
// misalign cadence/power reads. Extend FIELDS-style awareness here when other
// flag bits enter scope.
```
Or, more defensively, throw when any flag bit other than 0/2/6 is set.

### IN-04: `tsconfig.json` `target: ES2023` vs. `tsup` `target: node24`

**File:** `tsconfig.json:3-4`, `tsup.config.ts:18`
**Issue:** `tsconfig.json` targets `ES2023` (so emitted `.d.ts` and any
intermediate `.js` reference `ES2023` lib types) while `tsup` builds for
`node24`. Node 24 supports a strictly larger language set than ES2023 (e.g.,
some ES2024 features), so this is forwards-compatible — but it means `tsc`
typechecking will not flag a use of `Promise.withResolvers` or other
ES2024-only APIs that `tsup` would happily emit. For Phase 1 this is a non-issue
(the encoder uses no modern syntax), but it's a latent inconsistency to fix
before Phase 3 lands timer/replay code.
**Fix:** Either bump `tsconfig.json` `target` to `ES2024` and `lib` to `["ES2024"]`,
or pin `tsup` `target` to `node22` (the more conservative match). Document
whichever you pick in CONTEXT.md.

---

_Reviewed: 2026-05-14T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
