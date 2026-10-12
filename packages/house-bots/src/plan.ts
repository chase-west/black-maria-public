import type { Errand, HeldItem, Intent, ItemKind, ItemView, Pos, RoomName, StateMsg } from "@blackmaria/protocol";
import { holdsKey, holdsKind, type Knowledge, type StreakTracker } from "./knowledge.js";

/** The tile a body should head for next to make progress on an errand, and what to do there. */
export interface NextStep {
  /** Target tile index, or -1 for "anywhere in `room`". */
  tile: number;
  room?: RoomName;
  /** What to send on arrival. */
  act: Intent;
  /** Walking ticks from the body to the target. */
  dist: number;
  /** The floor item the step is for, if any. */
  item: ItemView | null;
}

export const openErrands = (s: StateMsg): Errand[] => s.board.filter((e) => e.state === "open" && e.posted <= s.tick && s.tick < e.expires);

/** Floor items of a kind, nearest first from `from` (ties: lowest id). */
export function floorItems(k: Knowledge, s: StateMsg, kind: string, from: number, hasKey: boolean): { item: ItemView; d: number }[] {
  const out: { item: ItemView; d: number }[] = [];
  for (const it of s.items) if (it.kind === kind) out.push({ item: it, d: k.dist(from, k.idx(it.pos), hasKey) });
  out.sort((a, b) => a.d - b.d || Number(a.item.id.slice(1)) - Number(b.item.id.slice(1)));
  return out;
}

/**
 * The next step for an errand (RULES.md section 9): for a deliver, the fixture if the body holds the kind, otherwise
 * the nearest floor item of the kind; for a carry, the nearest floor item of the kind unless it already holds one
 * (then null: holding is the work); for a visit, the nearest tile of the room. Null when there is no reachable step.
 * A full inventory does not stop a pickup step: the body frees a slot on the way (see `freeSlot`).
 */
export function nextStep(k: Knowledge, s: StateMsg, pos: Pos, inv: readonly HeldItem[], e: Errand): NextStep | null {
  const at = k.idx(pos);
  const key = holdsKey(inv);
  if (e.type === "visit") {
    const d = k.roomDist(at, e.room, key);
    if (d === Infinity) return null;
    return { tile: -1, room: e.room, act: { kind: "WAIT" }, dist: d, item: null };
  }
  const mine = holdsKind(inv, e.item_kind);
  if (mine) {
    if (e.type === "carry") return null;
    const f = k.fixtureIdx.get(e.fixture);
    if (f === undefined) return null;
    const d = k.dist(at, f, key);
    if (d === Infinity) return null;
    return { tile: f, act: { kind: "USE", item: mine.id }, dist: d, item: null };
  }
  const near = floorItems(k, s, e.item_kind, at, key)[0];
  if (!near || near.d === Infinity) return null;
  return { tile: k.idx(near.item.pos), act: { kind: "TAKE" }, dist: near.d, item: near.item };
}

/** Item kinds some open errand needs (a deliver or a carry). */
export function usefulKinds(s: StateMsg): Set<ItemKind> {
  const out = new Set<ItemKind>();
  for (const e of openErrands(s)) if (e.type !== "visit") out.add(e.item_kind);
  return out;
}

/**
 * Which held item to drop to free a slot (RULES.md section 9): never the key and never an item of a kind being
 * fetched; the lowest-id item no open errand needs, else the lowest-id item. Null when nothing can go.
 */
export function dropChoice(inv: readonly { id: string; kind: ItemKind }[], useful: ReadonlySet<ItemKind>, want: ReadonlySet<ItemKind>): string | null {
  const ok = inv.filter((i) => i.kind !== "key" && !want.has(i.kind)).sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
  return (ok.find((i) => !useful.has(i.kind)) ?? ok[0])?.id ?? null;
}

const DXY = [
  ["N", 0, -1],
  ["E", 1, 0],
  ["S", 0, 1],
  ["W", -1, 0],
] as const;

/**
 * Freeing a slot (RULES.md section 9). When the inventory is full and the body is heading for a pickup at `tile`, it
 * first drops `dropChoice`, where it stands, if no floor item is on its tile; on the way with a floor item underfoot,
 * it walks on and drops on a later tile; standing on the pickup tile itself, it steps to the first neighbor (N, E, S,
 * W) with no floor item, or drops there if there is none. Otherwise `planned` unchanged.
 */
export function freeSlot(k: Knowledge, s: StateMsg, tile: number, act: Intent, planned: Intent): Intent {
  const inv = s.you.inventory;
  if (act.kind !== "TAKE" || tile < 0 || inv.length < k.params.inventory_slots) return planned;
  const at = k.idx(s.you.pos);
  const on = (i: number) => s.items.some((it) => k.idx(it.pos) === i);
  const want = new Set<ItemKind>(s.items.filter((it) => k.idx(it.pos) === tile).map((it) => it.kind));
  const id = dropChoice(inv, usefulKinds(s), want);
  if (!id) return planned;
  if (!on(at)) return { kind: "DROP", item: id };
  if (at !== tile && planned.kind === "MOVE") return planned;
  const p = s.you.pos;
  for (const [dir, dx, dy] of DXY) {
    const x = p.x + dx;
    const y = p.y + dy;
    if (x < 0 || y < 0 || x >= k.w || y >= k.h) continue;
    const t = k.tiles[y * k.w + x];
    if (t === "wall" || (t === "door_locked" && !k.doorOpen)) continue;
    if (!on(y * k.w + x)) return { kind: "MOVE", dir };
  }
  return { kind: "DROP", item: id };
}

/** The move that carries out a next step from `pos`: walk, or act on arrival. */
export function moveFor(k: Knowledge, pos: Pos, inv: readonly HeldItem[], step: NextStep): Intent {
  const at = k.idx(pos);
  const key = holdsKey(inv);
  if (step.tile < 0) {
    const d = step.room ? k.stepTowardRoom(at, step.room, key) : null;
    return d ? { kind: "MOVE", dir: d } : { kind: "WAIT" };
  }
  if (at === step.tile) return step.act;
  const d = k.stepToward(at, step.tile, key);
  return d ? { kind: "MOVE", dir: d } : { kind: "WAIT" };
}

/** Ticks of work an errand takes from here, and ticks until it would complete (RULES.md section 9, Adept). */
export interface Cost {
  /** Ticks of the body's own time: for a carry, only the walk and the pickup, since holding is free. */
  effort: number;
  /** Ticks from now until it completes: it completes at the end of tick `s.tick + finish - 1`. */
  finish: number;
  /** For a deliver or a carry not yet held: the floor item that gives this cost. */
  item: ItemView | null;
}

const NONE: Cost = { effort: Infinity, finish: Infinity, item: null };

/**
 * The cost of an errand for a body at `pos` holding `inv`, starting on tick `s.tick`. Infinity when it cannot be done.
 * deliver: walk to the item, 1 to TAKE, walk to the fixture, 1 to USE (an item already held skips the first two).
 * visit: walk to the room (at least 1). carry: walk to the item and 1 to TAKE, finishing `n` ticks after the pickup
 * (an item already held finishes after the rest of its run).
 */
export function errandCost(k: Knowledge, s: StateMsg, pos: Pos, inv: readonly HeldItem[], e: Errand, streak: StreakTracker | null): Cost {
  const at = k.idx(pos);
  const key = holdsKey(inv);
  if (e.type === "visit") {
    const d = Math.max(1, k.roomDist(at, e.room, key));
    return { effort: d, finish: d, item: null };
  }
  const mine = holdsKind(inv, e.item_kind);
  if (e.type === "deliver") {
    const f = k.fixtureIdx.get(e.fixture);
    if (f === undefined) return NONE;
    if (mine) {
      const d = k.dist(at, f, key) + 1;
      return { effort: d, finish: d, item: null };
    }
    if (inv.length >= k.params.inventory_slots) return NONE;
    let best = NONE;
    for (const it of s.items) {
      if (it.kind !== e.item_kind) continue;
      const i = k.idx(it.pos);
      const c = k.dist(at, i, key) + 1 + k.dist(i, f, key) + 1;
      if (c < best.effort) best = { effort: c, finish: c, item: it };
    }
    return best;
  }
  if (mine) {
    const done = Math.min(streak ? streak.count(e.item_kind) : 0, s.tick - e.posted);
    return { effort: 0, finish: Math.max(1, e.carry_ticks - done), item: null };
  }
  if (inv.length >= k.params.inventory_slots) return NONE;
  const near = floorItems(k, s, e.item_kind, at, key)[0];
  return near && near.d < Infinity ? { effort: near.d + 1, finish: near.d + e.carry_ticks, item: near.item } : NONE;
}

/** The next step toward an errand through a chosen floor item (for a deliver or carry whose cost picked one). */
export function stepVia(k: Knowledge, pos: Pos, inv: readonly HeldItem[], e: Errand, item: ItemView | null): NextStep | null {
  if (!item || e.type === "visit") return null;
  const at = k.idx(pos);
  const tile = k.idx(item.pos);
  return { tile, act: { kind: "TAKE" }, dist: k.dist(at, tile, holdsKey(inv)), item };
}
