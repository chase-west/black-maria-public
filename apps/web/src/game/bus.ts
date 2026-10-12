/**
 * The event bus (SPEC 8.4, "Sound hook"). Sound is out of scope for v1; this is the hook. The arena and the pages emit
 * every moment of the experience here, so audio can subscribe later without touching the game.
 */
export type BusEvent =
  | { kind: "step"; dir: "N" | "E" | "S" | "W" }
  | { kind: "took"; by: "you" | "maria" }
  | { kind: "delivered"; by: "you" | "maria" }
  | { kind: "completed"; by: "you" | "maria"; value: number }
  | { kind: "expired"; errand: number }
  | { kind: "posted"; value: number }
  | { kind: "snatched"; by: "you" | "maria" }
  | { kind: "winding_up"; by: "you" | "maria" }
  | { kind: "returned" }
  | { kind: "sigil"; owner: "you" | "maria" }
  | { kind: "door_opened" }
  | { kind: "safe_opened" }
  | { kind: "match_start" }
  | { kind: "match_end"; result: "win" | "draw" | "loss" }
  | { kind: "profiler_shown" }
  | { kind: "change_revealed"; id: number }
  | { kind: "official_started" }
  | { kind: "official_match_end"; index: number; result: "win" | "draw" | "loss" }
  | { kind: "official_done" }
  | { kind: "submitted" };

type Listener = (e: BusEvent) => void;

class Bus {
  private ls = new Set<Listener>();
  /** The last events, for tests and the dev console. */
  readonly recent: BusEvent[] = [];
  on(fn: Listener): () => void {
    this.ls.add(fn);
    return () => this.ls.delete(fn);
  }
  emit(e: BusEvent): void {
    this.recent.push(e);
    if (this.recent.length > 200) this.recent.shift();
    for (const l of this.ls) {
      try {
        l(e);
      } catch {
        /* listeners never break rendering */
      }
    }
  }
}

export const bus = new Bus();
