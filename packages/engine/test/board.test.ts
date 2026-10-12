import { describe, expect, it } from "vitest";
import { ITEM_KINDS, type Errand } from "@blackmaria/protocol";
import { RULES, SeqRng, createMatch, createRng, drawValue, distanceField, itemAvailable, itemPos, keyInWorld, lastPostTick, step, vaultReachable, type MatchState } from "../src/index.js";
import { DROP, M, ROOM, T, USE, W, build, run, seedWithCoin, tick } from "./helpers.js";

const HOUSE = ["#########", "#...#...#", "#.@.+.M.#", "#...#...#", "#########"];
const HOUSE_ROOMS = ["#########", "#hhh#lll#", "#hhhclll#", "#hhh#lll#", "#########"];

describe("3.5 errand types", () => {
  it("deliver completes when a body USEs an item of that kind on that fixture", () => {
    const s = build(ROOM, {
      items: [{ id: "i1", kind: "coin", heldBy: "you" }, { id: "i2", kind: "ring", heldBy: "you" }],
      fixtures: [{ id: "f1", kind: "well", pos: { x: 3, y: 3 } }, { id: "f2", kind: "clock", pos: { x: 1, y: 1 } }],
      board: [{ type: "deliver", item_kind: "coin", fixture: "f1", value: 4 }],
    });
    const wrongItem = tick(s, USE("i2"), W);
    expect(wrongItem.board[0]!.state).toBe("open");
    const d = tick(s, USE("i1"), W);
    expect(d.board[0]!.state).toBe("done_by_you");
    expect(d.bodies.you.score).toBe(4);
  });

  it("values are drawn by seed, independent of distance: deliver 1 to 9, carry 1 to 6, visit 1 to 3", () => {
    expect(RULES.deliverValue).toEqual([1, 9]);
    expect(RULES.carryValue).toEqual([1, 6]);
    expect(RULES.visitValue).toEqual([1, 3]);
    expect([0, 1, 8, 9, 17].map((d) => drawValue(RULES.deliverValue, d))).toEqual([1, 2, 9, 1, 9]);
    expect([0, 5, 6].map((d) => drawValue(RULES.carryValue, d))).toEqual([1, 6, 1]);
    expect([0, 2, 3].map((d) => drawValue(RULES.visitValue, d))).toEqual([1, 3, 1]);
  });

  it("visit completes when a body ends a tick in that room and scores its value", () => {
    const s = build(HOUSE, { rooms: HOUSE_ROOMS, board: [{ type: "visit", room: "library" }] });
    s.bodies.maria.pos = { x: 1, y: 1 };
    const d = run(s, [
      [M("E"), W],
      [M("E"), W],
    ]);
    expect(d.board[0]!.state).toBe("open"); // (4, 2) is the doorway: corridor
    const e = tick(d, M("E"), W);
    expect(e.board[0]!.state).toBe("done_by_you");
    expect(e.bodies.you.score).toBe(1);
    // Standing in the room when the tick ends is enough.
    const hers = tick(build(HOUSE, { rooms: HOUSE_ROOMS, board: [{ type: "visit", room: "library" }] }), W, W);
    expect(hers.board[0]!.state).toBe("done_by_maria");
  });

  it("carry completes when a body holds an item of that kind for n consecutive ticks; n in {8, 12, 16}", () => {
    expect(RULES.carryTicks).toEqual([8, 12, 16]);
    const s = build(ROOM, { items: [{ id: "i1", kind: "candle", pos: { x: 3, y: 3 } }], board: [{ type: "carry", item_kind: "candle", carry_ticks: 8 }] });
    let d = tick(s, T, W);
    for (let k = 0; k < 6; k++) d = tick(d, W, W);
    expect(d.board[0]!.state).toBe("open"); // 7 ticks held
    d = tick(d, W, W);
    expect(d.board[0]!.state).toBe("done_by_you");
    expect(d.bodies.you.score).toBe(2);
  });

  it("carry: dropping the item resets the count; ticks held before posting do not count", () => {
    const s = build(ROOM, { items: [{ id: "i1", kind: "candle", heldBy: "you" }], board: [{ type: "carry", item_kind: "candle", carry_ticks: 8 }] });
    let d = run(s, Array.from({ length: 5 }, () => [W, W]));
    d = tick(d, DROP("i1"), W);
    d = tick(d, T, W);
    for (let k = 0; k < 6; k++) d = tick(d, W, W);
    expect(d.board[0]!.state).toBe("open");
    d = tick(d, W, W);
    expect(d.board[0]!.state).toBe("done_by_you");
    // Posted at tick 5, held since tick 1: counting starts at 5, so it completes at the end of tick 12.
    let e = build(ROOM, { items: [{ id: "i1", kind: "candle", heldBy: "you" }], board: [{ type: "carry", item_kind: "candle", carry_ticks: 8, posted: 5 }] });
    for (let k = 0; k < 11; k++) e = tick(e, W, W);
    expect(e.tick).toBe(12);
    expect(e.board[0]!.state).toBe("open");
    e = tick(e, W, W);
    expect(e.board[0]!.state).toBe("done_by_you");
  });

  it("an errand cannot be completed before it is posted", () => {
    const s = build(HOUSE, { rooms: HOUSE_ROOMS, board: [{ type: "visit", room: "library", posted: 5 }] });
    expect(s.tick).toBe(1);
    let d = run(s, Array.from({ length: 3 }, () => [W, W]));
    expect(d.board[0]!.state).toBe("open");
    d = run(d, [
      [W, W],
      [W, W],
    ]);
    expect(d.tick).toBe(6);
    expect(d.board[0]!.state).toBe("done_by_maria");
  });
});

describe("3.5 posting, expiry, completion", () => {
  it("posting: 6 errands at tick 0, then one every post_interval ticks until tick 360 (about 65 a match)", () => {
    let total = 0;
    for (let seed = 1; seed <= 50; seed++) {
      let s = createMatch(seed);
      expect(s.board.filter((e) => e.posted === 0)).toHaveLength(6);
      const rng = createRng(seed);
      while (!s.done) s = step(s, { you: W, maria: W }, rng);
      const posts = s.board.filter((e) => e.posted > 0).map((e) => e.posted);
      expect(posts.every((t) => t % 6 === 0 && t <= 360)).toBe(true);
      expect(new Set(posts).size).toBe(posts.length);
      total += s.board.length;
    }
    expect(lastPostTick({ ...createMatch(1).params })).toBe(360);
    expect(total / 50).toBeGreaterThan(65);
    expect(total / 50).toBeLessThanOrEqual(66);
  });

  it("post_interval 3 posts twice as often (change 1)", () => {
    let s = createMatch(5, { params: { postInterval: 3, expiryMin: 20, expiryMax: 45 } });
    const rng = createRng(5);
    while (!s.done) s = step(s, { you: W, maria: W }, rng);
    expect(s.board.length).toBeGreaterThan(120);
    for (const e of s.board) {
      expect(e.expires - e.posted).toBeGreaterThanOrEqual(20);
      expect(e.expires - e.posted).toBeLessThanOrEqual(45);
    }
  });

  it("expiry: expires = posted + e, e in [30, 70]; an errand nobody completes becomes expired", () => {
    for (let seed = 1; seed <= 30; seed++) for (const e of createMatch(seed).board) expect(e.expires - e.posted).toBeGreaterThanOrEqual(30);
    for (let seed = 1; seed <= 30; seed++) for (const e of createMatch(seed).board) expect(e.expires - e.posted).toBeLessThanOrEqual(70);
    const s = build(HOUSE, { rooms: HOUSE_ROOMS, board: [{ type: "visit", room: "library", expires: 3 }], tick: 1 });
    s.bodies.maria.pos = { x: 2, y: 2 };
    const a = tick(s, W, W);
    expect(a.board[0]!.state).toBe("open");
    const b = tick(a, W, W); // tick 2 is the last tick it can be done; it ends without completion
    expect(b.board[0]!.state).toBe("expired");
    expect(b.last!.events).toContainEqual({ kind: "expired", errand: 0 });
    // Completed on its last tick: done, not expired.
    const s2 = build(HOUSE, { rooms: HOUSE_ROOMS, board: [{ type: "visit", room: "library", expires: 3 }], tick: 2 });
    s2.bodies.maria.pos = { x: 2, y: 2 };
    s2.bodies.you.pos = { x: 4, y: 2 };
    const d = tick(s2, M("E"), W);
    expect(d.board[0]!.state).toBe("done_by_you");
  });

  it("completion: the first body to satisfy it gets the value; the other cannot complete it later", () => {
    const s = build(HOUSE, { rooms: HOUSE_ROOMS, board: [{ type: "visit", room: "library" }] });
    s.bodies.maria.pos = { x: 2, y: 2 };
    let d = run(s, [
      [M("E"), M("E")],
      [M("E"), W],
      [M("E"), M("E")],
    ]);
    expect(d.board[0]!.state).toBe("done_by_you");
    d = run(d, [[W, M("E")]]);
    expect(d.board[0]!.state).toBe("done_by_you");
    expect(d.bodies.maria.score).toBe(0);
  });

  it("completion in the same tick by both: the one with less energy gets it; equal energy goes by seed", () => {
    const fx = [{ id: "f1", kind: "well" as const, pos: { x: 3, y: 3 } }];
    const items = [{ id: "i1", kind: "coin" as const, heldBy: "you" as const }, { id: "i2", kind: "coin" as const, heldBy: "maria" as const }];
    const mk = (seed: number, you: number, maria: number) => {
      const s = build(ROOM, { seed, items, fixtures: fx, board: [{ type: "deliver", item_kind: "coin", fixture: "f1" }], energy: { you, maria } });
      s.bodies.maria.pos = { x: 3, y: 3 };
      return tick(s, USE("i1"), USE("i2"));
    };
    expect(mk(1, 50, 49).board[0]!.state).toBe("done_by_maria");
    expect(mk(1, 48, 49).board[0]!.state).toBe("done_by_you");
    // Both items are used up either way.
    expect(mk(1, 50, 49).items.every((i) => i.loc.at === "delivered")).toBe(true);
    expect(mk(seedWithCoin(1, "you"), 40, 40).board[0]!.state).toBe("done_by_you");
    expect(mk(seedWithCoin(1, "maria"), 40, 40).board[0]!.state).toBe("done_by_maria");
  });

  it("items are the contention: a deliver consumes its item, so the other body cannot use it", () => {
    const s = build(ROOM, {
      items: [{ id: "i1", kind: "coin", heldBy: "you" }],
      fixtures: [{ id: "f1", kind: "well", pos: { x: 3, y: 3 } }, { id: "f2", kind: "clock", pos: { x: 1, y: 1 } }],
      board: [{ type: "deliver", item_kind: "coin", fixture: "f1" }, { type: "deliver", item_kind: "coin", fixture: "f2" }],
    });
    const d = tick(s, USE("i1"), W);
    expect(d.board.map((e) => e.state)).toEqual(["done_by_you", "open"]);
    expect(d.items[0]!.loc.at).toBe("delivered");
  });
});

/** An independent feasibility check of a freshly posted errand against the state it was drawn from. */
function checkFeasible(before: MatchState, e: Errand): string | null {
  const avail = before.items.filter((i) => i.kind !== "key" && itemAvailable(before, i));
  const reach = vaultReachable(before);
  const open = before.board.filter((x) => x.state === "open");
  if (e.type === "visit") {
    if (e.room === "hall") return "visit hall";
    if (e.room === "vault" && !reach) return "unreachable vault";
    if (!before.map.roomList.includes(e.room)) return "no such room";
    if (open.some((x) => x.type === "visit" && x.room === e.room)) return "duplicate visit";
    return inRange(e.value, RULES.visitValue) ? null : "visit value";
  }
  const ofKind = avail.filter((i) => i.kind === e.item_kind);
  if (ofKind.length === 0) return `no ${e.item_kind} in the world`;
  if (e.type === "carry") {
    if (open.some((x) => x.type === "carry" && x.item_kind === e.item_kind)) return "duplicate carry";
    return RULES.carryTicks.includes(e.carry_ticks) && inRange(e.value, RULES.carryValue) ? null : "carry value";
  }
  const f = before.fixtures.find((x) => x.id === e.fixture);
  if (!f || f.kind === "safe") return "bad fixture";
  if (f.room === "vault" && !reach) return "unreachable fixture";
  if (open.some((x) => x.type === "deliver" && x.item_kind === e.item_kind && x.fixture === e.fixture)) return "duplicate deliver";
  let best = Infinity;
  for (const i of ofKind) {
    const d = distanceField(before.map, itemPos(before, i)!, true)[f.pos.y * before.map.w + f.pos.x]!;
    if (d >= 0) best = Math.min(best, d);
  }
  if (best === Infinity) return "fixture unreachable from the item";
  return inRange(e.value, RULES.deliverValue) ? null : `deliver value ${e.value}`;
}

const inRange = (v: number, r: readonly [number, number]) => Number.isInteger(v) && v >= r[0] && v <= r[1];

describe("3.5 the board generator is feasible (1000 seeds, random play)", () => {
  it("every posted errand is completable with the items in the world at posting, and valued by the rules", () => {
    const dirs = ["N", "E", "S", "W"] as const;
    let posted = 0;
    let types = { deliver: 0, carry: 0, visit: 0 };
    const values = { deliver: new Set<number>(), carry: new Set<number>(), visit: new Set<number>() };
    for (let k = 0; k < 1000; k++) {
      const seed = (k * 2654435761 + 99) >>> 0;
      let s = createMatch(seed);
      // Tick-0 errands, checked one by one against the board before them.
      for (const e of s.board) {
        const before = { ...s, board: s.board.slice(0, e.id) };
        expect(checkFeasible(before, e), `seed ${seed} errand ${e.id}`).toBeNull();
      }
      const rng = createRng(seed);
      const r = new SeqRng(seed ^ 0xb0a4d);
      const pick = (b: "you" | "maria") => {
        const n = r.int(12);
        const inv = s.bodies[b].inventory;
        if (n < 7) return { kind: "MOVE" as const, dir: dirs[r.int(4)]! };
        if (n < 9) return { kind: "TAKE" as const };
        if (n === 9 && inv.length) return { kind: "USE" as const, item: inv[r.int(inv.length)]! };
        if (n === 10 && inv.length) return { kind: "DROP" as const, item: inv[r.int(inv.length)]! };
        return { kind: "SNATCH" as const };
      };
      while (!s.done) {
        const prev = s;
        s = step(s, { you: pick("you"), maria: pick("maria") }, rng);
        for (const ev of s.last!.events) {
          if (ev.kind !== "posted") continue;
          const e = s.board[ev.errand]!;
          // The state the generator saw: this tick fully resolved, before the new errand.
          const seen = { ...s, board: s.board.slice(0, e.id), tick: prev.tick + 1 };
          expect(checkFeasible(seen, e), `seed ${seed} errand ${e.id} at ${e.posted}`).toBeNull();
          posted++;
          types[e.type]++;
          values[e.type].add(e.value);
        }
      }
      // Completed errands add up to the scores.
      const sum = (who: string) => s.board.filter((e) => e.state === who).reduce((a, e) => a + e.value, 0);
      expect(sum("done_by_you")).toBe(s.bodies.you.score);
      expect(sum("done_by_maria")).toBe(s.bodies.maria.score);
    }
    expect(posted).toBeGreaterThan(30_000);
    expect(types.deliver).toBeGreaterThan(0);
    expect(types.carry).toBeGreaterThan(0);
    expect(types.visit).toBeGreaterThan(0);
    // Every value in each type's range turns up (SPEC 3.5, v6.2).
    expect([...values.deliver].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect([...values.carry].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
    expect([...values.visit].sort((a, b) => a - b)).toEqual([1, 2, 3]);
    void keyInWorld;
    void ITEM_KINDS;
    types = { deliver: 0, carry: 0, visit: 0 };
  });

  it("the key is never asked for, and the safe is never a delivery target", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const s = createMatch(seed);
      for (const e of s.board) {
        if (e.type !== "visit") expect(e.item_kind).not.toBe("key");
        if (e.type === "deliver") expect(s.fixtures.find((f) => f.id === e.fixture)!.kind).not.toBe("safe");
      }
    }
  });

  it("when nothing else is feasible, only visits are posted", () => {
    // No items at all: every draw falls through to visit.
    const s = build(HOUSE, { rooms: HOUSE_ROOMS, params: { postInterval: 2 }, tick: 1 });
    const d = tick(s, W, W);
    expect(d.board).toHaveLength(1);
    expect(d.board[0]!.type).toBe("visit");
    expect(d.board[0]).toMatchObject({ room: "library", posted: 2, state: "open" });
  });
});
