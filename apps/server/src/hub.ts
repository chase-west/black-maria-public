import type { IncomingMessage } from "node:http";
import type { WebSocket, RawData } from "ws";
import { parseClientFrame, type ChaosName, type ClientMsg, type ErrorCode, type Mode, type ProfilerReport, type ServerMsg, type Tier } from "@blackmaria/protocol";
import { matchEndFor, matchStartFor, stateFor, type MatchState } from "@blackmaria/engine";
import type { WireMatchInfo } from "@black-maria/sim";
import { EXPIRED_SENTENCE, type CandidateClock } from "./clock.js";
import type { Config } from "./config.js";
import type { Db, TokenRow } from "./db.js";
import { recordPracticeProfile } from "./profile.js";
import { connTicks, connTotals, type ConnTick } from "./quality.js";
import { newMatchId, randomSeed } from "./ids.js";
import { MatchRoom, type MatchOutcome, type MatchSink } from "./match.js";
import { TokenBucket } from "./ratelimit.js";

export const COOKIE = "bm_token";
/** The connection panel shows this many ticks; after the first message, each tick resends this many. */
export const CONN_WINDOW = 100;
export const CONN_RESEND = 4;

export function parseCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) {
      try {
        return decodeURIComponent(v.join("="));
      } catch {
        return null;
      }
    }
  }
  return null;
}

let connSeq = 0;

class Conn implements MatchSink {
  readonly id = ++connSeq;
  token: string | null = null;
  cookieToken: string | null;
  name = "";
  readonly bucket: TokenBucket;
  dropped = 0;
  lastLimitError = 0;
  helloTimer: ReturnType<typeof setTimeout> | null = null;
  closed = false;
  ip = "?";
  /** The portal watching this token's wire matches (SPEC 8: the practice toggle, the official run's cards). */
  watching = false;
  /** Wire matches this watcher has been sent a `match_start` for. */
  readonly watched = new Set<string>();
  constructor(
    readonly ws: WebSocket,
    cookieToken: string | null,
    cfg: Config,
  ) {
    this.cookieToken = cookieToken;
    this.bucket = new TokenBucket(cfg.limits.framesPerSecond, cfg.limits.frameBurst);
  }
  get open(): boolean {
    return !this.closed && this.ws.readyState === 1;
  }
  send(msg: ServerMsg): void {
    if (!this.open) return;
    // A client that stops reading must not grow our memory without bound.
    if (this.ws.bufferedAmount > 4 * 1024 * 1024) {
      this.ws.terminate();
      return;
    }
    this.ws.send(JSON.stringify(msg));
  }
  error(code: ErrorCode, message: string, match_id?: string): void {
    const e: ServerMsg = match_id ? { type: "error", code, message, match_id } : { type: "error", code, message };
    this.send(e);
  }
}

export interface HubStats {
  connections: number;
  matches: number;
  draining: boolean;
}

/** Owns every WebSocket connection, match and official run in the process. */
export class Hub {
  private readonly conns = new Set<Conn>();
  readonly matches = new Map<string, MatchRoom>();
  private readonly tokenCache = new Map<string, TokenRow>();
  /** Observers for tests and the admin view. */
  onMatchEnd: ((o: MatchOutcome) => void) | null = null;
  /** Set on shutdown: no new matches or runs start. */
  draining = false;

  constructor(
    readonly cfg: Config,
    readonly db: Db,
    readonly clock: CandidateClock,
    private readonly log: (msg: string, err?: unknown) => void = (m, e) => console.error(m, e ?? ""),
  ) {}

  stats(): HubStats {
    return { connections: this.conns.size, matches: this.matches.size, draining: this.draining };
  }

  lookupToken(token: string): TokenRow | null {
    if (token.length === 0 || token.length > 128) return null;
    const hit = this.tokenCache.get(token);
    if (hit) return hit;
    const row = this.db.getToken(token);
    if (row) this.tokenCache.set(token, row);
    return row;
  }

  windowOpen(now = Date.now()): boolean {
    return now >= this.cfg.windowOpens.getTime() && now <= this.cfg.windowCloses.getTime();
  }

  attemptsLeft(token: string): number {
    return Math.max(0, this.cfg.limits.officialAttempts - this.db.listRuns(token).length);
  }

  // -------------------------------------------------------------------------
  // Connections

  /** Client address, honoring X-Forwarded-For only behind a trusted proxy. */
  clientIp(req: IncomingMessage): string {
    const fwd = this.cfg.trustProxy ? String(req.headers["x-forwarded-for"] ?? "").split(",")[0]!.trim() : "";
    return fwd || req.socket.remoteAddress || "?";
  }

  handleConnection(ws: WebSocket, req: IncomingMessage): void {
    const ip = this.clientIp(req);
    if (this.conns.size >= this.cfg.limits.maxConnections) {
      ws.close(1013, "server full");
      return;
    }
    if ([...this.conns].filter((c) => c.ip === ip).length >= this.cfg.limits.connectionsPerIp) {
      ws.close(4008, "too many connections from this address");
      return;
    }
    const conn = new Conn(ws, parseCookie(req.headers.cookie, COOKIE), this.cfg);
    conn.ip = ip;
    this.conns.add(conn);
    conn.helloTimer = setTimeout(() => {
      if (!conn.token) ws.close(4000, "hello timeout");
    }, this.cfg.limits.helloTimeoutMs);
    ws.on("message", (data: RawData, isBinary: boolean) => {
      try {
        this.onFrame(conn, data, isBinary);
      } catch (err) {
        this.log("frame handler error", err);
        conn.error("internal", "Something broke on the server. Start the match again.");
      }
    });
    ws.on("close", () => this.onClose(conn));
    ws.on("error", () => {
      /* close follows */
    });
  }

  private onClose(conn: Conn): void {
    if (conn.closed) return;
    conn.closed = true;
    if (conn.helloTimer) clearTimeout(conn.helloTimer);
    this.conns.delete(conn);
    for (const m of this.matches.values()) m.detach(conn);
  }

  private onFrame(conn: Conn, data: RawData, isBinary: boolean): void {
    if (!conn.bucket.take()) {
      conn.dropped++;
      const now = performance.now();
      if (now - conn.lastLimitError > 1000) {
        conn.lastLimitError = now;
        conn.error("rate_limited", "Too many messages too fast. Send at most one move a tick.");
      }
      if (conn.dropped > 2000) conn.ws.close(4008, "rate limit");
      return;
    }
    if (isBinary) {
      conn.error("bad_message", "The WebSocket only takes JSON text. Send each message as text.");
      return;
    }
    const raw = Array.isArray(data) ? Buffer.concat(data).toString("utf8") : Buffer.from(data as ArrayBuffer).toString("utf8");
    const parsed = parseClientFrame(raw);
    if (!parsed.ok) {
      conn.error(parsed.code, parsed.message, parsed.match_id);
      return;
    }
    const msg: ClientMsg = parsed.msg;
    if (msg.type === "hello") return this.onHello(conn, msg.token, msg.name);
    if (!conn.token) {
      conn.error("not_authenticated", "Send hello with your token first, then join a match.");
      return;
    }
    switch (msg.type) {
      case "join":
        return this.onJoin(conn, msg.mode, msg.tier, msg.speed ?? 1);
      case "watch":
        conn.watching = true;
        return;
      case "intent": {
        const room = this.matches.get(msg.match_id);
        if (!room || room.token !== conn.token) return conn.error("unknown_match", "That match isn't running anymore. Start a new one.", msg.match_id);
        if (this.clock.expired(conn.token)) {
          room.forfeit();
          return conn.error("clock_expired", EXPIRED_SENTENCE, msg.match_id);
        }
        const err = room.submit(conn, msg.tick, msg.intent);
        if (err) conn.error(err, err === "stale_tick" ? `Your move for tick ${msg.tick} missed its deadline (the open tick is ${room.state.tick}). Send each move as soon as its state arrives.` : err === "duplicate_intent" ? "You already sent a move for this tick. The first one counts." : "That match belongs to another connection. Send moves on the socket that joined it.", msg.match_id);
        return;
      }
      case "leave": {
        const room = this.matches.get(msg.match_id);
        if (!room || room.token !== conn.token) return conn.error("unknown_match", "That match isn't running anymore. Start a new one.", msg.match_id);
        room.forfeit();
        return;
      }
    }
  }

  private onHello(conn: Conn, token: string | undefined, name: string | undefined): void {
    if (conn.token) return conn.error("already_authenticated", "This connection already sent hello. Send join next.");
    const t = token ?? conn.cookieToken ?? "";
    const row = this.lookupToken(t);
    if (!row) {
      conn.error("bad_token", "Unknown token. Copy it again from your magic link.");
      conn.ws.close(4001, "bad token");
      return;
    }
    const sameToken = [...this.conns].filter((c) => c.token === row.token).length;
    if (sameToken >= this.cfg.limits.connectionsPerToken) {
      conn.error("rate_limited", "Too many connections open on your token. Close a tab or a client and try again.");
      conn.ws.close(4008, "too many connections");
      return;
    }
    this.clock.open(row.token);
    if (this.clock.expired(row.token)) {
      conn.error("clock_expired", EXPIRED_SENTENCE);
      conn.ws.close(4002, "clock expired");
      return;
    }
    conn.token = row.token;
    conn.name = (name ?? "").replace(/[^\w .-]/g, "").slice(0, 64) || "bot";
    if (conn.helloTimer) clearTimeout(conn.helloTimer);
    conn.send({
      type: "welcome",
      name: conn.name,
      window: { opens: this.cfg.windowOpens.toISOString(), closes: this.cfg.windowCloses.toISOString() },
      attempts_left: this.attemptsLeft(row.token),
      seconds_left: this.clock.status(row.token)?.seconds_left ?? 0,
      rule_change: this.clock.rulesFor(row.token).ruleChange,
    });
    // Reconnect: re-bind this token's orphaned matches and runs to the new connection.
    for (const m of this.matches.values()) {
      const s = m.boundSink;
      if (m.token === row.token && !m.isEnded && (s === null || !s.open)) m.attach(conn, true);
    }
  }

  private activeFor(token: string, modes: Mode[]): number {
    let n = 0;
    for (const m of this.matches.values()) if (m.token === token && modes.includes(m.mode) && !m.isEnded) n++;
    return n;
  }

  private onJoin(conn: Conn, mode: Mode, tier: Tier | undefined, speed: 1 | 2 | 4): void {
    const token = conn.token!;
    if (this.draining) return conn.error("server_busy", "The server's restarting. Try again in a minute.");
    if (!this.windowOpen()) return conn.error("window_closed", "This cohort's window isn't open, so practice is closed.");
    if (this.clock.expired(token)) return conn.error("clock_expired", EXPIRED_SENTENCE);
    if (mode === "official") return conn.error("bad_message", "The official run goes over the wire, not the WebSocket. Start it from your client.");
    if (!tier) return conn.error("bad_message", "Practice needs a tier: novice, adept or master.");
    const hourAgo = Date.now() - 3600_000;
    const limit = this.cfg.limits.practicePerHour;
    if (this.db.countMatchesSince(token, mode, hourAgo) >= limit) return conn.error("rate_limited", `Practice is capped at ${limit} matches an hour. Wait a few minutes and try again.`);
    if (this.activeFor(token, ["practice"]) >= this.cfg.limits.practiceConcurrent)
      return conn.error("too_many_concurrent", `You can run ${this.cfg.limits.practiceConcurrent} practice matches at once. Finish or leave one first.`);
    if (this.matches.size >= this.cfg.maxConcurrentMatches) return conn.error("server_busy", "The server's full right now. Wait a few seconds and try again.");
    this.startMatch(conn, token, mode, tier, randomSeed(), undefined, Math.max(1, Math.round(this.cfg.tickMs.practice / speed)));
  }

  private startMatch(sink: MatchSink | null, token: string, mode: Mode, tier: Tier, seed: number, run?: { id: string; index: number }, tickMs = this.cfg.tickMs.practice): MatchRoom {
    const room = new MatchRoom({
      id: newMatchId(),
      token,
      mode,
      tier,
      seed,
      tickMs,
      ...(this.cfg.maxTickOverride !== null ? { maxTick: this.cfg.maxTickOverride } : {}),
      replayDir: this.cfg.replayDir,
      ...(run ? { run } : {}),
      // Once the change is revealed every match uses it (SPEC 2.2, v6.3); the WebSocket link is always clean.
      params: this.clock.rulesFor(token).params,
      log: this.log,
    });
    this.db.insertMatch({
      id: room.id,
      token,
      mode,
      transport: "ws",
      tier,
      seed: room.seed,
      started_at: room.startedAt,
      ended_at: null,
      result: null,
      score_you: null,
      score_maria: null,
      replay_path: null,
      run_id: run?.id ?? null,
      run_index: run?.index ?? null,
    });
    this.matches.set(room.id, room);
    room.onEnd = (o) => this.matchEnded(o);
    room.start(sink);
    return room;
  }

  private matchEnded(o: MatchOutcome): void {
    const { room, end, replayPath } = o;
    this.matches.delete(room.id);
    try {
      this.db.finishMatch(room.id, { ended_at: Date.now(), result: end.result, score_you: end.scores.you, score_maria: end.scores.maria, replay_path: replayPath });
    } catch (err) {
      this.log("db finishMatch failed", err);
    }
    if (room.mode === "practice") {
      const report = recordPracticeProfile(this.db, room.token, room.replayLog, this.log);
      // The profiler screen after every practice match (SPEC 8.3): sent right after `match_end`.
      const sink = room.boundSink;
      if (report && sink?.open) sink.send({ type: "profile", match_id: room.id, report });
    }
    this.onMatchEnd?.(o);
  }

  // -------------------------------------------------------------------------
  // The watch feed: this token's wire matches, as the portal sees them

  private watchers(token: string): Conn[] {
    return [...this.conns].filter((c) => c.watching && c.token === token && c.open);
  }

  /** One resolved tick of a wire match: its state from the candidate's side, and the health strip so far. */
  wireTick(info: WireMatchInfo, state: MatchState): void {
    const ws = this.watchers(info.token);
    if (!ws.length) return;
    const log = info.live.log;
    const n = log.intent_status.length;
    const totals = connTotals(log);
    // The connection panel: a newcomer gets the last 100 ticks, then each tick the last few again (a late move or a
    // resync can change a tick after it resolved).
    let recent: ConnTick[] | null = null;
    for (const c of ws) {
      let conn: ConnTick[];
      if (!c.watched.has(info.id)) {
        c.watched.add(info.id);
        c.send(matchStartFor(state, "you", { match_id: info.id, mode: info.mode, tier: info.tier, tick_ms: log.tick_ms, chaos: (log.chaos_profile ?? "off") as ChaosName, ...(info.run ? { run_id: info.run.id, run_index: info.run.index } : {}) }));
        conn = connTicks(log, n - CONN_WINDOW, n);
      } else conn = recent ??= connTicks(log, n - CONN_RESEND, n);
      c.send(stateFor(state, "you", { match_id: info.id, deadline_ms: log.tick_ms }));
      c.send({ type: "wire_status", match_id: info.id, strip: log.intent_status, resyncs: log.resyncs, conn, conn_totals: totals });
    }
  }

  /** A wire match ended: the result, and for practice its profiler. */
  wireEnded(info: WireMatchInfo, state: MatchState, report: ProfilerReport | null): void {
    for (const c of this.watchers(info.token)) {
      if (!c.watched.delete(info.id)) continue;
      const log = info.live.log;
      const n = log.intent_status.length;
      c.send({ type: "wire_status", match_id: info.id, strip: log.intent_status, resyncs: log.resyncs, conn: connTicks(log, n - CONN_WINDOW, n), conn_totals: connTotals(log) });
      c.send(matchEndFor(state, "you", { match_id: info.id, replay: `/replay/${info.id}` }));
      if (report) c.send({ type: "profile", match_id: info.id, report });
    }
  }

  /** Practice ends when the clock does (SPEC 7): play out the practice matches of every token whose clock has run out. */
  expirePractice(): void {
    for (const m of this.matches.values()) if (m.mode === "practice" && !m.isEnded && this.clock.expired(m.token)) m.forfeit();
  }

  /** Stop starting matches and wait (up to `graceMs`) for the live ones to finish. */
  async drain(graceMs: number): Promise<void> {
    this.draining = true;
    const until = Date.now() + graceMs;
    while (this.matches.size > 0 && Date.now() < until) await new Promise((r) => setTimeout(r, 250));
  }

  shutdown(): void {
    for (const m of this.matches.values()) m.abort();
    this.matches.clear();
    for (const c of this.conns) c.ws.close(1001, "server shutting down");
  }
}
