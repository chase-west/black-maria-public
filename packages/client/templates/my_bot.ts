// my_bot.ts: the starter bot and the transport's five hooks, as shipped. This is the file you edit.
// Run it: npx blackmaria play --vs master --bot my_bot.ts --trace
// The state's shape: StateMsg in node_modules/blackmaria/types/protocol/src/types.d.ts.
import { StarterBot, traceLine } from "blackmaria";
import type { Delta, Intent, MatchStartMsg, StateMsg, TickRecord, Transport, WirePacket } from "blackmaria";

export default class Bot {
  starter = new StarterBot();

  onStart(start: MatchStartMsg): void {
    this.starter.onStart(start);
  }

  decide(state: StateMsg): Intent {
    return this.starter.decide(state);
  }
}

// Called with every decoded packet from the server, before the transport handles it.
export function onPacket(this: Transport, packet: WirePacket): boolean {
  return true;
}

// Called with every delta `STATE`.
export function shouldResync(this: Transport, delta: Delta): boolean {
  return false;
}

// Called when a tick's deadline is half gone and its `STATE` hasn't arrived, with the last state and the moves sent since.
export function predictState(this: Transport, lastState: StateMsg, pendingMoves: Intent[]): StateMsg | null {
  return null;
}

// Called with each state.
export function planMoves(this: Transport, state: StateMsg): Intent | Intent[] {
  const bot = this.botFor(state.match_id);
  return bot ? bot.decide(state) : { kind: "WAIT" };
}

// Called once per settled tick, with its trace record: `{ match, tick, state_ms, think_ms, sent_ms, status, margin_ms, resync, seq_gap }`.
export function onTick(this: Transport, record: TickRecord): void {
  if (this.trace) this.out(traceLine(record));
}
