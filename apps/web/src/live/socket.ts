import type { ErrorMsg, Intent, MatchEndMsg, MatchStartMsg, ProfilerReport, ServerMsg, StateMsg, Tier } from "@blackmaria/protocol";
import { wsUrl } from "../api.js";
import { OrphanGate } from "./orphans.js";

export interface LiveHandlers {
  onStart(m: MatchStartMsg): void;
  onState(m: StateMsg): void;
  onEnd(m: MatchEndMsg): void;
  onError(m: ErrorMsg): void;
  onClose?(): void;
  onProfile?(r: ProfilerReport): void;
}

/** A practice match played from the page itself (manual mode). The server is authoritative. */
export class LiveMatch {
  private ws: WebSocket;
  matchId: string | null = null;
  tick = -1;
  private sentFor = -1;
  private closeTimer: ReturnType<typeof setTimeout> | null = null;
  private stopping = false;

  constructor(token: string, tier: Tier, private readonly h: LiveHandlers, speed = 1) {
    this.ws = new WebSocket(wsUrl());
    const gate = new OrphanGate(
      (id) => this.ws.send(JSON.stringify({ type: "leave", match_id: id })),
      () => {
        if (this.stopping) this.ws.close();
        else if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: "join", mode: "practice", tier, speed }));
      },
    );
    this.ws.onopen = () => this.ws.send(JSON.stringify({ type: "hello", token, name: "by-hand" }));
    this.ws.onmessage = (ev) => {
      let m: ServerMsg;
      try {
        m = JSON.parse(String(ev.data)) as ServerMsg;
      } catch {
        return;
      }
      if (gate.take(m)) return;
      if (m.type === "welcome") {
        if (this.stopping) this.ws.close();
        else gate.welcome();
      }
      else if (m.type === "match_start") {
        // Stopped before the match began: leave it at once so it doesn't linger on the server.
        if (this.stopping) {
          this.ws.send(JSON.stringify({ type: "leave", match_id: m.match_id }));
          return;
        }
        this.matchId = m.match_id;
        h.onStart(m);
      } else if (m.type === "state" && m.match_id === this.matchId) {
        this.tick = m.tick;
        h.onState(m);
      } else if (m.type === "match_end" && m.match_id === this.matchId) {
        h.onEnd(m);
        // The profiler follows on the same socket; close once it arrives, or after 2 s.
        this.closeTimer = setTimeout(() => this.ws.close(), 2000);
      } else if (m.type === "error" && m.code !== "stale_tick" && m.code !== "duplicate_intent") h.onError(m);
      else if (m.type === "profile" && m.match_id === this.matchId) {
        h.onProfile?.(m.report);
        if (this.closeTimer) {
          clearTimeout(this.closeTimer);
          this.ws.close();
        }
      }
    };
    this.ws.onclose = () => h.onClose?.();
  }

  /** Submit an intent for the open tick. Returns false if one was already sent this tick. */
  submit(intent: Intent): boolean {
    if (!this.matchId || this.tick < 0 || this.sentFor === this.tick || this.ws.readyState !== WebSocket.OPEN) return false;
    this.sentFor = this.tick;
    this.ws.send(JSON.stringify({ type: "intent", match_id: this.matchId, tick: this.tick, intent }));
    return true;
  }

  get sentThisTick(): boolean {
    return this.sentFor === this.tick;
  }

  /**
   * Leave the match: the server plays it out without you and writes its replay. The socket stays open for its
   * `match_end` (and closes on its own), or closes after 3 s at most.
   */
  leave(): void {
    if (this.stopping) return;
    this.stopping = true;
    if (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN) {
      if (this.matchId && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: "leave", match_id: this.matchId }));
      setTimeout(() => this.ws.close(), 3000);
    } else this.ws.close();
  }

  close(): void {
    this.ws.close();
  }
}
