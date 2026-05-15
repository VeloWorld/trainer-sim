// Pure function from the parser's parsed-record output to `RideRecord[]`.
//
// Implements (per .planning/phases/02-fit-loader-normalization/02-CONTEXT.md):
//   - D-FIT-01: `undefined` is preserved as `undefined` (omitted property),
//     `0` is preserved as `0`. Wire-level distinction between "no signal" and
//     "rider coasting" stays intact end-to-end (Phase 1's encoder gates the
//     FTMS flag bit on `value === undefined`).
//   - D-FIT-02: autopause gaps are NOT backfilled — emitted as-recorded so
//     Phase 3's scheduler owns the gap policy.
//   - D-FIT-03: sort ascending by timestamp; drop exact-duplicate timestamps
//     keep-first. Real Garmin/Wahoo files occasionally emit out-of-order or
//     duplicate `record` messages; enforcing ordering here spares Phase 3
//     defensive monotonic-timestamp checks.
//   - D-FIT-09: drop / reorder counts surface only via
//     `util.debuglog('trainer-sim:fit')` — public return shape stays
//     `RideRecord[]`. Set `NODE_DEBUG=trainer-sim:fit` to see counts.
//
// NO parser import here — normalize is parser-agnostic by design (the
// D-FIT-08 `FitRecordSource` seam lives in `src/fit/loader.ts`). The input
// shape is a minimal local interface so a parser swap is a one-file change.
//
// Implementation notes:
//   - `rec.timestamp` from the parser 3.0 is a JavaScript `Date` object (the
//     parser already applies the FIT-epoch offset internally). We extract
//     Unix epoch ms via `.getTime()`. RESEARCH §Pitfall 1.
//   - `rec.power !== undefined` and `rec.cadence !== undefined` — explicit
//     undefined checks (NOT `??`, NOT truthy). `??` would collapse a real `0`
//     to "no signal"; truthy checks would do the same. RESEARCH §Pitfall 6.
//   - The parser's first-record-elapsed quirk (RESEARCH §Pitfall 8) does not
//     affect us: we read only timestamp / power / cadence. Don't add reads of
//     the elapsed-or-timer keys without re-checking that pitfall.

import { debuglog } from 'node:util';
import type { RideRecord } from '../types.js';

const log = debuglog('trainer-sim:fit');

/**
 * Minimal compile-time-only contract for parser output. Loader passes the full
 * parser result; normalize consumes only `records`.
 */
interface ParsedFitMinimal {
  records?: ReadonlyArray<{
    timestamp?: Date;
    power?: number;
    cadence?: number;
  }>;
}

/**
 * Map ParsedRecord[] → RideRecord[], applying D-FIT-01..03 + D-FIT-09 semantics.
 * Pure (no I/O); safe to call repeatedly.
 */
export function normalize(parsed: ParsedFitMinimal): RideRecord[] {
  const records = parsed.records ?? [];

  // Step 1 — Map. Skip records without a timestamp defensively (shouldn't
  // happen on valid FIT, but the parser's type marks it optional so we honor
  // that). For each record with a timestamp, build a RideRecord starting with
  // `timestamp: getTime()`, then conditionally set `power`/`cadence` ONLY when
  // explicitly !== undefined — preserves wire `0` per D-FIT-01.
  const mapped: RideRecord[] = [];
  for (const rec of records) {
    if (!rec.timestamp) continue;
    const ride: RideRecord = { timestamp: rec.timestamp.getTime() };
    if (rec.power !== undefined) ride.power = rec.power;
    if (rec.cadence !== undefined) ride.cadence = rec.cadence;
    mapped.push(ride);
  }

  // Step 2 — Count out-of-order BEFORE sorting (each adjacent inversion is one
  // out-of-order record). This is the count we surface via debuglog.
  let outOfOrder = 0;
  for (let i = 1; i < mapped.length; i++) {
    if (mapped[i]!.timestamp < mapped[i - 1]!.timestamp) outOfOrder++;
  }

  // Step 3 — Sort ascending by timestamp.
  const sorted = mapped.slice().sort((a, b) => a.timestamp - b.timestamp);

  // Step 4 — Dedup keep-first. Walk sorted and push only when the current
  // timestamp differs from the last-emitted timestamp. `-1` is a safe initial
  // sentinel because Unix-epoch-ms timestamps are positive.
  const final: RideRecord[] = [];
  let lastTs = -1;
  let duplicates = 0;
  for (const r of sorted) {
    if (r.timestamp === lastTs) {
      duplicates++;
      continue;
    }
    final.push(r);
    lastTs = r.timestamp;
  }

  // Step 5 — Surface drop / reorder counts via util.debuglog only when
  // anything was dropped. D-FIT-09: public API stays array-returning; counts
  // are observable when `NODE_DEBUG=trainer-sim:fit` is set, otherwise no-op.
  if (outOfOrder + duplicates > 0) {
    log(
      'normalize: %d duplicates dropped, %d out-of-order records reordered (input %d -> output %d)',
      duplicates,
      outOfOrder,
      mapped.length,
      final.length,
    );
  }

  return final;
}
