---
phase: 05-veloworld-end-to-end-validation
reviewed: 2026-05-19T00:00:00Z
depth: standard
files_reviewed: 18
files_reviewed_list:
  - .gitignore
  - package.json
  - src/_internal/debuglog.browser.ts
  - src/_internal/debuglog.ts
  - src/_internal/event-emitter.browser.ts
  - src/_internal/event-emitter.ts
  - src/_internal/read-file.browser.ts
  - src/_internal/read-file.ts
  - src/_internal/sleep.browser.ts
  - src/_internal/sleep.ts
  - src/fit/loader.ts
  - src/fit/normalize.ts
  - src/ftms/indoor-bike-data.ts
  - src/replay/scheduler.ts
  - src/transport/fake-transport.ts
  - src/types.ts
  - test/transport/publish.test.ts
  - tsup.config.ts
findings:
  critical: 0
  warning: 5
  info: 6
  total: 11
status: issues_found
---

# Phase 5: Code Review Report

**Reviewed:** 2026-05-19
**Depth:** standard
**Files Reviewed:** 18
**Status:** issues_found

## Summary

Phase 5's dual-build (Node + browser) shim layer is well-structured: every Node-builtin import is funnelled through `src/_internal/*` so a tsup esbuild plugin can swap in browser variants. Wire-format invariants for FTMS encoding are preserved; the AbortSignal contract for the browser sleep shim is honored; the EventEmitter shim is small and correct for the dispatch case it covers.

However, the review found **five WARNING-class issues** worth addressing before this surface is treated as a stable v1 export to VeloWorld:

1. The Buffer→DataView migration in `indoor-bike-data.ts` silently lost runtime range-checking on `power`. `Buffer.writeInt16LE(50_000)` threw `RangeError`; `DataView.setInt16` masks via `ToInt16` (wraps). No test covers the out-of-range case.
2. The browser `EventEmitter.once()` shim violates a real `node:events` contract — `off(event, originalListener)` cannot remove a listener registered via `once(event, originalListener)`, because the wrapper is what's stored. `node:events` exposes the original listener via `[kListener]` and removes it transparently.
3. The tsup browser-alias plugin uses `process.cwd()` to resolve `src/_internal/*.browser.ts`, which couples the build to an assumption about cwd that fails when tsup is invoked from a parent directory or via a monorepo runner.
4. Tracking `dist/` in git while removing the `prepare` lifecycle hook creates a process gap: there is no enforcement (CI, hook, or test) that the committed `dist/` is rebuilt for every source change. Stale artifacts can ship to git-ref consumers (VeloWorld) silently.
5. The two-`tsup` config relies on serial array execution and `clean: true` only on the Node entry. If tsup ever runs configs in parallel (or order is mistakenly swapped), the browser `clean: false` invariant becomes wrong and the browser bundle is deleted by the Node build.

Six INFO-class items (Node EventEmitter API drift, redundant `getNow()` calls, brittle test substring matches, narrow regex filter in the alias plugin, exports-condition CJS-browser sharp edge, sub-2KB redundant types pointer for the browser build) round out the review.

No security vulnerabilities, injection risks, or hardcoded secrets were found. No critical correctness regressions vs Phase 4. The 115-test suite passing and the green publint/attw checks are real signals — the surfaced warnings are about contract drift and process gaps, not broken behavior under tested inputs.

## Warnings

### WR-01: DataView migration silently lost sint16 range-check on `power`

**File:** `src/ftms/indoor-bike-data.ts:168`
**Issue:** The Phase 5 rewrite replaced `Buffer.writeInt16LE(record.power, offset)` with `view.setInt16(offset, record.power, true)`. These two have **different overflow semantics**:

- `Buffer.writeInt16LE(50_000)` throws `RangeError: The value of "value" is out of range. It must be >= -32768 and <= 32767.`
- `DataView.prototype.setInt16(offset, 50_000, true)` performs `ToInt16` and silently writes `-15_536` (50_000 mod 65_536, sign-extended).

The `IndoorBikeRecord.power` JSDoc (line 70-72) explicitly documents the contract: "Watts, sint16 range (-32768..+32767)". Phase 1's CONTEXT D-04 / PITFALLS.md §2 treat sint16 typing as a correctness invariant. Under the old encoding, an out-of-range `power` value (e.g., from a corrupted FIT record or a programming bug in a caller) would surface at the encode site as a thrown `RangeError`. Under the new encoding, it silently wraps and emits a misleading FTMS payload to consumers. The same regression applies to `cadence` and `speed` (uint16 wraps via `ToUint16`).

Tests (`test/ftms/indoor-bike-data.test.ts` per phase 01 plan) cover wire format byte-identity but, by inspection of the diff in scope, do NOT assert on the throw-on-overflow behavior — so CI did not catch this.

**Fix:** Either (a) re-introduce the runtime range check explicitly, or (b) document the new wrapping behavior and update tests to lock it in.

```ts
// Option (a) — defense at the encode boundary:
function assertInt16(name: string, v: number): void {
  if (!Number.isInteger(v) || v < -0x8000 || v > 0x7FFF) {
    throw new RangeError(`${name} out of sint16 range: ${v}`);
  }
}
function assertUint16(name: string, v: number): void {
  if (!Number.isInteger(v) || v < 0 || v > 0xFFFF) {
    throw new RangeError(`${name} out of uint16 range: ${v}`);
  }
}

export function encodeIndoorBikeData(record: IndoorBikeRecord): DataView {
  // ...
  const cadenceWire = Math.round(record.cadence / FIELDS.instantaneousCadence.resolution);
  assertUint16('cadence', cadenceWire);
  view.setUint16(offset, cadenceWire, true);
  offset += 2;

  assertInt16('power', record.power);
  view.setInt16(offset, record.power, true);
  // ...
}
```

Add a vitest case asserting `encodeIndoorBikeData({ power: 50_000, cadence: 80 })` throws `RangeError`. Same for `power: -50_000` and an out-of-range cadence.

### WR-02: `EventEmitter.once()` shim breaks `off(event, originalListener)` removal contract

**File:** `src/_internal/event-emitter.browser.ts:32-38`
**Issue:** The browser EventEmitter shim's `once` wraps the user's listener:

```ts
once<K extends keyof E>(event: K, listener: Listener<E[K]>): this {
  const wrapper = ((...args: E[K]) => {
    this.off(event, wrapper);
    listener(...args);
  }) as Listener<E[K]>;
  return this.on(event, wrapper);
}
```

This stores `wrapper` in `this.listeners[event]`, NOT the original `listener`. Now consider this consumer code (entirely valid against `node:events`):

```ts
const cb = () => doSomething();
transport.once('complete', cb);
// ... later, before 'complete' fires ...
transport.off('complete', cb);  // expects cb to NOT fire
```

Against Node's `EventEmitter`, this works: Node's `_onceWrap` attaches the original listener as `wrapper.listener`, and `removeListener` walks the list looking for either the function or `entry.listener === fn`. **Against this shim, it does not** — `off`'s `arr.indexOf(listener)` returns `-1` because the array contains `wrapper`, not `cb`. The once handler will fire on the next emit.

`FakeTransport` exposes `once`/`off` directly as part of its public surface (`fake-transport.ts:298-303`), so this is a public-API contract divergence between Node consumers (who get real `node:events`) and browser consumers (who get this shim) — a silent dual-build behavioral fork.

**Fix:** Track the original listener on the wrapper so `off` can find either form:

```ts
once<K extends keyof E>(event: K, listener: Listener<E[K]>): this {
  const wrapper = ((...args: E[K]) => {
    this.off(event, listener);  // remove by original-listener path below
    listener(...args);
  }) as Listener<E[K]> & { _originalListener?: Listener<E[K]> };
  wrapper._originalListener = listener;
  return this.on(event, wrapper);
}

off<K extends keyof E>(event: K, listener: Listener<E[K]>): this {
  const arr = this.listeners[event];
  if (!arr) return this;
  const idx = arr.findIndex((l) => l === listener
    || (l as Listener<E[K]> & { _originalListener?: Listener<E[K]> })._originalListener === listener);
  if (idx !== -1) arr.splice(idx, 1);
  return this;
}
```

Also add a regression test in `test/_internal/event-emitter.browser.test.ts` (which appears to not exist yet for this shim — also worth adding) that asserts `off(event, originalCb)` removes a `once`-registered listener.

### WR-03: tsup alias plugin uses `process.cwd()` instead of config-file-relative path

**File:** `tsup.config.ts:58`
**Issue:** The browser-alias plugin resolves the alias target via:

```ts
return { path: resolve(process.cwd(), 'src', '_internal', replacement) };
```

This is fragile. `process.cwd()` is whatever directory the user invoked `tsup` from. In normal `npm run build` from the repo root it's correct, but it breaks for:

- A consumer running `npx trainer-sim-build` from a parent directory,
- A monorepo wrapper (Turborepo, Nx, pnpm workspace) that hoists the build to a parent cwd,
- Any CI step that does `cd somewhere/else && npx tsup -c trainer-sim/tsup.config.ts`.

When `process.cwd()` is wrong, the plugin returns an incorrect path; esbuild fails the resolve and the build either breaks or (worse) silently falls back to the Node variant, producing a "browser" bundle that contains `node:fs/promises` imports — exactly the scenario this entire phase exists to prevent.

**Fix:** Resolve relative to the config file's directory:

```ts
import { defineConfig } from 'tsup';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ...

build.onResolve({ filter: /\/_internal\/[a-z-]+\.js$/ }, (args) => {
  const name = args.path.split('/').pop() as string;
  const replacement = browserAliasMap[name];
  if (!replacement) return undefined;
  return { path: resolve(__dirname, 'src', '_internal', replacement) };
});
```

Bonus belt-and-suspenders: after the alias swap, add an assertion plugin that fails the build if any `node:*` specifier resolves into the browser bundle. esbuild's `onResolve` with `filter: /^node:/` returning `{ errors: [{ text: ... }] }` does this.

### WR-04: Tracking `dist/` in git without `prepare` hook creates "stale artifact" risk

**File:** `.gitignore:2-6`, `package.json` (no `prepare` script)
**Issue:** Phase 5 made two coupled changes:

1. `.gitignore` was rewritten to TRACK `dist/` (so git-ref consumers receive prebuilt artifacts).
2. The `prepare` lifecycle hook was removed entirely from `package.json` (so consumers don't rebuild on install).

Together these mean: the committed `dist/` IS the source of truth for any consumer installing trainer-sim via git-ref (e.g., VeloWorld). There is **no enforcement** that this `dist/` is rebuilt for every source change. A developer can:

```bash
$ vim src/transport/fake-transport.ts   # change behavior
$ git add src/transport/fake-transport.ts
$ git commit -m "fix(transport): X"
$ git push
```

… and forget to run `npm run build && git add dist/`. VeloWorld's next pull gets the source change in their `node_modules/trainer-sim/src/` (only via sourcemap; not actually used) but the OLD compiled JavaScript in `dist/`. The behavioral fix is invisible to the consumer until a maintainer notices and rebuilds.

Worse, this is a one-way trap: once the gap exists, you cannot tell from `git log` whether `dist/` is stale — every commit "looks" the same.

**Fix:** Add a CI check that fails if `npm run build` produces a diff against the committed `dist/`:

```yaml
# .github/workflows/dist-up-to-date.yml
- name: Verify dist/ matches src/
  run: |
    npm run build
    if ! git diff --quiet -- dist/; then
      echo "::error::dist/ is out of date. Run 'npm run build' and commit."
      git diff -- dist/
      exit 1
    fi
```

Alternative (preferred for fewer process moves): re-introduce a `prepare` script that runs `npm run build` only when `.git` is present and skip it when running inside `node_modules` (the standard `is-in-ci` / `husky`-style guard). The Phase 5 .gitignore comment claims the `prepare` hook still runs at consumer install time, but the actual `package.json` does not have one — that comment is now factually wrong, which itself is a documentation defect. Either fix the script or update the .gitignore comment.

Additionally: the `.gitignore` comment on lines 4-6 says "The `prepare` lifecycle hook still rebuilds them on consumer install" — this is **factually wrong** as of the current `package.json`. Update the comment or restore the script.

### WR-05: Two-config tsup build relies on serial execution + asymmetric `clean`

**File:** `tsup.config.ts:36, 46`
**Issue:** The Node entry uses `clean: true`; the browser entry uses `clean: false`. Both write to the same `outDir: 'dist'`. This works only because:

1. `defineConfig([nodeEntry, browserEntry])` is processed in array order, AND
2. tsup runs the entries serially (not in parallel).

Both assumptions are tsup-internal implementation details. If a future tsup release runs configs in parallel (an obvious performance optimization), the browser-entry's `clean: false` and the Node-entry's `clean: true` race: the Node `clean: true` can wipe the browser output mid-build, producing a corrupt `dist/` (missing `index.browser.js`) that publint/attw would fail on.

If a developer reorders the array (e.g., during a refactor that puts the browser config first because it's "alphabetical"), the browser build runs first with `clean: false` (no-op on empty `dist/`), then the Node build cleans, deleting `index.browser.js` and `.browser.js.map`. Result: a "successful" build with no browser artifact and no error.

The 115-test suite would catch the missing artifact via `publish.test.ts`'s build step, but only if that test is in the run. If a developer iterates locally with `npm run build && check-something-else`, they'd ship a broken `dist/` to git.

**Fix:** Either consolidate into one config (run Node + browser as separate `entry` keys in a single config — tsup supports this), or extract a shared `clean` step into a separate npm script that runs `rm -rf dist` BEFORE either tsup config:

```jsonc
// package.json
"scripts": {
  "clean": "node -e \"require('node:fs').rmSync('dist', { recursive: true, force: true })\"",
  "build:node": "tsup --config tsup.node.ts",
  "build:browser": "tsup --config tsup.browser.ts",
  "build": "npm run clean && npm run build:node && npm run build:browser"
}
```

Then both tsup configs use `clean: false` and the build orchestration is explicit.

## Info

### IN-01: `EventEmitter.browser.ts` doesn't implement Node's `error` event auto-throw

**File:** `src/_internal/event-emitter.browser.ts`
**Issue:** Node's `EventEmitter` auto-throws if `emit('error', err)` is called with no `'error'` listener attached. This shim's `emit` returns `false` and silently drops. trainer-sim's typed event-map (`{ complete: [] }`) doesn't currently use `'error'`, so this is theoretical — but if a future surface adds `'error'`, the dual-build behavior diverges silently. **Fix:** Either replicate Node's behavior in `emit` for the literal string `'error'`, or document that this shim does not.

### IN-02: `removeAllListeners` and `setMaxListeners` shim parity

**File:** `src/_internal/event-emitter.browser.ts:52-56`
**Issue:** The shim implements `removeAllListeners` but not `setMaxListeners`/`getMaxListeners` (Node's MaxListenersExceededWarning at 10). FakeTransport's typed surface only exposes `on/off/once`, so this is invisible to consumers who type their variable as `FakeTransport`. But consumers who narrow to the shim's class (or who check `instanceof EventEmitter` and call `setMaxListeners`) get a runtime `TypeError` in the browser path and a silent succeed in the Node path. **Fix:** Either no-op `setMaxListeners`/`getMaxListeners` for compat, or `as unknown as never`-style cast at the consumer boundary.

### IN-03: Scheduler calls `getNow()` twice per tick — `clampedTicks` count can drift from `delay` decision

**File:** `src/replay/scheduler.ts:216-217`
**Issue:**

```ts
const delay = Math.max(target - getNow(), minIntervalMs);
if (target - getNow() < minIntervalMs) {
  clampedTicks++;
}
```

Calls `getNow()` twice; if the clock advances between calls, the `delay` and the `clampedTicks` decision diverge. Effect is observability-only (counter is debug-log diagnostic). **Pre-existing** — not introduced in Phase 5; flagged for completeness because it's near the changed-files boundary. **Fix:**

```ts
const now = getNow();
const rawDelay = target - now;
const delay = Math.max(rawDelay, minIntervalMs);
if (rawDelay < minIntervalMs) clampedTicks++;
```

### IN-04: Alias regex filter is too strict — silent bypass for Pascal/snake_case shim names

**File:** `tsup.config.ts:54`
**Issue:** The filter `/\/_internal\/[a-z-]+\.js$/` matches lowercase + hyphens only. If a future shim is named `EventEmitter.js` (PascalCase) or `read_file.js` (snake_case), the alias plugin silently does nothing — the Node variant gets bundled into the browser output with no error. **Fix:** Broaden the filter to `/\/_internal\/[A-Za-z0-9_-]+\.js$/` AND make `browserAliasMap` keys case-sensitive (which they already are — the bug is the filter, not the lookup). Combined with the WR-03 belt-and-suspenders `node:*` reject plugin, this becomes self-healing.

### IN-05: `publish.test.ts` substring assertions are brittle to whitespace/quote style

**File:** `test/transport/publish.test.ts:151, 154`
**Issue:** Lines like `expect(tsupConfig).toContain("entry: { index: 'src/index.ts' }")` will fail if anyone reformats `tsup.config.ts` (e.g., trailing comma, newline-per-key, double quotes). The test is a content-text grep on a TS source file. **Fix:** Either dynamically `import('../../tsup.config.ts')` and assert on the parsed config object, or relax to a regex like `/entry:\s*\{\s*index:\s*['"]src\/index\.ts['"]/`. The tests' stated purpose is "guard against single-rooted exports invariant" — that doesn't require literal whitespace.

### IN-06: Browser exports-condition lacks a CJS sub-condition

**File:** `package.json:14-28`
**Issue:** The `browser` condition is a flat `{ types, default }` rather than nested `{ import, require }`. A CJS-target browser bundler (rare in 2026, but webpack 4 / older toolchains exist) requesting `browser` resolves to `./dist/index.browser.js` which is ESM-only (per tsup config: `format: ['esm']`). It would fail with a `SyntaxError: Cannot use import statement outside a module`. Modern Vite/esbuild/webpack 5/Rollup all default to ESM, so this is a sharp-edge note rather than a concrete bug. **Fix (only if needed):** add a CJS browser variant and a nested `browser: { import: { ... }, require: { ... } }`. Defer until a real CJS-browser consumer surfaces.

---

_Reviewed: 2026-05-19_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
