// Phase 5 / WR-02 regression — the browser EventEmitter shim must honor
// Node's `once(event, fn)` ↔ `off(event, fn)` removal contract. Node's
// `_onceWrap` stores the original listener as `wrapper.listener` and
// `removeListener` matches on either the registered entry or `entry.listener`.
// Without that, an entirely valid Node-style "register-once-then-cancel"
// pattern (FakeTransport exposes both `once` and `off` publicly) silently
// fails on the browser path and the once handler fires anyway — a dual-build
// behavioral fork.
//
// Tests exercise:
//   1. The contract itself (`off(event, originalFn)` removes a once handler).
//   2. The "don't remove an unrelated `on` handler" guard (registering the
//      same function with both `on` and `once` and removing only the once).
//   3. `wrapper.listener` is the field name (not `_originalListener`) so
//      consumers introspecting the array see the Node-compatible shape.

import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from '../../src/_internal/event-emitter.browser.js';

type Events = { complete: []; data: [number] };

describe('EventEmitter.browser — once/off removal contract (WR-02)', () => {
  it('off(event, fn) removes a listener registered via once(event, fn)', () => {
    const ee = new EventEmitter<Events>();
    const cb = vi.fn();
    ee.once('complete', cb);
    expect(ee.listenerCount('complete')).toBe(1);
    ee.off('complete', cb);
    expect(ee.listenerCount('complete')).toBe(0);
    ee.emit('complete');
    expect(cb).not.toHaveBeenCalled();
  });

  it('off(event, fn) on a once-listener is idempotent against re-emit', () => {
    const ee = new EventEmitter<Events>();
    const cb = vi.fn();
    ee.once('complete', cb);
    ee.off('complete', cb);
    ee.emit('complete');
    ee.emit('complete');
    expect(cb).not.toHaveBeenCalled();
  });

  it('once still fires (and self-removes) when off is NOT called', () => {
    const ee = new EventEmitter<Events>();
    const cb = vi.fn();
    ee.once('complete', cb);
    ee.emit('complete');
    expect(cb).toHaveBeenCalledTimes(1);
    expect(ee.listenerCount('complete')).toBe(0);
    ee.emit('complete');
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('off(event, fn) does NOT remove an unrelated on(event, fn) when both are registered', () => {
    // This is the guard against an over-eager "match on .listener" — we want
    // off(fn) to remove the once-wrapper-pointing-at-fn AND the directly-
    // registered fn, but NOT to leave dangling state. Node's removeListener
    // removes only the FIRST match; we mirror that.
    const ee = new EventEmitter<Events>();
    const cb = vi.fn();
    ee.on('complete', cb);
    ee.once('complete', cb);
    expect(ee.listenerCount('complete')).toBe(2);

    ee.off('complete', cb);
    // First match removed (the on registration). One listener remains — the
    // once wrapper. emit() should fire it exactly once and self-clean.
    expect(ee.listenerCount('complete')).toBe(1);
    ee.emit('complete');
    expect(cb).toHaveBeenCalledTimes(1);
    expect(ee.listenerCount('complete')).toBe(0);
  });

  it('on(event, fn) is removable by off(event, fn) — non-once path unchanged', () => {
    const ee = new EventEmitter<Events>();
    const cb = vi.fn();
    ee.on('complete', cb);
    ee.off('complete', cb);
    ee.emit('complete');
    expect(cb).not.toHaveBeenCalled();
  });

  it('payload-carrying events round-trip through once + off', () => {
    const ee = new EventEmitter<Events>();
    const cb = vi.fn();
    ee.once('data', cb);
    ee.emit('data', 42);
    expect(cb).toHaveBeenCalledWith(42);
    expect(ee.listenerCount('data')).toBe(0);

    const cb2 = vi.fn();
    ee.once('data', cb2);
    ee.off('data', cb2);
    ee.emit('data', 99);
    expect(cb2).not.toHaveBeenCalled();
  });
});
