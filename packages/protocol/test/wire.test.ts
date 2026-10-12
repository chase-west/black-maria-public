import { describe, expect, it } from "vitest";
import {
  EVENT_KIND,
  MAX_DATAGRAM,
  PT,
  Reassembler,
  applyFields,
  decode,
  decodeBlob,
  deltaFields,
  encode,
  encodeBlob,
  fitStateFields,
  fragment,
  keyframeFields,
  snapshotsEqual,
  type Datagram,
  type MatchBlob,
  type ErrandRecord,
  type Packet,
  type WireEvent,
  type WireItem,
  type WireSnapshot,
} from "../src/wire/index.js";

/** Seeded generator for property tests (mulberry32). */
function rng(seed: number) {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (n: number) => Math.floor(next() * n);
  return {
    int,
    u8: () => int(256),
    u16: () => int(65536),
    u32: () => int(4294967296) >>> 0,
    pick: <T>(xs: readonly T[]) => xs[int(xs.length)]!,
    bytes: (n: number) => Uint8Array.from({ length: n }, () => int(256)),
  };
}
type R = ReturnType<typeof rng>;

const errand = (r: R): ErrandRecord => ({ id: r.u16(), type: r.int(3), itemKind: r.pick([0xff, r.int(10)]), fixture: r.u16(), room: r.u8(), carryTicks: r.u8(), value: r.u8(), posted: r.u16(), expires: r.u16(), state: r.int(4) });
const intent = (r: R) => ({ kind: r.u8(), dir: r.u8(), item: r.u16() });
const item = (r: R): WireItem => ({ id: r.u16(), kind: r.u8(), x: r.u8(), y: r.u8() });
const list = <T>(r: R, max: number, f: () => T): T[] => Array.from({ length: r.int(max + 1) }, f);

function event(r: R): WireEvent {
  const kind = r.pick(Object.keys(EVENT_KIND) as WireEvent["kind"][]);
  switch (kind) {
    case "posted":
      return { kind, errand: errand(r) };
    case "completed":
      return { kind, id: r.u16(), by: r.int(2) };
    case "expired":
      return { kind, id: r.u16() };
    case "took":
    case "dropped":
    case "snatched":
      return { kind, by: r.int(2), item: r.u16() };
    case "delivered":
      return { kind, by: r.int(2), item: r.u16(), fixture: r.u16() };
    case "door_opened":
      return { kind, x: r.u8(), y: r.u8() };
    case "safe_opened":
      return { kind, fixture: r.u16(), item: r.u16() };
    case "sigil":
      return { kind, owner: r.int(2), energy: r.u8() };
    case "moved":
      return { kind, by: r.int(2), dir: r.int(4) };
    case "winding_up":
      return { kind, by: r.int(2) };
    case "returned":
      return { kind, item: r.u16(), itemKind: r.int(10), x: r.u8(), y: r.u8() };
  }
}

function packet(r: R, type: keyof typeof PT): Packet {
  switch (type) {
    case "HELLO":
      return { type, token: r.bytes(16), mode: r.int(2), tier: r.int(3), chaos: r.int(4) };
    case "INTENT":
      return { type, match: r.u16(), tick: r.u16(), intent: intent(r) };
    case "RESYNC":
    case "LEAVE":
      return { type, match: r.u16() };
    case "PING":
      return { type, clientMs: r.u32() };
    case "ACK_FRAG":
      return { type, match: r.u16(), frag: r.u8() };
    case "HELLO_ACK":
      return { type, session: r.u16(), attemptsLeft: r.u8(), clockS: r.u32(), ruleChange: r.int(4) };
    case "MATCH_START": {
      const fragCount = 1 + r.int(16);
      return { type, match: r.u16(), frag: r.int(fragCount), fragCount, data: r.bytes(1 + r.int(1000)) };
    }
    case "STATE": {
      const p: Packet = { type, match: r.u16(), tick: r.u16(), base: r.pick([0xffff, r.u16()]), deadlineMs: r.u16() };
      if (r.int(2)) p.you = { x: r.u8(), y: r.u8(), energy: r.int(101) };
      if (r.int(2)) p.maria = { x: r.u8(), y: r.u8() };
      if (r.int(2)) p.inventories = { you: list(r, 4, r.u16), maria: list(r, 4, r.u16) };
      if (r.int(2)) p.items = list(r, 12, () => item(r));
      if (r.int(2)) p.board = list(r, 30, () => errand(r));
      if (r.int(2)) p.doors = list(r, 3, () => ({ x: r.u8(), y: r.u8() }));
      if (r.int(2)) p.safesAndSigils = { safes: list(r, 2, r.u16), sigils: [r.u8(), r.u8()] };
      if (r.int(2)) p.events = list(r, 14, () => event(r));
      return p;
    }
    case "MATCH_END":
      return { type, match: r.u16(), result: r.int(3), scoreYou: r.u8(), scoreMaria: r.u8() };
    case "PONG":
      return { type, clientMs: r.u32(), serverMs: r.u32() };
    case "ERROR": {
      const len = r.int(120);
      return { type, code: 1 + r.int(7), msg: String.fromCharCode(...Array.from({ length: len }, () => 0x20 + r.int(95))) };
    }
  }
}

const datagram = (r: R, type: keyof typeof PT): Datagram => ({ session: r.u16(), seq: r.u32(), ack: r.u32(), packet: packet(r, type) });

function randomBlob(r: R): MatchBlob {
  const w = 1 + r.int(24);
  const h = 1 + r.int(24);
  const names = Array.from({ length: 1 + r.int(10) }, (_, i) => `room${i}`);
  const expiryMin = r.u8();
  return {
    tier: r.int(3),
    seedHint: r.u32(),
    w,
    h,
    tiles: Uint8Array.from({ length: w * h }, () => r.int(5)),
    rooms: Uint8Array.from({ length: w * h }, () => (r.int(4) === 0 ? 0xff : r.int(names.length))),
    roomNames: names,
    sigilOwner: [r.int(2), r.int(2)],
    params: { maxTick: r.u16(), tickMs: r.u16(), postInterval: 1 + r.int(255), expiryMin, expiryMax: expiryMin + r.int(256 - expiryMin), snatchCost: r.u8(), regen: r.u8(), energyStart: r.int(101), inventorySlots: 1 + r.int(255), returnTicks: 1 + r.int(255), chaos: r.int(4) },
    mariaStart: { x: r.int(w), y: r.int(h) },
    board: list(r, 6, () => ({ ...errand(r), room: r.pick([0xff, r.int(names.length)]) })),
    fixtures: list(r, 16, () => ({ id: r.u16(), kind: r.int(11), x: r.int(w), y: r.int(h), flags: r.int(2) })),
    items: list(r, 12, () => ({ id: r.u16(), kind: r.int(10), x: r.int(w), y: r.int(h), flags: r.int(2) })),
    start: { x: r.int(w), y: r.int(h) },
    decor: list(r, 24, () => ({ kind: r.int(12), x: r.int(w), y: r.int(h) })),
  };
}

describe("wire codec (SPEC 5.2 to 5.4)", () => {
  for (const type of Object.keys(PT) as (keyof typeof PT)[]) {
    it(`${type}: 10,000 random instances round-trip exactly`, () => {
      const r = rng(PT[type] * 7919);
      for (let i = 0; i < 10_000; i++) {
        const d = datagram(r, type);
        const bytes = encode(d);
        expect(bytes.length).toBeLessThanOrEqual(MAX_DATAGRAM);
        expect(bytes[0]).toBe(0xb1);
        expect(bytes[1]).toBe(PT[type]);
        const back = decode(bytes);
        expect(back).toEqual(d);
        expect(encode(back!)).toEqual(bytes);
      }
    });
  }

  it("every truncation and every one-byte extension of a valid datagram is dropped", () => {
    const r = rng(99);
    for (const type of Object.keys(PT) as (keyof typeof PT)[]) {
      for (let i = 0; i < 40; i++) {
        const bytes = encode(datagram(r, type));
        // A MATCH_START slice runs to the end of the datagram, so a shorter or longer slice is still a valid fragment.
        const minLen = type === "MATCH_START" ? 12 + 5 : bytes.length;
        for (let n = 0; n < minLen; n++) expect(decode(bytes.slice(0, n)), `${type} cut at ${n}`).toBeNull();
        const longer = new Uint8Array(bytes.length + 1);
        longer.set(bytes);
        if (type !== "MATCH_START" && longer.length <= MAX_DATAGRAM) expect(decode(longer), `${type} plus one byte`).toBeNull();
      }
    }
  });

  it("bad magic, unknown types, and oversize datagrams are dropped; random bytes never throw", () => {
    const r = rng(5);
    const good = encode({ session: 1, seq: 1, ack: 0, packet: { type: "PING", clientMs: 7 } });
    const badMagic = good.slice();
    badMagic[0] = 0xb2;
    expect(decode(badMagic)).toBeNull();
    for (let t = 0; t < 256; t++) {
      if (Object.values(PT).includes(t as never)) continue;
      const x = good.slice();
      x[1] = t;
      expect(decode(x)).toBeNull();
    }
    expect(decode(new Uint8Array(1201).fill(0xb1))).toBeNull();
    for (let i = 0; i < 50_000; i++) {
      const b = r.bytes(r.int(64));
      if (b.length > 0 && r.int(2)) b[0] = 0xb1;
      if (b.length > 1 && r.int(2)) b[1] = r.pick(Object.values(PT));
      expect(() => decode(b)).not.toThrow();
    }
  });

  it("HELLO with an out-of-range mode, tier or chaos is dropped", () => {
    const base = encode({ session: 0, seq: 1, ack: 0, packet: { type: "HELLO", token: new Uint8Array(16), mode: 0, tier: 0, chaos: 0 } });
    for (const [off, v] of [
      [28, 2],
      [29, 3],
      [30, 4],
    ] as const) {
      const b = base.slice();
      b[off] = v;
      expect(decode(b)).toBeNull();
    }
  });

  it("encode refuses a datagram over 1200 bytes", () => {
    const events: WireEvent[] = Array.from({ length: 220 }, () => ({ kind: "delivered", by: 0, item: 1, fixture: 2 }));
    expect(() => encode({ session: 1, seq: 1, ack: 0, packet: { type: "STATE", match: 1, tick: 0, base: 0xffff, deadlineMs: 250, events } })).toThrow(/1200/);
  });
});

describe("match blob, fragments, reassembly (SPEC 5.4)", () => {
  it("10,000 random blobs round-trip exactly", () => {
    const r = rng(1234);
    for (let i = 0; i < 10_000; i++) {
      const b = randomBlob(r);
      const bytes = encodeBlob(b);
      expect(decodeBlob(bytes)).toEqual(b);
    }
  });

  it("a truncated or extended blob is rejected", () => {
    const r = rng(77);
    for (let i = 0; i < 50; i++) {
      const bytes = encodeBlob(randomBlob(r));
      for (let n = 0; n < bytes.length; n += 7) expect(decodeBlob(bytes.slice(0, n))).toBeNull();
      expect(decodeBlob(new Uint8Array([...bytes, 0]))).toBeNull();
    }
  });

  it("fragments reassemble in any order with duplicates", () => {
    const r = rng(4321);
    for (let i = 0; i < 2000; i++) {
      const blob = r.bytes(1 + r.int(5000));
      const frags = fragment(blob);
      expect(frags.every((f) => f.length <= 1000)).toBe(true);
      const order = frags.flatMap((_, k) => (r.int(3) === 0 ? [k, k] : [k]));
      for (let k = order.length - 1; k > 0; k--) {
        const j = r.int(k + 1);
        [order[k], order[j]] = [order[j]!, order[k]!];
      }
      const re = new Reassembler();
      let out: Uint8Array | null = null;
      for (const k of order) out = re.add(k, frags.length, frags[k]!) ?? out;
      expect(out).toEqual(blob);
      expect(re.missing()).toEqual([]);
    }
  });

  it("the reassembler ignores fragments with a disagreeing count or index", () => {
    const re = new Reassembler();
    expect(re.add(0, 2, new Uint8Array([1]))).toBeNull();
    expect(re.add(1, 3, new Uint8Array([2]))).toBeNull();
    expect(re.add(5, 2, new Uint8Array([2]))).toBeNull();
    expect(re.missing()).toEqual([1]);
    expect(re.add(1, 2, new Uint8Array([2]))).toEqual(new Uint8Array([1, 2]));
  });
});

describe("deltas (SPEC 5.5)", () => {
  const snap = (r: R): WireSnapshot => {
    const ids = [...new Set(list(r, 10, () => 1 + r.int(12)))];
    const errands = Array.from({ length: r.int(40) }, (_, id) => ({ ...errand(r), id }));
    return {
      you: { x: r.int(24), y: r.int(24), energy: r.int(101) },
      maria: { x: r.int(24), y: r.int(24) },
      invYou: list(r, 4, () => 1 + r.int(12)),
      invMaria: list(r, 4, () => 1 + r.int(12)),
      items: ids.map((id) => ({ id, kind: r.int(10), x: r.int(24), y: r.int(24) })),
      board: errands,
      doors: r.int(2) ? [{ x: 3, y: 4 }] : [],
      safes: r.int(2) ? [7] : [],
      sigils: [r.int(61), r.int(61)],
    };
  };
  it("applying delta(base, cur) to base gives cur, for 10,000 random pairs, through bytes", () => {
    const r = rng(2468);
    for (let i = 0; i < 10_000; i++) {
      const base = snap(r);
      const cur = snap(r);
      // The board only grows and errands only change state; doors and safes only open.
      cur.board = [...base.board.map((e) => (r.int(4) === 0 ? { ...e, state: r.int(4) } : e)), ...cur.board.slice(0, r.int(3)).map((e, k) => ({ ...e, id: base.board.length + k }))];
      if (base.doors.length) cur.doors = [...base.doors, ...cur.doors.filter((d) => d.x !== 3 || d.y !== 4)];
      if (base.safes.length && !cur.safes.includes(7)) cur.safes = [7];
      const fields = deltaFields(base, cur, []);
      const bytes = encode({ session: 1, seq: 2, ack: 3, packet: { type: "STATE", match: 1, tick: 5, base: 2, deadlineMs: 250, ...fields } });
      const p = decode(bytes)!.packet;
      if (p.type !== "STATE") throw new Error("not a STATE");
      expect(snapshotsEqual(applyFields(base, p, false), cur)).toBe(true);
      const kf = keyframeFields(cur, []);
      expect(snapshotsEqual(applyFields(snap(r), kf, true), cur)).toBe(true);
    }
  });
});

describe("a STATE always fits in one datagram (SPEC 5.2)", () => {
  it("fitStateFields leaves out only closed errands, expired first, oldest first, and a keyframe merge keeps them", () => {
    const r = rng(31337);
    const tick = 390;
    // 78 errands, a crowded board (change 1 posts about 96 a match); the last 12 are still live.
    const board: ErrandRecord[] = Array.from({ length: 78 }, (_, id) => ({ ...errand(r), id, type: 0, itemKind: 1, posted: id * 5, expires: id < 66 ? 380 : 450, state: id < 66 ? (id % 3 === 0 ? 3 : 1 + (id % 2)) : 0 }));
    const fields = keyframeFields(
      { you: { x: 1, y: 1, energy: 50 }, maria: { x: 2, y: 2 }, invYou: [1, 2, 3, 4], invMaria: [5, 6, 7, 8], items: Array.from({ length: 12 }, (_, i) => ({ id: 9 + i, kind: 1, x: 3, y: 3 })), board, doors: [{ x: 4, y: 4 }], safes: [3], sigils: [0, 12] },
      [{ kind: "completed", id: 70, by: 0 }],
    );
    expect(() => encode({ session: 1, seq: 1, ack: 0, packet: { type: "STATE", match: 1, tick, base: 0xffff, deadlineMs: 250, ...fields } })).toThrow(/1200/);
    const fit = fitStateFields(fields, tick);
    const bytes = encode({ session: 1, seq: 1, ack: 0, packet: { type: "STATE", match: 1, tick, base: 0xffff, deadlineMs: 250, ...fit } });
    expect(bytes.length).toBeLessThanOrEqual(MAX_DATAGRAM);
    const kept = new Set(fit.board.map((e) => e.id));
    for (let id = 66; id < 78; id++) expect(kept.has(id)).toBe(true);
    const dropped = board.filter((e) => !kept.has(e.id));
    expect(dropped.length).toBeGreaterThan(0);
    // Every expired errand goes before any done one.
    if (dropped.some((e) => e.state !== 3)) expect(board.filter((e) => e.state === 3).every((e) => !kept.has(e.id))).toBe(true);
    // A client that already knew the board keeps the left-out records when it applies the keyframe.
    const known: WireSnapshot = { you: { x: 0, y: 0, energy: 0 }, maria: { x: 0, y: 0 }, invYou: [], invMaria: [], items: [], board, doors: [], safes: [], sigils: [0, 0] };
    const p = decode(bytes)!.packet;
    if (p.type !== "STATE") throw new Error("not a STATE");
    expect(applyFields(known, p, true).board).toEqual(board);
    // Small boards are untouched.
    const small = { ...fields, board: board.slice(60) };
    expect(fitStateFields(small, tick)).toBe(small);
  });
});
