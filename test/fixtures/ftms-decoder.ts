/**
 * MIT-licensed (authored in this repo). Spec source: Bluetooth SIG Fitness
 * Machine Service v1.0.1 §4.9 "Indoor Bike Data" characteristic (UUID 0x2AD2).
 *
 * Independent of `src/ftms/indoor-bike-data.ts` — do not modify by inverting
 * that module's code. Per CONTEXT.md D-02, this decoder MUST be authored from
 * the FTMS spec directly so a shared spec mis-read in the encoder must also
 * happen in two places to slip through the round-trip gate exercised by
 * plan 04. If this file ever degrades into an inversion of the encoder, the
 * round-trip gate degrades to a self-consistency check.
 *
 * License rationale (CONTEXT.md D-03c): Auuki's FTMS reference (`Auuki`,
 * `src/ble/ftms/indoor-bike-data.js`) is AGPL-3.0 — it MUST NOT be vendored,
 * submoduled, or imported into this MIT-licensed repo. PyFTMS is Apache-2.0
 * but Python — out of scope per D-01 (in-process JS only). This file is the
 * approved alternative.
 *
 * Field decisions (every one cites PITFALLS.md or the FTMS spec):
 *   - Bit 0 ("More Data") is INVERTED — speed PRESENT when bit == 0.
 *     PITFALLS.md #1.
 *   - InstantaneousPower is sint16 (signed). PITFALLS.md #2 — Auuki's uint16
 *     is the bug we MUST NOT replicate.
 *   - InstantaneousCadence is uint16 with 0.5 rpm resolution (wire = rpm × 2).
 *     PITFALLS.md #3.
 *   - All multi-byte reads are little-endian (`getInt16/getUint16(o, true)`).
 *     PITFALLS.md #4 — DataView default is BIG-endian; we MUST pass `true`.
 *
 * This decoder lives under test/fixtures/ only. REQUIREMENTS.md "Out of
 * Scope" forbids FTMS decode in `src/`, and Phase 4+ extraction of
 * `@veloworld/ftms-codec` will leave this fixture behind as a test-only
 * artifact.
 */

/**
 * Decoded shape of a single Indoor Bike Data notification.
 *
 * `speed` is optional because FTMS bit-0 ("More Data") inverts the usual
 * "1 = present" convention — when bit 0 is 1, speed is omitted and the
 * payload jumps straight to the next-present field. See SPEED_BIT below.
 */
export interface DecodedIndoorBike {
  speed?: number;
  cadence: number;
  power: number;
}

// FTMS v1.0.1 §4.9.1 Flags field (uint16 LE, bitfield).
//
// Bit 0 is "More Data" and is INVERTED relative to every other present-bit:
//   0 → Instantaneous Speed PRESENT
//   1 → Instantaneous Speed NOT present (more data fits in subsequent fields)
// PITFALLS.md #1.
const SPEED_BIT = 0; // FTMS §4.9: bit 0 'More Data' — INVERTED (0 = speed PRESENT, 1 = NOT present). PITFALLS.md #1.
const CADENCE_BIT = 2; // FTMS §4.9: bit 2 'Instantaneous Cadence Present'. Normal semantics (1 = present).
const POWER_BIT = 6; // FTMS §4.9: bit 6 'Instantaneous Power Present'. Normal semantics (1 = present).

/**
 * Decode a Bluetooth SIG FTMS v1.0.1 §4.9 Indoor Bike Data (0x2AD2) payload.
 *
 * Field order on the wire is fixed by the spec: Flags(uint16) → optional
 * Instantaneous Speed(uint16) → optional Instantaneous Cadence(uint16) →
 * (other optional fields in spec order) → optional Instantaneous Power(sint16).
 * For Phase 1 the supported field set is Speed/Cadence/Power only (CONTEXT.md
 * D-04); a payload exercising other flag bits will be rejected by the
 * required-fields check at the bottom because we won't reach the cadence/
 * power offsets.
 *
 * @throws Error when the required fields (cadence, power) are not flagged
 *         present — the round-trip oracle must surface a missing field as a
 *         hard failure, not silently coerce to NaN.
 */
export function decodeIndoorBikeData(view: DataView): DecodedIndoorBike {
  // PITFALLS.md #4: DataView defaults to BIG-endian; the second `true` arg is
  // the little-endian flag and is mandatory for every multi-byte read below.
  const flags = view.getUint16(0, true);

  // Bit-0 inversion: speed is present when the bit is CLEAR (0), not set.
  // Equivalent to: ((flags >> SPEED_BIT) & 1) === 0. Both encode the bit-0
  // inversion (PITFALLS.md #1). The `=== 0` is the load-bearing piece — a
  // future refactor that drops it (or flips to `!== 0`) silently breaks the
  // INVERTED semantics and only the round-trip gate (plan 04) will catch it.
  const speedPresent = (flags & (1 << SPEED_BIT)) === 0;
  const cadencePresent = (flags & (1 << CADENCE_BIT)) !== 0;
  const powerPresent = (flags & (1 << POWER_BIT)) !== 0;

  // FTMS §4.9.1 field-order: Flags -> Speed -> Cadence -> Power
  // (Spec-order anchor: a future refactor that quietly reorders these reads
  //  must keep this comment in sync; static greps in plan acceptance criteria
  //  pin the order.)
  let offset = 2; // bytes 0-1 are Flags
  let speed: number | undefined;
  let cadence: number | undefined;
  let power: number | undefined;

  if (speedPresent) {
    // FTMS §4.9: Instantaneous Speed = uint16, resolution 0.01 km/h.
    speed = view.getUint16(offset, true) * 0.01;
    offset += 2;
  }

  if (cadencePresent) {
    // FTMS §4.9: Instantaneous Cadence = uint16, resolution 0.5 rpm.
    // Wire value is rpm × 2 (PITFALLS.md #3); decode is wire × 0.5.
    cadence = view.getUint16(offset, true) * 0.5;
    offset += 2;
  }

  if (powerPresent) {
    // FTMS §4.9: Instantaneous Power = sint16, resolution 1 W.
    // PITFALLS.md #2: Auuki encodes power as Uint16 — that is the spec
    // violation we MUST NOT replicate. Use getInt16 (signed) so negative
    // power (regenerative braking, freewheeling) round-trips correctly.
    power = view.getInt16(offset, true);
    offset += 2;
  }

  if (cadence === undefined || power === undefined) {
    throw new Error(
      'decodeIndoorBikeData: required fields (cadence, power) missing in flags',
    );
  }

  return speed === undefined ? { cadence, power } : { speed, cadence, power };
}
