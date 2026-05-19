/**
 * Re-export of Node's `EventEmitter`. Provides the typed-events generic
 * trainer-sim uses for `FakeTransport`'s `'complete'` event surface
 * (D-API-11).
 *
 * Browser builds replace this module with `event-emitter.browser.ts` via a
 * tsup alias (see `tsup.config.ts`). The browser variant is a tiny inline
 * implementation — only `on/off/once/emit/listenerCount` for the event names
 * trainer-sim uses; ~50 LOC, no Node dependency.
 */

export { EventEmitter } from 'node:events';
