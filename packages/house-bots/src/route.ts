import type { Errand, HeldItem, Intent, ItemKind, RoomName, StateMsg } from "@blackmaria/protocol";
import type { Knowledge, StreakTracker } from "./knowledge.js";
import { dropChoice, openErrands, usefulKinds } from "./plan.js";

/**
 * Route search over sequences of errands (SPEC 4.3, RULES.md section 9). A sequence is played out on a small model
 * of one body: exact walking distances; TAKE takes a tick and picks up everything on the tile in id order until the
 * inventory is full; USE takes a tick and uses the item up; the key is fetched when the vault door or the safe stands
 * in the way (opening the door is a tick spent standing still, opening the safe is a USE); a carry completes `n`
 * ticks after the pickup while the body walks on; an errand finished at or after its expiry scores nothing.
 * Fixed budget: beam width × depth.
 */

export interface RouteOpts {
  beam: number;
  depth: number;
  /** Each errand's value is multiplied by `gamma` for every tick until it would complete. */
  gamma: number;
  /** Score per item held at the end of a sequence (0 to ignore), scaled by the share of the match still to play. */
  holdValue: number;
  /** When true, the hold value shrinks linearly to 0 at the end of the match. */
  holdDecay?: boolean;
}

export const ROUTE_DEFAULTS: RouteOpts = { beam: 8, depth: 3, gamma: 0.97, holdValue: 0 };

interface SimItem {
  id: string;
  kind: ItemKind;
  /** The first tick end of the current holding run. */
  since: number;
}

/** A body in a branch of the search. */
export interface Sim {
  /** The next tick the body acts on. */
  t: number;
  pos: number;
  inv: SimItem[];
  /** Floor items still on the floor in this branch, by id. */
  floor: Map<string, { kind: ItemKind; idx: number }>;
  door: boolean;
  /** The closed safe and the item inside it, or null once it is open (or if there is none). */
  safe: { idx: number; item: { id: string; kind: ItemKind } | null } | null;
  /** This body's energy, for snatches planned in this branch. */
  energy: number;
  /** The other body, whose items this branch may plan to snatch (null when snatches are not planned). */
  rival: { pos: number; items: { id: string; kind: ItemKind }[] } | null;
  /** At most one snatch per branch. */
  snatched: boolean;
}

/** One planned errand: when it completes, and the first thing to do for it. */
export interface RouteStep {
  errand: Errand;
  /** The tick at whose end it completes. */
  finish: number;
  /** The tick the body is free again after it (for a carry: after the pickup). */
  free: number;
  /** The first waypoint: a tile to head for (or a room) and what to send on arrival. */
  tile: number;
  room: RoomName | null;
  act: Intent;
  /** The chance the step gets its item: 1, or for a planned snatch the share of the other body's items of that kind. */
  chance: number;
}

export interface Route {
  steps: RouteStep[];
  score: number;
  /** Carries that would complete by holding, with their finishing ticks. */
  passive: { errand: Errand; finish: number }[];
}

/** Per-errand multiplier on its value (Master's prediction discount); 1 when absent. */
export type Discount = (e: Errand, finish: number) => number;

const idNum = (id: string) => Number(id.slice(1));

function cloneSim(x: Sim): Sim {
  return { t: x.t, pos: x.pos, inv: x.inv.map((i) => ({ ...i })), floor: new Map(x.floor), door: x.door, safe: x.safe ? { idx: x.safe.idx, item: x.safe.item } : null, energy: x.energy, rival: x.rival, snatched: x.snatched };
}

type Waypoint = { tile: number; room: RoomName | null; act: Intent };

/** Whether a planned snatch for errand `e`, made at tick `at`, finishing at tick `finish`, is allowed. */
export type SnatchGate = (e: Errand, at: number, finish: number) => boolean;

export class RoutePlanner {
  /** Set by a bot that plans snatches: its snatch policy, applied to every planned snatch. */
  snatchGate: SnatchGate | null = null;
  /** Kinds the open errands need, as of the last `start` (for choosing what to drop when the inventory is full). */
  private useful: ReadonlySet<ItemKind> = new Set();
  constructor(
    readonly k: Knowledge,
    readonly opts: RouteOpts = ROUTE_DEFAULTS,
  ) {}

  /**
   * The model of a body as it stands in state `s`. Items in `exclude` are treated as not on the floor. With `rival`,
   * the branch may plan one snatch of the other body's items, as of where it stands now.
   */
  start(
    s: StateMsg,
    pos: { x: number; y: number },
    inv: readonly HeldItem[],
    streak: StreakTracker | null,
    safeItem: { id: string; kind: ItemKind; fixture: string } | null = null,
    exclude: ReadonlySet<string> = new Set(),
    snatch: { energy: number; rivalPos: { x: number; y: number }; rivalInv: readonly HeldItem[] } | null = null,
  ): Sim {
    this.useful = usefulKinds(s);
    const floor = new Map<string, { kind: ItemKind; idx: number }>();
    for (const it of s.items) if (!exclude.has(it.id)) floor.set(it.id, { kind: it.kind, idx: this.k.idx(it.pos) });
    let safe: Sim["safe"] = null;
    if (safeItem && !s.safes_opened.includes(safeItem.fixture)) {
      const idx = this.k.fixtureIdx.get(safeItem.fixture);
      if (idx !== undefined) safe = { idx, item: { id: safeItem.id, kind: safeItem.kind } };
    }
    return {
      t: s.tick,
      pos: this.k.idx(pos),
      inv: inv.map((i) => ({ id: i.id, kind: i.kind, since: s.tick - (streak ? streak.count(i.kind) : 0) })),
      floor,
      door: this.k.doorOpen,
      safe,
      energy: snatch ? snatch.energy : 0,
      rival: snatch && snatch.rivalInv.length ? { pos: this.k.idx(snatch.rivalPos), items: snatch.rivalInv.map((i) => ({ id: i.id, kind: i.kind })) } : null,
      snatched: false,
    };
  }

  private hasKey(x: Sim): boolean {
    return x.inv.some((i) => i.kind === "key");
  }
  private keyOnFloor(x: Sim): { id: string; idx: number } | null {
    for (const [id, v] of x.floor) if (v.kind === "key") return { id, idx: v.idx };
    return null;
  }
  private dist(x: Sim, a: number, b: number): number {
    return this.k.distDoor(a, b, x.door, this.hasKey(x));
  }

  private take(x: Sim, tick: number): void {
    const here = [...x.floor.entries()].filter(([, v]) => v.idx === x.pos).sort((a, b) => idNum(a[0]) - idNum(b[0]));
    for (const [id, v] of here) {
      if (x.inv.length >= this.k.params.inventory_slots) break;
      x.floor.delete(id);
      x.inv.push({ id, kind: v.kind, since: tick });
    }
  }

  /**
   * Walk to a tile, fetching the key first and opening the vault door on the way if that is the only route.
   * Mutates `x`; false when the tile cannot be reached. Records the first waypoint in `wp` if it is empty.
   */
  private goTo(x: Sim, tile: number, wp: { w: Waypoint | null }, act: Intent): boolean {
    const k = this.k;
    if (x.pos === tile) {
      wp.w ??= { tile, room: null, act };
      return true;
    }
    const closed = k.distDoor(x.pos, tile, x.door, false);
    if (!x.door && this.hasKey(x)) {
      const viaDoor = k.distDoor(x.pos, tile, false, true);
      if (viaDoor < closed) {
        wp.w ??= { tile, room: null, act };
        x.t += viaDoor;
        x.pos = tile;
        this.useDoor(x);
        return true;
      }
    }
    if (closed < Infinity) {
      wp.w ??= { tile, room: null, act };
      x.t += closed;
      x.pos = tile;
      return true;
    }
    if (x.door || this.hasKey(x)) return false;
    const key = this.keyOnFloor(x);
    if (!key) return false;
    const toKey = k.distDoor(x.pos, key.idx, false, false);
    if (toKey === Infinity) return false;
    wp.w ??= { tile: key.idx, room: null, act: { kind: "TAKE" } };
    x.t += toKey;
    x.pos = key.idx;
    this.take(x, x.t);
    x.t += 1;
    if (!this.hasKey(x)) return false;
    return this.goTo(x, tile, wp, act);
  }

  /** The key was used on the vault door during the last walk. */
  private useDoor(x: Sim): void {
    x.door = true;
    const i = x.inv.findIndex((it) => it.kind === "key");
    if (i >= 0) x.inv.splice(i, 1);
  }

  /** Get the safe's item onto this body: fetch the key, open the safe, take the item. */
  private fromSafe(x: Sim, wp: { w: Waypoint | null }): string | null {
    if (!x.safe || !x.safe.item) return null;
    if (!this.hasKey(x)) {
      const key = this.keyOnFloor(x);
      if (!key || !this.goTo(x, key.idx, wp, { kind: "TAKE" })) return null;
      this.take(x, x.t);
      x.t += 1;
      if (!this.hasKey(x)) return null;
    }
    const keyId = x.inv.find((i) => i.kind === "key")!.id;
    if (!this.goTo(x, x.safe.idx, wp, { kind: "USE", item: keyId })) return null;
    if (!this.hasKey(x)) return null; // the key went into the vault door on the way
    x.inv.splice(x.inv.findIndex((i) => i.id === keyId), 1);
    x.t += 1;
    const item = x.safe.item;
    x.floor.set(item.id, { kind: item.kind, idx: x.safe.idx });
    x.safe = null;
    this.take(x, x.t);
    x.t += 1;
    return x.inv.some((i) => i.id === item.id) ? item.id : null;
  }

  /** Every way to get an item of `kind` held: the floor items of that kind, then the safe. Each is a fresh branch. */
  private sources(x: Sim, kind: ItemKind): { sim: Sim; id: string; pickup: number; wp: Waypoint | null; chance: number; snatch?: true }[] {
    const out: { sim: Sim; id: string; pickup: number; wp: Waypoint | null; chance: number; snatch?: true }[] = [];
    if (x.inv.length >= this.k.params.inventory_slots) {
      // Full: drop one item where the body stands (a tick), then fetch (RULES.md section 9, "Freeing a slot").
      const id = dropChoice(x.inv, this.useful, new Set([kind]));
      if (!id) return out;
      const n = cloneSim(x);
      const it = n.inv.splice(
        n.inv.findIndex((i) => i.id === id),
        1,
      )[0]!;
      n.floor.set(id, { kind: it.kind, idx: n.pos });
      n.t += 1;
      x = n;
    }
    const ids = [...x.floor.entries()].filter(([, v]) => v.kind === kind).sort((a, b) => idNum(a[0]) - idNum(b[0]));
    for (const [id, v] of ids) {
      const n = cloneSim(x);
      const wp = { w: null as Waypoint | null };
      if (!this.goTo(n, v.idx, wp, { kind: "TAKE" })) continue;
      if (!n.floor.has(id)) continue;
      const pickup = n.t;
      this.take(n, pickup);
      n.t += 1;
      if (n.inv.some((i) => i.id === id)) out.push({ sim: n, id, pickup, wp: wp.w, chance: 1 });
    }
    if (x.safe?.item?.kind === kind) {
      const n = cloneSim(x);
      const wp = { w: null as Waypoint | null };
      const id = this.fromSafe(n, wp);
      if (id) out.push({ sim: n, id, pickup: n.t - 1, wp: wp.w, chance: 1 });
    }
    const sn = this.fromRival(x, kind);
    if (sn) out.push(sn);
    return out;
  }

  /**
   * Plan a snatch of an item of `kind` from the other body, as it stands now: walk next to it, wait for the energy,
   * wind up (one tick), grab (the next tick, with the item in hand from then on).
   */
  private fromRival(x: Sim, kind: ItemKind): { sim: Sim; id: string; pickup: number; wp: Waypoint | null; chance: number; snatch?: true } | null {
    const r = x.rival;
    if (!r || x.snatched) return null;
    const mine = r.items.filter((i) => i.kind === kind);
    if (mine.length === 0) return null;
    const P = this.k.params;
    const d = this.dist(x, x.pos, r.pos);
    if (d === Infinity) return null;
    const reach = Math.max(0, d - 1);
    const short = Math.max(0, P.snatch_cost - x.energy);
    const wait = P.regen > 0 ? Math.ceil(short / P.regen) : short > 0 ? Infinity : 0;
    if (wait === Infinity) return null;
    const n = cloneSim(x);
    const at = n.t + Math.max(reach, wait);
    n.energy = Math.min(100, x.energy + P.regen * (at - x.t)) - P.snatch_cost;
    n.t = at + 2;
    n.pos = r.pos;
    n.snatched = true;
    const item = mine[0]!;
    n.inv.push({ id: item.id, kind: item.kind, since: at + 1 });
    n.rival = { pos: r.pos, items: r.items.filter((i) => i.id !== item.id) };
    return { sim: n, id: item.id, pickup: at + 1, wp: { tile: r.pos, room: null, act: { kind: "SNATCH" } }, chance: mine.length / r.items.length, snatch: true };
  }

  /** Play one errand on a copy of `x`. Null when it cannot be completed before it expires. */
  apply(x: Sim, e: Errand): { next: Sim; step: RouteStep } | null {
    const k = this.k;
    if (e.type === "visit") {
      const tiles = k.roomTiles.get(e.room) ?? [];
      if (k.rooms[x.pos] === e.room) {
        const finish = x.t;
        if (finish < e.posted || finish >= e.expires) return null;
        const n = cloneSim(x);
        n.t += 1;
        return { next: n, step: { errand: e, finish, free: n.t, tile: -1, room: e.room, act: { kind: "WAIT" }, chance: 1 } };
      }
      let tile = -1;
      let td = Infinity;
      for (const i of tiles) {
        const d = this.dist(x, x.pos, i);
        if (d < td) {
          td = d;
          tile = i;
        }
      }
      if (tile < 0) tile = tiles[0] ?? -1;
      if (tile < 0) return null;
      const best = cloneSim(x);
      const w = { w: null as Waypoint | null };
      if (!this.goTo(best, tile, w, { kind: "WAIT" })) return null;
      const bestWp = w.w;
      if (!best || !bestWp) return null;
      const finish = best.t - 1;
      if (finish < e.posted || finish >= e.expires) return null;
      // Walking into the room is the waypoint, unless the route starts by fetching the key.
      const wp: Waypoint = bestWp.act.kind === "TAKE" ? bestWp : { tile: -1, room: e.room, act: { kind: "WAIT" } };
      return { next: best, step: { errand: e, finish, free: best.t, tile: wp.tile, room: wp.room, act: wp.act, chance: 1 } };
    }
    const held = x.inv.find((i) => i.kind === e.item_kind);
    if (e.type === "carry") {
      if (held) return null; // completes by holding; counted as passive
      let best: { next: Sim; step: RouteStep } | null = null;
      for (const src of this.sources(x, e.item_kind)) {
        const finish = Math.max(src.pickup, e.posted) + e.carry_ticks - 1;
        if (finish >= e.expires || !src.wp) continue;
        if (src.snatch && !(this.snatchGate && this.snatchGate(e, src.pickup, finish))) continue;
        if (!best || this.worth(src.chance, finish, x.t) > this.worth(best.step.chance, best.step.finish, x.t)) best = { next: src.sim, step: { errand: e, finish, free: src.sim.t, tile: src.wp.tile, room: src.wp.room, act: src.wp.act, chance: src.chance } };
      }
      return best;
    }
    const f = k.fixtureIdx.get(e.fixture);
    if (f === undefined) return null;
    const branches: { sim: Sim; id: string; wp: Waypoint | null; chance: number; snatch?: true; pickup?: number }[] = held ? [{ sim: cloneSim(x), id: held.id, wp: null, chance: 1 }] : this.sources(x, e.item_kind);
    let best: { next: Sim; step: RouteStep } | null = null;
    for (const b of branches) {
      const n = b.sim;
      const wp = { w: b.wp };
      if (!this.goTo(n, f, wp, { kind: "USE", item: b.id })) continue;
      const idx = n.inv.findIndex((i) => i.id === b.id);
      if (idx < 0) continue;
      const finish = n.t;
      if (finish < e.posted || finish >= e.expires || !wp.w) continue;
      if (b.snatch && !(this.snatchGate && this.snatchGate(e, b.pickup ?? finish, finish))) continue;
      n.inv.splice(idx, 1);
      n.t += 1;
      if (!best || this.worth(b.chance, finish, x.t) > this.worth(best.step.chance, best.step.finish, x.t)) best = { next: n, step: { errand: e, finish, free: n.t, tile: wp.w.tile, room: wp.w.room, act: wp.w.act, chance: b.chance } };
    }
    return best;
  }

  /** How much a way of doing an errand is worth per unit of value: its chance, discounted by its finishing time. */
  private worth(chance: number, finish: number, from: number): number {
    return chance * Math.pow(this.opts.gamma, finish - from);
  }

  /** Carries that would complete by holding, from the end state of a branch. */
  passiveCarries(x: Sim, open: readonly Errand[], skip: ReadonlySet<number>): { errand: Errand; finish: number }[] {
    const out: { errand: Errand; finish: number }[] = [];
    for (const e of open) {
      if (e.type !== "carry" || skip.has(e.id)) continue;
      let since = Infinity;
      for (const i of x.inv) if (i.kind === e.item_kind && i.since < since) since = i.since;
      if (since === Infinity) continue;
      const finish = Math.max(since, e.posted) + e.carry_ticks - 1;
      if (finish < e.expires) out.push({ errand: e, finish });
    }
    return out;
  }

  /** Beam search from `root` over `errands` (the open errands of `s` by default). */
  search(s: StateMsg, root: Sim, discount: Discount | null = null, errands: readonly Errand[] = openErrands(s)): Route {
    const { beam, depth, gamma, holdValue } = this.opts;
    const now = s.tick;
    const val = (e: Errand, finish: number) => e.value * (discount ? discount(e, finish) : 1) * Math.pow(gamma, Math.max(0, finish - now));
    interface Node {
      sim: Sim;
      steps: RouteStep[];
      used: Set<number>;
    }
    const evaluate = (n: Node): { score: number; passive: Route["passive"] } => {
      let score = 0;
      for (const st of n.steps) {
        // A carry in the sequence only counts if its item is still held at the end.
        if (st.errand.type === "carry" && !n.sim.inv.some((i) => i.kind === (st.errand as { item_kind: ItemKind }).item_kind)) continue;
        score += val(st.errand, st.finish) * st.chance;
      }
      const passive = this.passiveCarries(n.sim, errands, n.used);
      for (const p of passive) score += val(p.errand, p.finish);
      const left = this.opts.holdDecay ? Math.max(0, this.k.params.max_tick - n.sim.t) / this.k.params.max_tick : 1;
      score += holdValue * left * n.sim.inv.filter((i) => i.kind !== "key").length;
      return { score, passive };
    };
    const rootNode: Node = { sim: root, steps: [], used: new Set() };
    const r0 = evaluate(rootNode);
    let best: Route = { steps: [], score: r0.score, passive: r0.passive };
    let frontier: Node[] = [rootNode];
    for (let d = 0; d < depth; d++) {
      const children: { node: Node; score: number; passive: Route["passive"] }[] = [];
      for (const node of frontier) {
        for (const e of errands) {
          if (node.used.has(e.id)) continue;
          const r = this.apply(node.sim, e);
          if (!r) continue;
          const used = new Set(node.used);
          used.add(e.id);
          const child: Node = { sim: r.next, steps: [...node.steps, r.step], used };
          const ev = evaluate(child);
          children.push({ node: child, score: ev.score, passive: ev.passive });
        }
      }
      if (children.length === 0) break;
      children.sort((a, b) => b.score - a.score || cmpSteps(a.node.steps, b.node.steps));
      const kept = children.slice(0, beam);
      if (kept[0]!.score > best.score) best = { steps: kept[0]!.node.steps, score: kept[0]!.score, passive: kept[0]!.passive };
      frontier = kept.map((c) => c.node);
    }
    return best;
  }

  /** The move for the first waypoint of a step, from `pos`. */
  moveFor(pos: number, hasKey: boolean, step: Pick<RouteStep, "tile" | "room" | "act">): Intent {
    if (step.room) {
      const d = this.k.stepTowardRoom(pos, step.room, hasKey);
      return d ? { kind: "MOVE", dir: d } : { kind: "WAIT" };
    }
    if (pos === step.tile) return step.act;
    const d = this.k.stepToward(pos, step.tile, hasKey);
    return d ? { kind: "MOVE", dir: d } : { kind: "WAIT" };
  }
}

/** Deterministic tie-break between sequences: lower errand ids first, position by position. */
function cmpSteps(a: readonly RouteStep[], b: readonly RouteStep[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i]!.errand.id !== b[i]!.errand.id) return a[i]!.errand.id - b[i]!.errand.id;
  return a.length - b.length;
}
