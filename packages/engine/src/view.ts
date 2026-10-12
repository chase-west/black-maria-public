import type {
  ChaosName,
  DecorView,
  Errand,
  ErrandState,
  FixtureView,
  GameEvent,
  HeldItem,
  ItemKind,
  ItemView,
  MapView,
  MatchEndMsg,
  MatchParams,
  MatchStartMsg,
  MariaView,
  Mode,
  Pos,
  Result,
  RoomName,
  StateMsg,
  Tier,
  Who,
  YouView,
} from "@blackmaria/protocol";
import { other, type AbsEvent, type Body, type MatchState } from "./types.js";

/** Project an absolute body onto a point of view. */
export function whoFor(pov: Body, b: Body): Who {
  return b === pov ? "you" : "maria";
}

function stateFor_(st: ErrandState, pov: Body): ErrandState {
  if (pov === "you") return st;
  return st === "done_by_you" ? "done_by_maria" : st === "done_by_maria" ? "done_by_you" : st;
}

/** One errand from a point of view (`done_by_you` is the receiving body). */
export function errandFor(e: Errand, pov: Body): Errand {
  return { ...e, state: stateFor_(e.state, pov) };
}

export function boardFor(state: MatchState, pov: Body): Errand[] {
  return state.board.map((e) => errandFor(e, pov));
}

/** Events for one body's point of view (SPEC 3.7). `moved` is only sent for the other body. */
export function eventsFor(state: MatchState, pov: Body): GameEvent[] {
  if (!state.last) return [];
  return projectEvents(state, state.last.events, pov);
}

export function projectEvents(state: Pick<MatchState, "board" | "items">, events: readonly AbsEvent[], pov: Body): GameEvent[] {
  const out: GameEvent[] = [];
  for (const e of events) {
    switch (e.kind) {
      case "posted":
        out.push({ kind: "posted", errand: errandFor({ ...state.board[e.errand]!, state: "open" }, pov) });
        break;
      case "completed":
        out.push({ kind: "completed", errand: e.errand, by: whoFor(pov, e.by) });
        break;
      case "expired":
        out.push({ kind: "expired", errand: e.errand });
        break;
      case "took":
      case "dropped":
      case "snatched":
        out.push({ kind: e.kind, by: whoFor(pov, e.by), item: e.item });
        break;
      case "delivered":
        out.push({ kind: "delivered", by: whoFor(pov, e.by), item: e.item, fixture: e.fixture });
        break;
      case "door_opened":
        out.push({ kind: "door_opened", pos: { ...e.pos } });
        break;
      case "safe_opened":
        out.push({ kind: "safe_opened", fixture: e.fixture, item: e.item });
        break;
      case "sigil":
        out.push({ kind: "sigil", owner: whoFor(pov, e.owner), energy_gained: e.energy_gained });
        break;
      case "moved":
        if (e.by !== pov) out.push({ kind: "moved", by: whoFor(pov, e.by), dir: e.dir });
        break;
      case "winding_up":
        out.push({ kind: "winding_up", by: whoFor(pov, e.by) });
        break;
      case "returned":
        out.push({ kind: "returned", item: e.item, item_kind: state.items.find((i) => i.id === e.item)!.kind, pos: { ...e.pos } });
        break;
    }
  }
  return out;
}

export function mapView(state: MatchState): MapView {
  return { w: state.map.w, h: state.map.h, tiles: state.map.tiles.map((r) => r.slice()), rooms: state.map.rooms.map((r) => r.slice()) };
}

export function fixturesView(state: MatchState): FixtureView[] {
  return state.fixtures.map((f) => ({ id: f.id, kind: f.kind, pos: { ...f.pos } }));
}

/** Items on the floor, by id. */
export function itemsView(state: MatchState): ItemView[] {
  const out: ItemView[] = [];
  for (const i of state.items) if (i.loc.at === "tile") out.push({ id: i.id, kind: i.kind, pos: { ...i.loc.pos } });
  return out;
}

export function decorView(state: MatchState): DecorView[] {
  return state.map.decor.map((d) => ({ kind: d.kind, pos: { ...d.pos } }));
}

/** Items inside a closed safe. */
export function safeItemsView(state: MatchState): { id: string; kind: ItemKind; fixture: string }[] {
  const out: { id: string; kind: ItemKind; fixture: string }[] = [];
  for (const i of state.items) if (i.loc.at === "safe") out.push({ id: i.id, kind: i.kind, fixture: i.loc.fixture });
  return out;
}

export function heldView(state: MatchState, b: Body): HeldItem[] {
  return state.bodies[b].inventory.map((id) => ({ id, kind: state.items.find((i) => i.id === id)!.kind }));
}

export function youView(state: MatchState, pov: Body): YouView {
  const b = state.bodies[pov];
  return { pos: { ...b.pos }, inventory: heldView(state, pov), energy: b.energy };
}

export function mariaView(state: MatchState, pov: Body): MariaView {
  const o = other(pov);
  return { pos: { ...state.bodies[o].pos }, inventory: heldView(state, o) };
}

/** Sigils in row-major order (the order `sigil_owner` and `sigil_charge` use). */
export function sigilsRowMajor(state: MatchState): MatchState["sigils"] {
  return state.sigils.slice().sort((a, b) => a.pos.y - b.pos.y || a.pos.x - b.pos.x);
}

/** Owner of each sigil, in row-major order, from one body's point of view (SPEC 3.2). */
export function sigilOwners(state: MatchState, pov: Body): Who[] {
  return sigilsRowMajor(state).map((g) => whoFor(pov, g.owner));
}

/** Per sigil, row-major: 0 charged, otherwise ticks until charged. */
export function sigilCharge(state: MatchState): number[] {
  return sigilsRowMajor(state).map((g) => g.cooldown);
}

export function scoresFor(state: MatchState, pov: Body): { you: number; maria: number } {
  return { you: state.bodies[pov].score, maria: state.bodies[other(pov)].score };
}

/** Scores from the candidate's point of view. */
export function scores(state: MatchState): { you: number; maria: number } {
  return scoresFor(state, "you");
}

/** Result for the candidate (SPEC 3.8). */
export function resultFor(state: MatchState, pov: Body = "you"): Result {
  const s = scoresFor(state, pov);
  return s.you > s.maria ? "win" : s.you === s.maria ? "draw" : "loss";
}

export function roomNamesFor(state: MatchState): RoomName[] {
  return state.map.roomList.slice();
}

export interface StartMeta {
  match_id: string;
  mode: Mode;
  tier: Tier;
  tick_ms: number;
  chaos?: ChaosName;
  run_id?: string;
  run_index?: number;
}

export function paramsFor(state: MatchState, meta: { tick_ms: number; chaos?: ChaosName }): MatchParams {
  const p = state.params;
  return {
    max_tick: p.maxTick,
    tick_ms: meta.tick_ms,
    post_interval: p.postInterval,
    expiry_min: p.expiryMin,
    expiry_max: p.expiryMax,
    snatch_cost: p.snatchCost,
    regen: p.regen,
    energy_start: p.energyStart,
    inventory_slots: p.inventorySlots,
    return_ticks: p.returnTicks,
    chaos: meta.chaos ?? "off",
  };
}

const copy = (p: Pos): Pos => ({ x: p.x, y: p.y });

/** `match_start` for one body. From Maria's point of view, `start` is her tile and `maria_start` is yours. */
export function matchStartFor(state: MatchState, pov: Body, meta: StartMeta): MatchStartMsg {
  const mine = pov === "you" ? state.map.start : state.map.mariaStart;
  const theirs = pov === "you" ? state.map.mariaStart : state.map.start;
  const msg: MatchStartMsg = {
    type: "match_start",
    match_id: meta.match_id,
    mode: meta.mode,
    tier: meta.tier,
    params: paramsFor(state, meta),
    map: mapView(state),
    room_names: roomNamesFor(state),
    fixtures: fixturesView(state),
    items: itemsView(state),
    safe_items: safeItemsView(state),
    decor: decorView(state),
    start: copy(mine),
    maria_start: copy(theirs),
    sigil_owner: sigilOwners(state, pov),
    board: boardFor(state, pov),
    you: { energy: state.bodies[pov].energy },
  };
  if (meta.run_id !== undefined) msg.run_id = meta.run_id;
  if (meta.run_index !== undefined) msg.run_index = meta.run_index;
  return msg;
}

export function stateFor(state: MatchState, pov: Body, meta: { match_id: string; deadline_ms: number }): StateMsg {
  return {
    type: "state",
    match_id: meta.match_id,
    tick: state.tick,
    deadline_ms: meta.deadline_ms,
    you: youView(state, pov),
    maria: mariaView(state, pov),
    items: itemsView(state),
    board: boardFor(state, pov),
    doors_opened: state.doorsOpened.map(copy),
    safes_opened: state.safe && state.safe.open ? [state.safe.fixture] : [],
    sigil_charge: sigilCharge(state),
    scores: scoresFor(state, pov),
    events: eventsFor(state, pov),
  };
}

export function matchEndFor(state: MatchState, pov: Body, meta: { match_id: string; replay: string }): MatchEndMsg {
  return {
    type: "match_end",
    match_id: meta.match_id,
    result: resultFor(state, pov),
    scores: scoresFor(state, pov),
    board: boardFor(state, pov),
    replay: meta.replay,
    tick: state.tick,
    events: eventsFor(state, pov),
  };
}
