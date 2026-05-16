// test/_helpers/fake-aware-sleep.ts
//
// Lifted from 4 Phase 3 test files (test/replay/{scheduler,abort,replay,loop}.test.ts).
// Phase 3 followup IN-01 / Phase 4 D-API-24 (.planning/phases/04-faketransport-public-api/04-CONTEXT.md).
// D-API-25 folds Phase 3 advisory followup IN-01 (fakeAwareSleep duplicated in 4 test files).
//
// Why this helper exists: Vitest 4's vi.useFakeTimers() does NOT intercept the
// node:timers/promises module-level binding (Phase 3 03-RESEARCH §Pitfall 6 /
// 04-RESEARCH §Pitfall 4 root cause). Phase 3's scheduler accepts an optional
// `sleep` injection seam; tests pass THIS helper through Replay.start({ sleep })
// (and Phase 4 will do the same through the FakeTransport factory's test-only
// `sleep` option, per 04-RESEARCH §Code Example 4).
//
// Body is byte-for-byte identical with the 4 Phase 3 test-file copies — see
// 04-RESEARCH §Open Questions resolution 8 confirming zero behavioral change.

/**
 * Test-only AbortSignal-aware sleep using `globalThis.setTimeout` (which
 * Vitest 4's `vi.useFakeTimers()` DOES intercept — RESEARCH §Pitfall 6
 * parallel). Mirrors the contract the production `node:timers/promises`
 * `setTimeout` honors: rejects with AbortError on signal abort, resolves
 * after `delay` ms otherwise, cleans up its abort listener on natural
 * completion.
 */
export function fakeAwareSleep(
  delay: number,
  _value?: undefined,
  options?: { signal?: AbortSignal },
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const signal = options?.signal;
    if (signal?.aborted) {
      const err = new Error('The operation was aborted');
      (err as { name: string }).name = 'AbortError';
      reject(err);
      return;
    }
    const onAbort = (): void => {
      clearTimeout(handle);
      const err = new Error('The operation was aborted');
      (err as { name: string }).name = 'AbortError';
      reject(err);
    };
    const handle = globalThis.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, delay);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
