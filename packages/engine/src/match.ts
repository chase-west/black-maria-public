import { postErrand } from "./board.js";
import { canonical, sha256Hex } from "./hash.js";
import { generateWorld } from "./mapgen.js";
import { createRng } from "./prng.js";
import { RULES, makeParams, type Params } from "./rules.js";
import { step } from "./step.js";
import type { BodyState, Intents, MatchState } from "./types.js";
import type { Pos } from "@blackmaria/protocol";

export const RULESET_VERSION = "bm-6.2";

export interface MatchOptions {
  params?: Partial<Params>;
}

function freshBody(pos: Pos, energy: number): BodyState {
  return { pos: { ...pos }, inventory: [], energy, score: 0, streak: {} };
}

/** The initial state for a seed: tick 0, both bodies in the hall, six errands on the board. */
export function createMatch(seed: number, opts: MatchOptions = {}): MatchState {
  const s0 = seed >>> 0;
  const params = makeParams(opts.params);
  const world = generateWorld(s0);
  const state: MatchState = {
    ruleset: RULESET_VERSION,
    seed: s0,
    params,
    tick: 0,
    map: world.map,
    mapHash: sha256Hex(canonical(world.map)),
    fixtures: world.fixtures,
    items: world.items,
    safe: world.safe,
    bodies: { you: freshBody(world.map.start, params.energyStart), maria: freshBody(world.map.mariaStart, params.energyStart) },
    board: [],
    doorsOpened: [],
    sigils: world.sigils,
    pendingGrab: null,
    last: null,
    done: false,
  };
  const rng = createRng(s0);
  for (let slot = 0; slot < RULES.initialErrands; slot++) postErrand(state, 0, slot, rng);
  return state;
}

/** SHA-256 of the canonical state. The static map is represented by its own hash. */
export function hashState(state: MatchState): string {
  const { map: _map, ...rest } = state;
  return sha256Hex(canonical(rest));
}

export function serialize(state: MatchState): string {
  return canonical(state);
}

export function deserialize(text: string): MatchState {
  const s = JSON.parse(text) as MatchState;
  if (typeof s !== "object" || s === null || s.ruleset !== RULESET_VERSION) throw new Error("not a BLACK MARIA state");
  return s;
}

/** Re-run a match from its seed and move log. Returns every state, starting with tick 0. */
export function replayMatch(seed: number, intents: readonly Intents[], opts: MatchOptions = {}): MatchState[] {
  const rng = createRng(seed);
  let s = createMatch(seed, opts);
  const out = [s];
  for (const i of intents) {
    if (s.done) break;
    s = step(s, i, rng);
    out.push(s);
  }
  return out;
}
