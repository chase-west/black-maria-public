import { Reader, Truncated, Writer } from "./buf.js";
import {
  EVENT_KIND,
  HEADER_BYTES,
  MAGIC,
  MASK,
  MAX_DATAGRAM,
  MAX_FRAGMENT,
  MAX_FRAGMENTS,
  MAX_INVENTORY,
  NONE8,
  PT,
  type Datagram,
  type ErrandRecord,
  type Packet,
  type StateFields,
  type WireEvent,
  type WireIntent,
} from "./types.js";

/** Thrown for a structurally invalid datagram. Decoders return null instead of throwing. */
class Invalid extends Error {}
const check = (ok: boolean): void => {
  if (!ok) throw new Invalid("invalid");
};

// ---------------------------------------------------------------------------
// Shared records

/** Errand record, 14 bytes: id u16, type u8, item_kind u8, fixture u16, room u8, carry_ticks u8, value u8, posted u16, expires u16, state u8. */
export function writeErrand(w: Writer, e: ErrandRecord): void {
  w.u16(e.id).u8(e.type).u8(e.itemKind).u16(e.fixture).u8(e.room).u8(e.carryTicks).u8(e.value).u16(e.posted).u16(e.expires).u8(e.state);
}
export function readErrand(r: Reader): ErrandRecord {
  const e = { id: r.u16(), type: r.u8(), itemKind: r.u8(), fixture: r.u16(), room: r.u8(), carryTicks: r.u8(), value: r.u8(), posted: r.u16(), expires: r.u16(), state: r.u8() };
  check(e.type <= 2 && e.state <= 3 && (e.itemKind <= 9 || e.itemKind === NONE8));
  return e;
}

function writeIntent(w: Writer, i: WireIntent): void {
  w.u8(i.kind).u8(i.dir).u16(i.item);
}
function readIntent(r: Reader): WireIntent {
  return { kind: r.u8(), dir: r.u8(), item: r.u16() };
}

export function writeEvent(w: Writer, e: WireEvent): void {
  w.u8(EVENT_KIND[e.kind]);
  switch (e.kind) {
    case "posted":
      return writeErrand(w, e.errand);
    case "completed":
      return void w.u16(e.id).u8(e.by);
    case "expired":
      return void w.u16(e.id);
    case "took":
    case "dropped":
    case "snatched":
      return void w.u8(e.by).u16(e.item);
    case "delivered":
      return void w.u8(e.by).u16(e.item).u16(e.fixture);
    case "door_opened":
      return void w.u8(e.x).u8(e.y);
    case "safe_opened":
      return void w.u16(e.fixture).u16(e.item);
    case "sigil":
      return void w.u8(e.owner).u8(e.energy);
    case "moved":
      return void w.u8(e.by).u8(e.dir);
    case "winding_up":
      return void w.u8(e.by);
    case "returned":
      return void w.u16(e.item).u8(e.itemKind).u8(e.x).u8(e.y);
  }
}

const who = (r: Reader): number => {
  const v = r.u8();
  check(v <= 1);
  return v;
};

export function readEvent(r: Reader): WireEvent {
  const k = r.u8();
  switch (k) {
    case 0:
      return { kind: "posted", errand: readErrand(r) };
    case 1: {
      const id = r.u16();
      return { kind: "completed", id, by: who(r) };
    }
    case 2:
      return { kind: "expired", id: r.u16() };
    case 3:
    case 4:
    case 6: {
      const by = who(r);
      const item = r.u16();
      return { kind: k === 3 ? "took" : k === 4 ? "dropped" : "snatched", by, item };
    }
    case 5: {
      const by = who(r);
      return { kind: "delivered", by, item: r.u16(), fixture: r.u16() };
    }
    case 7:
      return { kind: "door_opened", x: r.u8(), y: r.u8() };
    case 8:
      return { kind: "safe_opened", fixture: r.u16(), item: r.u16() };
    case 9: {
      const owner = who(r);
      return { kind: "sigil", owner, energy: r.u8() };
    }
    case 10: {
      const by = who(r);
      const dir = r.u8();
      check(dir <= 3);
      return { kind: "moved", by, dir };
    }
    case 11:
      return { kind: "winding_up", by: who(r) };
    case 12: {
      const item = r.u16();
      const itemKind = r.u8();
      check(itemKind <= 9);
      return { kind: "returned", item, itemKind, x: r.u8(), y: r.u8() };
    }
    default:
      throw new Invalid("unknown event kind");
  }
}

// ---------------------------------------------------------------------------
// STATE fields

export function maskOf(f: StateFields): number {
  return (
    (f.you ? MASK.you : 0) |
    (f.maria ? MASK.maria : 0) |
    (f.inventories ? MASK.inventories : 0) |
    (f.items ? MASK.items : 0) |
    (f.board ? MASK.board : 0) |
    (f.doors ? MASK.doors : 0) |
    (f.safesAndSigils ? MASK.safesAndSigils : 0) |
    (f.events ? MASK.events : 0)
  );
}

function writeStateFields(w: Writer, f: StateFields): void {
  w.u8(maskOf(f));
  if (f.you) w.u8(f.you.x).u8(f.you.y).u8(f.you.energy);
  if (f.maria) w.u8(f.maria.x).u8(f.maria.y);
  if (f.inventories) {
    for (const inv of [f.inventories.you, f.inventories.maria]) {
      check(inv.length <= MAX_INVENTORY);
      w.u8(inv.length);
      for (const i of inv) w.u16(i);
    }
  }
  if (f.items) {
    w.u8(f.items.length);
    for (const i of f.items) w.u16(i.id).u8(i.kind).u8(i.x).u8(i.y);
  }
  if (f.board) {
    w.u8(f.board.length);
    for (const e of f.board) writeErrand(w, e);
  }
  if (f.doors) {
    w.u8(f.doors.length);
    for (const d of f.doors) w.u8(d.x).u8(d.y);
  }
  if (f.safesAndSigils) {
    w.u8(f.safesAndSigils.safes.length);
    for (const s of f.safesAndSigils.safes) w.u16(s);
    w.u8(f.safesAndSigils.sigils[0]).u8(f.safesAndSigils.sigils[1]);
  }
  if (f.events) {
    w.u8(f.events.length);
    for (const e of f.events) writeEvent(w, e);
  }
}

function readStateFields(r: Reader): StateFields {
  const mask = r.u8();
  const f: StateFields = {};
  if (mask & MASK.you) {
    const you = { x: r.u8(), y: r.u8(), energy: r.u8() };
    check(you.energy <= 100);
    f.you = you;
  }
  if (mask & MASK.maria) f.maria = { x: r.u8(), y: r.u8() };
  if (mask & MASK.inventories) {
    const lists: number[][] = [];
    for (let k = 0; k < 2; k++) {
      const n = r.u8();
      check(n <= MAX_INVENTORY);
      const inv: number[] = [];
      for (let i = 0; i < n; i++) inv.push(r.u16());
      lists.push(inv);
    }
    f.inventories = { you: lists[0]!, maria: lists[1]! };
  }
  if (mask & MASK.items) {
    const n = r.u8();
    f.items = [];
    for (let i = 0; i < n; i++) f.items.push({ id: r.u16(), kind: r.u8(), x: r.u8(), y: r.u8() });
  }
  if (mask & MASK.board) {
    const n = r.u8();
    f.board = [];
    for (let i = 0; i < n; i++) f.board.push(readErrand(r));
  }
  if (mask & MASK.doors) {
    const n = r.u8();
    f.doors = [];
    for (let i = 0; i < n; i++) f.doors.push({ x: r.u8(), y: r.u8() });
  }
  if (mask & MASK.safesAndSigils) {
    const n = r.u8();
    const safes: number[] = [];
    for (let i = 0; i < n; i++) safes.push(r.u16());
    f.safesAndSigils = { safes, sigils: [r.u8(), r.u8()] };
  }
  if (mask & MASK.events) {
    const n = r.u8();
    f.events = [];
    for (let i = 0; i < n; i++) f.events.push(readEvent(r));
  }
  return f;
}

/** Bytes a STATE datagram with these fields takes: header, fixed fields, mask, fields. */
export function stateDatagramSize(f: StateFields): number {
  const w = new Writer(1024);
  writeStateFields(w, f);
  return HEADER_BYTES + 8 + w.length;
}

/**
 * Make a STATE fit in one datagram (SPEC 5.2, 1200 bytes). Only the board can grow without bound (with errands posted
 * every 3 ticks a match posts 126), so when the fields are too big, board records are left out, in this order:
 * errands whose `expires` is at or before `tick` (which a client can tell are closed from the tick alone), expired
 * ones before done ones, oldest first. An errand that can still be completed is never left out.
 */
export function fitStateFields<F extends StateFields>(f: F, tick: number): F {
  if (!f.board || stateDatagramSize(f) <= MAX_DATAGRAM) return f;
  const closed = f.board.filter((e) => e.expires <= tick);
  const order = [...closed.filter((e) => e.state === 3), ...closed.filter((e) => e.state !== 3)];
  const drop = new Set<number>();
  const out = { ...f, board: f.board.slice() };
  for (const e of order) {
    drop.add(e.id);
    out.board = f.board.filter((x) => !drop.has(x.id));
    if (stateDatagramSize(out) <= MAX_DATAGRAM) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Datagrams

function writePacket(w: Writer, p: Packet): void {
  switch (p.type) {
    case "HELLO":
      check(p.token.length === 16);
      return void w.bytes(p.token).u8(p.mode).u8(p.tier).u8(p.chaos);
    case "INTENT":
      w.u16(p.match).u16(p.tick);
      return writeIntent(w, p.intent);
    case "RESYNC":
    case "LEAVE":
      return void w.u16(p.match);
    case "PING":
      return void w.u32(p.clientMs);
    case "ACK_FRAG":
      return void w.u16(p.match).u8(p.frag);
    case "HELLO_ACK":
      return void w.u16(p.session).u8(p.attemptsLeft).u32(p.clockS).u8(p.ruleChange);
    case "MATCH_START":
      check(p.data.length >= 1 && p.data.length <= MAX_FRAGMENT && p.fragCount >= 1 && p.fragCount <= MAX_FRAGMENTS && p.frag < p.fragCount);
      return void w.u16(p.match).u8(p.frag).u8(p.fragCount).bytes(p.data);
    case "STATE":
      w.u16(p.match).u16(p.tick).u16(p.base).u16(p.deadlineMs);
      return writeStateFields(w, p);
    case "MATCH_END":
      return void w.u16(p.match).u8(p.result).u8(p.scoreYou).u8(p.scoreMaria);
    case "PONG":
      return void w.u32(p.clientMs).u32(p.serverMs);
    case "ERROR": {
      const msg = asciiBytes(p.msg);
      check(msg.length <= 255);
      return void w.u8(p.code).u8(msg.length).bytes(msg);
    }
  }
}

function readPacket(type: number, r: Reader): Packet {
  switch (type) {
    case PT.HELLO: {
      const token = r.bytes(16);
      const mode = r.u8();
      const tier = r.u8();
      const chaos = r.u8();
      check(mode <= 1 && tier <= 2 && chaos <= 3);
      return { type: "HELLO", token, mode, tier, chaos };
    }
    case PT.INTENT:
      return { type: "INTENT", match: r.u16(), tick: r.u16(), intent: readIntent(r) };
    case PT.RESYNC:
      return { type: "RESYNC", match: r.u16() };
    case PT.PING:
      return { type: "PING", clientMs: r.u32() };
    case PT.ACK_FRAG:
      return { type: "ACK_FRAG", match: r.u16(), frag: r.u8() };
    case PT.LEAVE:
      return { type: "LEAVE", match: r.u16() };
    case PT.HELLO_ACK: {
      const p = { type: "HELLO_ACK" as const, session: r.u16(), attemptsLeft: r.u8(), clockS: r.u32(), ruleChange: r.u8() };
      check(p.ruleChange <= 3);
      return p;
    }
    case PT.MATCH_START: {
      const match = r.u16();
      const frag = r.u8();
      const fragCount = r.u8();
      check(fragCount >= 1 && fragCount <= MAX_FRAGMENTS && frag < fragCount && r.remaining >= 1 && r.remaining <= MAX_FRAGMENT);
      return { type: "MATCH_START", match, frag, fragCount, data: r.bytes(r.remaining) };
    }
    case PT.STATE: {
      const head = { match: r.u16(), tick: r.u16(), base: r.u16(), deadlineMs: r.u16() };
      return { type: "STATE", ...head, ...readStateFields(r) };
    }
    case PT.MATCH_END: {
      const head = { match: r.u16(), result: r.u8(), scoreYou: r.u8(), scoreMaria: r.u8() };
      check(head.result <= 2);
      return { type: "MATCH_END", ...head };
    }
    case PT.PONG:
      return { type: "PONG", clientMs: r.u32(), serverMs: r.u32() };
    case PT.ERROR: {
      const code = r.u8();
      const len = r.u8();
      const bytes = r.bytes(len);
      check(code >= 1 && code <= 7 && bytes.every((b) => b >= 0x20 && b < 0x7f));
      return { type: "ERROR", code, msg: String.fromCharCode(...bytes) };
    }
    default:
      throw new Invalid("unknown type");
  }
}

function asciiBytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out[i] = c >= 0x20 && c < 0x7f ? c : 0x3f;
  }
  return out;
}

/** Encode a datagram: 12-byte header, then the payload. Throws if a field is out of range or the result exceeds 1200 bytes. */
export function encode(d: Datagram): Uint8Array {
  const w = new Writer(64);
  w.u8(MAGIC).u8(PT[d.packet.type]).u16(d.session).u32(d.seq).u32(d.ack);
  writePacket(w, d.packet);
  if (w.length > MAX_DATAGRAM) throw new RangeError(`datagram is ${w.length} bytes; the maximum is ${MAX_DATAGRAM}`);
  return w.finish();
}

/**
 * Decode one datagram. Returns null for anything that is not exactly a valid datagram:
 * bad magic, unknown type, truncated payload, trailing bytes, out-of-range enums, or more than 1200 bytes.
 * Never throws.
 */
export function decode(buf: Uint8Array): Datagram | null {
  if (buf.length < HEADER_BYTES || buf.length > MAX_DATAGRAM || buf[0] !== MAGIC) return null;
  try {
    const r = new Reader(buf);
    r.u8();
    const type = r.u8();
    const session = r.u16();
    const seq = r.u32();
    const ack = r.u32();
    const packet = readPacket(type, r);
    if (r.remaining !== 0) return null;
    return { session, seq, ack, packet };
  } catch (e) {
    if (e instanceof Truncated || e instanceof Invalid || e instanceof RangeError) return null;
    return null;
  }
}

/** Peek at the header without decoding the payload (for routing and logging). Null if too short or bad magic. */
export function peekHeader(buf: Uint8Array): { type: number; session: number; seq: number; ack: number } | null {
  if (buf.length < HEADER_BYTES || buf[0] !== MAGIC) return null;
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return { type: v.getUint8(1), session: v.getUint16(2, true), seq: v.getUint32(4, true), ack: v.getUint32(8, true) };
}

export { Invalid as InvalidWire };
