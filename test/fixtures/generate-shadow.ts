// test/fixtures/generate-shadow.ts
//
// Hand-rolled minimal valid FIT file with one developer-defined field named
// `power` colliding with the standard `record.power` field. Exercises the
// D-FIT-10 / FIT-05-amended shadow path that no source corpus file triggers.
// This is the SOLE hand-rolled fixture (D-FIT-05 carve-out); everything
// else comes from the scrubber.
//
// Output: test/fixtures/fit/shadow.fit (~2 KB, 30 records).
//
// Behavior verified by post-write parse-back: fit-file-parser exposes a
// `field_descriptions[]` entry whose `field_name === 'power'`, returns 30
// records, and `record.power === 999` (the developer field's value, NOT the
// standard 200) — demonstrating the shadow case that D-FIT-10 surfaces via
// util.debuglog rather than throwing.
//
// This script is committed for reproducibility but is NEVER run in CI (not
// referenced from any package.json script and not imported from src/).
//
// Run: npx tsx test/fixtures/generate-shadow.ts

import { Buffer } from 'node:buffer';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  FIT_EPOCH_OFFSET_SECONDS,
  writeFitHeader,
  writeFileIdDefinitionAndData,
  writeDefinitionMessageHeader,
  writeDataMessageHeader,
  writeCrcTrailer,
} from './minimal-fit-bytes.js';

// ──────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────

const SYNTHETIC_EPOCH_FIT_SECONDS =
  Math.floor(Date.UTC(2025, 0, 1, 0, 0, 0) / 1000) - FIT_EPOCH_OFFSET_SECONDS;
const RECORD_COUNT = 30;
const STANDARD_POWER = 200;
const DEVELOPER_POWER = 999;
const STANDARD_CADENCE = 85;

// Local message types
const LOCAL_FILE_ID = 0;
const LOCAL_DEV_DATA_ID = 1;
const LOCAL_FIELD_DESC = 2;
const LOCAL_RECORD = 3;

// Global message numbers (FIT SDK Profile)
const GLOBAL_DEVELOPER_DATA_ID = 207;
const GLOBAL_FIELD_DESCRIPTION = 206;
const GLOBAL_RECORD = 20;

// FIT base type IDs (from FIT SDK Profile / fit-file-parser)
const BT_UINT8 = 0x02;
const BT_UINT16 = 0x84;
const BT_UINT32 = 0x86;
const BT_BYTE = 0x0d;
const BT_STRING = 0x07;

// ──────────────────────────────────────────────────────────────────────────
// Body construction
// ──────────────────────────────────────────────────────────────────────────

const parts: Buffer[] = [];

// 1) file_id definition + data (via shared helpers).
const fileId = writeFileIdDefinitionAndData(
  {
    type: 4, // activity
    manufacturer: 255, // development
    product: 0,
    timeCreated: SYNTHETIC_EPOCH_FIT_SECONDS,
    serialNumber: 0,
  },
  { localMessageType: LOCAL_FILE_ID },
);
parts.push(fileId.definition, fileId.data);

// 2) developer_data_id definition + data (global 207).
//    Single application_id (16 bytes) + developer_data_index (uint8).
{
  const def = Buffer.alloc(6 + 2 * 3);
  def.writeUInt8(writeDefinitionMessageHeader(LOCAL_DEV_DATA_ID, false), 0);
  def.writeUInt8(0x00, 1);
  def.writeUInt8(0x00, 2);
  def.writeUInt16LE(GLOBAL_DEVELOPER_DATA_ID, 3);
  def.writeUInt8(2, 5);
  // field 1 application_id (byte[16])
  def.writeUInt8(1, 6);
  def.writeUInt8(16, 7);
  def.writeUInt8(BT_BYTE, 8);
  // field 3 developer_data_index (uint8)
  def.writeUInt8(3, 9);
  def.writeUInt8(1, 10);
  def.writeUInt8(BT_UINT8, 11);
  parts.push(def);

  const data = Buffer.alloc(1 + 16 + 1);
  data.writeUInt8(writeDataMessageHeader(LOCAL_DEV_DATA_ID), 0);
  // 16-byte UUID-ish sentinel (any non-zero pattern)
  for (let i = 0; i < 16; i++) data.writeUInt8(0xa0 + i, 1 + i);
  data.writeUInt8(0, 17); // developer_data_index = 0
  parts.push(data);
}

// 3) field_description definition + data (global 206) — names the dev field
//    "power" so fit-file-parser will collide it onto record.power at parse.
{
  // Field layout: developer_data_index (uint8), field_definition_number (uint8),
  // fit_base_type_id (uint8), field_name (string len 8 incl. null), units (string len 8 incl. null).
  const FIELD_NAME_LEN = 8; // "power\0\0\0"
  const UNITS_LEN = 8; // "watts\0\0\0"
  const def = Buffer.alloc(6 + 5 * 3);
  def.writeUInt8(writeDefinitionMessageHeader(LOCAL_FIELD_DESC, false), 0);
  def.writeUInt8(0x00, 1);
  def.writeUInt8(0x00, 2);
  def.writeUInt16LE(GLOBAL_FIELD_DESCRIPTION, 3);
  def.writeUInt8(5, 5);
  def.writeUInt8(0, 6); // field 0 developer_data_index uint8
  def.writeUInt8(1, 7);
  def.writeUInt8(BT_UINT8, 8);
  def.writeUInt8(1, 9); // field 1 field_definition_number uint8
  def.writeUInt8(1, 10);
  def.writeUInt8(BT_UINT8, 11);
  def.writeUInt8(2, 12); // field 2 fit_base_type_id uint8
  def.writeUInt8(1, 13);
  def.writeUInt8(BT_UINT8, 14);
  def.writeUInt8(3, 15); // field 3 field_name string
  def.writeUInt8(FIELD_NAME_LEN, 16);
  def.writeUInt8(BT_STRING, 17);
  def.writeUInt8(8, 18); // field 8 units string
  def.writeUInt8(UNITS_LEN, 19);
  def.writeUInt8(BT_STRING, 20);
  parts.push(def);

  const data = Buffer.alloc(1 + 1 + 1 + 1 + FIELD_NAME_LEN + UNITS_LEN);
  let p = 0;
  data.writeUInt8(writeDataMessageHeader(LOCAL_FIELD_DESC), p);
  p += 1;
  data.writeUInt8(0, p); // developer_data_index
  p += 1;
  data.writeUInt8(0, p); // field_definition_number
  p += 1;
  data.writeUInt8(BT_UINT16, p); // fit_base_type_id (uint16 — matches the data we emit)
  p += 1;
  // "power" + nulls
  data.write('power', p, 'utf8');
  p += FIELD_NAME_LEN;
  // "watts" + nulls
  data.write('watts', p, 'utf8');
  p += UNITS_LEN;
  parts.push(data);
}

// 4) record definition + 30 record data messages.
//    Standard fields: timestamp(253), power(7), cadence(4)
//    + ONE developer field (power, dev_idx=0, fdef=0, size=2)
{
  const STD_FIELDS = 3;
  const DEV_FIELDS = 1;
  // def header byte has dev-data attribution bit set (bit 5)
  const def = Buffer.alloc(6 + STD_FIELDS * 3 + 1 + DEV_FIELDS * 3);
  def.writeUInt8(writeDefinitionMessageHeader(LOCAL_RECORD, true), 0);
  def.writeUInt8(0x00, 1);
  def.writeUInt8(0x00, 2);
  def.writeUInt16LE(GLOBAL_RECORD, 3);
  def.writeUInt8(STD_FIELDS, 5);
  // field 253 timestamp uint32 (size 4)
  def.writeUInt8(253, 6);
  def.writeUInt8(4, 7);
  def.writeUInt8(BT_UINT32, 8);
  // field 7 power uint16 (size 2)
  def.writeUInt8(7, 9);
  def.writeUInt8(2, 10);
  def.writeUInt8(BT_UINT16, 11);
  // field 4 cadence uint8 (size 1)
  def.writeUInt8(4, 12);
  def.writeUInt8(1, 13);
  def.writeUInt8(BT_UINT8, 14);
  // dev fields count
  def.writeUInt8(DEV_FIELDS, 15);
  // dev field: field_definition_number=0, size=2, developer_data_index=0
  def.writeUInt8(0, 16);
  def.writeUInt8(2, 17);
  def.writeUInt8(0, 18);
  parts.push(def);

  // 30 data messages, 1 + 4 + 2 + 1 + 2 = 10 bytes each.
  for (let i = 0; i < RECORD_COUNT; i++) {
    const data = Buffer.alloc(1 + 4 + 2 + 1 + 2);
    let p = 0;
    data.writeUInt8(writeDataMessageHeader(LOCAL_RECORD), p);
    p += 1;
    data.writeUInt32LE(SYNTHETIC_EPOCH_FIT_SECONDS + i, p); // timestamp 1Hz
    p += 4;
    data.writeUInt16LE(STANDARD_POWER, p); // standard power
    p += 2;
    data.writeUInt8(STANDARD_CADENCE, p); // cadence
    p += 1;
    data.writeUInt16LE(DEVELOPER_POWER, p); // dev "power"
    p += 2;
    parts.push(data);
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Assemble: header + body + trailer
// ──────────────────────────────────────────────────────────────────────────

const body = Buffer.concat(parts);
const header = writeFitHeader({ headerLength: 14, dataLength: body.length });
// Trailer CRC range for 14-byte header excludes the header bytes (per
// fit-file-parser source). Pass only the body to writeCrcTrailer.
const trailer = writeCrcTrailer(body);
const final = Buffer.concat([header, body, trailer]);

const outDir = resolve('test/fixtures/fit');
mkdirSync(outDir, { recursive: true });
const outPath = resolve(outDir, 'shadow.fit');
writeFileSync(outPath, final);
console.log(`wrote ${outPath} (${final.length} bytes, ${RECORD_COUNT} records)`);
