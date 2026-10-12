import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import type { Intent, ReplayDoc, ReplayFrame } from "@blackmaria/protocol";
import type { ReplayLog } from "@black-maria/sim";
import {
  boardFor,
  createMatch,
  createRng,
  decorView,
  eventsFor,
  fixturesView,
  hashState,
  itemsView,
  mapView,
  mariaView,
  paramsFor,
  resultFor,
  roomNamesFor,
  scores,
  sigilCharge,
  sigilOwners,
  sigilsRowMajor,
  step,
  youView,
  type MatchState,
} from "@blackmaria/engine";

export type { ReplayLog } from "@black-maria/sim";

export function replayPath(dir: string, matchId: string): string {
  return join(dir, `${matchId}.json.gz`);
}

export function writeReplay(dir: string, log: ReplayLog): string {
  mkdirSync(dir, { recursive: true });
  const p = replayPath(dir, log.match_id);
  writeFileSync(p, gzipSync(JSON.stringify(log)));
  return p;
}

export function readReplay(path: string): ReplayLog {
  return JSON.parse(gunzipSync(readFileSync(path)).toString("utf8")) as ReplayLog;
}

export class ReplayMismatch extends Error {}

function frameOf(s: MatchState, reviewer: boolean, you: Intent | null, maria: Intent | null): ReplayFrame {
  const f: ReplayFrame = {
    tick: s.tick,
    you: youView(s, "you"),
    maria: mariaView(s, "you"),
    items: itemsView(s),
    board: boardFor(s, "you"),
    doors_opened: s.doorsOpened.map((d) => ({ ...d })),
    safes_opened: s.safe && s.safe.open ? [s.safe.fixture] : [],
    sigil_charge: sigilCharge(s),
    scores: scores(s),
    events: eventsFor(s, "you"),
    you_intent: you,
  };
  if (reviewer) {
    f.maria_intent = maria;
    f.maria_energy = s.bodies.maria.energy;
  }
  return f;
}

/**
 * Expand a log into per-tick render frames by re-running the engine on the server. Verifies every recorded hash.
 * Candidate frames leave out Maria's energy and her raw moves (her executed steps are in the events).
 */
export function expandReplay(log: ReplayLog, opts: { reviewer: boolean; finished: boolean }): ReplayDoc {
  let s = createMatch(log.seed, { params: log.params });
  const rng = createRng(log.seed);
  const frames: ReplayFrame[] = [frameOf(s, opts.reviewer, null, null)];
  log.ticks.forEach((t, i) => {
    s = step(s, { you: t.you, maria: t.maria }, rng);
    if (hashState(s) !== t.hash) throw new ReplayMismatch(`hash mismatch at tick ${i}`);
    frames.push(frameOf(s, opts.reviewer, t.you, t.maria));
  });
  const done = s.done && opts.finished;
  const chaos = log.chaos_profile === "novice" || log.chaos_profile === "adept" || log.chaos_profile === "master" ? log.chaos_profile : "off";
  return {
    match_id: log.match_id,
    mode: log.mode,
    tier: log.tier,
    ...(opts.reviewer ? { seed: log.seed } : {}),
    params: paramsFor(s, { tick_ms: log.tick_ms, chaos }),
    map: mapView(s),
    room_names: roomNamesFor(s),
    fixtures: fixturesView(s),
    decor: decorView(s),
    start: { ...s.map.start },
    maria_start: { ...s.map.mariaStart },
    sigil_owner: sigilOwners(s, "you"),
    sigils: sigilsRowMajor(s).map((g) => ({ ...g.pos })),
    transport: log.transport,
    intent_status: log.intent_status,
    resyncs: log.resyncs,
    ...(opts.reviewer ? { chaos: log.chaos, chaos_profile: log.chaos_profile } : {}),
    result: done ? resultFor(s) : null,
    scores: done ? scores(s) : null,
    frames,
    reviewer: opts.reviewer,
  };
}
