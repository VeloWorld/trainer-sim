# Test Fixtures

Test-only artifacts used by the vitest suites. Nothing here is published or
imported by `src/`.

## ftms-decoder.ts

**Provenance:** Hand-rolled in this repo, MIT-licensed (matches the package
license).

**Spec source:** Bluetooth SIG Fitness Machine Service v1.0.1 §4.9 "Indoor
Bike Data" characteristic (UUID 0x2AD2). Each field decision (type,
resolution, flag bit, inversion) is annotated in the source with the exact
spec clause and the matching PITFALLS.md citation.

**Why hand-rolled:** Auuki's `src/ble/ftms/indoor-bike-data.js` is **AGPL-3.0**
(verified GitHub API `license.spdx_id == 'AGPL-3.0'`); vendoring or
submoduling it would contaminate this MIT repo. PyFTMS
(`dudanov/python-pyftms`) is Apache-2.0 but Python — out of scope per
CONTEXT.md D-01 (in-process JS only). See `01-RESEARCH.md` §Auuki Decoder
Consumption for the full option matrix.

**Independence:** Authored from the FTMS v1.0.1 spec, **NOT** by inverting
`src/ftms/indoor-bike-data.ts` (which lands in plan 03 and does not exist
yet at the time this fixture is authored). Per CONTEXT.md D-02, this
independence is the entire point of the round-trip gate exercised in plan 04
— a shared spec mis-read must happen in two independent places to slip
through. If a future PR rewrites this fixture by reading the encoder, the
gate degrades to a self-consistency check and silently loses its value.

**Phase 4+ note:** When `@veloworld/ftms-codec` is extracted from `src/ftms/`,
this decoder stays here as a test-only artifact. REQUIREMENTS.md "Out of
Scope" forbids FTMS decode in `src/`.

**Pitfalls correctly addressed (PITFALLS.md):**

| Pitfall | Trap | Decoder handling |
|---------|------|------------------|
| #1 | Bit 0 ("More Data") is INVERTED — `0 = speed present` | `(flags & (1 << SPEED_BIT)) === 0` (the `=== 0` is load-bearing) |
| #2 | Auuki encodes power as Uint16; spec says sint16 | `view.getInt16(offset, true)` for power |
| #3 | Cadence is uint16 with 0.5 rpm resolution; wire = rpm × 2 | `view.getUint16(offset, true) * 0.5` |
| #4 | DataView defaults to **big-endian**; LE must be explicit | Every multi-byte read passes `true` as the second arg |

## What NOT to add here

- **Auuki source code** — AGPL-3.0; see CONTEXT.md D-03c. Reading offline as
  a sanity check while authoring is fine; vendoring/submoduling/importing is
  a license violation.
- **Bundled fixture FIT files** — PROJECT.md Out of Scope. Consumers bring
  their own FIT files; tests should generate minimal synthetic FITs at
  runtime rather than committing real rides (real rides leak GPS / HR / device
  serials).
