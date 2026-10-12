import type { ProfilerReport } from "./profiler.js";

/** BLACK MARIA JSON protocol types (SPEC 3, 5.1). Shared by the server, the clients, the web portal and engine views. */

export type Dir = "N" | "E" | "S" | "W";
export const DIRS: readonly Dir[] = ["N", "E", "S", "W"];

/** A move (SPEC 3.4). Ids 0 to 5 on the wire in this order: WAIT, MOVE, TAKE, DROP, USE, SNATCH. */
export type Intent =
  | { kind: "WAIT" }
  | { kind: "MOVE"; dir: Dir }
  | { kind: "TAKE" }
  | { kind: "DROP"; item: string }
  | { kind: "USE"; item: string }
  | { kind: "SNATCH" };
export type IntentKind = Intent["kind"];
export const INTENT_KINDS: readonly IntentKind[] = ["WAIT", "MOVE", "TAKE", "DROP", "USE", "SNATCH"];

export const TILE_KINDS = ["floor", "wall", "door", "door_locked", "sigil"] as const;
export type TileKind = (typeof TILE_KINDS)[number];

export const ROOM_NAMES = ["hall", "library", "study", "chapel", "cellar", "kitchen", "conservatory", "gallery", "nursery", "vault"] as const;
export type RoomName = (typeof ROOM_NAMES)[number];
export type RoomOrCorridor = RoomName | "corridor";

export const FIXTURE_KINDS = ["fireplace", "well", "safe", "altar", "piano", "mirror", "bookcase", "bed", "clock", "font", "stove"] as const;
export type FixtureKind = (typeof FIXTURE_KINDS)[number];

export const ITEM_KINDS = ["key", "letter", "candle", "locket", "ledger", "bottle", "coin", "ring", "photograph", "vial"] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

/** Decor props: purely visual and passable (SPEC 8.1). Ids 0 to 11 in this order on the wire. */
export const DECOR_KINDS = ["plant", "chair", "table_small", "stool", "crate", "barrel", "bookstack", "vase", "candelabra", "cushion", "rug_small", "cobweb"] as const;
export type DecorKind = (typeof DECOR_KINDS)[number];

export interface Pos {
  x: number;
  y: number;
}

/** Point of view: "you" is the receiving body, "maria" the other one. */
export type Who = "you" | "maria";

// ---------------------------------------------------------------------------
// The board (SPEC 3.5)

export const ERRAND_TYPES = ["deliver", "visit", "carry"] as const;
export type ErrandType = (typeof ERRAND_TYPES)[number];
/** Ids 0 to 3 on the wire in this order. `done_by_you` is the receiving body. */
export const ERRAND_STATES = ["open", "done_by_you", "done_by_maria", "expired"] as const;
export type ErrandState = (typeof ERRAND_STATES)[number];

interface ErrandBase {
  id: number;
  value: number;
  /** The first tick the errand is on the board. */
  posted: number;
  /** The first tick it is no longer open: it can be completed on ticks `posted` to `expires - 1`. */
  expires: number;
  state: ErrandState;
}
export type Errand =
  | (ErrandBase & { type: "deliver"; item_kind: ItemKind; fixture: string })
  | (ErrandBase & { type: "visit"; room: RoomName })
  | (ErrandBase & { type: "carry"; item_kind: ItemKind; carry_ticks: number });

// ---------------------------------------------------------------------------
// Events (SPEC 3.7)

export type GameEvent =
  | { kind: "posted"; errand: Errand }
  | { kind: "completed"; errand: number; by: Who }
  | { kind: "expired"; errand: number }
  | { kind: "took"; by: Who; item: string }
  | { kind: "dropped"; by: Who; item: string }
  | { kind: "delivered"; by: Who; item: string; fixture: string }
  | { kind: "snatched"; by: Who; item: string }
  | { kind: "door_opened"; pos: Pos }
  | { kind: "safe_opened"; fixture: string; item: string }
  | { kind: "sigil"; owner: Who; energy_gained: number }
  | { kind: "moved"; by: Who; dir: Dir }
  /** A snatch wound up this tick; the grab resolves next tick if the target is still in reach after movement. */
  | { kind: "winding_up"; by: Who }
  /** The house put a delivered item back on the floor, with a new id. */
  | { kind: "returned"; item: string; item_kind: ItemKind; pos: Pos };
export type EventKind = GameEvent["kind"];
export const EVENT_KINDS: readonly EventKind[] = ["posted", "completed", "expired", "took", "dropped", "delivered", "snatched", "door_opened", "safe_opened", "sigil", "moved", "winding_up", "returned"];

// ---------------------------------------------------------------------------
// Views

export interface ItemView {
  id: string;
  kind: ItemKind;
  pos: Pos;
}
export interface HeldItem {
  id: string;
  kind: ItemKind;
}
export interface FixtureView {
  id: string;
  kind: FixtureKind;
  pos: Pos;
}
export interface MapView {
  w: number;
  h: number;
  tiles: TileKind[][];
  rooms: RoomOrCorridor[][];
}
export interface DecorView {
  kind: DecorKind;
  pos: Pos;
}

export type Mode = "practice" | "official";
export type Tier = "novice" | "adept" | "master";
export const TIERS: readonly Tier[] = ["novice", "adept", "master"];
export type Result = "win" | "draw" | "loss";
export type ChaosName = "off" | Tier;

/** Every number a bot might depend on (SPEC 3.9). */
export interface MatchParams {
  max_tick: number;
  tick_ms: number;
  post_interval: number;
  expiry_min: number;
  expiry_max: number;
  snatch_cost: number;
  regen: number;
  energy_start: number;
  inventory_slots: number;
  /** Ticks after delivery before a delivered item returns to the floor (SPEC 3.3). */
  return_ticks: number;
  /** The chaos profile on this match's link: off, or a tier's profile (SPEC 5.6). */
  chaos: ChaosName;
}

export interface YouView {
  pos: Pos;
  inventory: HeldItem[];
  energy: number;
}
/** The other body. Everything except its energy (SPEC 3.3). */
export interface MariaView {
  pos: Pos;
  inventory: HeldItem[];
}

// ---------------------------------------------------------------------------
// Client -> server

export interface HelloMsg {
  type: "hello";
  token?: string;
  name?: string;
}
export interface JoinMsg {
  type: "join";
  mode: Mode;
  tier?: Tier;
  /** Practice speed: 1, 2 or 4 times the practice tick (SPEC 8.4). */
  speed?: 1 | 2 | 4;
}
export interface IntentMsg {
  type: "intent";
  match_id: string;
  tick: number;
  intent: Intent;
}
export interface LeaveMsg {
  type: "leave";
  match_id: string;
}
/** Watch this token's live wire practice matches from the portal (SPEC 8, "a toggle to point the live view at a wire practice session"). */
export interface WatchMsg {
  type: "watch";
}
export type ClientMsg = HelloMsg | JoinMsg | IntentMsg | LeaveMsg | WatchMsg;

// ---------------------------------------------------------------------------
// Server -> client

export interface WelcomeMsg {
  type: "welcome";
  name: string;
  window: { opens: string; closes: string };
  attempts_left: number;
  /** Seconds left on your clock (SPEC 7). */
  seconds_left?: number;
  /** The change (1 to 3) once it has been revealed to you on the Official page, otherwise 0 (SPEC 2.2). */
  rule_change?: number;
}

export interface MatchStartMsg {
  type: "match_start";
  match_id: string;
  mode: Mode;
  tier: Tier;
  params: MatchParams;
  map: MapView;
  /** Rooms on the map in canonical order (the order wire room ids use). */
  room_names: RoomName[];
  fixtures: FixtureView[];
  /** Items on the floor. */
  items: ItemView[];
  /** Items inside a closed safe (SPEC 3.2). */
  safe_items: { id: string; kind: ItemKind; fixture: string }[];
  /** Visual props, passable, no effect on the game (SPEC 8.1). */
  decor: DecorView[];
  /** Your starting tile. */
  start: Pos;
  maria_start: Pos;
  /** Owner of each sigil tile, in row-major order (SPEC 3.2). */
  sigil_owner: Who[];
  /** The errands on the board at tick 0. */
  board: Errand[];
  you: { energy: number };
  /** Present when the match belongs to an official run. */
  run_id?: string;
  /** Index of this match within its official run (0 to 8). */
  run_index?: number;
}

export interface StateMsg {
  type: "state";
  match_id: string;
  /** The tick you are deciding. */
  tick: number;
  deadline_ms: number;
  you: YouView;
  maria: MariaView;
  /** Items on the floor. */
  items: ItemView[];
  /** Every errand ever posted, with its state. */
  board: Errand[];
  doors_opened: Pos[];
  /** Opened safes, by fixture id. */
  safes_opened: string[];
  /** Per sigil in row-major order: 0 charged, otherwise ticks until charged. */
  sigil_charge: number[];
  scores: { you: number; maria: number };
  /** What happened in the tick that just resolved. */
  events: GameEvent[];
}

export interface MatchEndMsg {
  type: "match_end";
  match_id: string;
  result: Result;
  scores: { you: number; maria: number };
  /** The final board. */
  board: Errand[];
  replay: string;
  /** Final tick count and the last tick's events, for renderers. */
  tick: number;
  events: GameEvent[];
}

export type ErrorCode =
  | "bad_json"
  | "bad_message"
  | "bad_intent"
  | "bad_token"
  | "not_authenticated"
  | "already_authenticated"
  | "stale_tick"
  | "duplicate_intent"
  | "unknown_match"
  | "rate_limited"
  | "too_many_concurrent"
  | "server_busy"
  | "window_closed"
  | "clock_expired"
  | "frame_too_large"
  | "internal";

export interface ErrorMsg {
  type: "error";
  code: ErrorCode;
  message: string;
  match_id?: string;
}

/** The profiler for a practice match, sent right after its `match_end` (SPEC 8.3). */
export interface ProfileMsg {
  type: "profile";
  match_id: string;
  report: ProfilerReport;
}

/** A wire practice match being watched from the portal: which tick each move made it for (SPEC 8, the health strip). */
export interface WireStatusMsg {
  type: "wire_status";
  match_id: string;
  strip: string;
  resyncs: Record<number, number>;
  /**
   * The connection panel: the newest ticks (the last 100 the first time a match is sent, then the last few, which
   * replace what came before for the same ticks), and the running totals. Only ever about your own matches.
   */
  conn?: ConnTick[];
  conn_totals?: ConnTotals;
}

/** What the network did to one packet: delivered after a delay, dropped, sent twice, held back, or lost in the blackout. */
export type ChaosFate = "clean" | "delayed" | "dropped" | "duplicated" | "reordered" | "blackout";
export interface PacketFate {
  fate: ChaosFate;
  /** ms added on the way (the first copy's), 0 when dropped. */
  delay: number;
}

/** One tick of the connection panel: what the chaos layer did to that tick's packets, and what became of your move. */
export interface ConnTick {
  tick: number;
  /** That tick's STATE on its way to you. Null when the server sent none. */
  state: PacketFate | null;
  /** Your first move for that tick on its way to the server. Null when none reached it. */
  move: PacketFate | null;
  /** The tick fell inside the blackout. */
  blackout: boolean;
  /** o on time, l late, m missing, x malformed. */
  you: string;
  /** For a tick with no move in time: how many ms after the deadline the first move came, or null if none came. */
  late_ms: number | null;
  resyncs: number;
}

/** The running totals beside the connection panel. */
export interface ConnTotals {
  ticks: number;
  /** Datagrams the chaos layer handled, both ways, and what it did to them. */
  packets: number;
  dropped: number;
  duplicated: number;
  reordered: number;
  blackout: number;
  delay_avg: number;
  delay_max: number;
  /** Your moves, as the server judged them. */
  on_time: number;
  late: number;
  missing: number;
  resyncs: number;
}

export type ServerMsg = WelcomeMsg | MatchStartMsg | StateMsg | MatchEndMsg | ErrorMsg | ProfileMsg | WireStatusMsg;

// ---------------------------------------------------------------------------
// Replays (SPEC 7)

/** One resolved tick, rendered. Reviewer frames add Maria's energy, her move and her point of view. */
export interface ReplayFrame {
  tick: number;
  you: YouView;
  maria: MariaView;
  items: ItemView[];
  board: Errand[];
  doors_opened: Pos[];
  safes_opened: string[];
  sigil_charge: number[];
  scores: { you: number; maria: number };
  events: GameEvent[];
  you_intent: Intent | null;
  /** Maria's executed moves are public (the `moved` event); her full move is shown to reviewers only. */
  maria_intent?: Intent | null;
  maria_energy?: number;
}

export type ChaosAction = "deliver" | "drop" | "duplicate" | "reorder" | "blackhole";
export interface ChaosEntryView {
  t: number;
  dir: "down" | "up";
  type: number;
  tick: number;
  action: ChaosAction;
  delay: number;
}

/** Wire quality of one match from its replay (SPEC 9): shown beside the score, never folded into it. */
export interface WireQuality {
  ticks: number;
  on_time: number;
  late: number;
  missing: number;
  malformed: number;
  on_time_rate: number;
  resyncs: number;
  /** Master profile only: the ticks the 400 ms blackhole covered and the two after it. */
  blackhole: { tick: number; ticks: number; on_time: number; survived: boolean } | null;
}

/** One tick of the reviewer's chaos timeline: what the network did to that tick's datagrams, and the move's fate. */
export interface ChaosTick {
  tick: number;
  down: { drop: number; reorder: number; duplicate: number; delay_max: number };
  up: { drop: number; reorder: number; duplicate: number; delay_max: number };
  blackhole: boolean;
  /** o on time, l late, m missing, x malformed. */
  move: string;
  resyncs: number;
}

export interface ReplayDoc {
  match_id: string;
  mode: Mode;
  tier: Tier;
  seed?: number;
  params: MatchParams;
  map: MapView;
  room_names: RoomName[];
  fixtures: FixtureView[];
  decor: DecorView[];
  start: Pos;
  maria_start: Pos;
  sigil_owner: Who[];
  sigils: Pos[];
  /** `local` is the simulator's in-process runner. */
  transport: "ws" | "wire" | "local";
  /** One character per resolved tick: o on time, l late, m missing, x malformed (the wire health strip). */
  intent_status: string;
  /** Resyncs answered, by tick. */
  resyncs: Record<number, number>;
  /** Reviewer only: every chaos-layer action on this match's datagrams. */
  chaos?: ChaosEntryView[];
  chaos_profile?: string | null;
  /** Reviewer only, wire matches: the chaos log folded per tick, and the wire quality numbers. */
  chaos_timeline?: ChaosTick[];
  wire_quality?: WireQuality;
  /** Wire matches, for you and reviewers: the connection panel for every tick, and its totals. */
  conn_timeline?: ConnTick[];
  conn_totals?: ConnTotals;
  result: Result | null;
  scores: { you: number; maria: number } | null;
  frames: ReplayFrame[];
  reviewer: boolean;
}

/** Short aliases used by clients. */
export type MatchStart = MatchStartMsg;
export type State = StateMsg;
export type MatchEnd = MatchEndMsg;
