import type { Intent, MatchEndMsg, Mode, ServerMsg, Tier } from "@blackmaria/protocol";
import { matchEndFor, matchStartFor, resultFor, scores, stateFor, type MatchState, type Params } from "@blackmaria/engine";
import { LiveMatch, type ReplayLog } from "@black-maria/sim";
import { writeReplay } from "./replay.js";

/** Anything that can receive server messages for a match. */
export interface MatchSink {
  readonly id: number;
  send(msg: ServerMsg): void;
  readonly open: boolean;
}

export interface MatchOpts {
  id: string;
  token: string;
  mode: Mode;
  tier: Tier;
  seed: number;
  tickMs: number;
  maxTick?: number;
  replayDir: string;
  run?: { id: string; index: number };
  params?: Partial<Params>;
  log?: (msg: string, err?: unknown) => void;
}

/** Process-wide timing metrics: how late ticks resolve relative to their deadline. */
export const metrics = {
  ticks: 0,
  /** Ticks resolved with no intent from the candidate (late, missing, or disconnected). */
  missing: 0,
  lateSamples: [] as number[],
  maxLate: 0,
  record(lateMs: number): void {
    this.ticks++;
    this.maxLate = Math.max(this.maxLate, lateMs);
    this.lateSamples.push(lateMs);
    if (this.lateSamples.length > 20_000) this.lateSamples.splice(0, 10_000);
  },
  summary() {
    const xs = this.lateSamples.slice().sort((a, b) => a - b);
    const q = (p: number) => (xs.length ? xs[Math.min(xs.length - 1, Math.floor(p * xs.length))]! : 0);
    return { ticks: this.ticks, missing_intents: this.missing, late_p50_ms: +q(0.5).toFixed(2), late_p99_ms: +q(0.99).toFixed(2), late_max_ms: +this.maxLate.toFixed(2) };
  },
  reset(): void {
    this.ticks = 0;
    this.missing = 0;
    this.lateSamples = [];
    this.maxLate = 0;
  },
};

export interface MatchOutcome {
  room: MatchRoom;
  end: MatchEndMsg;
  replayPath: string;
}

/**
 * One practice match over the WebSocket (JSON). The match itself is a `LiveMatch` on the server clock, the same
 * loop the wire uses; this class renders it as JSON messages to the bound connection. Late, missing, or malformed
 * intents are WAIT.
 */
export class MatchRoom {
  readonly id: string;
  readonly token: string;
  readonly mode: Mode;
  readonly tier: Tier;
  readonly seed: number;
  readonly tickMs: number;
  readonly run: { id: string; index: number } | undefined;
  readonly startedAt = Date.now();
  readonly live: LiveMatch;
  private sink: MatchSink | null = null;
  private ended = false;
  onEnd: ((o: MatchOutcome) => void) | null = null;

  constructor(private readonly o: MatchOpts) {
    this.id = o.id;
    this.token = o.token;
    this.mode = o.mode;
    this.tier = o.tier;
    this.seed = o.seed >>> 0;
    this.tickMs = o.tickMs;
    this.run = o.run;
    this.live = new LiveMatch({
      id: o.id,
      seed: this.seed,
      tier: o.tier,
      mode: o.mode,
      transport: "ws",
      tickMs: o.tickMs,
      ...(o.maxTick !== undefined ? { maxTick: o.maxTick } : {}),
      ...(o.params ? { params: o.params } : {}),
      ...(o.log ? { log: o.log } : {}),
    });
    this.live.onOpen = () => this.send(stateFor(this.live.state, "you", { match_id: this.id, deadline_ms: this.tickMs }));
    this.live.onResolved = () => {
      metrics.ticks++;
      if (this.live.log.intent_status.endsWith("m") && this.sink) metrics.missing++;
    };
    this.live.onEnd = () => this.finish();
  }

  get state(): MatchState {
    return this.live.state;
  }
  get isEnded(): boolean {
    return this.ended;
  }
  get boundSink(): MatchSink | null {
    return this.sink;
  }

  private meta() {
    const m: Parameters<typeof matchStartFor>[2] = { match_id: this.id, mode: this.mode, tier: this.tier, tick_ms: this.tickMs };
    if (this.run) {
      m.run_id = this.run.id;
      m.run_index = this.run.index;
    }
    return m;
  }

  /** Bind the candidate's connection and (re)send `match_start` and the live state with the remaining deadline. */
  attach(sink: MatchSink, resend: boolean): void {
    this.sink = sink;
    if (resend && !this.ended) {
      sink.send(matchStartFor(this.state, "you", this.meta()));
      if (this.live.isStarted) sink.send(stateFor(this.state, "you", { match_id: this.id, deadline_ms: this.live.deadlineLeft() }));
    }
  }

  detach(sink: MatchSink): void {
    if (this.sink === sink) this.sink = null;
  }

  start(sink: MatchSink | null): void {
    this.sink = sink;
    sink?.send(matchStartFor(this.state, "you", this.meta()));
    this.live.start();
  }

  private send(msg: ServerMsg): void {
    if (this.sink && this.sink.open) this.sink.send(msg);
  }

  /** Accept the candidate's intent for the open tick. Returns an error code, or null on success. */
  submit(sink: MatchSink, tick: number, intent: Intent | null): "stale_tick" | "duplicate_intent" | "unknown_match" | null {
    if (this.ended || sink !== this.sink) return "unknown_match";
    const r = this.live.submit(tick, intent ?? { kind: "WAIT" });
    if (r === "accepted") return null;
    if (r === "duplicate") return "duplicate_intent";
    if (r === "ended") return "unknown_match";
    return "stale_tick";
  }

  /** The candidate left: play the rest out quickly with the candidate waiting. */
  forfeit(): void {
    this.live.forfeit();
  }

  private finish(): void {
    if (this.ended) return;
    this.ended = true;
    let replayPath = "";
    try {
      replayPath = writeReplay(this.o.replayDir, this.live.log);
    } catch (err) {
      this.o.log?.(`failed to write replay ${this.id}`, err);
    }
    const end = matchEndFor(this.state, "you", { match_id: this.id, replay: `/replay/${this.id}` });
    this.send(end);
    this.onEnd?.({ room: this, end, replayPath });
  }

  /** Stop without recording (server shutdown). */
  abort(): void {
    this.ended = true;
    this.live.abort();
  }

  result() {
    return { result: resultFor(this.state), scores: scores(this.state) };
  }

  /** Recorded log so far (for tests and live replays). */
  get replayLog(): ReplayLog {
    return this.live.log;
  }
}
