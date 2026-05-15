/**
 * First typed-error hierarchy in trainer-sim. Future phases (replay timeouts,
 * transport failures, etc.) follow the same `extends FitLoadError`-style
 * pattern: an abstract base + concrete leaf classes whose `name` propagates
 * via `this.constructor.name`.
 *
 * Per D-FIT-06 (.planning/phases/02-fit-loader-normalization/02-CONTEXT.md):
 * fail-fast on **corrupt** input. Valid-but-weird input (autopause gaps,
 * sparse cadence, null power, non-shadow developer fields) is the happy path
 * and does NOT throw — that's FIT-04's "load without throwing on weird shapes."
 *
 * **Deliberate non-member: there is NO developer-field-shadow error class.**
 * Per D-FIT-10 + the FIT-05 amendment in REQUIREMENTS.md (locked 2026-05-16),
 * developer-defined-field name collisions on standard `record` fields (e.g.
 * TrainerRoad's `"power"`) are NON-FATAL: the loader emits
 * `util.debuglog('trainer-sim:fit')` and returns the parser's result as-is.
 * Adding a typed shadow-error class here would invite future code to throw
 * it, breaking the locked behavior. The research example in 02-RESEARCH.md
 * §Code Examples Example 3 predates D-FIT-10 and is stale on this point —
 * the shadow class shown there must NOT be carried into this hierarchy.
 */

/**
 * Abstract base for all FIT-load failures. Consumers can catch the base for
 * generic handling (`catch (e) { if (e instanceof FitLoadError) ... }`) or
 * narrow on a concrete subclass for specific recovery. Marked `abstract` so
 * `new FitLoadError(...)` is a compile-time error — every throw site picks a
 * concrete subclass.
 */
export abstract class FitLoadError extends Error {
  constructor(message: string) {
    super(message);
    // Stack traces identify the concrete class (InvalidFitHeaderError, etc.)
    // rather than the generic "Error" — set in the base so subclasses stay
    // bodyless.
    this.name = this.constructor.name;
  }
}

/** Bad magic / wrong header bytes / header length not 12 or 14. */
export class InvalidFitHeaderError extends FitLoadError {}

/**
 * CRC-16/ARC mismatch. trainer-sim computes this itself because
 * `fit-file-parser` 3.0 has the CRC verification TODO-commented-out
 * (per .planning/phases/02-fit-loader-normalization/02-RESEARCH.md §Critical Finding).
 */
export class FitCrcError extends FitLoadError {}

/** File ends mid-header / mid-data / mid-CRC-trailer. */
export class FitTruncatedError extends FitLoadError {}

/**
 * Valid FIT (header + CRC + parses cleanly) but contains zero `record`
 * messages — typical of workout-only files or GPX exports mislabeled as FIT.
 */
export class NoRecordMessagesError extends FitLoadError {}
