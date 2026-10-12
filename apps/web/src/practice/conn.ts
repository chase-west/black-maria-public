/**
 * The connection panel's data path: wire_status messages carry the newest ticks of your own wire match, and a
 * later copy of a tick replaces an earlier one. The panel shows the last 100, and only labels.
 */
import type { ConnTick, PacketFate } from "@blackmaria/protocol";

export const CONN_TICKS = 100;

/** Merge newly arrived ticks into what's on screen: by tick, newest copy wins, the last `limit` kept, in order. */
export function mergeConn(prev: readonly ConnTick[] | undefined, incoming: readonly ConnTick[], limit = CONN_TICKS): ConnTick[] {
  const byTick = new Map<number, ConnTick>();
  for (const t of prev ?? []) byTick.set(t.tick, t);
  for (const t of incoming) byTick.set(t.tick, t);
  return [...byTick.values()].sort((a, b) => a.tick - b.tick).slice(-limit);
}

/** The ticks before `upTo` (the replay's scrubber), the last `size` of them. */
export function connWindow(all: readonly ConnTick[], upTo: number, size = CONN_TICKS): ConnTick[] {
  return all.filter((t) => t.tick < upTo).slice(-size);
}

const FATE_WORD: Record<PacketFate["fate"], string> = { clean: "clean", delayed: "delayed", dropped: "dropped", duplicated: "duplicated", reordered: "reordered", blackout: "lost in the blackout" };

function fateLabel(what: string, f: PacketFate | null): string {
  if (!f) return `${what} none`;
  if (f.fate === "delayed") return `${what} delayed ${f.delay} ms`;
  if (f.fate === "duplicated" || f.fate === "reordered") return `${what} ${FATE_WORD[f.fate]}${f.delay ? `, ${f.delay} ms` : ""}`;
  return `${what} ${FATE_WORD[f.fate]}`;
}

/** The labels for one tick: what the network did to its packets, and what became of your move. */
export function tickLabels(t: ConnTick): { network: string; you: string } {
  const inside = t.blackout && t.state?.fate !== "blackout" && t.move?.fate !== "blackout";
  const network = [fateLabel("STATE", t.state), fateLabel("move", t.move), inside ? "in the blackout" : null].filter(Boolean).join(" · ");
  const move = t.you === "o" ? "on time" : t.late_ms !== null ? `late by ${t.late_ms} ms` : t.you === "x" ? "malformed" : "missing";
  return { network, you: `${move}${t.resyncs ? ` · resync ${t.resyncs}` : ""}` };
}

/** The class for a tick's network cell: the worst thing that happened to its packets. */
export function netClass(t: ConnTick): string {
  const fates = [t.state?.fate, t.move?.fate];
  if (t.blackout || fates.includes("blackout")) return "n-blackout";
  if (fates.includes("dropped")) return "n-dropped";
  if (fates.includes("duplicated")) return "n-duplicated";
  if (fates.includes("reordered")) return "n-reordered";
  return "n-delayed";
}

/** The class for a tick's move cell. */
export function youClass(t: ConnTick): string {
  return t.you === "o" ? "m-o" : t.late_ms !== null || t.you === "l" ? "m-l" : t.you === "x" ? "m-x" : "m-m";
}
