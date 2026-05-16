# Phase 3: Replay Engine - Pattern Map

**Mapped:** 2026-05-16
**Files analyzed:** 8 (3 src + 5 test)
**Analogs found:** 8 / 8

## File Classification

| New File | Role | Data Flow | Closest Analog | Match Quality |
|----------|------|-----------|----------------|---------------|
| `src/replay/scheduler.ts` | service (pure async fn) | event-driven (timer-driven emit loop) | `src/fit/normalize.ts` (pure-fn module shape) + `src/fit/loader.ts` (D-FIT-08 internal seam pattern, sync-callback adapter) | role-match (no async-fn-with-loop analog yet) |
| `src/replay/replay.ts` | service (stateful class) | event-driven (start/stop lifecycle, single-subscriber dispatch) | `src/ftms/indoor-bike-data.ts` (vendored-module module-doc style) + `src/fit/loader.ts` (lifecycle-with-internal-state file shape) | role-match (no class analog exists yet — flagged) |
| `src/replay/types.ts` | model (interface-only) | n/a | `src/types.ts` | exact |
| `test/replay/scheduler.test.ts` | test (unit, fake-timer) | request-response | `test/fit/normalize.test.ts` (pure-fn unit tests, group-by-decision structure) | exact |
| `test/replay/replay.test.ts` | test (unit, fake-timer) | request-response | `test/fit/normalize.test.ts` + `test/ftms/indoor-bike-data.test.ts` (per-decision groups; named-export imports from `.js`) | exact |
| `test/replay/abort.test.ts` | test (unit, fake-timer) | request-response | `test/fit/normalize.test.ts` | exact |
| `test/replay/loop.test.ts` | test (unit, fake-timer) | request-response | `test/fit/normalize.test.ts` | exact |
| `test/replay/soak-proxy.test.ts` and `test/replay/soak.test.ts` | test (real-clock perf gate / soak) | request-response | `test/fit/perf.test.ts` (real-clock perf gate, `performance.now()`-bracketed iterations, `console.log` diagnostic, `describe.skipIf` from `test/fit/local.test.ts`) | exact |

## Pattern Assignments

### `src/replay/types.ts` (model, interface-only)

**Analog:** `src/types.ts`

**Module-doc + decision-reference header pattern** (`src/types.ts` lines 1–19) — copy this shape verbatim, swap `RideRecord` → `ReplayConfig` / `ReplayState`, swap D-FIT-* refs → D-REPL-* refs:

```typescript
/**
 * Shared types for trainer-sim. Phase 2 introduces `RideRecord` — the contract
 * Phase 3 (replay engine) iterates over and Phase 4 (FakeTransport) consumes.
 * Future phases (Phase 4 `ITrainerTransport`, library-wide `Config`) extend
 * this file rather than scattering types across modules.
 *
 * Locked decisions:
 *   - D-FIT-01 (.planning/phases/02-fit-loader-normalization/02-CONTEXT.md):
 *     `RideRecord` shape is `{ timestamp: number; power?: number; cadence?: number }`.
 *     ...
 */
```

**Interface JSDoc style** (`src/types.ts` lines 21–46) — every field carries a JSDoc block that references the locking decision and explains the wire-level rationale:

```typescript
/**
 * One sample from a parsed FIT ride file. The replay engine emits these to
 * subscribers in timestamp order; the FTMS encoder turns them into wire bytes.
 */
export interface RideRecord {
  /**
   * Unix epoch milliseconds (NOT FIT epoch — the 1989-12-31 UTC offset has
   * been applied by the loader). FIT-03.
   */
  timestamp: number;
  ...
}
```

**Apply to Phase 3:** `ReplayConfig` and `ReplayState` interfaces, each field with a JSDoc block citing D-REPL-04 / D-REPL-05 / D-REPL-09 etc. Internal-only — D-REPL-12 forbids `src/index.ts` re-export.

**Note on internal-only types:** `src/types.ts` IS exported from `src/index.ts` (`src/index.ts` line 15: `export type { RideRecord } from './types.js';`). Phase 3's `src/replay/types.ts` is the OPPOSITE — internal-only. This means: **same JSDoc/header structure, but no public-API export**. The "internal seam" rationale should appear in the module doc (mirror `src/fit/loader.ts` line 142 "Intentionally NOT exported — D-FIT-08 internal seam.").

---

### `src/replay/scheduler.ts` (service, pure async function)

**Analog:** `src/fit/normalize.ts` (closest pure-function module shape) + `src/fit/loader.ts` (for the `node:` built-in import + `debuglog` namespace pattern)

**Module-header convention** (`src/fit/normalize.ts` lines 1–32) — comment block at the top of the file with `Implements (per CONTEXT.md):` then a bulleted list of D-* decision IDs and their behaviors:

```typescript
// Pure function from the parser's parsed-record output to `RideRecord[]`.
//
// Implements (per .planning/phases/02-fit-loader-normalization/02-CONTEXT.md):
//   - D-FIT-01: `undefined` is preserved as `undefined` (omitted property),
//     `0` is preserved as `0`. Wire-level distinction between "no signal" and
//     "rider coasting" stays intact end-to-end (Phase 1's encoder gates the
//     FTMS flag bit on `value === undefined`).
//   - D-FIT-02: autopause gaps are NOT backfilled — emitted as-recorded so
//     Phase 3's scheduler owns the gap policy.
//   ...
```

**Apply to Phase 3:** identical header style citing D-REPL-01 (setTimeout chain), D-REPL-02 (per-tick recalibration), D-REPL-03 (`performance.now()`), D-REPL-04 (Infinity + cap), D-REPL-06 (loop re-base).

**Imports — `node:` built-ins + `.js`-extension on relative imports** (`src/fit/normalize.ts` lines 33–34, `src/fit/loader.ts` lines 18–24):

```typescript
import { debuglog } from 'node:util';
import type { RideRecord } from '../types.js';
```

For Phase 3:
```typescript
import { setTimeout as sleep } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';     // OR use globalThis.performance — see Pitfall 6 in 03-RESEARCH
import { debuglog } from 'node:util';
import type { RideRecord } from '../types.js';
import type { ReplayConfig } from './types.js';
```

**`debuglog` namespace convention** (`src/fit/normalize.ts` line 36, `src/fit/loader.ts` line 33):

```typescript
const log = debuglog('trainer-sim:fit');
```

**Apply to Phase 3:** bump namespace to `'trainer-sim:replay'` (CONTEXT.md `<code_context>` lines 109–110: "reuse the same `debuglog` namespace bumped to `'trainer-sim:replay'`"):

```typescript
const log = debuglog('trainer-sim:replay');
```

**Compile-time-only internal interface** (`src/fit/normalize.ts` lines 38–48 + `src/fit/loader.ts` lines 138–166) — internal seams declared as TS-only `interface`s, NOT runtime classes:

```typescript
/**
 * Minimal compile-time-only contract for parser output. Loader passes the full
 * parser result; normalize consumes only `records`.
 */
interface ParsedFitMinimal {
  records?: ReadonlyArray<{
    timestamp?: Date;
    power?: number;
    cadence?: number;
  }>;
}
```

**Apply to Phase 3:** `interface SchedulerInput { ... emit, getNow, signal ... }` (per 03-RESEARCH §Drift correction code sketch lines 238–246) — interface stays in `scheduler.ts`, not in `types.ts`, because `SchedulerInput` is a function signature, not a public-shape type.

**Pure-function export — named, not default** (`src/fit/normalize.ts` line 54):

```typescript
export function normalize(parsed: ParsedFitMinimal): RideRecord[] {
```

**Apply to Phase 3:**
```typescript
export async function runScheduler(input: SchedulerInput): Promise<void> {
```

**`!`-postfix index access (driven by `noUncheckedIndexedAccess` in tsconfig)** (`src/fit/normalize.ts` lines 75, 88; `src/fit/loader.ts` lines 66–71):

```typescript
if (mapped[i]!.timestamp < mapped[i - 1]!.timestamp) outOfOrder++;
```

**Apply to Phase 3:** every `records[cursor]!.timestamp` and `records[0]!.timestamp` in the scheduler loop body needs `!`. Already shown in the 03-RESEARCH code sketch at line 251–256.

**Step-numbered comments inside long functions** (`src/fit/normalize.ts` lines 60, 71, 78, 84, 96 — `// Step 1 — Map.`, `// Step 2 — Count out-of-order BEFORE sorting`, etc.):

```typescript
// Step 1 — Map. Skip records without a timestamp defensively ...
const mapped: RideRecord[] = [];
for (const rec of records) { ... }

// Step 2 — Count out-of-order BEFORE sorting (each adjacent inversion is one
// out-of-order record). This is the count we surface via debuglog.
let outOfOrder = 0;
```

**Apply to Phase 3:** numbered steps inside `runScheduler` for: (1) compute baseline + minIntervalMs + firstTs, (2) loop body — compute target + delay, (3) sleep with signal, (4) emit + advance cursor, (5) loop boundary re-base.

**Conditional `debuglog` emit — only when something noteworthy happened** (`src/fit/normalize.ts` lines 99–107):

```typescript
if (outOfOrder + duplicates > 0) {
  log(
    'normalize: %d duplicates dropped, %d out-of-order records reordered (input %d -> output %d)',
    duplicates, outOfOrder, mapped.length, final.length,
  );
}
```

**Apply to Phase 3:** debuglog drift warnings and cap-throttle events conditionally — only when delay was clamped to `minIntervalMs` for >N consecutive ticks, or end-time drift exceeded a soft threshold. Keep the log shape (printf-style with `%d` placeholders).

---

### `src/replay/replay.ts` (service, stateful class)

**No class analog yet exists in this codebase.** Flag this for the planner: every existing `src/` file is either a pure function (`normalize`, `crc16Arc`, `encodeIndoorBikeData`), a sync/async entry-point function (`loadFitFromBuffer`, `loadFitFromPath`), or a frozen-table constant (`FIELDS`, `CRC_TABLE`, `SHADOWED_STANDARD_FIELD_NAMES`). The closest patterns to copy:

**Module-doc comment style** (`src/ftms/indoor-bike-data.ts` lines 1–45) — long header block with **Spec authority**, **Encoding traps addressed** (numbered §1..§5 references), and **References** (planning-doc paths). Use this shape because Replay is the first long-lived stateful surface in the codebase and deserves the same up-front rigor:

```typescript
/**
 * FTMS IndoorBikeData (0x2AD2) encoder — vendored under PROJECT.md "Vendor the
 * FTMS encoder for v1" key decision. Intended to extract cleanly to
 * `@veloworld/ftms-codec` in v2; therefore this module imports nothing from
 * elsewhere in the project (no config, no logger, no shared utils). The only
 * external API touched is `node:buffer`.
 *
 * Spec authority:
 *   Bluetooth SIG Fitness Machine Service v1.0.1 §4.9 ...
 *
 * Encoding traps addressed (see .planning/research/PITFALLS.md):
 *   §1 — Bit 0 ("More Data") is INVERTED: 0 = speed PRESENT, 1 = NOT PRESENT.
 *        Implemented in `buildFlags` per CONTEXT.md D-05; ...
 *   §2 — InstantaneousPower is sint16 ...
 *   ...
 *
 * References:
 *   - .planning/phases/01-vendored-ftms-codec/01-CONTEXT.md
 *       D-04 (record shape), D-05 (bit-0 inversion verbatim), ...
 */
```

**Apply to Phase 3:** module doc with **Lifecycle** (start → running → done | aborted), **Pitfalls addressed** (cross-ref 03-RESEARCH §Common Pitfalls 1–10 by number), **References** (D-REPL-08, D-REPL-09, D-REPL-11, D-REPL-13).

**Single-import-only-from-our-surface convention** (`src/ftms/indoor-bike-data.ts` line 47 — only `import { Buffer } from 'node:buffer';` plus its own type below; no cross-module imports):

```typescript
import { Buffer } from 'node:buffer';
```

This module is built to "extract cleanly to `@veloworld/ftms-codec` in v2" — same future-extraction concern applies to `src/replay/replay.ts` (CONTEXT.md `<integration_points>` mentions Phase 4 + v2 BlenoTransport reuse).

**Apply to Phase 3:**
```typescript
import { runScheduler } from './scheduler.js';
import type { ReplayConfig } from './types.js';
import type { RideRecord } from '../types.js';
```

No imports from `src/fit/*` or `src/ftms/*` — Replay is parser-and-encoder-agnostic.

**Internal-state declared with explicit types + JSDoc** (`src/fit/loader.ts` lines 35–53 — `SHADOWED_STANDARD_FIELD_NAMES`, `CRC_TABLE` declared as module-level state with JSDoc explaining provenance):

```typescript
/**
 * Standard `record`-message field names we surface a debuglog for when a
 * developer-defined field collides. ...
 */
const SHADOWED_STANDARD_FIELD_NAMES = new Set(['power', 'cadence', 'timestamp']);
```

**Apply to Phase 3:** the Replay class' private fields (`subscriber`, `controller`, `completedDeferred`) get a one-line JSDoc each, citing the D-REPL-* that locks the behavior:

```typescript
/** D-REPL-11 — single subscriber slot. Phase 4 wraps for fan-out. */
private subscriber: ((r: RideRecord) => void) | undefined;
/** D-REPL-09 — internal AbortController. `stop()` calls .abort(). */
private controller: AbortController | undefined;
```

**Class skeleton structure** (no internal analog) — copy from 03-RESEARCH §Pattern: Replay class wrapping the scheduler (lines 477–525). Adapt to use `Promise.withResolvers()` (Node 22+ — verified in 03-RESEARCH §Don't Hand-Roll line 566) instead of the `withDeferred` helper.

**Named exports only, no default** (`src/index.ts` lines 3–22, every src/* file uses `export class`/`export function`/`export type`/`export const`, never `export default`):

```typescript
// src/index.ts
export { encodeIndoorBikeData } from './ftms/indoor-bike-data.js';
export type { IndoorBikeRecord } from './ftms/indoor-bike-data.js';
export { loadFitFromPath, loadFitFromBuffer } from './fit/loader.js';
export type { RideRecord } from './types.js';
```

**Apply to Phase 3:** `export class Replay { ... }` from `src/replay/replay.ts`. NO addition to `src/index.ts` — D-REPL-12 forbids it. Plan acceptance criteria should grep `src/index.ts` for the absence of the string `'./replay/'`.

---

### `test/replay/scheduler.test.ts` (test, unit, fake-timer)

**Analog:** `test/fit/normalize.test.ts`

**Test-file header — purpose + decisions exercised + import boundary** (`test/fit/normalize.test.ts` lines 1–30):

```typescript
// Phase 2 Plan 02-05 Task 1 — unit tests for the pure `normalize` function.
//
// SUT: src/fit/normalize.ts (built in plan 02-03 task 1).
// Direct unit-test import is acceptable here (NOT public-surface) because:
//   - normalize is a pure function with a well-defined input/output contract ...
//
// Locked decisions exercised:
//   - FIT-02 (sort + dedup keep-first; time-ordered output).
//   - FIT-03 (FIT timestamp -> Unix epoch ms via Date.getTime()).
//   - D-FIT-01 (wire-honest: real `0` preserved; ...).
//   ...
```

**Apply to Phase 3:** identical shape — list REPL-01..REPL-06 + the D-REPL-* exercised, AND state explicitly that Phase 3 tests import directly from `../../src/replay/scheduler.js` (NOT through `../../src/index.js`) because Phase 3 adds nothing to the public surface (D-REPL-12). This mirrors the `normalize.test.ts` rationale verbatim.

**Vitest 4 imports** (`test/fit/normalize.test.ts` line 31):

```typescript
import { describe, it, expect } from 'vitest';
```

For Phase 3 fake-timer tests, add `vi`, `beforeEach`, `afterEach`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
```

**`.js`-extension on test imports** (`test/fit/normalize.test.ts` line 34, `test/fit/loader.test.ts` line 37):

```typescript
import { normalize } from '../../src/fit/normalize.js';
```

For Phase 3:
```typescript
import { runScheduler } from '../../src/replay/scheduler.js';
import type { RideRecord } from '../../src/types.js';
```

**Group-by-decision describe blocks** (`test/fit/normalize.test.ts` lines 42, 66, 117, 196, 232 — `describe('Group N — D-FIT-XX: <behavior>', () => { ... })`):

```typescript
describe('normalize() — pure function unit tests', () => {
  describe('Group 1 — FIT-03: Date -> Unix epoch ms via getTime()', () => {
    it('returns timestamp as a JS number ...', () => { ... });
    ...
  });
  describe('Group 2 — D-FIT-01: wire-honest power/cadence semantics', () => { ... });
  ...
});
```

**Apply to Phase 3:** `describe('runScheduler — fake-timer drift correction', () => { describe('Group 1 — D-REPL-02: per-tick recalibration', () => { ... }); ... })`. Group numbering and the "D-REPL-XX: <behavior>" string in the group title are the canonical convention.

**`vi.useFakeTimers()` setup/teardown** (no codebase analog — but 03-RESEARCH §Vitest fake-timer interaction recipe lines 372–377 is the canonical sketch and should be copied verbatim):

```typescript
beforeEach(() => {
  vi.useFakeTimers();   // fakes setTimeout AND performance.now()
});
afterEach(() => {
  vi.useRealTimers();
});
```

**`expect(...).toBe(...)` / `expect(...).toEqual(...)` / `expect(...).toHaveLength(...)` style** (`test/fit/normalize.test.ts` lines 49, 56, 81, 127):

```typescript
expect(result).toHaveLength(1);
expect(typeof result[0]!.timestamp).toBe('number');
expect(result[0]!.power).toBe(0);
expect(result).toEqual([]);
```

`!`-postfix on test array access too (driven by tsconfig.test.json strictness, which inherits the same `noUncheckedIndexedAccess`).

---

### `test/replay/replay.test.ts` (test, unit, fake-timer)

Same patterns as `scheduler.test.ts`. Additional pattern from `test/ftms/indoor-bike-data.test.ts`:

**Helper functions defined inside the test file** (`test/ftms/indoor-bike-data.test.ts` lines 47–49):

```typescript
function bytesOf(view: DataView): Uint8Array {
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
}
```

**Apply to Phase 3:** if `replay.test.ts` repeatedly constructs a 5-record `RideRecord[]` with synthetic timestamps, define a `makeRecords(count: number, cadenceMs = 100): RideRecord[]` helper near the top of the file. Same module-local-helper style.

---

### `test/replay/abort.test.ts` and `test/replay/loop.test.ts` (test, unit, fake-timer)

Same patterns as `scheduler.test.ts`. Both files copy the structure from 03-RESEARCH §Code Examples 2 (lines 670–700 — REPL-06 abort) and §Code Examples 3 (lines 705–731 — REPL-04 loop), already in the canonical project test style.

**Pattern reminder — `vi.advanceTimersByTimeAsync()`, NOT the sync variant** (03-RESEARCH §Pitfall 5 + §Vitest fake-timer interaction recipe). This is non-obvious; every `await vi.advanceTimersByTimeAsync(ms)` call should keep the `Async` suffix in test code.

---

### `test/replay/soak-proxy.test.ts` and `test/replay/soak.test.ts` (test, real-clock perf gate)

**Analog:** `test/fit/perf.test.ts` (real-clock perf gate, mirror nearly verbatim) + `test/fit/local.test.ts` (for `describe.skipIf(...)` pattern used by `soak.test.ts`)

**File header — perf-gate rationale + methodology** (`test/fit/perf.test.ts` lines 1–24):

```typescript
/**
 * Phase 2 Plan 04 Task 4 — ROADMAP perf gate.
 *
 * ROADMAP says "<100 ms parse for typical 1-hour file" for Phase 2. This
 * test asserts a tighter <50 ms median (2x margin under the gate) so a
 * regression is caught before it eats the headroom.
 *
 * Fixture: `test/fixtures/fit/perf-1hr.fit` ...
 *
 * Methodology (RESEARCH §Code Examples Example 7):
 *   - Read the file once, outside the timed loop.
 *   - Run 3 warm-up iterations to let V8's JIT kick in.
 *   - Run 11 timed iterations; sort the times array and pick the
 *     6th element (index 5) as the median.
 *   - Console-log min / median / max so a future regression is visible
 *     in the test output even when the assertion still passes.
 *
 * NOT skipped on CI. The perf gate is part of the ROADMAP success
 * criteria. ...
 */
```

**Apply to Phase 3 `soak-proxy.test.ts`:** mirror this exactly — REPL-03 says <250 ms over 30 min; the proxy asserts <250 ms over 30 sec (scaled), with the math justifying the proxy from 03-RESEARCH §Soak Test Recommendation. Methodology section names: 3 warm-up runs, 1 timed run (don't median over 11 — soak is one shot), `console.log` of elapsed ms.

**Real-clock imports** (`test/fit/perf.test.ts` lines 26–34):

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { loadFitFromBuffer } from '../../src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = resolve(__dirname, '../fixtures/fit');
```

**Apply to Phase 3:** identical block, swap `loadFitFromBuffer` for both `loadFitFromBuffer` (to read the fixture) and the new `Replay` class — but Phase 3 imports `Replay` from `../../src/replay/replay.js` directly (NOT through `src/index.js`) because D-REPL-12 forbids public re-export.

**`performance.now()`-bracketed measurement loop** (`test/fit/perf.test.ts` lines 47–65):

```typescript
const N = 11;
const times: number[] = [];
for (let i = 0; i < N; i++) {
  const t0 = performance.now();
  loadFitFromBuffer(buf);
  times.push(performance.now() - t0);
}
times.sort((a, b) => a - b);
const median = times[Math.floor(N / 2)]!;
const min = times[0]!;
const max = times[N - 1]!;

console.log(
  `[perf gate] perf-1hr.fit parse times (ms): min=${min.toFixed(2)} ` +
    `median=${median.toFixed(2)} max=${max.toFixed(2)} (n=${N})`,
);

expect(median).toBeLessThan(50);
```

**Apply to Phase 3 `soak-proxy.test.ts`:** single-iteration variant (soak is not a median-of-N test):

```typescript
const t0 = performance.now();
const replay = new Replay({ records, speed, loop: false, maxEmissionHz: 10_000 });
replay.start();
await replay.completed;
const elapsed = performance.now() - t0;
console.log(`[soak proxy] elapsed=${elapsed.toFixed(2)}ms (target ~30000)`);
expect(elapsed).toBeGreaterThan(28_000);
expect(elapsed).toBeLessThan(32_000);
```

**`describe.skipIf(...)` env-var gate for the real soak** (`test/fit/local.test.ts` line 32):

```typescript
const dir = process.env.TEST_FIT_DIR;
describe.skipIf(!dir)('local-dev FIT smoke (TEST_FIT_DIR)', () => { ... });
```

**Apply to Phase 3 `soak.test.ts`:**
```typescript
describe.skipIf(!process.env.RUN_SOAK)('REPL-03: 30-minute real-time soak', () => { ... }, { timeout: 32 * 60 * 1000 });
```

The 03-RESEARCH §Soak test recommendation snippet (lines 454–469) already shows this pattern.

---

## Shared Patterns

### Authentication / Authorization

**Not applicable** — trainer-sim is a Node library with no auth surface.

### Error Handling

**Source:** `src/fit/errors.ts` (typed-error hierarchy with abstract base)

**Excerpt** (lines 30–48):

```typescript
export abstract class FitLoadError extends Error {
  constructor(message: string) {
    super(message);
    // Stack traces identify the concrete class (InvalidFitHeaderError, etc.)
    // rather than the generic "Error" — set in the base so subclasses stay
    // bodyless.
    this.name = this.constructor.name;
  }
}

/** Bad magic / wrong header bytes / header length not 12 or 14. */
export class InvalidFitHeaderError extends FitLoadError {}
```

**Apply to Phase 3:** Phase 3 does NOT introduce a new typed-error hierarchy. It reuses `AbortError` from `node:timers/promises` (auto-thrown by `setTimeout(delay, value, { signal })` on abort). The wrapper class re-throws this through `replay.completed.reject(err)`. Plan should NOT add a `ReplayError` base class — that's CLAUDE.md "no abstractions for hypothetical future requirements."

The `errors.ts` header note **"Future phases (replay timeouts, transport failures, etc.) follow the same `extends FitLoadError`-style pattern: an abstract base + concrete leaf classes"** is a forward-looking note from Phase 2 — it does NOT obligate Phase 3 to introduce one. D-REPL-09 + 03-RESEARCH §Open Question 2 lock the answer: Phase 3 rejects `replay.completed` with `signal.reason ?? AbortError`, no custom hierarchy.

### Validation

**Source:** `src/fit/loader.ts` (defensive input validation with typed throws)

**Excerpt** (lines 95–106):

```typescript
function validateHeaderAndCrc(buf: Uint8Array): void {
  if (buf.length < 14) {
    throw new FitTruncatedError(
      `expected >=14 bytes (12-byte header + 2-byte CRC), got ${buf.length}`,
    );
  }
  const headerLength = buf[0]!;
  if (headerLength !== 12 && headerLength !== 14) {
    throw new InvalidFitHeaderError(
      `header length must be 12 or 14, got ${headerLength}`,
    );
  }
  ...
}
```

**Apply to Phase 3:** the Replay class' `start()` should fail-fast with a plain `Error` when:
- `records.length === 0` (03-RESEARCH §Pitfall 9)
- `start()` is called twice without an intervening fresh instance (D-REPL-07 — open question, lean toward throw per 03-RESEARCH §Open Questions 1)
- `onRecord` not called before `start()` (03-RESEARCH §Pitfall 10)
- pre-aborted external signal (03-RESEARCH §Pitfall 4 — fail-fast in `start()` before constructing the scheduler Promise)

Use plain `throw new Error('...')` — no custom `ReplayError` class. The error message should name the D-REPL-* lock if the throw is decision-driven:

```typescript
if (this.subscriber === undefined) {
  throw new Error('Replay.start: onRecord must be called before start (D-REPL-11)');
}
```

This matches `src/ftms/indoor-bike-data.ts`'s implicit-validation style (no try/catch, no custom errors — the encoder simply doesn't run if input shape is wrong; TS catches most cases).

### Logging / Observability

**Source:** `src/fit/normalize.ts` + `src/fit/loader.ts` (`util.debuglog` namespace pattern)

**Excerpt** (`src/fit/normalize.ts` line 36, `src/fit/loader.ts` line 33):

```typescript
import { debuglog } from 'node:util';
const log = debuglog('trainer-sim:fit');
```

**Conditional emit** (`src/fit/normalize.ts` lines 99–107):

```typescript
if (outOfOrder + duplicates > 0) {
  log(
    'normalize: %d duplicates dropped, %d out-of-order records reordered (input %d -> output %d)',
    duplicates, outOfOrder, mapped.length, final.length,
  );
}
```

**Apply to all Phase 3 src files:** namespace bumped to `'trainer-sim:replay'` (CONTEXT.md `<code_context>`). Conditional `log(...)` emits for: cap-throttle events (when `delay` was clamped to `minIntervalMs`), drift-warning (when `target - getNow() < -50` ms — i.e., the host fell behind), loop-iteration markers if `loop: true`. Printf-style with `%d`/`%s` placeholders. NEVER `console.log` from production code — only test files (per `test/fit/perf.test.ts` line 62 `// eslint-disable-next-line no-console`).

### Module Structure

**Source:** `src/fit/loader.ts` (single-import-of-external-dep pattern)

**Excerpt** (lines 22–24):

```typescript
// THE SINGLE PARSER IMPORT IN ALL OF src/. No other src/* file may import
// this module — D-FIT-08 seam (acceptance grep enforces).
import FitParser from 'fit-file-parser';
```

**Apply to Phase 3:** `src/replay/scheduler.ts` is THE SINGLE module that imports `node:timers/promises` and (optionally) `node:perf_hooks`. `src/replay/replay.ts` does NOT import these directly — it gets `getNow` injection from the scheduler signature (03-RESEARCH §Pitfall 6 + Architecture Patterns). Phase 3's plan should add an acceptance grep mirroring D-FIT-08's enforcement:

```bash
# acceptance: only scheduler.ts imports node:timers/promises in src/
grep -rE "from 'node:timers/promises'" src/ | grep -v 'src/replay/scheduler.ts' | head -1
# expected: empty output (no other matches)
```

---

## Cross-Cutting Conventions Summary

| Convention | Source(s) | Application in Phase 3 |
|------------|-----------|------------------------|
| `.js`-extension on relative imports | `src/fit/normalize.ts:34`, `src/index.ts:14`, every test file | All Phase 3 imports: `'./scheduler.js'`, `'./types.js'`, `'../types.js'`, `'../../src/replay/scheduler.js'` |
| Named exports only (no default) | All `src/**/*.ts` and `test/**/*.ts` | `export class Replay`, `export async function runScheduler`, `export interface ReplayConfig` |
| Module-doc header citing locking decisions | `src/types.ts:1-19`, `src/fit/normalize.ts:1-32`, `src/fit/loader.ts:1-16`, `src/ftms/indoor-bike-data.ts:1-45`, `src/fit/errors.ts:1-21` | Each new src file opens with `Implements (per .planning/phases/03-replay-engine/03-CONTEXT.md):` + bulleted D-REPL-* refs |
| JSDoc with D-* requirement references on every public type member | `src/types.ts:25-46`, `src/ftms/indoor-bike-data.ts:57-79`, `src/fit/errors.ts:23-29` | Each `ReplayConfig` field carries a JSDoc block citing D-REPL-04 (speed), D-REPL-05 (maxEmissionHz), D-REPL-06 (loop) |
| `!`-postfix on all bracket-indexed access | `src/fit/normalize.ts:75`, `src/fit/loader.ts:66-71`, every test file | `records[cursor]!`, `records[0]!`, `times[Math.floor(N/2)]!` |
| `node:`-prefixed built-in imports | `src/fit/normalize.ts:33`, `src/fit/loader.ts:18-20`, `test/fit/perf.test.ts:27-30` | `'node:timers/promises'`, `'node:perf_hooks'`, `'node:util'` |
| `debuglog('trainer-sim:<phase>')` namespace per phase | `src/fit/normalize.ts:36`, `src/fit/loader.ts:33` | `debuglog('trainer-sim:replay')` (CONTEXT.md `<code_context>` lines 109-110) |
| Test imports go through `'../../src/<module>.js'` (NOT `src/index.ts`) when SUT is internal | `test/fit/normalize.test.ts:34` (with explicit rationale lines 4-10) | All Phase 3 tests import from `'../../src/replay/replay.js'` and `'../../src/replay/scheduler.js'` because D-REPL-12 keeps these internal |
| Vitest 4 `describe`/`it`/`expect`/`vi`/`beforeEach`/`afterEach` from `'vitest'` | `test/fit/normalize.test.ts:31`, `test/fit/loader.test.ts:33` | Same import line, plus `vi`/`beforeEach`/`afterEach` for fake-timer tests |
| Group-by-decision describe blocks | `test/fit/normalize.test.ts:42,66,117,196,232` | `describe('Group N — D-REPL-XX: <behavior>')` for each test file |
| `describe.skipIf(env_var_unset)` for opt-in suites | `test/fit/local.test.ts:32` | `describe.skipIf(!process.env.RUN_SOAK)` in `soak.test.ts` |
| `console.log` allowed in test files only, with `// eslint-disable-next-line no-console` | `test/fit/perf.test.ts:61-65` | Soak proxy / soak tests log elapsed ms with the same eslint comment |

---

## No Analog Found

| File / Concept | Reason | Recommended Source |
|----------------|--------|-------------------|
| Stateful class (`Replay`) | Codebase is currently 100% pure-functions + sync entry-points. No `class` keyword appears in any `src/` file. | Module-doc style from `src/ftms/indoor-bike-data.ts`; class skeleton from 03-RESEARCH §Pattern: Replay class wrapping the scheduler (lines 477–525) |
| Async function with `while(true)` loop body | Phase 2 has only sync (`normalize`, `loadFitFromBuffer`) and one shallow async (`loadFitFromPath` = `await readFile + sync delegate`) — no long-running async with internal state. | Algorithm body from 03-RESEARCH §Drift correction code sketch (lines 234–281). Style from `src/fit/normalize.ts` (step-numbered comments, `!`-postfix, `node:` imports) |
| `Promise.withResolvers()` usage | No prior usage in the codebase. | Standard TC39 stage-4 API; 03-RESEARCH §Don't Hand-Roll line 566 confirms Node 22+ availability |
| `AbortController` / `AbortSignal` usage | No prior usage in the codebase. | Standard Node API; 03-RESEARCH §Code Examples 2 (REPL-06 cancellation test) is the canonical Phase 3 reference |
| `vi.useFakeTimers()` test setup | No prior usage — Phase 1 + Phase 2 tests are all real-clock. | 03-RESEARCH §Vitest fake-timer interaction recipe (lines 360–408) is the canonical pattern; copy verbatim into the first Phase 3 test file written |

---

## Metadata

**Analog search scope:**
- `src/` — full read of `src/types.ts`, `src/index.ts`, `src/fit/normalize.ts`, `src/fit/loader.ts`, `src/fit/errors.ts`, `src/ftms/indoor-bike-data.ts`
- `test/` — full read of `test/fit/normalize.test.ts`, `test/fit/perf.test.ts`, partial of `test/fit/loader.test.ts`, `test/fit/error-paths.test.ts`, `test/fit/local.test.ts`, `test/ftms/indoor-bike-data.test.ts`
- `package.json` (vitest 4.1.6, tsup 8.5.1, tsx 4.21.0, typescript 5.9.3, Node >=24 confirmed)

**Files scanned:** 14
**Pattern extraction date:** 2026-05-16

---

## PATTERN MAPPING COMPLETE
