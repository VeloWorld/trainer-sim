/**
 * Re-export of `node:fs/promises.readFile`. Used by `loadFitFromPath` to
 * pull FIT bytes off disk before delegating to `loadFitFromBuffer` for
 * validation + parsing.
 *
 * Browser builds replace this module with `read-file.browser.ts` via a tsup
 * alias (see `tsup.config.ts`). The browser variant throws — `loadFitFromPath`
 * is a Node-only API. Browser/renderer consumers should use
 * `loadFitFromBuffer` (or pass `{ buffer: Uint8Array }` to `createFakeTransport`)
 * after reading the FIT bytes via their own IPC bridge.
 */

export { readFile } from 'node:fs/promises';
