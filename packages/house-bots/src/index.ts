import type { MatchStartMsg, Tier } from "@blackmaria/protocol";
import { Adept } from "./adept.js";
import { Master } from "./master.js";
import { Novice } from "./novice.js";
import type { HouseBot } from "./types.js";

export * from "./types.js";
export * from "./knowledge.js";
export * from "./plan.js";
export { Novice } from "./novice.js";
export { Adept, SIGIL_DETOUR, type Option } from "./adept.js";
export { Master, MASTER_DEFAULTS, type MasterOpts } from "./master.js";

/** Build Maria for a tier, from her own match start. */
export function createHouseBot(tier: Tier, start: MatchStartMsg): HouseBot {
  switch (tier) {
    case "novice":
      return new Novice(start);
    case "adept":
      return new Adept(start);
    case "master":
      return new Master(start);
  }
}
export { simulate, type CandidateBot, type SimResult, type SimOpts } from "./sim.js";
export { RoutePlanner, ROUTE_DEFAULTS, type RouteOpts, type Route, type RouteStep, type Discount, type Sim } from "./route.js";
