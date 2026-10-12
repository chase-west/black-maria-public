/** Engine state as wire structs (SPEC 5.4, 5.5), always from the candidate's point of view. */
import type { ChaosName, Tier } from "@blackmaria/protocol";
import { blobFromMatchStart, eventToWire, snapshotFromState, type MatchBlob, type WireEvent, type WireSnapshot } from "@blackmaria/protocol/wire";
import { eventsFor, matchStartFor, stateFor } from "./view.js";
import type { MatchState } from "./types.js";

export function matchBlobFor(state: MatchState, tier: Tier, seedHint: number, meta: { tick_ms: number; chaos?: ChaosName }): MatchBlob {
  return blobFromMatchStart(matchStartFor(state, "you", { match_id: "", mode: "practice", tier, tick_ms: meta.tick_ms, ...(meta.chaos ? { chaos: meta.chaos } : {}) }), seedHint);
}

export function snapshotFor(state: MatchState): WireSnapshot {
  return snapshotFromState(stateFor(state, "you", { match_id: "", deadline_ms: 0 }), state.map.roomList);
}

/** The candidate's events for the tick that produced `state`. */
export function wireEventsFor(state: MatchState): WireEvent[] {
  return eventsFor(state, "you").map((e) => eventToWire(e, state.map.roomList));
}
