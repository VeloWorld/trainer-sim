/**
 * Node implementation of `debuglog`. Routes through `node:util.debuglog` so
 * the public Node behavior (env-gated by `NODE_DEBUG`) is preserved verbatim.
 *
 * Browser builds replace this module with `debuglog.browser.ts` via a tsup
 * alias (see `tsup.config.ts`). The browser variant is a no-op — trainer-sim
 * tracing is unavailable when bundled for renderer contexts (Electron renderer,
 * Vite-bundled browsers, etc.). Node consumers (CLI, scripts, server tests)
 * see the original `node:util.debuglog` behavior unchanged.
 */

import { debuglog as nodeDebuglog } from 'node:util';

export function debuglog(namespace: string): (msg: string, ...args: unknown[]) => void {
  return nodeDebuglog(namespace);
}
