# nRF Connect Verification — Phase 1 (FTMS-05c)

**Status:** AWAITING HUMAN VERIFICATION (placeholders below — replace with real values when capturing the screenshot)

This file documents the third gate of Phase 1's three-gate FTMS verification
strategy (CONTEXT.md D-03 / D-03b): a one-shot manual check that a real-world
FTMS-aware decoder (Nordic's nRF Connect) reads the encoder's output back to
the source `IndoorBikeRecord` values.

This is the only genuinely third-party check in the loop. Gates A (hand-computed
byte fixtures) and B (hand-rolled spec-cited decoder round-trip) both depend on
us reading the spec correctly; nRF Connect reads the spec the way the BLE
ecosystem does. If gates A and B pass but nRF Connect shows wrong values, the
spec mis-read is in OUR encoder, not in nRF Connect.

## Procedure

1. From the repo root, run: `npx tsx scripts/nrf-connect-demo.ts`. Note the
   printed hex bytes for Reference Payloads 1 and 5.
2. Open nRF Connect on a phone (Android: Play Store; iOS: App Store).
3. Pick one of these methods to feed the encoder bytes through nRF Connect:
   - **Option A — Advertiser mode (if your phone supports peripheral
     advertising):** New advertisement set → Service Data → UUID `0x1826`
     (Fitness Machine Service). Paste the hex bytes from Payload 1 (and/or 5).
     Start advertising. Use a second phone in Scanner mode to read and decode
     the IndoorBikeData characteristic.
   - **Option B — Hex viewer / manual decode:** Use the Bytes ↔ Hex tool, paste
     the bytes, and read off the LE fields:
     - bytes 0-1 (Flags, LE uint16): expect `0x0045` (Payload 1) or `0x0044`
       (Payload 5)
     - For Payload 1: bytes 2-3 = Cadence wire (`0x00B4` = 180 → divide by 2 →
       90 rpm), bytes 4-5 = Power sint16 (`0x00C8` = 200 W).
     - For Payload 5: bytes 2-3 = Speed wire (`0x0BB8` = 3000 → ×0.01 = 30
       km/h), bytes 4-5 = Cadence wire (`0x0078` = 120 → ÷2 = 60 rpm), bytes
       6-7 = Power sint16 (`0x0064` = 100 W).
   - **Option C — Real BLE peripheral over a radio:** Out of scope for v1
     (D-14); v2 only.
4. Capture a phone screenshot of nRF Connect (or the chosen tool) showing the
   decoded values for at least Payload 1. Save it to:
   `.planning/phases/01-vendored-ftms-codec/nrf-connect-verification.png` (must
   be ≥ 50 KB — the real-screenshot floor).
5. Fill in the placeholders below.

## Verification Record

- **Date of verification:** `2026-05-14`
- **Phone make/model:** ``
- **nRF Connect version:** ``
- **Method used:** `B`

## Observed Decoded Values

### Reference Payload 1 — `{power: 200, cadence: 90}` → `45 00 B4 00 C8 00`

| Field   | Source value | Decoded value (observed) | Match? |
| ------- | ------------ | ------------------------ | ------ |
| Cadence | 90 rpm       | `90 rpm`                 | yes    |
| Power   | 200 W        | `200 W`                  | yes    |

### Reference Payload 5 — `{power: 100, cadence: 60, speed: 30}` → `44 00 B8 0B 78 00 64 00`

| Field   | Source value | Decoded value (observed) | Match? |
| ------- | ------------ | ------------------------ | ------ |
| Speed   | 30 km/h      | `30 km/h`                | yes    |
| Cadence | 60 rpm       | `60 rpm`                 | yes    |
| Power   | 100 W        | `100 W`                  | yes    |

## Outcome

`matched`

Notes on any anomalies, off-by-one observations, or platform-specific quirks
(e.g., one decoder app showing power as 65336 due to a uint16 mis-read):

> `none`

## Sign-off

Verified by `Agnivesh Patel`.

## Screenshot

The phone screenshot is committed alongside this file at
[`nrf-connect-verification.png`](./nrf-connect-verification.png). Expected size:
≥ 50 KB (real-screenshot floor — rejects 1×1 placeholders and trivially small
files).
