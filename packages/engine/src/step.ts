import type { Errand, Intent, ItemKind, Pos, TileKind } from "@blackmaria/protocol";
import { STREAM, postErrand } from "./board.js";
import { DELTA, compareItemIds, normalizeIntent } from "./intent.js";
import type { Rng } from "./prng.js";
import { RULES, lastPostTick } from "./rules.js";
import { BODIES, other, type AbsEvent, type Body, type BodyState, type Intents, type MatchState } from "./types.js";

const samePos = (a: Pos, b: Pos) => a.x === b.x && a.y === b.y;
const clampEnergy = (e: number) => Math.max(0, Math.min(RULES.energyMax, e));

/** Effective tile kind, accounting for doors opened during the match. Null off the map. */
export function tileAt(state: MatchState, p: Pos): TileKind | null {
  if (p.x < 0 || p.y < 0 || p.x >= state.map.w || p.y >= state.map.h) return null;
  const t = state.map.tiles[p.y]![p.x]!;
  if (t === "door_locked" && state.doorsOpened.some((d) => samePos(d, p))) return "door";
  return t;
}

function cloneBody(b: BodyState): BodyState {
  return { pos: { ...b.pos }, inventory: b.inventory.slice(), energy: b.energy, score: b.score, streak: { ...b.streak } };
}

/** Copy the mutable parts of a state. The map and fixtures are immutable and shared. */
export function cloneState(s: MatchState): MatchState {
  return {
    ...s,
    items: s.items.map((i) => ({ ...i, loc: { ...i.loc } as typeof i.loc })),
    safe: s.safe ? { ...s.safe } : null,
    bodies: { you: cloneBody(s.bodies.you), maria: cloneBody(s.bodies.maria) },
    board: s.board.map((e) => ({ ...e })),
    doorsOpened: s.doorsOpened.map((d) => ({ ...d })),
    sigils: s.sigils.map((g) => ({ ...g, pos: { ...g.pos } })),
  };
}

/** Manhattan distance at most 1: the same tile or a neighbor (SPEC 3.4, `SNATCH`). */
export function inReach(a: Pos, b: Pos): boolean {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) <= 1;
}

/**
 * The body that wins this tick's ties: the one with less energy at the start of the tick; if both have the same
 * energy, a coin drawn from the seed (SPEC 3.4, 3.5).
 */
export function priorityOf(state: MatchState, rng: Rng): Body {
  const a = state.bodies.you.energy;
  const b = state.bodies.maria.energy;
  if (a !== b) return a < b ? "you" : "maria";
  return (rng.u32(state.tick, STREAM.coin) & 1) === 0 ? "you" : "maria";
}

function kindOf(s: MatchState, id: string): ItemKind {
  return s.items.find((i) => i.id === id)!.kind;
}

/**
 * Resolve one tick (SPEC 3.4 to 3.6). Pure: returns a new state and never mutates its input.
 * `intents` are the moves as submitted; anything malformed is treated as WAIT.
 *
 * Order: MOVE for both; last tick's pending grab; TAKE for both; DROP for both; USE for both; new SNATCH wind-ups;
 * then sigils, regen, the board (completions, then expiries), the house putting delivered items back, posting for the
 * next tick; then the match end.
 */
export function step(state: MatchState, intents: Intents, rng: Rng): MatchState {
  if (state.done) return state;
  const s = cloneState(state);
  const t = state.tick;
  const P = s.params;
  const sub: Record<Body, Intent> = { you: normalizeIntent(intents.you), maria: normalizeIntent(intents.maria) };
  const energy0: Record<Body, number> = { you: state.bodies.you.energy, maria: state.bodies.maria.energy };
  const prio = priorityOf(state, rng);
  const events: AbsEvent[] = [];
  const holding = (b: Body, id: string) => s.bodies[b].inventory.includes(id);

  // 1. MOVE, both bodies against the map only. Bodies never block each other.
  for (const b of BODIES) {
    const m = sub[b];
    if (m.kind !== "MOVE") continue;
    const body = s.bodies[b];
    const d = DELTA[m.dir];
    const to = { x: body.pos.x + d.x, y: body.pos.y + d.y };
    const tile = tileAt(s, to);
    if (tile === null || tile === "wall") continue;
    if (tile === "door_locked") {
      const key = body.inventory.find((id) => kindOf(s, id) === "key");
      if (key) {
        s.doorsOpened.push({ ...to });
        consume(s, b, key);
        events.push({ kind: "door_opened", pos: { ...to } });
      }
      continue;
    }
    body.pos = to;
    events.push({ kind: "moved", by: b, dir: m.dir });
  }

  // 2. The grab of last tick's wind-up: if the target is still on the grabber's tile or a neighbor after both moved,
  //    one of its items (chosen by seed) changes hands. Otherwise nothing happens; the energy was spent at the wind-up.
  const grabber = s.pendingGrab;
  s.pendingGrab = null;
  if (grabber) {
    const me = s.bodies[grabber];
    const them = s.bodies[other(grabber)];
    if (inReach(me.pos, them.pos) && them.inventory.length > 0 && me.inventory.length < P.inventorySlots) {
      const id = them.inventory[rng.u32(t, STREAM.snatchPick) % them.inventory.length]!;
      them.inventory.splice(them.inventory.indexOf(id), 1);
      me.inventory.push(id);
      s.items.find((i) => i.id === id)!.loc = { at: "held", by: grabber };
      events.push({ kind: "snatched", by: grabber, item: id });
    }
  }

  // 3. TAKE. Two bodies taking on one tile alternate, starting with the priority body.
  const takers = BODIES.filter((b) => sub[b].kind === "TAKE");
  const take = (b: Body, id: string) => {
    s.items.find((i) => i.id === id)!.loc = { at: "held", by: b };
    s.bodies[b].inventory.push(id);
    events.push({ kind: "took", by: b, item: id });
  };
  const floorAt = (p: Pos) =>
    s.items
      .filter((i) => i.loc.at === "tile" && samePos(i.loc.pos, p))
      .map((i) => i.id)
      .sort(compareItemIds);
  const full = (b: Body) => s.bodies[b].inventory.length >= P.inventorySlots;
  if (takers.length === 2 && samePos(s.bodies.you.pos, s.bodies.maria.pos)) {
    const queue = floorAt(s.bodies.you.pos);
    let turn: Body = prio;
    for (const id of queue) {
      if (full(turn)) turn = other(turn);
      if (full(turn)) break;
      take(turn, id);
      turn = other(turn);
    }
  } else {
    for (const b of takers) for (const id of floorAt(s.bodies[b].pos)) if (!full(b)) take(b, id);
  }

  // 4. DROP.
  for (const b of BODIES) {
    const m = sub[b];
    if (m.kind !== "DROP" || !holding(b, m.item)) continue;
    const inv = s.bodies[b].inventory;
    inv.splice(inv.indexOf(m.item), 1);
    s.items.find((i) => i.id === m.item)!.loc = { at: "tile", pos: { ...s.bodies[b].pos } };
    events.push({ kind: "dropped", by: b, item: m.item });
  }

  // 5. USE. A key on a closed safe opens it; anything else is delivered to the fixture and leaves the world.
  const deliveries: { by: Body; kind: ItemKind; fixture: string }[] = [];
  for (const b of BODIES) {
    const m = sub[b];
    if (m.kind !== "USE" || !holding(b, m.item)) continue;
    const pos = s.bodies[b].pos;
    const fx = s.fixtures.find((f) => samePos(f.pos, pos));
    if (!fx) continue;
    const it = s.items.find((i) => i.id === m.item)!;
    if (fx.kind === "safe" && s.safe && s.safe.fixture === fx.id && !s.safe.open && it.kind === "key") {
      s.safe.open = true;
      consume(s, b, it.id);
      const inside = s.items.find((i) => i.loc.at === "safe" && i.loc.fixture === fx.id);
      if (inside) inside.loc = { at: "tile", pos: { ...fx.pos } };
      events.push({ kind: "safe_opened", fixture: fx.id, item: inside?.id ?? "" });
      continue;
    }
    const inv = s.bodies[b].inventory;
    inv.splice(inv.indexOf(it.id), 1);
    it.loc = { at: "delivered", fixture: fx.id, tick: t };
    deliveries.push({ by: b, kind: it.kind, fixture: fx.id });
    events.push({ kind: "delivered", by: b, item: it.id, fixture: fx.id });
  }

  // 6. SNATCH wind-ups. Needs the other body on your tile or a neighbor and energy >= snatch_cost; otherwise a no-op
  //    with no cost. The energy is paid now and the grab resolves next tick. Two wind-ups: more energy at the start of
  //    the tick winds up, the other is a no-op; equal energy, the coin.
  const canWind = (b: Body) => sub[b].kind === "SNATCH" && inReach(s.bodies[b].pos, s.bodies[other(b)].pos) && s.bodies[b].energy >= P.snatchCost;
  const winders = BODIES.filter(canWind);
  let winder: Body | null = null;
  if (winders.length === 1) winder = winders[0]!;
  else if (winders.length === 2) winder = energy0.you > energy0.maria ? "you" : energy0.maria > energy0.you ? "maria" : prio;
  if (winder) {
    s.bodies[winder].energy -= P.snatchCost;
    s.pendingGrab = winder;
    events.push({ kind: "winding_up", by: winder });
  }

  // 7. Sigils: count down, then a charged sigil with a body on it pays its owner, whoever is standing there.
  for (const g of s.sigils) if (g.cooldown > 0) g.cooldown -= 1;
  for (const g of s.sigils) {
    if (g.cooldown !== 0 || !BODIES.some((b) => samePos(s.bodies[b].pos, g.pos))) continue;
    s.bodies[g.owner].energy = clampEnergy(s.bodies[g.owner].energy + RULES.sigilEnergy);
    g.cooldown = RULES.sigilRecharge;
    events.push({ kind: "sigil", owner: g.owner, energy_gained: RULES.sigilEnergy });
  }

  // 8. Regen.
  for (const b of BODIES) s.bodies[b].energy = clampEnergy(s.bodies[b].energy + P.regen);

  // 9. The board: carry streaks, completions, expiries.
  for (const b of BODIES) {
    const held = new Set(s.bodies[b].inventory.map((id) => kindOf(s, id)));
    const st = s.bodies[b].streak;
    for (const k of Object.keys(st) as ItemKind[]) if (!held.has(k)) delete st[k];
    for (const k of held) st[k] = (st[k] ?? 0) + 1;
  }
  const completes = (e: Errand, b: Body): boolean => {
    switch (e.type) {
      case "deliver":
        return deliveries.some((d) => d.by === b && d.kind === e.item_kind && d.fixture === e.fixture);
      case "visit": {
        const p = s.bodies[b].pos;
        return s.map.rooms[p.y]![p.x] === e.room;
      }
      case "carry":
        return Math.min(s.bodies[b].streak[e.item_kind] ?? 0, t - e.posted + 1) >= e.carry_ticks;
    }
  };
  for (const e of s.board) {
    if (e.state !== "open" || e.posted > t || t >= e.expires) continue;
    const who = BODIES.filter((b) => completes(e, b));
    if (who.length === 0) continue;
    const by = who.length === 1 ? who[0]! : prio;
    e.state = by === "you" ? "done_by_you" : "done_by_maria";
    s.bodies[by].score += e.value;
    events.push({ kind: "completed", errand: e.id, by });
  }
  for (const e of s.board) {
    if (e.state === "open" && e.expires <= t + 1) {
      e.state = "expired";
      events.push({ kind: "expired", errand: e.id });
    }
  }

  // 10. The house puts things back (SPEC 3.3): an item delivered `returnTicks` ago reappears with a new id on a floor
  //     tile, chosen by seed, in a room other than the one it was delivered in. Not the key, not the safe's item.
  let k = 0;
  const due = s.items.filter((i) => i.loc.at === "delivered" && i.loc.tick + P.returnTicks === t && i.kind !== "key" && !i.fromSafe);
  for (const it of due) {
    const fixture = (it.loc as { fixture: string }).fixture;
    const room = s.fixtures.find((f) => f.id === fixture)?.room;
    const tiles = returnTiles(s, room);
    if (tiles.length === 0) continue;
    const pos = tiles[rng.u32(t, STREAM.returnPick + k++) % tiles.length]!;
    const id = `i${s.items.length + 1}`;
    s.items.push({ id, kind: it.kind, loc: { at: "tile", pos: { ...pos } } });
    events.push({ kind: "returned", item: id, pos: { ...pos } });
  }

  // 11. Next tick, posting, and the end of the match.
  s.tick = t + 1;
  if (s.tick < P.maxTick && s.tick % P.postInterval === 0 && s.tick <= lastPostTick(P)) {
    const e = postErrand(s, s.tick, 0, rng);
    if (e) events.push({ kind: "posted", errand: e.id });
  }
  if (s.tick >= P.maxTick) {
    s.done = true;
    s.pendingGrab = null;
  }

  s.last = { tick: t, submitted: sub, priority: prio, events };
  return s;
}

/**
 * Where a returned item may land, in row-major order: floor tiles without a fixture, in a room (not a corridor, not the
 * Vault) other than `notRoom`.
 */
export function returnTiles(s: MatchState, notRoom: string | undefined): Pos[] {
  const out: Pos[] = [];
  const fx = new Set(s.fixtures.map((f) => f.pos.y * s.map.w + f.pos.x));
  for (let y = 0; y < s.map.h; y++)
    for (let x = 0; x < s.map.w; x++) {
      const r = s.map.rooms[y]![x]!;
      if (s.map.tiles[y]![x] !== "floor" || r === "corridor" || r === "vault" || r === notRoom || fx.has(y * s.map.w + x)) continue;
      out.push({ x, y });
    }
  return out;
}

/** Remove an item from a body's inventory and from the world (a key used on the Vault door or the safe). */
function consume(s: MatchState, b: Body, itemId: string): void {
  const inv = s.bodies[b].inventory;
  const i = inv.indexOf(itemId);
  if (i >= 0) inv.splice(i, 1);
  const it = s.items.find((x) => x.id === itemId);
  if (it) it.loc = { at: "consumed" };
}
