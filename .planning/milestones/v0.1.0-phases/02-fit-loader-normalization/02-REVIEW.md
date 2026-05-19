---
phase: 02-fit-loader-normalization
reviewed: 2026-05-16T00:00:00Z
depth: standard
files_reviewed: 14
files_reviewed_list:
  - src/fit/errors.ts
  - src/fit/loader.ts
  - src/fit/normalize.ts
  - src/index.ts
  - src/types.ts
  - test/fit/dev-field-shadow.test.ts
  - test/fit/error-paths.test.ts
  - test/fit/loader.test.ts
  - test/fit/local.test.ts
  - test/fit/normalize.test.ts
  - test/fit/perf.test.ts
  - test/fixtures/generate-shadow.ts
  - test/fixtures/minimal-fit-bytes.ts
  - test/fixtures/scrub.ts
findings:
  critical: 0
  blocker: 0
  warning: 5
  info: 6
  total: 11
status: issues_found
---

# Phase 02 Code Review

**Reviewed:** 2026-05-16
**Depth:** standard
**Files Reviewed:** 14
**Status:** issues_found

## Summary

The implementation is mostly solid: clear separation between `loader.ts` (I/O + dependency-wrapped parser) and `normalize.ts` (pure mapping), a typed-error hierarchy that satisfies D-FIT-06, the mandated single parser import, and tests that cover the locked decisions (D-FIT-01..03, D-FIT-09, D-FIT-10) directly.

That said, the loader contains two concrete defects that affect either error fidelity or the CI's ability to surface debug output, plus several quality issues:

1. `validateHeaderAndCrc` reads `dataLength` with signed 32-bit arithmetic — for the high-bit case this produces a negative `totalExpected`, defeating the truncation guard and routing the failure through `FitCrcError` instead of `FitTruncatedError`. `scrub.ts` already uses the unsigned form (`>>> 0`); the loader does not. (WR-01)
2. Two of the test suites assume `npx tsx` is on PATH and runnable without network access during `npm test`. CI environments that disable npx/network or that haven't pre-cached `tsx` will silently fail the very assertions that validate D-FIT-09 and D-FIT-10's debuglog contract. (WR-02)
3. `normalize` silently drops every record whose `timestamp` is missing/falsy and never reports the count, despite D-FIT-09 stating "drop / reorder counts surface only via debuglog" — the no-timestamp drop is a third drop class that escapes both the debuglog AND the `NoRecordMessagesError` path (the loader checks `parsed.records.length === 0` BEFORE normalize, not the post-normalize array length). (WR-03)

The remaining warnings and info items are smaller issues: an `else if` branch that ignores secondary parser callbacks, duplicated CRC-16 implementations across three files, and a couple of comment-vs-code drifts.

## Warnings

### WR-01: Signed-shift bug on `dataLength` defeats the truncation check for ≥2 GB or corrupted-length FITs

**File:** `src/fit/loader.ts:115-118`
**Issue:**
```ts
const dataLength =
  buf[4]! | (buf[5]! << 8) | (buf[6]! << 16) | (buf[7]! << 24);
const totalExpected = headerLength + dataLength + 2;
if (buf.length < totalExpected) {
  throw new FitTruncatedError(...);
}
```
JavaScript bitwise operators produce signed 32-bit results. Any byte with its high bit set in `buf[7]` (i.e. `dataLength >= 0x80000000`) makes `dataLength` negative, which makes `totalExpected` negative, which makes the `buf.length < totalExpected` guard always false. Execution falls through to `crcStart = headerLength + dataLength` (also negative), `buf[crcStart]!` returns `undefined`, the `!` assertion lies, the bitwise expression coerces `undefined` to `0`, and the eventual `crcActual !== crcExpected` raises **`FitCrcError`** for what is really an invalid header / truncation. The companion file `test/fixtures/scrub.ts:151` reads the same field correctly with `>>> 0`. The loader was clearly meant to do the same.

**Why this matters even though no real FIT file has a ≥2 GB body:** The path is reachable on **deliberately malformed input** (an attacker-controlled FIT with `data_length = 0xFFFFFFFF`) and on accidentally-corrupted bytes. D-FIT-06's contract is precise typed errors, and this bug routes a class of corruption to the wrong typed error.

**Fix:**
```ts
const dataLength =
  (buf[4]! | (buf[5]! << 8) | (buf[6]! << 16) | (buf[7]! << 24)) >>> 0;
```
Then add an explicit upper-bound sanity check (e.g. `dataLength > 0x10_000_000`) that throws `InvalidFitHeaderError` so corruption presents as a header error rather than a truncation error.

---

### WR-02: Subprocess tests rely on `npx tsx` being resolvable from PATH inside `npm test`

**File:** `test/fit/dev-field-shadow.test.ts:75-78`, `test/fit/normalize.test.ts:204-219`
**Issue:** Both tests do:
```ts
const result = spawnSync('npx', ['tsx', '-e', program], {
  env: { ...process.env, NODE_DEBUG: 'trainer-sim:fit' },
  encoding: 'utf8',
});
expect(result.status).toBe(0);
```
On any environment where:
- `npx` is missing (unlikely),
- `npm test` is run with `npm_config_offline=true` and the cache lacks `tsx`,
- the test runner sandbox restricts spawning child processes,
- a CI image lacks the network for npx's first-run install of `tsx`,

`spawnSync` will return a non-zero status (or fail to launch entirely; `result.status === null` is the spawn-failure case), which is asserted to equal 0 with no diagnostic. Worse: if `result.error` is set (ENOENT), the existing assertions still claim a clean failure mode but the user gets `expected null to be 0`.

A second concern: there is no assertion that `result.error === undefined` before checking `result.status`. A spawn error masquerades as `status === null`, which fails the `.toBe(0)` check but with a misleading message ("expected null to be 0" rather than "tsx could not be spawned").

**Fix:** Resolve the local `tsx` binary via `node:module.createRequire`/`require.resolve` and invoke it with `process.execPath`, or use `npx --no-install tsx` to fail fast when `tsx` is not pre-cached:
```ts
const result = spawnSync('npx', ['--no-install', 'tsx', '-e', program], { ... });
if (result.error) throw result.error;
expect(result.status).toBe(0);
```
This guarantees the tests fail with "tsx not installed" rather than a misleading status assertion. Alternatively, mock `util.debuglog` in-process (vitest's `vi.stubEnv` + module re-import) and skip the subprocess entirely.

---

### WR-03: `normalize` silently drops records with missing timestamps and emits NO debuglog

**File:** `src/fit/normalize.ts:62-69, 99-107`
**Issue:** The mapping step skips any record without a `timestamp`:
```ts
for (const rec of records) {
  if (!rec.timestamp) continue;
  ...
}
```
The debuglog at lines 99-107 surfaces `duplicates` and `outOfOrder` counts but **NOT** the no-timestamp drop count. D-FIT-09 says:
> drop / reorder counts surface only via util.debuglog
This drop class isn't even counted. Worse, the loader only checks `parsed.records.length === 0` (loader.ts:249) BEFORE normalize. A FIT file with 500 records but every record missing a `timestamp` field would pass the loader's NoRecordMessagesError check, hit normalize, return `[]`, and the public API hands back an empty array with **no error and no debuglog**. Phase 3's replay engine would see an empty stream and emit nothing.

**Fix:** Either (a) count and debuglog timestamp drops separately, or (b) move the `length === 0` check to AFTER normalize so silent-empty post-normalize is still surfaced as `NoRecordMessagesError`:
```ts
// In loader.ts, after normalize():
const result = normalize(parsed);
if (result.length === 0) {
  throw new NoRecordMessagesError(
    'FIT file has records but none could be normalized (all missing timestamp)',
  );
}
return result;
```
Option (b) is the safer of the two — it converts a silent-data-loss failure into a typed error.

---

### WR-04: Adapter callback drops parser data when an error and data both arrive

**File:** `src/fit/loader.ts:186-189`
**Issue:**
```ts
parser.parse(input, (err, data) => {
  if (err && firstError === undefined) firstError = err;
  else if (data && parsed === undefined) parsed = data as ParsedFitMinimal;
});
```
The `else if` chain means if the underlying parser ever calls the callback with **both** `err` and `data` populated (e.g. a future `force: true`-on-recovery path), the data is silently discarded. The current parser only ever calls with one or the other, so this is latent rather than active — but the `force` knob already exists in the parser API, and the comment at loader.ts:182 says `force: false` is "defense-in-depth" against future drift, yet the callback handler is not.

**Fix:** Drop the `else` so both branches run independently:
```ts
parser.parse(input, (err, data) => {
  if (err && firstError === undefined) firstError = err;
  if (data && parsed === undefined) parsed = data as ParsedFitMinimal;
});
```
Then prefer `parsed` over `firstError` when both are set (corruption-with-recovery is still a successful parse), or keep current "throw if not parsed" semantics — either way, this matches the `force: true` recovery contract the parser already supports.

---

### WR-05: CRC-16/ARC implementation duplicated across three files; drift risk

**File:** `src/fit/loader.ts:50-74`, `test/fixtures/minimal-fit-bytes.ts:28-46`, `test/fixtures/scrub.ts:40-56`
**Issue:** The same 16-entry CRC table and the same `crc16Arc` loop appear verbatim in:
- `src/fit/loader.ts:50-74` (production loader),
- `test/fixtures/minimal-fit-bytes.ts:28-46` (committed fixture writer, used by error-paths.test.ts),
- `test/fixtures/scrub.ts:40-56` (one-shot scrubber).

`minimal-fit-bytes.ts` already exports `CRC16_ARC_TABLE` and `crc16Arc` — the loader and scrubber should import from there, OR the loader should expose its CRC primitive as `internal/` to be shared with the fixtures. Three independent copies guarantees one will eventually diverge and one of the test suites will pass for the wrong reason. The header comment in `minimal-fit-bytes.ts:11-13` already calls this out as the failure mode the file was designed to prevent — but the loader was not migrated onto it.

The constraint here is real: **`src/` cannot import from `test/`**, so the shared module would have to live under `src/` and the test fixtures import from it. That's a small scope expansion of D-FIT-08's "single parser import" contract but keeps it consistent.

**Fix:** Either hoist the CRC primitive into `src/fit/_crc.ts` (internal, not re-exported from `src/index.ts`) and have both `src/fit/loader.ts` and the test-fixture files import it, OR add a CI grep that asserts the table bytes appear in only one source file.

## Info

### IN-01: `outOfOrder` count metric does not match its documentation

**File:** `src/fit/normalize.ts:73-76`
**Issue:** The comment at line 71-72 calls each adjacent inversion "one out-of-order record" but the count is *number of adjacent inversions*, which is not the same as *number of records out of place* (e.g. `[3,1,2]` has 1 adjacent inversion but 2 displaced records). The debuglog at line 102 says "out-of-order records reordered" — that wording is misleading.
**Fix:** Either rename the variable to `inversions` and update the debuglog wording, or compute the actual displaced count.

---

### IN-02: `String.fromCharCode` magic check accepts surrogate-pair bytes

**File:** `src/fit/loader.ts:108`
**Issue:**
```ts
const magic = String.fromCharCode(buf[8]!, buf[9]!, buf[10]!, buf[11]!);
if (magic !== '.FIT') ...
```
This works correctly for `[0x2E, 0x46, 0x49, 0x54]` but is a brittle pattern — for any bytes ≥ 0x80 the string contains lone surrogates which are valid JS strings but represent garbage. For an error message that interpolates `${magic}`, this can produce the replacement character. Using `Buffer.compare` or a byte-literal check is more precise and produces a cleaner error message.
**Fix:**
```ts
const expected = Buffer.from([0x2e, 0x46, 0x49, 0x54]);
if (!expected.equals(buf.subarray(8, 12))) {
  throw new InvalidFitHeaderError(
    `magic mismatch: expected '.FIT', got bytes ${[...buf.subarray(8, 12)].map((b) => b.toString(16)).join(' ')}`,
  );
}
```

---

### IN-03: `local.test.ts` describe body executes setup logic even when skipped

**File:** `test/fit/local.test.ts:32-79`
**Issue:** `describe.skipIf(!dir)` does not prevent the body from executing — it only marks tests inside as skipped. When `TEST_FIT_DIR` is unset, the `try { statSync(dir!) ... }` block still runs with `dir!` evaluating to `undefined`. `statSync(undefined)` throws synchronously, the catch swallows it into `enumerationError`, and the resulting test definition is ultimately skipped. The result is correct (silent skip) but only by coincidence — the comment at line 31 reads "When the suite skips, vitest reports it cleanly without noise" but doesn't acknowledge that `statSync(undefined)` is happening every time the suite is loaded, even on CI.
**Fix:** Wrap the entire enumeration block in `if (dir)` so it only runs when the env var is present:
```ts
if (dir) {
  // existing try/catch + describe.skipIf(false)
} else {
  describe.skip('local-dev FIT smoke (TEST_FIT_DIR)', () => {
    it('TEST_FIT_DIR not set; suite skipped', () => {});
  });
}
```

---

### IN-04: `generate-shadow.ts` resolves output path relative to CWD without enforcement

**File:** `test/fixtures/generate-shadow.ts:220`
**Issue:**
```ts
const outDir = resolve('test/fixtures/fit');
```
`resolve('test/fixtures/fit')` is `path.resolve(process.cwd(), 'test/fixtures/fit')`. The header comment instructs "Run: npx tsx test/fixtures/generate-shadow.ts" with the implicit assumption that cwd is the repo root. Run from any other directory and the file lands in the wrong place. Since this is a one-shot dev script the impact is low, but a guard avoids a foot-gun.
**Fix:** Resolve relative to `import.meta.url`:
```ts
const __filename = fileURLToPath(import.meta.url);
const outDir = resolve(dirname(__filename), 'fit');
```

---

### IN-05: `SHADOWED_STANDARD_FIELD_NAMES` includes `cadence` / `timestamp` that will never trigger

**File:** `src/fit/loader.ts:43`
**Issue:** The set has three names: `power`, `cadence`, `timestamp`. The comment explains `cadence` and `timestamp` are "speculative coverage for future widening." Including names that will not produce useful output today increases the chance of a confusing debuglog message in real-world FIT files (a developer field named "cadence" today has no effect on `RideRecord` because the parser only collides onto `record.cadence` — but the debuglog says "fit-file-parser collides developer value onto record.%s" which will be an accurate but misleading statement).
**Fix:** Either (a) trim the set to `['power']` until cadence/timestamp shadow handling is actually wired through, or (b) clarify the debuglog message to distinguish "we surface this for visibility" from "this affects the loader's output today."

---

### IN-06: `firstError` typed as `string | undefined` but parser err type is unknown

**File:** `src/fit/loader.ts:184, 194`
**Issue:**
```ts
let firstError: string | undefined;
...
parser.parse(input, (err, data) => {
  if (err && firstError === undefined) firstError = err;
  ...
});
...
throw new FitTruncatedError(
  `fit-file-parser rejected the input: ${firstError ?? 'unknown error'}`,
);
```
The fit-file-parser's callback signature is `(error: string | undefined, data: any | undefined)` per `dist/fit-parser.d.ts`, so this happens to work. But there is no compile-time tie between the parser's emitted shape and `firstError`'s type — a future parser version that emits `Error` objects rather than strings would silently produce `[object Object]` in the message.
**Fix:** Type defensively:
```ts
let firstError: unknown;
...
const msg = firstError instanceof Error
  ? firstError.message
  : typeof firstError === 'string'
    ? firstError
    : 'unknown error';
throw new FitTruncatedError(`fit-file-parser rejected the input: ${msg}`);
```

---

_Reviewed: 2026-05-16_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
