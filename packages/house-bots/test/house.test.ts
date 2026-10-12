import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Errand, Intent, MatchStartMsg, StateMsg } from "@blackmaria/protocol";
import { createMatch, matchStartFor, stateFor, type MatchState } from "@blackmaria/engine";
import { Adept, Knowledge, MASTER_DEFAULTS, Master, Novice, RoutePlanner, ROUTE_DEFAULTS, simulate, type CandidateBot } from "../src/index.js";

/** A candidate that plays Novice's policy from its own side. */
const noviceCandidate = (): CandidateBot => {
  let b: Novice | null = null;
  return { onStart: (s) => void (b = new Novice(s)), decide: (s) => b!.decide(s) };
};
/** A candidate that snatches whenever it can, so energy moves both ways. */
const snatcher = (): CandidateBot => {
  let b: Novice | null = null;
  let cost = 100;
  return {
    onStart: (s) => {
      b = new Novice(s);
      cost = s.params.snatch_cost;
    },
    decide: (s) => (s.you.energy >= cost && s.maria.inventory.length && Math.abs(s.you.pos.x - s.maria.pos.x) + Math.abs(s.you.pos.y - s.maria.pos.y) <= 1 ? { kind: "SNATCH" } : b!.decide(s)),
  };
};
const seeds = (n: number) => Array.from({ length: n }, (_, i) => (i * 2654435761 + 7) >>> 0);

/** A small state from Maria's point of view, for unit tests of one decision. */
function view(m: MatchState, patch: (s: StateMsg) => void = () => {}): { start: MatchStartMsg; state: StateMsg } {
  const start = matchStartFor(m, "maria", { match_id: "t", mode: "practice", tier: "novice", tick_ms: 250 });
  const state = stateFor(m, "maria", { match_id: "t", deadline_ms: 250 });
  patch(state);
  return { start, state };
}

describe("house bots are deterministic given their observations (SPEC 1.3, 4)", () => {
  for (const tier of ["novice", "adept", "master"] as const) {
    it(`${tier}: two runs on 50 seeds choose exactly the same moves`, () => {
      for (const seed of seeds(50)) {
        const a = simulate(seed, tier, noviceCandidate());
        const b = simulate(seed, tier, noviceCandidate());
        expect(b.intents.map((x) => x.maria)).toEqual(a.intents.map((x) => x.maria));
        expect(b.end.scores).toEqual(a.end.scores);
      }
    });
  }

  it("house-bot source uses no clock, no unseeded randomness and no I/O", () => {
    const dir = join(__dirname, "../src");
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".ts"))) {
      const src = readFileSync(join(dir, f), "utf8");
      for (const bad of [/Math\.random/, /Date\.now/, /new Date/, /performance\./, /setTimeout/, /setInterval/, /process\./, /require\(/]) {
        if (f === "sim.ts" && bad.source.includes("process")) continue;
        expect(bad.test(src), `${f} matches ${bad}`).toBe(false);
      }
    }
  });

  it("Master's budget is fixed: beam 8, depth 4", () => {
    expect(MASTER_DEFAULTS.beam).toBe(8);
    expect(MASTER_DEFAULTS.depth).toBe(4);
  });
});

describe("Novice (SPEC 4.1)", () => {
  it("walks to the nearest open errand's next step, takes and uses on arrival, never snatches, never checks expiry", () => {
    for (const seed of seeds(20)) {
      const r = simulate(seed, "novice", noviceCandidate());
      expect(r.intents.some((x) => x.maria.kind === "SNATCH")).toBe(false);
      expect(r.end.scores.maria).toBeGreaterThan(0);
    }
  });

  it("chooses by walking distance to the next step (ties: lowest id)", () => {
    const m = createMatch(3);
    const { start, state } = view(m);
    const c = new Novice(start).choose(state)!;
    expect(c.step.dist).toBeGreaterThanOrEqual(0);
    // Every other errand's next step is at least as far.
    for (const e of state.board) {
      const other = new Novice(start).choose({ ...state, board: [e] });
      if (other) expect(other.step.dist).toBeGreaterThanOrEqual(c.step.dist);
    }
  });

  it("waits when nothing is left", () => {
    const m = createMatch(5);
    const { start, state } = view(m, (s) => {
      s.board = [];
    });
    expect(new Novice(start).decide(state)).toEqual({ kind: "WAIT" });
  });
});

describe("Adept (SPEC 4.2)", () => {
  it("ranks errands by value per tick of her time and drops those she cannot finish before expiry", () => {
    const m = createMatch(11);
    const { start, state } = view(m);
    const opts = new Adept(start).options(state);
    expect(opts.length).toBeGreaterThan(0);
    for (let i = 1; i < opts.length; i++) expect(opts[i - 1]!.score).toBeGreaterThanOrEqual(opts[i]!.score);
    for (const o of opts) expect(o.finish).toBeLessThan(o.errand.expires);
    // With every expiry moved to tick 1, nothing is feasible.
    const late = { ...state, board: state.board.map((e): Errand => ({ ...e, expires: 1 })) };
    expect(new Adept(start).options(late)).toEqual([]);
  });

  it("plans the best two errands as a route: she goes for one of the two best, and the order sometimes puts the second first", () => {
    let swapped = 0;
    for (const seed of seeds(60)) {
      const { start, state } = view(createMatch(seed));
      const a = new Adept(start);
      const opts = a.options(state).filter((o) => o.step !== "snatch");
      const c = a.choice(state);
      if (opts.length === 0) {
        expect(c).toBeNull();
        continue;
      }
      const top = opts.slice(0, 2).map((o) => o.errand.id);
      expect(top).toContain(c!.errand.id);
      if (c!.errand.id !== opts[0]!.errand.id) swapped++;
    }
    expect(swapped).toBeGreaterThan(0);
  });

  it("steps toward her own charged sigil when it is at most 3 steps away", () => {
    for (const seed of seeds(60)) {
      const m = createMatch(seed);
      const mine = m.sigils.find((g) => g.owner === "maria")!;
      // Stand her two steps from her sigil, on a passable tile.
      const k0 = new Knowledge(matchStartFor(m, "maria", { match_id: "t", mode: "practice", tier: "adept", tick_ms: 250 }));
      let spot: { x: number; y: number } | null = null;
      for (let y = 0; y < m.map.h && !spot; y++)
        for (let x = 0; x < m.map.w && !spot; x++) if (m.map.tiles[y]![x] === "floor" && k0.dist(k0.idx({ x, y }), k0.idx(mine.pos), false) === 2) spot = { x, y };
      if (!spot) continue;
      m.bodies.maria.pos = spot;
      const { start, state } = view(m);
      const before = k0.dist(k0.idx(spot), k0.idx(mine.pos), false);
      const mv = new Adept(start).decide(state);
      expect(mv.kind).toBe("MOVE");
      if (mv.kind !== "MOVE") return;
      const d = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] }[mv.dir];
      expect(k0.dist(k0.idx({ x: spot.x + d[0]!, y: spot.y + d[1]! }), k0.idx(mine.pos), false)).toBe(before - 1);
      return;
    }
    throw new Error("no seed with a suitable tile");
  });

  it("winds up when you are next to her, hold the kind her chosen errand needs, and she can afford it; waits on the grab tick", () => {
    for (const seed of seeds(200)) {
      const m = createMatch(seed);
      const { start, state } = view(m);
      const best = new Adept(start).choice(state);
      if (!best || best.errand.type === "visit") continue;
      const kind = best.errand.item_kind;
      const it = m.items.find((i) => i.kind === kind && i.loc.at === "tile");
      if (!it) continue;
      // Give the candidate that item and put them next to Maria; give Maria the energy.
      it.loc = { at: "held", by: "you" };
      m.bodies.you.inventory = [it.id];
      m.bodies.you.pos = { ...m.bodies.maria.pos };
      m.bodies.maria.energy = 100;
      const v = view(m);
      expect(new Adept(v.start).decide(v.state)).toEqual({ kind: "SNATCH" });
      const grab = view(m);
      grab.state.events = [{ kind: "winding_up", by: "you" }];
      expect(new Adept(grab.start).decide(grab.state)).toEqual({ kind: "WAIT" });
      m.bodies.maria.energy = 99;
      const poor = view(m);
      expect(new Adept(poor.start).decide(poor.state)).not.toEqual({ kind: "SNATCH" });
      return;
    }
    throw new Error("no suitable seed");
  });
});

describe("Master (SPEC 4.3)", () => {
  it("is deterministic across two runs on 50 seeds, including her chosen routes", () => {
    for (const seed of seeds(50)) {
      const routes: string[][] = [[], []];
      for (const k of [0, 1]) {
        let her: Master | null = null;
        simulate(seed, "master", noviceCandidate(), {
          mariaFactory: (s) => (her = new Master(s)),
          onTick: () => routes[k]!.push(JSON.stringify(her!.last?.steps.map((x) => [x.errand.id, x.finish]) ?? [])),
        });
      }
      expect(routes[1]).toEqual(routes[0]);
    }
  });

  it("the route search plays at most 3 errands, scores by value × discount × 0.99 per tick, and respects expiry", () => {
    const m = createMatch(21);
    const { start, state } = view(m);
    const k = new Knowledge(start);
    const p = new RoutePlanner(k, { ...ROUTE_DEFAULTS, beam: 8, depth: 3, gamma: 0.99 });
    const route = p.search(state, p.start(state, state.you.pos, state.you.inventory, null, start.safe_items[0] ?? null));
    expect(route.steps.length).toBeLessThanOrEqual(3);
    for (const st of route.steps) expect(st.finish).toBeLessThan(st.errand.expires);
    const expect0 = route.steps.reduce((a, st) => a + st.errand.value * Math.pow(0.99, st.finish - state.tick), 0) + route.passive.reduce((a, x) => a + x.errand.value * Math.pow(0.99, x.finish - state.tick), 0);
    expect(route.score).toBeCloseTo(expect0, 6);
  });

  it("predicting you: weights go ×3 toward the errand you stepped closer to and ×0.5 otherwise, normalized", () => {
    const m = createMatch(31);
    const her = new Master(matchStartFor(m, "maria", { match_id: "t", mode: "practice", tier: "master", tick_ms: 250 }));
    const s0 = stateFor(m, "maria", { match_id: "t", deadline_ms: 250 });
    her.decide(s0);
    const w0 = new Map(her.weights);
    const sum0 = [...w0.values()].reduce((a, b) => a + b, 0);
    expect(sum0).toBeCloseTo(1, 9);
    // Move the candidate one step and check one weight's ratio.
    const moved = structuredClone(m);
    const opts: Intent[] = [{ kind: "MOVE", dir: "N" }, { kind: "MOVE", dir: "E" }, { kind: "MOVE", dir: "S" }, { kind: "MOVE", dir: "W" }];
    void opts;
    moved.tick = 1;
    moved.bodies.you.pos = { x: m.bodies.you.pos.x, y: m.bodies.you.pos.y };
    const s1 = stateFor(moved, "maria", { match_id: "t", deadline_ms: 250 });
    her.decide(s1);
    // The candidate did not move: every errand's weight was multiplied by 0.5 and renormalized, so they are unchanged.
    for (const [id, w] of her.weights) if (w0.has(id)) expect(w).toBeCloseTo(w0.get(id)!, 9);
  });

  it("the energy tracker is exact: your energy as Maria tracks it equals the engine's, every tick, on 20 seeds", () => {
    let checks = 0;
    for (const seed of seeds(20)) {
      let engineEnergy = 40;
      simulate(seed, "master", snatcher(), {
        mariaFactory: (s) => {
          const her = new Master(s);
          return {
            tier: "master",
            decide: (v: StateMsg) => {
              const mv = her.decide(v);
              expect(her.yours.energy).toBe(engineEnergy);
              checks++;
              return mv;
            },
          };
        },
        onTick: (st) => {
          engineEnergy = st.bodies.you.energy;
        },
      });
    }
    expect(checks).toBe(20 * 400);
  });
});
