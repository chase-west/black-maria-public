import type { Intent, MatchEndMsg, MatchStartMsg, StateMsg, Tier } from "@blackmaria/protocol";
import { createMatch, createRng, matchEndFor, matchStartFor, normalizeIntent, stateFor, step, type MatchOptions, type MatchState } from "@blackmaria/engine";
import { createHouseBot } from "./index.js";
import type { HouseBot } from "./types.js";

/** The candidate-side bot shape: the same as the published client's. */
export interface CandidateBot {
  onStart?(start: MatchStartMsg): void;
  decide(state: StateMsg): Intent;
  onEnd?(end: MatchEndMsg): void;
}

export interface SimResult {
  seed: number;
  tier: Tier;
  end: MatchEndMsg;
  final: MatchState;
  intents: { you: Intent; maria: Intent }[];
}

export interface SimOpts extends MatchOptions {
  /** Override Maria (for tests). */
  maria?: HouseBot;
  /** Build Maria from her own match start (for research on house-bot settings). */
  mariaFactory?: (start: MatchStartMsg) => HouseBot;
  /** Called after every resolved tick. */
  onTick?: (s: MatchState) => void;
  tickMs?: number;
}

/** Play one match in-process: candidate bot vs a house tier. Deterministic for deterministic bots. */
export function simulate(seed: number, tier: Tier, bot: CandidateBot, opts: SimOpts = {}): SimResult {
  let s = createMatch(seed, opts.params ? { params: opts.params } : {});
  const rng = createRng(seed);
  const meta = { match_id: `sim_${seed}`, mode: "practice" as const, tier, tick_ms: opts.tickMs ?? 250 };
  const start = matchStartFor(s, "you", meta);
  const herStart = matchStartFor(s, "maria", meta);
  const maria = opts.maria ?? (opts.mariaFactory ? opts.mariaFactory(herStart) : createHouseBot(tier, herStart));
  bot.onStart?.(start);
  const intents: SimResult["intents"] = [];
  while (!s.done) {
    let you: Intent;
    try {
      you = normalizeIntent(bot.decide(stateFor(s, "you", { match_id: meta.match_id, deadline_ms: meta.tick_ms })));
    } catch {
      you = { kind: "WAIT" };
    }
    let her: Intent;
    try {
      her = normalizeIntent(maria.decide(stateFor(s, "maria", { match_id: meta.match_id, deadline_ms: meta.tick_ms })));
    } catch {
      her = { kind: "WAIT" };
    }
    intents.push({ you, maria: her });
    s = step(s, { you, maria: her }, rng);
    opts.onTick?.(s);
  }
  const end = matchEndFor(s, "you", { match_id: meta.match_id, replay: "" });
  bot.onEnd?.(end);
  return { seed, tier, end, final: s, intents };
}
