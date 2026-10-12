/**
 * The worked example at the top of docs/RULES.md, generated from a real match. Two simple "nearest errand" bots
 * play a real seed; the example is the board at tick 0 and a ten-tick window later in the same match that has a
 * pickup race, a delivery and an expiry. `rules-doc.test.ts` regenerates it and checks the doc matches.
 */
import type { Errand, GameEvent, Intent, Pos } from "@blackmaria/protocol";
import { createMatch, createRng, distanceField, eventsFor, step, type Body, type MatchState } from "../src/index.js";

const DIRS = ["N", "E", "S", "W"] as const;
const DX = [0, 1, 0, -1];
const DY = [-1, 0, 1, 0];

/** First step of a shortest path from `from` to `to` (N, E, S, W tie-break), or null when there already. */
function firstStep(s: MatchState, from: Pos, to: Pos, unlocked: boolean): Intent | null {
  if (from.x === to.x && from.y === to.y) return null;
  const d = distanceField(s.map, to, unlocked, s.doorsOpened);
  const here = d[from.y * s.map.w + from.x]!;
  for (let k = 0; k < 4; k++) {
    const x = from.x + DX[k]!;
    const y = from.y + DY[k]!;
    if (x < 0 || y < 0 || x >= s.map.w || y >= s.map.h) continue;
    const v = d[y * s.map.w + x]!;
    if (v >= 0 && v === here - 1) return { kind: "MOVE", dir: DIRS[k]! };
  }
  return null;
}

interface Target {
  pos: Pos;
  act: Intent;
  item: string | null;
}

/** The nearest open errand's next step, for body `b`. */
function nearestTarget(s: MatchState, b: Body): Target | null {
  const me = s.bodies[b];
  const dist = distanceField(s.map, me.pos, false, s.doorsOpened);
  const at = (p: Pos) => dist[p.y * s.map.w + p.x]!;
  const held = (k: string) => me.inventory.find((id) => s.items.find((i) => i.id === id)!.kind === k);
  let best: { d: number; t: Target; id: number } | null = null;
  const consider = (d: number, t: Target, id: number) => {
    if (d < 0) return;
    if (!best || d < best.d || (d === best.d && id < best.id)) best = { d, t, id };
  };
  for (const e of s.board) {
    if (e.state !== "open" || e.posted > s.tick) continue;
    if (e.type === "visit") {
      for (let y = 0; y < s.map.h; y++) for (let x = 0; x < s.map.w; x++) if (s.map.rooms[y]![x] === e.room) consider(at({ x, y }), { pos: { x, y }, act: { kind: "WAIT" }, item: null }, e.id);
      continue;
    }
    const mine = held(e.item_kind);
    if (mine) {
      if (e.type === "deliver") {
        const f = s.fixtures.find((x) => x.id === e.fixture)!;
        consider(at(f.pos), { pos: f.pos, act: { kind: "USE", item: mine }, item: null }, e.id);
      }
      continue;
    }
    if (me.inventory.length >= s.params.inventorySlots) continue;
    for (const it of s.items) if (it.kind === e.item_kind && it.loc.at === "tile") consider(at(it.loc.pos), { pos: it.loc.pos, act: { kind: "TAKE" }, item: it.id }, e.id);
  }
  return best ? (best as { t: Target }).t : null;
}

function decide(s: MatchState, b: Body): { intent: Intent; item: string | null } {
  const t = nearestTarget(s, b);
  if (!t) return { intent: { kind: "WAIT" }, item: null };
  const mv = firstStep(s, s.bodies[b].pos, t.pos, false);
  if (mv) return { intent: mv, item: t.item };
  return { intent: t.act.kind === "WAIT" ? { kind: "WAIT" } : t.act, item: t.item };
}

export interface Example {
  seed: number;
  from: number;
  states: MatchState[];
  moves: { you: Intent; maria: Intent }[];
}

/** Play the seed with two nearest-errand bots and return every state and move. */
export function playExample(seed: number): { states: MatchState[]; moves: { you: Intent; maria: Intent }[]; races: Set<number> } {
  let s = createMatch(seed);
  const rng = createRng(seed);
  const states = [s];
  const moves: { you: Intent; maria: Intent }[] = [];
  const races = new Set<number>();
  while (!s.done) {
    const a = decide(s, "you");
    const m = decide(s, "maria");
    if (a.item && a.item === m.item) races.add(s.tick);
    s = step(s, { you: a.intent, maria: m.intent }, rng);
    moves.push({ you: a.intent, maria: m.intent });
    states.push(s);
  }
  return { states, moves, races };
}

/** Find the first seed and ten-tick window with a pickup race won inside it, a delivery that completes an errand, and an expiry. */
/** The seed and window used in docs/RULES.md (found by `findExample`). */
export const EXAMPLE = { seed: 80, from: 41 } as const;

export function exampleAt(seed: number, from: number): Example {
  const { states, moves } = playExample(seed);
  return { seed, from, states, moves };
}

/** True when the window has a pickup race decided by energy, a delivery that completes an errand, an expiry, and at most two WAITs. */
export function windowQualifies(ex: Example): boolean {
  const { states, moves, from } = ex;
  let race = false;
  let delivered = false;
  let expired = false;
  let waits = 0;
  for (let t = from; t < from + 10; t++) {
    const e = states[t + 1]!.last!.events;
    const m = moves[t]!;
    const st = states[t]!;
    const sameTile = st.bodies.you.pos.x === st.bodies.maria.pos.x && st.bodies.you.pos.y === st.bodies.maria.pos.y;
    if (t > from && m.you.kind === "TAKE" && m.maria.kind === "TAKE" && sameTile && st.bodies.you.energy !== st.bodies.maria.energy && e.some((x) => x.kind === "took")) race = true;
    if (e.some((x) => x.kind === "delivered") && e.some((x) => x.kind === "completed")) delivered = true;
    if (e.some((x) => x.kind === "expired")) expired = true;
    waits += (m.you.kind === "WAIT" ? 1 : 0) + (m.maria.kind === "WAIT" ? 1 : 0);
  }
  return race && delivered && expired && waits <= 2;
}

export function findExample(): Example {
  for (let seed = 1; seed < 2000; seed++) {
    const { states, moves } = playExample(seed);
    for (let from = 20; from + 10 < 300; from++) if (windowQualifies({ seed, from, states, moves })) return { seed, from, states, moves };
  }
  throw new Error("no worked example found");
}

const fmtMove = (i: Intent): string => (i.kind === "MOVE" ? `MOVE ${i.dir}` : i.kind === "USE" || i.kind === "DROP" ? `${i.kind} ${i.item}` : i.kind);
const fmtPos = (p: Pos) => `(${p.x}, ${p.y})`;

function fmtErrand(s: MatchState, e: Errand): string {
  switch (e.type) {
    case "deliver": {
      const f = s.fixtures.find((x) => x.id === e.fixture)!;
      return `\`deliver\`: a ${e.item_kind} to the ${f.kind} \`${f.id}\` in the ${f.room}`;
    }
    case "visit":
      return `\`visit\`: the ${e.room}`;
    case "carry":
      return `\`carry\`: a ${e.item_kind} for ${e.carry_ticks} ticks`;
  }
}

function fmtEvent(e: GameEvent): string {
  switch (e.kind) {
    case "posted":
      return `\`posted {errand ${e.errand.id}}\``;
    case "completed":
      return `\`completed {${e.errand}, by: ${e.by}}\``;
    case "expired":
      return `\`expired {${e.errand}}\``;
    case "took":
    case "dropped":
    case "snatched":
      return `\`${e.kind} {by: ${e.by}, ${e.item}}\``;
    case "delivered":
      return `\`delivered {by: ${e.by}, ${e.item}, ${e.fixture}}\``;
    case "door_opened":
      return `\`door_opened {${e.pos.x}, ${e.pos.y}}\``;
    case "safe_opened":
      return `\`safe_opened {${e.fixture}, ${e.item}}\``;
    case "sigil":
      return `\`sigil {owner: ${e.owner}, ${e.energy_gained}}\``;
    case "moved":
      return `\`moved {by: ${e.by}, ${e.dir}}\``;
    case "winding_up":
      return `\`winding_up {by: ${e.by}}\``;
    case "returned":
      return `\`returned {${e.item}, ${e.item_kind}, ${e.pos.x}, ${e.pos.y}}\``;
  }
}

function boardTable(s: MatchState, rows: Errand[]): string {
  const out = ["| id | errand | value | posted | expires |", "|---|---|---|---|---|"];
  for (const e of rows) out.push(`| ${e.id} | ${fmtErrand(s, e)} | ${e.value} | ${e.posted} | ${e.expires} |`);
  return out.join("\n");
}

const itemsOf = (s: MatchState, b: Body) => (s.bodies[b].inventory.length ? s.bodies[b].inventory.map((id) => `${id} (${s.items.find((i) => i.id === id)!.kind})`).join(", ") : "nothing");

/** The markdown section, from its heading to the line before the next heading. */
export function renderExample(ex: Example): string {
  const s0 = ex.states[0]!;
  const sa = ex.states[ex.from]!;
  const L: string[] = [];
  L.push("## A worked example: ten ticks of a real match");
  L.push("");
  L.push(`Seed ${ex.seed}, every parameter at its default. You and Maria are both played by the simplest bot there is: walk to the nearest open errand's next step, \`TAKE\` or \`USE\` on arrival. You start at ${fmtPos(s0.map.start)}, the center of the hall. Maria starts at ${fmtPos(s0.map.mariaStart)}, the hall tile farthest from you. Both of you have 40 energy.`);
  L.push("");
  L.push("**The board at tick 0.** Six errands are posted before the first move.");
  L.push("");
  L.push(boardTable(s0, s0.board));
  L.push("");
  const open = sa.board.filter((e) => e.state === "open");
  L.push(`**Tick ${ex.from}.** Skip ahead. The score is you ${sa.bodies.you.score}, Maria ${sa.bodies.maria.score}. You are at ${fmtPos(sa.bodies.you.pos)} holding ${itemsOf(sa, "you")}. Maria is at ${fmtPos(sa.bodies.maria.pos)} holding ${itemsOf(sa, "maria")}. Your energy is ${sa.bodies.you.energy}. Hers is ${sa.bodies.maria.energy}, but you can't see that. These errands are open:`);
  L.push("");
  L.push(boardTable(sa, open));
  const floor = sa.items.filter((i) => i.loc.at === "tile");
  L.push("");
  L.push(`Items on the floor: ${floor.map((i) => `${i.id} (${i.kind}) at ${fmtPos((i.loc as { pos: Pos }).pos)}`).join(", ")}.`);
  L.push("");
  L.push("| tick | your move | Maria's move | you after | Maria after | your energy | her energy | events you receive | events Maria receives |");
  L.push("|---|---|---|---|---|---|---|---|---|");
  for (let t = ex.from; t < ex.from + 10; t++) {
    const after = ex.states[t + 1]!;
    const yours = eventsFor(after, "you").map(fmtEvent);
    const hers = eventsFor(after, "maria").map(fmtEvent);
    L.push(
      `| ${t} | \`${fmtMove(ex.moves[t]!.you)}\` | \`${fmtMove(ex.moves[t]!.maria)}\` | ${fmtPos(after.bodies.you.pos)} | ${fmtPos(after.bodies.maria.pos)} | ${after.bodies.you.energy} | ${after.bodies.maria.energy} | ${yours.length ? yours.join(", ") : "none"} | ${hers.length ? hers.join(", ") : "none"} |`,
    );
  }
  const end = ex.states[ex.from + 10]!;
  L.push("");
  L.push(`After tick ${ex.from + 9} the score is you ${end.bodies.you.score}, Maria ${end.bodies.maria.score}.`);
  L.push("");
  L.push("The energy columns show both so you can follow the ties. In a real match you only see your own. Maria gets the same events from her side: where you see `by: maria`, she sees `by: you`, and she gets a `moved` event for your steps instead of hers. \"Order of one tick\" in section 4 explains why each row came out the way it did. After this page you should be able to work out any tick by hand.");
  return L.join("\n");
}
