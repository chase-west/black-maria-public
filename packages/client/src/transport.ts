/**
 * The transport: everything between the UDP socket and your bot. It owns the socket, HELLO and the port fallback,
 * MATCH_START fragments, keyframes and deltas, acks, RESYNC, PING, and the timing of every tick. It hands your bot a
 * state and sends back what the bot decides.
 *
 * Five hooks are where you change it. Override them in a subclass, or export them from your --bot file (see the
 * README). The shipped ones are the naive ones.
 *
 *   onPacket(packet)                    every decoded packet, before the transport handles it
 *   shouldResync(delta)                 every delta STATE: by the keyframe it names, or onto the last state
 *   predictState(lastState, pending)    a tick's STATE hasn't arrived halfway to its deadline
 *   planMoves(state)                    each state: the move, or a list of moves for this tick and the ones after
 *   onTick(record)                      a tick is settled: its trace record
 *
 * The same transport, with the same hooks, is in python/transport.py. One socket carries everything, so the three
 * matches of the official run share it.
 */
import { createSocket, type Socket } from "node:dgram";
import type { Intent, ItemKind, MatchEndMsg, MatchStartMsg, StateMsg } from "@blackmaria/protocol";
import {
  KEYFRAME,
  Reassembler,
  applyFields,
  decode,
  decodeBlob,
  encode,
  intentToWire,
  itemKindsOf,
  matchStartFromBlob,
  snapshotFromKeyframe,
  stateFromSnapshot,
  traceHeader,
  traceLine,
  type ConnSummary,
  type Packet,
  type TickRecord,
  type WireSnapshot,
} from "@blackmaria/protocol/wire";
import { Meter } from "./meter.js";

/** Hard-coded, like everything the bot sees. The match start has the real numbers. */
const TICK_MS = 250;
const PING_EVERY_MS = 1000;
const HELLO_EVERY_MS = 500;
/** SPEC 5.2: if no HELLO_ACK arrives within 2 s on a port, try the next one. */
const PORT_FALLBACK_MS = 2000;
/** The server answers at most one RESYNC per 100 ms per match. */
const RESYNC_MIN_MS = 100;
const LEAVE_EVERY_MS = 200;
/** How far into a tick (as a share of its deadline) predictState is called when its STATE hasn't come. */
const PREDICT_AT = 0.5;
/** How many ticks past the last STATE to keep predicting. */
const PREDICT_RUN = 40;
/** At most this many moves from one planMoves call. */
const MAX_PLANNED = 16;
const KEYFRAMES_KEPT = 8;
const SENT_KEPT = 64;

const TIERS = ["novice", "adept", "master"] as const;
const TITLE = { novice: "Novice", adept: "Adept", master: "Master" } as const;
const WAIT: Intent = { kind: "WAIT" };

/** Your bot: the same shape on the wire, in the simulator, and in the browser. */
export interface Bot {
  onStart?(start: MatchStartMsg): void;
  decide(state: StateMsg): Intent;
  onEnd?(end: Pick<MatchEndMsg, "result" | "scores">): void;
}

/** A decoded packet from the server, with its seq. Fields as in docs/WIRE.md, camelCase. */
export type WirePacket = Packet & { seq: number };

/** What `shouldResync` is asked about: a delta STATE, and whether the keyframe it names is held. */
export interface Delta {
  match: number;
  tick: number;
  base: number;
  have_base: boolean;
}

/** The five hooks. Every one has a naive default on `Transport`. */
export interface Hooks {
  /** Every decoded packet, before the transport handles it. False drops it. */
  onPacket(packet: WirePacket): boolean | void;
  /** Every delta STATE. True applies it to the keyframe it names (or sends RESYNC and skips it without that keyframe); false applies it to the last state built. */
  shouldResync(delta: Delta): boolean;
  /** A tick's STATE hasn't arrived halfway to its deadline. A state returned goes to planMoves; null sends nothing. */
  predictState(lastState: StateMsg, pendingMoves: Intent[]): StateMsg | null;
  /** A move for `state.tick`, or a list of moves for state.tick, state.tick + 1, and so on. */
  planMoves(state: StateMsg): Intent | Intent[];
  /** A tick is settled: its trace record. */
  onTick(record: TickRecord): void;
}
export const HOOK_NAMES = ["onPacket", "shouldResync", "predictState", "planMoves", "onTick"] as const satisfies readonly (keyof Hooks)[];

export interface TransportOptions {
  host: string;
  /** Tried in order; the next one after 2 s without a HELLO_ACK (SPEC 5.2). */
  ports: number[];
  /** The 16 raw bytes of your token. */
  token: Uint8Array;
  official: boolean;
  tier: 0 | 1 | 2;
  /** Practice only: 0 off, 1 to 3 that tier's network profile. */
  chaos: 0 | 1 | 2 | 3;
  /** Practice: how many matches to play one after another. The official run is always 9. */
  matches: number;
  bot: () => Bot;
  /** Give up if the server never answers (ms). */
  connectTimeoutMs?: number;
  log?: (line: string) => void;
  /** Every HELLO_ACK: official runs left, seconds left on your clock (0xFFFFFFFF: no clock), the change (0 none yet). */
  onHelloAck?: (a: { attemptsLeft: number; clockS: number; ruleChange: number }) => void;
  /** Print a line per tick (the default onTick) through `out`. */
  trace?: boolean;
  /** Where trace lines go (default: `log`). */
  out?: (line: string) => void;
  /** Every match's summary block, when it ends. */
  onSummary?: (s: ConnSummary, m: MatchSummary) => void;
  /** `doctor`: leave each match after this many ticks and measure only those. */
  probeTicks?: number;
}
/** The old name. */
export type ClientOptions = TransportOptions;

export interface MatchSummary {
  match: number;
  tier: "novice" | "adept" | "master";
  result: "win" | "draw" | "loss";
  you: number;
  maria: number;
  states: number;
  moves: number;
  conn: ConnSummary;
}

/** The server said no, or never answered. `message` is a sentence for the candidate. */
export class ClientError extends Error {
  constructor(
    message: string,
    readonly code: number | null,
  ) {
    super(message);
  }
}

type StatePacket = Extract<Packet, { type: "STATE" }>;

interface Match {
  id: number;
  re: Reassembler;
  start: MatchStartMsg | null;
  kinds: Map<number, ItemKind>;
  bot: Bot | null;
  /** The state the last STATE built, whatever its tick. */
  latest: WireSnapshot | null;
  /** Keyframes by tick, the newest few. */
  keyframes: Map<number, WireSnapshot>;
  /** The state for the newest tick, as the bot saw it. */
  lastState: StateMsg | null;
  /** The first move sent for each recent tick. */
  sent: Map<number, Intent>;
  lastResync: number;
  ended: boolean;
  leaving: boolean;
  states: number;
  moves: number;
  early: { p: StatePacket; at: number; gap: number }[];
  predictTimer: ReturnType<typeof setTimeout> | null;
  leaveTimer: ReturnType<typeof setInterval> | null;
  traced: boolean;
}

export class Transport implements Hooks {
  private sock: Socket | null = null;
  private seq = 0;
  private ackIn = 0;
  private session = 0;
  private port: number;
  private portIndex = 0;
  private readonly matches = new Map<number, Match>();
  private readonly done: MatchSummary[] = [];
  private started = 0;
  private helloTimer: ReturnType<typeof setInterval> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private fallbackTimer: ReturnType<typeof setTimeout> | null = null;
  private giveUpTimer: ReturnType<typeof setTimeout> | null = null;
  private finish: ((s: MatchSummary[]) => void) | null = null;
  private fail: ((e: Error) => void) | null = null;
  private closed = false;
  private readonly want: number;
  protected readonly log: (line: string) => void;
  /** Where trace lines go: `--trace` prints through this. */
  readonly out: (line: string) => void;
  /** The measurements behind `--trace` and the summary block. */
  readonly meter: Meter;

  constructor(protected readonly o: TransportOptions) {
    if (o.ports.length === 0) throw new ClientError("No wire ports to try.", null);
    this.port = o.ports[0]!;
    this.want = o.official ? 9 : Math.max(1, o.matches);
    this.log = o.log ?? (() => {});
    this.out = o.out ?? this.log;
    this.meter = new Meter((r) => this.settled(r));
  }

  // ---------------------------------------------------------------------------------------------------------------
  // The hooks.

  /** Called with every decoded packet before the transport handles it; returning false drops it. Shipped: README weakness 3. */
  onPacket(_packet: WirePacket): boolean | void {
    return true;
  }

  /**
   * Called with every delta STATE; true applies it to the keyframe it names, or sends RESYNC and skips it when that
   * keyframe isn't held; false applies it to the last state built. Shipped: README weakness 2.
   */
  shouldResync(_delta: Delta): boolean {
    return false;
  }

  /**
   * Called when a tick's deadline is half gone and its STATE has not arrived, with the last state and the moves sent
   * since; a state returned is passed to planMoves, null sends nothing. Shipped: README weakness 1.
   */
  predictState(_lastState: StateMsg, _pendingMoves: Intent[]): StateMsg | null {
    return null;
  }

  /**
   * Called with each state; returns a move for `state.tick`, or a list of moves sent for ticks state.tick,
   * state.tick + 1, and so on. Shipped: README weakness 1 (it calls your bot's decide once).
   */
  planMoves(state: StateMsg): Intent | Intent[] {
    const bot = this.botFor(state.match_id);
    return bot ? bot.decide(state) : WAIT;
  }

  /** Called once per settled tick with its trace record; the shipped one prints it with --trace. */
  onTick(record: TickRecord): void {
    if (this.trace) this.out(traceLine(record));
  }

  // ---------------------------------------------------------------------------------------------------------------

  /** Whether `--trace` is on. */
  get trace(): boolean {
    return this.o.trace ?? false;
  }

  /** The port the server answered on (after `run` has connected). */
  get connectedPort(): number {
    return this.port;
  }

  /** The bot playing a match, by its match id (the `match_id` in its states). */
  botFor(matchId: string): Bot | null {
    return this.matches.get(Number(matchId))?.bot ?? null;
  }

  /** Play every match, then resolve with their results in the order they ended. */
  run(): Promise<MatchSummary[]> {
    return new Promise((resolve, reject) => {
      this.finish = resolve;
      this.fail = reject;
      const sock = createSocket("udp4");
      this.sock = sock;
      sock.on("message", (msg) => this.onDatagram(new Uint8Array(msg.buffer, msg.byteOffset, msg.byteLength)));
      sock.on("error", (e) => this.stop(new ClientError(`The UDP socket failed: ${e.message}`, null)));
      sock.bind(0, () => this.hello());
      this.giveUpTimer = setTimeout(
        () => this.stop(new ClientError(`No answer from the server at ${this.o.host} on UDP port ${this.o.ports.join(" or ")}. Check the host and that your network lets UDP out.`, null)),
        this.o.connectTimeoutMs ?? 20_000,
      );
    });
  }

  private send(packet: Packet): void {
    if (!this.sock || this.closed) return;
    this.seq = (this.seq + 1) >>> 0;
    this.sock.send(encode({ session: this.session, seq: this.seq, ack: this.ackIn, packet }), this.port, this.o.host);
  }

  private hello(): void {
    const send = () => this.send({ type: "HELLO", token: this.o.token, mode: this.o.official ? 1 : 0, tier: this.o.tier, chaos: this.o.chaos });
    this.session = 0;
    send();
    if (this.helloTimer) clearInterval(this.helloTimer);
    this.helloTimer = setInterval(send, HELLO_EVERY_MS);
    if (this.fallbackTimer) clearTimeout(this.fallbackTimer);
    this.fallbackTimer = setTimeout(() => this.nextPort(), PORT_FALLBACK_MS);
  }

  /** No HELLO_ACK in 2 s: try the next port (7777, then 443). */
  private nextPort(): void {
    if (this.session !== 0 || this.closed) return;
    this.portIndex = (this.portIndex + 1) % this.o.ports.length;
    const next = this.o.ports[this.portIndex]!;
    if (next !== this.port) this.log(`No answer on UDP port ${this.port}; trying port ${next}.`);
    this.port = next;
    this.hello();
  }

  private onDatagram(buf: Uint8Array): void {
    const at = performance.now();
    const d = decode(buf);
    if (!d) return;
    if (d.seq > this.ackIn) this.ackIn = d.seq;
    const seen = this.meter.datagram(d.seq, at);
    let keep = true;
    try {
      keep = this.onPacket({ ...d.packet, seq: d.seq }) !== false;
    } catch (err) {
      this.log(`onPacket threw: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!keep) {
      if (seen.kind === "duplicate") this.meter.ignoredDuplicate();
      return;
    }
    const p = d.packet;
    switch (p.type) {
      case "HELLO_ACK":
        if (this.session === 0 && this.giveUpTimer) clearTimeout(this.giveUpTimer);
        this.session = p.session;
        if (this.helloTimer) clearInterval(this.helloTimer);
        if (this.fallbackTimer) clearTimeout(this.fallbackTimer);
        this.helloTimer = null;
        this.fallbackTimer = null;
        if (!this.pingTimer) this.pingTimer = setInterval(() => this.send({ type: "PING", clientMs: Math.floor(performance.now()) >>> 0 }), PING_EVERY_MS);
        this.o.onHelloAck?.({ attemptsLeft: p.attemptsLeft, clockS: p.clockS, ruleChange: p.ruleChange });
        return;
      case "MATCH_START":
        return this.onFragment(p);
      case "STATE":
        return this.onState(p, at, seen.gap);
      case "MATCH_END":
        return this.onEnd(p);
      case "PONG":
        if (seen.kind !== "duplicate") this.meter.pong(((Math.floor(at) >>> 0) - p.clientMs) >>> 0);
        return;
      case "ERROR":
        return this.onError(p.code, p.msg);
      default:
        return;
    }
  }

  private onError(code: number, msg: string): void {
    // 1 bad token, 2 clock expired, 3 no attempts: nothing to retry.
    if (code === 1 || code === 2 || code === 3) return this.stop(new ClientError(msg, code));
    // 7: the session was closed (for example after a long silence). Open a new one; an official run resumes.
    if (code === 7) {
      this.log("Server closed the session. Reconnecting.");
      this.hello();
    }
  }

  private match(id: number): Match {
    let m = this.matches.get(id);
    if (!m) {
      m = { id, re: new Reassembler(), start: null, kinds: new Map(), bot: null, latest: null, keyframes: new Map(), lastState: null, sent: new Map(), lastResync: -Infinity, ended: false, leaving: false, states: 0, moves: 0, early: [], predictTimer: null, leaveTimer: null, traced: false };
      this.matches.set(id, m);
    }
    return m;
  }

  private onFragment(p: Extract<Packet, { type: "MATCH_START" }>): void {
    const m = this.match(p.match);
    this.send({ type: "ACK_FRAG", match: p.match, frag: p.frag });
    if (m.start || m.ended) return;
    const whole = m.re.add(p.frag, p.fragCount, p.data);
    if (!whole) return;
    const blob = decodeBlob(whole);
    if (!blob) return;
    m.start = matchStartFromBlob(blob, { match_id: String(p.match), mode: this.o.official ? "official" : "practice" });
    m.kinds = itemKindsOf(m.start);
    m.bot = this.o.bot();
    m.bot.onStart?.(m.start);
    this.started++;
    this.log(`Match ${p.match} started against Maria (${TITLE[m.start.tier]}).`);
    for (const s of m.early.splice(0)) this.onState(s.p, s.at, s.gap);
  }

  private onState(p: StatePacket, at: number, gap: number): void {
    const m = this.match(p.match);
    if (m.ended || m.leaving) return;
    if (!m.start) {
      if (m.early.length < 32) m.early.push({ p, at, gap });
      return;
    }
    m.states++;
    this.meter.state(p.match, p.tick, at, p.deadlineMs, m.start.params.tick_ms, gap);
    if (this.o.probeTicks !== undefined && p.tick >= this.o.probeTicks) return this.leave(m);
    let snap: WireSnapshot | null = null;
    if (p.base === KEYFRAME) {
      snap = snapshotFromKeyframe(p);
      if (snap) {
        m.keyframes.set(p.tick, snap);
        if (m.keyframes.size > KEYFRAMES_KEPT) m.keyframes.delete(m.keyframes.keys().next().value as number);
      }
    } else {
      const base = m.keyframes.get(p.base) ?? null;
      let byTheBook = false;
      try {
        byTheBook = this.shouldResync({ match: p.match, tick: p.tick, base: p.base, have_base: base !== null });
      } catch (err) {
        this.log(`shouldResync threw: ${err instanceof Error ? err.message : String(err)}`);
      }
      if (byTheBook) {
        // By the book: onto the keyframe it names, or, without that keyframe, ask for a new one and skip this delta.
        if (base) snap = applyFields(base, p, false);
        else this.resync(m, p.tick);
      } else if (m.latest) {
        // Shipped: onto whatever state we had last, base or not. Without the base, that's driving blind.
        snap = applyFields(m.latest, p, false);
        if (!base) this.meter.blind(p.match);
      }
    }
    if (!snap || !m.bot) return;
    m.latest = snap;
    const state = stateFromSnapshot(m.start, snap, p.events ?? [], { tick: p.tick, deadline_ms: TICK_MS }, m.kinds);
    if (!m.lastState || p.tick >= m.lastState.tick) m.lastState = state;
    // A line every 100 ticks, so a 100-second match is not 100 seconds of silence.
    if (p.tick > 0 && p.tick % 100 === 0) this.log(`Match ${p.match}: tick ${p.tick} of ${m.start.params.max_tick}, you ${state.scores.you}, Maria ${state.scores.maria}.`);
    this.act(m, state);
    this.schedulePredict(m, this.meter.maxTick(m.id) + 1);
  }

  /** Ask the bot (through planMoves) and send what it plans, one INTENT per tick. */
  private act(m: Match, state: StateMsg): void {
    const t0 = performance.now();
    let planned: Intent | Intent[] = WAIT;
    try {
      planned = this.planMoves(state);
    } catch (err) {
      this.log(`Your bot threw on tick ${state.tick}: ${err instanceof Error ? err.message : String(err)}`);
    }
    const think = performance.now() - t0;
    const moves = Array.isArray(planned) ? planned.slice(0, MAX_PLANNED) : [planned];
    moves.forEach((move, k) => this.sendMove(m, state.tick + k, move ?? WAIT, think));
  }

  private sendMove(m: Match, tick: number, move: Intent, think: number): void {
    m.moves++;
    this.send({ type: "INTENT", match: m.id, tick, intent: intentToWire(move) });
    if (!m.sent.has(tick)) {
      m.sent.set(tick, move);
      if (m.sent.size > SENT_KEPT) m.sent.delete(m.sent.keys().next().value as number);
    }
    this.meter.moveSent(m.id, tick, performance.now(), think);
  }

  /** Halfway into `tick`'s deadline, if its STATE still hasn't come and nothing went out for it, ask predictState. */
  private schedulePredict(m: Match, tick: number): void {
    if (m.predictTimer) clearTimeout(m.predictTimer);
    m.predictTimer = null;
    const start = this.meter.deadlineStart(m.id, tick);
    if (start === null || m.ended || m.leaving || this.closed) return;
    const deadline = m.start?.params.tick_ms ?? TICK_MS;
    m.predictTimer = setTimeout(() => this.predictTick(m, tick), Math.max(0, start + deadline * PREDICT_AT - performance.now()));
  }

  private predictTick(m: Match, tick: number): void {
    m.predictTimer = null;
    if (m.ended || m.leaving || this.closed || !m.lastState) return;
    if (this.meter.maxTick(m.id) >= tick) return;
    if (!m.sent.has(tick)) {
      const pending: Intent[] = [];
      for (let t = m.lastState.tick; t < tick; t++) pending.push(m.sent.get(t) ?? WAIT);
      let guess: StateMsg | null = null;
      try {
        guess = this.predictState(m.lastState, pending);
      } catch (err) {
        this.log(`predictState threw: ${err instanceof Error ? err.message : String(err)}`);
      }
      if (guess) this.act(m, { ...guess, tick });
    }
    if (tick - this.meter.maxTick(m.id) < PREDICT_RUN) this.schedulePredict(m, tick + 1);
  }

  private resync(m: Match, tick: number): void {
    const now = performance.now();
    if (now - m.lastResync < RESYNC_MIN_MS) return;
    m.lastResync = now;
    this.send({ type: "RESYNC", match: m.id });
    this.meter.resync(m.id, tick);
  }

  /** `doctor`: the probe is over. Leave the match (the server plays it out) and say so until MATCH_END comes. */
  private leave(m: Match): void {
    if (m.leaving) return;
    m.leaving = true;
    if (m.predictTimer) clearTimeout(m.predictTimer);
    m.predictTimer = null;
    const send = () => this.send({ type: "LEAVE", match: m.id });
    send();
    m.leaveTimer = setInterval(send, LEAVE_EVERY_MS);
  }

  /** The meter settled a tick: the trace header once per match, then the hook. */
  private settled(r: TickRecord): void {
    const m = this.matches.get(r.match);
    if (this.o.trace && m && !m.traced) {
      m.traced = true;
      this.out(traceHeader());
    }
    try {
      this.onTick(r);
    } catch (err) {
      this.log(`onTick threw: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private onEnd(p: Extract<Packet, { type: "MATCH_END" }>): void {
    const m = this.match(p.match);
    if (m.ended) return; // MATCH_END comes three times; count it once.
    m.ended = true;
    for (const t of [m.predictTimer]) if (t) clearTimeout(t);
    if (m.leaveTimer) clearInterval(m.leaveTimer);
    m.predictTimer = null;
    m.leaveTimer = null;
    const result = p.result === 2 ? "win" : p.result === 1 ? "draw" : "loss";
    m.bot?.onEnd?.({ result, scores: { you: p.scoreYou, maria: p.scoreMaria } });
    const tier = TIERS[m.start ? TIERS.indexOf(m.start.tier) : this.o.tier] ?? "novice";
    const network = m.start?.params.chaos ?? "off";
    const conn = this.meter.end(p.match, `Connection, match ${p.match} against Maria (${TITLE[tier]}), network ${network}:`, this.o.probeTicks ?? null);
    const summary: MatchSummary = { match: p.match, tier, result, you: p.scoreYou, maria: p.scoreMaria, states: m.states, moves: m.moves, conn };
    this.done.push(summary);
    this.log(`Match ${p.match} ended.`);
    this.o.onSummary?.(conn, summary);
    if (this.done.length >= this.want) return this.stop(null);
    if (!this.o.official && this.started < this.want) this.hello();
  }

  private stop(err: Error | null): void {
    if (this.closed) return;
    this.closed = true;
    for (const t of [this.helloTimer, this.pingTimer]) if (t) clearInterval(t);
    for (const t of [this.fallbackTimer, this.giveUpTimer]) if (t) clearTimeout(t);
    for (const m of this.matches.values()) {
      if (m.predictTimer) clearTimeout(m.predictTimer);
      if (m.leaveTimer) clearInterval(m.leaveTimer);
    }
    try {
      this.sock?.close();
    } catch {
      /* already closed */
    }
    this.sock = null;
    if (err) this.fail?.(err);
    else this.finish?.(this.done);
  }

  /** Stop at once (Ctrl-C). */
  close(): void {
    this.stop(null);
  }
}

/** Put hook functions (from a --bot file) onto a transport. Each is called with the transport as `this`. */
export function applyHooks(t: Transport, hooks: Partial<Hooks>): void {
  for (const name of HOOK_NAMES) {
    const fn = hooks[name];
    if (typeof fn === "function") Object.defineProperty(t, name, { value: (fn as (...a: unknown[]) => unknown).bind(t), writable: true, configurable: true });
  }
}
