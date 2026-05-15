// test/fixtures/minimal-fit-bytes.ts
//
// Shared FIT-spec byte writers for test-only fixture generation.
//
// SINGLE SOURCE OF TRUTH for the CRC-16/ARC table, the file-header writer,
// the file_id message writer, and the trailer-CRC computation. Consumed by:
//   - test/fixtures/generate-shadow.ts (Phase 2 plan 02-02 task 2)
//   - test/fit/error-paths.test.ts     (Phase 2 plan 02-04 task 2 group 4 —
//                                       NoRecordMessagesError test)
//
// If the helpers and the in-test FIT-byte construction live in two places
// they can drift; the test would then pass for a slightly different reason
// than the fixtures it validates. Single source of truth = no drift.
//
// This module:
//   - is NOT imported from src/ (test layer only)
//   - does NOT import from src/ (no parser coupling)
//   - does NOT import fit-file-parser (these are independent FIT writers)
//   - has NO side effects at import time

import { Buffer } from 'node:buffer';

// ──────────────────────────────────────────────────────────────────────────
// CRC-16/ARC — 16-entry table version per FIT SDK; copied verbatim from
// fit-file-parser/src/binary.ts:21-35.
// ──────────────────────────────────────────────────────────────────────────

export const CRC16_ARC_TABLE: readonly number[] = [
  0x0000, 0xcc01, 0xd801, 0x1400, 0xf001, 0x3c00, 0x2800, 0xe401,
  0xa001, 0x6c00, 0x7800, 0xb401, 0x5000, 0x9c01, 0x8801, 0x4400,
] as const;

// Compute CRC-16/ARC over `buf[start..end)`. Algorithm body verbatim from
// the parser library's binary module. Returns a uint16.
export function crc16Arc(buf: Uint8Array, start: number, end: number): number {
  let crc = 0;
  for (let i = start; i < end; i++) {
    let tmp = CRC16_ARC_TABLE[crc & 0xf]!;
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ CRC16_ARC_TABLE[buf[i]! & 0xf]!;
    tmp = CRC16_ARC_TABLE[crc & 0xf]!;
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ CRC16_ARC_TABLE[(buf[i]! >> 4) & 0xf]!;
  }
  return crc;
}

/** Unix seconds at 1989-12-31T00:00:00Z — the FIT epoch. */
export const FIT_EPOCH_OFFSET_SECONDS = 631065600;

// ──────────────────────────────────────────────────────────────────────────
// File header
// ──────────────────────────────────────────────────────────────────────────

export interface FitHeaderOptions {
  /** 12 (no header CRC) or 14 (with header CRC). */
  headerLength: 12 | 14;
  /** FIT protocol version byte. Default 0x10 (v1.0). */
  protocolVersion?: number;
  /** FIT profile version, uint16 LE. Default 2120 (~v21.20). */
  profileVersion?: number;
  /**
   * Length in bytes of the message-body region that follows the header
   * (i.e. NOT counting the 2-byte CRC trailer). Caller computes from the
   * sum of definition + data message bytes.
   */
  dataLength: number;
}

/**
 * Write a 12- or 14-byte FIT file header. When `headerLength === 14`, the
 * trailing 2-byte header CRC is computed over bytes [0..11] and inlined at
 * [12..13]. The data-region CRC trailer is the caller's responsibility (see
 * `writeCrcTrailer`).
 */
export function writeFitHeader(opts: FitHeaderOptions): Buffer {
  const { headerLength, dataLength } = opts;
  const protocolVersion = opts.protocolVersion ?? 0x10;
  const profileVersion = opts.profileVersion ?? 2120;
  const buf = Buffer.alloc(headerLength);
  buf.writeUInt8(headerLength, 0);
  buf.writeUInt8(protocolVersion, 1);
  buf.writeUInt16LE(profileVersion, 2);
  buf.writeUInt32LE(dataLength, 4);
  buf.writeUInt8(0x2e, 8); // '.'
  buf.writeUInt8(0x46, 9); // 'F'
  buf.writeUInt8(0x49, 10); // 'I'
  buf.writeUInt8(0x54, 11); // 'T'
  if (headerLength === 14) {
    const headerCrc = crc16Arc(buf, 0, 12);
    buf.writeUInt16LE(headerCrc, 12);
  }
  return buf;
}

// ──────────────────────────────────────────────────────────────────────────
// Record-header bytes (single-byte normal headers)
// ──────────────────────────────────────────────────────────────────────────

/**
 * Build a definition-message header byte. Bit 6 set, optional bit 5 for
 * developer-data attribution, low 4 bits = local message type. Throws if
 * `localMessageType` is out of range (0..15).
 */
export function writeDefinitionMessageHeader(
  localMessageType: number,
  hasDeveloperData = false,
): number {
  if (localMessageType < 0 || localMessageType > 15) {
    throw new Error(`local message type out of range: ${localMessageType}`);
  }
  return 0x40 | (hasDeveloperData ? 0x20 : 0) | (localMessageType & 0x0f);
}

/**
 * Build a data-message header byte (normal header). Just the local message
 * type in the low nibble, bit 7 (compressed) and bit 6 (definition) clear.
 */
export function writeDataMessageHeader(localMessageType: number): number {
  if (localMessageType < 0 || localMessageType > 15) {
    throw new Error(`local message type out of range: ${localMessageType}`);
  }
  return localMessageType & 0x0f;
}

// ──────────────────────────────────────────────────────────────────────────
// file_id message (global_message_number 0)
// ──────────────────────────────────────────────────────────────────────────

export interface FileIdFields {
  /** FIT file type enum. 4 = activity. */
  type?: number;
  /** Manufacturer ID (uint16). 255 = development. */
  manufacturer?: number;
  /** Product / device-type ID (uint16). */
  product?: number;
  /** Time created in FIT seconds (uint32). */
  timeCreated?: number;
  /** Device serial number (uint32z). */
  serialNumber?: number;
}

/**
 * Build a minimal `file_id` definition message + the matching data message.
 * Order of declared fields:
 *   - 253 timestamp ... omitted (file_id has no field 253; uses time_created)
 *   - 3 serial_number  uint32z size 4
 *   - 4 time_created   uint32  size 4
 *   - 1 manufacturer   uint16  size 2
 *   - 2 product        uint16  size 2
 *   - 0 type           enum    size 1
 *
 * Returns the two byte buffers separately so the caller can place them in the
 * desired position (typically immediately after the file header).
 */
export function writeFileIdDefinitionAndData(
  fields: FileIdFields,
  opts: { localMessageType?: number } = {},
): { definition: Buffer; data: Buffer } {
  const localMessageType = opts.localMessageType ?? 0;

  // Definition message: 6-byte header (def-hdr-byte, reserved, arch=0,
  // global_msg=0 LE, num_fields), then 5 field-definitions × 3 bytes each.
  const def = Buffer.alloc(6 + 5 * 3);
  def.writeUInt8(writeDefinitionMessageHeader(localMessageType, false), 0);
  def.writeUInt8(0x00, 1); // reserved
  def.writeUInt8(0x00, 2); // arch = 0 (LE)
  def.writeUInt16LE(0x0000, 3); // global_msg = 0 (file_id)
  def.writeUInt8(5, 5); // 5 fields
  // field 3 serial_number (uint32z, base-type 0x8c, size 4)
  def.writeUInt8(3, 6);
  def.writeUInt8(4, 7);
  def.writeUInt8(0x8c, 8);
  // field 4 time_created (uint32, base-type 0x86, size 4)
  def.writeUInt8(4, 9);
  def.writeUInt8(4, 10);
  def.writeUInt8(0x86, 11);
  // field 1 manufacturer (uint16, base-type 0x84, size 2)
  def.writeUInt8(1, 12);
  def.writeUInt8(2, 13);
  def.writeUInt8(0x84, 14);
  // field 2 product (uint16, base-type 0x84, size 2)
  def.writeUInt8(2, 15);
  def.writeUInt8(2, 16);
  def.writeUInt8(0x84, 17);
  // field 0 type (enum, base-type 0x00, size 1)
  def.writeUInt8(0, 18);
  def.writeUInt8(1, 19);
  def.writeUInt8(0x00, 20);

  // Data message: 1-byte header + 4 + 4 + 2 + 2 + 1 = 14 bytes
  const data = Buffer.alloc(1 + 4 + 4 + 2 + 2 + 1);
  let p = 0;
  data.writeUInt8(writeDataMessageHeader(localMessageType), p);
  p += 1;
  // serial_number (uint32z; 0 = invalid; default to 0 — already cleared)
  data.writeUInt32LE(fields.serialNumber ?? 0, p);
  p += 4;
  // time_created (uint32; 0xFFFFFFFF = invalid)
  data.writeUInt32LE(fields.timeCreated ?? 0xffffffff, p);
  p += 4;
  // manufacturer (uint16; 0xFFFF = invalid; default = 255 development)
  data.writeUInt16LE(fields.manufacturer ?? 255, p);
  p += 2;
  // product (uint16; 0xFFFF = invalid; default = 0)
  data.writeUInt16LE(fields.product ?? 0, p);
  p += 2;
  // type (enum; 0xFF = invalid; default = 4 activity)
  data.writeUInt8(fields.type ?? 4, p);

  return { definition: def, data: data };
}

// ──────────────────────────────────────────────────────────────────────────
// CRC trailer
// ──────────────────────────────────────────────────────────────────────────

// Compute the 2-byte CRC-16/ARC trailer over `body` and return it as a
// little-endian buffer. `body` is the concatenation of (file_header)
// IF headerLength === 12, OR everything AFTER the 14-byte header IF
// headerLength === 14. (Parser-library source confirms the CRC range
// for 14-byte headers excludes the header bytes — they have their own CRC.)
//
// Callers that built their body with `writeFitHeader({ headerLength: 14 })`
// MUST pass only the message-body bytes (not including the header) here.
// Callers that built with headerLength: 12 MUST include the header bytes.
export function writeCrcTrailer(body: Uint8Array): Buffer {
  const crc = crc16Arc(body, 0, body.length);
  const out = Buffer.alloc(2);
  out.writeUInt16LE(crc, 0);
  return out;
}
