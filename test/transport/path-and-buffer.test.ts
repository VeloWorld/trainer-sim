// Phase 4 Plan 04-05 Task 1 — integration tests for the FakeTransport
// factory's `{ path }` and `{ buffer }` source variants against the Phase 2
// fixture corpus.
//
// SUT: src/transport/fake-transport.ts (built in plan 04-03 task 1) — the
//   `loadRecords` inner helper which switches on the discriminator and calls
//   either `loadFitFromPath` (`{ path }`) or `loadFitFromBuffer` (`{ buffer }`),
//   plus the surrounding `connect()` Promise that bubbles `FitLoadError` and
//   filesystem `ENOENT`/`EACCES` unchanged. Imports go through `../../src/index.js`
//   (the public surface) — internal-path imports are forbidden by T-04-05-02.
//
// Locked decisions / requirements exercised:
//   - D-API-04 (.planning/phases/04-faketransport-public-api/04-CONTEXT.md):
//     synchronous factory + deferred FIT load; FitLoadError + filesystem errors
//     land in the `connect()` Promise rejection unchanged. NOT wrapped, NOT
//     translated — Group 3 is the binding assertion.
//   - D-API-05: `config.source` is a discriminated union of three variants;
//     this file covers `{ path }` (Group 1) and `{ buffer }` (Group 2). Plan
//     04-04 covers the `{ records }` fast-path; plan 04-06 validates the
//     published artifact only.
//   - D-API-22: tests live under `test/transport/`; `basic.fit` is the
//     fixture (D-API-23 — no new fixtures).
//   - D-API-23: reuses Phase 2 fixture corpus — `test/fixtures/fit/basic.fit`
//     (443 records, ~7 min, ROUVY clean 1Hz, 28 zero-power records — exercises
//     the `rec.power ?? 0` collapse path inside `replay.onRecord`).
//   - D-API-20: per-record collapse `rec.power ?? 0` / `rec.cadence ?? 0`
//     inside the `encodeIndoorBikeData` call — observable here as the byte
//     stream that path-source and buffer-source emit identically.
//   - API-01 (.planning/REQUIREMENTS.md): factory works across path / buffer /
//     records variants — this plan covers the first two end-to-end against a
//     real FIT fixture.
//   - API-04: `sendResistance` is echo-only — Group 4 is the binding
//     assertion against the FIT-driven path (calling `sendResistance` during
//     replay does NOT mutate any emitted byte).
//
// Pitfalls cited:
//   - 04-RESEARCH §Pitfall 4 / Phase 3 RESEARCH §Pitfall 5 — NEVER use the
//     synchronous fake-timer-advance variant; always the *Async form. The
//     acceptance grep enforces this — zero real call sites of the sync form
//     in this file (T-04-05-01).
//   - 04-RESEARCH §Pitfall 6 / Phase 3 RESEARCH §Pitfall 6 — Vitest 4's
//     `vi.useFakeTimers()` does NOT intercept the `node:timers/promises`
//     module-level binding; tests pass `fakeAwareSleep` through the
//     factory's test-only `sleep` option.
//   - 04-RESEARCH §Pattern 5 — the encoder shares ONE `DataView` reference
//     across all subscribers per emission tick; tests must SNAPSHOT the bytes
//     at emission time to compare across runs (the `snapshot` helper below).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createFakeTransport, FitLoadError } from '../../src/index.js';
import { fakeAwareSleep } from '../_helpers/fake-aware-sleep.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(__dirname, '../fixtures/fit/basic.fit');

/**
 * Snapshot the per-emission DataView bytes into a stable `Uint8Array` copy.
 * Necessary because the per-record encoder allocates ONE `DataView` per tick
 * and that reference is shared across all fan-out subscribers (04-RESEARCH
 * §Pattern 5); without copying, comparing two emission arrays would compare
 * references to the same allocation and trivially "match."
 */
function snapshot(dv: DataView): Uint8Array {
  return new Uint8Array(
    dv.buffer.slice(dv.byteOffset, dv.byteOffset + dv.byteLength),
  );
}

describe('FakeTransport { path } source variant — D-API-05 + API-01', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('loads basic.fit via { path } and emits ~443 records under fake timers', async () => {
    const transport = createFakeTransport(
      { source: { path: FIXTURE }, speed: Infinity, maxEmissionHz: 1000 },
      { sleep: fakeAwareSleep },
    );
    const emitted: Uint8Array[] = [];
    transport.onData((dv) => emitted.push(snapshot(dv)));

    const completePromise = once(transport, 'complete');
    await transport.connect();
    await vi.advanceTimersByTimeAsync(60_000);
    await completePromise;

    expect(emitted.length).toBeGreaterThanOrEqual(440);
    expect(emitted.length).toBeLessThanOrEqual(445);
    for (const bytes of emitted) {
      expect(bytes.byteLength).toBe(6);
    }
  });
});

describe('FakeTransport { buffer } source variant — D-API-05 + API-01', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('{ path } and { buffer } produce identical emission byte streams', async () => {
    const buf = readFileSync(FIXTURE);

    const fromPathBytes: Uint8Array[] = [];
    const t1 = createFakeTransport(
      { source: { path: FIXTURE }, speed: Infinity, maxEmissionHz: 1000 },
      { sleep: fakeAwareSleep },
    );
    t1.onData((dv) => fromPathBytes.push(snapshot(dv)));
    const c1 = once(t1, 'complete');
    await t1.connect();
    await vi.advanceTimersByTimeAsync(60_000);
    await c1;

    const fromBufferBytes: Uint8Array[] = [];
    const t2 = createFakeTransport(
      { source: { buffer: buf }, speed: Infinity, maxEmissionHz: 1000 },
      { sleep: fakeAwareSleep },
    );
    t2.onData((dv) => fromBufferBytes.push(snapshot(dv)));
    const c2 = once(t2, 'complete');
    await t2.connect();
    await vi.advanceTimersByTimeAsync(60_000);
    await c2;

    expect(fromBufferBytes.length).toBe(fromPathBytes.length);
    expect(fromBufferBytes).toEqual(fromPathBytes);
  });
});

describe('FakeTransport connect() error bubbling — D-API-04', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('FitLoadError from a corrupt buffer bubbles unchanged from connect()', async () => {
    // 50 random-ish bytes — not a FIT header. The loader will reject this
    // with a `FitLoadError` subclass (`InvalidFitHeaderError` for bad magic
    // / wrong header length, or `FitTruncatedError` if validation order
    // surfaces the truncation first). Assert against the abstract base —
    // the specific subclass is loader-implementation detail and not
    // guaranteed by D-API-04. The binding contract is that whatever the
    // loader threw lands in `connect()`'s rejection unchanged (NOT wrapped
    // in a transport-layer error).
    const corrupt = new Uint8Array(50);
    const transport = createFakeTransport(
      { source: { buffer: corrupt } },
      { sleep: fakeAwareSleep },
    );
    await expect(transport.connect()).rejects.toBeInstanceOf(FitLoadError);
  });

  it('ENOENT from a missing path bubbles as a plain Node error (NOT FitLoadError)', async () => {
    const transport = createFakeTransport(
      { source: { path: '/nonexistent/path/file.fit' } },
      { sleep: fakeAwareSleep },
    );
    // Phase 2 contract (loader.ts:261-265 docstring): filesystem errors are
    // deliberately NOT wrapped in `FitLoadError` — they describe filesystem
    // failures, not FIT-format failures. They bubble as Node's standard
    // `Error` types (with `code: 'ENOENT'` etc.) through `connect()`'s
    // Promise rejection.
    await expect(transport.connect()).rejects.toThrow(/ENOENT|no such file/i);
    await expect(transport.connect()).rejects.not.toBeInstanceOf(FitLoadError);
  });
});

describe('FakeTransport API-04 — sendResistance is echo-only against the FIT-driven path', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('sendResistance during a fixture-driven replay does NOT mutate emitted bytes', async () => {
    // Baseline: replay basic.fit with NO sendResistance calls. Snapshot
    // the first 5 emissions as the binding "what the wire emits absent
    // any control-point activity."
    const baseline: Uint8Array[] = [];
    const t1 = createFakeTransport(
      { source: { path: FIXTURE }, speed: Infinity, maxEmissionHz: 1000 },
      { sleep: fakeAwareSleep },
    );
    t1.onData((dv) => {
      if (baseline.length < 5) baseline.push(snapshot(dv));
    });
    const c1 = once(t1, 'complete');
    await t1.connect();
    await vi.advanceTimersByTimeAsync(60_000);
    await c1;

    expect(baseline).toHaveLength(5);

    // Echo run: same fixture, same config — but call sendResistance three
    // times during the replay. The binding assertion: the first 5
    // emissions are byte-for-byte identical with the baseline (replay
    // stayed faithful to the source FIT) AND the resistance log captured
    // all three calls in order (echo-only, observable on `received`).
    const echo: Uint8Array[] = [];
    const t2 = createFakeTransport(
      { source: { path: FIXTURE }, speed: Infinity, maxEmissionHz: 1000 },
      { sleep: fakeAwareSleep },
    );
    t2.onData((dv) => {
      if (echo.length < 5) echo.push(snapshot(dv));
    });
    const c2 = once(t2, 'complete');
    await t2.connect();
    await t2.sendResistance(0.10);
    await t2.sendResistance(0.20);
    await t2.sendResistance(0.30);
    await vi.advanceTimersByTimeAsync(60_000);
    await c2;

    expect(echo).toHaveLength(5);
    expect(echo).toEqual(baseline);
    expect(t2.received.resistance).toEqual([0.10, 0.20, 0.30]);
  });
});
