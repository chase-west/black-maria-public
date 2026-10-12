/**
 * Measuring a wire client: one record per tick, the summary block, and how both print. The published client uses it
 * for `--trace` and `doctor`, and the simulator's `sim wire --check` prints the same block from the server's side.
 * The Python client (`packages/client/python/meter.py`) prints exactly the same text.
 */

/** What became of your move for one tick, as the client sees it. */
export type TickStatus = "on_time" | "late" | "missing";

/** One tick of one match, from the client's side. Keys are snake_case so the record is the same in Python. */
export interface TickRecord {
  match: number;
  tick: number;
  /** ms after the tick's deadline started that its STATE arrived, or null when it never did. */
  state_ms: number | null;
  /** ms the bot took to plan the move, or null when it never planned one. */
  think_ms: number | null;
  /** ms after the deadline started that the move left (below 0: sent ahead), or null when none did. */
  sent_ms: number | null;
  status: TickStatus;
  /** ms to spare: the deadline, minus when the move left, minus half the round trip. Null when no move left. */
  margin_ms: number | null;
  /** A RESYNC went out for this tick. */
  resync: boolean;
  /** Packets missing from the server's seq just before this tick's STATE. */
  seq_gap: number;
}

/** The summary block printed at the end of every match. */
export interface ConnSummary {
  /** The first line, e.g. "Connection, match 3 against Maria (Novice), network master:". */
  title: string;
  ticks: number;
  on_time: number;
  late: number;
  missing: number;
  /** Round trip from PING to PONG, in ms. Null without a PONG. */
  rtt_p50: number | null;
  rtt_p95: number | null;
  pings: number;
  /** Packets from the server that never arrived (gaps in its seq), and the ones that did. */
  lost: number;
  received: number;
  /** Packets that arrived twice, and how many of those the client skipped. Null when it can't be known. */
  duplicates: number;
  duplicates_ignored: number | null;
  resyncs: number;
  /** Deltas applied to a base the client never received. Null when it can't be known. */
  blind: number | null;
  /** The longest silence of a blackout length, the ticks inside it, and how many of those got a move in time. */
  blackout: { from_tick: number; ticks: number; acted: number; ms: number } | null;
  /** Moves by deadline margin, one count per bucket in MARGIN_BUCKETS. */
  margins: number[];
}

/** Nothing arriving for at least this long, with a match running, is a blackout, whatever caused it. Master has one 400 ms blackhole a match. */
export const BLACKOUT_MS = 400;
export const MARGIN_BUCKETS = ["late", "0-49 ms", "50-99 ms", "100-149 ms", "150-199 ms", "200+ ms"] as const;

/** The margin bucket for a move with this many ms to spare. */
export function marginBucket(ms: number): number {
  if (ms < 0) return 0;
  return Math.min(MARGIN_BUCKETS.length - 1, 1 + Math.floor(ms / 50));
}

/** Nearest-rank percentile of whole numbers, or null for none. */
export function percentile(xs: readonly number[], p: number): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const i = Math.max(0, Math.min(s.length - 1, Math.ceil((p * s.length) / 100) - 1));
  return s[i]!;
}

/** `part` of `whole` as a percentage with one decimal, rounded down ("86.6"). Integer math, so Python prints the same. */
export function pct(part: number, whole: number): string {
  if (whole <= 0) return "0.0";
  const tenths = Math.floor((1000 * part) / whole);
  return `${Math.floor(tenths / 10)}.${tenths % 10}`;
}

const STATUS_WORDS: Record<TickStatus, string> = { on_time: "on time", late: "late", missing: "missing" };
const ms = (v: number | null, signed: boolean) => (v === null ? "-" : `${signed && v >= 0 ? "+" : ""}${v} ms`);

/** The column heads for `--trace`. */
export function traceHeader(): string {
  return `${"match".padStart(5)}  ${"tick".padStart(4)}  ${"state".padEnd(9)}  ${"think".padEnd(7)}  ${"sent".padEnd(9)}  ${"move".padEnd(7)}  ${"resync".padEnd(6)}  ${"gap".padStart(3)}`;
}

/** One `--trace` line, aligned under `traceHeader()`. */
export function traceLine(r: TickRecord): string {
  const state = r.state_ms === null ? "missing" : ms(r.state_ms, true);
  return `${String(r.match).padStart(5)}  ${String(r.tick).padStart(4)}  ${state.padEnd(9)}  ${ms(r.think_ms, false).padEnd(7)}  ${ms(r.sent_ms, true).padEnd(9)}  ${STATUS_WORDS[r.status].padEnd(7)}  ${(r.resync ? "yes" : "no").padEnd(6)}  ${String(r.seq_gap).padStart(3)}`;
}

const BAR_MAX = 30;

/** The summary block, one line per entry. */
export function summaryLines(s: ConnSummary): string[] {
  const row = (label: string, value: string) => `  ${label.padEnd(16)} ${value}`;
  const out = [s.title];
  out.push(row("on time", `${s.on_time} of ${s.ticks} (${pct(s.on_time, s.ticks)}%)`));
  out.push(row("moves late", String(s.late)));
  out.push(row("moves missing", String(s.missing)));
  out.push(row("round trip", s.rtt_p50 === null ? "no PONG came back" : `p50 ${s.rtt_p50} ms, p95 ${s.rtt_p95} ms, from ${s.pings} pings`));
  out.push(row("packets lost", `${s.lost} of ${s.lost + s.received} (gaps in the server's seq)`));
  out.push(row("duplicates", s.duplicates_ignored === null ? `${s.duplicates} arrived twice` : `${s.duplicates_ignored} of ${s.duplicates} ignored`));
  out.push(row("resyncs", s.blind === null ? String(s.resyncs) : `${s.resyncs}, and ${s.blind} deltas applied to a base it never got`));
  const b = s.blackout;
  out.push(row("blackout", b === null ? "none seen" : `${b.ms} ms from tick ${b.from_tick}: acted on ${b.acted} of ${b.ticks} ticks${b.ticks > 0 && b.acted === b.ticks ? ", survived" : ""}`));
  const top = Math.max(1, ...s.margins);
  MARGIN_BUCKETS.forEach((name, i) => {
    const n = s.margins[i] ?? 0;
    const bar = "#".repeat(n === 0 ? 0 : Math.max(1, Math.floor((n * BAR_MAX) / top)));
    out.push(`  ${(i === 0 ? "deadline margin" : "").padEnd(16)} ${name.padEnd(10)} ${String(n).padStart(4)}  ${bar}`.trimEnd());
  });
  return out;
}

/** The summary block as text. */
export function summaryText(s: ConnSummary): string {
  return summaryLines(s).join("\n");
}
