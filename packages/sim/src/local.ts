import type { ChaosName, Intent, MatchEndMsg, MatchStartMsg, StateMsg, Tier } from "@blackmaria/protocol";
import { RULESET_VERSION, createMatch, createRng, eventsFor, hashState, matchEndFor, matchStartFor, normalizeIntent, stateFor, step, type MatchState, type Params } from "@blackmaria/engine";
import { createHouseBot, type HouseBot } from "@blackmaria/house-bots";
import type { ReplayLog } from "./live.js";

/** Your side of a local match: the same shape as the published client's bot. */
export interface LocalBot {
  onStart?(start: MatchStartMsg): void;
  decide(state: StateMsg): Intent;
  onEnd?(end: MatchEndMsg): void;
}

export interface LocalMatchOpts {
  seed: number;
  tier: Tier;
  params?: Partial<Params>;
  /** Published in `params.chaos`. The in-process runner has no network, so nothing is lost. */
  chaos?: ChaosName;
  /** Published in `params.tick_ms`. The in-process runner does not wait. */
  tickMs?: number;
  /** Replace Maria (tests, research). */
  maria?: HouseBot;
  onTick?: (state: MatchState) => void;
}

export interface LocalMatchResult {
  log: ReplayLog;
  final: MatchState;
  end: MatchEndMsg;
}

/**
 * Play one match in-process, as fast as the bots decide: your bot against Maria at a tier. The log has the same shape
 * as the server's replays, so `sim replay` and the profiler read both. A bot that throws plays `WAIT` that tick and the
 * tick is marked malformed.
 */
export function playLocal(bot: LocalBot, o: LocalMatchOpts): LocalMatchResult {
  const seed = o.seed >>> 0;
  const tickMs = o.tickMs ?? 250;
  const chaos = o.chaos ?? "off";
  let s = createMatch(seed, o.params ? { params: o.params } : {});
  const rng = createRng(seed);
  const id = `local_${seed}_${o.tier}`;
  const meta = { match_id: id, mode: "practice" as const, tier: o.tier, tick_ms: tickMs, chaos };
  const maria = o.maria ?? createHouseBot(o.tier, matchStartFor(s, "maria", meta));
  const log: ReplayLog = {
    match_id: id,
    seed,
    tier: o.tier,
    mode: "practice",
    transport: "local",
    ruleset_version: RULESET_VERSION,
    max_tick: s.params.maxTick,
    params: { ...s.params },
    tick_ms: tickMs,
    started_at: Date.now(),
    ticks: [],
    intent_status: "",
    resyncs: {},
    chaos: [],
    chaos_profile: null,
  };
  bot.onStart?.(matchStartFor(s, "you", meta));
  while (!s.done) {
    let you: Intent;
    let status = "o";
    try {
      you = normalizeIntent(bot.decide(stateFor(s, "you", { match_id: id, deadline_ms: tickMs })));
    } catch {
      you = { kind: "WAIT" };
      status = "x";
    }
    let her: Intent;
    try {
      her = normalizeIntent(maria.decide(stateFor(s, "maria", { match_id: id, deadline_ms: tickMs })));
    } catch {
      her = { kind: "WAIT" };
    }
    s = step(s, { you, maria: her }, rng);
    log.ticks.push({ you, maria: her, events_you: eventsFor(s, "you"), events_maria: eventsFor(s, "maria"), hash: hashState(s) });
    log.intent_status += status;
    o.onTick?.(s);
  }
  const end = matchEndFor(s, "you", { match_id: id, replay: "" });
  bot.onEnd?.(end);
  return { log, final: s, end };
}
