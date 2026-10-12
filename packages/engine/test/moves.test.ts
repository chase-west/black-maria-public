import { describe, expect, it } from "vitest";
import { DEFAULT_PARAMS, createMatch, matchStartFor, stateFor } from "../src/index.js";
import { DROP, M, ROOM, S, T, USE, W, build, evKinds, run, seedWithCoin, tick } from "./helpers.js";

describe("3.3 bodies", () => {
  it("inventory: 4 slots, every item takes one", () => {
    const items = ["i1", "i2", "i3", "i4", "i5"].map((id) => ({ id, kind: "coin" as const, pos: { x: 3, y: 3 } }));
    const d = tick(build(ROOM, { items }), T, W);
    expect(d.bodies.you.inventory).toEqual(["i1", "i2", "i3", "i4"]);
    expect(d.items.find((i) => i.id === "i5")!.loc).toEqual({ at: "tile", pos: { x: 3, y: 3 } });
  });

  it("energy: starts at 40, +1 per tick, at most 100", () => {
    const m = createMatch(3);
    expect(m.bodies.you.energy).toBe(40);
    expect(m.bodies.maria.energy).toBe(40);
    expect(DEFAULT_PARAMS.energyStart).toBe(40);
    const d = run(build(ROOM), Array.from({ length: 5 }, () => [W, W]));
    expect(d.bodies.you.energy).toBe(45);
    const cap = run(build(ROOM, { energy: { you: 99 } }), [
      [W, W],
      [W, W],
    ]);
    expect(cap.bodies.you.energy).toBe(100);
  });

  it("both bodies act every tick, simultaneously", () => {
    const d = tick(build(ROOM), M("N"), M("S"));
    expect(d.bodies.you.pos).toEqual({ x: 3, y: 2 });
    expect(d.bodies.maria.pos).toEqual({ x: 5, y: 4 });
  });

  it("you see both positions, both inventories, every item and the whole board, and your own energy, but not Maria's", () => {
    const s = build(ROOM, { items: [{ id: "i1", kind: "ring", heldBy: "maria" }, { id: "i2", kind: "coin", pos: { x: 1, y: 1 } }], board: [{ type: "visit", room: "hall" }], energy: { you: 41, maria: 77 } });
    const v = stateFor(s, "you", { match_id: "m", deadline_ms: 250 });
    expect(v.you).toEqual({ pos: { x: 3, y: 3 }, inventory: [], energy: 41 });
    expect(v.maria).toEqual({ pos: { x: 5, y: 3 }, inventory: [{ id: "i1", kind: "ring" }] });
    expect(v.items).toEqual([{ id: "i2", kind: "coin", pos: { x: 1, y: 1 } }]);
    expect(v.board).toHaveLength(1);
    expect(JSON.stringify(v)).not.toContain("77");
    const her = stateFor(s, "maria", { match_id: "m", deadline_ms: 250 });
    expect(her.you.energy).toBe(77);
    expect(JSON.stringify(her)).not.toContain("41");
  });

  it("both bodies may occupy the same tile", () => {
    const d = run(build(ROOM), [
      [M("E"), M("W")],
      [W, W],
    ]);
    expect(d.bodies.you.pos).toEqual(d.bodies.maria.pos);
  });

  it("match_start says where both bodies start, from each point of view", () => {
    const m = createMatch(9);
    const mine = matchStartFor(m, "you", { match_id: "x", mode: "practice", tier: "novice", tick_ms: 250 });
    const hers = matchStartFor(m, "maria", { match_id: "x", mode: "practice", tier: "novice", tick_ms: 250 });
    expect(mine.start).toEqual(m.map.start);
    expect(mine.maria_start).toEqual(m.map.mariaStart);
    expect(hers.start).toEqual(m.map.mariaStart);
    expect(hers.maria_start).toEqual(m.map.start);
  });
});

describe("3.4 moves", () => {
  it("WAIT does nothing, and is the default for a malformed move", () => {
    const s = build(ROOM);
    const d = tick(s, W, { kind: "BOGUS" } as never);
    expect(d.bodies.you.pos).toEqual(s.bodies.you.pos);
    expect(d.bodies.maria.pos).toEqual(s.bodies.maria.pos);
    expect(d.last!.submitted.maria).toEqual(W);
    const bad = tick(s, { kind: "MOVE", dir: "X" } as never, { kind: "DROP" } as never);
    expect(bad.last!.submitted).toEqual({ you: W, maria: W });
  });

  it("MOVE steps one tile; into a wall or off the map it does nothing", () => {
    const d = tick(build(ROOM), M("E"), M("E"));
    expect(d.bodies.you.pos).toEqual({ x: 4, y: 3 });
    expect(d.bodies.maria.pos).toEqual({ x: 5, y: 3 }); // wall at x = 6
    const edge = build([".@."]);
    expect(tick(edge, M("N"), W).bodies.you.pos).toEqual({ x: 1, y: 0 });
  });

  it("MOVE into door_locked holding a key opens the door, uses up the key, and the body stays put", () => {
    const map = ["#####", "#@L.#", "#####"];
    const s = build(map, { items: [{ id: "i1", kind: "key", heldBy: "you" }] });
    const d = tick(s, M("E"), W);
    expect(d.bodies.you.pos).toEqual({ x: 1, y: 1 });
    expect(d.doorsOpened).toEqual([{ x: 2, y: 1 }]);
    expect(d.bodies.you.inventory).toEqual([]);
    expect(d.items[0]!.loc).toEqual({ at: "consumed" });
    expect(evKinds(d)).toContain("door_opened");
    expect(tick(d, M("E"), W).bodies.you.pos).toEqual({ x: 2, y: 1 });
    // Without a key it is a wall.
    expect(tick(build(map), M("E"), W).bodies.you.pos).toEqual({ x: 1, y: 1 });
  });

  it("TAKE picks up items on your tile in ascending id order until the inventory is full", () => {
    const items = [
      { id: "i12", kind: "coin" as const, pos: { x: 3, y: 3 } },
      { id: "i3", kind: "ring" as const, pos: { x: 3, y: 3 } },
      { id: "i9", kind: "vial" as const, pos: { x: 4, y: 3 } },
    ];
    const d = tick(build(ROOM, { items, params: { inventorySlots: 4 } }), T, W);
    expect(d.bodies.you.inventory).toEqual(["i3", "i12"]);
    expect(evKinds(d)).toEqual(["took", "took"]);
  });

  it("TAKE by both on one tile: items alternate, starting with the body with less energy", () => {
    const items = ["i1", "i2", "i3"].map((id) => ({ id, kind: "coin" as const, pos: { x: 3, y: 2 } }));
    const s = build(["#######", "#.....#", "#..@..#", "#.....#", "#######"], { items, energy: { you: 50, maria: 30 } });
    s.bodies.maria.pos = { x: 3, y: 2 };
    const d = tick(s, T, T);
    expect(d.bodies.maria.inventory).toEqual(["i1", "i3"]);
    expect(d.bodies.you.inventory).toEqual(["i2"]);
    const low = tick({ ...s, bodies: { you: { ...s.bodies.you, energy: 20 }, maria: s.bodies.maria } }, T, T);
    expect(low.bodies.you.inventory).toEqual(["i1", "i3"]);
  });

  it("TAKE by both with equal energy: the seed's coin picks who starts", () => {
    for (const want of ["you", "maria"] as const) {
      const seed = seedWithCoin(1, want);
      const s = build(["#####", "#.@.#", "#####"], { seed, items: [{ id: "i1", kind: "coin", pos: { x: 2, y: 1 } }], energy: { you: 40, maria: 40 } });
      s.bodies.maria.pos = { x: 2, y: 1 };
      const d = tick(s, T, T);
      expect(d.bodies[want].inventory).toEqual(["i1"]);
      expect(d.last!.priority).toBe(want);
    }
  });

  it("TAKE by both: when one body is full the other takes the rest", () => {
    const items = ["i1", "i2", "i3"].map((id) => ({ id, kind: "coin" as const, pos: { x: 2, y: 1 } }));
    const s = build(["#####", "#.@.#", "#####"], { items: [...items, { id: "i9", kind: "ring", heldBy: "maria" }], params: { inventorySlots: 1 }, energy: { maria: 10 } });
    s.bodies.maria.pos = { x: 2, y: 1 };
    const d = tick(s, T, T);
    expect(d.bodies.you.inventory).toEqual(["i1"]);
    expect(d.bodies.maria.inventory).toEqual(["i9"]);
  });

  it("DROP puts that item on your tile; an item you do not hold is a no-op", () => {
    const s = build(ROOM, { items: [{ id: "i1", kind: "coin", heldBy: "you" }, { id: "i2", kind: "ring", heldBy: "maria" }] });
    const d = tick(s, DROP("i1"), DROP("i1"));
    expect(d.bodies.you.inventory).toEqual([]);
    expect(d.items[0]!.loc).toEqual({ at: "tile", pos: { x: 3, y: 3 } });
    expect(d.bodies.maria.inventory).toEqual(["i2"]);
    expect(evKinds(d)).toEqual(["dropped"]);
  });

  it("USE on a fixture delivers the item and removes it from the world; with no fixture it is a no-op", () => {
    const s = build(ROOM, { items: [{ id: "i1", kind: "coin", heldBy: "you" }, { id: "i2", kind: "ring", heldBy: "maria" }], fixtures: [{ id: "f1", kind: "well", pos: { x: 3, y: 3 } }] });
    const d = tick(s, USE("i1"), USE("i2"));
    expect(d.items[0]!.loc).toEqual({ at: "delivered", fixture: "f1", tick: d.last!.tick });
    expect(d.bodies.you.inventory).toEqual([]);
    expect(d.bodies.maria.inventory).toEqual(["i2"]);
    expect(d.last!.events).toEqual([{ kind: "delivered", by: "you", item: "i1", fixture: "f1" }]);
  });

  it("USE a key on a closed safe opens it: the key is used up and the item inside lands on the safe's tile", () => {
    const s = build(ROOM, {
      fixtures: [{ id: "f1", kind: "safe", pos: { x: 3, y: 3 } }],
      items: [
        { id: "i1", kind: "key", heldBy: "you" },
        { id: "i2", kind: "ledger", inSafe: "f1" },
      ],
    });
    const d = tick(s, USE("i1"), W);
    expect(d.safe).toEqual({ fixture: "f1", open: true });
    expect(d.items[0]!.loc).toEqual({ at: "consumed" });
    expect(d.items[1]!.loc).toEqual({ at: "tile", pos: { x: 3, y: 3 } });
    expect(d.last!.events).toEqual([{ kind: "safe_opened", fixture: "f1", item: "i2" }]);
  });

  const HELD = [{ id: "i1", kind: "coin" as const, heldBy: "maria" as const }, { id: "i2", kind: "ring" as const, heldBy: "maria" as const }];

  it("SNATCH is two ticks: the wind-up pays snatch_cost and says so; the grab next tick takes one item chosen by seed", () => {
    const s = build(ROOM, { items: HELD, energy: { you: 100 } });
    s.bodies.maria.pos = { x: 4, y: 3 };
    const w = tick(s, S, W);
    expect(w.bodies.you.energy).toBe(1);
    expect(w.pendingGrab).toBe("you");
    expect(w.bodies.maria.inventory).toHaveLength(2);
    expect(w.last!.events).toEqual([{ kind: "winding_up", by: "you" }]);
    const g = tick(w, W, W);
    expect(g.pendingGrab).toBe(null);
    expect(g.bodies.you.inventory).toHaveLength(1);
    expect(g.bodies.maria.inventory).toHaveLength(1);
    const taken = g.bodies.you.inventory[0]!;
    expect(g.items.find((i) => i.id === taken)!.loc).toEqual({ at: "held", by: "you" });
    expect(g.last!.events).toEqual([{ kind: "snatched", by: "you", item: taken }]);
    // Same tile works too; the choice is by seed and deterministic.
    s.bodies.maria.pos = { x: 3, y: 3 };
    expect(tick(tick(s, S, W), W, W).bodies.you.inventory).toEqual([taken]);
  });

  it("stepping out of reach on the grab tick escapes it, and the energy stays spent", () => {
    const s = build(ROOM, { items: HELD, energy: { you: 100 } });
    s.bodies.maria.pos = { x: 4, y: 3 };
    const g = tick(tick(s, S, W), W, M("E"));
    expect(g.bodies.maria.inventory).toHaveLength(2);
    expect(g.bodies.you.energy).toBe(2);
    expect(evKinds(g)).toEqual(["moved"]);
  });

  it("reach is checked after both bodies move: a grabber may follow", () => {
    const s = build(ROOM, { items: HELD, energy: { you: 100 } });
    s.bodies.maria.pos = { x: 4, y: 3 };
    const g = tick(tick(s, S, W), M("E"), M("E"));
    expect(g.bodies.you.inventory).toHaveLength(1);
    expect(evKinds(g)).toEqual(["moved", "moved", "snatched"]);
  });

  it("a wind-up with nobody in reach or too little energy does nothing and costs nothing", () => {
    const far = build(ROOM, { items: HELD, energy: { you: 100 } }); // two tiles apart
    const f = tick(far, S, W);
    expect(f.bodies.you.energy).toBe(100);
    expect(f.pendingGrab).toBe(null);
    const diag = build(ROOM, { items: HELD, energy: { you: 100 } });
    diag.bodies.maria.pos = { x: 4, y: 4 };
    expect(tick(diag, S, W).last!.events).toEqual([]);
    const poor = build(ROOM, { items: HELD, energy: { you: 99 } });
    poor.bodies.maria.pos = { x: 4, y: 3 };
    const p = tick(poor, S, W);
    expect(p.bodies.you.energy).toBe(100);
    expect(p.last!.events).toEqual([]);
  });

  it("a grab with nothing to take or no free slot takes nothing", () => {
    const empty = build(ROOM, { energy: { you: 100 } });
    empty.bodies.maria.pos = { x: 4, y: 3 };
    const e = tick(tick(empty, S, W), W, W);
    expect(e.bodies.you.inventory).toEqual([]);
    expect(e.bodies.you.energy).toBe(2);
    const full = build(ROOM, { items: [...HELD, { id: "i3", kind: "ring", heldBy: "you" }], energy: { you: 100 }, params: { inventorySlots: 1 } });
    full.bodies.maria.pos = { x: 4, y: 3 };
    expect(tick(tick(full, S, W), W, W).bodies.you.inventory).toEqual(["i3"]);
  });

  it("two wind-ups in the same tick: more energy at the start of the tick winds up, the other costs nothing; a tie goes by seed", () => {
    const items = [{ id: "i1", kind: "coin" as const, heldBy: "maria" as const }, { id: "i2", kind: "ring" as const, heldBy: "you" as const }];
    const s = build(ROOM, { items, energy: { you: 70, maria: 65 }, params: { snatchCost: 50 } });
    s.bodies.maria.pos = { x: 4, y: 3 };
    const w = tick(s, S, S);
    expect(w.last!.events).toEqual([{ kind: "winding_up", by: "you" }]);
    expect(w.bodies.you.energy).toBe(21);
    expect(w.bodies.maria.energy).toBe(66);
    expect(tick(w, W, W).bodies.you.inventory.sort()).toEqual(["i1", "i2"]);
    for (const want of ["you", "maria"] as const) {
      const t = build(ROOM, { seed: seedWithCoin(1, want), items, energy: { you: 100, maria: 100 } });
      t.bodies.maria.pos = { x: 4, y: 3 };
      expect(tick(t, S, S).pendingGrab).toBe(want);
    }
  });

  it("resolution order: MOVE, the pending grab, TAKE, DROP, USE, new wind-ups, then the environment", () => {
    // Maria steps onto your tile and drops after your TAKE, so you cannot take what she drops.
    const s = build(ROOM, { items: HELD });
    s.bodies.maria.pos = { x: 5, y: 3 };
    let d = tick(s, M("E"), M("W")); // you to (4,3), Maria to (4,3)
    expect(d.bodies.you.pos).toEqual(d.bodies.maria.pos);
    d = tick(d, T, DROP("i1"));
    expect(d.bodies.you.inventory).toEqual([]);
    d = tick(d, T, W);
    expect(d.bodies.you.inventory).toEqual(["i1"]);
    // A USE resolves before a wind-up in the same tick: the delivery stands.
    const fx = [{ id: "f1", kind: "well" as const, pos: { x: 4, y: 3 } }];
    const u = build(ROOM, { items: [{ id: "i1", kind: "coin", heldBy: "maria" }], fixtures: fx, energy: { you: 100 } });
    u.bodies.maria.pos = { x: 4, y: 3 };
    const e = tick(u, S, USE("i1"));
    expect(evKinds(e)).toEqual(["delivered", "winding_up"]);
    // The grab resolves before a USE on the grab tick: the item is gone before she can deliver it.
    const v = build(ROOM, { items: [{ id: "i1", kind: "coin", heldBy: "maria" }], fixtures: fx, energy: { you: 100 } });
    v.bodies.maria.pos = { x: 4, y: 3 };
    const after = tick(tick(v, S, W), W, USE("i1"));
    expect(evKinds(after)).toEqual(["snatched"]);
    expect(after.bodies.you.inventory).toEqual(["i1"]);
  });
});

describe("3.3 the house puts things back", () => {
  const TWO = ["#########", "#...#...#", "#.@.+...#", "#...#...#", "#########"];
  const ROOMS = ["#########", "#hhh#lll#", "#hhhclll#", "#hhh#lll#", "#########"];

  it("a delivered item reappears return_ticks later, with a new id, on a floor tile in another room", () => {
    const s = build(TWO, { rooms: ROOMS, items: [{ id: "i1", kind: "coin", heldBy: "you" }], fixtures: [{ id: "f1", kind: "well", pos: { x: 2, y: 2 } }], params: { returnTicks: 3 } });
    let d = tick(s, USE("i1"), W);
    expect(d.items[0]!.loc).toEqual({ at: "delivered", fixture: "f1", tick: 1 });
    d = tick(d, W, W);
    d = tick(d, W, W);
    expect(d.items).toHaveLength(1);
    d = tick(d, W, W);
    expect(d.items).toHaveLength(2);
    const back = d.items[1]!;
    expect(back.id).toBe("i2");
    expect(back.kind).toBe("coin");
    expect(back.loc.at).toBe("tile");
    const pos = (back.loc as { pos: { x: number; y: number } }).pos;
    expect(d.map.rooms[pos.y]![pos.x]).toBe("library");
    expect(d.last!.events).toEqual([{ kind: "returned", item: "i2", pos }]);
  });

  it("the key and the safe's item do not return", () => {
    const s = build(TWO, {
      rooms: ROOMS,
      items: [{ id: "i1", kind: "key", heldBy: "you" }, { id: "i2", kind: "vial", heldBy: "you" }],
      fixtures: [{ id: "f1", kind: "well", pos: { x: 2, y: 2 } }],
      params: { returnTicks: 2 },
    });
    s.items[1]!.fromSafe = true;
    let d = tick(tick(s, USE("i1"), W), USE("i2"), W);
    for (let k = 0; k < 5; k++) d = tick(d, W, W);
    expect(d.items).toHaveLength(2);
  });
});
