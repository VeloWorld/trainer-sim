/**
 * Browser variant of `debuglog`. No-op. tsup aliases `debuglog.ts` → this
 * file when building `dist/index.browser.js`; bundlers that resolve
 * trainer-sim under the `"browser"` exports condition pick this entry.
 *
 * Why no-op rather than `console.debug`: trainer-sim tracing is intentionally
 * env-gated in Node. Surfacing it in browser console would leak diagnostic
 * noise into consumer apps. If a browser consumer ever needs tracing, they
 * can import from a future `trainer-sim/debug` subpath.
 */

export function debuglog(_namespace: string): (msg: string, ...args: unknown[]) => void {
  return () => {};
}
