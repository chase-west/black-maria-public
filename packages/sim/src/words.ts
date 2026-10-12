/** Everything the simulator prints, in the plain words of the rules (SPEC 8.5). */
import { PROFILER_LINE_INFO, type GameEvent, type Intent, type ProfilerLineKey, type ProfilerReport, type Result, type Tier } from "@blackmaria/protocol";
import type { MatchState } from "@blackmaria/engine";
import type { Params as EngineParams } from "@blackmaria/engine";
import { errandLabel } from "./profiler.js";

export const TIER_TITLE: Record<Tier, string> = { novice: "Novice", adept: "Adept", master: "Master" };

export function resultLine(r: Result, you: number, maria: number): string {
  if (r === "win") return `you won ${you} to ${maria}`;
  if (r === "loss") return `you lost ${you} to ${maria}`;
  return `draw, ${you} to ${maria}`;
}

export function paramsLine(p: EngineParams, chaos: string): string {
  return `max_tick ${p.maxTick}, post_interval ${p.postInterval}, expiry ${p.expiryMin} to ${p.expiryMax}, snatch_cost ${p.snatchCost}, regen ${p.regen}, energy_start ${p.energyStart}, inventory_slots ${p.inventorySlots}, chaos ${chaos}`;
}

export function moveWords(i: Intent, s: MatchState): string {
  const kind = (id: string) => s.items.find((x) => x.id === id)?.kind ?? id;
  switch (i.kind) {
    case "WAIT":
      return "WAIT";
    case "MOVE":
      return `MOVE ${i.dir}`;
    case "TAKE":
      return "TAKE";
    case "DROP":
      return `DROP the ${kind(i.item)} (${i.item})`;
    case "USE":
      return `USE the ${kind(i.item)} (${i.item})`;
    case "SNATCH":
      return "SNATCH";
  }
}

/** One event, from your point of view, in plain words. `s` is the state after the tick. */
export function eventWords(e: GameEvent, s: MatchState): string {
  const who = (w: "you" | "maria") => (w === "you" ? "you" : "Maria");
  const item = (id: string) => `the ${s.items.find((x) => x.id === id)?.kind ?? "item"} (${id})`;
  const fixture = (id: string) => `the ${s.fixtures.find((x) => x.id === id)?.kind ?? "fixture"} (${id})`;
  switch (e.kind) {
    case "posted":
      return `errand ${e.errand.id} posted: ${errandLabel(s, e.errand)}, value ${e.errand.value}, expires at tick ${e.errand.expires}`;
    case "completed": {
      const er = s.board[e.errand];
      return `${who(e.by)} completed errand ${e.errand}${er ? ` (${errandLabel(s, er)}, +${er.value})` : ""}`;
    }
    case "expired":
      return `errand ${e.errand} expired`;
    case "took":
      return `${who(e.by)} took ${item(e.item)}`;
    case "dropped":
      return `${who(e.by)} dropped ${item(e.item)}`;
    case "delivered":
      return `${who(e.by)} delivered ${item(e.item)} to ${fixture(e.fixture)}`;
    case "snatched":
      return `${who(e.by)} snatched ${item(e.item)}`;
    case "door_opened":
      return `the vault door at ${e.pos.x},${e.pos.y} opened`;
    case "safe_opened":
      return `the safe (${e.fixture}) opened, with ${item(e.item)} inside`;
    case "sigil":
      return `${e.owner === "you" ? "your" : "Maria's"} sigil paid ${e.energy_gained} energy`;
    case "moved":
      return `${who(e.by)} moved ${e.dir}`;
    case "winding_up":
      return `${who(e.by)} wound up a snatch: the grab lands next tick if the target is still in reach`;
    case "returned":
      return `a ${e.item_kind} (${e.item}) is back on the floor at ${e.pos.x},${e.pos.y}`;
  }
}

/** The profiler as text: one line per entry, each followed by the heading in docs/RULES.md it points to. */
export function profilerText(p: ProfilerReport): string {
  const rows: [ProfilerLineKey, string][] = [];
  rows.push(["completed", `${p.completed.count}, value ${p.completed.value}`]);
  const behind = p.maria_first.errands.map((e) => `errand ${e.id} (${e.label}, value ${e.value}, ${e.ticks_behind === null || e.ticks_behind === undefined ? "no item left for you" : `${e.ticks_behind} ticks behind`})`);
  rows.push(["maria_first", `${p.maria_first.count}, value ${p.maria_first.value}${behind.length ? `: ${behind.join("; ")}` : ""}`]);
  rows.push(["expired_heading", `${p.expired_heading.count}, value ${p.expired_heading.value}${p.expired_heading.errands.length ? `: ${p.expired_heading.errands.map((e) => `errand ${e.id} (${e.label})`).join("; ")}` : ""}`]);
  rows.push(["never_attempted", `${p.never_attempted.count} errands, value ${p.never_attempted.value}`]);
  rows.push(["idle", `${p.idle.ticks} of ${p.ticks}`]);
  rows.push(["network", `${p.network.ticks} (late ${p.network.late}, missing ${p.network.missing}, malformed ${p.network.malformed}), resyncs ${p.network.resyncs}`]);
  rows.push(["snatches", `for you ${p.snatches.for.count} (value ${p.snatches.for.value}), against you ${p.snatches.against.count} (value ${p.snatches.against.value})`]);
  rows.push(["energy_unused", `${p.energy_unused}`]);
  const width = Math.max(...rows.map((r) => PROFILER_LINE_INFO[r[0]].title.length));
  const lines: string[] = ["The profiler. Each \"see:\" is a heading under \"What strong bots do\" in docs/RULES.md."];
  for (const [k, v] of rows) {
    lines.push(`  ${PROFILER_LINE_INFO[k].title.padEnd(width)}  ${v}`);
    lines.push(`  ${"".padEnd(width)}  see: ${PROFILER_LINE_INFO[k].heading}`);
  }
  return lines.join("\n");
}
