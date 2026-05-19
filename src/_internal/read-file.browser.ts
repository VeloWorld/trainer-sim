/**
 * Browser variant of `readFile`. trainer-sim's `loadFitFromPath` is a
 * Node-only API; the browser path forces consumers to use `loadFitFromBuffer`
 * (or `createFakeTransport({ source: { buffer } })`) after reading bytes via
 * their own IPC bridge. Calling `loadFitFromPath` from a browser context
 * surfaces the architectural mismatch explicitly with a clear error rather
 * than letting it crash inside a polyfill stub.
 */

export function readFile(_path: string): Promise<Uint8Array> {
  return Promise.reject(
    new Error(
      'trainer-sim: loadFitFromPath is unavailable in browser builds. ' +
        'Use loadFitFromBuffer (or createFakeTransport({ source: { buffer } })) ' +
        'with bytes obtained via your own IPC bridge.',
    ),
  );
}
