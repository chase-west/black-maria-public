import type { Errand, Intent, ItemKind, MatchStartMsg, StateMsg } from "@blackmaria/protocol";
import { EnergyTracker, Knowledge, StreakTracker, holdsKey, holdsKind, manhattan, woundUp } from "./knowledge.js";
import { freeSlot, openErrands } from "./plan.js";
import { ROUTE_DEFAULTS, RoutePlanner, type RouteStep, type Sim } from "./route.js";
import type { HouseBot } from "./types.js";

/** Adept's sigil detour: her sigil is charged and at most this many steps away (SPEC 4.2). */
export const SIGIL_DETOUR = 3;

/** One way to do an errand from here, as Adept sees it. */
export interface Option {
  errand: Errand;
  /** Ticks of her own time: until she is free again (for a carry, until the pickup). */
  effort: number;
  /** The tick at whose end it completes. */
  finish: number;
  /** Expected value: the value, or for a snatch the value × the chance the snatch takes the right item. */
  expected: number;
  /** The first waypoint, or `snatch` when the item is in your inventory. */
  step: Pick<RouteStep, "tile" | "room" | "act"> | "snatch";
  score: number;
}

/**
 * Adept (SPEC 4.2, RULES.md section 9): ranks open errands by value per tick of her time from here, drops any she
 * cannot finish before expiry, plans the best two as a route and follows its first step, re-plans every tick. She fetches the key when the vault door or the
 * safe is in the way. An item you hold counts as gettable by a snatch when she can afford one. She detours to her
 * charged sigil when it is at most 3 steps away, and snatches when you are next to her holding the kind her errand
 * needs.
 */
export class Adept implements HouseBot {
  readonly tier: "adept" | "master" = "adept";
  readonly k: Knowledge;
  readonly streak = new StreakTracker();
  readonly planner: RoutePlanner;
  /** Your energy, tracked from the events (she cannot see it). */
  readonly yours: EnergyTracker;
  readonly safeItem: { id: string; kind: ItemKind; fixture: string } | null;

  constructor(start: MatchStartMsg) {
    this.k = new Knowledge(start);
    this.planner = new RoutePlanner(this.k, { ...ROUTE_DEFAULTS, depth: 1 });
    this.yours = new EnergyTracker(start.params);
    this.safeItem = start.safe_items[0] ?? null;
  }

  absorb(s: StateMsg): void {
    this.observe(s);
  }

  protected observe(s: StateMsg): void {
    this.k.update(s);
    this.streak.observe(s.tick, s.you.inventory);
    this.yours.observe(s);
  }

  /** Her body in the planner's model. */
  protected sim(s: StateMsg): Sim {
    return this.planner.start(s, s.you.pos, s.you.inventory, this.streak, this.safeItem);
  }

  /** Taking an item of `kind` from you: possible, and if so the ticks to reach you and the chance of the right item. */
  protected snatchReach(s: StateMsg, kind: ItemKind): { ticks: number; chance: number } | null {
    const P = this.k.params;
    if (s.you.inventory.length >= P.inventory_slots) return null;
    const theirs = s.maria.inventory;
    const n = theirs.filter((i) => i.kind === kind).length;
    if (n === 0) return null;
    const d = this.k.dist(this.k.idx(s.you.pos), this.k.idx(s.maria.pos), holdsKey(s.you.inventory));
    if (d === Infinity) return null;
    // Walk next to you; if she is short of energy, the snatch waits until she has it.
    const short = Math.max(0, P.snatch_cost - s.you.energy);
    const wait = short === 0 ? 0 : P.regen > 0 ? Math.ceil(short / P.regen) : Infinity;
    if (wait === Infinity) return null;
    // Then the wind-up tick and the grab tick: the item is in hand after the grab.
    return { ticks: Math.max(Math.max(0, d - 1), wait) + 2, chance: n / theirs.length };
  }

  /** Every errand she can finish before it expires, best expected value per tick of her time first (ties: lowest id). */
  options(s: StateMsg): Option[] {
    const out: Option[] = [];
    const root = this.sim(s);
    const at = this.k.idx(s.you.pos);
    for (const e of openErrands(s)) {
      // A carry whose item she already holds completes by itself: she works on the others while holding it.
      if (e.type === "carry" && holdsKind(s.you.inventory, e.item_kind)) continue;
      const r = this.planner.apply(root, e);
      if (r) {
        const effort = Math.max(1, r.step.free - s.tick);
        out.push({ errand: e, effort, finish: r.step.finish, expected: e.value, step: r.step, score: e.value / effort });
      }
      if (e.type === "visit" || holdsKind(s.you.inventory, e.item_kind)) continue;
      const sn = this.snatchReach(s, e.item_kind);
      if (!sn) continue;
      const theirPos = this.k.idx(s.maria.pos);
      let finish: number;
      let effort: number;
      if (e.type === "deliver") {
        const f = this.k.fixtureIdx.get(e.fixture);
        if (f === undefined) continue;
        const walk = this.k.dist(theirPos, f, holdsKey(s.you.inventory));
        if (walk === Infinity) continue;
        finish = s.tick + sn.ticks + walk;
        effort = finish + 1 - s.tick;
      } else {
        finish = Math.max(s.tick + sn.ticks - 1, e.posted) + e.carry_ticks - 1;
        effort = sn.ticks;
      }
      if (finish >= e.expires) continue;
      void at;
      out.push({ errand: e, effort, finish, expected: e.value * sn.chance, step: "snatch", score: (e.value * sn.chance) / effort });
    }
    out.sort((a, b) => b.score - a.score || a.errand.id - b.errand.id || (a.step === "snatch" ? 1 : 0) - (b.step === "snatch" ? 1 : 0));
    return out;
  }

  /**
   * The errand she goes for this tick (SPEC 4.2, v6.2): of her ranked options, the two best she can do herself are
   * planned as a route in both orders, and she follows the first errand of the order with more value per tick of
   * her time over both (ties: the better-ranked errand first). With one doable errand, or when neither order can
   * finish both before they expire, she goes for the best-ranked option. A snatch ranked first is followed as is.
   */
  choice(s: StateMsg, opts: Option[] = this.options(s)): Option | null {
    const best = opts[0];
    if (!best || best.step === "snatch") return best ?? null;
    const own = opts.filter((o) => o.step !== "snatch");
    const a = own[0]!;
    const b = own.find((o) => o.errand.id !== a.errand.id);
    if (!b) return a;
    const root = this.sim(s);
    const rate = (x: Option, y: Option): number => {
      const r1 = this.planner.apply(root, x.errand);
      if (!r1) return -1;
      const r2 = this.planner.apply(r1.next, y.errand);
      if (!r2) return -1;
      return (x.errand.value + y.errand.value) / Math.max(1, r2.step.free - s.tick);
    };
    const ab = rate(a, b);
    const ba = rate(b, a);
    if (ab < 0 && ba < 0) return a;
    return ba > ab ? b : a;
  }

  /** Step toward her own sigil if it is charged and close. */
  sigilStep(s: StateMsg): Intent | null {
    const at = this.k.idx(s.you.pos);
    const key = holdsKey(s.you.inventory);
    let best: { d: number; idx: number } | null = null;
    this.k.sigils.forEach((g, i) => {
      if (!g.mine || (s.sigil_charge[i] ?? 1) !== 0) return;
      const d = this.k.dist(at, g.idx, key);
      if (d >= 1 && d <= SIGIL_DETOUR && (!best || d < best.d)) best = { d, idx: g.idx };
    });
    if (!best) return null;
    const dir = this.k.stepToward(at, (best as { idx: number }).idx, key);
    return dir ? { kind: "MOVE", dir } : null;
  }

  /** The move that carries out an option. */
  protected act(s: StateMsg, o: Option): Intent {
    const at = this.k.idx(s.you.pos);
    const key = holdsKey(s.you.inventory);
    if (o.step === "snatch") {
      if (manhattan(s.you.pos, s.maria.pos) <= 1) return s.you.energy >= this.k.params.snatch_cost ? { kind: "SNATCH" } : { kind: "WAIT" };
      const dir = this.k.stepToward(at, this.k.idx(s.maria.pos), key);
      return dir ? { kind: "MOVE", dir } : { kind: "WAIT" };
    }
    return freeSlot(this.k, s, o.step.tile, o.step.act, this.planner.moveFor(at, key, o.step));
  }

  decide(s: StateMsg): Intent {
    this.observe(s);
    // The tick after her wind-up she stands still for the grab; she does not follow you (SPEC 4.2).
    if (woundUp(s, "you")) return { kind: "WAIT" };
    const sig = this.sigilStep(s);
    if (sig) return sig;
    const best = this.choice(s);
    if (!best) return { kind: "WAIT" };
    const e = best.errand;
    if (e.type !== "visit" && manhattan(s.you.pos, s.maria.pos) <= 1 && s.you.energy >= this.k.params.snatch_cost && this.snatchReach(s, e.item_kind)) return { kind: "SNATCH" };
    return this.act(s, best);
  }
}
