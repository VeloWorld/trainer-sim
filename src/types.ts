/**
 * Shared types for trainer-sim. Phase 2 introduces `RideRecord` — the contract
 * Phase 3 (replay engine) iterates over and Phase 4 (FakeTransport) consumes.
 * Future phases (Phase 4 `ITrainerTransport`, library-wide `Config`) extend
 * this file rather than scattering types across modules.
 *
 * Locked decisions:
 *   - D-FIT-01 (.planning/phases/02-fit-loader-normalization/02-CONTEXT.md):
 *     `RideRecord` shape is `{ timestamp: number; power?: number; cadence?: number }`.
 *     Optional fields use `undefined` (omitted property) for absent signals;
 *     a real `0` from the FIT wire stays `0`. This preserves the wire-level
 *     distinction between "rider coasting" and "no sensor reading" — Phase 1's
 *     IndoorBikeData encoder gates the FTMS flag bit on `value === undefined`,
 *     and collapsing absent → 0 here would silently emit a flag-bit-cleared
 *     payload claiming 0 W power. Don't.
 *   - FIT-03 (.planning/REQUIREMENTS.md): timestamp is Unix epoch ms, NOT FIT
 *     epoch (FIT epoch = seconds since 1989-12-31 UTC). The loader (plan 02-03)
 *     applies the offset; downstream code only ever sees Unix ms.
 */

/**
 * One sample from a parsed FIT ride file. The replay engine emits these to
 * subscribers in timestamp order; the FTMS encoder turns them into wire bytes.
 */
export interface RideRecord {
  /**
   * Unix epoch milliseconds (NOT FIT epoch — the 1989-12-31 UTC offset has
   * been applied by the loader). FIT-03.
   */
  timestamp: number;

  /**
   * Watts. `undefined` = no power signal (sensor disconnected, file lacks the
   * field, FIT invalid sentinel). `0` = rider coasting / freewheeling. Do NOT
   * collapse `undefined` to `0` — Phase 1's encoder gates the FTMS flag bit on
   * `value === undefined`, and the wire-level distinction between "no signal"
   * and "0 W" is the whole point of D-FIT-01.
   */
  power?: number;

  /**
   * RPM. Same absent-vs-zero semantics as `power`: `undefined` = no cadence
   * sensor reading; `0` = pedals stopped.
   */
  cadence?: number;
}
