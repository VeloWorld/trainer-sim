import FitParser from 'fit-file-parser';

// src/ftms/indoor-bike-data.ts
var FIELDS = {
  instantaneousSpeed: { resolution: 0.01, flagBit: 0},
  instantaneousCadence: { resolution: 0.5, flagBit: 2},
  instantaneousPower: { flagBit: 6}
};
var MORE_DATA_BIT = FIELDS.instantaneousSpeed.flagBit;
var CADENCE_PRESENT_BIT = FIELDS.instantaneousCadence.flagBit;
var POWER_PRESENT_BIT = FIELDS.instantaneousPower.flagBit;
function buildFlags(record) {
  let flags = 0;
  flags |= (record.speed === void 0 ? 1 : 0) << MORE_DATA_BIT;
  flags |= 1 << CADENCE_PRESENT_BIT;
  flags |= 1 << POWER_PRESENT_BIT;
  return flags;
}
function payloadByteLength(record) {
  return 6 + (record.speed !== void 0 ? 2 : 0);
}
function assertInt16(name, v) {
  if (!Number.isInteger(v) || v < -32768 || v > 32767) {
    throw new RangeError(`${name} out of sint16 range [-32768..32767]: ${v}`);
  }
}
function assertUint16(name, v) {
  if (!Number.isInteger(v) || v < 0 || v > 65535) {
    throw new RangeError(`${name} out of uint16 range [0..65535]: ${v}`);
  }
}
function encodeIndoorBikeData(record) {
  const view = new DataView(new ArrayBuffer(payloadByteLength(record)));
  let offset = 0;
  view.setUint16(offset, buildFlags(record), true);
  offset += 2;
  if (record.speed !== void 0) {
    const speedWire = Math.round(record.speed / FIELDS.instantaneousSpeed.resolution);
    assertUint16("speed", speedWire);
    view.setUint16(offset, speedWire, true);
    offset += 2;
  }
  const cadenceWire = Math.round(record.cadence / FIELDS.instantaneousCadence.resolution);
  assertUint16("cadence", cadenceWire);
  view.setUint16(offset, cadenceWire, true);
  offset += 2;
  assertInt16("power", record.power);
  view.setInt16(offset, record.power, true);
  offset += 2;
  return view;
}

// src/_internal/read-file.browser.ts
function readFile(_path) {
  return Promise.reject(
    new Error(
      "trainer-sim: loadFitFromPath is unavailable in browser builds. Use loadFitFromBuffer (or createFakeTransport({ source: { buffer } })) with bytes obtained via your own IPC bridge."
    )
  );
}

// src/_internal/debuglog.browser.ts
function debuglog(_namespace) {
  return () => {
  };
}

// src/fit/normalize.ts
var log = debuglog();
function normalize(parsed) {
  const records = parsed.records ?? [];
  const mapped = [];
  for (const rec of records) {
    if (!rec.timestamp) continue;
    const ride = { timestamp: rec.timestamp.getTime() };
    if (rec.power !== void 0) ride.power = rec.power;
    if (rec.cadence !== void 0) ride.cadence = rec.cadence;
    mapped.push(ride);
  }
  let outOfOrder = 0;
  for (let i = 1; i < mapped.length; i++) {
    if (mapped[i].timestamp < mapped[i - 1].timestamp) outOfOrder++;
  }
  const sorted = mapped.slice().sort((a, b) => a.timestamp - b.timestamp);
  const final = [];
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
  if (outOfOrder + duplicates > 0) {
    log(
      "normalize: %d duplicates dropped, %d out-of-order records reordered (input %d -> output %d)",
      duplicates,
      outOfOrder,
      mapped.length,
      final.length
    );
  }
  return final;
}

// src/fit/errors.ts
var FitLoadError = class extends Error {
  constructor(message) {
    super(message);
    this.name = this.constructor.name;
  }
};
var InvalidFitHeaderError = class extends FitLoadError {
};
var FitCrcError = class extends FitLoadError {
};
var FitTruncatedError = class extends FitLoadError {
};
var NoRecordMessagesError = class extends FitLoadError {
};

// src/fit/loader.ts
var log2 = debuglog();
var SHADOWED_STANDARD_FIELD_NAMES = /* @__PURE__ */ new Set(["power", "cadence", "timestamp"]);
var CRC_TABLE = [
  0,
  52225,
  55297,
  5120,
  61441,
  15360,
  10240,
  58369,
  40961,
  27648,
  30720,
  46081,
  20480,
  39937,
  34817,
  17408
];
function crc16Arc(buf, start, end) {
  let crc = 0;
  for (let i = start; i < end; i++) {
    let tmp = CRC_TABLE[crc & 15];
    crc = crc >> 4 & 4095;
    crc = crc ^ tmp ^ CRC_TABLE[buf[i] & 15];
    tmp = CRC_TABLE[crc & 15];
    crc = crc >> 4 & 4095;
    crc = crc ^ tmp ^ CRC_TABLE[buf[i] >> 4 & 15];
  }
  return crc;
}
function validateHeaderAndCrc(buf) {
  if (buf.length < 14) {
    throw new FitTruncatedError(
      `expected >=14 bytes (12-byte header + 2-byte CRC), got ${buf.length}`
    );
  }
  const headerLength = buf[0];
  if (headerLength !== 12 && headerLength !== 14) {
    throw new InvalidFitHeaderError(
      `header length must be 12 or 14, got ${headerLength}`
    );
  }
  const magic = String.fromCharCode(buf[8], buf[9], buf[10], buf[11]);
  if (magic !== ".FIT") {
    throw new InvalidFitHeaderError(
      `magic mismatch: expected '.FIT', got '${magic}'`
    );
  }
  const dataLength = buf[4] | buf[5] << 8 | buf[6] << 16 | buf[7] << 24;
  const totalExpected = headerLength + dataLength + 2;
  if (buf.length < totalExpected) {
    throw new FitTruncatedError(
      `expected ${totalExpected} bytes, got ${buf.length}`
    );
  }
  const crcStart = headerLength + dataLength;
  const crcExpected = buf[crcStart] | buf[crcStart + 1] << 8;
  const crcRangeStart = headerLength === 12 ? 0 : 14;
  const crcActual = crc16Arc(buf, crcRangeStart, crcStart);
  if (crcActual !== crcExpected) {
    throw new FitCrcError(
      `CRC mismatch: expected 0x${crcExpected.toString(16).padStart(4, "0")}, got 0x${crcActual.toString(16).padStart(4, "0")}`
    );
  }
}
function makeFitFileParserSource() {
  return {
    parse(buffer) {
      const parser = new FitParser({ mode: "list", force: false });
      let parsed;
      let firstError;
      parser.parse(buffer, (err, data) => {
        if (err && firstError === void 0) firstError = err;
        else if (data && parsed === void 0) parsed = data;
      });
      if (!parsed) {
        throw new FitTruncatedError(
          `fit-file-parser rejected the input: ${firstError ?? "unknown error"}`
        );
      }
      return parsed;
    }
  };
}
var source = makeFitFileParserSource();
function detectAndLogShadow(parsed) {
  for (const desc of parsed.field_descriptions ?? []) {
    const name = desc.field_name?.toLowerCase();
    if (name && SHADOWED_STANDARD_FIELD_NAMES.has(name)) {
      log2(
        "developer field shadow detected on standard field %s (developer_data_index=%d, field_definition_number=%d) \u2014 fit-file-parser collides developer value onto record.%s; returning whatever parser produced (D-FIT-10)",
        name,
        desc.developer_data_index,
        desc.field_definition_number,
        name
      );
    }
  }
}
function loadFitFromBuffer(input) {
  const buf = input;
  validateHeaderAndCrc(buf);
  const parsed = source.parse(buf);
  detectAndLogShadow(parsed);
  if (!parsed.records || parsed.records.length === 0) {
    throw new NoRecordMessagesError(
      "FIT file is valid but contains no record messages"
    );
  }
  return normalize(parsed);
}
async function loadFitFromPath(path) {
  const buf = await readFile();
  return loadFitFromBuffer(buf);
}

// src/_internal/event-emitter.browser.ts
var EventEmitter = class {
  listeners = {};
  on(event, listener) {
    (this.listeners[event] ??= []).push(listener);
    return this;
  }
  off(event, listener) {
    const arr = this.listeners[event];
    if (!arr) return this;
    const idx = arr.indexOf(listener);
    if (idx !== -1) arr.splice(idx, 1);
    return this;
  }
  once(event, listener) {
    const wrapper = ((...args) => {
      this.off(event, wrapper);
      listener(...args);
    });
    return this.on(event, wrapper);
  }
  emit(event, ...args) {
    const arr = this.listeners[event];
    if (!arr || arr.length === 0) return false;
    for (const l of arr.slice()) l(...args);
    return true;
  }
  listenerCount(event) {
    return this.listeners[event]?.length ?? 0;
  }
  removeAllListeners(event) {
    if (event === void 0) this.listeners = {};
    else delete this.listeners[event];
    return this;
  }
};

// src/_internal/sleep.browser.ts
function defaultSleep(delay, value, options) {
  return new Promise((resolve, reject) => {
    const signal = options?.signal;
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      return;
    }
    const id = setTimeout(() => {
      if (signal) signal.removeEventListener("abort", onAbort);
      resolve(value);
    }, delay);
    const onAbort = () => {
      clearTimeout(id);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
async function runScheduler(input) {
  if (input.records.length === 0) {
    return;
  }
  const { records, speed, loop, maxEmissionHz, signal, emit, getNow } = input;
  const sleep = input.sleep ?? defaultSleep;
  const minIntervalMs = 1e3 / maxEmissionHz;
  const firstTs = records[0].timestamp;
  let baseline = getNow();
  let cursor = 0;
  while (true) {
    const record = records[cursor];
    const targetSinceStart = speed === Infinity ? 0 : (record.timestamp - firstTs) / speed;
    const target = baseline + targetSinceStart;
    const delay = Math.max(target - getNow(), minIntervalMs);
    if (target - getNow() < minIntervalMs) ;
    await sleep(delay, void 0, { signal });
    if (signal.aborted) {
      throw signal.reason;
    }
    emit(record);
    cursor++;
    if (cursor >= records.length) {
      if (!loop) {
        return;
      }
      cursor = 0;
      baseline = getNow();
    }
  }
}

// src/replay/replay.ts
var Replay = class {
  /**
   * Frozen at construction; not mutated. `ReplayConfig` is internal — see
   * `./types.ts`. The scheduler reads `records` as `ReadonlyArray`, so no
   * defensive copy is needed.
   */
  config;
  /**
   * D-REPL-11 — single subscriber slot. Phase 4 wraps for fan-out. `undefined`
   * until `onRecord(handler)` is called; `start()` throws if still undefined.
   */
  subscriber = void 0;
  /**
   * D-REPL-09 — internal AbortController; `stop()` calls `.abort()`.
   * Initialized lazily in `start()` so a never-started instance has nothing
   * to clean up.
   */
  controller = void 0;
  /**
   * D-REPL-07 + single-use lock — see `start()`. Public read access via the
   * `currentState` getter (the sole accessor — RESEARCH §Open Questions Q3).
   */
  state = "idle";
  /**
   * D-REPL-08 — Promise-first completion surface. Constructed via
   * `Promise.withResolvers()` (Node 22+; RESEARCH §Don't Hand-Roll + A5)
   * instead of a hand-rolled `withDeferred` helper.
   */
  completedDeferred;
  constructor(config) {
    this.config = config;
    this.completedDeferred = Promise.withResolvers();
  }
  /**
   * D-REPL-08 — resolves on natural completion (`done`); rejects with the
   * scheduler's underlying rejection (`signal.reason ?? AbortError`) on
   * `stop()` or external abort (`aborted`). Stable identity across the
   * Replay's lifetime — callers may `await` it before or after `start()`.
   */
  get completed() {
    return this.completedDeferred.promise;
  }
  /**
   * Read-only state accessor — the ONE accessor we expose
   * (RESEARCH §Open Questions Q3 — `cursor` and `elapsedMs` deliberately
   * omitted per CLAUDE.md "no abstractions for hypothetical future
   * requirements"). Plan 03-03's tests use this to assert
   * `'idle' → 'running' → ('done' | 'aborted')` transitions.
   */
  get currentState() {
    return this.state;
  }
  /**
   * D-REPL-11 — register the single subscriber. Returns a disposer that
   * clears the slot if (and only if) the registered handler is still the
   * one in residence; Phase 4 will wrap this disposer for its own fan-out
   * subscriber map.
   *
   * Throws if called twice on the same instance (single-subscriber lock —
   * D-REPL-11) or after `start()` (subscribers attach BEFORE start, not
   * after — RESEARCH §Pitfall 10 silent-drop avoidance).
   */
  onRecord(handler) {
    if (this.subscriber !== void 0) {
      throw new Error("Replay.onRecord: single-subscriber slot already taken (D-REPL-11). Phase 4 wraps for fan-out.");
    }
    if (this.state !== "idle") {
      throw new Error("Replay.onRecord: must be called before start() (D-REPL-11)");
    }
    this.subscriber = handler;
    return () => {
      if (this.subscriber === handler) {
        this.subscriber = void 0;
      }
    };
  }
  /**
   * Kick off the scheduler. Single-use per D-REPL-07 (RESEARCH §Open
   * Questions Q1) — calling `start()` after `done`/`aborted` throws.
   *
   * Fail-fast guards (in order):
   *   1. `subscriber === undefined` — RESEARCH §Pitfall 10, silent emission
   *      drops are forbidden.
   *   2. `state !== 'idle'` — D-REPL-07 single-use lock.
   *   3. `records.length === 0` — defense-in-depth (the scheduler also
   *      handles this; RESEARCH §Pitfall 9). Throwing here gives Phase 4 a
   *      clearer error than a silently-resolved completed Promise.
   *   4. `config?.signal?.aborted` — RESEARCH §Pitfall 4. A pre-aborted
   *      signal would otherwise reject the scheduler synchronously; failing
   *      fast surfaces the misuse cleanly.
   *
   * Signal composition (RESEARCH §Open Questions Q3): if an external signal
   * is supplied, `AbortSignal.any([external, internal])` produces the
   * composite signal the scheduler awaits. Either source aborts cleanly.
   *
   * `sleep` is an optional test-only injection seam — production callers
   * never pass it. Plan 03-03's tests pass a `globalThis.setTimeout`-based
   * variant because Vitest 4 cannot fake the `node:timers/promises`
   * module-level binding (RESEARCH §Pitfall 6 parallel — same fix as
   * `getNow` and the scheduler's `sleep` seam from plan 03-03 fix commit).
   */
  start(config) {
    if (this.subscriber === void 0) {
      throw new Error("Replay.start: onRecord must be called before start() (D-REPL-11)");
    }
    if (this.state !== "idle") {
      throw new Error(`Replay.start: instance is single-use; state is ${this.state} (D-REPL-07). Construct a new Replay to replay again.`);
    }
    if (this.config.records.length === 0) {
      throw new Error("Replay.start: records cannot be empty (D-REPL-13)");
    }
    if (config?.signal?.aborted) {
      throw new Error("Replay.start: external signal is already aborted (D-REPL-09)");
    }
    this.controller = new AbortController();
    const signal = config?.signal ? AbortSignal.any([config.signal, this.controller.signal]) : this.controller.signal;
    this.state = "running";
    const sub = this.subscriber;
    runScheduler({
      records: this.config.records,
      speed: this.config.speed,
      loop: this.config.loop,
      maxEmissionHz: this.config.maxEmissionHz,
      signal,
      emit: (r) => sub(r),
      // RESEARCH §Pitfall 6 + Vitest fake-timer recipe: read through
      // `globalThis.performance` at call time so `vi.useFakeTimers()` (which
      // replaces the global) takes effect for tests.
      getNow: () => globalThis.performance.now(),
      sleep: config?.sleep
    }).then(
      () => {
        this.state = "done";
        this.completedDeferred.resolve();
      },
      (err) => {
        this.state = "aborted";
        this.completedDeferred.reject(err);
      }
    );
    this.completedDeferred.promise.catch(() => void 0);
  }
  /**
   * D-REPL-09 — abort the scheduler. Idempotent: calling `stop()` while
   * `idle`, `done`, or `aborted` is a safe no-op so Phase 4 can call it
   * defensively without guarding state. The actual transition to `aborted`
   * happens in `start()`'s `.then` failure branch when the scheduler's
   * `node:timers/promises` rejection lands (D-REPL-10 — no emissions after
   * abort, owned by the scheduler).
   */
  stop() {
    if (this.state !== "running") {
      return;
    }
    this.controller?.abort();
  }
};

// src/transport/fake-transport.ts
var log4 = debuglog();
function createFakeTransport(config, options) {
  const speed = config.speed ?? 1;
  const loop = config.loop ?? false;
  const maxEmissionHz = config.maxEmissionHz ?? 1e3;
  if (!(speed > 0)) {
    throw new Error(`createFakeTransport: speed must be > 0, got ${String(speed)}`);
  }
  if (!(maxEmissionHz > 0)) {
    throw new Error(
      `createFakeTransport: maxEmissionHz must be > 0, got ${String(maxEmissionHz)}`
    );
  }
  const subscribers = /* @__PURE__ */ new Set();
  const resistanceLog = [];
  const emitter = new EventEmitter();
  let replay;
  let connectInFlight;
  async function loadRecords() {
    const src = config.source;
    if ("records" in src) return src.records;
    if ("buffer" in src) return loadFitFromBuffer(src.buffer);
    return loadFitFromPath(src.path);
  }
  function connect() {
    if (replay !== void 0) return Promise.resolve();
    if (connectInFlight !== void 0) return connectInFlight;
    connectInFlight = (async () => {
      try {
        const records = await loadRecords();
        if (records.length === 0) {
          throw new Error("createFakeTransport.connect: source produced zero records");
        }
        const r = new Replay({ records, speed, loop, maxEmissionHz });
        r.onRecord((rec) => {
          const dv = encodeIndoorBikeData({
            power: rec.power ?? 0,
            cadence: rec.cadence ?? 0
          });
          for (const h of subscribers) {
            try {
              h(dv);
            } catch (err) {
              log4("subscriber threw: %O", err);
            }
          }
        });
        r.completed.then(
          () => {
            try {
              emitter.emit("complete");
            } catch (err) {
              log4("'complete' listener threw: %O", err);
            }
          },
          () => void 0
        );
        r.start(options?.sleep ? { sleep: options.sleep } : void 0);
        replay = r;
      } finally {
        connectInFlight = void 0;
      }
    })();
    return connectInFlight;
  }
  async function disconnect() {
    if (connectInFlight !== void 0) {
      await connectInFlight.catch(() => void 0);
    }
    if (replay === void 0) return;
    const r = replay;
    replay = void 0;
    r.stop();
    await r.completed.catch(() => void 0);
  }
  function onData(handler) {
    subscribers.add(handler);
    return () => {
      subscribers.delete(handler);
    };
  }
  async function sendResistance(grade) {
    await Promise.resolve();
    resistanceLog.push(grade);
  }
  async function reset() {
    await disconnect();
    resistanceLog.length = 0;
  }
  const transport = {
    connect,
    disconnect,
    onData,
    sendResistance,
    get received() {
      return { resistance: resistanceLog };
    },
    reset,
    on(event, listener) {
      emitter.on(event, listener);
    },
    off(event, listener) {
      emitter.off(event, listener);
    },
    once(event, listener) {
      emitter.once(event, listener);
    }
  };
  return transport;
}

export { FitCrcError, FitLoadError, FitTruncatedError, InvalidFitHeaderError, NoRecordMessagesError, createFakeTransport, encodeIndoorBikeData, loadFitFromBuffer, loadFitFromPath };
//# sourceMappingURL=index.browser.js.map
//# sourceMappingURL=index.browser.js.map