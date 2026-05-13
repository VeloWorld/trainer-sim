# Pitfalls Research

**Domain:** Node.js BLE FTMS smart trainer simulator that replays pre-recorded FIT files
**Researched:** 2026-05-13
**Confidence:** HIGH for FTMS encoding (cross-checked Auuki JS + PyFTMS Python implementations + Bluetooth SIG spec); HIGH for FIT format (Garmin SDK + muktihari/fit Go reference); HIGH for Node timer / AbortController behavior (official Node docs); MEDIUM for cross-app (Zwift/TrainerRoad/VeloWorld) compatibility — based on documented community behavior, not first-party docs

## Critical Pitfalls

### Pitfall 1: Treating IndoorBikeData "More Data" flag bit (bit 0) like every other flag bit

**What goes wrong:**
The FTMS spec defines `Flags` as a uint16 little-endian bitfield where, for IndoorBikeData (0x2AD2), bit 0 is named "More Data" and is **inverted** relative to every other flag bit:
- Bit 0 = `0` → Instantaneous Speed **is present**
- Bit 0 = `1` → Instantaneous Speed **is NOT present** (more data fits in subsequent fields)
- Bits 1-12 follow normal "1 = field present" semantics (avg speed, instant cadence, avg cadence, total distance, resistance level, instant power, avg power, expanded energy, heart rate, MET, elapsed time, remaining time)

If the encoder writes flags as if every bit followed the "1 = present" convention, decoders will either drop speed when it is present, or expect speed bytes that aren't there and read garbage from the cadence/power fields downstream.

**Why it happens:**
Every other GATT characteristic with a flags byte (HRM, CSC, CPS) uses "1 = present." Developers see bit 0 of a flags byte and assume the same convention without re-reading the FTMS spec. The Auuki reference implementation has `speedPresent = (flags >> 0 & 1) === 0` (note the `=== 0`) which is correct but visually inverted from the others.

**How to avoid:**
- Hard-code a named constant `MORE_DATA_BIT = 0` and document the inversion in a one-line comment at the call site.
- Encoder must set bit 0 to `0` whenever Instantaneous Speed is included in the payload (which for v1 is always — speed is the only field with the inverted convention).
- Round-trip test: encode a known IndoorBikeData payload and decode it with a third-party decoder (e.g., a Web Bluetooth client like the Auuki repo or a phone with nRF Connect) — the decoded speed must match what was encoded.

**Warning signs:**
- VeloWorld decoder shows `speed = 0` even when power is correct.
- Reading the payload in nRF Connect shows speed bytes interpreted as cadence (off by 2 bytes downstream).
- VeloWorld v1 doesn't consume speed (per PROJECT.md), so this bug **will silently ship and only surface when a future consumer reads the speed field** — flag for explicit test even though VeloWorld won't notice.

**Phase to address:** FTMS encoder phase. Test with at least one external decoder (Auuki, nRF Connect, or PyFTMS) before declaring the encoder "done."

---

### Pitfall 2: InstantaneousPower as Uint16 instead of sint16 (signed)

**What goes wrong:**
The FTMS spec defines IndoorBikeData InstantaneousPower as **sint16** (signed 16-bit, watts, resolution 1 W). The signed type allows negative power (regenerative braking, freewheeling on smart trainers that support it). Encoding as Uint16 silently works for typical power values 0–32767 W, but any consumer that reads the payload as sint16 will misinterpret values ≥ 32768 (which won't happen in real cycling) and — more importantly — your encoder may emit different byte layout assumptions than other tooling expects, breaking interop matrices.

Concrete evidence from this research:
- Auuki (`src/ble/ftms/indoor-bike-data.js`) encodes power as `Uint16` — incorrect per spec, but works because real-world power is always ≥ 0.
- PyFTMS (`models/realtime_data/indoor_bike.py`) encodes power as `s2` (sint16) — spec-compliant.

The same trap applies to `ResistanceLevel` (sint16 per spec) and `Inclination` (sint16). Power and resistance can be modeled as unsigned safely "in practice" but **must** be sint16 to match the spec and to interop with strict decoders.

**Why it happens:**
Watts feel non-negative ("you can't pedal negative power"), so developers default to unsigned. The mistake is invisible in practice because no real ride produces a negative power reading.

**How to avoid:**
- Reference the FTMS GATT XML / spec table directly; don't infer types from "common sense."
- Use a single source of truth in the encoder (e.g., an array of `{ name, type: 'sint16' | 'uint16' | 'uint8' | 'uint24', resolution, unit, flagBit }`) and review it against the spec line by line.
- Unit test: encode `power = -1` and decode it back to `-1`. If the decoder reads `65535`, the type is wrong.

**Warning signs:**
- Tests that round-trip realistic positive power values pass, but no test exercises sign edges.
- Strict decoders (e.g., PyFTMS) refuse the payload or emit unexpected values.

**Phase to address:** FTMS encoder phase — encoder field-table phase. Add a "spec table review" gate before declaring the codec done.

---

### Pitfall 3: Cadence half-rpm resolution (uint16, 0.5 rpm) encoded as integer rpm

**What goes wrong:**
IndoorBikeData InstantaneousCadence is a **uint16 with resolution 0.5 rpm** — the wire value is `cadence_rpm * 2`. So 90 rpm → 180 (0xB400 little-endian, i.e. bytes `B4 00`). Encoders that forget to multiply by 2 emit half the actual cadence. Decoders that forget to divide by 2 show double cadence (e.g., 90 → 45 rpm or 180 rpm depending on direction).

**Why it happens:**
Power is `* 1` resolution (1 W), so developers assume cadence is too. Speed is `* 0.01` (0.01 km/h) so cadence "0.5" feels arbitrary. The spec is the only source.

**How to avoid:**
- Encode the resolution table once and reuse it everywhere:
  ```ts
  const FIELDS = {
    instantaneousSpeed:   { type: 'uint16', resolution: 0.01, unit: 'km/h' }, // wire = value / 0.01
    instantaneousCadence: { type: 'uint16', resolution: 0.5,  unit: 'rpm'  }, // wire = value / 0.5
    instantaneousPower:   { type: 'sint16', resolution: 1,    unit: 'W'    },
    totalDistance:        { type: 'uint24', resolution: 1,    unit: 'm'    },
  } as const;
  ```
- Round-trip test: encode 90 rpm, decode, expect 90 rpm. Encode 90.5 rpm, expect 90.5 (the half-rpm is real and intended).
- When mapping from FIT records (which give cadence as **uint8 rpm, integer**), the conversion is `wire = fitCadence * 2`.

**Warning signs:**
- Reported cadence in VeloWorld is exactly half or exactly double of the FIT source.
- nRF Connect shows cadence values in increments of 1 instead of 0.5.

**Phase to address:** FTMS encoder phase. Same "spec table review" gate as Pitfall 2.

---

### Pitfall 4: Multi-byte field endianness (little-endian) mistake

**What goes wrong:**
All multi-byte numeric fields in FTMS, GATT in general, and FIT files are **little-endian** on the wire. Writing `DataView.setUint16(offset, value)` without the second `littleEndian: true` argument defaults to **big-endian**, producing reversed bytes. A 180-rpm cadence (`0x00B4`) becomes `0xB400` on the wire, which decodes as 46080 rpm.

`DataView` defaults to big-endian; `Buffer.writeUInt16LE` is explicitly little-endian. Mixing both in the same codebase (e.g., DataView for some fields, Buffer for others) is where bugs hide.

**Why it happens:**
JavaScript's `DataView` API uses big-endian by default — opposite of what every wire protocol you'll meet on a BLE bike actually uses. Forgetting the `true` second arg compiles fine, runs fine, and produces a binary string that *looks* correct in a hex dump if you don't read the byte order.

**How to avoid:**
- Pick one API and stick to it. For codec encode, `Buffer.writeUInt16LE` / `writeInt16LE` is unambiguous (LE is in the name).
- If you use `DataView`, write a thin wrapper (`writeU16LE(view, offset, value) → view.setUint16(offset, value, true)`) and ban raw `setUint16` in lint.
- Test with a known-good payload: encode `power=250 W` → expect bytes `FA 00`, not `00 FA`.

**Warning signs:**
- Power readings off by huge factors (256x, 65536x).
- The first byte of a multi-byte field is always near zero in a hex dump (a tell that you're writing big-endian).

**Phase to address:** Foundation / codec phase — settle codec's byte-writing convention in the first encode commit.

---

### Pitfall 5: Wrong characteristic notification rate (too fast or too slow for FTMS apps)

**What goes wrong:**
FTMS doesn't mandate a notification rate, but real consuming apps have de facto expectations:
- **Zwift/TrainerRoad/Rouvy expect ~1 Hz IndoorBikeData notifications** (some implementations tolerate 2–4 Hz; faster than that risks dropped packets or app stutters as it processes the queue).
- Notifications faster than the BLE connection interval will be dropped at the link layer (typical CI ~30 ms = ~33 Hz ceiling, but apps don't expect that rate).
- Notifications slower than ~0.5 Hz make the consuming app think the trainer disconnected (Zwift in particular flags trainers that haven't notified in ~3 s as "lost").

For the v1 FakeTransport this matters less (consumer reads in-process), but the **replay engine's tick rate is a baked-in design decision** that v2 BlenoTransport will inherit. If the replay engine ticks at 10 Hz but each tick emits a notification, BlenoTransport will be off-spec the moment it ships.

**Why it happens:**
Real FIT files are typically 1 Hz records (Garmin/Wahoo default). Devs see 1-second timestamps and assume that's the trainer notification rate. But FIT records and BLE notifications are different concerns: you might want to replay at 1 Hz from FIT but interpolate to 4 Hz for smoother resistance-feel, or replay at 4x speed (4 Hz from a 1 Hz source) and need to think about whether to emit each at the source rate.

**How to avoid:**
- Default IndoorBikeData notification rate to **1 Hz** (matches FIT record cadence and standard FTMS trainer behavior).
- Decouple "replay tick" from "notification emit." Replay engine emits the **latest power/cadence sample** at notification cadence; samples between ticks are dropped or held.
- For FakeTransport v1, expose the notification rate as a config option (`{ notifyHz: 1 }`) so consumers can crank it for fast tests.
- v2 BlenoTransport: cap at 4 Hz; document Zwift's de facto 1 Hz expectation in the README.

**Warning signs:**
- VeloWorld shows steppy power because 1 Hz updates lag behind UI render.
- v2 BLE testing: Zwift drops the trainer mid-ride.

**Phase to address:** Replay engine phase — get the tick / notify split right before encoder is wired up.

---

### Pitfall 6: setTimeout / setInterval drift over long replays

**What goes wrong:**
Driving real-time replay with `setInterval(emitTick, 1000)` accumulates drift over a 60-minute ride: each tick is scheduled "at least 1000 ms after the previous one fired," not "at exactly t=0, 1000, 2000…." If the event loop is busy (FIT parse work, GC pause, file I/O), each tick slips a few ms. Over 3600 ticks, total drift can reach seconds — meaning your "1-hour replay" actually finishes 1h0m08s after start, and per-sample timing is no longer faithful to the FIT timestamp curve.

`setTimeout` chained recursively (`setTimeout(tick, nextDelay)` from inside `tick`) drifts even more because each `nextDelay` is computed *after* the current tick body has already run.

**Why it happens:**
Node's docs explicitly say "[A timer] specifies the threshold after which a provided callback may be executed rather than the exact time it should be executed." Devs treat `setTimeout(fn, ms)` as exact, then build replay logic on a foundation that's drift-by-design.

**How to avoid:**
- **Drive replay off a "next sample due at wall-clock time T" model**, not "wait N ms."
  ```ts
  const startWall = Date.now();
  const startFitTs = firstRecord.timestamp; // FIT seconds-from-epoch
  function scheduleNext(record) {
    const fitElapsed = (record.timestamp - startFitTs) * 1000; // ms
    const wallElapsed = Date.now() - startWall;
    const delay = Math.max(0, (fitElapsed / speedMultiplier) - wallElapsed);
    setTimeout(() => emit(record), delay);
  }
  ```
  Drift no longer accumulates because each `delay` is recomputed against the absolute target.
- For sub-100 ms precision, prefer `process.hrtime.bigint()` over `Date.now()` (avoids wall-clock jumps on NTP correction).
- Long-soak smoke test: replay a 30-minute FIT at 1x and assert end time is within 250 ms of the FIT duration.

**Warning signs:**
- 1-hour replay ends 5+ seconds late.
- Tests that replay at 1000x (so a 1h ride completes in 3.6s) pass, but real-time replays drift visibly.

**Phase to address:** Replay engine phase. Build the absolute-deadline scheduler before plumbing it into the FTMS emitter.

---

### Pitfall 7: Blocking the event loop during FIT parse (defeats the replay scheduler)

**What goes wrong:**
A typical 1-hour Garmin FIT file is 50–500 KB and contains 3,600+ Record messages. Parsing it synchronously (`fitParser.parseSync(buffer)`) blocks the event loop for 50–500 ms. If you parse-on-demand during replay (e.g., per-sample lazy parse), every tick stalls. If you parse upfront synchronously inside the FakeTransport constructor, the consuming test pauses for half a second on init — annoying but tolerable.

The trap: pairing a "perfect" drift-free scheduler (Pitfall 6) with a synchronous parse that blocks for hundreds of ms means your scheduler's deadlines are silently missed and drift appears anyway.

**Why it happens:**
FIT parser libraries default to synchronous APIs because the file is small and the data is decoded eagerly. JS devs trained on async I/O don't notice that `parseSync` is fine for a CLI but kills a real-time emitter.

**How to avoid:**
- **Parse upfront, not lazily.** Load the entire FIT file into an in-memory array of normalized samples (`{ timestamp, power, cadence }[]`) before the first `connect()` resolves.
- If FIT files are ever > 5 MB (long ultra rides, multi-hour soak runs), do the parse in a worker thread (`worker_threads`) and post the parsed array back.
- Use `fit-file-parser`'s `parseAsync(buffer)` form (returns a Promise) rather than the callback form, so the parse phase yields between chunks.
- Performance gate: parse + first-sample-emitted should be < 100 ms for a typical 1-hour file. Add a benchmark.

**Warning signs:**
- `connect()` returns instantly but no samples for 200 ms.
- Replay drift appears even after fixing the scheduler in Pitfall 6.

**Phase to address:** FIT loader phase — establish the "parse upfront, normalize, replay from array" model in the first commit.

---

### Pitfall 8: AbortController not fully tearing down the replay loop

**What goes wrong:**
`disconnect()` is expected to cancel the in-flight replay, but if the replay loop uses `setTimeout` and the `disconnect` handler only sets a `stopped = true` flag, the next-tick callback still fires and may emit a final, post-disconnect IndoorBikeData notification. In tests this manifests as flaky assertions ("expected 5 emissions, got 6"). In v2 BLE this could write to a closed characteristic and crash the bleno process.

The promise-flavored `setTimeout` from `node:timers/promises` accepts an `AbortSignal`, but throws `AbortError` instead of resolving cleanly — and the throw needs to be caught at the loop level, not just the leaf, or the rejection becomes an unhandled promise rejection.

**Why it happens:**
"`disconnect()` should stop the replay" feels obvious; the fact that an already-scheduled `setTimeout` callback will still fire isn't. Devs add a flag and forget to also `clearTimeout(handle)`.

**How to avoid:**
- Replay loop owns a single `currentTimeoutHandle` and `disconnect()` calls `clearTimeout(handle)` before resolving.
- Use the promise-flavored `setTimeout(ms, undefined, { signal: ac.signal })` and wrap the loop body in:
  ```ts
  try { await sleep(delay, { signal }); }
  catch (err) { if (err.name === 'AbortError') return; throw err; }
  ```
- Add a test: `transport.connect(); await emit; transport.disconnect(); await wait(100); assertNoMoreEmissions()`.
- The `ITrainerTransport` contract should specify: after `disconnect()` resolves, no further `onData` callbacks fire.

**Warning signs:**
- Flaky tests that occasionally see one more emission than expected.
- "Unhandled promise rejection: AbortError" in CI logs.

**Phase to address:** Replay engine phase + transport API phase — settle the disconnect semantics before consumers depend on them.

---

### Pitfall 9: FIT file gaps, autopause, and missing records replayed as wall-clock gaps

**What goes wrong:**
Real Garmin/Wahoo FIT files have non-uniform timestamps:
- **Autopause** during a stop sign creates a gap (e.g., timestamps jump from 14:23:45 to 14:24:12, a 27-second hole with no records).
- **Smart Recording** mode skips records when values change little (variable interval, often 5–15 s gaps on flat steady riding).
- **Missing records** from sensor dropouts (HR strap glitches, power meter battery dies mid-ride) — the timestamp continues but power/cadence are null/undefined.
- **Trailing records** can have a `timestamp` but null power and cadence (Garmin writes a "session end" record).

If the replay engine just sleeps for `next.timestamp - prev.timestamp`, it will sit silent for 27 seconds during the autopause gap. Worse, it may emit `power=undefined` to the FTMS encoder, which (depending on encoding strategy) emits zero, NaN, or a stale value, or throws.

**Why it happens:**
Test FIT files (synthetic or short clean rides) don't reproduce these conditions. Real Wahoo/Garmin exports do.

**How to avoid:**
- Define explicit policy for each gap type, encoded as config:
  - `gapStrategy: 'preserveSilence' | 'holdLast' | 'skipGap'` (default: `holdLast` — emit last known good value at notification cadence through the gap).
  - `nullPowerStrategy: 'zero' | 'holdLast' | 'skip'` (default: `holdLast`).
- During FIT parse, **normalize**: walk the records, fill missing power/cadence with previous good value, mark gap regions for the replay engine.
- Test with a FIT file that has a known autopause gap. Test with a FIT file that has null power records.
- Cap gap duration: if a gap > 30s, log a warning. If > 5 min, throw on parse (the file is likely malformed for replay).

**Warning signs:**
- Replay sits idle for 30 seconds in the middle of a ride.
- VeloWorld shows `power=0` mid-ride for no apparent reason.
- IndoorBikeData payload shape changes mid-replay because power flag bit toggles (different payload length tick-to-tick — many decoders don't handle this gracefully).

**Phase to address:** FIT loader + replay engine phase. The normalization step belongs in the loader, gap handling in the replay engine.

---

### Pitfall 10: FIT timestamp epoch is 1989, not Unix

**What goes wrong:**
FIT timestamps are **uint32 seconds since 1989-12-31 00:00:00 UTC**, not the Unix epoch (1970-01-01). Treating a FIT timestamp as a Unix timestamp puts the ride 19 years and 364 days too early (ride date ~2007 instead of 2026), or breaks Date math entirely when the value is small.

The offset is `631065600` seconds (FIT-epoch - Unix-epoch).

Related: `local_timestamp` in the Activity message is the same uint32 seconds-from-FIT-epoch but **adjusted to the recorder's local timezone** (it's not a UTC time). Most fields use UTC; `local_timestamp` is the exception. The difference between `timestamp` and `local_timestamp` in the same Activity message reveals the recording timezone.

**Why it happens:**
JS devs assume `new Date(fitTs * 1000)` works. It silently produces a 1989-90 date.

**How to avoid:**
- Single helper at the parse boundary:
  ```ts
  const FIT_EPOCH_OFFSET_SEC = 631_065_600;
  const fitToUnixMs = (fitTs: number) => (fitTs + FIT_EPOCH_OFFSET_SEC) * 1000;
  ```
- For replay, only the **delta** between record timestamps matters (not absolute time), so this trap is easy to miss until you log timestamps for debugging and see "1990-01-01."
- If the FIT parser library you choose already converts to Date (some do, some don't), document which.

**Warning signs:**
- Logged record timestamps are in 1990.
- A FIT file recorded today shows up in the parsed output as "Tue Jan 01 1990."

**Phase to address:** FIT loader phase. Wrap conversion at the parser boundary.

---

### Pitfall 11: Developer-defined FIT fields shadowing or clobbering standard fields

**What goes wrong:**
FIT 2.0 supports developer-defined fields registered via `developer_data_id` and `field_description` messages. Some apps (TrainerRoad's exporter, Stryd, third-party head units) write developer fields with the **same name as standard fields** ("power", "cadence") but different units, scaling, or semantics. A naive parser that grabs the first field named "power" might pick the developer field with units in deciwatts (0.1 W) instead of the standard `record.power` field in watts — silently producing 10x the actual power.

Also: developer fields require parsing the `field_description` message *before* the records that reference them. Streaming parsers that emit records as they're read may emit records with developer fields not-yet-named.

**Why it happens:**
Developer fields are an under-documented FIT 2.0 feature; most tutorials show only standard fields. Library defaults vary.

**How to avoid:**
- **Read only standard fields by message-num + field-num**, not by name. Standard `record.power` is `mesg=20, field=7`. Developer fields are in a separate `developerFields` array.
- For v1, **explicitly ignore all developer fields**. Only use `record.power` (uint16, watts) and `record.cadence` (uint8, rpm).
- If the FIT parser library you choose collapses standard and developer fields into a flat object, switch parsers or post-process to drop developer-prefixed keys.
- Test with a FIT file from TrainerRoad (known to write developer fields) and assert that power values match what TrainerRoad shows in its own UI.

**Warning signs:**
- Power readings 10x or 0.1x of expected.
- Power values that look like floats from a uint16 field.
- `record.power` and `record.developerPower` both present in the parsed output.

**Phase to address:** FIT loader phase + research phase (FIT parser library evaluation). The PROJECT.md already defers parser choice to research — this pitfall is one of the criteria.

---

### Pitfall 12: `sendResistance` accidentally async-but-synchronous (or vice versa)

**What goes wrong:**
The `ITrainerTransport` contract defines `sendResistance(grade: number): Promise<void>` (or similar). Common bugs:
1. FakeTransport's `sendResistance` is declared `async` but the body is purely synchronous (resolves on the same microtask). Real BlenoTransport will need an actual await on the BLE write callback. Tests pass against Fake, fail against Bleno because timing semantics differ.
2. The opposite: declared synchronous (`sendResistance(grade): void`) but BlenoTransport needs to await the BLE write. Now the interface forces BlenoTransport to lie about completion, and consumers can't `await` the write.
3. FakeTransport's `sendResistance` mutates a shared array (`callsLog.push(grade)`) but doesn't `await` anything, so test assertions read the array before the consumer's promise chain settles. Race condition.

**Why it happens:**
"It's just a fake; it's instant" thinking. The interface contract should be driven by the **real transport's needs**, not the fake's convenience.

**How to avoid:**
- Define `ITrainerTransport.sendResistance` as `async (grade: number): Promise<void>` and **always** `await` it in tests, regardless of transport.
- FakeTransport's body uses `await Promise.resolve()` (or `await new Promise(r => setImmediate(r))`) to force a microtask boundary, matching real-BLE behavior more faithfully.
- Test assertion pattern: `await transport.sendResistance(0.05); expect(transport.calls).toEqual([0.05]);` — the assertion comes after the await, so the synchronous-vs-async question is moot.
- Document in `ITrainerTransport.ts` JSDoc: "Resolves when the underlying transport has accepted the write (Fake: next microtask; Bleno: BLE write callback)."

**Warning signs:**
- Tests that work alone but fail when run together (interleaved promise queues).
- Tests that pass with FakeTransport but fail with BlenoTransport in v2.
- `transport.calls.length` is 0 immediately after `sendResistance` returns.

**Phase to address:** Transport API / `ITrainerTransport` contract phase — settle async semantics in the type definition before either transport implements it.

---

### Pitfall 13: Leaking BLE-specific types into the `ITrainerTransport` shape

**What goes wrong:**
`ITrainerTransport.onData` is supposed to expose a transport-agnostic payload (a `DataView`, `Buffer`, or domain object). Common leak: typing `onData(callback: (data: DataView, characteristic: BlenoCharacteristic) => void)` couples the consumer to bleno's API. Now FakeTransport has to mock `BlenoCharacteristic`, and any consumer that imports `ITrainerTransport` transitively imports bleno (which fails to install on Windows or in browser-side bundlers).

Other common leaks:
- BLE peripheral name / UUIDs as constructor args (BlenoTransport needs them; FakeTransport doesn't, but the interface forces both).
- A `connect(deviceAddress: string)` signature where the address is meaningless for FakeTransport.
- Returning an `EventEmitter` typed as bleno's emitter type rather than Node's standard.

**Why it happens:**
Implementer designs the interface around the first concrete implementation (BlenoTransport, mentally) and bakes BLE assumptions in. The Fake then has to fake BLE concepts that don't exist in-process.

**How to avoid:**
- Define `ITrainerTransport` and the data payload type **before** writing either transport. Keep both transports off the dependency.
- Payload is a plain `DataView` (already mentioned in PROJECT.md) — no characteristic wrapper.
- `connect()` and `disconnect()` take no transport-specific args. Configuration lives in the transport's constructor.
- Test: write a single test that imports only `ITrainerTransport` and runs against both transports via dependency injection. If the test file has any bleno or noble import, the abstraction is leaking.

**Warning signs:**
- VeloWorld can't import `ITrainerTransport` without pulling bleno into its bundle.
- Mocking FakeTransport in a non-trainer-sim test file requires importing trainer-sim's BLE types.
- Adding a new transport (e.g., a WebSocket-based remote trainer) requires changing the interface.

**Phase to address:** Transport API / `ITrainerTransport` contract phase — write the interface in a separate `index.ts` with zero runtime imports; ensure type-only imports.

---

### Pitfall 14: bleno setup quirks and platform fragility (v2 concern)

**What goes wrong:**
Even though v1 doesn't ship BlenoTransport, the v2 architecture decisions made today affect whether bleno will work at all. Documented bleno gotchas (from the abandonware/bleno issue tracker):
- **macOS advertised name is hard-capped at ~8 characters** (issue: "Bleno wont advertise on mac if name has more than 8 character"). "TrainerSim" (10 chars) won't advertise; "TrSim" will.
- **macOS console flooding from NSLog** unless suppressed (issue: "macOS: Disable NSLog to avoid flooding console").
- **App crashes on `force quit` if subscribed to `stateChange`** without proper cleanup.
- **Linux requires `bluetoothd` disabled** (or running with `--experimental` and the right systemd config). Setup error: bluetoothd intercepts the HCI socket.
- **Linux requires `setcap cap_net_raw+eip $(which node)`** to run as non-root — without this, every restart needs `sudo`.
- **Linux 6.9+ kernels have known compatibility issues** (open issue #53). Pi 5 with stock kernel may not work.
- **No Bluetooth 5 support** — capped at BLE 4.x features. Extended advertising and 2M PHY are unavailable.
- **Single BLE adapter cannot be central + peripheral simultaneously** (already noted in PROJECT.md). Same-machine testing requires a second USB BT dongle or a Pi Zero W.
- **Default advertising interval is 100 ms** (configurable via env var) — fine, but not documented well.
- **Characteristic descriptor 0x2902 (CCCD) is auto-added by bleno**, and adding it manually causes a "duplicate descriptor" bug that breaks notifications in Web Bluetooth (issue #51).

**Why it happens:**
bleno is in maintenance mode under @abandonware. Issues stay open for years. Stack Overflow answers reference the original noble/bleno (deprecated). Newcomers hit issues that veterans have learned to route around.

**How to avoid:**
- Pin advertising name to ≤ 8 characters. "TrSim" or "FtmsSim".
- Document the Linux setcap step in the README's "Setup" section. Provide a `setup.sh` script.
- Test on macOS Sonoma + an Ubuntu LTS in CI before declaring v2 ready. **Do not** test only on Pi.
- **Do not let bleno auto-add the CCCD if you also add it manually** — pick one path.
- Plan for the second-adapter-or-second-machine constraint from day 1 of v2 design. A single-machine "all green CI" for BLE is impossible; it needs a hardware loop.
- Consider tracking the @stoprocent/bleno fork or webbluetooth as alternatives — bleno's neglect is a real risk.

**Warning signs:**
- Advertised name not visible in BLE scanner.
- "device disconnected" within 1 s of subscribe.
- App needs sudo every run.

**Phase to address:** v2 / BlenoTransport phase. v1 should not encode any decisions that prevent v2 from working (e.g., don't bake an advertising-name longer than 8 chars into config defaults).

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Encode IndoorBikeData with hard-coded flag bytes for the v1 fields (no flag→field table) | Ship encoder in 50 lines instead of 200 | Adding speed/HR/distance later means rewriting the encoder; the flag byte is stale; unit tests for added fields are bolted on | Acceptable for v1 since only power+cadence ship. Document "field-set frozen until refactor" in code. |
| Synchronous FIT parse (parseSync) instead of parseAsync | One less await; cleaner constructor | Big files block the consumer's test process for 200+ ms; poor UX; unsuitable for BlenoTransport which can't block during a connection event | Acceptable while typical FIT files < 1 MB. Convert when soak tests get slow. |
| Single shared "currentSample" mutable state in replay engine | Simple to read | Race condition risk if `disconnect` and `tick` interleave; testability suffers (can't replay deterministically) | Never — but for v1, acceptable if replay engine is single-`setTimeout`-handle so no concurrency. |
| Fake-only `sendResistance` returns a synchronously-resolved Promise | Tests run instantly | When BlenoTransport ships, tests that worked against Fake fail against Bleno because of timing | Never. Force a microtask boundary even in Fake. |
| Skip the "more data" bit-0 inversion on encode by always setting flag bit 0 = 0 (since we always emit speed) | Avoids the surprising inversion in the encoder | When speed is later made optional (e.g., FIT file has no speed records), the bit-0 logic is wrong and silently mis-encodes | Acceptable for v1 if speed is **always emitted** (which it isn't — VeloWorld v1 doesn't need speed). Better: implement the inversion correctly from day 1. |
| Bundle one FIT fixture in the repo "just for tests" | Easy unit tests | Repo bloat; license issues if the FIT was someone's real ride; PROJECT.md explicitly excludes this | Never per PROJECT.md. Use generated minimal FIT files. |
| Inline FTMS encoder in FakeTransport (no separate codec module) | One file, easy to grok | When BlenoTransport ships, you copy-paste encoder code; bug fixes diverge | Never — extract codec from day 1, even if only one transport uses it. |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| VeloWorld's `ITrainerTransport` | Re-define the interface in trainer-sim and hope it matches | Vendor or import the exact type definition. PROJECT.md says "byte-for-byte" — make that mechanical, not aspirational. Add a CI check: import VeloWorld's interface in a type-test and assert FakeTransport satisfies it. |
| FIT parser library (whichever wins research) | Trust the parsed output's units without reading the library's docs. fit-file-parser converts speed to km/h by default; @garmin/fitsdk-javascript leaves it as m/s | Pin parser config explicitly (`speedUnit: 'm/s'` or normalize at the boundary). Don't rely on defaults. |
| Zwift consuming FTMS | Assume Zwift will accept any spec-compliant payload | Test with Zwift's real client before shipping v2. Zwift specifically has been observed (community reports) to require: (1) the device advertise the FTMS service UUID 0x1826 in the advertising packet (not just the GATT table); (2) the Fitness Machine Feature characteristic (0x2ACC) reports power+cadence supported in its bitfield; (3) IndoorBikeData notifications start within ~3 s of subscription. Missing any of the three: Zwift shows "trainer not paired." |
| TrainerRoad consuming FTMS | Assume TR works the same as Zwift | TR is more permissive on rate (handles 1–4 Hz fine) but is stricter on the Fitness Machine Control Point (0x2AD9): if your simulator advertises FMCP support, TR will write Set Indoor Bike Simulation Parameters (opcode 0x11) and expect a Response Code (opcode 0x80) within 100 ms. Not responding leaves TR stuck "configuring trainer." For v2, either implement FMCP responses correctly or omit FMCP from the feature bitfield entirely. |
| VeloWorld's FTMS decoder | Decoder assumes power is uint16, encoder emits sint16 | Spec says sint16. Fix the decoder, not the encoder. Add a round-trip test that goes through both. |
| Garmin/Wahoo FIT exports | Assume all FIT files have continuous 1 Hz records | Real files have autopause gaps, smart-recording variable intervals, missing records (Pitfall 9). Always test with a real export, not a generated minimal file. |
| Node's `Buffer` vs `DataView` for codec | Mix both APIs in the same encoder; lose track of which is LE vs BE default | Pick one. `Buffer.writeInt16LE` is unambiguous; `DataView.setInt16(o, v, true)` requires the `true`. Lint-ban the unsafe form. |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Re-parsing the FIT file on every `connect()` | Each connect-disconnect cycle takes 200 ms+; tests that connect/disconnect in a tight loop are slow | Parse once in constructor (or first `connect`), cache normalized samples. Reset replay cursor on each `connect`. | Tests that exercise reconnect logic. Soak tests. |
| Per-tick allocation of a new Buffer for IndoorBikeData payload | GC pauses every few seconds; jank in long replays | Pre-allocate one Buffer per payload size (or use a small pool). Mutate-and-emit. | Multi-hour soak runs; very tight notification rates (4+ Hz). |
| Holding all FIT records in memory as raw decoded objects (full Garmin schema) | High RSS on multi-hour rides; OOM on resource-constrained CI | Normalize to `{ ts: number, power: number, cadence: number }` immediately and discard everything else. ~24 bytes per record × 3600/h is tiny; full decoded records can be 10x. | Long files (4+ hours) or Pi-class CI. |
| Logging on every tick (`console.log` per emission) | Real-time performance degrades to terminal-render-bound; replay drift appears | Gate logging behind a debug flag or sample (every Nth tick). | Anytime debug logging is left on by accident. |
| `setInterval` instead of self-rescheduling `setTimeout` for replay | Drift accumulates as in Pitfall 6 | Absolute-deadline scheduler (Pitfall 6 fix). | Long replays (any > 5 min). |
| FIT parser run in main thread while the consumer waits | First sample emits late even with absolute scheduling | Move large parses to `worker_threads`. | FIT files > 5 MB. |
| Subscribing to bleno's `stateChange` event without cleanup on shutdown | Process crash on force quit (documented bleno bug) | Remove all listeners in `disconnect()`. | v2 BlenoTransport. |

## Security Mistakes

(This is a developer test tool, not a network-facing product. Security surface is minimal but non-zero.)

| Mistake | Risk | Prevention |
|---------|------|------------|
| Loading arbitrary FIT files from user-supplied paths without validation | Malformed FIT could crash the parser; very unlikely to be exploitable but DoS-able | Validate file size (< 50 MB), validate FIT header CRC before parsing. Fail fast with a clear error. |
| Logging FIT file path or contents to stdout | If the FIT comes from a user's device, it contains location data (semicircles), heart rate, timestamps, and personal device serial numbers | Don't log FIT contents by default. Add a `--verbose` flag for debug logging. Document privacy in the README. |
| Bundling a fixture FIT file from a real ride | Same as above — leaks the contributor's GPS track and HR | PROJECT.md already excludes bundled fixtures. Generate minimal synthetic FITs for tests. |
| BlenoTransport advertising a guessable / collidable name | Multiple sims on the same network could confuse Zwift/TR | Make advertising name configurable; default to a random suffix (`TrSim-A1B2`). |
| Running bleno as root because setcap wasn't documented | Privilege escalation surface widens; segfault writes go to root logs | Document the setcap step prominently; add a runtime check that warns if running as root. |

## UX Pitfalls

(UX here = developer experience, since the product's users are developers.)

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| FakeTransport requires a FIT file path to construct, even for "smoke test" usage | Devs can't write the smallest possible test ("does it import?") without finding a FIT file | Allow constructor to accept either a path **or** a pre-parsed array of `{ts, power, cadence}` records. Generate a 60-second synthetic record array in tests. |
| Silent failure when FIT file has no `record` messages | `connect()` resolves but no samples ever emit; consumer waits forever | Validate during parse: throw if zero record messages. Log record count on parse. |
| `sendResistance(grade)` accepts any number, no validation | Devs send `grade=10` (10%? 0.1?) without realizing the unit; tests pass but real BlenoTransport sends garbage to FMCP | Document the unit (decimal grade, e.g., 0.05 = 5%). Validate range (-1 ≤ grade ≤ 1). |
| No "replay finished" event on stop-at-end mode | Devs can't write a test that waits for the replay to finish without polling | Emit a clearly-named event (`'end'` or `'replayComplete'`) when the FIT cursor reaches the last sample. Document in the interface. |
| Loop mode silently reuses the same wall-clock-anchored sample stream, so the second loop iteration is offset | Replay drift across loop boundary | On loop, reset `startWall = Date.now()` and `startFitTs = firstRecord.timestamp`. Document. |
| Errors thrown from inside `setTimeout` callbacks become unhandled exceptions | Process crashes mid-replay; consumer's `disconnect()` never fires | Wrap every tick callback body in try/catch and route errors to an `'error'` event on the transport. |
| TypeScript types not exported from the package root | Consumers do `import { ITrainerTransport } from 'trainer-sim/types/...'` (path-deep import) | Re-export the public API from `index.ts`. PROJECT.md implies VeloWorld imports the interface; make that ergonomic. |

## "Looks Done But Isn't" Checklist

- [ ] **FTMS encoder:** Often missing **bit-0 inversion** for "More Data" — verify with a third-party decoder reads speed correctly.
- [ ] **FTMS encoder:** Often missing **sint16 vs uint16** distinction for power/resistance/inclination — verify with PyFTMS or the Auuki decoder.
- [ ] **FTMS encoder:** Often missing **0.5 rpm cadence resolution** — verify cadence round-trips through a decoder.
- [ ] **FTMS encoder:** Often missing **little-endian explicit flag** on DataView writes — verify hex dump of a known payload.
- [ ] **FIT loader:** Often missing **gap normalization** — verify with a real Garmin file containing autopause.
- [ ] **FIT loader:** Often missing **null power handling** — verify with a file that has missing power records.
- [ ] **FIT loader:** Often missing **developer-field exclusion** — verify with a TrainerRoad-exported FIT file.
- [ ] **Replay engine:** Often missing **drift-free scheduling** — verify by replaying a 30-min FIT and asserting end time within 250 ms.
- [ ] **Replay engine:** Often missing **clean disconnect cancellation** — verify no further `onData` after `disconnect()` resolves.
- [ ] **Replay engine:** Often missing **loop-mode wall-clock reset** — verify drift doesn't accumulate across loops.
- [ ] **Transport API:** Often missing **async semantics on Fake** — verify Fake forces a microtask boundary.
- [ ] **Transport API:** Often missing **transport-agnostic types** — verify importing `ITrainerTransport` doesn't pull bleno transitively.
- [ ] **Transport API:** Often missing **`'end'` event** — verify a test can `await` replay completion.
- [ ] **Bleno (v2):** Often missing **≤8 char advertising name on macOS** — verify advertising appears in nRF Connect.
- [ ] **Bleno (v2):** Often missing **Linux setcap doc** — verify a fresh-clone setup runbook works for non-root.
- [ ] **Cross-app (v2):** Often missing **Fitness Machine Feature characteristic (0x2ACC)** — Zwift requires it; verify Zwift pairs.
- [ ] **Cross-app (v2):** Often missing **FMCP response codes** — TrainerRoad expects them; verify TR completes "configuring trainer."

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Encoder shipped with wrong field types (uint16 power, etc.) | LOW — pre-v1 | Fix the field-type table, re-run round-trip tests. Bug is contained to one module. |
| Encoder shipped with wrong field types (post-v1, VeloWorld depends on it) | MEDIUM | Coordinate a synchronized fix in trainer-sim and VeloWorld's decoder; bump major version of trainer-sim; document in changelog. |
| Replay engine drifts (Pitfall 6 not fixed before VeloWorld integration) | LOW | Swap in absolute-deadline scheduler; consumer code unchanged. Drift was silent — no consumer rewrite needed. |
| FIT gap policy ships as "preserveSilence" but VeloWorld needs "holdLast" | LOW | Add config option; default unchanged or change default in next minor. |
| BLE-specific types leaked into ITrainerTransport, VeloWorld now imports bleno transitively | HIGH | Refactor interface; force consumers to update imports; major version bump. Costly because the leak propagates through all consumers. **Avoid by getting the contract right in the v1 transport API phase.** |
| sendResistance shipped synchronous, BlenoTransport needs async | MEDIUM | Change interface to async; consumers add `await`. Ripples through every test. |
| FIT parser pulls in developer fields, power values 10x off | LOW | Switch to standard-fields-only parsing; re-run consumer tests. |
| bleno advertising name > 8 chars, Macs don't see the trainer | LOW | Truncate name; ship config option. |
| Single-adapter same-machine BLE testing assumed to work | MEDIUM | Buy a second USB Bluetooth dongle or repurpose a Pi Zero W. Document the constraint. **Acknowledged in PROJECT.md.** |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| 1: "More Data" bit-0 inversion | FTMS encoder | Third-party decoder reads speed correctly |
| 2: sint16 vs uint16 power/resistance | FTMS encoder | PyFTMS round-trip; sign-edge unit test |
| 3: Cadence 0.5 rpm resolution | FTMS encoder | Round-trip 90.5 rpm; nRF Connect shows 0.5 increments |
| 4: Little-endian byte order | Foundation / codec | Hex-dump assertion in unit tests |
| 5: Notification rate (1 Hz default) | Replay engine | Configurable rate; v2 default = 1 Hz |
| 6: setTimeout drift | Replay engine | 30-min replay ends within 250 ms of FIT duration |
| 7: Event-loop blocking on FIT parse | FIT loader | < 100 ms parse benchmark for 1-hour file |
| 8: AbortController / disconnect cleanup | Replay engine + Transport API | "no emissions after disconnect" test |
| 9: FIT gaps and missing records | FIT loader + Replay engine | Test fixture with real autopause gap |
| 10: FIT epoch (1989) | FIT loader | Conversion helper unit-tested |
| 11: Developer-defined FIT fields | FIT loader (parser research) | Test with TrainerRoad-exported FIT |
| 12: sendResistance async semantics | Transport API contract | `await` works identically across both transports |
| 13: BLE types leaking into ITrainerTransport | Transport API contract | Type-only import test; bleno not in `ITrainerTransport` import graph |
| 14: bleno setup quirks | v2 BlenoTransport | macOS+Linux smoke tests; setcap documented |

## Sources

- **FTMS encoding (HIGH confidence):**
  - dvmarinoff/Auuki, `src/ble/ftms/indoor-bike-data.js` (JavaScript reference encoder/decoder, MIT) — https://github.com/dvmarinoff/Auuki/blob/master/src/ble/ftms/indoor-bike-data.js
  - dudanov/python-pyftms, `src/pyftms/models/realtime_data/indoor_bike.py` (Python reference, Apache-2.0) — https://github.com/dudanov/python-pyftms — confirms sint16 power, half-rpm cadence, 0.01 km/h speed
  - Bluetooth SIG Fitness Machine Service v1.0.1 (https://www.bluetooth.com/specifications/specs/fitness-machine-service-1-0/) — authoritative spec, downloadable PDF
- **FIT format (HIGH confidence):**
  - muktihari/fit (Go FIT SDK reference) via Context7 — confirms FIT epoch is 1989-12-31 UTC, developer-field schema, `local_timestamp` semantics, common gap patterns
  - Garmin Developer FIT SDK forum (https://forums.garmin.com/developer/fit-sdk/) — community discussion of corrupted FIT from interrupted recordings, developer-data decoding across platforms
- **Node.js timer / event loop (HIGH confidence):**
  - Official Node.js docs on event loop and timers (https://nodejs.org/en/learn/asynchronous-work/event-loop-timers-and-nexttick) — quoted: "A timer specifies the **threshold** _after which_ a provided callback _may be executed_ rather than the **exact** time."
  - Official Node.js Timers API (https://nodejs.org/api/timers.html) — AbortController integration with `node:timers/promises`
- **bleno (HIGH confidence on documented issues; MEDIUM on workarounds):**
  - abandonware/bleno README and open issues (https://github.com/abandonware/bleno/issues) — verified macOS 8-char name limit (issue), NSLog flooding, 0x2902 duplicate descriptor, Linux 6.9 break, force-quit crash, no BLE 5
- **Cross-app (MEDIUM confidence — community-reported, not first-party documented):**
  - Zwift forums and Reddit r/Zwift threads (general behavior re: disconnect timeout, FMCP requirements) — referenced indirectly via gymnasticon and Auuki bug tracker discussions
  - ptx2/gymnasticon README and PRs — bridges to Zwift/TR/Rouvy via cycling power profile, not FTMS, so its lessons translate but aren't FTMS-specific

---
*Pitfalls research for: Node.js BLE FTMS smart trainer simulator (trainer-sim)*
*Researched: 2026-05-13*
