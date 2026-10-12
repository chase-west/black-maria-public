import {
  PROFILER_LINES,
  PROFILER_LINE_INFO,
  headingAnchor,
  type Errand,
  type Intent,
  type ItemKind,
  type Pos,
  type ProfilerErrand,
  type ProfilerLineKey,
  type ProfilerReport,
} from "@blackmaria/protocol";
import { createMatch, createRng, hashState, resultFor, scores, step, type Body, type MatchState } from "@blackmaria/engine";
import type { ReplayLog } from "./live.js";

/** "Heading for" an errand that expired: you moved toward it in this many ticks before it expired. */
export const HEADING_WINDOW = 10;

const DX = [0, 1, 0, -1];
const DY = [-1, 0, 1, 0];

/** Multi-source walking distances over a map; the locked door counts as open when `doorOpen`. */
class Distances {
  private readonly cache = new Map<string, Int16Array>();
  constructor(private readonly s0: MatchState) {}

  field(sources: readonly Pos[], doorOpen: boolean): Int16Array {
    const key = `${doorOpen ? 1 : 0}|${sources.map((p) => p.y * this.s0.map.w + p.x).sort((a, b) => a - b).join(",")}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const { w, h, tiles } = this.s0.map;
    const dist = new Int16Array(w * h).fill(-1);
    const q = new Int32Array(w * h);
    let head = 0;
    let tail = 0;
    for (const p of sources) {
      const i = p.y * w + p.x;
      if (dist[i]! < 0) {
        dist[i] = 0;
        q[tail++] = i;
      }
    }
    while (head < tail) {
      const cur = q[head++]!;
      const cx = cur % w;
      const cy = (cur - cx) / w;
      for (let d = 0; d < 4; d++) {
        const nx = cx + DX[d]!;
        const ny = cy + DY[d]!;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = ny * w + nx;
        if (dist[ni]! >= 0) continue;
        const t = tiles[ny]![nx]!;
        if (t === "wall" || (t === "door_locked" && !doorOpen)) continue;
        dist[ni] = dist[cur]! + 1;
        q[tail++] = ni;
      }
    }
    if (this.cache.size > 4000) this.cache.clear();
    this.cache.set(key, dist);
    return dist;
  }

  /** Distance from `p` to the nearest source, or Infinity. */
  to(sources: readonly Pos[], p: Pos, doorOpen: boolean): number {
    if (sources.length === 0) return Infinity;
    const d = this.field(sources, doorOpen)[p.y * this.s0.map.w + p.x]!;
    return d < 0 ? Infinity : d;
  }
}

const holdsKind = (s: MatchState, b: Body, kind: ItemKind) => s.bodies[b].inventory.some((id) => s.items.find((i) => i.id === id)?.kind === kind);
const doorOpenFor = (s: MatchState, b: Body) =>
  s.doorsOpened.some((d) => d.x === s.map.vaultDoor.x && d.y === s.map.vaultDoor.y) || holdsKind(s, b, "key");

/** Tiles where an item of this kind can be picked up: on the floor, or in the closed safe (at the safe's tile). */
function itemTiles(s: MatchState, kind: ItemKind): Pos[] {
  const out: Pos[] = [];
  for (const it of s.items) {
    if (it.kind !== kind) continue;
    if (it.loc.at === "tile") out.push(it.loc.pos);
    else if (it.loc.at === "safe") {
      const fid = it.loc.fixture;
      const f = s.fixtures.find((x) => x.id === fid);
      if (f) out.push(f.pos);
    }
  }
  return out;
}

function roomTiles(s: MatchState, room: string): Pos[] {
  const out: Pos[] = [];
  s.map.rooms.forEach((row, y) => row.forEach((r, x) => r === room && out.push({ x, y })));
  return out;
}

/** The next step of an errand for a body, as Maria's tiers define it (RULES.md section 9). Empty when there is none. */
function nextStep(s: MatchState, b: Body, e: Errand, rooms: Map<string, Pos[]>): Pos[] {
  if (e.type === "visit") {
    let t = rooms.get(e.room);
    if (!t) rooms.set(e.room, (t = roomTiles(s, e.room)));
    return t;
  }
  if (holdsKind(s, b, e.item_kind)) {
    if (e.type === "carry") return [];
    const fid = e.fixture;
    const f = s.fixtures.find((x) => x.id === fid);
    return f ? [f.pos] : [];
  }
  return itemTiles(s, e.item_kind);
}

const isOpen = (e: Errand, tick: number) => e.state === "open" && e.posted <= tick && tick < e.expires;

/** Ticks you still needed to finish an errand from state `s`; null when you could not. */
function ticksToFinish(s: MatchState, e: Errand, dist: Distances, rooms: Map<string, Pos[]>): number | null {
  const you = s.bodies.you;
  const open = doorOpenFor(s, "you");
  if (e.type === "visit") {
    const d = dist.to(nextStep(s, "you", e, rooms), you.pos, open);
    return Number.isFinite(d) ? d : null;
  }
  if (e.type === "carry") {
    if (holdsKind(s, "you", e.item_kind)) return Math.max(0, e.carry_ticks - (you.streak[e.item_kind] ?? 0));
    const d = dist.to(itemTiles(s, e.item_kind), you.pos, open);
    return Number.isFinite(d) ? d + e.carry_ticks : null;
  }
  const fid = e.fixture;
  const f = s.fixtures.find((x) => x.id === fid);
  if (!f) return null;
  if (holdsKind(s, "you", e.item_kind)) {
    const d = dist.to([f.pos], you.pos, open);
    return Number.isFinite(d) ? d + 1 : null;
  }
  let best = Infinity;
  for (const p of itemTiles(s, e.item_kind)) best = Math.min(best, dist.to([p], you.pos, open) + 1 + dist.to([f.pos], p, open) + 1);
  return Number.isFinite(best) ? best : null;
}

/** The errand in plain words. */
export function errandLabel(s: MatchState, e: Errand): string {
  if (e.type === "visit") return `be in the ${e.room}`;
  if (e.type === "carry") return `carry a ${e.item_kind} for ${e.carry_ticks} ticks`;
  const fid = e.fixture;
  const f = s.fixtures.find((x) => x.id === fid);
  return `deliver a ${e.item_kind} to the ${f?.kind ?? fid}`;
}

const sameInv = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Every state of a replayed match, tick 0 first. Throws if a recorded state hash does not match. */
export function replayStates(log: ReplayLog, verify = false): MatchState[] {
  let s = createMatch(log.seed, { params: log.params });
  const rng = createRng(log.seed);
  const out = [s];
  for (const [i, t] of log.ticks.entries()) {
    s = step(s, { you: t.you, maria: t.maria }, rng);
    if (verify && hashState(s) !== t.hash) throw new Error(`The replay does not match the engine at tick ${i}.`);
    out.push(s);
  }
  return out;
}

/** The value an item is worth to whoever holds it: the best open deliver or carry that needs its kind. */
function valueOfKind(s: MatchState, kind: ItemKind): number {
  let best = 0;
  for (const e of s.board) if (isOpen(e, s.tick) && (e.type === "deliver" || e.type === "carry") && e.item_kind === kind) best = Math.max(best, e.value);
  return best;
}

/**
 * The profiler (SPEC 8.3) from a match's replay, from your point of view.
 *
 * - You attempted an errand on a tick when, while it was open, your move reduced your walking distance to its next
 *   step, you picked up an item of its kind, you held an item of a `carry`'s kind, or you completed it.
 * - Maria took first: errands she completed that you attempted; ticks behind is how many more ticks you needed at the
 *   tick she completed it (null when no item of the kind was left for you).
 * - Expired while you were heading for them: errands that expired and that you attempted in the last 10 ticks before
 *   they expired.
 * - Never attempted: errands you did not complete and never attempted.
 * - Idle: ticks whose move arrived on time and was `WAIT`, or changed neither your tile nor your inventory.
 * - The network: late, missing and malformed moves, and resyncs answered.
 * - Snatches: each one's value is the best open `deliver` or `carry` needing the snatched item's kind, right after it.
 */
export function profileReplay(log: ReplayLog, states: MatchState[] = replayStates(log)): ProfilerReport {
  const s0 = states[0]!;
  const final = states[states.length - 1]!;
  const dist = new Distances(s0);
  const rooms = new Map<string, Pos[]>();
  const attempted = new Map<number, number>(); // errand id -> last tick attempted
  let idle = 0;
  const snatch = { for: { count: 0, value: 0 }, against: { count: 0, value: 0 } };
  const behind = new Map<number, number | null>();

  for (let t = 0; t + 1 < states.length; t++) {
    const before = states[t]!;
    const after = states[t + 1]!;
    const you: Intent = log.ticks[t]!.you;
    const status = log.intent_status[t] ?? "o";
    const events = after.last?.events ?? [];
    const open = doorOpenFor(before, "you");
    const moved = you.kind === "MOVE" && (before.bodies.you.pos.x !== after.bodies.you.pos.x || before.bodies.you.pos.y !== after.bodies.you.pos.y);
    for (const e of before.board) {
      if (!isOpen(e, t)) continue;
      let hit = false;
      if (moved) {
        const targets = nextStep(before, "you", e, rooms);
        if (dist.to(targets, after.bodies.you.pos, open) < dist.to(targets, before.bodies.you.pos, open)) hit = true;
      }
      if (!hit && e.type !== "visit") {
        const kind = e.item_kind;
        if (e.type === "carry" && holdsKind(after, "you", kind)) hit = true;
        if (events.some((ev) => ev.kind === "took" && ev.by === "you" && after.items.find((i) => i.id === ev.item)?.kind === kind)) hit = true;
      }
      if (!hit && events.some((ev) => ev.kind === "completed" && ev.errand === e.id && ev.by === "you")) hit = true;
      if (hit) attempted.set(e.id, t);
    }
    for (const ev of events) {
      if (ev.kind === "completed" && ev.by === "maria") {
        const e = before.board[ev.errand];
        if (e) behind.set(e.id, ticksToFinish(before, e, dist, rooms));
      }
      if (ev.kind === "snatched") {
        const kind = after.items.find((i) => i.id === ev.item)?.kind;
        const v = kind ? valueOfKind(after, kind) : 0;
        const side = ev.by === "you" ? snatch.for : snatch.against;
        side.count++;
        side.value += v;
      }
    }
    if (status === "o") {
      const a = before.bodies.you;
      const b = after.bodies.you;
      if (you.kind === "WAIT" || (a.pos.x === b.pos.x && a.pos.y === b.pos.y && sameInv(a.inventory, b.inventory))) idle++;
    }
  }

  const completed = { count: 0, value: 0 };
  const mariaFirst: ProfilerErrand[] = [];
  const expired: ProfilerErrand[] = [];
  const never = { count: 0, value: 0 };
  for (const e of final.board) {
    const label = errandLabel(final, e);
    if (e.state === "done_by_you") {
      completed.count++;
      completed.value += e.value;
      continue;
    }
    const last = attempted.get(e.id);
    if (last === undefined) {
      never.count++;
      never.value += e.value;
      continue;
    }
    if (e.state === "done_by_maria") mariaFirst.push({ id: e.id, type: e.type, value: e.value, label, ticks_behind: behind.get(e.id) ?? null });
    if (e.state === "expired" && last >= e.expires - HEADING_WINDOW) expired.push({ id: e.id, type: e.type, value: e.value, label });
  }
  const st = log.intent_status;
  const count = (c: string) => [...st].filter((x) => x === c).length;
  const late = count("l");
  const missing = count("m");
  const malformed = count("x");
  const links = {} as Record<ProfilerLineKey, { heading: string; anchor: string }>;
  for (const k of PROFILER_LINES) links[k] = { heading: PROFILER_LINE_INFO[k].heading, anchor: headingAnchor(PROFILER_LINE_INFO[k].heading) };
  const sum = (xs: ProfilerErrand[]) => xs.reduce((a, x) => a + x.value, 0);
  return {
    match_id: log.match_id,
    tier: log.tier,
    transport: log.transport,
    ticks: log.ticks.length,
    result: resultFor(final),
    scores: scores(final),
    completed,
    maria_first: { count: mariaFirst.length, value: sum(mariaFirst), errands: mariaFirst },
    expired_heading: { count: expired.length, value: sum(expired), errands: expired },
    never_attempted: never,
    idle: { ticks: idle },
    network: { ticks: late + missing + malformed, late, missing, malformed, resyncs: Object.values(log.resyncs).reduce((a, b) => a + b, 0) },
    snatches: snatch,
    energy_unused: final.bodies.you.energy,
    links,
  };
}
