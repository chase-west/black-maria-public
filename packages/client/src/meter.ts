/**
 * The client's measurements: one record per tick per match, and the summary block at the end. The transport feeds it
 * what it sees, with the time it saw it, and nothing else; given the same calls it gives the same numbers, which is
 * how it is tested against a recorded run. `python/meter.py` is the same code in Python.
 *
 * The server's clock is never on the wire, so the deadline for tick t is estimated: it starts when the server sent
 * that tick's STATE, which is about when the least-delayed STATE of recent ticks says it should be. That is the
 * smallest (arrival - tick * tick_ms) over the last 10 STATEs.
 */
import { BLACKOUT_MS, marginBucket, percentile, type ConnSummary, type TickRecord } from "@blackmaria/protocol/wire";

/** A tick's record is final once a STATE this many ticks later has arrived, or the match ended. */
export const FINAL_LAG = 3;
const ANCHOR_WINDOW = 10;
const MISSING_CAP = 4096;

interface Open {
  stateAt: number | null;
  deadlineMs: number | null;
  sentAt: number | null;
  thinkMs: number | null;
  resync: boolean;
  gap: number;
}

class MatchMeter {
  tickMs = 250;
  deadlineMs = 250;
  readonly anchors: number[] = [];
  readonly open = new Map<number, Open>();
  readonly records: TickRecord[] = [];
  /** When each record's deadline started, by the estimate at the time (null before any STATE). */
  readonly starts: (number | null)[] = [];
  next = 0;
  maxTick = -1;
  resyncs = 0;
  blind = 0;
  firstAt: number | null = null;
  lastAt: number | null = null;
  done = false;
  constructor(readonly match: number) {}

  anchor(): number | null {
    return this.anchors.length ? Math.min(...this.anchors) : null;
  }
  tick(t: number): Open {
    let o = this.open.get(t);
    if (!o) {
      o = { stateAt: null, deadlineMs: null, sentAt: null, thinkMs: null, resync: false, gap: 0 };
      this.open.set(t, o);
    }
    return o;
  }
}

export class Meter {
  private maxSeq = 0;
  private readonly missingSeqs = new Set<number>();
  private lostOld = 0;
  private received = 0;
  private duplicates = 0;
  private ignored = 0;
  private readonly rtts: number[] = [];
  private lastArrival: number | null = null;
  private readonly silences: { from: number; to: number }[] = [];
  private readonly matches = new Map<number, MatchMeter>();

  constructor(private readonly onRecord: (r: TickRecord) => void = () => {}) {}

  private m(match: number): MatchMeter {
    let m = this.matches.get(match);
    if (!m) {
      m = new MatchMeter(match);
      this.matches.set(match, m);
    }
    return m;
  }

  /** Any datagram from the server that decoded. Returns whether it was new, a late fill of a gap, or a repeat, and how many seqs it skipped. */
  datagram(seq: number, at: number): { kind: "new" | "late" | "duplicate"; gap: number } {
    if (this.lastArrival !== null && at - this.lastArrival >= BLACKOUT_MS) this.silences.push({ from: this.lastArrival, to: at });
    this.lastArrival = at;
    if (seq === 0) return { kind: "new", gap: 0 };
    if (seq > this.maxSeq) {
      const gap = seq - this.maxSeq - 1;
      for (let s = this.maxSeq + 1; s < seq; s++) {
        if (this.missingSeqs.size >= MISSING_CAP) {
          const oldest = this.missingSeqs.values().next().value as number;
          this.missingSeqs.delete(oldest);
          this.lostOld++;
        }
        this.missingSeqs.add(s);
      }
      this.maxSeq = seq;
      this.received++;
      return { kind: "new", gap };
    }
    if (this.missingSeqs.delete(seq)) {
      this.received++;
      return { kind: "late", gap: 0 };
    }
    this.duplicates++;
    return { kind: "duplicate", gap: 0 };
  }

  /** The transport skipped a repeated packet (onPacket returned false for it). */
  ignoredDuplicate(): void {
    this.ignored++;
  }

  /** A PONG came back after this many ms. */
  pong(rttMs: number): void {
    this.rtts.push(Math.floor(rttMs));
  }

  /** A STATE for `tick` reached the client (every copy, in arrival order). */
  state(match: number, tick: number, at: number, deadlineMs: number, tickMs: number, gap: number): void {
    const m = this.m(match);
    if (m.done) return;
    m.tickMs = tickMs;
    m.deadlineMs = deadlineMs;
    m.firstAt ??= at;
    m.lastAt = at;
    const o = m.tick(tick);
    if (o.stateAt === null) {
      o.stateAt = at;
      o.deadlineMs = deadlineMs;
      o.gap = gap;
    }
    m.anchors.push(at - tick * tickMs);
    if (m.anchors.length > ANCHOR_WINDOW) m.anchors.shift();
    if (tick > m.maxTick) m.maxTick = tick;
    this.finalize(m, tick - FINAL_LAG);
  }

  /** A move for `tick` left (only the first one counts). */
  moveSent(match: number, tick: number, at: number, thinkMs: number): void {
    const m = this.m(match);
    if (m.done) return;
    const o = m.tick(tick);
    if (o.sentAt !== null) return;
    o.sentAt = at;
    o.thinkMs = thinkMs;
  }

  /** A RESYNC left while handling the STATE for `tick`. */
  resync(match: number, tick: number): void {
    const m = this.m(match);
    if (m.done) return;
    m.resyncs++;
    m.tick(tick).resync = true;
  }

  /** A delta was applied to a base the client never received. */
  blind(match: number): void {
    this.m(match).blind++;
  }

  /** When the deadline for `tick` started, by the estimate; null before any STATE. */
  deadlineStart(match: number, tick: number): number | null {
    const m = this.matches.get(match);
    const a = m?.anchor() ?? null;
    return m && a !== null ? a + tick * m.tickMs : null;
  }

  /** The newest tick a STATE arrived for, or -1. */
  maxTick(match: number): number {
    return this.matches.get(match)?.maxTick ?? -1;
  }

  /** The match is over: finalize every tick up to the newest one seen (below `limit`, if given) and summarize. */
  end(match: number, title: string, limit: number | null = null): ConnSummary {
    const m = this.m(match);
    if (!m.done) {
      this.finalize(m, limit === null ? m.maxTick : Math.min(m.maxTick, limit - 1));
      m.done = true;
    }
    return this.summary(m, title);
  }

  private finalize(m: MatchMeter, upTo: number): void {
    const a = m.anchor();
    const oneWay = this.rtts.length ? Math.floor(percentile(this.rtts, 50)! / 2) : 0;
    for (; m.next <= upTo; m.next++) {
      const t = m.next;
      const o = m.open.get(t);
      m.open.delete(t);
      const start = a === null ? null : a + t * m.tickMs;
      const rel = (x: number | null | undefined) => (x === null || x === undefined || start === null ? null : Math.floor(x - start));
      const sent = rel(o?.sentAt);
      const deadline = o?.deadlineMs ?? m.deadlineMs;
      const margin = sent === null ? null : deadline - sent - oneWay;
      const r: TickRecord = {
        match: m.match,
        tick: t,
        state_ms: rel(o?.stateAt),
        think_ms: o?.thinkMs === null || o?.thinkMs === undefined ? null : Math.floor(o.thinkMs),
        sent_ms: sent,
        status: margin === null ? "missing" : margin >= 0 ? "on_time" : "late",
        margin_ms: margin,
        resync: o?.resync ?? false,
        seq_gap: o?.gap ?? 0,
      };
      m.records.push(r);
      m.starts.push(start);
      this.onRecord(r);
    }
  }

  private summary(m: MatchMeter, title: string): ConnSummary {
    const rs = m.records;
    const count = (s: TickRecord["status"]) => rs.filter((r) => r.status === s).length;
    const margins = [0, 0, 0, 0, 0, 0];
    for (const r of rs) if (r.margin_ms !== null) margins[marginBucket(r.margin_ms)]!++;
    // The longest silence while this match was running, and the ticks whose whole deadline fell inside it.
    let blackout: ConnSummary["blackout"] = null;
    if (m.firstAt !== null && m.lastAt !== null) {
      let best: { from: number; to: number } | null = null;
      for (const s of this.silences) if (s.from >= m.firstAt && s.to <= m.lastAt && (!best || s.to - s.from > best.to - best.from)) best = s;
      if (best) {
        const b = best;
        const inside = rs.filter((r, i) => {
          const st = m.starts[i] ?? null;
          return st !== null && st >= b.from && st + m.deadlineMs <= b.to;
        });
        const after = rs.findIndex((_, i) => (m.starts[i] ?? -Infinity) >= b.from);
        const first = inside.length ? inside[0]!.tick : after >= 0 ? rs[after]!.tick : m.next;
        blackout = { from_tick: first, ticks: inside.length, acted: inside.filter((r) => r.status === "on_time").length, ms: Math.floor(best.to - best.from) };
      }
    }
    return {
      title,
      ticks: rs.length,
      on_time: count("on_time"),
      late: count("late"),
      missing: count("missing"),
      rtt_p50: percentile(this.rtts, 50),
      rtt_p95: percentile(this.rtts, 95),
      pings: this.rtts.length,
      lost: this.missingSeqs.size + this.lostOld,
      received: this.received,
      duplicates: this.duplicates,
      duplicates_ignored: this.ignored,
      resyncs: m.resyncs,
      blind: m.blind,
      blackout,
      margins,
    };
  }
}
