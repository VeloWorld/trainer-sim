// test/fixtures/scrub.ts
//
// One-shot dev-only PII scrubber for Phase 2 FIT fixtures (D-FIT-04, D-FIT-05).
//
// Reads a small set of real cycling-app FIT exports and emits scrubbed
// `.fit` files under `test/fixtures/fit/`. The bytes are committed; this script
// is committed for reproducibility but is NEVER run in CI (not referenced from
// any package.json script and not imported from src/).
//
// Approach: in-place byte rewrite. Walks the source FIT message stream
// tracking definition messages (so per-data-message field byte offsets are
// known), then overwrites the PII byte ranges enumerated by D-FIT-05:
//   - timestamps: re-anchor to fixed synthetic epoch 2025-01-01T00:00:00 UTC
//     (offset is computed in FIT-seconds-space; only the absolute origin
//     moves, intra-file deltas are preserved).
//   - GPS lat/lon: zeroed (sint32 = 0) on record/session/lap.
//   - Device serials: cleared to FIT invalid sentinel on file_id/device_info.
//   - user_profile: all bytes cleared to FIT invalid sentinels per base type.
// Definition messages, message order, record count, dev-field bytes, power,
// cadence, heart_rate, gap structure (deltas between timestamps) are all
// preserved verbatim.
//
// CRC-16/ARC trailer is recomputed at the end. Header CRC is recomputed when
// header length is 14 bytes.
//
// Usage:
//   npx tsx test/fixtures/scrub.ts \
//     --src /Users/agniveshpatel/dev/agni21/test-sim/data \
//     --out test/fixtures/fit
//
// Author: Phase 2 plan 02-02 (2026-05-16).

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

// ──────────────────────────────────────────────────────────────────────────
// CRC-16/ARC table — 16-entry version per FIT SDK; copied verbatim from
// fit-file-parser/src/binary.ts:21-35.
// ──────────────────────────────────────────────────────────────────────────
const CRC_TABLE = [
  0x0000, 0xcc01, 0xd801, 0x1400, 0xf001, 0x3c00, 0x2800, 0xe401,
  0xa001, 0x6c00, 0x7800, 0xb401, 0x5000, 0x9c01, 0x8801, 0x4400,
] as const;

function crc16Arc(buf: Uint8Array, start: number, end: number): number {
  let crc = 0;
  for (let i = start; i < end; i++) {
    let tmp = CRC_TABLE[crc & 0xf]!;
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ CRC_TABLE[buf[i]! & 0xf]!;
    tmp = CRC_TABLE[crc & 0xf]!;
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ CRC_TABLE[(buf[i]! >> 4) & 0xf]!;
  }
  return crc;
}

// FIT epoch = 1989-12-31T00:00:00 UTC. Unix epoch ms.
const FIT_EPOCH_MS = Date.UTC(1989, 11, 31, 0, 0, 0);
// Synthetic anchor: 2025-01-01T00:00:00 UTC, expressed as FIT seconds (uint32).
const SYNTHETIC_FIT_SECONDS = Math.floor((Date.UTC(2025, 0, 1) - FIT_EPOCH_MS) / 1000);

// FIT base type identifiers we care about. Subset of FIT SDK Profile §base types.
const BASE = {
  ENUM: 0x00,
  SINT8: 0x01,
  UINT8: 0x02,
  SINT16: 0x83,
  UINT16: 0x84,
  SINT32: 0x85,
  UINT32: 0x86,
  STRING: 0x07,
  FLOAT32: 0x88,
  FLOAT64: 0x89,
  UINT8Z: 0x0a,
  UINT16Z: 0x8b,
  UINT32Z: 0x8c,
  BYTE: 0x0d,
  SINT64: 0x8e,
  UINT64: 0x8f,
  UINT64Z: 0x90,
} as const;

// FIT global message numbers we recognize for PII scrubbing.
const MSG = {
  FILE_ID: 0,
  USER_PROFILE: 3,
  RECORD: 20,
  EVENT: 21,
  SESSION: 18,
  LAP: 19,
  ACTIVITY: 34,
  DEVICE_INFO: 23,
  FILE_CREATOR: 49,
} as const;

interface FieldDef {
  num: number;
  size: number;
  baseType: number;
}

interface MessageDef {
  globalNum: number;
  arch: 0 | 1; // 0 LE, 1 BE
  fields: FieldDef[];
  devFields: FieldDef[]; // size and dev-data-index, but baseType isn't in def
  totalSize: number;
}

// Returns the FIT invalid sentinel as a 0..size-byte sequence (LE) for the given base type.
function invalidSentinelBytes(baseType: number, size: number): Uint8Array {
  const out = new Uint8Array(size);
  // Default: all 0xFF (works for most signed/unsigned numeric types — the FIT
  // invalid value).
  out.fill(0xff);
  // Z-types use 0x00 as invalid.
  if (
    baseType === BASE.ENUM ||
    baseType === BASE.UINT8Z ||
    baseType === BASE.UINT16Z ||
    baseType === BASE.UINT32Z ||
    baseType === BASE.UINT64Z
  ) {
    out.fill(0x00);
  }
  // Signed 8/16/32/64 invalid is 0x7F.../0x7FFF/0x7FFFFFFF (in LE: 0xFF...0xFF, 0x7F).
  if (baseType === BASE.SINT8) out[0] = 0x7f;
  if (baseType === BASE.SINT16) {
    out[0] = 0xff;
    out[1] = 0x7f;
  }
  if (baseType === BASE.SINT32) {
    out[0] = 0xff;
    out[1] = 0xff;
    out[2] = 0xff;
    out[3] = 0x7f;
  }
  if (baseType === BASE.SINT64) {
    out.fill(0xff, 0, 7);
    out[7] = 0x7f;
  }
  // STRING / BYTE invalid: all 0x00.
  if (baseType === BASE.STRING || baseType === BASE.BYTE) out.fill(0x00);
  // FLOAT invalid is 0xFFFFFFFF (NaN); already covered by default fill.
  return out;
}

function readU32LE(buf: Uint8Array, off: number): number {
  return (
    (buf[off]! | (buf[off + 1]! << 8) | (buf[off + 2]! << 16) | (buf[off + 3]! << 24)) >>> 0
  );
}

function writeU32LE(buf: Uint8Array, off: number, val: number): void {
  buf[off] = val & 0xff;
  buf[off + 1] = (val >>> 8) & 0xff;
  buf[off + 2] = (val >>> 16) & 0xff;
  buf[off + 3] = (val >>> 24) & 0xff;
}

function readU32BE(buf: Uint8Array, off: number): number {
  return (
    ((buf[off]! << 24) | (buf[off + 1]! << 16) | (buf[off + 2]! << 8) | buf[off + 3]!) >>> 0
  );
}

function writeU32BE(buf: Uint8Array, off: number, val: number): void {
  buf[off] = (val >>> 24) & 0xff;
  buf[off + 1] = (val >>> 16) & 0xff;
  buf[off + 2] = (val >>> 8) & 0xff;
  buf[off + 3] = val & 0xff;
}

function readU32(buf: Uint8Array, off: number, isLE: boolean): number {
  return isLE ? readU32LE(buf, off) : readU32BE(buf, off);
}

function writeU32(buf: Uint8Array, off: number, val: number, isLE: boolean): void {
  if (isLE) writeU32LE(buf, off, val);
  else writeU32BE(buf, off, val);
}

function readU16LE(buf: Uint8Array, off: number): number {
  return buf[off]! | (buf[off + 1]! << 8);
}

function writeU16LE(buf: Uint8Array, off: number, val: number): void {
  buf[off] = val & 0xff;
  buf[off + 1] = (val >>> 8) & 0xff;
}

interface ScrubReport {
  src: string;
  out: string;
  records: number;
  totalBytes: number;
  firstTimestamp: string;
  lastTimestamp: string;
}

function scrubOne(srcPath: string, outPath: string): ScrubReport {
  const original = readFileSync(srcPath);
  const buf = new Uint8Array(original); // copy; we mutate in place

  // Header.
  if (buf.length < 14) throw new Error(`${srcPath}: file too small`);
  const headerLen = buf[0]!;
  if (headerLen !== 12 && headerLen !== 14) {
    throw new Error(`${srcPath}: unexpected header length ${headerLen}`);
  }
  const dataLen = readU32LE(buf, 4);
  const magic = String.fromCharCode(buf[8]!, buf[9]!, buf[10]!, buf[11]!);
  if (magic !== '.FIT') throw new Error(`${srcPath}: bad magic ${magic}`);
  const dataStart = headerLen;
  const dataEnd = dataStart + dataLen;
  if (buf.length < dataEnd + 2) throw new Error(`${srcPath}: truncated`);

  // Pass 1: walk messages and find the very first `record` timestamp (FIT
  // seconds, uint32 LE at field 253). Compute the offset between that and the
  // synthetic anchor in FIT-second space.
  const defs = new Map<number, MessageDef>(); // local_msg_type -> def
  let off = dataStart;
  let firstRecordFitSeconds: number | undefined;
  while (off < dataEnd) {
    const hdr = buf[off]!;
    const isDef = (hdr & 0x40) !== 0;
    const isDevFlag = (hdr & 0x20) !== 0;
    const localType = hdr & 0x0f;
    if (isDef) {
      const arch = buf[off + 2]! as 0 | 1;
      const globalNum =
        arch === 0 ? readU16LE(buf, off + 3) : (buf[off + 3]! << 8) | buf[off + 4]!;
      const numFields = buf[off + 5]!;
      const fields: FieldDef[] = [];
      let p = off + 6;
      for (let i = 0; i < numFields; i++) {
        fields.push({ num: buf[p]!, size: buf[p + 1]!, baseType: buf[p + 2]! });
        p += 3;
      }
      const devFields: FieldDef[] = [];
      if (isDevFlag) {
        const numDev = buf[p]!;
        p++;
        for (let i = 0; i < numDev; i++) {
          devFields.push({ num: buf[p]!, size: buf[p + 1]!, baseType: buf[p + 2]! });
          p += 3;
        }
      }
      const totalSize =
        fields.reduce((s, f) => s + f.size, 0) + devFields.reduce((s, f) => s + f.size, 0);
      defs.set(localType, { globalNum, arch, fields, devFields, totalSize });
      off = p;
    } else {
      const def = defs.get(localType);
      if (!def) throw new Error(`${srcPath}: data msg with unknown local type ${localType} at ${off}`);
      if (def.globalNum === MSG.RECORD && firstRecordFitSeconds === undefined) {
        // field 253 is timestamp (FIT seconds, uint32) — arch-aware
        const isLE = def.arch === 0;
        let p = off + 1;
        for (const f of def.fields) {
          if (f.num === 253 && f.size === 4) {
            firstRecordFitSeconds = readU32(buf, p, isLE);
            break;
          }
          p += f.size;
        }
      }
      off += 1 + def.totalSize;
    }
  }

  if (firstRecordFitSeconds === undefined) {
    throw new Error(`${srcPath}: no record messages found`);
  }
  // tsScrubbed = SYNTHETIC_FIT_SECONDS + (tsOriginal - firstRecordFitSeconds)
  // i.e. shift = SYNTHETIC_FIT_SECONDS - firstRecordFitSeconds
  const tsShift = SYNTHETIC_FIT_SECONDS - firstRecordFitSeconds;

  // Pass 2: rewrite PII fields in place. Track first/last record timestamps
  // for the report.
  defs.clear();
  off = dataStart;
  let firstRecTsAfter: number | undefined;
  let lastRecTsAfter: number | undefined;
  let recordCount = 0;
  while (off < dataEnd) {
    const hdr = buf[off]!;
    const isDef = (hdr & 0x40) !== 0;
    const isDevFlag = (hdr & 0x20) !== 0;
    const localType = hdr & 0x0f;
    if (isDef) {
      // Re-parse the def (cheap; same as pass 1).
      const arch = buf[off + 2]! as 0 | 1;
      const globalNum =
        arch === 0 ? readU16LE(buf, off + 3) : (buf[off + 3]! << 8) | buf[off + 4]!;
      const numFields = buf[off + 5]!;
      const fields: FieldDef[] = [];
      let p = off + 6;
      for (let i = 0; i < numFields; i++) {
        fields.push({ num: buf[p]!, size: buf[p + 1]!, baseType: buf[p + 2]! });
        p += 3;
      }
      const devFields: FieldDef[] = [];
      if (isDevFlag) {
        const numDev = buf[p]!;
        p++;
        for (let i = 0; i < numDev; i++) {
          devFields.push({ num: buf[p]!, size: buf[p + 1]!, baseType: buf[p + 2]! });
          p += 3;
        }
      }
      const totalSize =
        fields.reduce((s, f) => s + f.size, 0) + devFields.reduce((s, f) => s + f.size, 0);
      defs.set(localType, { globalNum, arch, fields, devFields, totalSize });
      off = p;
      continue;
    }

    const def = defs.get(localType)!;
    if (def.globalNum === MSG.RECORD) recordCount++;
    let fieldOff = off + 1;

    // Walk standard fields and rewrite PII.
    const isLE = def.arch === 0;
    for (const f of def.fields) {
      const fOff = fieldOff;
      switch (def.globalNum) {
        case MSG.FILE_ID:
          // field 3 = serial_number (uint32z)
          // field 4 = time_created (uint32 FIT seconds)
          if (f.num === 3 && f.size === 4) {
            // clear to invalid (uint32z = 0x00000000)
            buf[fOff] = 0;
            buf[fOff + 1] = 0;
            buf[fOff + 2] = 0;
            buf[fOff + 3] = 0;
          } else if (f.num === 4 && f.size === 4) {
            const t = readU32(buf, fOff, isLE);
            if (t !== 0xffffffff && t !== 0) writeU32(buf, fOff, (t + tsShift) >>> 0, isLE);
          }
          break;
        case MSG.USER_PROFILE: {
          // Clear ALL fields to invalid sentinels.
          const sentinel = invalidSentinelBytes(f.baseType, f.size);
          for (let i = 0; i < f.size; i++) buf[fOff + i] = sentinel[i]!;
          break;
        }
        case MSG.RECORD: {
          if (f.num === 253 && f.size === 4) {
            // timestamp (arch-aware)
            const t = readU32(buf, fOff, isLE);
            if (t !== 0xffffffff) {
              const newT = (t + tsShift) >>> 0;
              writeU32(buf, fOff, newT, isLE);
              if (firstRecTsAfter === undefined) firstRecTsAfter = newT;
              lastRecTsAfter = newT;
            }
          } else if ((f.num === 0 || f.num === 1) && f.size === 4) {
            // position_lat (0) / position_long (1) — zero out (sint32 = 0)
            buf[fOff] = 0;
            buf[fOff + 1] = 0;
            buf[fOff + 2] = 0;
            buf[fOff + 3] = 0;
          }
          break;
        }
        case MSG.EVENT:
        case MSG.LAP:
        case MSG.SESSION:
        case MSG.ACTIVITY: {
          // timestamp (253) and start_time (2) and local_timestamp (5 on activity)
          // shifted; lat/lon fields zeroed.
          const isTimestamp =
            (f.num === 253 && f.size === 4) ||
            (f.num === 2 && f.size === 4 && def.globalNum !== MSG.EVENT) ||
            (f.num === 5 && f.size === 4 && def.globalNum === MSG.ACTIVITY);
          if (isTimestamp) {
            const t = readU32(buf, fOff, isLE);
            if (t !== 0xffffffff && t !== 0) writeU32(buf, fOff, (t + tsShift) >>> 0, isLE);
          }
          // sint32 lat/lon fields on session/lap: nec_lat=29, nec_long=30,
          // sec_lat=31, sec_long=32, start_position_lat=3, start_position_long=4,
          // end_position_lat=5, end_position_long=6 (lap), swc_lat=37, swc_long=38.
          // Zero out any sint32 field with size 4 in these messages that has a
          // recognizable lat/lon-like field number.
          const latLonNums = new Set([3, 4, 5, 6, 27, 28, 29, 30, 31, 32, 37, 38]);
          if (
            (def.globalNum === MSG.SESSION || def.globalNum === MSG.LAP) &&
            latLonNums.has(f.num) &&
            f.size === 4 &&
            f.baseType === BASE.SINT32
          ) {
            buf[fOff] = 0;
            buf[fOff + 1] = 0;
            buf[fOff + 2] = 0;
            buf[fOff + 3] = 0;
          }
          break;
        }
        case MSG.DEVICE_INFO: {
          // field 3 = serial_number (uint32z); field 253 = timestamp.
          if (f.num === 3 && f.size === 4) {
            buf[fOff] = 0;
            buf[fOff + 1] = 0;
            buf[fOff + 2] = 0;
            buf[fOff + 3] = 0;
          } else if (f.num === 253 && f.size === 4) {
            const t = readU32(buf, fOff, isLE);
            if (t !== 0xffffffff && t !== 0) writeU32(buf, fOff, (t + tsShift) >>> 0, isLE);
          }
          break;
        }
        case MSG.FILE_CREATOR:
          // No PII fields we care about (software_version, hardware_version
          // are not PII). Skip.
          break;
        default:
          // For other message types, opportunistically shift the timestamp
          // field 253 (uint32) so message order timing stays consistent
          // post-anchor.
          if (f.num === 253 && f.size === 4 && f.baseType === BASE.UINT32) {
            const t = readU32(buf, fOff, isLE);
            if (t !== 0xffffffff && t !== 0) writeU32(buf, fOff, (t + tsShift) >>> 0, isLE);
          }
          break;
      }
      fieldOff += f.size;
    }
    // Skip developer field bytes — preserved verbatim per D-FIT-05 (dev fields
    // are part of the structural shape, NOT PII).
    fieldOff += def.devFields.reduce((s, f) => s + f.size, 0);

    off += 1 + def.totalSize;
  }

  // Recompute trailer CRC over body. Per FIT SDK + fit-file-parser source
  // (fit-parser.js:69): if headerLength === 12 the CRC range is [0, crcStart);
  // if headerLength === 14 the range starts AFTER the header (at byte 14)
  // because the 14-byte header has its own CRC at bytes [12..13].
  const crcRangeStart = headerLen === 12 ? 0 : headerLen;
  const newCrc = crc16Arc(buf, crcRangeStart, dataEnd);
  writeU16LE(buf, dataEnd, newCrc);

  // If header has its own CRC, recompute it (over bytes [0..11]).
  if (headerLen === 14) {
    const newHdrCrc = crc16Arc(buf, 0, 12);
    writeU16LE(buf, 12, newHdrCrc);
  }

  writeFileSync(outPath, buf);

  const firstStr =
    firstRecTsAfter !== undefined
      ? new Date(FIT_EPOCH_MS + firstRecTsAfter * 1000).toISOString()
      : '<none>';
  const lastStr =
    lastRecTsAfter !== undefined
      ? new Date(FIT_EPOCH_MS + lastRecTsAfter * 1000).toISOString()
      : '<none>';
  return {
    src: srcPath,
    out: outPath,
    records: recordCount,
    totalBytes: buf.length,
    firstTimestamp: firstStr,
    lastTimestamp: lastStr,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// CLI
// ──────────────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): { src: string; out: string } {
  let src: string | undefined;
  let out: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--src') src = argv[++i];
    else if (argv[i] === '--out') out = argv[++i];
  }
  if (!src || !out) {
    throw new Error('usage: tsx test/fixtures/scrub.ts --src <dir> --out <dir>');
  }
  return { src, out };
}

// Mapping from the locked D-FIT-05 case-table.
const FIXTURE_MAP: ReadonlyArray<[string, string]> = [
  ['ROUVY_Tutorial_ride.fit', 'basic.fit'],
  ['Wahoo_RGT_Siddhnath_Loop_2_Quick_Ride.fit', 'zero-power.fit'],
  ['The_Sufferfest_Getting_Started.fit', 'duplicates.fit'],
  ['MyWhoosh_Nomad_Trail.fit', 'dev-fields-non-shadow.fit'],
  ['Zwift_Wave_Rider_on_Hilltop_Hustle_in_Watopia.fit', 'autopause.fit'],
  ['Zwift_FTP_Test_in_Makuri_Islands.fit', 'perf-1hr.fit'],
];

function main(): void {
  const { src, out } = parseArgs(process.argv.slice(2));
  mkdirSync(out, { recursive: true });
  const reports: ScrubReport[] = [];
  for (const [fromName, toName] of FIXTURE_MAP) {
    const srcPath = resolve(src, fromName);
    const outPath = resolve(out, toName);
    const r = scrubOne(srcPath, outPath);
    reports.push(r);
    console.log(
      `${toName.padEnd(30)} records=${String(r.records).padEnd(5)} bytes=${String(r.totalBytes).padEnd(7)} first=${r.firstTimestamp} last=${r.lastTimestamp}`,
    );
  }
}

main();
