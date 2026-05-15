/** trainer-sim public API. Phase 1: encoder + type. Phase 2: FIT loader + types + errors. Phase 4 will add ITrainerTransport and createFakeTransport. */

export { encodeIndoorBikeData } from './ftms/indoor-bike-data.js';
export type { IndoorBikeRecord } from './ftms/indoor-bike-data.js';

// Phase 2: FIT loader and normalization. RideRecord is type-only (the
// `verbatimModuleSyntax: true` tsconfig requires `export type` so tsup does
// not emit a runtime no-op export). The four FitLoadError classes are
// runtime values (constructors with `instanceof` semantics) and MUST NOT be
// re-exported with the `type` keyword. FitLoadError is exported as a value
// even though it is `abstract` — consumers cannot `new FitLoadError(...)`
// (TS catches that at compile time), but the constructor reference is what
// `e instanceof FitLoadError` needs at runtime.
export { loadFitFromPath, loadFitFromBuffer } from './fit/loader.js';
export type { RideRecord } from './types.js';
export {
  FitLoadError,
  InvalidFitHeaderError,
  FitCrcError,
  FitTruncatedError,
  NoRecordMessagesError,
} from './fit/errors.js';
