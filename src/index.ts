/** trainer-sim public API. Phase 1: encoder + type. Phase 2: FIT loader + types + errors. Phase 4: FakeTransport public surface (createFakeTransport + ITrainerTransport / FakeTransport / FakeTransportConfig / FakeTransportSource). */

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

// Phase 4: FakeTransport public surface (D-API-07).
export { createFakeTransport } from './transport/fake-transport.js';
export type {
  ITrainerTransport,
  FakeTransport,
  FakeTransportConfig,
  FakeTransportSource,
} from './types.js';
