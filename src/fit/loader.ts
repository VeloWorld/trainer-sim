// Phase 2 entry points. Wraps the FIT parser dependency behind a
// FitRecordSource seam (D-FIT-08) so the parser is a one-file swap. Validates
// header + CRC ourselves because the underlying parser 3.0 has both checks
// TODO-commented-out (verified at fit-parser.ts:105/:122 per RESEARCH
// §Critical Finding). Developer-field shadow handling is debuglog-only per
// D-FIT-10 (FIT-05 amended 2026-05-16) — does NOT throw.
//
// Locked decisions:
//   - D-FIT-06: typed FitLoadError hierarchy thrown on corrupt input.
//   - D-FIT-07: two entry points; loadFitFromBuffer is sync (exploits the
//     parser's sync-callback property — RESEARCH §Open Questions #3 / A1).
//   - D-FIT-08: single FitParser import in src/, wrapped in a one-file
//     adapter behind a compile-time FitRecordSource interface.
//   - D-FIT-10: dev-field shadow on standard names is non-fatal — debuglog
//     only, never throw. RESEARCH §Pattern 3 (which says "throw") is
//     SUPERSEDED by D-FIT-10. Do NOT reintroduce a typed shadow-error class.

// D-VW-10 (Phase 5): trainer-sim is bundleable into browser/renderer contexts.
// `node:fs/promises.readFile` is reachable only from `loadFitFromPath` (Node-
// only by definition); the browser build aliases this shim to a stub that
// throws a descriptive error if `loadFitFromPath` is called. The Buffer import
// is gone — the loader operates on `Uint8Array` end-to-end. The debuglog
// import routes through an isomorphic shim (real in Node, no-op in browser).
import { readFile } from '../_internal/read-file.js';
import { debuglog } from '../_internal/debuglog.js';
// THE SINGLE PARSER IMPORT IN ALL OF src/. No other src/* file may import
// this module — D-FIT-08 seam (acceptance grep enforces).
import FitParser from 'fit-file-parser';
import type { RideRecord } from '../types.js';
import { normalize } from './normalize.js';
import {
  InvalidFitHeaderError,
  FitCrcError,
  FitTruncatedError,
  NoRecordMessagesError,
} from './errors.js';

const log = debuglog('trainer-sim:fit');

/**
 * Standard `record`-message field names we surface a debuglog for when a
 * developer-defined field collides. `power` is the FIT-05 case (TrainerRoad
 * exports historically declare a developer `power` field that the underlying
 * parser collides onto `record.power`). `cadence` and `timestamp` are
 * speculative coverage for future widening — RideRecord today only consumes
 * `timestamp` and `power`, but debuglog visibility costs nothing.
 */
const SHADOWED_STANDARD_FIELD_NAMES = new Set(['power', 'cadence', 'timestamp']);

/**
 * CRC-16/ARC table (16-entry form per the FIT SDK PDF). Copied verbatim from
 * the underlying parser's `binary.ts:21-35`; identical bytes appear in the
 * Garmin FIT SDK source. RESEARCH §Pattern 2.
 */
const CRC_TABLE = [
  0x0000, 0xCC01, 0xD801, 0x1400, 0xF001, 0x3C00, 0x2800, 0xE401,
  0xA001, 0x6C00, 0x7800, 0xB401, 0x5000, 0x9C01, 0x8801, 0x4400,
];

/**
 * Compute CRC-16/ARC over `buf[start..end)`. Used to validate the FIT file's
 * trailing CRC — the underlying parser has the corresponding check
 * TODO-commented-out (RESEARCH §Pitfall 4), so D-FIT-06's `FitCrcError` is
 * meaningless unless we do it ourselves. Bracket access uses `!` because of
 * `noUncheckedIndexedAccess` in tsconfig; the loop bounds guarantee the
 * indices are in range.
 */
function crc16Arc(buf: Uint8Array, start: number, end: number): number {
  let crc = 0;
  for (let i = start; i < end; i++) {
    let tmp = CRC_TABLE[crc & 0xF]!;
    crc = (crc >> 4) & 0x0FFF;
    crc = crc ^ tmp ^ CRC_TABLE[buf[i]! & 0xF]!;
    tmp = CRC_TABLE[crc & 0xF]!;
    crc = (crc >> 4) & 0x0FFF;
    crc = crc ^ tmp ^ CRC_TABLE[(buf[i]! >> 4) & 0xF]!;
  }
  return crc;
}

/**
 * Two-phase pre-flight (RESEARCH §Pattern 2): validate the FIT header and
 * recompute the trailer CRC BEFORE handing bytes to the parser. Throws the
 * D-FIT-06 typed errors so consumers can `catch (e instanceof FitLoadError)`.
 *
 * Header layout (FIT SDK):
 *   - byte 0: header length (12 or 14)
 *   - bytes 1..3: protocol_version, profile_version (we don't validate)
 *   - bytes 4..7: data length, uint32 LE
 *   - bytes 8..11: magic '.FIT'
 *   - bytes 12..13 (only when header is 14 bytes): header CRC (we DON'T
 *     re-validate; only the trailer CRC matters for body integrity)
 *
 * Trailer:
 *   - bytes [headerLength + dataLength .. +1]: file CRC, uint16 LE
 *   - For 12-byte headers, the trailer CRC covers `[0, crcStart)`.
 *   - For 14-byte headers, the trailer CRC covers `[14, crcStart)` — the
 *     14-byte header has its own CRC at [12..13] which we don't re-validate.
 */
function validateHeaderAndCrc(buf: Uint8Array): void {
  if (buf.length < 14) {
    throw new FitTruncatedError(
      `expected >=14 bytes (12-byte header + 2-byte CRC), got ${buf.length}`,
    );
  }
  const headerLength = buf[0]!;
  if (headerLength !== 12 && headerLength !== 14) {
    throw new InvalidFitHeaderError(
      `header length must be 12 or 14, got ${headerLength}`,
    );
  }
  // Magic '.FIT' at offset 8..11.
  const magic = String.fromCharCode(buf[8]!, buf[9]!, buf[10]!, buf[11]!);
  if (magic !== '.FIT') {
    throw new InvalidFitHeaderError(
      `magic mismatch: expected '.FIT', got '${magic}'`,
    );
  }
  // Data length is uint32 LE at offset 4.
  const dataLength =
    buf[4]! | (buf[5]! << 8) | (buf[6]! << 16) | (buf[7]! << 24);
  const totalExpected = headerLength + dataLength + 2;
  if (buf.length < totalExpected) {
    throw new FitTruncatedError(
      `expected ${totalExpected} bytes, got ${buf.length}`,
    );
  }
  const crcStart = headerLength + dataLength;
  const crcExpected = buf[crcStart]! | (buf[crcStart + 1]! << 8);
  // 12-byte header → CRC covers [0, crcStart); 14-byte header → CRC covers
  // [14, crcStart). Plan 02-02's scrubber/writer module honors this same
  // convention; verified against fit-file-parser/dist/fit-parser.js:69.
  const crcRangeStart = headerLength === 12 ? 0 : 14;
  const crcActual = crc16Arc(buf, crcRangeStart, crcStart);
  if (crcActual !== crcExpected) {
    throw new FitCrcError(
      `CRC mismatch: expected 0x${crcExpected.toString(16).padStart(4, '0')}, ` +
        `got 0x${crcActual.toString(16).padStart(4, '0')}`,
    );
  }
}

/**
 * Minimal compile-time-only contract for parser output. Loader consumes only
 * `records` and `field_descriptions` from the parser's much-richer ParsedFit
 * shape. Intentionally NOT exported — D-FIT-08 internal seam.
 */
interface ParsedFitMinimal {
  records?: ReadonlyArray<{
    timestamp?: Date;
    power?: number;
    cadence?: number;
  }>;
  field_descriptions?: ReadonlyArray<{
    field_name?: string;
    developer_data_index?: number;
    field_definition_number?: number;
  }>;
}

/**
 * The parser-swap seam. Compile-time-only TypeScript interface (per CONTEXT
 * "Claude's Discretion": lighter than runtime; promote to runtime only if the
 * test seam demands it). Intentionally NOT exported — internal implementation
 * detail; future swap to `@garmin/fitsdk` is one new factory function on the
 * underlying parser, not a public-API change.
 */
interface FitRecordSource {
  parse(buffer: Uint8Array): ParsedFitMinimal;
}

/**
 * Adapter that wraps the underlying FIT parser. The single import in this
 * file. Pins `mode: 'list'` explicitly because RESEARCH §Pitfall 2 documents
 * a README/source mismatch (README claims default 'cascade', source uses
 * 'list'); pinning is defense-in-depth against future-version drift.
 *
 * Uses the sync-callback `parse(buf, callback)` form rather than parseAsync
 * so the public `loadFitFromBuffer` stays sync per D-FIT-07. The callback
 * fires synchronously for the parser we depend on (RESEARCH §Open Questions
 * #3 / A1) — the parser pin in package.json is tilde-locked so a minor bump
 * requires intentional evaluation.
 */
function makeFitFileParserSource(): FitRecordSource {
  return {
    parse(buffer) {
      const parser = new FitParser({ mode: 'list', force: false });
      let parsed: ParsedFitMinimal | undefined;
      let firstError: string | undefined;
      // fit-file-parser's getArrayBuffer (binary.js:426) accepts anything with
      // numeric `.length` and `[i]` indexing — Buffer or Uint8Array both pass
      // at runtime. The package's `.d.ts` types it as `ArrayBuffer | Buffer`,
      // so we cast through `unknown` to avoid a structural-Buffer comparison
      // (Uint8Array is missing Buffer's ~70 Node-specific methods, but the
      // parser never calls them — verified by reading binary.js:426). The
      // cast is the cost of staying browser-bundleable without dragging in a
      // Buffer polyfill.
      parser.parse(buffer as unknown as ArrayBuffer, (err, data) => {
        if (err && firstError === undefined) firstError = err;
        else if (data && parsed === undefined) parsed = data as ParsedFitMinimal;
      });
      if (!parsed) {
        // Header / magic should have been caught by validateHeaderAndCrc
        // already, so anything left here is "truncated" territory.
        throw new FitTruncatedError(
          `fit-file-parser rejected the input: ${firstError ?? 'unknown error'}`,
        );
      }
      return parsed;
    },
  };
}

/**
 * Single shared adapter instance. The parser itself is constructed per-parse
 * (it's stateful per call); the adapter just routes.
 */
const source: FitRecordSource = makeFitFileParserSource();

/**
 * D-FIT-10 implementation: when a FIT file declares a developer field whose
 * lowercased `field_name` matches a watched standard name, emit a
 * `util.debuglog('trainer-sim:fit')` warning and CONTINUE. Does NOT throw.
 * Does NOT mutate `parsed.records`.
 *
 * RESEARCH §Pattern 3 / Code Examples Example 1 show "throw the
 * stale-name shadow-error class" — that guidance is SUPERSEDED by D-FIT-10
 * (FIT-05 amended 2026-05-16). Do NOT reintroduce a throw here.
 */
function detectAndLogShadow(parsed: ParsedFitMinimal): void {
  for (const desc of parsed.field_descriptions ?? []) {
    const name = desc.field_name?.toLowerCase();
    if (name && SHADOWED_STANDARD_FIELD_NAMES.has(name)) {
      log(
        'developer field shadow detected on standard field %s ' +
          '(developer_data_index=%d, field_definition_number=%d) — ' +
          'fit-file-parser collides developer value onto record.%s; ' +
          'returning whatever parser produced (D-FIT-10)',
        name,
        desc.developer_data_index,
        desc.field_definition_number,
        name,
      );
    }
  }
}

/**
 * Synchronous entry point. Validates header + CRC, parses, detects dev-field
 * shadow (debuglog only), then delegates to `normalize`. Throws all four
 * `FitLoadError` subclasses on appropriate corruption (D-FIT-06).
 *
 * Sync per D-FIT-07 — exploits the parser's sync-callback property.
 */
export function loadFitFromBuffer(input: Uint8Array): RideRecord[] {
  // Buffer extends Uint8Array, so existing Node consumers passing a Buffer
  // continue to work — Buffer satisfies the Uint8Array type.
  const buf = input;
  validateHeaderAndCrc(buf);
  const parsed = source.parse(buf);
  detectAndLogShadow(parsed);
  if (!parsed.records || parsed.records.length === 0) {
    throw new NoRecordMessagesError(
      'FIT file is valid but contains no record messages',
    );
  }
  return normalize(parsed);
}

/**
 * Async entry point. Reads the file via `fs/promises.readFile`, then
 * delegates to `loadFitFromBuffer` for all FIT-format validation and parsing.
 *
 * Filesystem errors (ENOENT, EACCES, EISDIR) bubble up as Node's standard
 * `Error` types — they are deliberately NOT wrapped in `FitLoadError`
 * subclasses because they describe filesystem failures, not FIT-format
 * failures. Plan 02-04 will document this distinction in test expectations.
 */
export async function loadFitFromPath(path: string): Promise<RideRecord[]> {
  const buf = await readFile(path);
  return loadFitFromBuffer(buf);
}
