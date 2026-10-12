import type { Intent, MatchStartMsg, StateMsg } from "@blackmaria/protocol";
import { Knowledge } from "./knowledge.js";
import { freeSlot, moveFor, nextStep, openErrands, type NextStep } from "./plan.js";
import type { HouseBot } from "./types.js";

/**
 * Novice (SPEC 4.1, RULES.md section 9): every tick, the open errand whose next step is nearest by walking distance
 * (ties: lowest errand id). TAKE on the item's tile, USE on the fixture's tile, otherwise the first MOVE of the path.
 * Never checks expiry, never snatches, WAITs when nothing is left. With a full inventory it frees a slot first.
 */
export class Novice implements HouseBot {
  readonly tier = "novice" as const;
  readonly k: Knowledge;
  constructor(start: MatchStartMsg) {
    this.k = new Knowledge(start);
  }

  /** The errand Novice pursues in this state and its next step. */
  choose(s: StateMsg): { errand: number; step: NextStep } | null {
    this.k.update(s);
    let best: { errand: number; step: NextStep } | null = null;
    for (const e of openErrands(s)) {
      const step = nextStep(this.k, s, s.you.pos, s.you.inventory, e);
      if (!step) continue;
      if (!best || step.dist < best.step.dist) best = { errand: e.id, step };
    }
    return best;
  }

  absorb(s: StateMsg): void {
    this.k.update(s);
  }

  decide(s: StateMsg): Intent {
    const c = this.choose(s);
    return c ? freeSlot(this.k, s, c.step.tile, c.step.act, moveFor(this.k, s.you.pos, s.you.inventory, c.step)) : { kind: "WAIT" };
  }
}
