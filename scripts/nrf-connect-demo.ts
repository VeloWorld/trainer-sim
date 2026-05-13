/**
 * trainer-sim — nRF Connect verification helper (FTMS-05c manual verification gate).
 *
 * This script implements the third gate of Phase 1's three-gate FTMS verification
 * strategy (CONTEXT.md D-03 / D-03b):
 *
 *   Gate A — hand-computed byte fixtures (plan 04, automated in vitest)
 *   Gate B — spec-cited round-trip via the hand-rolled MIT decoder (plan 04, automated)
 *   Gate C — one-shot manual nRF Connect verification (this script + plan 05) ← we are here
 *
 * Gate C is the ONLY genuinely third-party check in the loop: the encoder bytes
 * are read by Nordic's nRF Connect, which decodes the FTMS spec the way the
 * BLE ecosystem does. If gates A and B both pass but nRF Connect shows wrong
 * values, the spec mis-read is in OUR encoder (and the fix is in src/ftms/, not
 * in nRF Connect).
 *
 * Operator workflow:
 *   1. From the repo root, run: `npx tsx scripts/nrf-connect-demo.ts`.
 *   2. Note the printed hex bytes for Reference Payloads 1 and 5.
 *   3. Open nRF Connect on a phone, feed the bytes through it (Advertiser mode,
 *      hex viewer, or manual byte-level read — see procedure block below).
 *   4. Capture a screenshot showing the decoded values (cadence + power for
 *      Payload 1; speed/cadence/power for Payload 5).
 *   5. Save the screenshot to
 *      `.planning/phases/01-vendored-ftms-codec/nrf-connect-verification.png`
 *      (must be ≥ 50 KB — real-screenshot floor).
 *   6. Update `.planning/phases/01-vendored-ftms-codec/nrf-connect-verification.md`
 *      with the date, device, method, and observed values.
 *
 * Notes on the script's design:
 *   - The hex strings printed below are computed from the LIVE encoder output
 *     (`encodeIndoorBikeData(...)`) — never hard-coded. The whole point of this
 *     script is to demonstrate that the encoder really does produce these bytes.
 *   - The encoder is imported with the `.js` extension on the relative specifier
 *     per the phase-wide convention pinned in plan 01-01 (tsx resolves `.ts` at
 *     runtime; `.js` keeps Node ESM happy when this same path is run via the
 *     built `dist/` output).
 *   - v1 has no real BLE transport (the v2 BLE peripheral story is out of scope
 *     per CONTEXT.md D-14). This script is byte-level only — no peripheral
 *     advertising, no native deps.
 */

import { encodeIndoorBikeData, type IndoorBikeRecord } from '../src/ftms/indoor-bike-data.js';

/** Format a DataView's bytes as a SPACE-separated upper-case hex string. */
function toHexBytes(view: DataView): string {
  const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
}

/** Format a DataView's bytes as a comma-separated decimal Uint8Array literal. */
function toDecimalArray(view: DataView): string {
  const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  return `Uint8Array([${Array.from(bytes).join(', ')}])`;
}

/** Render one named reference payload as live encoder output. */
function renderPayload(label: string, record: IndoorBikeRecord): void {
  const view = encodeIndoorBikeData(record);
  const hex = toHexBytes(view);
  const dec = toDecimalArray(view);

  console.log(`--- ${label} ---`);
  console.log(`  input:               ${JSON.stringify(record)}`);
  console.log(`  live encoder bytes:  ${hex}`);
  console.log(`  live encoder array:  ${dec}`);
  console.log('');
}

console.log('trainer-sim — nRF Connect verification helper (FTMS-05c manual verification)');
console.log('');
console.log('Encoded bytes below are computed from the LIVE encoder at');
console.log('src/ftms/indoor-bike-data.ts. Compare them against what nRF Connect');
console.log('shows on a phone to satisfy the three-gate strategy gate C.');
console.log('');

// Reference Payload 1 — typical {power: 200, cadence: 90}
// Per RESEARCH.md §Reference Payloads: flags=0x0045 (bit 0 = 1, speed NOT present),
// cadence wire = 90 * 2 = 180 = 0x00B4, power = 200 = 0x00C8.
// Any spec-compliant decoder (nRF Connect, hand-rolled MIT decoder, etc.) MUST
// read these bytes back as: cadence = 90 rpm, power = 200 W.
renderPayload(
  'Reference Payload 1 — typical, no speed (decodes to: cadence=90 rpm, power=200 W)',
  { power: 200, cadence: 90 },
);

// Reference Payload 5 — speed-present branch {power: 100, cadence: 60, speed: 30}
// Bit 0 INVERTS to 0 because speed IS present (PITFALLS.md §1 / D-05). Field
// order: Flags, Speed, Cadence, Power. Hex changes 45 → 44 in the first byte.
// Decoder must read: cadence = 60 rpm, power = 100 W, speed = 30 km/h.
renderPayload(
  'Reference Payload 5 — speed present, bit-0 inversion branch (cadence=60 rpm, power=100 W, speed=30 km/h)',
  { power: 100, cadence: 60, speed: 30 },
);

console.log('--- Verification procedure ---');
console.log('1. Open nRF Connect on a phone (Android: Play Store; iOS: App Store).');
console.log('2. Pick a verification method and feed it the bytes printed above:');
console.log('   - Option A (Advertiser mode, if your phone supports peripheral advertising):');
console.log('       In Advertiser → New advertisement set → Service Data → UUID 0x1826 (Fitness Machine Service).');
console.log('       Paste the hex bytes for Payload 1 (or Payload 5). Start advertising. Use a second phone in');
console.log('       Scanner mode with FTMS decoding to read the IndoorBikeData characteristic.');
console.log('   - Option B (Hex viewer / manual decode):');
console.log('       Bytes 0-1 LE = Flags (expect 0x0045 for Payload 1, 0x0044 for Payload 5).');
console.log('       Bytes 2-3 LE = Cadence wire — divide by 2 for rpm (0x00B4 = 180 → 90 rpm for Payload 1).');
console.log('       Bytes 4-5 LE = Power sint16 (0x00C8 = 200 W for Payload 1).');
console.log('   - Option C (BLE peripheral over a real radio): out of scope for v1 (D-14); v2 only.');
console.log('3. Confirm the decoded values match the expected values printed above.');
console.log('4. Capture a phone screenshot of nRF Connect showing the decoded values for at least Payload 1.');
console.log('   Save it as .planning/phases/01-vendored-ftms-codec/nrf-connect-verification.png (≥ 50 KB).');
console.log('5. Update .planning/phases/01-vendored-ftms-codec/nrf-connect-verification.md with the date,');
console.log('   phone make/model + nRF Connect version, method used (A/B/C), observed values, pass/fail.');
console.log('6. Resume the executor by typing "approved" if values matched.');
console.log('');
console.log('A mismatch on this gate indicates a spec mis-read in the encoder; rewind to plan 03.');
