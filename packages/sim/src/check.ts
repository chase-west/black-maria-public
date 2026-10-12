/**
 * `sim wire --check`: the ten-item client checklist of docs/WIRE.md, graded from what the local wire server sees.
 *
 * The server runs with the Master network profile, with parameters that differ from the defaults, withholds the first
 * `HELLO_ACK` (a client must repeat `HELLO`), and every 40 ticks withholds one `STATE` and sends the next one as a
 * delta against it (a client that does not hold that base must resync). Everything else is observed: datagrams as they
 * arrive before the network profile touches them, and datagrams as they actually leave for the client.
 */
import type { Params } from "@blackmaria/engine";
import { marginBucket, percentile, type ConnSummary, type Datagram, type Packet } from "@blackmaria/protocol/wire";
import { BLACKHOLE_MS } from "./chaos.js";
import type { ReplayLog } from "./live.js";
import { replayStates } from "./profiler.js";
import type { WireMatchInfo, WireObserver } from "./wire-server.js";

/** Parameters the checklist runs with: none of them the defaults, so a client that hard-codes them shows it. */
export const CHECK_PARAMS: Partial<Params> = { postInterval: 7, expiryMin: 45, expiryMax: 110, snatchCost: 45, regen: 2, inventorySlots: 3 };
/** A match in which the client sent TAKE with a full inventory this many times fails item 10. */
export const FULL_TAKES_FAIL = 5;
/** Ticks whose STATE is withheld so the next one names a base the client cannot hold. */
export const isProbeTick = (tick: number): boolean => tick % 40 === 13;

export const CHECKLIST = [
  "It sends HELLO with session 0 and repeats it until HELLO_ACK, then puts the session in every datagram.",
  "Its seq starts at 1 and rises by one per datagram; its ack is the highest seq it has received.",
  "It sends PING at least every 2000 ms.",
  "It reassembles MATCH_START from fragments in any order and sends ACK_FRAG for every fragment, duplicates included.",
  "It keeps keyframes by tick and applies a delta only to the base it names.",
  "It sends RESYNC when it lacks a delta's base, no more than once per 100 ms per match.",
  "It ignores duplicate STATE, fragment and MATCH_END datagrams.",
  "It sends a move for every tick before that tick's deadline, including ticks whose STATE is late.",
  "It plays three matches at once on one socket, keyed by match id.",
  "It reads every parameter from the match blob instead of assuming the defaults.",
] as const;

export type CheckStatus = "pass" | "fail" | "not checked";
export interface CheckItem {
  n: number;
  text: string;
  status: CheckStatus;
  detail: string;
}

interface MatchTrace {
  wireId: number;
  moves: Map<number, Set<string>>;
  lastResync: number;
  resyncTooFast: number;
  probes: number[];
  probesAnswered: number;
  ended: { onTime: number; ticks: number; fullTakes: number; slots: number } | null;
  startedAt: number;
  endedAt: number | null;
  /** When each tick opened, and when its first move reached the server (after the network). */
  opened: Map<number, number>;
  arrived: Map<number, number>;
  /** What the server can say about the connection, once the match has ended. */
  conn: Omit<ConnSummary, "title" | "rtt_p50" | "rtt_p95" | "pings" | "lost" | "received" | "duplicates"> | null;
}

interface SessionTrace {
  key: string;
  hellos: number;
  firstHelloSession: number | null;
  ackHeld: boolean;
  helloAfterHold: boolean;
  session: number | null;
  wrongSession: number;
  /** When the first HELLO_ACK left (a datagram the client sent before it arrived may still carry session 0). */
  ackAt: number | null;
  firstSeq: number | null;
  lastSeq: number;
  seqBreaks: number;
  maxDelivered: number;
  ackAhead: number;
  maxAck: number;
  datagrams: number;
  lastPing: number | null;
  firstAt: number;
  lastAt: number;
  maxPingGap: number;
  pings: number;
  fragsDelivered: number;
  fragAcks: number;
  matches: Map<number, MatchTrace>;
  /** PINGs as they reached the socket, by client_ms, and the round trips their PONGs make. */
  pingAt: Map<number, number>;
  rtts: number[];
  deliveredSeqs: Set<number>;
  deliveredTwice: number;
}

const moveKey = (p: Extract<Packet, { type: "INTENT" }>) => `${p.intent.kind}/${p.intent.kind === 1 ? p.intent.dir : 0}/${p.intent.kind === 3 || p.intent.kind === 4 ? p.intent.item : 0}`;

/** Watches a local wire server and grades each client session against the checklist. */
export class WireCheck implements WireObserver {
  private readonly sessions = new Map<string, SessionTrace>();
  private readonly matchSession = new Map<number, string>();

  private trace(key: string, at: number): SessionTrace {
    let t = this.sessions.get(key);
    if (!t) {
      t = {
        key,
        hellos: 0,
        firstHelloSession: null,
        ackHeld: false,
        helloAfterHold: false,
        session: null,
        wrongSession: 0,
        ackAt: null,
        firstSeq: null,
        lastSeq: 0,
        seqBreaks: 0,
        maxDelivered: 0,
        ackAhead: 0,
        maxAck: 0,
        datagrams: 0,
        lastPing: null,
        firstAt: at,
        lastAt: at,
        maxPingGap: 0,
        pings: 0,
        fragsDelivered: 0,
        fragAcks: 0,
        matches: new Map(),
        pingAt: new Map(),
        rtts: [],
        deliveredSeqs: new Set(),
        deliveredTwice: 0,
      };
      this.sessions.set(key, t);
    }
    return t;
  }

  private match(t: SessionTrace, wireId: number, at: number): MatchTrace {
    let m = t.matches.get(wireId);
    if (!m) {
      m = { wireId, moves: new Map(), lastResync: -Infinity, resyncTooFast: 0, probes: [], probesAnswered: 0, ended: null, startedAt: at, endedAt: null, opened: new Map(), arrived: new Map(), conn: null };
      t.matches.set(wireId, m);
      this.matchSession.set(wireId, t.key);
    }
    return m;
  }

  inbound(key: string, d: Datagram, at: number): void {
    const t = this.trace(key, at);
    t.datagrams++;
    t.lastAt = at;
    if (t.firstSeq === null) t.firstSeq = d.seq;
    else if (d.seq !== t.lastSeq + 1) t.seqBreaks++;
    t.lastSeq = d.seq;
    if (d.ack > t.maxDelivered) t.ackAhead++;
    t.maxAck = Math.max(t.maxAck, d.ack);
    const p = d.packet;
    if (p.type === "HELLO") {
      t.hellos++;
      if (t.firstHelloSession === null) t.firstHelloSession = d.session;
      if (t.ackHeld) t.helloAfterHold = true;
      return;
    }
    // A datagram sent before the client could have read HELLO_ACK (it left within the last 250 ms) is still in flight.
    if (t.session !== null && d.session !== t.session && !(d.session === 0 && t.ackAt !== null && performance.now() - t.ackAt < 250)) t.wrongSession++;
    if (p.type === "PING") {
      const since = t.lastPing ?? t.firstAt;
      t.maxPingGap = Math.max(t.maxPingGap, at - since);
      t.lastPing = at;
      t.pings++;
      if (!t.pingAt.has(p.clientMs)) t.pingAt.set(p.clientMs, at);
      if (t.pingAt.size > 256) t.pingAt.delete(t.pingAt.keys().next().value as number);
    } else if (p.type === "ACK_FRAG") t.fragAcks++;
    else if (p.type === "INTENT") {
      const m = this.match(t, p.match, at);
      let set = m.moves.get(p.tick);
      if (!set) m.moves.set(p.tick, (set = new Set()));
      if (set.size < 8) set.add(moveKey(p));
    } else if (p.type === "RESYNC") {
      const m = this.match(t, p.match, at);
      if (at - m.lastResync < 100) m.resyncTooFast++;
      m.lastResync = at;
      const open = m.probes.filter((x) => at - x <= 1000);
      if (open.length) {
        m.probesAnswered++;
        m.probes = m.probes.filter((x) => at - x > 1000);
      }
    }
  }

  hold(key: string, packet: Packet): boolean {
    if (packet.type !== "HELLO_ACK") return false;
    const t = this.trace(key, 0);
    if (t.ackHeld) return false;
    t.ackHeld = true;
    return true;
  }

  delivered(key: string, seq: number, packet: Packet, at: number): void {
    const t = this.trace(key, at);
    t.maxDelivered = Math.max(t.maxDelivered, seq);
    if (t.deliveredSeqs.has(seq)) t.deliveredTwice++;
    else t.deliveredSeqs.add(seq);
    if (packet.type === "PONG") {
      // On this machine the client sends a PING about when the socket gets it, and gets the PONG when it leaves.
      const sent = t.pingAt.get(packet.clientMs);
      if (sent !== undefined) {
        t.pingAt.delete(packet.clientMs);
        t.rtts.push(Math.floor(at - sent));
      }
    }
    if (packet.type === "HELLO_ACK") {
      t.session = packet.session;
      t.ackAt ??= performance.now();
    }
    else if (packet.type === "MATCH_START") {
      t.fragsDelivered++;
      this.match(t, packet.match, at);
    } else if (packet.type === "STATE" && packet.base !== 0xffff && isProbeTick(packet.base)) this.match(t, packet.match, at).probes.push(at);
  }

  /** A client datagram as the server acts on it: when each tick's first move got there. */
  processed(key: string, d: Datagram, at: number): void {
    if (d.packet.type !== "INTENT") return;
    const m = this.sessions.get(key)?.matches.get(d.packet.match);
    if (m && !m.arrived.has(d.packet.tick)) m.arrived.set(d.packet.tick, at);
  }

  tickOpened(key: string, wireId: number, tick: number, at: number): void {
    const t = this.sessions.get(key);
    if (t) this.match(t, wireId, at).opened.set(tick, at);
  }

  /** Record a finished match (from the host's `matchEnded`). */
  matchEnded(info: WireMatchInfo, log: ReplayLog): void {
    const key = this.matchSession.get(info.wireId);
    if (!key) return;
    const t = this.sessions.get(key);
    const m = t?.matches.get(info.wireId);
    if (!t || !m) return;
    // Every TAKE it sent (on time or not) for a tick at which its inventory was already full.
    const states = replayStates(log);
    let fullTakes = 0;
    for (const [tick, set] of m.moves) {
      const st = states[tick];
      if (st && [...set].some((k) => k.startsWith("2/")) && st.bodies.you.inventory.length >= log.params.inventorySlots) fullTakes++;
    }
    const onTime = [...log.intent_status].filter((c) => c === "o").length;
    m.ended = { onTime, ticks: log.ticks.length, fullTakes, slots: log.params.inventorySlots };
    m.endedAt = performance.now();
    m.conn = connFromServer(m, log);
  }

  /**
   * The summary block from item 2 of the networking interface, for one client session, from the server's side: the
   * moves as the server judged them, the round trip from each PING reaching the socket to its PONG leaving it, and the
   * gaps the client saw in the seq. What the client skipped and what it applied blind can't be seen from here.
   */
  summary(key: string): ConnSummary | null {
    const t = this.sessions.get(key);
    const done = t ? [...t.matches.values()].filter((m) => m.conn) : [];
    if (!t || done.length === 0) return null;
    const sum = (f: (c: NonNullable<MatchTrace["conn"]>) => number) => done.reduce((a, m) => a + f(m.conn!), 0);
    const blackouts = done.map((m) => m.conn!.blackout).filter((b): b is NonNullable<ConnSummary["blackout"]> => b !== null);
    const worst = blackouts.sort((a, b) => a.acted / Math.max(1, a.ticks) - b.acted / Math.max(1, b.ticks))[0] ?? null;
    return {
      title: `Connection, as the server saw it${done.length > 1 ? ` (${done.length} matches)` : ""}:`,
      ticks: sum((c) => c.ticks),
      on_time: sum((c) => c.on_time),
      late: sum((c) => c.late),
      missing: sum((c) => c.missing),
      rtt_p50: percentile(t.rtts, 50),
      rtt_p95: percentile(t.rtts, 95),
      pings: t.rtts.length,
      lost: Math.max(0, t.maxDelivered - t.deliveredSeqs.size),
      received: t.deliveredSeqs.size,
      duplicates: t.deliveredTwice,
      duplicates_ignored: null,
      resyncs: sum((c) => c.resyncs),
      blind: null,
      blackout: worst,
      margins: [0, 1, 2, 3, 4, 5].map((i) => sum((c) => c.margins[i] ?? 0)),
    };
  }

  sessionKeys(): string[] {
    return [...this.sessions.keys()];
  }

  /** The session key a match belongs to. */
  sessionOf(wireId: number): string | null {
    return this.matchSession.get(wireId) ?? null;
  }

  /** Grade one client session. */
  report(key: string): CheckItem[] {
    const t = this.sessions.get(key);
    const item = (n: number, status: CheckStatus, detail: string): CheckItem => ({ n, text: CHECKLIST[n - 1]!, status, detail });
    if (!t) return CHECKLIST.map((_, i) => item(i + 1, "not checked", "Nothing arrived from this client."));
    const ms = [...t.matches.values()];
    const ended = ms.filter((m) => m.ended);
    const out: CheckItem[] = [];

    // 1
    if (t.firstHelloSession !== 0) out.push(item(1, "fail", "The first HELLO did not carry session 0."));
    else if (!t.helloAfterHold) out.push(item(1, "fail", "The server withheld the first HELLO_ACK and the client never sent HELLO again."));
    else if (t.wrongSession > 0) out.push(item(1, "fail", `${t.wrongSession} datagrams after HELLO_ACK carried the wrong session.`));
    else out.push(item(1, "pass", `It sent HELLO ${t.hellos} times and used its session afterwards.`));

    // 2
    const seqOk = t.firstSeq === 1 && t.seqBreaks === 0;
    const ackOk = t.ackAhead === 0 && (t.maxDelivered < 5 || t.maxAck > 0);
    if (!seqOk) out.push(item(2, "fail", t.firstSeq !== 1 ? `The first seq was ${t.firstSeq}, not 1.` : `The seq skipped or repeated ${t.seqBreaks} times.`));
    else if (!ackOk) out.push(item(2, "fail", t.ackAhead > 0 ? `The ack named a seq the server had not sent yet ${t.ackAhead} times.` : "The ack stayed 0 even though datagrams arrived."));
    else out.push(item(2, "pass", `${t.datagrams} datagrams in order; the ack reached ${t.maxAck}.`));

    // 3
    const tail = t.lastPing === null ? t.lastAt - t.firstAt : 0;
    const gap = Math.max(t.maxPingGap, tail);
    if (t.pings === 0 && t.lastAt - t.firstAt < 2000) out.push(item(3, "not checked", "The session was shorter than 2000 ms."));
    else if (gap > 2000) out.push(item(3, "fail", `The longest time without a PING was ${Math.round(gap)} ms.`));
    else out.push(item(3, "pass", `${t.pings} PINGs, never more than ${Math.round(gap)} ms apart.`));

    // 4
    if (t.fragsDelivered === 0) out.push(item(4, "not checked", "No MATCH_START fragment reached the client."));
    else if (t.fragAcks < t.fragsDelivered) out.push(item(4, "fail", `${t.fragsDelivered} fragments reached the client and it sent ${t.fragAcks} ACK_FRAGs.`));
    else out.push(item(4, "pass", `${t.fragsDelivered} fragments reached the client, ${t.fragAcks} ACK_FRAGs came back.`));

    // 5, 6
    const probesSent = ms.reduce((a, m) => a + m.probes.length + m.probesAnswered, 0);
    const answered = ms.reduce((a, m) => a + m.probesAnswered, 0);
    const tooFast = ms.reduce((a, m) => a + m.resyncTooFast, 0);
    if (probesSent === 0) {
      out.push(item(5, "not checked", "No delta against a withheld base reached the client. Play a longer match."));
      out.push(item(6, "not checked", "No delta against a withheld base reached the client. Play a longer match."));
    } else {
      out.push(
        answered > 0
          ? item(5, "pass", `It asked for a resync after ${answered} of ${probesSent} deltas whose base it never received, instead of applying them.`)
          : item(5, "fail", `${probesSent} deltas named a base the client never received, and it never asked for a resync, so it applied them to a state they were not built on.`),
      );
      out.push(
        answered === 0
          ? item(6, "fail", "It never sent RESYNC for a base it lacked.")
          : tooFast > 0
            ? item(6, "fail", `It sent RESYNC less than 100 ms after the last one ${tooFast} times.`)
            : item(6, "pass", "It resynced when it lacked a base, never more than once per 100 ms per match."),
      );
    }

    // 7
    let conflicts = 0;
    for (const m of ms) for (const set of m.moves.values()) if (set.size > 1) conflicts++;
    if (ms.every((m) => m.moves.size === 0)) out.push(item(7, "not checked", "No moves arrived."));
    else if (conflicts > 0) out.push(item(7, "fail", `It sent different moves for the same tick ${conflicts} times, which is what happens when a duplicated or late STATE is decided again.`));
    else out.push(item(7, "pass", "It never sent two different moves for the same tick."));

    // 8
    if (ended.length === 0) out.push(item(8, "not checked", "No match finished yet."));
    else {
      const on = ended.reduce((a, m) => a + m.ended!.onTime, 0);
      const all = ended.reduce((a, m) => a + m.ended!.ticks, 0);
      const rate = all ? on / all : 0;
      out.push(item(8, rate >= 0.95 ? "pass" : "fail", `${(rate * 100).toFixed(1)}% of ticks had a move before the deadline${rate >= 0.95 ? "" : " (at least 95% passes)"}.`));
    }

    // 9
    let peak = 0;
    for (const m of ms) {
      const at = m.startedAt;
      peak = Math.max(peak, ms.filter((x) => x.startedAt <= at && (x.endedAt === null || x.endedAt > at)).length);
    }
    if (peak < 3) out.push(item(9, "not checked", "Only one match was live at a time. Start your official run against this server to check this."));
    else {
      const weak = ended.filter((m) => m.ended!.onTime / Math.max(1, m.ended!.ticks) < 0.9).length;
      out.push(item(9, weak === 0 && ended.length > 0 ? "pass" : "fail", weak === 0 ? `${peak} matches were live at once and each got its moves.` : `${weak} of ${ended.length} matches got moves for fewer than 90% of their ticks.`));
    }

    // 10
    if (ended.length === 0) out.push(item(10, "not checked", "No match finished yet."));
    else {
      // A few misfires happen to any client acting on a late state; a hard-coded inventory size shows up again and again.
      const full = ended.reduce((a, m) => a + m.ended!.fullTakes, 0);
      const slots = ended[0]!.ended!.slots;
      out.push(
        ended.some((m) => m.ended!.fullTakes >= FULL_TAKES_FAIL)
          ? item(10, "fail", `inventory_slots was ${slots} and it sent TAKE with a full inventory ${full} times, as if it had more slots.`)
          : item(10, "pass", `The parameters were not the defaults (inventory_slots ${slots}, snatch_cost and the board rates changed) and nothing it sent showed a hard-coded value.`),
      );
    }
    return out;
  }
}

/** The checklist as text. */
export function checkText(items: readonly CheckItem[]): string {
  const passed = items.filter((i) => i.status === "pass").length;
  const lines = [`Checklist (docs/WIRE.md section 10): ${passed} of ${items.length} pass.`];
  for (const i of items) lines.push(`  ${String(i.n).padStart(2)}. ${i.status === "pass" ? "pass" : i.status === "fail" ? "FAIL" : "not checked"}  ${i.text}`, `       ${i.detail}`);
  return lines.join("\n");
}

/** One match's numbers from the server's side: its moves as judged, their margins, resyncs, and the blackhole. */
function connFromServer(m: MatchTrace, log: ReplayLog): NonNullable<MatchTrace["conn"]> {
  const st = log.intent_status;
  const margins = [0, 0, 0, 0, 0, 0];
  for (let tick = 0; tick < st.length; tick++) {
    const c = st[tick];
    const open = m.opened.get(tick);
    const got = m.arrived.get(tick);
    if (c === "o" && open !== undefined && got !== undefined) margins[marginBucket(Math.floor(log.tick_ms - (got - open)))]!++;
    else if (c === "o") margins[marginBucket(log.tick_ms)]!++;
    else if (c === "l" || log.late_ms?.[tick] !== undefined) margins[0]!++;
  }
  const lateAll = [...st].filter((c, tick) => c === "l" || (c !== "o" && log.late_ms?.[tick] !== undefined)).length;
  const onTime = [...st].filter((c) => c === "o").length;
  const bh = log.chaos.find((c) => c.action === "blackhole" && c.type === 0);
  let blackout: ConnSummary["blackout"] = null;
  if (bh && bh.tick < st.length) {
    const window = st.slice(bh.tick, Math.min(st.length, bh.tick + Math.ceil(BLACKHOLE_MS / Math.max(1, log.tick_ms))));
    blackout = { from_tick: bh.tick, ticks: window.length, acted: [...window].filter((c) => c === "o").length, ms: BLACKHOLE_MS };
  }
  return {
    ticks: st.length,
    on_time: onTime,
    late: lateAll,
    missing: st.length - onTime - lateAll,
    duplicates_ignored: null,
    resyncs: Object.values(log.resyncs).reduce((a, b) => a + b, 0),
    blind: null,
    blackout,
    margins,
  };
}
