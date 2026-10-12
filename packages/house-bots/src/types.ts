import type { Intent, MatchStartMsg, StateMsg, Tier } from "@blackmaria/protocol";

/**
 * A house bot plays Maria from her own point of view (protocol messages where "you" is Maria). It sees exactly what a
 * candidate sees from the other side: no engine state, nothing private. It is deterministic given its observations.
 */
export interface HouseBot {
  readonly tier: Tier;
  decide(state: StateMsg): Intent;
  /**
   * Fold a state into the bot's memory without choosing a move: everything `decide` remembers, nothing it searches.
   * Calling `absorb` on a sequence of states and then `decide` on the next leaves the bot exactly as if it had decided
   * on every one (used to replay a copy of Maria).
   */
  absorb?(state: StateMsg): void;
}

export type HouseBotFactory = (start: MatchStartMsg) => HouseBot;
