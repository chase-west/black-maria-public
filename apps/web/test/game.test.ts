import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Errand, MatchStartMsg, StateMsg } from "@blackmaria/protocol";
import { applyState, fromStart } from "../src/game/view.js";

const root = join(__dirname, "..");
function walk(d: string, out: string[] = []): string[] {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(f)) out.push(p);
  }
  return out;
}
const src = walk(join(root, "src")).map((f) => readFileSync(f, "utf8")).join("\n");

describe("the event bus (SPEC 8.4, sound hook)", () => {
  it("every moment the bus declares is emitted somewhere", () => {
    const bus = readFileSync(join(root, "src/game/bus.ts"), "utf8");
    const kinds = [...bus.matchAll(/\{ kind: "([a-z_]+)"/g)].map((m) => m[1]!);
    expect(kinds).toEqual(expect.arrayContaining(["completed", "snatched", "winding_up", "match_end", "profiler_shown", "change_revealed", "official_started", "official_match_end", "official_done", "submitted"]));
    for (const k of kinds) {
      const direct = src.includes(`bus.emit({ kind: "${k}"`);
      const passthrough = (k === "door_opened" || k === "safe_opened") && /bus\.emit\(\{ kind: e\.kind \}\)/.test(src);
      expect(direct || passthrough, k).toBe(true);
    }
  });
});

describe("captions under the board (SPEC 8.4: readable at a glance)", () => {
  const start = {
    type: "match_start",
    match_id: "m",
    mode: "practice",
    tier: "novice",
    params: { max_tick: 400, tick_ms: 250, post_interval: 6, expiry_min: 30, expiry_max: 70, snatch_cost: 100, regen: 1, energy_start: 40, inventory_slots: 4, return_ticks: 40, chaos: "off" },
    map: { w: 3, h: 1, tiles: [["floor", "floor", "floor"]], rooms: [["hall", "hall", "hall"]] },
    room_names: ["hall"],
    fixtures: [{ id: "f1", kind: "fireplace", pos: { x: 2, y: 0 } }],
    items: [{ id: "i1", kind: "letter", pos: { x: 0, y: 0 } }],
    safe_items: [],
    decor: [],
    start: { x: 1, y: 0 },
    maria_start: { x: 0, y: 0 },
    sigil_owner: [],
    board: [],
    you: { energy: 40 },
  } as unknown as MatchStartMsg;
  const errand: Errand = { id: 0, type: "deliver", item_kind: "letter", fixture: "f1", value: 4, posted: 0, expires: 60, state: "done_by_you" };
  const state = (tick: number, events: StateMsg["events"]): StateMsg =>
    ({ type: "state", match_id: "m", tick, deadline_ms: 250, you: { pos: { x: 1, y: 0 }, inventory: [], energy: 40 }, maria: { pos: { x: 0, y: 0 }, inventory: [] }, items: [], board: [errand], doors_opened: [], safes_opened: [], sigil_charge: [], scores: { you: 4, maria: 0 }, events }) as StateMsg;

  it("says what happened in plain words, with the value", () => {
    let v = fromStart(start);
    v = applyState(v, state(1, [{ kind: "completed", errand: 0, by: "you" }]));
    expect(v.captions.at(-1)!.text).toBe("you +4 · letter to fireplace");
    v = applyState(v, state(2, [{ kind: "winding_up", by: "maria" }]));
    expect(v.captions.at(-1)!.text).toMatch(/Maria winding up · step out of reach/);
    v = applyState(v, state(3, [{ kind: "returned", item: "i2", item_kind: "letter", pos: { x: 0, y: 0 } }]));
    expect(v.captions.at(-1)!.text).toBe("letter back on the floor");
  });
});
