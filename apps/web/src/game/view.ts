import type {
  ConnTick,
  ConnTotals,
  DecorView,
  Errand,
  FixtureView,
  GameEvent,
  Intent,
  ItemView,
  MapView,
  MariaView,
  MatchEndMsg,
  MatchParams,
  MatchStartMsg,
  Mode,
  Pos,
  ReplayDoc,
  RoomName,
  StateMsg,
  Tier,
  Who,
  YouView,
} from "@blackmaria/protocol";

/** A line under the board: what just happened, in the plain words of the rules. */
export interface Caption {
  tick: number;
  text: string;
  tone: Who | "plain";
  n: number;
}

/** Everything the renderer and the board need, folded from server messages or replay frames. No rules: bookkeeping. */
export interface View {
  matchId: string;
  tier: Tier;
  mode: Mode;
  params: MatchParams;
  map: MapView;
  roomNames: RoomName[];
  fixtures: FixtureView[];
  decor: DecorView[];
  start: Pos;
  mariaStart: Pos;
  /** Sigils in row-major order with their owners. */
  sigils: { pos: Pos; owner: Who }[];
  tick: number;
  you: YouView;
  maria: MariaView;
  items: ItemView[];
  board: Errand[];
  doorsOpened: Pos[];
  safesOpened: string[];
  sigilCharge: number[];
  scores: { you: number; maria: number };
  /** The events of the tick that produced this view. */
  events: GameEvent[];
  captions: Caption[];
  end: MatchEndMsg | null;
  /** Reviewer and replay fields. */
  mariaEnergy?: number;
  yourIntent?: Intent | null;
  mariaIntent?: Intent | null;
  /** The wire health strip: one character per resolved tick (o on time, l late, m missing, x malformed). */
  strip?: string;
  resyncs?: Record<number, number>;
  /** The connection panel: the newest ticks of your own wire match, and the totals. */
  conn?: ConnTick[];
  connTotals?: ConnTotals;
}

/** Sigil tiles in row-major order, paired with the owners from match start. */
function sigilsOf(map: MapView, owners: Who[]): View["sigils"] {
  const out: View["sigils"] = [];
  for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) if (map.tiles[y]![x] === "sigil") out.push({ pos: { x, y }, owner: owners[out.length] ?? "you" });
  return out;
}

export function fromStart(s: MatchStartMsg): View {
  const items = [...s.items];
  return {
    matchId: s.match_id,
    tier: s.tier,
    mode: s.mode,
    params: s.params,
    map: s.map,
    roomNames: s.room_names,
    fixtures: s.fixtures,
    decor: s.decor,
    start: s.start,
    mariaStart: s.maria_start,
    sigils: sigilsOf(s.map, s.sigil_owner),
    tick: 0,
    you: { pos: { ...s.start }, inventory: [], energy: s.you.energy },
    maria: { pos: { ...s.maria_start }, inventory: [] },
    items,
    board: s.board,
    doorsOpened: [],
    safesOpened: [],
    sigilCharge: sigilsOf(s.map, s.sigil_owner).map(() => 0),
    scores: { you: 0, maria: 0 },
    events: [],
    captions: [],
    end: null,
  };
}

const article = (word: string) => (/^[aeiou]/.test(word) ? "an" : "a");

/** An errand in a few plain words: "the letter to the fireplace", "the library", "a candle for 8 ticks". */
export function errandWords(v: Pick<View, "fixtures">, e: Errand): string {
  switch (e.type) {
    case "deliver": {
      const f = v.fixtures.find((x) => x.id === e.fixture);
      return `the ${e.item_kind} to the ${f?.kind ?? "fixture"}`;
    }
    case "visit":
      return `the ${e.room}`;
    case "carry":
      return `${article(e.item_kind)} ${e.item_kind} for ${e.carry_ticks} ticks`;
  }
}

/** The short instruction on a card: "Deliver the letter to the fireplace". */
export function errandTitle(v: Pick<View, "fixtures">, e: Errand): string {
  const w = errandWords(v, e);
  return e.type === "deliver" ? `Deliver ${w}` : e.type === "visit" ? `Visit ${w}` : `Carry ${w}`;
}

/** An errand the way a scoreboard says it: "letter to fireplace", "library", "ring held 16 ticks". */
export function errandShort(v: Pick<View, "fixtures">, e: Errand): string {
  switch (e.type) {
    case "deliver":
      return `${e.item_kind} to ${v.fixtures.find((x) => x.id === e.fixture)?.kind ?? "fixture"}`;
    case "visit":
      return e.room;
    case "carry":
      return `${e.item_kind} held ${e.carry_ticks} ticks`;
  }
}

let captionSeq = 0;

/** The caption for one event, or null when it is not worth a line. */
function captionFor(v: View, e: GameEvent): { text: string; tone: Caption["tone"] } | null {
  const kind = (id: string) => [...v.items, ...v.you.inventory, ...v.maria.inventory].find((i) => i.id === id)?.kind ?? "item";
  switch (e.kind) {
    case "completed": {
      const er = v.board.find((x) => x.id === e.errand);
      if (!er) return null;
      return e.by === "you" ? { text: `you +${er.value} · ${errandShort(v, er)}`, tone: "you" } : { text: `Maria +${er.value} · ${errandShort(v, er)}`, tone: "maria" };
    }
    case "expired": {
      const er = v.board.find((x) => x.id === e.errand);
      return er ? { text: `expired · ${errandShort(v, er)}`, tone: "plain" } : null;
    }
    case "snatched":
      return e.by === "you" ? { text: `you snatched Maria's ${kind(e.item)}`, tone: "you" } : { text: `Maria snatched your ${kind(e.item)}`, tone: "maria" };
    case "winding_up":
      return e.by === "you" ? { text: "you wind up · grab next tick if she stays in reach", tone: "you" } : { text: "Maria winding up · step out of reach", tone: "maria" };
    case "returned":
      return { text: `${e.item_kind} back on the floor`, tone: "plain" };
    case "posted":
      return { text: `new · ${errandShort(v, e.errand)} · worth ${e.errand.value}`, tone: "plain" };
    case "door_opened":
      return { text: "vault door open", tone: "plain" };
    case "safe_opened":
      return { text: "safe open", tone: "plain" };
    case "sigil":
      return e.owner === "you" ? { text: "your sigil · +40 energy", tone: "you" } : { text: "Maria's sigil paid out", tone: "maria" };
    default:
      return null;
  }
}

function fold(v: View, s: { tick: number; events: GameEvent[] }): View {
  const captions = v.captions.slice();
  for (const e of s.events) {
    const c = captionFor(v, e);
    if (c) captions.push({ tick: s.tick, ...c, n: ++captionSeq });
  }
  return { ...v, events: s.events, captions: captions.slice(-30) };
}

export function applyState(v: View, s: StateMsg): View {
  const next: View = {
    ...v,
    tick: s.tick,
    you: s.you,
    maria: s.maria,
    items: s.items,
    board: s.board,
    doorsOpened: s.doors_opened,
    safesOpened: s.safes_opened,
    sigilCharge: s.sigil_charge,
    scores: s.scores,
  };
  return fold(next, s);
}

export function applyEnd(v: View, e: MatchEndMsg): View {
  const next: View = { ...v, end: e, board: e.board, scores: e.scores, tick: e.tick };
  return fold(next, { tick: e.tick, events: e.events });
}

/** The view at frame `i` of a replay. Frames 1..i are folded so the captions are right. */
export function fromReplay(doc: ReplayDoc, i: number): View {
  const f0 = doc.frames[0]!;
  let v = fromStart({
    type: "match_start",
    match_id: doc.match_id,
    mode: doc.mode,
    tier: doc.tier,
    params: doc.params,
    map: doc.map,
    room_names: doc.room_names,
    fixtures: doc.fixtures,
    items: f0.items,
    safe_items: [],
    decor: doc.decor,
    start: doc.start,
    maria_start: doc.maria_start,
    sigil_owner: doc.sigil_owner,
    board: f0.board,
    you: { energy: f0.you.energy },
  });
  const last = Math.max(0, Math.min(i, doc.frames.length - 1));
  // Only the last 40 frames can still have captions on screen.
  for (let k = Math.max(0, last - 40); k <= last; k++) {
    const f = doc.frames[k]!;
    v = fold({ ...v, tick: f.tick, you: f.you, maria: f.maria, items: f.items, board: f.board, doorsOpened: f.doors_opened, safesOpened: f.safes_opened, sigilCharge: f.sigil_charge, scores: f.scores }, f);
    v = { ...v, yourIntent: f.you_intent, ...(f.maria_intent !== undefined ? { mariaIntent: f.maria_intent } : {}), ...(f.maria_energy !== undefined ? { mariaEnergy: f.maria_energy } : {}) };
  }
  v = { ...v, strip: doc.intent_status.slice(0, last), resyncs: doc.resyncs };
  if (last === doc.frames.length - 1 && doc.result && doc.scores) {
    v = { ...v, end: { type: "match_end", match_id: doc.match_id, result: doc.result, scores: doc.scores, board: v.board, replay: `/replay/${doc.match_id}`, tick: v.tick, events: v.events } };
  }
  return v;
}
