import type { ChaosName, GameEvent, Intent, Tier } from "@blackmaria/protocol";
import { RULESET_VERSION, createMatch, createRng, eventsFor, hashState, matchStartFor, normalizeIntent, stateFor, step, type MatchState, type Params, type Rng } from "@blackmaria/engine";
import { createHouseBot, type HouseBot } from "@blackmaria/house-bots";

/** Timers and the clock a live match runs on. Injected so tests can drive time. */
export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const realClock: Clock = {
  now: () => performance.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

/** How the candidate's move for one tick turned out (the wire health strip, SPEC 8; the profiler, SPEC 8.3). */
export type IntentStatus = "on_time" | "late" | "missing" | "malformed";
export const STATUS_CODE: Record<IntentStatus, string> = { on_time: "o", late: "l", missing: "m", malformed: "x" };

/** One chaos-layer action on one datagram (SPEC 5.6, 7). */
export interface ChaosEntry {
  /** ms since the match was created. */
  t: number;
  dir: "down" | "up";
  /** Wire packet type byte. */
  type: number;
  /** The tick the datagram belongs to, or -1. */
  tick: number;
  action: "deliver" | "drop" | "duplicate" | "reorder" | "blackhole";
  /** Added delay in ms, for delivered copies. */
  delay: number;
}

/** On-disk replay log (SPEC 7). Matches are replayable from (seed, tier, intents). */
export interface ReplayLog {
  match_id: string;
  seed: number;
  tier: Tier;
  mode: "practice" | "official";
  /** `local` is the simulator's in-process runner (`sim play`). */
  transport: "ws" | "wire" | "local";
  ruleset_version: string;
  max_tick: number;
  /** The engine parameters of this match (SPEC 3.9). */
  params: Params;
  tick_ms: number;
  started_at: number;
  ticks: { you: Intent; maria: Intent; events_you: GameEvent[]; events_maria: GameEvent[]; hash: string }[];
  /** One character per resolved tick: o on time, l late, m missing, x malformed. */
  intent_status: string;
  /** Resyncs answered, per tick index. */
  resyncs: Record<number, number>;
  /** How many ms after its deadline the first move for a tick arrived, for ticks that got no move in time. */
  late_ms?: Record<number, number>;
  chaos: ChaosEntry[];
  chaos_profile: string | null;
}

export type SubmitResult = "accepted" | "buffered" | "duplicate" | "late" | "wrong_tick" | "malformed" | "ended";

export interface LiveMatchOpts {
  id: string;
  seed: number;
  tier: Tier;
  mode: "practice" | "official";
  transport: "ws" | "wire";
  tickMs: number;
  maxTick?: number;
  clock?: Clock;
  /** Accept intents for up to this many ticks after the open one, buffered, first received wins (the wire: 10). */
  lookahead?: number;
  params?: Partial<Params>;
  /** The chaos profile on this match's link, as published in `params.chaos`. */
  chaos?: ChaosName;
  maria?: HouseBot;
  log?: (msg: string, err?: unknown) => void;
}

/**
 * One authoritative match on the server clock, independent of transport. `onOpen` fires when tick t opens:
 * the transport sends the state then, and the candidate has `tickMs` from that moment. Maria decides from her own
 * view right after the tick opens. At the deadline the tick resolves with whatever arrived in time; late, missing
 * or malformed intents are WAIT.
 */
export class LiveMatch {
  readonly id: string;
  readonly seed: number;
  readonly tier: Tier;
  readonly tickMs: number;
  readonly chaos: ChaosName;
  readonly createdAt = Date.now();
  state: MatchState;
  readonly log: ReplayLog;
  private readonly rng: Rng;
  private readonly maria: HouseBot;
  private readonly clock: Clock;
  private readonly lookahead: number;
  private readonly t0: number;
  private pending: Intent | null = null;
  private readonly ahead = new Map<number, Intent>();
  private lateSeen = false;
  private malformedSeen = false;
  private mariaIntent: Intent = { kind: "WAIT" };
  private openedAt = 0;
  /** When each recent tick opened, for moves that turn up after it resolved. */
  private readonly opened = new Map<number, number>();
  private timer: unknown = null;
  private started = false;
  private ended = false;
  private forfeiting = false;
  private readonly warn: (msg: string, err?: unknown) => void;

  onOpen: ((tick: number) => void) | null = null;
  onResolved: ((state: MatchState) => void) | null = null;
  onEnd: ((state: MatchState) => void) | null = null;

  constructor(o: LiveMatchOpts) {
    this.id = o.id;
    this.seed = o.seed >>> 0;
    this.tier = o.tier;
    this.tickMs = o.tickMs;
    this.clock = o.clock ?? realClock;
    this.lookahead = o.lookahead ?? 0;
    this.warn = o.log ?? (() => {});
    this.t0 = this.clock.now();
    this.state = createMatch(this.seed, { params: { ...(o.params ?? {}), ...(o.maxTick !== undefined ? { maxTick: o.maxTick } : {}) } });
    this.rng = createRng(this.seed);
    this.chaos = o.chaos ?? "off";
    this.maria = o.maria ?? createHouseBot(o.tier, matchStartFor(this.state, "maria", { match_id: o.id, mode: o.mode, tier: o.tier, tick_ms: o.tickMs, chaos: this.chaos }));
    this.log = {
      match_id: o.id,
      seed: this.seed,
      tier: o.tier,
      mode: o.mode,
      transport: o.transport,
      ruleset_version: RULESET_VERSION,
      max_tick: this.state.params.maxTick,
      params: { ...this.state.params },
      tick_ms: o.tickMs,
      started_at: this.createdAt,
      ticks: [],
      intent_status: "",
      resyncs: {},
      late_ms: {},
      chaos: [],
      chaos_profile: null,
    };
  }

  get isStarted(): boolean {
    return this.started;
  }
  get isEnded(): boolean {
    return this.ended;
  }
  get openTick(): number {
    return this.state.tick;
  }
  /** ms since the match object was created (the time base of the chaos log). */
  elapsed(): number {
    return this.clock.now() - this.t0;
  }
  /** ms left before the open tick's deadline (0 when past or not open). */
  deadlineLeft(): number {
    if (this.timer === null) return 0;
    return Math.max(0, Math.round(this.tickMs - (this.clock.now() - this.openedAt)));
  }

  start(): void {
    if (this.started || this.ended) return;
    this.started = true;
    this.open();
  }

  private open(): void {
    if (this.ended) return;
    const t = this.state.tick;
    this.pending = this.ahead.get(t) ?? null;
    this.ahead.delete(t);
    this.lateSeen = false;
    this.malformedSeen = false;
    this.openedAt = this.clock.now();
    this.opened.set(t, this.openedAt);
    if (this.opened.size > 64) this.opened.delete(this.opened.keys().next().value as number);
    this.timer = -1;
    this.onOpen?.(this.state.tick);
    this.mariaIntent = this.decideMaria();
    const left = Math.max(0, this.tickMs - (this.clock.now() - this.openedAt));
    this.timer = this.clock.setTimeout(() => this.resolve(), left);
  }

  private decideMaria(): Intent {
    try {
      return normalizeIntent(this.maria.decide(stateFor(this.state, "maria", { match_id: this.id, deadline_ms: this.tickMs })));
    } catch (err) {
      this.warn(`house bot error in ${this.id}`, err);
      return { kind: "WAIT" };
    }
  }

  /**
   * The candidate's move for `tick`, arriving now. The first valid move for a tick is final. `null` is a malformed
   * move: it changes nothing, but if no valid move arrives for the open tick, the tick is marked malformed.
   */
  submit(tick: number, intent: Intent | null): SubmitResult {
    if (this.ended || this.forfeiting) return "ended";
    const open = this.state.tick;
    if (intent === null) {
      if (this.started && this.timer !== null && tick === open && this.pending === null) this.malformedSeen = true;
      return "malformed";
    }
    if (this.started && this.timer !== null && tick === open) {
      if (this.clock.now() - this.openedAt > this.tickMs) {
        if (this.pending === null) {
          this.lateSeen = true;
          this.noteLate(tick, this.clock.now() - this.openedAt - this.tickMs);
        }
        return "late";
      }
      if (this.pending !== null) return "duplicate";
      this.pending = intent;
      return "accepted";
    }
    const first = this.started ? open + 1 : open;
    if (this.lookahead > 0 && tick >= first && tick <= open + this.lookahead) {
      if (this.ahead.has(tick)) return "duplicate";
      this.ahead.set(tick, intent);
      return "buffered";
    }
    if (tick < open) {
      const st = this.log.intent_status[tick];
      const at = this.opened.get(tick);
      if (st !== "o" && at !== undefined) this.noteLate(tick, this.clock.now() - at - this.tickMs);
      return st === "o" ? "duplicate" : "late";
    }
    return "wrong_tick";
  }

  /** The first move for `tick` came this many ms after its deadline. */
  private noteLate(tick: number, ms: number): void {
    const late = (this.log.late_ms ??= {});
    if (late[tick] === undefined) late[tick] = Math.max(0, Math.round(ms));
  }

  noteResync(): void {
    const t = this.state.tick;
    this.log.resyncs[t] = (this.log.resyncs[t] ?? 0) + 1;
  }

  noteChaos(e: Omit<ChaosEntry, "t">): void {
    if (this.log.chaos.length < 50_000) this.log.chaos.push({ t: Math.round(this.elapsed()), ...e });
  }

  private resolve(): void {
    this.timer = null;
    if (this.ended) return;
    const status: IntentStatus = this.pending !== null ? "on_time" : this.lateSeen ? "late" : this.malformedSeen ? "malformed" : "missing";
    this.apply(this.pending ?? { kind: "WAIT" }, this.mariaIntent, status);
    if (this.state.done) this.finish();
    else this.open();
  }

  private apply(you: Intent, maria: Intent, status: IntentStatus): void {
    const next = step(this.state, { you, maria }, this.rng);
    this.log.ticks.push({ you, maria, events_you: eventsFor(next, "you"), events_maria: eventsFor(next, "maria"), hash: hashState(next) });
    this.log.intent_status += STATUS_CODE[status];
    this.state = next;
    this.onResolved?.(next);
  }

  /** The candidate left a practice match: play the rest out at once with the candidate waiting. */
  forfeit(): void {
    if (this.ended || this.forfeiting) return;
    this.forfeiting = true;
    if (this.timer !== null && this.timer !== -1) this.clock.clearTimeout(this.timer);
    this.timer = null;
    const chunk = () => {
      if (this.ended) return;
      for (let k = 0; k < 25 && !this.state.done; k++) this.apply({ kind: "WAIT" }, this.decideMaria(), "missing");
      if (this.state.done) this.finish();
      else setImmediate(chunk);
    };
    chunk();
  }

  private finish(): void {
    if (this.ended) return;
    this.ended = true;
    if (this.timer !== null && this.timer !== -1) this.clock.clearTimeout(this.timer);
    this.timer = null;
    this.onEnd?.(this.state);
  }

  /** Stop without finishing (server shutdown). */
  abort(): void {
    this.ended = true;
    if (this.timer !== null && this.timer !== -1) this.clock.clearTimeout(this.timer);
    this.timer = null;
  }
}
