/**
 * FTMS IndoorBikeData encoder — Phase 1 Plan 04 verification suite.
 *
 * This file ships Gates A and B of the three-gate strategy laid out in
 * CONTEXT.md D-01 / D-03b:
 *   - Gate A — Byte-correctness: hand-computed reference payloads from
 *     RESEARCH.md §Reference Payloads, asserted byte-for-byte against
 *     `encodeIndoorBikeData` output (FTMS-01, FTMS-05b — primary
 *     spec-correctness oracle).
 *   - Gate B — Round-trip: encoder + spec-cited MIT decoder
 *     (test/fixtures/ftms-decoder.ts) round-trip preserves all field
 *     values and presence semantics for BOTH branches of bit-0 inversion
 *     (FTMS-04, FTMS-05a, D-06).
 *   - Gate C — nRF Connect manual verification — claimed by plan 01-05.
 *
 * Plus FIELDS source-of-truth invariants (D-09) so a silent mutation of
 * the encoder's field table (e.g., someone "fixing" `'sint16'` to
 * `'uint16'` to match Auuki's bug) is caught here, not in production.
 *
 * Plus an endianness sanity test (PITFALLS.md #4) — the LE-vs-BE trap is
 * pinned by reading the same bytes both ways and asserting they differ.
 *
 * All five reference payloads are documented in
 * `.planning/phases/01-vendored-ftms-codec/01-RESEARCH.md` §Reference
 * Payloads. The hex sequences in this file are pasted verbatim from that
 * section — DO NOT recompute them inline (PITFALLS.md #4: recomputing
 * defeats the spec-mis-read gate).
 *
 * Spec citations live next to the assertions: every test that depends on
 * a specific FTMS §4.9 detail (field order, sint16 power, half-rpm
 * cadence, bit-0 inversion, LE byte order) names the spec clause in a
 * comment so a reviewer can audit the test against the spec without
 * re-reading the encoder.
 */

import { describe, it, expect } from 'vitest';

import { encodeIndoorBikeData, FIELDS } from '../../src/ftms/indoor-bike-data.js';
import { decodeIndoorBikeData } from '../fixtures/ftms-decoder.js';

/**
 * Helper: extract the encoder's emitted bytes as a `Uint8Array` for
 * byte-for-byte comparison. The encoder returns a `DataView` aliasing a
 * fresh `Buffer`'s `ArrayBuffer`; `new Uint8Array(view.buffer, ...)`
 * gives a view over the same memory without copying.
 */
function bytesOf(view: DataView): Uint8Array {
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
}

describe('FTMS encoder — byte-correctness (FTMS-01, FTMS-05b)', () => {
  // RESEARCH.md §Reference Payloads — the 5 hand-computed hex byte sequences.
  // DO NOT recompute. Each row pairs an input shape with the expected wire bytes.
  it.each([
    {
      name: 'typical',
      record: { power: 200, cadence: 90 },
      // Flags 0x0045 (bit 0 = 1 speed NOT present, bit 2 cadence, bit 6 power)
      // | Cadence wire 180 (90 × 2) | Power wire 200
      expected: new Uint8Array([0x45, 0x00, 0xB4, 0x00, 0xC8, 0x00]),
    },
    {
      name: 'sint16 -1 + half-rpm 0.5',
      record: { power: -1, cadence: 0.5 },
      // Flags 0x0045 | Cadence wire 1 (0.5 × 2) | Power -1 sint16 = 0xFFFF
      expected: new Uint8Array([0x45, 0x00, 0x01, 0x00, 0xFF, 0xFF]),
    },
    {
      name: 'sint16 max + 90.5 rpm',
      record: { power: 32767, cadence: 90.5 },
      // Flags 0x0045 | Cadence wire 181 (90.5 × 2) | Power 32767 = 0x7FFF
      expected: new Uint8Array([0x45, 0x00, 0xB5, 0x00, 0xFF, 0x7F]),
    },
    {
      name: 'sint16 min',
      record: { power: -32768, cadence: 0 },
      // Flags 0x0045 | Cadence wire 0 | Power -32768 sint16 = 0x8000
      expected: new Uint8Array([0x45, 0x00, 0x00, 0x00, 0x00, 0x80]),
    },
    {
      name: 'speed present (D-06 inversion branch)',
      record: { power: 100, cadence: 60, speed: 30 },
      // Flags 0x0044 (bit 0 = 0 speed PRESENT) | Speed wire 3000 (30/0.01)
      // | Cadence wire 120 (60 × 2) | Power 100
      expected: new Uint8Array([0x44, 0x00, 0xB8, 0x0B, 0x78, 0x00, 0x64, 0x00]),
    },
  ])('encodes $name byte-for-byte', ({ record, expected }) => {
    const view = encodeIndoorBikeData(record);
    const actual = bytesOf(view);
    expect(actual).toEqual(expected);
    // Pin total byte length too — protects against a future field that
    // adds bytes without updating these fixtures.
    expect(actual.byteLength).toBe(expected.byteLength);
  });
});

describe('FTMS encoder — round-trip via spec-cited fixture decoder (FTMS-05a, FTMS-02, FTMS-03)', () => {
  // Round-trip MUST go through `decodeIndoorBikeData` (test/fixtures/) — never
  // raw `view.getInt16(...)` inline — or the gate degrades to a self-consistency
  // check. CONTEXT.md D-02.
  it.each([
    { name: 'typical', power: 200, cadence: 90 },
    { name: 'sint16 -1, half-rpm 0.5', power: -1, cadence: 0.5 },
    { name: 'sint16 max + half-rpm 90.5', power: 32767, cadence: 90.5 },
    { name: 'sint16 min', power: -32768, cadence: 0 },
    { name: 'zero power', power: 0, cadence: 60 },
  ])('round-trips $name (power=$power, cadence=$cadence)', ({ power, cadence }) => {
    const encoded = encodeIndoorBikeData({ power, cadence });
    const decoded = decodeIndoorBikeData(encoded);

    expect(decoded.power).toBe(power);
    expect(decoded.cadence).toBe(cadence);
    // No speed in the encoded payload (bit 0 = 1) → decoder MUST report no speed.
    expect(decoded.speed).toBeUndefined();
  });
});

describe('FTMS encoder — bit-0 inversion both branches (FTMS-04, D-06)', () => {
  // FTMS §4.9: bit 0 'More Data' is INVERTED.
  //   1 = Instantaneous Speed NOT present
  //   0 = Instantaneous Speed PRESENT
  // PITFALLS.md #1 — every other GATT characteristic uses 1 = present; FTMS
  // bit 0 is the exception. Both branches must be exercised.

  it('sets bit 0 = 1 when speed is omitted (more data NOT present)', () => {
    const view = encodeIndoorBikeData({ power: 100, cadence: 60 });
    const flags = view.getUint16(0, true);
    expect(flags & 0b1).toBe(1);
  });

  it('sets bit 0 = 0 when speed IS present (inversion: 0 means present)', () => {
    const view = encodeIndoorBikeData({ power: 100, cadence: 60, speed: 30 });
    const flags = view.getUint16(0, true);
    expect(flags & 0b1).toBe(0);
  });

  it('round-trips speed-present payload through the fixture decoder', () => {
    const encoded = encodeIndoorBikeData({ power: 100, cadence: 60, speed: 30 });
    const decoded = decodeIndoorBikeData(encoded);
    // Speed wire is uint16 with 0.01 km/h resolution; 30 km/h round-trips
    // via wire = 3000 → decode = 30. Use toBeCloseTo to defend against the
    // floating-point multiplication that the decoder performs.
    expect(decoded.speed).toBeCloseTo(30, 2);
    expect(decoded.cadence).toBe(60);
    expect(decoded.power).toBe(100);
  });
});

describe('FIELDS source-of-truth invariants (D-09)', () => {
  // These assertions catch silent FIELDS mutation. A developer who "fixes"
  // `instantaneousPower.type` from 'sint16' to 'uint16' to match Auuki's bug
  // (PITFALLS.md #2) fails a test instead of shipping the regression.

  it('declares power as sint16 (NOT uint16 — Auuki bug check)', () => {
    expect(FIELDS.instantaneousPower.type).toBe('sint16');
  });

  it('declares cadence resolution as 0.5 rpm (half-rpm — PITFALLS.md #3)', () => {
    expect(FIELDS.instantaneousCadence.resolution).toBe(0.5);
  });

  it('declares speed bit-0 as inverted (FTMS §4.9 More Data semantics)', () => {
    expect(FIELDS.instantaneousSpeed.flagBit).toBe(0);
    expect(FIELDS.instantaneousSpeed.inverted).toBe(true);
  });
});

describe('FTMS encoder — endianness sanity (PITFALLS.md #4)', () => {
  // The trap: `DataView.setUint16(o, v)` (no `true`) writes BIG-endian by
  // default. The encoder uses `Buffer.write*LE` so this should never happen,
  // but if a future refactor swaps in raw `DataView.setUint16` and forgets
  // the `true` flag, this test catches the regression by reading the same
  // bytes both ways and asserting they differ.
  it('emits cadence as little-endian (LE 180 vs BE 46080)', () => {
    const view = encodeIndoorBikeData({ power: 200, cadence: 90 });
    // Cadence wire is 180 (= 90 × 2). On the wire LE: 0xB4 0x00.
    // Reading it BE would give 0xB400 = 46080.
    expect(view.getUint16(2, true)).toBe(180);
    expect(view.getUint16(2, false)).toBe(46080);
  });
});
