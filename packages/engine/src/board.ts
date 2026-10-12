import { ITEM_KINDS, type Errand, type ErrandType, type ItemKind, type Pos } from "@blackmaria/protocol";
import { compareFixtureIds } from "./intent.js";
import { distanceField } from "./paths.js";
import type { Rng } from "./prng.js";
import { RULES } from "./rules.js";
import type { Fixture, Item, MatchState } from "./types.js";

/** Random streams used by the engine. Each draw is `rng.u32(tick, stream)`, so `step` stays a pure function. */
export const STREAM = {
  /** The coin that breaks every tie in a tick when both bodies have the same energy. */
  coin: 1,
  /** Which item a snatch takes. */
  snatchPick: 2,
  /** Where a returned item lands: `returnPick + k` for the k-th return in a tick. */
  returnPick: 3,
  /** Errand posting: `post + slot * 16 + k` (k 0 type, 1 kind, 2 fixture, 3 carry kind, 4 carry length, 5 room, 6 expiry, 7 value). */
  post: 100,
} as const;

/** Where an item is, for distances: its tile, its holder's tile, or its safe's tile. Null once it is gone. */
export function itemPos(s: MatchState, it: Item): Pos | null {
  switch (it.loc.at) {
    case "tile":
      return it.loc.pos;
    case "held":
      return s.bodies[it.loc.by].pos;
    case "safe": {
      const fx = it.loc.fixture;
      return s.fixtures.find((f) => f.id === fx)?.pos ?? null;
    }
    default:
      return null;
  }
}

/** The key still exists (nobody has used it on the Vault door or the safe). */
export function keyInWorld(s: MatchState): boolean {
  return s.items.some((i) => i.kind === "key" && (i.loc.at === "tile" || i.loc.at === "held"));
}

export function vaultOpen(s: MatchState): boolean {
  const v = s.map.vaultDoor;
  return s.doorsOpened.some((d) => d.x === v.x && d.y === v.y);
}

/** The Vault can still be entered: its door is open, or the key that opens it still exists. */
export function vaultReachable(s: MatchState): boolean {
  return vaultOpen(s) || keyInWorld(s);
}

/** An item counts as in the world for the board (SPEC 3.5, feasibility): not delivered or used up, and gettable. */
export function itemAvailable(s: MatchState, it: Item): boolean {
  switch (it.loc.at) {
    case "tile": {
      const r = s.map.rooms[it.loc.pos.y]![it.loc.pos.x];
      return r !== "vault" || vaultReachable(s);
    }
    case "held":
      return true;
    case "safe":
      return keyInWorld(s);
    default:
      return false;
  }
}

export function fixtureReachable(s: MatchState, f: Fixture): boolean {
  return f.room !== "vault" || vaultReachable(s);
}

/** An errand's value from one draw: the type's inclusive range, independent of distance (SPEC 3.5). */
export function drawValue(range: readonly [number, number], draw: number): number {
  return range[0] + (draw % (range[1] - range[0] + 1));
}

const isOpen = (e: Errand) => e.state === "open";

/**
 * Draw one errand for posting at tick `posted`, from the state as it stands (SPEC 3.5). Pure. Returns null when no
 * errand of any type is feasible. The rules doc describes this function step by step.
 */
export function drawErrand(s: MatchState, posted: number, slot: number, rng: Rng): Errand | null {
  const u = (k: number) => rng.u32(posted, STREAM.post + slot * 16 + k);
  const draw = u(0) % RULES.typeDraw;
  const first: ErrandType = draw < RULES.deliverBelow ? "deliver" : draw < RULES.carryBelow ? "carry" : "visit";
  const order: ErrandType[] = [first, ...(["deliver", "carry", "visit"] as const).filter((t) => t !== first)];
  const p = s.params;
  const expires = posted + p.expiryMin + (u(6) % (p.expiryMax - p.expiryMin + 1));
  const id = s.board.length;
  const open = s.board.filter(isOpen);
  const available = s.items.filter((i) => i.kind !== "key" && itemAvailable(s, i));
  const kindsAvailable = ITEM_KINDS.filter((k) => available.some((i) => i.kind === k));

  for (const type of order) {
    if (type === "deliver") {
      const fixtures = s.fixtures.filter((f) => f.kind !== "safe" && fixtureReachable(s, f)).sort((a, b) => compareFixtureIds(a.id, b.id));
      const free = (k: ItemKind) => fixtures.filter((f) => !open.some((e) => e.type === "deliver" && e.item_kind === k && e.fixture === f.id));
      const kinds = kindsAvailable.filter((k) => free(k).length > 0);
      if (kinds.length === 0) continue;
      const kind = kinds[u(1) % kinds.length]!;
      const fields = available.filter((i) => i.kind === kind).map((i) => distanceField(s.map, itemPos(s, i)!, true));
      const near = (f: Fixture) => {
        let best = Infinity;
        for (const d of fields) {
          const v = d[f.pos.y * s.map.w + f.pos.x]!;
          if (v >= 0 && v < best) best = v;
        }
        return best;
      };
      const cands = free(kind).filter((f) => near(f) < Infinity);
      if (cands.length === 0) continue;
      const far = cands.filter((f) => near(f) >= RULES.deliverMinDistance);
      const pool = far.length ? far : cands;
      const f = pool[u(2) % pool.length]!;
      return { id, type: "deliver", item_kind: kind, fixture: f.id, value: drawValue(RULES.deliverValue, u(7)), posted, expires, state: "open" };
    }
    if (type === "carry") {
      const kinds = kindsAvailable.filter((k) => !open.some((e) => e.type === "carry" && e.item_kind === k));
      if (kinds.length === 0) continue;
      const kind = kinds[u(3) % kinds.length]!;
      const n = RULES.carryTicks[u(4) % RULES.carryTicks.length]!;
      return { id, type: "carry", item_kind: kind, carry_ticks: n, value: drawValue(RULES.carryValue, u(7)), posted, expires, state: "open" };
    }
    const reach = vaultReachable(s);
    const rooms = s.map.roomList.filter((r) => r !== "hall" && (r !== "vault" || reach) && !open.some((e) => e.type === "visit" && e.room === r));
    if (rooms.length === 0) continue;
    const room = rooms[u(5) % rooms.length]!;
    return { id, type: "visit", room, value: drawValue(RULES.visitValue, u(7)), posted, expires, state: "open" };
  }
  return null;
}

/** Post the errand for tick `posted` (and slot), if any is feasible. Mutates `s`. Returns the posted errand. */
export function postErrand(s: MatchState, posted: number, slot: number, rng: Rng): Errand | null {
  const e = drawErrand(s, posted, slot, rng);
  if (e) s.board.push(e);
  return e;
}
