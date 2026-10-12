import type { Params } from "./rules.js";
import type { DecorKind, Dir, Errand, FixtureKind, Intent, ItemKind, Pos, RoomName, RoomOrCorridor, TileKind } from "@blackmaria/protocol";

/** Absolute body identity inside the engine. "you" is always the candidate. */
export type Body = "you" | "maria";
export const BODIES: readonly Body[] = ["you", "maria"];
export const other = (b: Body): Body => (b === "you" ? "maria" : "you");

export interface GameMap {
  w: number;
  h: number;
  /** tiles[y][x]. Static for the whole match; opened doors are tracked in `MatchState.doorsOpened`. */
  tiles: TileKind[][];
  rooms: RoomOrCorridor[][];
  /** Rooms present, in canonical order. */
  roomList: RoomName[];
  /** Your start: the center of the hall. */
  start: Pos;
  /** Maria's start: the hall tile farthest from yours. */
  mariaStart: Pos;
  vaultDoor: Pos;
  /** Visual props, passable, no effect on the rules (SPEC 8.1). */
  decor: { kind: DecorKind; pos: Pos }[];
}

export interface Fixture {
  id: string;
  kind: FixtureKind;
  pos: Pos;
  room: RoomName;
}

export type ItemLoc =
  | { at: "tile"; pos: Pos }
  | { at: "held"; by: Body }
  | { at: "safe"; fixture: string }
  /** Delivered while resolving `tick`; the house puts it back `returnTicks` later unless it is the key or came from the safe. */
  | { at: "delivered"; fixture: string; tick: number }
  | { at: "consumed" };

export interface Item {
  id: string;
  kind: ItemKind;
  loc: ItemLoc;
  /** The item that started inside the safe. It does not return after delivery (SPEC 3.3). */
  fromSafe?: true;
}

export interface Sigil {
  pos: Pos;
  room: RoomName;
  owner: Body;
  /** Ticks until charged. 0 means charged. */
  cooldown: number;
}

export interface BodyState {
  pos: Pos;
  /** Item ids, in pickup order. */
  inventory: string[];
  energy: number;
  score: number;
  /** Per item kind: consecutive ticks this body has ended holding at least one item of that kind. */
  streak: Partial<Record<ItemKind, number>>;
}

/** Engine-internal event, in absolute terms. Projected to a point of view by `view.ts`. */
export type AbsEvent =
  | { kind: "posted"; errand: number }
  | { kind: "completed"; errand: number; by: Body }
  | { kind: "expired"; errand: number }
  | { kind: "took"; by: Body; item: string }
  | { kind: "dropped"; by: Body; item: string }
  | { kind: "delivered"; by: Body; item: string; fixture: string }
  | { kind: "snatched"; by: Body; item: string }
  | { kind: "door_opened"; pos: Pos }
  | { kind: "safe_opened"; fixture: string; item: string }
  | { kind: "sigil"; owner: Body; energy_gained: number }
  | { kind: "moved"; by: Body; dir: Dir }
  | { kind: "winding_up"; by: Body }
  | { kind: "returned"; item: string; pos: Pos };

/** What happened in the last resolved tick, for replays, renderers and tests. */
export interface TickRecord {
  tick: number;
  submitted: Record<Body, Intent>;
  /** The body that won this tick's ties: the one with less energy at the start of the tick, or the coin. */
  priority: Body;
  events: AbsEvent[];
}

export interface MatchState {
  ruleset: string;
  seed: number;
  params: Params;
  /** The next tick to resolve. Starts at 0; the match ends when it reaches `params.maxTick`. */
  tick: number;
  map: GameMap;
  mapHash: string;
  fixtures: Fixture[];
  items: Item[];
  /** The safe fixture id and whether it is open, if the map has a safe. */
  safe: { fixture: string; open: boolean } | null;
  bodies: Record<Body, BodyState>;
  /**
   * Every errand ever posted, in id order. `state` is absolute: `done_by_you` means the candidate.
   * Ids are dense: errand n is `board[n]`.
   */
  board: Errand[];
  doorsOpened: Pos[];
  sigils: Sigil[];
  /** The body that wound up a snatch last tick: its grab resolves this tick, after movement (SPEC 3.4). */
  pendingGrab: Body | null;
  last: TickRecord | null;
  done: boolean;
}

export interface Intents {
  you: Intent;
  maria: Intent;
}
