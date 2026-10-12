import { Reader, Writer } from "./buf.js";
import { readErrand, writeErrand } from "./codec.js";
import { CORRIDOR, MAX_FRAGMENT, MAX_FRAGMENTS, type MatchBlob } from "./types.js";

/**
 * Encode the match blob (SPEC 5.4), in this order: tier, seed_hint, w, h, tiles, rooms, room_names, sigil_owner,
 * params, maria_start, board, fixtures, items, start, decor. One byte per tile and per room id, fixed-width fields.
 */
export function encodeBlob(b: MatchBlob): Uint8Array {
  if (b.tiles.length !== b.w * b.h || b.rooms.length !== b.w * b.h) throw new RangeError("tiles and rooms must have w*h entries");
  const w = new Writer(2048);
  w.u8(b.tier).u32(b.seedHint).u8(b.w).u8(b.h).bytes(b.tiles).bytes(b.rooms);
  w.u8(b.roomNames.length);
  for (const n of b.roomNames) {
    w.u8(n.length);
    for (let i = 0; i < n.length; i++) w.u8(n.charCodeAt(i));
  }
  w.u8(b.sigilOwner[0]).u8(b.sigilOwner[1]);
  const p = b.params;
  w.u16(p.maxTick).u16(p.tickMs).u8(p.postInterval).u8(p.expiryMin).u8(p.expiryMax).u8(p.snatchCost).u8(p.regen).u8(p.energyStart).u8(p.inventorySlots).u8(p.returnTicks).u8(p.chaos);
  w.u8(b.mariaStart.x).u8(b.mariaStart.y);
  w.u8(b.board.length);
  for (const e of b.board) writeErrand(w, e);
  w.u8(b.fixtures.length);
  for (const f of b.fixtures) w.u16(f.id).u8(f.kind).u8(f.x).u8(f.y).u8(f.flags);
  w.u8(b.items.length);
  for (const i of b.items) w.u16(i.id).u8(i.kind).u8(i.x).u8(i.y).u8(i.flags);
  w.u8(b.start.x).u8(b.start.y);
  w.u8(b.decor.length);
  for (const d of b.decor) w.u8(d.kind).u8(d.x).u8(d.y);
  return w.finish();
}

/** Decode a reassembled blob. Null if it is truncated, has trailing bytes, or any value is out of range. Never throws. */
export function decodeBlob(buf: Uint8Array): MatchBlob | null {
  try {
    const r = new Reader(buf);
    const tier = r.u8();
    const seedHint = r.u32();
    const w = r.u8();
    const h = r.u8();
    if (tier > 2 || w === 0 || h === 0) return null;
    const tiles = r.bytes(w * h);
    const rooms = r.bytes(w * h);
    const nNames = r.u8();
    const roomNames: string[] = [];
    for (let i = 0; i < nNames; i++) {
      const len = r.u8();
      const bytes = r.bytes(len);
      if (len === 0 || !bytes.every((c) => c >= 0x21 && c < 0x7f)) return null;
      roomNames.push(String.fromCharCode(...bytes));
    }
    if (!tiles.every((t) => t <= 4) || !rooms.every((x) => x === CORRIDOR || x < nNames)) return null;
    const s0 = r.u8();
    const s1 = r.u8();
    if (s0 > 1 || s1 > 1) return null;
    const params = {
      maxTick: r.u16(),
      tickMs: r.u16(),
      postInterval: r.u8(),
      expiryMin: r.u8(),
      expiryMax: r.u8(),
      snatchCost: r.u8(),
      regen: r.u8(),
      energyStart: r.u8(),
      inventorySlots: r.u8(),
      returnTicks: r.u8(),
      chaos: r.u8(),
    };
    if (params.postInterval === 0 || params.expiryMax < params.expiryMin || params.chaos > 3 || params.energyStart > 100 || params.inventorySlots === 0 || params.returnTicks === 0) return null;
    const mariaStart = { x: r.u8(), y: r.u8() };
    if (mariaStart.x >= w || mariaStart.y >= h) return null;
    const board: MatchBlob["board"] = [];
    const nB = r.u8();
    for (let i = 0; i < nB; i++) {
      const e = readErrand(r);
      if (e.room !== 0xff && e.room >= nNames) return null;
      board.push(e);
    }
    const fixtures: MatchBlob["fixtures"] = [];
    const nF = r.u8();
    for (let i = 0; i < nF; i++) {
      const f = { id: r.u16(), kind: r.u8(), x: r.u8(), y: r.u8(), flags: r.u8() };
      if (f.kind > 10 || f.x >= w || f.y >= h || f.flags > 1) return null;
      fixtures.push(f);
    }
    const items: MatchBlob["items"] = [];
    const nI = r.u8();
    for (let i = 0; i < nI; i++) {
      const it = { id: r.u16(), kind: r.u8(), x: r.u8(), y: r.u8(), flags: r.u8() };
      if (it.kind > 9 || it.x >= w || it.y >= h || it.flags > 1) return null;
      items.push(it);
    }
    const start = { x: r.u8(), y: r.u8() };
    if (start.x >= w || start.y >= h) return null;
    const decor: MatchBlob["decor"] = [];
    const nD = r.u8();
    for (let i = 0; i < nD; i++) {
      const d = { kind: r.u8(), x: r.u8(), y: r.u8() };
      if (d.kind > 11 || d.x >= w || d.y >= h) return null;
      decor.push(d);
    }
    if (r.remaining !== 0) return null;
    return { tier, seedHint, w, h, tiles, rooms, roomNames, sigilOwner: [s0, s1], params, mariaStart, board, fixtures, items, start, decor };
  } catch {
    return null;
  }
}

/** Split a blob into fragments of at most 1000 bytes. */
export function fragment(blob: Uint8Array): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (let i = 0; i < blob.length; i += MAX_FRAGMENT) out.push(blob.slice(i, i + MAX_FRAGMENT));
  if (out.length === 0 || out.length > MAX_FRAGMENTS) throw new RangeError(`blob of ${blob.length} bytes cannot be fragmented`);
  return out;
}

/**
 * Reassembles one match's MATCH_START fragments, in any order, ignoring duplicates.
 * A fragment whose `frag_count` disagrees with the first one seen is ignored.
 */
export class Reassembler {
  private parts: (Uint8Array | null)[] | null = null;
  private got = 0;

  /** Add a fragment. Returns the whole blob once every fragment has arrived, otherwise null. */
  add(frag: number, fragCount: number, data: Uint8Array): Uint8Array | null {
    if (fragCount < 1 || fragCount > MAX_FRAGMENTS || frag >= fragCount) return null;
    if (!this.parts) this.parts = Array.from({ length: fragCount }, () => null);
    if (this.parts.length !== fragCount) return null;
    if (this.parts[frag] === null) {
      this.parts[frag] = data.slice();
      this.got++;
    }
    return this.complete();
  }

  complete(): Uint8Array | null {
    if (!this.parts || this.got !== this.parts.length) return null;
    const len = this.parts.reduce((n, p) => n + p!.length, 0);
    const out = new Uint8Array(len);
    let o = 0;
    for (const p of this.parts) {
      out.set(p!, o);
      o += p!.length;
    }
    return out;
  }

  missing(): number[] {
    if (!this.parts) return [];
    return this.parts.flatMap((p, i) => (p === null ? [i] : []));
  }
}
