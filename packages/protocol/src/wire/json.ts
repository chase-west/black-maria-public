/**
 * Conversions between the JSON protocol shapes and the wire structs. Used by the server to build datagrams from its
 * views, and by clients that want to drive a JSON-shaped bot from the wire.
 *
 * Ids on the wire are integers (SPEC 5.4). JSON item ids are `i<n>` and fixture ids `f<n>`; errand ids are integers
 * in both.
 */
import {
  DECOR_KINDS,
  DIRS,
  ERRAND_STATES,
  ERRAND_TYPES,
  FIXTURE_KINDS,
  ITEM_KINDS,
  ROOM_NAMES,
  TILE_KINDS,
  type ChaosName,
  type Dir,
  type Errand,
  type GameEvent,
  type Intent,
  type ItemKind,
  type MatchStartMsg,
  type Mode,
  type RoomName,
  type RoomOrCorridor,
  type StateMsg,
  type Tier,
  type TileKind,
  type Who,
} from "../types.js";
import type { WireSnapshot } from "./delta.js";
import { CHAOS_NAMES, CORRIDOR, INTENT_KIND, NONE16, NONE8, TIER_ID, TIER_NAMES, type ErrandRecord, type MatchBlob, type WireEvent, type WireIntent } from "./types.js";

const num = (id: string, prefix: string): number => {
  if (!id.startsWith(prefix)) throw new RangeError(`id ${id} does not start with ${prefix}`);
  const n = Number(id.slice(prefix.length));
  if (!Number.isInteger(n) || n < 0 || n >= NONE16) throw new RangeError(`id ${id} has no wire form`);
  return n;
};
export const itemToWire = (id: string): number => num(id, "i");
export const itemFromWire = (n: number): string => `i${n}`;
export const fixtureToWire = (id: string): number => num(id, "f");
export const fixtureFromWire = (n: number): string => `f${n}`;

export const whoToWire = (w: Who): number => (w === "you" ? 0 : 1);
export const whoFromWire = (n: number): Who => (n === 0 ? "you" : "maria");
export const chaosToWire = (c: ChaosName): number => CHAOS_NAMES.indexOf(c);
export const chaosFromWire = (n: number): ChaosName => CHAOS_NAMES[n] ?? "off";

/** Room names in the order the blob lists them: the rooms present on the map, in ROOM_NAMES order. */
export function roomNamesOf(rooms: readonly (readonly RoomOrCorridor[])[]): RoomName[] {
  const present = new Set<string>();
  for (const row of rooms) for (const r of row) if (r !== "corridor") present.add(r);
  return ROOM_NAMES.filter((n) => present.has(n));
}

export function intentToWire(i: Intent): WireIntent {
  switch (i.kind) {
    case "WAIT":
      return { kind: INTENT_KIND.WAIT, dir: 0, item: 0 };
    case "MOVE":
      return { kind: INTENT_KIND.MOVE, dir: DIRS.indexOf(i.dir), item: 0 };
    case "TAKE":
      return { kind: INTENT_KIND.TAKE, dir: 0, item: 0 };
    case "DROP":
      return { kind: INTENT_KIND.DROP, dir: 0, item: itemToWire(i.item) };
    case "USE":
      return { kind: INTENT_KIND.USE, dir: 0, item: itemToWire(i.item) };
    case "SNATCH":
      return { kind: INTENT_KIND.SNATCH, dir: 0, item: 0 };
  }
}

/** Null when the kind is unknown or a MOVE has no valid direction (the server answers ERROR 5). */
export function intentFromWire(w: WireIntent): Intent | null {
  switch (w.kind) {
    case 0:
      return { kind: "WAIT" };
    case 1:
      return w.dir <= 3 ? { kind: "MOVE", dir: DIRS[w.dir] as Dir } : null;
    case 2:
      return { kind: "TAKE" };
    case 3:
      return { kind: "DROP", item: itemFromWire(w.item) };
    case 4:
      return { kind: "USE", item: itemFromWire(w.item) };
    case 5:
      return { kind: "SNATCH" };
    default:
      return null;
  }
}

export function errandToRecord(e: Errand, roomNames: readonly string[]): ErrandRecord {
  const room = e.type === "visit" ? roomNames.indexOf(e.room) : -1;
  return {
    id: e.id,
    type: ERRAND_TYPES.indexOf(e.type),
    itemKind: e.type === "visit" ? NONE8 : ITEM_KINDS.indexOf(e.item_kind),
    fixture: e.type === "deliver" ? fixtureToWire(e.fixture) : NONE16,
    room: room < 0 ? NONE8 : room,
    carryTicks: e.type === "carry" ? e.carry_ticks : 0,
    value: e.value,
    posted: e.posted,
    expires: e.expires,
    state: ERRAND_STATES.indexOf(e.state),
  };
}

export function recordToErrand(r: ErrandRecord, roomNames: readonly string[]): Errand | null {
  const type = ERRAND_TYPES[r.type];
  const state = ERRAND_STATES[r.state];
  if (!type || !state) return null;
  const base = { id: r.id, value: r.value, posted: r.posted, expires: r.expires, state };
  const kind = ITEM_KINDS[r.itemKind];
  switch (type) {
    case "deliver":
      return kind && r.fixture !== NONE16 ? { ...base, type, item_kind: kind, fixture: fixtureFromWire(r.fixture) } : null;
    case "visit": {
      const room = roomNames[r.room] as RoomName | undefined;
      return room ? { ...base, type, room } : null;
    }
    case "carry":
      return kind ? { ...base, type, item_kind: kind, carry_ticks: r.carryTicks } : null;
  }
}

export function eventToWire(e: GameEvent, roomNames: readonly string[]): WireEvent {
  switch (e.kind) {
    case "posted":
      return { kind: "posted", errand: errandToRecord(e.errand, roomNames) };
    case "completed":
      return { kind: "completed", id: e.errand, by: whoToWire(e.by) };
    case "expired":
      return { kind: "expired", id: e.errand };
    case "took":
    case "dropped":
    case "snatched":
      return { kind: e.kind, by: whoToWire(e.by), item: itemToWire(e.item) };
    case "delivered":
      return { kind: "delivered", by: whoToWire(e.by), item: itemToWire(e.item), fixture: fixtureToWire(e.fixture) };
    case "door_opened":
      return { kind: "door_opened", x: e.pos.x, y: e.pos.y };
    case "safe_opened":
      return { kind: "safe_opened", fixture: fixtureToWire(e.fixture), item: e.item ? itemToWire(e.item) : NONE16 };
    case "sigil":
      return { kind: "sigil", owner: whoToWire(e.owner), energy: e.energy_gained };
    case "moved":
      return { kind: "moved", by: whoToWire(e.by), dir: DIRS.indexOf(e.dir) };
    case "winding_up":
      return { kind: "winding_up", by: whoToWire(e.by) };
    case "returned":
      return { kind: "returned", item: itemToWire(e.item), itemKind: ITEM_KINDS.indexOf(e.item_kind), x: e.pos.x, y: e.pos.y };
  }
}

export function eventFromWire(e: WireEvent, roomNames: readonly string[]): GameEvent | null {
  switch (e.kind) {
    case "posted": {
      const errand = recordToErrand(e.errand, roomNames);
      return errand ? { kind: "posted", errand } : null;
    }
    case "completed":
      return { kind: "completed", errand: e.id, by: whoFromWire(e.by) };
    case "expired":
      return { kind: "expired", errand: e.id };
    case "took":
    case "dropped":
    case "snatched":
      return { kind: e.kind, by: whoFromWire(e.by), item: itemFromWire(e.item) };
    case "delivered":
      return { kind: "delivered", by: whoFromWire(e.by), item: itemFromWire(e.item), fixture: fixtureFromWire(e.fixture) };
    case "door_opened":
      return { kind: "door_opened", pos: { x: e.x, y: e.y } };
    case "safe_opened":
      return { kind: "safe_opened", fixture: fixtureFromWire(e.fixture), item: e.item === NONE16 ? "" : itemFromWire(e.item) };
    case "sigil":
      return { kind: "sigil", owner: whoFromWire(e.owner), energy_gained: e.energy };
    case "moved":
      return e.dir <= 3 ? { kind: "moved", by: whoFromWire(e.by), dir: DIRS[e.dir] as Dir } : null;
    case "winding_up":
      return { kind: "winding_up", by: whoFromWire(e.by) };
    case "returned": {
      const k = ITEM_KINDS[e.itemKind];
      return k ? { kind: "returned", item: itemFromWire(e.item), item_kind: k, pos: { x: e.x, y: e.y } } : null;
    }
  }
}

/** Build the match blob from a JSON `match_start`. */
export function blobFromMatchStart(ms: MatchStartMsg, seedHint: number): MatchBlob {
  const { w, h } = ms.map;
  const roomNames = roomNamesOf(ms.map.rooms);
  const tiles = new Uint8Array(w * h);
  const rooms = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      tiles[y * w + x] = TILE_KINDS.indexOf(ms.map.tiles[y]![x]!);
      const r = ms.map.rooms[y]![x]!;
      rooms[y * w + x] = r === "corridor" ? CORRIDOR : roomNames.indexOf(r);
    }
  const owners = ms.sigil_owner.map(whoToWire);
  const safeFixtures = new Set(ms.safe_items.map((i) => i.fixture));
  const p = ms.params;
  return {
    tier: TIER_ID[ms.tier],
    seedHint: seedHint >>> 0,
    w,
    h,
    tiles,
    rooms,
    roomNames,
    sigilOwner: [owners[0] ?? 0, owners[1] ?? 1],
    params: {
      maxTick: p.max_tick,
      tickMs: p.tick_ms,
      postInterval: p.post_interval,
      expiryMin: p.expiry_min,
      expiryMax: p.expiry_max,
      snatchCost: p.snatch_cost,
      regen: p.regen,
      energyStart: p.energy_start,
      inventorySlots: p.inventory_slots,
      returnTicks: p.return_ticks,
      chaos: chaosToWire(p.chaos),
    },
    mariaStart: { ...ms.maria_start },
    board: ms.board.map((e) => errandToRecord(e, roomNames)),
    fixtures: ms.fixtures.map((f) => ({ id: fixtureToWire(f.id), kind: FIXTURE_KINDS.indexOf(f.kind), x: f.pos.x, y: f.pos.y, flags: f.kind === "safe" && safeFixtures.has(f.id) ? 1 : 0 })),
    items: [
      ...ms.items.map((i) => ({ id: itemToWire(i.id), kind: ITEM_KINDS.indexOf(i.kind), x: i.pos.x, y: i.pos.y, flags: 0 })),
      ...ms.safe_items.map((i) => {
        const f = ms.fixtures.find((x) => x.id === i.fixture)!;
        return { id: itemToWire(i.id), kind: ITEM_KINDS.indexOf(i.kind), x: f.pos.x, y: f.pos.y, flags: 1 };
      }),
    ].sort((a, b) => a.id - b.id),
    start: { ...ms.start },
    decor: ms.decor.map((d) => ({ kind: DECOR_KINDS.indexOf(d.kind), x: d.pos.x, y: d.pos.y })),
  };
}

/** Rebuild a JSON-shaped `match_start` from a blob, for clients that drive a JSON bot from the wire. */
export function matchStartFromBlob(b: MatchBlob, meta: { match_id: string; mode: Mode }): MatchStartMsg {
  const tiles: TileKind[][] = [];
  const rooms: RoomOrCorridor[][] = [];
  for (let y = 0; y < b.h; y++) {
    const tr: TileKind[] = [];
    const rr: RoomOrCorridor[] = [];
    for (let x = 0; x < b.w; x++) {
      tr.push(TILE_KINDS[b.tiles[y * b.w + x]!] ?? "wall");
      const r = b.rooms[y * b.w + x]!;
      rr.push(r === CORRIDOR ? "corridor" : (b.roomNames[r] as RoomName));
    }
    tiles.push(tr);
    rooms.push(rr);
  }
  const fixtures = b.fixtures.map((f) => ({ id: fixtureFromWire(f.id), kind: FIXTURE_KINDS[f.kind]!, pos: { x: f.x, y: f.y } }));
  const safeAt = (x: number, y: number) => fixtures.find((f) => f.pos.x === x && f.pos.y === y && f.kind === "safe")?.id ?? "";
  const p = b.params;
  return {
    type: "match_start",
    match_id: meta.match_id,
    mode: meta.mode,
    tier: TIER_NAMES[b.tier] as Tier,
    params: {
      max_tick: p.maxTick,
      tick_ms: p.tickMs,
      post_interval: p.postInterval,
      expiry_min: p.expiryMin,
      expiry_max: p.expiryMax,
      snatch_cost: p.snatchCost,
      regen: p.regen,
      energy_start: p.energyStart,
      inventory_slots: p.inventorySlots,
      return_ticks: p.returnTicks,
      chaos: chaosFromWire(p.chaos),
    },
    map: { w: b.w, h: b.h, tiles, rooms },
    room_names: b.roomNames as RoomName[],
    fixtures,
    items: b.items.filter((i) => !(i.flags & 1)).map((i) => ({ id: itemFromWire(i.id), kind: ITEM_KINDS[i.kind] as ItemKind, pos: { x: i.x, y: i.y } })),
    safe_items: b.items.filter((i) => i.flags & 1).map((i) => ({ id: itemFromWire(i.id), kind: ITEM_KINDS[i.kind] as ItemKind, fixture: safeAt(i.x, i.y) })),
    decor: b.decor.map((d) => ({ kind: DECOR_KINDS[d.kind] ?? "plant", pos: { x: d.x, y: d.y } })),
    start: { ...b.start },
    maria_start: { ...b.mariaStart },
    sigil_owner: b.sigilOwner.map(whoFromWire),
    board: b.board.map((r) => recordToErrand(r, b.roomNames)).filter((e): e is Errand => e !== null),
    you: { energy: p.energyStart },
  };
}

/**
 * Item kinds by wire id, from a match_start (floor items and the safe's item). Items the house puts back get new ids;
 * `stateFromSnapshot` learns their kinds from `items` and from `returned` events, so keep one map per match.
 */
export function itemKindsOf(ms: MatchStartMsg): Map<number, ItemKind> {
  const m = new Map<number, ItemKind>();
  for (const i of ms.items) m.set(itemToWire(i.id), i.kind);
  for (const i of ms.safe_items) m.set(itemToWire(i.id), i.kind);
  return m;
}

/** The snapshot part of a JSON `state` (what a STATE carries besides events). */
export function snapshotFromState(s: StateMsg, roomNames: readonly string[]): WireSnapshot {
  return {
    you: { x: s.you.pos.x, y: s.you.pos.y, energy: s.you.energy },
    maria: { ...s.maria.pos },
    invYou: s.you.inventory.map((i) => itemToWire(i.id)),
    invMaria: s.maria.inventory.map((i) => itemToWire(i.id)),
    items: s.items.map((i) => ({ id: itemToWire(i.id), kind: ITEM_KINDS.indexOf(i.kind), x: i.pos.x, y: i.pos.y })).sort((a, b) => a.id - b.id),
    board: s.board.map((e) => errandToRecord(e, roomNames)).sort((a, b) => a.id - b.id),
    doors: s.doors_opened.map((d) => ({ ...d })).sort((a, b) => a.y - b.y || a.x - b.x),
    safes: s.safes_opened.map(fixtureToWire).sort((a, b) => a - b),
    sigils: [s.sigil_charge[0] ?? 0, s.sigil_charge[1] ?? 0],
  };
}

/** Rebuild a JSON-shaped `state` from a snapshot and events, given the match_start it belongs to. */
export function stateFromSnapshot(start: MatchStartMsg, snap: WireSnapshot, events: WireEvent[], meta: { tick: number; deadline_ms: number }, kinds: Map<number, ItemKind> = itemKindsOf(start)): StateMsg {
  const names = start.room_names;
  for (const i of snap.items) if (ITEM_KINDS[i.kind]) kinds.set(i.id, ITEM_KINDS[i.kind]!);
  for (const e of events) if (e.kind === "returned" && ITEM_KINDS[e.itemKind]) kinds.set(e.item, ITEM_KINDS[e.itemKind]!);
  const held = (ids: number[]) => ids.map((id) => ({ id: itemFromWire(id), kind: kinds.get(id) ?? "key" }));
  const board = snap.board.map((r) => recordToErrand(r, names)).filter((e): e is Errand => e !== null);
  const scores = { you: 0, maria: 0 };
  for (const e of board) {
    if (e.state === "done_by_you") scores.you += e.value;
    if (e.state === "done_by_maria") scores.maria += e.value;
  }
  return {
    type: "state",
    match_id: start.match_id,
    tick: meta.tick,
    deadline_ms: meta.deadline_ms,
    you: { pos: { x: snap.you.x, y: snap.you.y }, inventory: held(snap.invYou), energy: snap.you.energy },
    maria: { pos: { ...snap.maria }, inventory: held(snap.invMaria) },
    items: snap.items.map((i) => ({ id: itemFromWire(i.id), kind: ITEM_KINDS[i.kind] as ItemKind, pos: { x: i.x, y: i.y } })),
    board,
    doors_opened: snap.doors.map((d) => ({ ...d })),
    safes_opened: snap.safes.map(fixtureFromWire),
    sigil_charge: [snap.sigils[0], snap.sigils[1]],
    scores,
    events: events.map((e) => eventFromWire(e, names)).filter((e): e is GameEvent => e !== null),
  };
}
