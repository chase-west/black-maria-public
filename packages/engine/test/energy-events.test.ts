import { describe, expect, it } from "vitest";
import type { GameEvent } from "@blackmaria/protocol";
import { RULES, createMatch, createRng, eventsFor, matchEndFor, matchStartFor, projectEvents, step, stateFor } from "../src/index.js";
import { DROP, M, ROOM, S, T, USE, W, build, run, tick } from "./helpers.js";

const SIG = ["#######", "#.....#", "#.@$M.#", "#.....#", "#######"];

describe("3.6 energy and sigils", () => {
  it("energy is spent only on SNATCH and gains regen per tick (default 1), at most 100", () => {
    const d = run(build(ROOM, { energy: { you: 98 } }), [
      [M("N"), T],
      [W, W],
      [W, W],
    ]);
    expect(d.bodies.you.energy).toBe(100);
    expect(d.bodies.maria.energy).toBe(43);
    const two = run(build(ROOM, { params: { regen: 2 } }), [[W, W]]);
    expect(two.bodies.you.energy).toBe(42);
  });

  it("a body ending a tick on a charged sigil pays the sigil's owner +40, whoever stands there", () => {
    const s = build(SIG, { sigils: [{ pos: { x: 3, y: 2 }, owner: "maria" }] });
    const d = tick(s, M("E"), W);
    expect(d.bodies.maria.energy).toBe(40 + 40 + 1);
    expect(d.bodies.you.energy).toBe(41);
    expect(d.last!.events).toContainEqual({ kind: "sigil", owner: "maria", energy_gained: 40 });
    const own = tick(build(SIG, { sigils: [{ pos: { x: 3, y: 2 }, owner: "you" }] }), M("E"), W);
    expect(own.bodies.you.energy).toBe(81);
  });

  it("it then recharges for 60 ticks: it pays again at the earliest 60 ticks later", () => {
    let s = tick(build(SIG, { sigils: [{ pos: { x: 3, y: 2 }, owner: "you" }] }), M("E"), W);
    expect(s.sigils[0]!.cooldown).toBe(RULES.sigilRecharge);
    let paid = 0;
    let at = -1;
    for (let k = 0; k < 70; k++) {
      s = tick(s, W, W);
      if (s.last!.events.some((e) => e.kind === "sigil")) {
        paid++;
        if (at < 0) at = s.last!.tick;
      }
    }
    expect(paid).toBe(1);
    expect(at).toBe(1 + 60);
  });

  it("two bodies on one charged sigil pay the owner once; a sigil caps at 100", () => {
    const s = build(SIG, { sigils: [{ pos: { x: 3, y: 2 }, owner: "you" }], energy: { you: 90 } });
    const d = tick(s, M("E"), M("W"));
    expect(d.last!.events.filter((e) => e.kind === "sigil")).toHaveLength(1);
    expect(d.bodies.you.energy).toBe(100);
  });

  it("the energy tie-breaks use energy at the start of the tick (a snatch paid this tick does not count until the next)", () => {
    // Maria at 70 snatches you (to 10) while both of you TAKE: the TAKE resolves first, with her at 70 > your 40.
    const items = [{ id: "i1", kind: "coin" as const, pos: { x: 3, y: 3 } }, { id: "i2", kind: "ring" as const, heldBy: "you" as const }];
    const s = build(ROOM, { items, energy: { you: 40, maria: 70 } });
    s.bodies.maria.pos = { x: 3, y: 3 };
    const d = tick(s, T, T);
    expect(d.bodies.you.inventory).toContain("i1");
  });
});

describe("3.7 events: both bodies receive every event, each from its own point of view", () => {
  const view = (ev: GameEvent[]) => ev.map((e) => e.kind);

  it("posted carries the errand record", () => {
    let s = createMatch(2);
    const rng = createRng(2);
    while (s.tick < 6) s = step(s, { you: W, maria: W }, rng);
    const ev = eventsFor(s, "you").find((e) => e.kind === "posted");
    expect(ev).toEqual({ kind: "posted", errand: { ...s.board[6]!, state: "open" } });
    expect(s.board[6]!.posted).toBe(6);
  });

  it("completed carries the errand id and who; expired carries the id", () => {
    const s = build(ROOM, { items: [{ id: "i1", kind: "coin", heldBy: "maria" }], fixtures: [{ id: "f1", kind: "well", pos: { x: 5, y: 3 } }], board: [{ type: "deliver", item_kind: "coin", fixture: "f1" }, { type: "visit", room: "library", expires: 2 }] });
    const d = tick(s, W, USE("i1"));
    expect(eventsFor(d, "you")).toEqual([
      { kind: "delivered", by: "maria", item: "i1", fixture: "f1" },
      { kind: "completed", errand: 0, by: "maria" },
      { kind: "expired", errand: 1 },
    ]);
    expect(eventsFor(d, "maria")).toEqual([
      { kind: "delivered", by: "you", item: "i1", fixture: "f1" },
      { kind: "completed", errand: 0, by: "you" },
      { kind: "expired", errand: 1 },
    ]);
    expect(stateFor(d, "maria", { match_id: "m", deadline_ms: 0 }).board[0]!.state).toBe("done_by_you");
    expect(stateFor(d, "you", { match_id: "m", deadline_ms: 0 }).board[0]!.state).toBe("done_by_maria");
  });

  it("took, dropped, delivered, winding_up, snatched carry by and item", () => {
    const s = build(ROOM, { items: [{ id: "i1", kind: "coin", pos: { x: 3, y: 3 } }, { id: "i2", kind: "ring", heldBy: "maria" }], energy: { you: 60 } });
    s.bodies.maria.pos = { x: 4, y: 3 };
    let d = tick(s, T, DROP("i2"));
    expect(eventsFor(d, "you")).toEqual([
      { kind: "took", by: "you", item: "i1" },
      { kind: "dropped", by: "maria", item: "i2" },
    ]);
    d = tick(d, W, T);
    d = { ...d, bodies: { ...d.bodies, you: { ...d.bodies.you, energy: 100 } } };
    d = tick(d, S, W);
    expect(eventsFor(d, "you")).toEqual([{ kind: "winding_up", by: "you" }]);
    expect(eventsFor(d, "maria")).toEqual([{ kind: "winding_up", by: "maria" }]);
    d = tick(d, W, W);
    expect(eventsFor(d, "you")).toEqual([{ kind: "snatched", by: "you", item: "i2" }]);
    expect(eventsFor(d, "maria")).toEqual([{ kind: "snatched", by: "maria", item: "i2" }]);
  });

  it("door_opened carries x, y; safe_opened carries the fixture and the item", () => {
    const s = build(["#####", "#@L.#", "#####"], { items: [{ id: "i1", kind: "key", heldBy: "you" }] });
    expect(eventsFor(tick(s, M("E"), W), "maria")).toEqual([{ kind: "door_opened", pos: { x: 2, y: 1 } }]);
    const safe = build(ROOM, { fixtures: [{ id: "f3", kind: "safe", pos: { x: 3, y: 3 } }], items: [{ id: "i1", kind: "key", heldBy: "you" }, { id: "i7", kind: "vial", inSafe: "f3" }] });
    expect(eventsFor(tick(safe, USE("i1"), W), "maria")).toEqual([{ kind: "safe_opened", fixture: "f3", item: "i7" }]);
  });

  it("sigil carries the owner and the energy gained (always 40, so it never tells you the owner's energy)", () => {
    const s = build(SIG, { sigils: [{ pos: { x: 3, y: 2 }, owner: "maria" }], energy: { maria: 95 } });
    const d = tick(s, M("E"), W);
    expect(eventsFor(d, "you")).toContainEqual({ kind: "sigil", owner: "maria", energy_gained: 40 });
    expect(eventsFor(d, "maria")).toContainEqual({ kind: "sigil", owner: "you", energy_gained: 40 });
  });

  it("moved is the other body's executed move; yours is implied", () => {
    const d = tick(build(ROOM), M("N"), M("S"));
    expect(eventsFor(d, "you")).toEqual([{ kind: "moved", by: "maria", dir: "S" }]);
    expect(eventsFor(d, "maria")).toEqual([{ kind: "moved", by: "maria", dir: "N" }]);
    // A move into a wall executes nothing and sends nothing.
    const wall = tick(build(ROOM), W, M("E"));
    expect(view(eventsFor(wall, "you"))).toEqual([]);
  });

  it("projection keeps every kind and maps who correctly", () => {
    const evs = projectEvents({ board: [], items: [] }, [{ kind: "took", by: "maria", item: "i1" }], "maria");
    expect(evs).toEqual([{ kind: "took", by: "you", item: "i1" }]);
  });
});

describe("3.8 match end", () => {
  it("400 ticks; score is the sum of values; win, draw, loss by comparison; match_end carries both scores and the board", () => {
    let s = createMatch(11);
    const rng = createRng(11);
    let n = 0;
    while (!s.done) {
      s = step(s, { you: W, maria: W }, rng);
      n++;
    }
    expect(n).toBe(400);
    const d = build(ROOM, { board: [{ type: "visit", room: "hall", value: 1 }], params: { maxTick: 2 } });
    const e = tick(d, W, W);
    expect(e.done).toBe(true);
    const end = matchEndFor(e, "you", { match_id: "m_x", replay: "/replay/m_x" });
    expect(end.board).toHaveLength(1);
    expect(end.scores.you + end.scores.maria).toBe(1);
    const herEnd = matchEndFor(e, "maria", { match_id: "m_x", replay: "" });
    expect(herEnd.scores).toEqual({ you: end.scores.maria, maria: end.scores.you });
    expect(end.result === "win" ? herEnd.result === "loss" : herEnd.result === "win").toBe(true);
    expect(tick(e, W, W)).toBe(e);
  });

  it("match_start carries every parameter, sigil owners, both starts and the initial board", () => {
    const m = createMatch(4, { params: { snatchCost: 50, regen: 2 } });
    const ms = matchStartFor(m, "you", { match_id: "a", mode: "practice", tier: "adept", tick_ms: 250, chaos: "adept" });
    expect(ms.params).toEqual({ max_tick: 400, tick_ms: 250, post_interval: 6, expiry_min: 30, expiry_max: 70, snatch_cost: 50, regen: 2, energy_start: 40, inventory_slots: 4, return_ticks: 40, chaos: "adept" });
    expect(ms.board).toHaveLength(6);
    expect(ms.sigil_owner.slice().sort()).toEqual(["maria", "you"]);
    expect(ms.you.energy).toBe(40);
    const hers = matchStartFor(m, "maria", { match_id: "a", mode: "practice", tier: "adept", tick_ms: 250 });
    expect(hers.sigil_owner).toEqual(ms.sigil_owner.map((o) => (o === "you" ? "maria" : "you")));
  });
});
