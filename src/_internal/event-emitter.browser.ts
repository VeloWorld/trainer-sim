/**
 * Browser variant of `EventEmitter`. Minimal implementation covering only the
 * methods trainer-sim uses for `FakeTransport`'s `'complete'` event:
 * `on/off/once/emit/listenerCount`. Generic over an event-map shape matching
 * Node's typed-events form (`EventEmitter<{ complete: [] }>`).
 *
 * Why not import from npm `events` (the Browserify-era polyfill bundlers
 * provide): the polyfill is large (~7 KB minified), runtime-version-dependent,
 * and adds a transitive dependency. trainer-sim's event surface is tiny and
 * fixed, so an inline implementation is simpler and smaller.
 *
 * Phase 5 / WR-02 contract note: `once(event, fn)` MUST be removable via
 * `off(event, fn)` even though `once` registers a wrapper internally. Node's
 * `EventEmitter._onceWrap` attaches the original listener on `wrapper.listener`
 * and `removeListener` walks the array looking for either `entry === fn` or
 * `entry.listener === fn`. This shim mirrors that protocol with the same
 * `wrapper.listener` property name (NOT `_originalListener`) so that any
 * consumer code that relied on the documented Node convention behaves
 * identically across the dual build.
 */

type Listener<T extends ReadonlyArray<unknown>> = (...args: T) => void;

/**
 * Internal wrapper shape used by `once` to track the original listener.
 * Field name `listener` matches `node:events`'s public `kListener`-aliased
 * convention so the dual-build (`once` + `off(originalFn)`) contract holds.
 */
type OnceWrapper<T extends ReadonlyArray<unknown>> = Listener<T> & {
  listener?: Listener<T>;
};

type EventMap = Record<string, ReadonlyArray<unknown>>;

export class EventEmitter<E extends EventMap = EventMap> {
  private listeners: { [K in keyof E]?: Array<Listener<E[K]>> } = {};

  on<K extends keyof E>(event: K, listener: Listener<E[K]>): this {
    (this.listeners[event] ??= []).push(listener);
    return this;
  }

  off<K extends keyof E>(event: K, listener: Listener<E[K]>): this {
    const arr = this.listeners[event];
    if (!arr) return this;
    // Match either the listener directly OR a once-wrapper whose .listener
    // property points at the original function (Node's contract — WR-02).
    const idx = arr.findIndex(
      (entry) =>
        entry === listener ||
        (entry as OnceWrapper<E[K]>).listener === listener,
    );
    if (idx !== -1) arr.splice(idx, 1);
    return this;
  }

  once<K extends keyof E>(event: K, listener: Listener<E[K]>): this {
    const wrapper = ((...args: E[K]) => {
      // Remove via the wrapper itself so we don't accidentally take the
      // `entry.listener === fn` branch and remove an unrelated `on(_, listener)`
      // registration of the same function.
      this.off(event, wrapper);
      listener(...args);
    }) as OnceWrapper<E[K]>;
    wrapper.listener = listener;
    return this.on(event, wrapper);
  }

  emit<K extends keyof E>(event: K, ...args: E[K]): boolean {
    const arr = this.listeners[event];
    if (!arr || arr.length === 0) return false;
    // Copy before iteration so off() during dispatch doesn't shift indices.
    for (const l of arr.slice()) l(...args);
    return true;
  }

  listenerCount<K extends keyof E>(event: K): number {
    return this.listeners[event]?.length ?? 0;
  }

  removeAllListeners<K extends keyof E>(event?: K): this {
    if (event === undefined) this.listeners = {};
    else delete this.listeners[event];
    return this;
  }
}
