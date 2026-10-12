/** A --bot file that exports a Transport subclass: it sends each move for this tick and the next (test/hooks.test.ts). */
import type { Intent, StateMsg } from "@blackmaria/protocol";
import { Transport as Base } from "../../src/transport.js";

export class Transport extends Base {
  override planMoves(state: StateMsg): Intent | Intent[] {
    const move = super.planMoves(state) as Intent;
    return [move, move];
  }
}
