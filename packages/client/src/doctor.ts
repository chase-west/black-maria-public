/**
 * `blackmaria doctor`: a short probe match against Novice on the Master network profile, then the summary block and
 * the numbers in it as plain facts. `python/blackmaria.py doctor` prints the same lines.
 */
import type { ConnSummary } from "@blackmaria/protocol/wire";

export const PROBE_TICKS = 60;

const s_ = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The facts behind the summary block, one line each. Numbers only; nothing about what to change. */
export function findings(s: ConnSummary): string[] {
  const out: string[] = [];
  const b = s.blackout;
  const noMove = s.missing + s.late;
  out.push(`${noMove} of ${s.ticks} ticks had no move before the deadline: ${s.missing} with none sent, ${s.late} sent late.`);
  if (b) out.push(`${b.ticks - b.acted} of the ${s_(b.ticks, "tick", "ticks")} inside the ${b.ms} ms silent window from tick ${b.from_tick} had no move before the deadline.`);
  else out.push("No silent window of 400 ms or more in this probe.");
  if (s.blind !== null) out.push(`${s_(s.blind, "delta", "deltas")} named a base you never received and ${s.blind === 1 ? "was" : "were"} applied anyway; ${s_(s.resyncs, "RESYNC", "RESYNCs")} sent.`);
  out.push(`${s.lost} of ${s.lost + s.received} packets from the server never arrived.`);
  if (s.duplicates_ignored !== null) out.push(`${s_(s.duplicates, "packet", "packets")} arrived twice; ${s.duplicates_ignored} of them skipped.`);
  out.push(s.rtt_p50 === null ? "No PONG came back, so no round trip." : `RTT p50 ${s.rtt_p50} ms, p95 ${s.rtt_p95} ms, from ${s_(s.pings, "PING", "PINGs")}.`);
  return out;
}
