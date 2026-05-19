/**
 * Browser variant of `defaultSleep`. Mirrors `node:timers/promises.setTimeout`
 * for the `(delay, value?, options?)` signature trainer-sim's scheduler uses
 * (scheduler.ts:110-114). AbortSignal causes the returned Promise to reject
 * with an `AbortError`-shaped DOMException — matching Node's behavior so
 * scheduler.ts's existing abort-aware path (D-REPL-09) works unchanged.
 */

export function defaultSleep<T>(
  delay: number,
  value?: T,
  options?: { signal?: AbortSignal },
): Promise<T extends undefined ? void : T> {
  return new Promise((resolve, reject) => {
    const signal = options?.signal;
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      return;
    }
    const id = setTimeout(() => {
      if (signal) signal.removeEventListener('abort', onAbort);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      resolve(value as any);
    }, delay);
    const onAbort = () => {
      clearTimeout(id);
      reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
