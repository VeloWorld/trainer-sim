/**
 * Re-export of `node:timers/promises.setTimeout` for production wiring of
 * `Replay.start`'s `sleep` injection seam (D-REPL-03 / scheduler.ts:181).
 *
 * Browser builds replace this module with `sleep.browser.ts` via a tsup
 * alias (see `tsup.config.ts`). The browser variant uses `globalThis.setTimeout`
 * with AbortSignal-aware promise wiring; semantics match the Node version.
 */

export { setTimeout as defaultSleep } from 'node:timers/promises';
