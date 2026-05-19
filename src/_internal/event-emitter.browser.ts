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
 */

type Listener<T extends ReadonlyArray<unknown>> = (...args: T) => void;
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
    const idx = arr.indexOf(listener);
    if (idx !== -1) arr.splice(idx, 1);
    return this;
  }

  once<K extends keyof E>(event: K, listener: Listener<E[K]>): this {
    const wrapper = ((...args: E[K]) => {
      this.off(event, wrapper);
      listener(...args);
    }) as Listener<E[K]>;
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
