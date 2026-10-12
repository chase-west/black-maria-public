/** Wire protocol types (SPEC 5.2 to 5.5). Every field is a fixed-width little-endian integer. */

export const MAGIC = 0xb1;
export const HEADER_BYTES = 12;
export const MAX_DATAGRAM = 1200;
export const MAX_FRAGMENT = 1000;
/** A reassembled match blob may span at most this many fragments. */
export const MAX_FRAGMENTS = 16;
export const KEYFRAME = 0xffff;
export const NONE8 = 0xff;
export const NONE16 = 0xffff;
export const CORRIDOR = 0xff;
/** The largest inventory the wire carries (the engine's `inventory_slots` is at most 12). */
export const MAX_INVENTORY = 12;

export const PT = {
  HELLO: 0x01,
  INTENT: 0x02,
  RESYNC: 0x03,
  PING: 0x04,
  ACK_FRAG: 0x05,
  LEAVE: 0x06,
  HELLO_ACK: 0x81,
  MATCH_START: 0x82,
  STATE: 0x83,
  MATCH_END: 0x84,
  PONG: 0x85,
  ERROR: 0x86,
} as const;
export type PacketName = keyof typeof PT;
export type PacketType = (typeof PT)[PacketName];
export const CLIENT_TYPES: ReadonlySet<number> = new Set([PT.HELLO, PT.INTENT, PT.RESYNC, PT.PING, PT.ACK_FRAG, PT.LEAVE]);
export const SERVER_TYPES: ReadonlySet<number> = new Set([PT.HELLO_ACK, PT.MATCH_START, PT.STATE, PT.MATCH_END, PT.PONG, PT.ERROR]);

/** ERROR codes (SPEC 5.4), each with the sentence the server sends. */
export const ERR = {
  BAD_TOKEN: 1,
  CLOCK_EXPIRED: 2,
  NO_ATTEMPTS: 3,
  RATE_LIMITED: 4,
  BAD_INTENT: 5,
  UNKNOWN_MATCH: 6,
  SESSION_CLOSED: 7,
} as const;
export type ErrCode = (typeof ERR)[keyof typeof ERR];
export const ERROR_TEXT: Record<ErrCode, string> = {
  1: "Unknown token. Use the token from your magic link.",
  2: "Time's up. Practice and the official run are closed.",
  3: "You've used your official run. Start a practice session instead.",
  4: "Too many datagrams. Slow down and retry in a second.",
  5: "That move was late or malformed, so you did WAIT. Send moves before the deadline.",
  6: "No live match with that id on this session. Wait for MATCH_START.",
  7: "This session is closed. Send HELLO to open a new one.",
};

export const MODE = { PRACTICE: 0, OFFICIAL: 1 } as const;
export const TIER_ID = { novice: 0, adept: 1, master: 2 } as const;
export const TIER_NAMES = ["novice", "adept", "master"] as const;
/** The `chaos` byte in HELLO and in the match parameters: 0 off, 1..3 a tier's profile. */
export const CHAOS_NAMES = ["off", "novice", "adept", "master"] as const;
export const INTENT_KIND = { WAIT: 0, MOVE: 1, TAKE: 2, DROP: 3, USE: 4, SNATCH: 5 } as const;
export const INTENT_NAMES = ["WAIT", "MOVE", "TAKE", "DROP", "USE", "SNATCH"] as const;
export const DIR_NAMES = ["N", "E", "S", "W"] as const;
export const EVENT_KIND = {
  posted: 0,
  completed: 1,
  expired: 2,
  took: 3,
  dropped: 4,
  delivered: 5,
  snatched: 6,
  door_opened: 7,
  safe_opened: 8,
  sigil: 9,
  moved: 10,
  winding_up: 11,
  returned: 12,
} as const;
/** `by` and `owner` fields: from the receiving body's point of view. */
export const WHO = { you: 0, maria: 1 } as const;
export const RESULT = { loss: 0, draw: 1, win: 2 } as const;

/** STATE mask bits (SPEC 5.5). */
export const MASK = {
  you: 1 << 0,
  maria: 1 << 1,
  inventories: 1 << 2,
  items: 1 << 3,
  board: 1 << 4,
  doors: 1 << 5,
  safesAndSigils: 1 << 6,
  events: 1 << 7,
} as const;

export interface Header {
  type: number;
  session: number;
  seq: number;
  ack: number;
}

/** Errand record, 14 bytes (SPEC 5.4). `state` is from the receiver's point of view: 0 open, 1 done by you, 2 done by Maria, 3 expired. */
export interface ErrandRecord {
  id: number;
  /** 0 deliver, 1 visit, 2 carry. */
  type: number;
  /** Item kind id, or 0xFF. */
  itemKind: number;
  /** Fixture id, or 0xFFFF. */
  fixture: number;
  /** Room id (index into `room_names`), or 0xFF. */
  room: number;
  /** n for a carry, 0 otherwise. */
  carryTicks: number;
  value: number;
  posted: number;
  expires: number;
  state: number;
}
export const ERRAND_RECORD_BYTES = 14;

export interface WireIntent {
  kind: number;
  dir: number;
  item: number;
}

export interface WireItem {
  id: number;
  kind: number;
  x: number;
  y: number;
}

export interface XY {
  x: number;
  y: number;
}

export type WireEvent =
  | { kind: "posted"; errand: ErrandRecord }
  | { kind: "completed"; id: number; by: number }
  | { kind: "expired"; id: number }
  | { kind: "took"; by: number; item: number }
  | { kind: "dropped"; by: number; item: number }
  | { kind: "delivered"; by: number; item: number; fixture: number }
  | { kind: "snatched"; by: number; item: number }
  | { kind: "door_opened"; x: number; y: number }
  | { kind: "safe_opened"; fixture: number; item: number }
  | { kind: "sigil"; owner: number; energy: number }
  | { kind: "moved"; by: number; dir: number }
  | { kind: "winding_up"; by: number }
  | { kind: "returned"; item: number; itemKind: number; x: number; y: number };

/** The STATE payload after its fixed fields. A field is undefined when its mask bit is clear. */
export interface StateFields {
  you?: { x: number; y: number; energy: number };
  maria?: XY;
  inventories?: { you: number[]; maria: number[] };
  items?: WireItem[];
  board?: ErrandRecord[];
  doors?: XY[];
  safesAndSigils?: { safes: number[]; sigils: [number, number] };
  events?: WireEvent[];
}

export type Packet =
  | { type: "HELLO"; token: Uint8Array; mode: number; tier: number; chaos: number }
  | { type: "INTENT"; match: number; tick: number; intent: WireIntent }
  | { type: "RESYNC"; match: number }
  | { type: "PING"; clientMs: number }
  | { type: "ACK_FRAG"; match: number; frag: number }
  | { type: "LEAVE"; match: number }
  | { type: "HELLO_ACK"; session: number; attemptsLeft: number; clockS: number; ruleChange: number }
  | { type: "MATCH_START"; match: number; frag: number; fragCount: number; data: Uint8Array }
  | ({ type: "STATE"; match: number; tick: number; base: number; deadlineMs: number } & StateFields)
  | { type: "MATCH_END"; match: number; result: number; scoreYou: number; scoreMaria: number }
  | { type: "PONG"; clientMs: number; serverMs: number }
  | { type: "ERROR"; code: number; msg: string };

export interface Datagram {
  session: number;
  seq: number;
  ack: number;
  packet: Packet;
}

/** Match parameters as the blob carries them (SPEC 5.4, 3.9). */
export interface WireParams {
  maxTick: number;
  tickMs: number;
  postInterval: number;
  expiryMin: number;
  expiryMax: number;
  snatchCost: number;
  regen: number;
  energyStart: number;
  inventorySlots: number;
  returnTicks: number;
  /** 0 off, 1 novice, 2 adept, 3 master. */
  chaos: number;
}

/** The reassembled MATCH_START payload (SPEC 5.4). */
export interface MatchBlob {
  tier: number;
  seedHint: number;
  w: number;
  h: number;
  /** w*h tile kind ids, row-major. */
  tiles: Uint8Array;
  /** w*h room ids by `roomNames` order, 0xFF for corridor. */
  rooms: Uint8Array;
  roomNames: string[];
  /** Owners of the first and second sigil in row-major order: 0 you, 1 maria. */
  sigilOwner: [number, number];
  params: WireParams;
  mariaStart: XY;
  /** The errands on the board at tick 0. */
  board: ErrandRecord[];
  fixtures: { id: number; kind: number; x: number; y: number; flags: number }[];
  items: { id: number; kind: number; x: number; y: number; flags: number }[];
  start: XY;
  /** Visual props: kind id (DECOR_KINDS order), x, y. After `start` (SPEC 8.1). */
  decor: { kind: number; x: number; y: number }[];
}
