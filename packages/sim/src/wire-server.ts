import { randomBytes } from "node:crypto";
import { createSocket, type RemoteInfo, type Socket } from "node:dgram";
import type { Tier } from "@blackmaria/protocol";
import {
  ERR,
  ERROR_TEXT,
  KEYFRAME,
  PT,
  decode,
  deltaFields,
  encode,
  encodeBlob,
  fitStateFields,
  fragment,
  intentFromWire,
  keyframeFields,
  snapshotFromKeyframe,
  stateDatagramSize,
  MAX_DATAGRAM,
  type Datagram,
  type ErrCode,
  type Packet,
  type WireEvent,
  type WireSnapshot,
} from "@blackmaria/protocol/wire";
import { matchBlobFor, resultFor, scores, snapshotFor, wireEventsFor, type MatchState, type Params } from "@blackmaria/engine";
import type { SeqRng } from "@blackmaria/engine";
import { BLACKHOLE_MS, CHAOS, ChaosLink, HARSHNESS, blackholeTick, chaosRng, type ChaosProfile } from "./chaos.js";
import { LiveMatch, realClock, type Clock, type ReplayLog } from "./live.js";

export const TIERS: readonly Tier[] = ["novice", "adept", "master"];
/** Official run order (SPEC 2, 5.7): 3 Novice, then 3 Adept, then 3 Master, one tier at a time. */
export const RUN_PER_TIER = 3;
export const RUN_MATCHES = 9;
export const RUN_CONCURRENT = 3;
export const runTier = (index: number): Tier => TIERS[Math.min(2, Math.floor(index / RUN_PER_TIER))]!;
/** Intents are accepted for the open tick and up to this many ticks after it (SPEC 5.2). */
export const INTENT_LOOKAHEAD = 10;
export const KEYFRAME_EVERY = 20;
export const FRAG_RESEND_MS = 100;
export const FRAG_GIVE_UP_MS = 2000;
export const RESYNC_MIN_MS = 100;
export const SILENCE_CLOSE_MS = 10_000;
export const ENDED_KEEP_MS = 10_000;
export const MATCH_END_REPEATS = [0, 100, 200];

/** What a deployment plugs in: tokens, the clock, limits, seeds, and where results go. */
export interface WireHost {
  /** The token for these 16 raw bytes, or null if unknown. */
  authenticate(raw: Uint8Array): string | null;
  /** Seconds left on the token's clock; null when there is no clock (the local simulator). */
  clockLeftS(token: string): number | null;
  attemptsLeft(token: string): number;
  /** Null if the token may start a practice match now, otherwise the ERROR code to send. */
  practiceAllowed(token: string, liveForToken: number): ErrCode | null;
  practiceSeed(token: string, tier: Tier): number;
  /**
   * Start the token's one official run: its 9 seeds and a run id, or the ERROR to send (3 used, 2 past minute 85), with
   * an optional sentence that replaces the code's standard one.
   */
  beginRun(token: string): { runId: string; seeds: number[] } | ErrCode | { code: ErrCode; msg: string };
  /**
   * The rules in force for this token right now (SPEC 2.2): engine parameters that differ from the defaults, which
   * change has been revealed (0 none yet), and a chaos profile that replaces every tier's, if the change says so.
   * Defaults when absent.
   */
  rules?(token: string): WireRules;
  newMatchId(): string;
  matchStarted?(m: WireMatchInfo): void;
  matchEnded?(m: WireMatchInfo, state: MatchState, log: ReplayLog): void;
  runFinished?(runId: string, token: string, results: RunResult[]): void;
  /** Every resolved tick of every match (for live viewers). */
  tick?(m: WireMatchInfo, state: MatchState): void;
  log?(msg: string, err?: unknown): void;
}

export interface WireRules {
  params: Partial<Params>;
  ruleChange: number;
  chaosOverride: Tier | null;
}
export const DEFAULT_RULES: WireRules = { params: {}, ruleChange: 0, chaosOverride: null };

export interface RunResult {
  index: number;
  tier: Tier;
  result: "win" | "draw" | "loss";
  matchId: string;
}

export interface WireMatchInfo {
  id: string;
  wireId: number;
  token: string;
  mode: "practice" | "official";
  tier: Tier;
  seed: number;
  run: { id: string; index: number } | null;
  live: LiveMatch;
}

export interface WireServerOpts {
  host: WireHost;
  tickMs: number;
  maxTick?: number;
  clock?: Clock;
  /** Force a chaos profile on every practice session (`sim wire --chaos master`). */
  forceChaos?: Tier | null;
  limits?: Partial<WireLimits>;
  /** Watches every datagram in both directions (the simulator's `sim wire --check`). */
  observer?: WireObserver;
  /**
   * `sim wire --check` only: the STATE for each tick this returns true for is withheld from every match, and the next
   * tick's STATE is a delta against it, so a client that does not hold the base it names must resync.
   */
  probe?: ((tick: number) => boolean) | null;
  /** Every chaos-layer action as it happens (`sim wire --log`). Only links with a network profile have any. */
  onChaos?: ((e: ChaosEvent) => void) | null;
}

/** One chaos-layer action on one datagram, as it happens. */
export interface ChaosEvent {
  match: WireMatchInfo;
  dir: "down" | "up";
  /** Wire packet type byte (0 for the start of a blackhole). */
  type: number;
  /** The tick the datagram belongs to, or -1. */
  tick: number;
  /** The datagram's seq in its direction (0 for the start of a blackhole). */
  seq: number;
  action: "deliver" | "drop" | "duplicate" | "reorder" | "blackhole";
  /** The delay of each delivered copy, in ms. */
  delays: number[];
}

/** Hooks for the checklist: what came in before the chaos layer, and what actually left through it. */
export interface WireObserver {
  /** A client datagram that decoded, as it arrived, before the chaos layer. `key` is `address:port`. */
  inbound?(key: string, d: Datagram, at: number): void;
  /** A server datagram as it left the chaos layer for the socket. */
  delivered?(key: string, seq: number, packet: Packet, at: number): void;
  /** Return true to withhold a server datagram entirely (it still takes a seq, like a loss). */
  hold?(key: string, packet: Packet): boolean;
  /** A client datagram as the server acts on it, after the chaos layer. */
  processed?(key: string, d: Datagram, at: number): void;
  /** A match's tick opened: its deadline starts now. */
  tickOpened?(key: string, wireId: number, tick: number, at: number): void;
}

export interface WireLimits {
  maxSessions: number;
  sessionsPerIp: number;
  datagramsPerSecond: number;
  datagramBurst: number;
}
const DEFAULT_LIMITS: WireLimits = { maxSessions: 2048, sessionsPerIp: 16, datagramsPerSecond: 400, datagramBurst: 800 };

interface SentInfo {
  match: WireMatch;
  tick: number;
  keyframe: boolean;
}

class Session {
  seqOut = 0;
  ackIn = 0;
  lastHeard: number;
  readonly matches = new Map<number, WireMatch>();
  readonly ended = new Map<number, { bytes: Packet; until: number }>();
  readonly sent = new Map<number, SentInfo>();
  readonly down: ChaosLink;
  readonly up: ChaosLink;
  readonly rngDown: SeqRng;
  readonly rngUp: SeqRng;
  lastErr6 = -Infinity;
  lastErr4 = -Infinity;
  lastErr2 = -Infinity;
  closed = false;
  /** The socket the client last reached us on (the server listens on more than one port); replies go out through it. */
  via: Socket | null = null;
  constructor(
    readonly id: number,
    readonly token: string,
    readonly address: string,
    readonly port: number,
    readonly practiceChaos: ChaosProfile | null,
    clock: Clock,
  ) {
    this.lastHeard = clock.now();
    this.down = new ChaosLink(clock);
    this.up = new ChaosLink(clock);
    this.rngDown = chaosRng(id * 2654435761, "down");
    this.rngUp = chaosRng(id * 2654435761, "up");
  }
  get key(): string {
    return `${this.address}:${this.port}`;
  }
  /** The profile for datagrams that belong to no match: the harshest of this session's live matches. */
  harshest(): WireMatch | null {
    let best: WireMatch | null = null;
    for (const m of this.matches.values()) if (m.profile && (!best || HARSHNESS[m.profile.name] > HARSHNESS[best.profile!.name])) best = m;
    return best;
  }
}

class WireMatch implements WireMatchInfo {
  session: Session | null;
  readonly frags: Uint8Array[];
  fragAcked: boolean[];
  fragSince = 0;
  fragTimer: unknown = null;
  readonly keyframes = new Map<number, WireSnapshot>();
  ackedBase: number | null = null;
  lastResync = -Infinity;
  lastErr5Tick = -1;
  /** `--check`: the withheld tick the next delta is built against. */
  probeBase: number | null = null;
  curTick = -1;
  curSnap: WireSnapshot | null = null;
  curEvents: WireEvent[] = [];
  readonly rngDown: SeqRng;
  readonly rngUp: SeqRng;
  readonly blackholeAt: number;
  constructor(
    readonly id: string,
    readonly wireId: number,
    readonly token: string,
    readonly mode: "practice" | "official",
    readonly tier: Tier,
    readonly seed: number,
    readonly run: { id: string; index: number } | null,
    readonly live: LiveMatch,
    readonly profile: ChaosProfile | null,
    session: Session | null,
    seedHint: number,
  ) {
    this.session = session;
    this.frags = fragment(encodeBlob(matchBlobFor(live.state, tier, seedHint, { tick_ms: live.tickMs, chaos: profile?.name ?? "off" })));
    this.fragAcked = this.frags.map(() => false);
    this.rngDown = chaosRng(seed, "down", wireId);
    this.rngUp = chaosRng(seed, "up", wireId);
    this.blackholeAt = blackholeTick(seed);
  }
}

interface Run {
  id: string;
  token: string;
  seeds: number[];
  next: number;
  active: Set<WireMatch>;
  results: RunResult[];
  session: Session | null;
  finished: boolean;
}

interface Bucket {
  tokens: number;
  at: number;
}

/**
 * The UDP wire server (SPEC 5.2 to 5.7). One session per (token, source address). Survives any datagram:
 * everything that is not exactly valid is dropped, and every per-address structure is bounded.
 */
export class WireServer {
  private readonly sockets: Socket[] = [];
  private readonly clock: Clock;
  private readonly t0: number;
  private readonly sessions = new Map<string, Session>();
  private readonly sessionIds = new Set<number>();
  private readonly runs = new Map<string, Run>();
  private readonly wireIds = new Map<number, WireMatch>();
  private readonly buckets = new Map<string, Bucket>();
  private nextWireId = 1;
  private sweepTimer: ReturnType<typeof setInterval> | null = null;
  private readonly limits: WireLimits;
  readonly host: WireHost;
  readonly tickMs: number;
  readonly maxTick: number;
  private readonly forceChaos: Tier | null;
  private readonly observer: WireObserver | null;
  private readonly probe: ((tick: number) => boolean) | null;
  private readonly onChaos: ((e: ChaosEvent) => void) | null;
  draining = false;
  private stopped = false;
  /** Counters for tests and metrics. */
  readonly stats = { received: 0, dropped: 0, sent: 0, errors: 0 };
  /** Test hook: where datagrams go when there is no real socket. */
  sendRaw: ((bytes: Uint8Array, port: number, address: string) => void) | null = null;

  constructor(o: WireServerOpts) {
    this.host = o.host;
    this.tickMs = o.tickMs;
    this.maxTick = o.maxTick ?? 400;
    this.clock = o.clock ?? realClock;
    this.t0 = this.clock.now();
    this.forceChaos = o.forceChaos ?? null;
    this.observer = o.observer ?? null;
    this.probe = o.probe ?? null;
    this.onChaos = o.onChaos ?? null;
    this.limits = { ...DEFAULT_LIMITS, ...(o.limits ?? {}) };
  }

  /**
   * Bind a UDP socket. Resolves with the bound port. Call it more than once to listen on several ports (SPEC 5.2: the
   * wire port and UDP 443); one session can move between them, and replies go out through the socket the client last
   * used. Rejects if the port cannot be bound.
   */
  listen(port: number, address = "0.0.0.0"): Promise<number> {
    const sock = createSocket({ type: "udp4", recvBufferSize: 4 * 1024 * 1024, sendBufferSize: 4 * 1024 * 1024 });
    sock.on("message", (msg: Buffer, rinfo: RemoteInfo) => {
      try {
        this.receive(new Uint8Array(msg.buffer, msg.byteOffset, msg.byteLength), rinfo.address, rinfo.port, sock);
      } catch (err) {
        this.host.log?.("wire: datagram handler error", err);
      }
    });
    this.startSweeper();
    return new Promise((res, rej) => {
      const fail = (err: Error) => {
        try {
          sock.close();
        } catch {
          /* never bound */
        }
        rej(err);
      };
      sock.once("error", fail);
      sock.bind(port, address, () => {
        sock.off("error", fail);
        sock.on("error", (err) => this.host.log?.("wire: socket error", err));
        this.sockets.push(sock);
        res(sock.address().port);
      });
    });
  }

  /** The UDP ports this server is bound to, in the order they were bound. */
  get ports(): number[] {
    return this.sockets.map((s) => s.address().port);
  }

  private startSweeper(): void {
    if (this.sweepTimer) return;
    this.sweepTimer = setInterval(() => this.sweep(), 1000);
    this.sweepTimer.unref?.();
  }

  /** Start the sweeper without a socket (tests drive `receive` and `sendRaw`). */
  startDetached(): void {
    this.startSweeper();
  }

  get sessionCount(): number {
    return this.sessions.size;
  }
  get matchCount(): number {
    return this.wireIds.size;
  }
  get liveMatches(): WireMatchInfo[] {
    return [...this.wireIds.values()];
  }
  serverMs(): number {
    return Math.floor(this.clock.now() - this.t0) >>> 0;
  }

  // -------------------------------------------------------------------------
  // Inbound

  receive(buf: Uint8Array, address: string, port: number, via: Socket | null = null): void {
    this.stats.received++;
    const key = `${address}:${port}`;
    if (!this.takeToken(key)) {
      this.stats.dropped++;
      const s = this.sessions.get(key);
      if (s && this.clock.now() - s.lastErr4 > 1000) {
        s.lastErr4 = this.clock.now();
        this.error(s, ERR.RATE_LIMITED);
      }
      return;
    }
    const d = decode(buf);
    if (!d || d.packet.type === "HELLO_ACK" || d.packet.type === "MATCH_START" || d.packet.type === "STATE" || d.packet.type === "MATCH_END" || d.packet.type === "PONG" || d.packet.type === "ERROR") {
      this.stats.dropped++;
      return;
    }
    this.observer?.inbound?.(key, d, this.clock.now());
    if (d.packet.type === "HELLO") return this.onHello(d, d.packet, address, port, via);
    const s = this.sessions.get(key);
    if (!s || d.session !== s.id) {
      this.stats.dropped++;
      return;
    }
    const p = d.packet;
    const m = "match" in p ? (s.matches.get(p.match) ?? null) : null;
    const owner = m ?? s.harshest();
    const res = s.up.send(owner?.profile ?? null, owner ? owner.rngUp : s.rngUp, () => {
      if (via) s.via = via;
      this.process(s, d);
    });
    if (owner && owner.profile) {
      for (const delay of res.delays.length ? res.delays : [0]) owner.live.noteChaos({ dir: "up", type: PT[p.type], tick: "tick" in p ? p.tick : -1, action: res.action, delay });
      this.onChaos?.({ match: owner, dir: "up", type: PT[p.type], tick: "tick" in p ? p.tick : -1, seq: d.seq, action: res.action, delays: res.delays });
    }
  }

  private takeToken(key: string): boolean {
    const now = this.clock.now();
    let b = this.buckets.get(key);
    if (!b) {
      if (this.buckets.size > 100_000) return false;
      b = { tokens: this.limits.datagramBurst, at: now };
      this.buckets.set(key, b);
    }
    b.tokens = Math.min(this.limits.datagramBurst, b.tokens + ((now - b.at) / 1000) * this.limits.datagramsPerSecond);
    b.at = now;
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  private process(s: Session, d: Datagram): void {
    if (s.closed) return;
    s.lastHeard = this.clock.now();
    this.observer?.processed?.(s.key, d, s.lastHeard);
    if (d.seq > s.ackIn) s.ackIn = d.seq;
    const info = s.sent.get(d.ack);
    if (info && info.keyframe && (info.match.ackedBase === null || info.tick > info.match.ackedBase)) {
      info.match.ackedBase = info.tick;
      for (const t of info.match.keyframes.keys()) if (t < info.tick) info.match.keyframes.delete(t);
    }
    const p = d.packet;
    if (this.clockOut(s, p)) return;
    switch (p.type) {
      case "PING":
        return this.send(s, { type: "PONG", clientMs: p.clientMs, serverMs: this.serverMs() }, null);
      case "INTENT": {
        const m = s.matches.get(p.match);
        if (!m) return this.unknownMatch(s, p.match);
        const intent = intentFromWire(p.intent);
        if (!intent) {
          m.live.submit(p.tick, null);
          return this.badIntent(s, m, p.tick);
        }
        const r = m.live.submit(p.tick, intent);
        if (r === "late" || r === "wrong_tick") this.badIntent(s, m, p.tick);
        return;
      }
      case "RESYNC": {
        const m = s.matches.get(p.match);
        if (!m) return this.unknownMatch(s, p.match);
        const now = this.clock.now();
        if (now - m.lastResync < RESYNC_MIN_MS || !m.live.isStarted || m.live.isEnded) return;
        m.lastResync = now;
        m.live.noteResync();
        return this.sendState(m, true, true);
      }
      case "ACK_FRAG": {
        const m = s.matches.get(p.match);
        if (!m) return this.unknownMatch(s, p.match);
        if (p.frag < m.fragAcked.length) m.fragAcked[p.frag] = true;
        if (m.fragAcked.every(Boolean)) this.fragsDone(m);
        return;
      }
      case "LEAVE": {
        const m = s.matches.get(p.match);
        if (!m) return this.unknownMatch(s, p.match);
        if (m.mode === "practice") m.live.forfeit();
        return;
      }
      default:
        return;
    }
  }

  /**
   * The clock (SPEC 7): once it has run out, every wire action is refused with `ERROR 2` (at most one a second) and
   * practice matches end, except anything to do with an official run already in progress, which plays to the end.
   */
  private clockOut(s: Session, p: Packet): boolean {
    const left = this.host.clockLeftS(s.token);
    if (left === null || left > 0) return false;
    const m = "match" in p ? (s.matches.get(p.match) ?? null) : null;
    if (m ? m.mode === "official" : this.runInProgress(s.token)) return false;
    for (const x of s.matches.values()) if (x.mode === "practice") x.live.forfeit();
    const now = this.clock.now();
    if (now - s.lastErr2 > 1000) {
      s.lastErr2 = now;
      this.error(s, ERR.CLOCK_EXPIRED);
    }
    return true;
  }

  private unknownMatch(s: Session, wireId: number): void {
    const e = s.ended.get(wireId);
    if (e && e.until > this.clock.now()) return this.send(s, e.bytes, null);
    const now = this.clock.now();
    if (now - s.lastErr6 < 1000) return;
    s.lastErr6 = now;
    this.error(s, ERR.UNKNOWN_MATCH);
  }

  private badIntent(s: Session, m: WireMatch, tick: number): void {
    if (m.lastErr5Tick === tick) return;
    m.lastErr5Tick = tick;
    this.error(s, ERR.BAD_INTENT, `tick ${tick}`, m);
  }

  // -------------------------------------------------------------------------
  // HELLO

  private onHello(d: Datagram, p: Extract<Packet, { type: "HELLO" }>, address: string, port: number, via: Socket | null): void {
    const key = `${address}:${port}`;
    const token = this.host.authenticate(p.token);
    if (!token) return this.sessionless(address, port, d.seq, ERR.BAD_TOKEN, via);
    let s = this.sessions.get(key) ?? null;
    if (s && s.token !== token) {
      this.closeSession(s, true);
      s = null;
    }
    if (s && via) s.via = via;
    const clock = this.host.clockLeftS(token);
    const expired = clock !== null && clock <= 0;
    if (p.mode === 1) {
      const run = this.runs.get(token);
      if (run && !run.finished) {
        if (!s) s = this.newSession(token, address, port, null, d.seq, via);
        if (!s) return;
        s.ackIn = Math.max(s.ackIn, d.seq);
        this.helloAck(s);
        if (run.session !== s) this.rebind(run, s);
        return;
      }
      if (expired) return this.sessionless(address, port, d.seq, ERR.CLOCK_EXPIRED, via);
      if (this.draining) return this.sessionless(address, port, d.seq, ERR.RATE_LIMITED, via);
      const begun = this.host.beginRun(token);
      if (typeof begun === "number") return this.sessionless(address, port, d.seq, begun, via);
      if ("code" in begun) return this.sessionless(address, port, d.seq, begun.code, via, begun.msg);
      if (!s) s = this.newSession(token, address, port, null, d.seq, via);
      if (!s) return;
      s.ackIn = Math.max(s.ackIn, d.seq);
      this.helloAck(s);
      const r: Run = { id: begun.runId, token, seeds: begun.seeds, next: 0, active: new Set(), results: [], session: s, finished: false };
      this.runs.set(token, r);
      this.pumpRun(r);
      return;
    }
    // Practice.
    if (expired) return this.sessionless(address, port, d.seq, ERR.CLOCK_EXPIRED, via);
    const tier = TIERS[p.tier]!;
    const override = this.rulesFor(token).chaosOverride;
    const chaos = this.forceChaos ? CHAOS[this.forceChaos] : p.chaos === 0 ? null : CHAOS[override ?? TIERS[p.chaos - 1]!];
    if (s && [...s.matches.values()].some((m) => m.mode === "practice" && !m.live.isEnded)) {
      s.ackIn = Math.max(s.ackIn, d.seq);
      return this.helloAck(s);
    }
    if (this.draining) return this.sessionless(address, port, d.seq, ERR.RATE_LIMITED, via);
    const live = [...this.wireIds.values()].filter((m) => m.token === token && m.mode === "practice" && !m.live.isEnded).length;
    const denied = this.host.practiceAllowed(token, live);
    if (denied !== null) return this.sessionless(address, port, d.seq, denied, via);
    if (!s) s = this.newSession(token, address, port, chaos, d.seq, via);
    if (!s) return;
    s.ackIn = Math.max(s.ackIn, d.seq);
    this.helloAck(s);
    this.createMatch(s, token, "practice", tier, this.host.practiceSeed(token, tier), null, chaos);
  }

  private rulesFor(token: string): WireRules {
    return this.host.rules?.(token) ?? DEFAULT_RULES;
  }

  private newSession(token: string, address: string, port: number, practiceChaos: ChaosProfile | null, seq: number, via: Socket | null): Session | null {
    if (this.sessions.size >= this.limits.maxSessions) return null;
    let perIp = 0;
    for (const x of this.sessions.values()) if (x.address === address) perIp++;
    if (perIp >= this.limits.sessionsPerIp) {
      this.sessionless(address, port, seq, ERR.RATE_LIMITED, via);
      return null;
    }
    let id = 0;
    for (let k = 0; k < 100 && (id === 0 || this.sessionIds.has(id)); k++) id = 1 + (randomBytes(2).readUInt16LE(0) % 0xfffe);
    if (id === 0 || this.sessionIds.has(id)) return null;
    const s = new Session(id, token, address, port, practiceChaos, this.clock);
    s.via = via;
    this.sessions.set(s.key, s);
    this.sessionIds.add(id);
    return s;
  }

  private helloAck(s: Session): void {
    const left = this.host.clockLeftS(s.token);
    const rules = this.rulesFor(s.token);
    this.send(
      s,
      {
        type: "HELLO_ACK",
        session: s.id,
        attemptsLeft: Math.min(255, this.host.attemptsLeft(s.token)),
        clockS: left === null ? 0xffffffff : Math.max(0, Math.min(0xfffffffe, Math.floor(left))),
        ruleChange: rules.ruleChange,
      },
      null,
      true,
    );
  }

  /** An error to an address with no session (the HELLO was refused): session 0, seq 0. */
  private sessionless(address: string, port: number, ack: number, code: ErrCode, via: Socket | null, msg?: string): void {
    this.raw(encode({ session: 0, seq: 0, ack, packet: { type: "ERROR", code, msg: (msg ?? ERROR_TEXT[code]).slice(0, 255) } }), port, address, via);
  }

  private error(s: Session, code: ErrCode, detail?: string, m?: WireMatch): void {
    this.stats.errors++;
    const msg = detail ? `${ERROR_TEXT[code]} (${detail})` : ERROR_TEXT[code];
    this.send(s, { type: "ERROR", code, msg: msg.slice(0, 255) }, m ?? null);
  }

  // -------------------------------------------------------------------------
  // Outbound

  private raw(bytes: Uint8Array, port: number, address: string, via: Socket | null): void {
    if (this.stopped) return;
    this.stats.sent++;
    if (this.sendRaw) return this.sendRaw(bytes, port, address);
    try {
      (via ?? this.sockets[0])?.send(bytes, port, address);
    } catch (err) {
      this.host.log?.("wire: send failed", err);
    }
  }

  /** Send through the session's downstream chaos link. `clean` skips chaos (handshake). */
  private send(s: Session, packet: Packet, m: WireMatch | null, clean = false, info?: { tick: number; keyframe: boolean }): void {
    if (s.closed) return;
    const seq = (s.seqOut = (s.seqOut + 1) >>> 0);
    const bytes = encode({ session: s.id, seq, ack: s.ackIn, packet });
    if (info && m) {
      s.sent.set(seq, { match: m, tick: info.tick, keyframe: info.keyframe });
      if (s.sent.size > 2048) s.sent.delete(s.sent.keys().next().value as number);
    }
    if (this.observer?.hold?.(s.key, packet)) return;
    const owner = m ?? s.harshest();
    const profile = clean ? null : (owner?.profile ?? null);
    const res = s.down.send(profile, owner ? owner.rngDown : s.rngDown, () => {
      this.raw(bytes, s.port, s.address, s.via);
      this.observer?.delivered?.(s.key, seq, packet, this.clock.now());
    });
    if (owner && profile) {
      for (const delay of res.delays.length ? res.delays : [0]) owner.live.noteChaos({ dir: "down", type: bytes[1]!, tick: info?.tick ?? -1, action: res.action, delay });
      this.onChaos?.({ match: owner, dir: "down", type: bytes[1]!, tick: info?.tick ?? -1, seq, action: res.action, delays: res.delays });
    }
  }

  // -------------------------------------------------------------------------
  // Matches

  private allocWireId(): number {
    for (let k = 0; k < 0x10000; k++) {
      const id = this.nextWireId;
      this.nextWireId = this.nextWireId >= 0xfffe ? 1 : this.nextWireId + 1;
      if (!this.wireIds.has(id)) return id;
    }
    throw new Error("no free match ids");
  }

  private createMatch(s: Session | null, token: string, mode: "practice" | "official", tier: Tier, seed: number, run: { id: string; index: number } | null, profile: ChaosProfile | null): WireMatch {
    const id = this.host.newMatchId();
    const rules = this.rulesFor(token);
    const live = new LiveMatch({
      id,
      seed,
      tier,
      mode,
      transport: "wire",
      tickMs: this.tickMs,
      maxTick: this.maxTick,
      clock: this.clock,
      lookahead: INTENT_LOOKAHEAD,
      params: rules.params,
      chaos: profile?.name ?? "off",
      ...(this.host.log ? { log: this.host.log } : {}),
    });
    live.log.chaos_profile = profile?.name ?? null;
    const m = new WireMatch(id, this.allocWireId(), token, mode, tier, seed >>> 0, run, live, profile, s, randomBytes(4).readUInt32LE(0));
    this.wireIds.set(m.wireId, m);
    s?.matches.set(m.wireId, m);
    live.onOpen = (tick) => this.onOpen(m, tick);
    live.onResolved = (st) => this.host.tick?.(m, st);
    live.onEnd = (st) => this.onEnd(m, st);
    this.host.matchStarted?.(m);
    this.sendFrags(m, true);
    return m;
  }

  /** Send MATCH_START fragments, then resend unacked ones every 100 ms for up to 2000 ms (SPEC 5.3). */
  private sendFrags(m: WireMatch, first: boolean): void {
    if (m.fragTimer !== null) this.clock.clearTimeout(m.fragTimer);
    m.fragAcked = m.frags.map(() => false);
    m.fragSince = this.clock.now();
    const pass = () => {
      m.fragTimer = null;
      if (m.live.isEnded) return;
      const s = m.session;
      if (s && !s.closed)
        m.frags.forEach((data, frag) => {
          if (!m.fragAcked[frag]) this.send(s, { type: "MATCH_START", match: m.wireId, frag, fragCount: m.frags.length, data }, m);
        });
      if (m.fragAcked.every(Boolean) || this.clock.now() - m.fragSince >= FRAG_GIVE_UP_MS) return this.fragsDone(m);
      m.fragTimer = this.clock.setTimeout(pass, FRAG_RESEND_MS);
    };
    pass();
    if (!first && m.live.isStarted) return;
  }

  private fragsDone(m: WireMatch): void {
    if (m.fragTimer !== null) {
      this.clock.clearTimeout(m.fragTimer);
      m.fragTimer = null;
    }
    if (!m.live.isStarted) m.live.start();
  }

  private onOpen(m: WireMatch, tick: number): void {
    m.curTick = tick;
    m.curSnap = snapshotFor(m.live.state);
    m.curEvents = wireEventsFor(m.live.state);
    const s = m.session;
    if (s) this.observer?.tickOpened?.(s.key, m.wireId, tick, this.clock.now());
    if (m.profile?.blackhole && tick === m.blackholeAt && s) {
      const until = this.clock.now() + BLACKHOLE_MS;
      s.down.blackholeUntil = until;
      s.up.blackholeUntil = until;
      m.live.noteChaos({ dir: "down", type: 0, tick, action: "blackhole", delay: BLACKHOLE_MS });
      this.onChaos?.({ match: m, dir: "down", type: 0, tick, seq: 0, action: "blackhole", delays: [BLACKHOLE_MS] });
    }
    if (this.probe && tick % KEYFRAME_EVERY !== 0 && (tick + 1) % KEYFRAME_EVERY !== 0 && this.probe(tick) && m.curSnap) {
      // `--check`: withhold this STATE and build the next one against it.
      m.keyframes.set(tick, m.curSnap);
      m.probeBase = tick;
      m.live.noteChaos({ dir: "down", type: PT.STATE, tick, action: "drop", delay: 0 });
      this.onChaos?.({ match: m, dir: "down", type: PT.STATE, tick, seq: 0, action: "drop", delays: [] });
      return;
    }
    this.sendState(m, false, false);
  }

  private sendState(m: WireMatch, forceKeyframe: boolean, resync: boolean): void {
    const s = m.session;
    if (!s || s.closed || !m.curSnap) return;
    const tick = m.curTick;
    const probe = !forceKeyframe && m.probeBase !== null && m.keyframes.has(m.probeBase) ? m.probeBase : null;
    m.probeBase = null;
    const base = probe ?? m.ackedBase;
    let keyframe = probe === null && (forceKeyframe || tick % KEYFRAME_EVERY === 0 || base === null || !m.keyframes.has(base));
    let delta = keyframe ? null : deltaFields(m.keyframes.get(base!)!, m.curSnap, m.curEvents);
    // A delta against an old base can outgrow the datagram (a crowded board, many keyframes never acked): send a
    // keyframe instead, which may leave out closed errands the client already holds, rather than a delta that would.
    if (delta && probe === null && stateDatagramSize(delta) > MAX_DATAGRAM) {
      keyframe = true;
      delta = null;
    }
    const fields = fitStateFields(delta ?? keyframeFields(m.curSnap, m.curEvents), tick);
    if (keyframe) {
      // The base for later deltas is what was actually sent: if old errands were left out to fit, deltas resend them.
      m.keyframes.set(tick, snapshotFromKeyframe(fields)!);
      if (m.keyframes.size > 32) m.keyframes.delete(m.keyframes.keys().next().value as number);
    }
    const deadlineMs = resync ? m.live.deadlineLeft() : this.tickMs;
    this.send(s, { type: "STATE", match: m.wireId, tick, base: keyframe ? KEYFRAME : base!, deadlineMs, ...fields }, m, false, { tick, keyframe });
  }

  private onEnd(m: WireMatch, st: MatchState): void {
    this.wireIds.delete(m.wireId);
    const s = m.session;
    const sc = scores(st);
    const res = resultFor(st);
    const end: Packet = { type: "MATCH_END", match: m.wireId, result: res === "win" ? 2 : res === "draw" ? 1 : 0, scoreYou: Math.min(255, sc.you), scoreMaria: Math.min(255, sc.maria) };
    if (s) {
      s.matches.delete(m.wireId);
      s.ended.set(m.wireId, { bytes: end, until: this.clock.now() + ENDED_KEEP_MS });
      for (const ms of MATCH_END_REPEATS) {
        if (ms === 0) this.send(s, end, m);
        else this.clock.setTimeout(() => this.send(s, end, m), ms);
      }
    }
    try {
      this.host.matchEnded?.(m, st, m.live.log);
    } catch (err) {
      this.host.log?.("wire: matchEnded hook failed", err);
    }
    if (m.run) {
      const run = this.runs.get(m.token);
      if (run && run.id === m.run.id) {
        run.active.delete(m);
        run.results.push({ index: m.run.index, tier: m.tier, result: res, matchId: m.id });
        if (run.results.length >= RUN_MATCHES) {
          run.finished = true;
          this.host.runFinished?.(run.id, run.token, run.results.slice().sort((a, b) => a.index - b.index));
        } else this.pumpRun(run);
      }
    }
  }

  /** One tier at a time: the next tier's three matches start together once the current tier's are all done. */
  private pumpRun(run: Run): void {
    if (run.active.size > 0) return;
    const override = this.rulesFor(run.token).chaosOverride;
    while (run.next < RUN_MATCHES && run.active.size < RUN_CONCURRENT) {
      const index = run.next++;
      const tier = runTier(index);
      const m = this.createMatch(run.session && !run.session.closed ? run.session : null, run.token, "official", tier, run.seeds[index]!, { id: run.id, index }, CHAOS[override ?? tier]);
      run.active.add(m);
      if (runTier(run.next) !== tier) break;
    }
  }

  /** The candidate came back on a new address: move the run's live matches to the new session and resend their blobs. */
  private rebind(run: Run, s: Session): void {
    const old = run.session;
    run.session = s;
    for (const m of run.active) {
      if (old) old.matches.delete(m.wireId);
      m.session = s;
      m.ackedBase = null;
      m.keyframes.clear();
      s.matches.set(m.wireId, m);
      this.sendFrags(m, false);
    }
    if (old && old !== s && !old.closed) this.closeSession(old, true);
  }

  private closeSession(s: Session, notify: boolean): void {
    if (s.closed) return;
    if (notify) this.error(s, ERR.SESSION_CLOSED);
    s.closed = true;
    s.down.close();
    s.up.close();
    this.sessions.delete(s.key);
    this.sessionIds.delete(s.id);
    for (const m of s.matches.values()) {
      if (m.session === s) m.session = null;
      if (m.mode === "practice") m.live.forfeit();
    }
    for (const r of this.runs.values()) if (r.session === s) r.session = null;
  }

  private sweep(): void {
    const now = this.clock.now();
    for (const s of [...this.sessions.values()]) {
      if (now - s.lastHeard > SILENCE_CLOSE_MS) this.closeSession(s, true);
      else for (const [id, e] of s.ended) if (e.until < now) s.ended.delete(id);
    }
    for (const [k, b] of this.buckets) if (now - b.at > 60_000) this.buckets.delete(k);
    // Practice ends when the clock does, whether or not the client is still sending.
    for (const m of this.wireIds.values()) {
      if (m.mode !== "practice" || m.live.isEnded) continue;
      const left = this.host.clockLeftS(m.token);
      if (left !== null && left <= 0) m.live.forfeit();
    }
    for (const [t, r] of this.runs) if (r.finished && r.active.size === 0) this.runs.delete(t);
  }

  /** True while the token has an official run with matches still to play. */
  runInProgress(token: string): boolean {
    const r = this.runs.get(token);
    return !!r && !r.finished;
  }

  close(): void {
    this.stopped = true;
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    for (const m of this.wireIds.values()) m.live.abort();
    this.wireIds.clear();
    for (const s of [...this.sessions.values()]) this.closeSession(s, false);
    for (const sock of this.sockets.splice(0)) sock.close();
  }
}

/** Token bytes for a token string: 32 hex characters are the 16 raw bytes. */
export function tokenBytes(token: string): Uint8Array | null {
  if (!/^[0-9a-f]{32}$/i.test(token)) return null;
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) out[i] = parseInt(token.slice(2 * i, 2 * i + 2), 16);
  return out;
}
export function tokenHex(raw: Uint8Array): string {
  return [...raw].map((b) => b.toString(16).padStart(2, "0")).join("");
}
