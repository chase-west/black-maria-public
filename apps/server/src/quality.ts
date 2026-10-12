/**
 * Wire quality from a replay log (SPEC 9: shown beside the score, not folded in): on-time moves, resyncs, and how the
 * client came through the Master profile's blackhole. And the per-tick chaos timeline for the reviewer's replay.
 */
import type { ChaosTick, ConnTick, ConnTotals, PacketFate, WireQuality } from "@blackmaria/protocol";
import type { ChaosEntry, ReplayLog } from "@black-maria/sim";
import { BLACKHOLE_MS } from "@black-maria/sim";
import { PT } from "@blackmaria/protocol/wire";

export type { ChaosTick, ConnTick, ConnTotals, WireQuality };

export function wireQuality(log: ReplayLog): WireQuality {
  const st = log.intent_status;
  const count = (c: string) => [...st].filter((x) => x === c).length;
  const on = count("o");
  const bh = log.chaos.find((c) => c.action === "blackhole" && c.type === 0 && c.tick >= 0);
  let blackhole: WireQuality["blackhole"] = null;
  if (bh && bh.tick < st.length) {
    const span = Math.ceil(BLACKHOLE_MS / Math.max(1, log.tick_ms)) + 2;
    const window = st.slice(bh.tick, Math.min(st.length, bh.tick + span));
    const ok = [...window].filter((x) => x === "o").length;
    blackhole = { tick: bh.tick, ticks: window.length, on_time: ok, survived: ok === window.length };
  }
  return {
    ticks: st.length,
    on_time: on,
    late: count("l"),
    missing: count("m"),
    malformed: count("x"),
    on_time_rate: st.length ? +(on / st.length).toFixed(4) : 0,
    resyncs: Object.values(log.resyncs).reduce((a, b) => a + b, 0),
    blackhole,
  };
}

/** Totals over several matches (an official run). */
export function sumQuality(qs: readonly WireQuality[]): Omit<WireQuality, "blackhole"> & { matches: number; blackholes: number; blackholes_survived: number } {
  const t = { matches: qs.length, ticks: 0, on_time: 0, late: 0, missing: 0, malformed: 0, on_time_rate: 0, resyncs: 0, blackholes: 0, blackholes_survived: 0 };
  for (const q of qs) {
    t.ticks += q.ticks;
    t.on_time += q.on_time;
    t.late += q.late;
    t.missing += q.missing;
    t.malformed += q.malformed;
    t.resyncs += q.resyncs;
    if (q.blackhole) {
      t.blackholes++;
      if (q.blackhole.survived) t.blackholes_survived++;
    }
  }
  t.on_time_rate = t.ticks ? +(t.on_time / t.ticks).toFixed(4) : 0;
  return t;
}

/** The chaos log folded per tick, for the reviewer's replay strip. */
export function chaosTimeline(log: ReplayLog): ChaosTick[] {
  const out: ChaosTick[] = [];
  for (let t = 0; t < log.intent_status.length; t++)
    out.push({ tick: t, down: { drop: 0, reorder: 0, duplicate: 0, delay_max: 0 }, up: { drop: 0, reorder: 0, duplicate: 0, delay_max: 0 }, blackhole: false, move: log.intent_status[t]!, resyncs: log.resyncs[t] ?? 0 });
  for (const c of log.chaos) {
    const row = out[c.tick];
    if (!row) continue;
    if (c.action === "blackhole") {
      // The blackhole is logged once, at the tick it starts; it covers 500 ms of ticks.
      if (c.type === 0) for (let t = c.tick; t < Math.min(out.length, c.tick + Math.ceil(BLACKHOLE_MS / Math.max(1, log.tick_ms))); t++) out[t]!.blackhole = true;
      continue;
    }
    const side = row[c.dir];
    if (c.action === "drop") side.drop++;
    else if (c.action === "reorder") side.reorder++;
    else if (c.action === "duplicate") side.duplicate++;
    side.delay_max = Math.max(side.delay_max, c.delay);
  }
  return out;
}

const FATE: Record<ChaosEntry["action"], PacketFate["fate"]> = { deliver: "delayed", drop: "dropped", duplicate: "duplicated", reorder: "reordered", blackhole: "blackout" };
const fateOf = (c: ChaosEntry): PacketFate => ({ fate: c.action === "deliver" && c.delay === 0 ? "clean" : FATE[c.action], delay: c.action === "drop" || c.action === "blackhole" ? 0 : c.delay });

/** The ticks the blackhole covered, from its start entry. */
function blackoutTicks(log: ReplayLog): Set<number> {
  const out = new Set<number>();
  const bh = log.chaos.find((c) => c.action === "blackhole" && c.type === 0);
  if (bh) for (let t = bh.tick; t < bh.tick + Math.ceil(BLACKHOLE_MS / Math.max(1, log.tick_ms)); t++) out.add(t);
  return out;
}

/**
 * The connection panel for ticks `from` to `to - 1` (resolved ticks only): for each, what the chaos layer did to its
 * STATE and to your first move for it, and what became of the move. On a link with no network profile every packet
 * is clean.
 */
export function connTicks(log: ReplayLog, from = 0, to = log.intent_status.length): ConnTick[] {
  const end = Math.min(to, log.intent_status.length);
  const start = Math.max(0, from);
  if (end <= start) return [];
  const clean: PacketFate | null = log.chaos_profile ? null : { fate: "clean", delay: 0 };
  const states = new Map<number, PacketFate>();
  const moves = new Map<number, PacketFate>();
  for (const c of log.chaos) {
    if (c.tick < start || c.tick >= end || c.type === 0) continue;
    const into = c.dir === "down" && c.type === PT.STATE ? states : c.dir === "up" && c.type === PT.INTENT ? moves : null;
    if (into && !into.has(c.tick)) into.set(c.tick, fateOf(c));
  }
  const dark = blackoutTicks(log);
  const out: ConnTick[] = [];
  for (let t = start; t < end; t++) {
    const you = log.intent_status[t]!;
    const late = log.late_ms?.[t];
    out.push({
      tick: t,
      state: states.get(t) ?? (dark.has(t) ? { fate: "blackout", delay: 0 } : clean),
      move: moves.get(t) ?? (clean && you !== "m" ? clean : null),
      blackout: dark.has(t),
      you,
      late_ms: you !== "o" && late !== undefined ? late : null,
      resyncs: log.resyncs[t] ?? 0,
    });
  }
  return out;
}

/** The running totals beside the panel: every datagram the chaos layer handled, and your moves as the server judged them. */
export function connTotals(log: ReplayLog): ConnTotals {
  let entries = 0;
  let dropped = 0;
  let dupCopies = 0;
  let reordered = 0;
  let blackout = 0;
  let delaySum = 0;
  let delayN = 0;
  let delayMax = 0;
  for (const c of log.chaos) {
    if (c.type === 0) continue;
    entries++;
    if (c.action === "drop") dropped++;
    else if (c.action === "blackhole") blackout++;
    else {
      if (c.action === "duplicate") dupCopies++;
      if (c.action === "reorder") reordered++;
      delaySum += c.delay;
      delayN++;
      delayMax = Math.max(delayMax, c.delay);
    }
  }
  const st = log.intent_status;
  const count = (ch: string) => [...st].filter((x) => x === ch).length;
  return {
    ticks: st.length,
    packets: entries - Math.floor(dupCopies / 2),
    dropped,
    duplicated: Math.floor(dupCopies / 2),
    reordered,
    blackout,
    delay_avg: delayN ? Math.round(delaySum / delayN) : 0,
    delay_max: delayMax,
    on_time: count("o"),
    late: count("l") + [...st].filter((x, t) => x !== "o" && x !== "l" && log.late_ms?.[t] !== undefined).length,
    missing: [...st].filter((x, t) => x !== "o" && x !== "l" && log.late_ms?.[t] === undefined).length,
    resyncs: Object.values(log.resyncs).reduce((a, b) => a + b, 0),
  };
}
