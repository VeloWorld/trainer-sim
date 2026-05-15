/**
 * Phase 2 Plan 04 Task 2 — typed-error hierarchy verification.
 *
 * Asserts each of the four FitLoadError subclasses fires on appropriate
 * corrupt input AND that every thrown error is `instanceof FitLoadError`
 * so consumers can catch the abstract base for generic handling
 * (D-FIT-06 generic-catch surface).
 *
 * Subclasses covered:
 *   - InvalidFitHeaderError  — bad magic / wrong header length
 *   - FitTruncatedError      — buffer < 14 bytes (boundary case);
 *                              valid header, body cut short
 *   - FitCrcError            — CRC trailer hand-corrupted on a valid file
 *   - NoRecordMessagesError  — hand-rolled valid FIT (file_id only,
 *                              ZERO record messages)
 *
 * Group 4 (NoRecordMessagesError) imports the FIT-byte writers from
 * `../fixtures/minimal-fit-bytes.js` (committed in plan 02-02). The
 * shared module is the single source of truth — both this test and
 * `test/fixtures/generate-shadow.ts` (which produces shadow.fit) consume
 * the same writers, so they cannot drift from one another. T-02-25.
 *
 * Forbidden in this file (acceptance grep enforced):
 *   - Inlining a CRC-16/ARC table — the boundary values from that table
 *     must NOT appear here; they live in minimal-fit-bytes.ts only.
 *   - Asserting against the deliberately-absent typed shadow-error class
 *     (D-FIT-10 lock; the hierarchy does not include it).
 *   - Mutating committed fixture files on disk — buffer mutation is
 *     done on in-memory copies (Buffer.from(readFileSync(...))).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { Buffer } from 'node:buffer';
import {
  loadFitFromBuffer,
  FitLoadError,
  InvalidFitHeaderError,
  FitCrcError,
  FitTruncatedError,
  NoRecordMessagesError,
} from '../../src/index.js';
import {
  writeFitHeader,
  writeFileIdDefinitionAndData,
  writeCrcTrailer,
  FIT_EPOCH_OFFSET_SECONDS,
} from '../fixtures/minimal-fit-bytes.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = resolve(__dirname, '../fixtures/fit');

describe('Group 1: InvalidFitHeaderError + FitTruncatedError header guards', () => {
  it('empty buffer throws FitTruncatedError (boundary — fires before magic check)', () => {
    expect(() => loadFitFromBuffer(Buffer.alloc(0))).toThrowError(FitTruncatedError);
    try {
      loadFitFromBuffer(Buffer.alloc(0));
    } catch (e) {
      expect(e).toBeInstanceOf(FitLoadError);
      expect(e).toBeInstanceOf(FitTruncatedError);
    }
  });

  it('buffer with bad magic throws InvalidFitHeaderError', () => {
    // Build a 14-byte buffer with valid header preamble but magic = 'JUNK'.
    const buf = Buffer.alloc(14);
    buf.writeUInt8(12, 0); // header length
    buf.writeUInt8(0x10, 1); // protocol version
    buf.writeUInt16LE(0x0000, 2); // profile version
    buf.writeUInt32LE(0, 4); // data length 0
    buf.writeUInt8(0x4a, 8); // 'J'
    buf.writeUInt8(0x55, 9); // 'U'
    buf.writeUInt8(0x4e, 10); // 'N'
    buf.writeUInt8(0x4b, 11); // 'K'
    expect(() => loadFitFromBuffer(buf)).toThrowError(InvalidFitHeaderError);
    try {
      loadFitFromBuffer(buf);
    } catch (e) {
      expect(e).toBeInstanceOf(FitLoadError);
      expect(e).toBeInstanceOf(InvalidFitHeaderError);
    }
  });

  it('buffer with header length neither 12 nor 14 throws InvalidFitHeaderError', () => {
    // Take a real basic.fit and rewrite buf[0] to 13. Buffer length is
    // already > 14 so the first guard does not fire.
    const real = readFileSync(resolve(FIXTURE_DIR, 'basic.fit'));
    const buf = Buffer.from(real);
    buf.writeUInt8(13, 0);
    expect(() => loadFitFromBuffer(buf)).toThrowError(InvalidFitHeaderError);
  });
});

describe('Group 2: FitTruncatedError on truncated body', () => {
  it('valid header but body cut short throws FitTruncatedError', () => {
    const real = readFileSync(resolve(FIXTURE_DIR, 'basic.fit'));
    const headerLength = real[0]!;
    // Slice to header + 100 bytes of body — well short of dataLength + 2.
    const truncated = real.subarray(0, headerLength + 100);
    expect(() => loadFitFromBuffer(truncated)).toThrowError(FitTruncatedError);
    try {
      loadFitFromBuffer(truncated);
    } catch (e) {
      expect(e).toBeInstanceOf(FitLoadError);
    }
  });
});

describe('Group 3: FitCrcError on hand-corrupted trailer', () => {
  it('flipping the last CRC byte of basic.fit throws FitCrcError', () => {
    // Read into a new mutable Buffer — never modify the committed fixture
    // bytes on disk. T-02-17 (acceptance grep verifies committed fixtures
    // are clean after suite runs).
    const real = readFileSync(resolve(FIXTURE_DIR, 'basic.fit'));
    const buf = Buffer.from(real);
    buf[buf.length - 1] = (buf[buf.length - 1]! ^ 0xff) & 0xff;
    expect(() => loadFitFromBuffer(buf)).toThrowError(FitCrcError);
    try {
      loadFitFromBuffer(buf);
    } catch (e) {
      expect(e).toBeInstanceOf(FitLoadError);
      expect(e).toBeInstanceOf(FitCrcError);
    }
  });
});

describe('Group 4: NoRecordMessagesError on hand-rolled FIT (file_id only)', () => {
  /**
   * Build a minimal valid FIT in-test using the shared FIT-byte writers
   * from `../fixtures/minimal-fit-bytes.js`. Single source of truth with
   * `test/fixtures/generate-shadow.ts` — the same writers produce both
   * the shadow.fit fixture and the input bytes for this test, so they
   * cannot drift.
   */
  function buildFileIdOnlyFit(): Buffer {
    const fileId = writeFileIdDefinitionAndData({
      type: 4, // activity
      manufacturer: 255, // development
      timeCreated:
        Math.floor(Date.UTC(2025, 0, 1) / 1000) - FIT_EPOCH_OFFSET_SECONDS,
    });
    const dataBody = Buffer.concat([fileId.definition, fileId.data]);
    const header = writeFitHeader({ headerLength: 14, dataLength: dataBody.length });
    // 14-byte header convention: trailer CRC covers only the body bytes,
    // not the header (the 14-byte header has its own CRC at [12..13]).
    const trailer = writeCrcTrailer(dataBody);
    return Buffer.concat([header, dataBody, trailer]);
  }

  it('valid FIT with file_id but zero record messages throws NoRecordMessagesError', () => {
    const buf = buildFileIdOnlyFit();
    expect(() => loadFitFromBuffer(buf)).toThrowError(NoRecordMessagesError);
    try {
      loadFitFromBuffer(buf);
    } catch (e) {
      expect(e).toBeInstanceOf(FitLoadError);
      expect(e).toBeInstanceOf(NoRecordMessagesError);
    }
  });
});
