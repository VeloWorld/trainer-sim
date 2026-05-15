# Phase 2 FIT Fixtures

Test-only `.fit` fixtures used by the Phase 2 vitest suites. Bytes are
committed once; the scrubber and shadow-generator are committed for
reproducibility but never run in CI.

Per **D-FIT-04** (two-tier fixture strategy), these are the **CI tier** —
runs in CI, no external dependencies, fully reproducible. The local-dev
tier (developer's actual Garmin/Wahoo exports) is gated on the
`TEST_FIT_DIR` env var and is not committed.

Per **D-FIT-05** (scrubbing approach + shadow carve-out), six of these
fixtures come from scrubbing the developer's outside-of-repo cycling-app
corpus — timestamps re-anchored to `2025-01-01T00:00:00 UTC`, GPS lat/lon
zeroed, device serials cleared, `user_profile` cleared. Power, cadence,
heart rate, dev fields, and gap structure are preserved verbatim because
those are the test signals each fixture exists to exercise. The shadow
fixture is hand-rolled (no source-corpus file exercises the
developer-field-shadow path; see `D-FIT-10`).

DO NOT modify these bytes by hand — re-run the scrubber or generator
(see Reproducibility section below). Hand edits will silently invalidate
the CRC trailer and break the parser.

## basic.fit

- **Source:** `ROUVY_Tutorial_ride.fit` (lives outside repo at
  `/Users/agniveshpatel/dev/agni21/test-sim/data/`; NOT committed)
- **Scrub date:** 2026-05-16
- **Records:** 443
- **Duration:** ~7 min (1Hz dense)
- **Structural anomalies:** clean 1Hz, no developer fields,
  28 zero-power records (preserved per D-FIT-01)
- **Test case mapping:** **FIT-01** (basic path/buffer parity baseline)
  and partial **FIT-04** (zero-power preservation)

## zero-power.fit

- **Source:** `Wahoo_RGT_Siddhnath_Loop_2_Quick_Ride.fit` (NOT committed)
- **Scrub date:** 2026-05-16
- **Records:** 541
- **Duration:** ~9 min (1Hz dense, 142 zero-power records)
- **Structural anomalies:** 142 records carry a real `0` watt power
  reading. The fixture exists to verify the loader preserves
  `power: 0` (rider coasting) distinct from `power: undefined`
  (sensor disconnected). Definition messages use **big-endian arch**
  (`arch=1`) — the scrubber is arch-aware to preserve byte order.
- **Test case mapping:** **FIT-04** real-`0`-watts preservation per
  **D-FIT-01**

## duplicates.fit

- **Source:** `The_Sufferfest_Getting_Started.fit` (NOT committed)
- **Scrub date:** 2026-05-16
- **Records:** 702
- **Duration:** ~11 min
- **Structural anomalies:** **13 duplicate timestamps** (verified pre-scrub
  in 02-CONTEXT.md mapping table). The scrubber preserves intra-file
  timestamp deltas, so the duplicates carry across.
- **Test case mapping:** **D-FIT-03** dedup-keep-first +
  drop-count `util.debuglog`

## dev-fields-non-shadow.fit

- **Source:** `MyWhoosh_Nomad_Trail.fit` (NOT committed)
- **Scrub date:** 2026-05-16
- **Records:** 2501
- **Duration:** ~42 min
- **Structural anomalies:** 4 developer-defined fields
  (`UUID`, `Title`, `CurrentRouteId`, `IsEvent`) — all
  **non-shadowing** (none collide with `power` / `cadence` /
  `timestamp`). Confirms dev fields can be present and harmless;
  the loader's debuglog warning is silent.
- **Test case mapping:** dev-fields-present-but-non-shadow path
  (counterpart to `shadow.fit` below)

## autopause.fit

- **Source:** `Zwift_Wave_Rider_on_Hilltop_Hustle_in_Watopia.fit` (NOT
  committed)
- **Scrub date:** 2026-05-16
- **Records:** 3172
- **Duration:** ~54 min (1Hz dense with **2 timestamp gaps, max 68 s**)
- **Structural anomalies:** autopause gaps preserved per **D-FIT-02**
  (loader emits records exactly as recorded; gap policy is Phase 3's
  problem). Plus one benign developer field `target_power` (watts,
  non-shadowing — the standard `power` slot is intact).
- **Test case mapping:** **FIT-04** autopause-gap-no-throw +
  benign-dev-field

## perf-1hr.fit

- **Source:** `Zwift_FTP_Test_in_Makuri_Islands.fit` (NOT committed)
- **Scrub date:** 2026-05-16
- **Records:** 4562
- **Duration:** ~76 min (1Hz dense, clean)
- **Structural anomalies:** none — this is the perf-gate fixture.
- **Test case mapping:** **FIT-02** perf gate (`<100 ms` parse for a
  ~1-hour file per ROADMAP.md)

## shadow.fit

- **Source:** Hand-rolled by `test/fixtures/generate-shadow.ts`
  (which consumes shared FIT-byte helpers from
  `test/fixtures/minimal-fit-bytes.ts`)
- **Scrub date:** 2026-05-16 (n/a — this fixture is hand-built, not scrubbed)
- **Records:** 30
- **Duration:** 30 s synthetic (1Hz, anchored to the same
  `2025-01-01T00:00:00 UTC` epoch as the scrubbed fixtures)
- **Structural anomalies:** ONE developer-defined field named `power`
  (`developer_data_index=0`, `field_definition_number=0`, base type
  uint16). `fit-file-parser` 3.0 collides this onto the standard
  `record.power` slot — verified by parse-back: `record.power === 999`
  (the dev value), NOT 200 (the standard value). **D-FIT-05 carve-out:**
  no source-corpus file declares a dev field named `power`, so this
  case must be hand-rolled.
- **Test case mapping:** **FIT-05** (per the 2026-05-16 amendment in
  `REQUIREMENTS.md`) and **D-FIT-10** — non-fatal `util.debuglog`
  warning at the loader boundary, no throw.

## PII attestation

All six scrubbed fixtures had the following PII fields rewritten in place
by `test/fixtures/scrub.ts` on `2026-05-16`:

- **Timestamps:** re-anchored to a fixed synthetic epoch
  `2025-01-01T00:00:00 UTC`. Offset computed in FIT-second space relative
  to each source file's first `record.timestamp`, then applied to every
  timestamp field in every message (records, events, sessions, laps,
  `file_id.time_created`, `device_info.timestamp`, `activity.timestamp`,
  `activity.local_timestamp`, etc.). Intra-file timestamp deltas — gap
  durations, dupe spacing, autopause gaps, total-ride length — are
  preserved verbatim. Only the absolute origin moves.
- **GPS lat/lon:** zeroed (`sint32 = 0`) on `record`, `session`, `lap`.
- **Device serials:** cleared to FIT invalid sentinel
  (`uint32z = 0x00000000`) on `file_id`, `device_info`.
- **`user_profile` messages:** all fields cleared to FIT invalid
  sentinels per base type.

Power, cadence, heart rate, developer-field bytes, definition messages,
record count, and message order are **preserved unchanged** — those are
the test signals each fixture exists to exercise. CRC-16/ARC trailers
are recomputed after rewriting; the 14-byte file-header CRC is
recomputed too.

Source files at `/Users/agniveshpatel/dev/agni21/test-sim/data/` are
**NOT** in git and live outside this repository.

## License attestation

Cycling-app FIT exports are user-generated ride data. The bytes are not
copyrightable; the structural shape we preserve (record count, dev
fields, gap structure) is information, not creative expression. The
`trainer-sim` repository's **MIT** license applies to the scrubbed
output bytes as authored synthetic test data, mirroring the Phase 1
`test/fixtures/README.md` posture for the hand-rolled FTMS decoder.

The hand-rolled `shadow.fit` and the byte writers in
`test/fixtures/minimal-fit-bytes.ts` and `test/fixtures/generate-shadow.ts`
are MIT-licensed alongside the rest of this repo.

## Smart-recording carve-out

All six scrubbed corpus files are 1Hz dense cycling-app exports, **NOT**
Garmin-device smart-recording (which uses a variable interval that
adapts on motion change). The Sufferfest's 13 duplicate timestamps and
Zwift's 68 s autopause gaps cover irregular-interval edge cases
pragmatically. **Smart-recording variable-interval files are not in the
corpus and this case is documented as known-not-tested in v1**; if a
real smart-recording file mis-decodes later, drop it into the source
corpus and re-run the scrubber.

## Reproducibility

```sh
# Six scrubbed CI fixtures (source corpus must exist locally)
npx tsx test/fixtures/scrub.ts \
  --src /Users/agniveshpatel/dev/agni21/test-sim/data \
  --out test/fixtures/fit

# The shadow.fit hand-rolled fixture (consumes test/fixtures/minimal-fit-bytes.ts)
npx tsx test/fixtures/generate-shadow.ts
```

Neither command is part of any `package.json` script — CI never runs
them. The bytes are byte-identical commits.

**DO NOT modify these bytes by hand.** Hand edits will silently break
the CRC trailer; the parser will reject the file or, worse, accept it
and yield wrong records. Re-run the appropriate generator.

## What NOT to add here

- **Real un-scrubbed Garmin/Wahoo/Zwift/etc. exports** — they leak GPS,
  HR, device serials, user IDs. Pass any new fixture through the
  scrubber first.
- **`@garmin/fitsdk`** — D-FIT-08 LOCKED to `fit-file-parser`; the
  Garmin SDK is not even a dev-dep of this repo (D-FIT-05 chose the
  scrubber path over the Garmin-encoder path).
- **Bundled fixture files exposed at runtime** — `PROJECT.md` "Out of
  Scope" forbids this; `package.json` `files: ["dist", "README.md",
  "LICENSE.md"]` already excludes `test/`. Do not add `test/` to the
  publish allowlist.
- **Synthetic CSV ride data** — `PROJECT.md` "Out of Scope" forbids
  this; real or scrubbed FIT only.
