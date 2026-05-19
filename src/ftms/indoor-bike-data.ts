/**
 * FTMS IndoorBikeData (0x2AD2) encoder — vendored under PROJECT.md "Vendor the
 * FTMS encoder for v1" key decision. Intended to extract cleanly to
 * `@veloworld/ftms-codec` in v2; therefore this module imports nothing from
 * elsewhere in the project (no config, no logger, no shared utils). The only
 * external API touched is `node:buffer`.
 *
 * Spec authority:
 *   Bluetooth SIG Fitness Machine Service v1.0.1 §4.9 "Indoor Bike Data"
 *   (characteristic 0x2AD2). Frame layout: little-endian Flags (uint16) followed
 *   by present fields in spec order. Cross-confirmed by two independent
 *   implementations (Auuki AGPL-3.0 reference; PyFTMS Apache-2.0 reference) —
 *   neither is imported here; Auuki is AGPL and stays out of an MIT repo
 *   (CONTEXT.md D-03c).
 *
 * Encoding traps addressed (see .planning/research/PITFALLS.md):
 *   §1 — Bit 0 ("More Data") is INVERTED: 0 = speed PRESENT, 1 = NOT PRESENT.
 *        Implemented in `buildFlags` per CONTEXT.md D-05; the inversion is
 *        encoded as a real branch (NOT a hard-coded 0x0045 literal) so the
 *        speed-present case works the moment a future caller passes `speed`.
 *   §2 — InstantaneousPower is sint16 (the spec is unambiguous; Auuki's source
 *        treats it as uint16, which is a known Auuki bug). Power is written via
 *        `writeInt16LE`. The FIELDS table marks `'sint16'` and a developer who
 *        "fixes" it to `'uint16'` to match Auuki breaks the assertion that
 *        plan 04 ships.
 *   §3 — InstantaneousCadence has 0.5 rpm resolution; wire = round(rpm / 0.5).
 *        The FIELDS table is the only place the resolution lives.
 *   §4 — Multi-byte fields are LE; raw DataView writes default to BE.
 *        This file uses `DataView.set{Uint,Int}16(_, _, true)` exclusively
 *        (the third arg `true` means little-endian) so byte order is explicit
 *        at every call site. Previously this file used `Buffer.write{U,Int}16LE`
 *        per CONTEXT.md D-10; that has been superseded to make trainer-sim
 *        bundleable into browser/renderer contexts (Phase 5 / D-VW-10) where
 *        Node's `Buffer` is unavailable. The wire format is byte-identical;
 *        consumers (and the existing third-party-decoder round-trip test) see
 *        no change.
 *   §5 — Wire-fractional values (cadence at 0.5, speed at 0.01) are rounded
 *        with `Math.round` before the integer write; otherwise sensor noise
 *        like `cadence = 73.3` silently truncates instead of rounding.
 *
 * References:
 *   - .planning/phases/01-vendored-ftms-codec/01-CONTEXT.md
 *       D-04 (record shape), D-05 (bit-0 inversion verbatim),
 *       D-06 (both branches active), D-07 (public surface),
 *       D-08 (pure stateless), D-09 (FIELDS source-of-truth),
 *       D-10 (Buffer.write*LE only — superseded by D-VW-10; see header above).
 *   - .planning/research/PITFALLS.md §1–§5.
 *   - PROJECT.md key decisions: "Vendor the FTMS encoder for v1";
 *     "DataView is the consumer-facing payload type".
 */

// No imports — D-VW-10 (Phase 5): trainer-sim's encoder is bundleable into
// browser/renderer contexts. Previously imported `Buffer` from `node:buffer`;
// the rewrite uses the global `Uint8Array` + `DataView` instead. Wire format
// unchanged.

/**
 * Input record for the IndoorBikeData encoder. Per CONTEXT.md D-07, Phase 1
 * supports power + cadence (always present) and an optional speed channel.
 *
 * Future-coupling: this shape extracts to `@veloworld/ftms-codec` unchanged in
 * v2. Adding fields (heart rate, distance, resistance, …) is purely additive
 * because the FIELDS table drives flag-bit and field-order semantics.
 */
export interface IndoorBikeRecord {
  /**
   * Watts, sint16 range (`-32768..+32767`), 1 W resolution. Negative values
   * are valid (regenerative braking, freewheeling on smart trainers that
   * support it). Spec-mandated signed type — see PITFALLS.md §2 for why
   * encoding power as uint16 is a silent bug.
   */
  power: number;
  /**
   * Cadence in rpm. Wire encoding is uint16 with 0.5 rpm resolution
   * (`wire = round(rpm / 0.5)` — see PITFALLS.md §3). Half-rpm values like
   * `90.5` are intended and round-trip exactly.
   */
  cadence: number;
  /**
   * Speed in km/h. Wire encoding is uint16 with 0.01 km/h resolution. v1
   * callers (Phase 3 replay) omit this; the encoder still implements the
   * speed-present branch so the bit-0 inversion logic is exercised by tests
   * and a future caller can opt in without an encoder rewrite (CONTEXT.md
   * D-04 / D-06).
   */
  speed?: number;
}

/**
 * Source-of-truth field table per CONTEXT.md D-09. The encoder reads this
 * table to decide types, resolutions, and flag bits; tests in plan 04 assert
 * directly against it so a silent mutation (e.g. someone "fixing"
 * `instantaneousPower.type` from `'sint16'` to `'uint16'` to match Auuki's
 * bug) fails a test instead of shipping. `as const` makes the literal types
 * narrow so `FIELDS.instantaneousPower.type === 'sint16'` is a type-level
 * statement, not just a runtime check.
 *
 * DO NOT change `instantaneousPower.type` to `'uint16'` — that is the Auuki
 * bug (PITFALLS.md §2) and is rejected by spec (sint16 is mandated).
 */
export const FIELDS = {
  instantaneousSpeed:   { type: 'uint16', resolution: 0.01, flagBit: 0, inverted: true  },
  instantaneousCadence: { type: 'uint16', resolution: 0.5,  flagBit: 2, inverted: false },
  instantaneousPower:   { type: 'sint16', resolution: 1,    flagBit: 6, inverted: false },
} as const;

// FTMS §4.9: bit 0 is "More Data" — INVERTED. 0 = speed PRESENT, 1 = NOT present. PITFALLS.md #1.
const MORE_DATA_BIT = FIELDS.instantaneousSpeed.flagBit;
const CADENCE_PRESENT_BIT = FIELDS.instantaneousCadence.flagBit;
const POWER_PRESENT_BIT = FIELDS.instantaneousPower.flagBit;

/**
 * Build the 16-bit Flags field. Bit 0 follows the inverted convention; bits 2
 * and 6 follow the standard "1 = field present" convention. A hard-coded
 * `0x0045` literal is forbidden (CONTEXT.md D-05): the literal makes the
 * inversion logic untestable and silently mis-encodes the speed-present
 * payload as soon as a future caller passes `speed`.
 */
function buildFlags(record: IndoorBikeRecord): number {
  let flags = 0;
  flags |= (record.speed === undefined ? 1 : 0) << MORE_DATA_BIT;
  flags |= 1 << CADENCE_PRESENT_BIT;
  flags |= 1 << POWER_PRESENT_BIT;
  return flags;
}

/**
 * Total payload length: Flags (2) + Cadence (2) + Power (2) + optional
 * Speed (2). Speed is the only conditional field in v1.
 */
function payloadByteLength(record: IndoorBikeRecord): number {
  return 6 + (record.speed !== undefined ? 2 : 0);
}

/**
 * Encode an IndoorBikeRecord to an FTMS IndoorBikeData characteristic payload.
 *
 * Pure, stateless function (CONTEXT.md D-08): allocates a fresh ArrayBuffer
 * per call, returns a DataView over its memory, and shares no state with
 * previous calls. The returned DataView is the caller-facing payload type
 * (PROJECT.md mandate) and owns its bytes. Suitable for 1 Hz emission; a
 * buffer pool is a v2 concern only if soak tests show GC jank (PITFALLS.md
 * performance #2).
 *
 * Field order on the wire (per FTMS §4.9): Flags, then any present fields in
 * spec order (Speed before Cadence before Power). Speed is omitted when
 * `record.speed === undefined`, in which case bit 0 of Flags is 1.
 */
export function encodeIndoorBikeData(record: IndoorBikeRecord): DataView {
  const view = new DataView(new ArrayBuffer(payloadByteLength(record)));
  let offset = 0;

  // Flags (uint16 LE — the `true` third arg is little-endian; PITFALLS.md §4).
  view.setUint16(offset, buildFlags(record), true);
  offset += 2;

  // Speed (uint16 LE, 0.01 km/h resolution) — when present, comes BEFORE cadence per spec field order.
  if (record.speed !== undefined) {
    view.setUint16(offset, Math.round(record.speed / FIELDS.instantaneousSpeed.resolution), true);
    offset += 2;
  }

  // Cadence (uint16 LE, 0.5 rpm resolution).
  view.setUint16(offset, Math.round(record.cadence / FIELDS.instantaneousCadence.resolution), true);
  offset += 2;

  // Power (sint16 LE, 1 W resolution) — sign matters! setInt16, NOT setUint16 (PITFALLS.md §2).
  view.setInt16(offset, record.power, true);
  offset += 2;

  return view;
}
