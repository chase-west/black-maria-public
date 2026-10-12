import type { Dir, Errand, HeldItem, Intent, ItemKind, MatchStartMsg, Pos, StateMsg } from "@blackmaria/protocol";
import { Adept } from "./adept.js";
import { DIR_LIST, StreakTracker, holdsKey, holdsKind, manhattan, moveEnd, stepOutOfReach, woundUp } from "./knowledge.js";
import { freeSlot, nextStep, openErrands } from "./plan.js";
import { RoutePlanner, type Route, type RouteOpts } from "./route.js";

/** Master's fixed budget and weights (SPEC 4.3, RULES.md section 9). */
export interface MasterOpts {
  beam: number;
  depth: number;
  /** Lateness: each errand's value × gamma per tick until she would finish it. */
  gamma: number;
  /** Prediction: weight × `toward` when your step reduced your distance to the errand's next step, × `away` otherwise. */
  toward: number;
  away: number;
  /** Race chance: 1 / (1 + 2^((your finish − her finish) / raceScale)). */
  raceScale: number;
  /** Snatch policy: the item's best errand must be worth at least this, finished within `lookahead` ticks. */
  snatchMinValue: number;
  lookahead: number;
  /** Plan snatches of items you hold inside the route search. */
  huntInSearch: boolean;
  /** Chase you for a snatch the policy would allow when you are within this many steps (0: never chase). */
  chase: number;
  /** Route score per item she holds at the end of a sequence (items are worth holding). */
  holdValue: number;
  /** Racing: an errand you are going for also counts × (1 + deny × (its weight ÷ the largest weight) × the chance she wins the race). */
  deny: number;
  /** With nothing worth doing, step toward your expected tile instead of waiting. */
  shadow: boolean;
}

export const MASTER_DEFAULTS: MasterOpts = { beam: 8, depth: 4, gamma: 0.99, toward: 3, away: 0.5, raceScale: 1, snatchMinValue: 3, lookahead: 6, huntInSearch: true, chase: 6, holdValue: 2, deny: 1, shadow: true };

/**
 * Master (SPEC 4.3, RULES.md section 9): a fixed-budget beam search over sequences of up to 4 errands, discounted by a
 * prediction of which errands you are going for and whether you would get there first, and a snatch policy with a
 * 6-tick lookahead. Deterministic given her observations.
 */
export class Master extends Adept {
  override readonly tier = "master" as const;
  readonly opts: MasterOpts;
  readonly route: RoutePlanner;
  /** Your planner model (to estimate your finishing times). */
  readonly yourPlanner: RoutePlanner;
  readonly yourStreak = new StreakTracker();
  /** Prediction weight per open errand: "you are going for this". */
  readonly weights = new Map<number, number>();
  private prevYou: { pos: { x: number; y: number }; inv: HeldItem[]; tick: number } | null = null;
  /** Whether you have wound up a snatch in this match: until you do, she assumes you will not snatch back. */
  youSnatch = false;
  /** The route chosen on the last tick (for tests and the reviewer). */
  last: Route | null = null;

  constructor(start: MatchStartMsg, opts: Partial<MasterOpts> = {}) {
    super(start);
    this.opts = { ...MASTER_DEFAULTS, ...opts };
    const ro: RouteOpts = { beam: this.opts.beam, depth: this.opts.depth, gamma: this.opts.gamma, holdValue: this.opts.holdValue };
    this.route = new RoutePlanner(this.k, ro);
    this.yourPlanner = new RoutePlanner(this.k, { ...ro, depth: 1 });
  }

  /** Walking distance from a body to an errand's next step (Infinity when it has none). */
  private nextDist(s: StateMsg, pos: { x: number; y: number }, inv: readonly HeldItem[], e: Errand): number {
    const st = nextStep(this.k, s, pos, inv, e);
    return st ? st.dist : Infinity;
  }

  /** Fold your last step into the prediction weights (SPEC 4.3, "Predicting you"). */
  private predict(s: StateMsg): void {
    const open = openErrands(s);
    const ids = new Set(open.map((e) => e.id));
    for (const id of [...this.weights.keys()]) if (!ids.has(id)) this.weights.delete(id);
    const known = open.filter((e) => this.weights.has(e.id));
    const avg = known.length ? known.reduce((a, e) => a + this.weights.get(e.id)!, 0) / known.length : 1;
    const prev = this.prevYou;
    for (const e of open) {
      if (!this.weights.has(e.id)) {
        this.weights.set(e.id, avg);
        continue;
      }
      if (!prev) continue;
      let closer: boolean;
      if (e.type === "carry" && holdsKind(s.maria.inventory, e.item_kind)) closer = true;
      else {
        const before = this.nextDist(s, prev.pos, prev.inv, e);
        const now = this.nextDist(s, s.maria.pos, s.maria.inventory, e);
        closer = now < before;
      }
      this.weights.set(e.id, this.weights.get(e.id)! * (closer ? this.opts.toward : this.opts.away));
    }
    const sum = open.reduce((a, e) => a + (this.weights.get(e.id) ?? 0), 0);
    if (sum > 0) for (const e of open) this.weights.set(e.id, this.weights.get(e.id)! / sum);
    this.prevYou = { pos: { ...s.maria.pos }, inv: s.maria.inventory.slice(), tick: s.tick };
  }

  /** Your finishing tick for each open errand, from where you stand (Infinity when you cannot do it). */
  private yourFinish(s: StateMsg): Map<number, number> {
    const root = this.yourPlanner.start(s, s.maria.pos, s.maria.inventory, this.yourStreak, this.safeItem);
    const out = new Map<number, number>();
    for (const e of openErrands(s)) {
      if (e.type === "carry" && holdsKind(s.maria.inventory, e.item_kind)) {
        // You complete it by holding: count from your run.
        out.set(e.id, Math.max(s.tick - this.yourStreak.count(e.item_kind), e.posted) + e.carry_ticks - 1);
        continue;
      }
      const r = this.yourPlanner.apply(root, e);
      out.set(e.id, r ? r.step.finish : Infinity);
    }
    return out;
  }

  /**
   * Where she expects you to stand after this tick: one step toward the next step of the errand she thinks you are
   * most likely going for (highest weight, ties lowest id), or where you are if you are on it or have none.
   */
  expectedNext(s: StateMsg): { x: number; y: number } {
    let best: Errand | null = null;
    let bw = -1;
    for (const e of openErrands(s)) {
      const w = this.weights.get(e.id) ?? 0;
      if (w > bw) {
        bw = w;
        best = e;
      }
    }
    if (!best) return { ...s.maria.pos };
    const st = nextStep(this.k, s, s.maria.pos, s.maria.inventory, best);
    if (!st) return { ...s.maria.pos };
    const from = this.k.idx(s.maria.pos);
    const key = holdsKey(s.maria.inventory);
    const dir = st.tile < 0 ? (st.room ? this.k.stepTowardRoom(from, st.room, key) : null) : this.k.stepToward(from, st.tile, key);
    if (!dir) return { ...s.maria.pos };
    const d = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] }[dir];
    const to = { x: s.maria.pos.x + d[0]!, y: s.maria.pos.y + d[1]! };
    const t = this.k.tiles[this.k.idx(to)];
    return t === "door_locked" && !this.k.doorOpen ? { ...s.maria.pos } : to;
  }

  /**
   * Shadowing (v6.4): with no sequence worth more than standing still, she steps toward your expected tile, or WAITs
   * when she is already on it or next to it (or cannot reach it). Next to a body that never steps away, her snatch
   * policy then gets its chances.
   */
  shadowStep(s: StateMsg): Intent {
    const there = this.expectedNext(s);
    if (manhattan(s.you.pos, there) <= 1) return { kind: "WAIT" };
    const dir = this.k.stepToward(this.k.idx(s.you.pos), this.k.idx(there), holdsKey(s.you.inventory));
    return dir ? { kind: "MOVE", dir } : { kind: "WAIT" };
  }

  /** The route she pursues this tick. */
  plan(s: StateMsg): Route {
    const yours = this.yourFinish(s);
    let maxW = 0;
    for (const w of this.weights.values()) maxW = Math.max(maxW, w);
    const discount = (e: Errand, finish: number) => {
      const w = this.weights.get(e.id) ?? 0;
      const yf = yours.get(e.id) ?? Infinity;
      if (maxW <= 0 || yf === Infinity) return 1;
      const pYou = 1 / (1 + Math.pow(2, (yf - finish) / this.opts.raceScale));
      return 1 - (w / maxW) * pYou + this.opts.deny * (w / maxW) * (1 - pYou);
    };
    const snatch = this.opts.huntInSearch ? { energy: s.you.energy, rivalPos: s.maria.pos, rivalInv: s.maria.inventory } : null;
    const root = this.route.start(s, s.you.pos, s.you.inventory, this.streak, this.safeItem, new Set(), snatch);
    return this.route.search(s, root, discount);
  }

  /**
   * Ticks after a snatch at tick `at` until you could snatch the item back, looking at most `lookahead` ticks ahead:
   * Infinity if you have never snatched in this match, or if your energy cannot reach `snatch_cost` within the
   * lookahead.
   */
  retake(s: StateMsg, at: number): number {
    const P = this.k.params;
    if (!this.youSnatch) return Infinity;
    for (let d = 1; d <= this.opts.lookahead; d++) {
      const e = Math.min(100, this.yours.energy + P.regen * (at - s.tick + d));
      if (e >= P.snatch_cost) return d;
    }
    return Infinity;
  }

  /** The snatch policy, for an errand she would finish at `finish` with an item snatched at tick `at`. */
  snatchAllowed(s: StateMsg, e: Errand, at: number, finish: number): boolean {
    return e.value >= this.opts.snatchMinValue && finish < e.expires && finish - at < this.retake(s, at);
  }

  /**
   * The snatch policy (SPEC 4.3): you are in reach now and her prediction of your next tile keeps you in reach,
   * enough energy and a free slot; for every item you hold, the best open errand it could complete for her; wind up
   * if one is worth at least 3 and she could finish it before you could snatch it back (looking 6 ticks ahead; until
   * you have wound up once, she assumes you never will). The grab is the tick after the wind-up.
   */
  shouldSnatch(s: StateMsg, reach = 1): boolean {
    const P = this.k.params;
    if ((reach <= 1 && manhattan(s.you.pos, s.maria.pos) > 1) || manhattan(s.you.pos, this.expectedNext(s)) > reach || s.you.energy < P.snatch_cost || s.you.inventory.length >= P.inventory_slots || s.maria.inventory.length === 0) return false;
    const at = this.k.idx(s.maria.pos);
    const key = holdsKey(s.you.inventory);
    for (const kind of new Set<ItemKind>(s.maria.inventory.map((i) => i.kind))) {
      for (const e of openErrands(s)) {
        if (e.type === "visit" || e.item_kind !== kind || e.value < this.opts.snatchMinValue) continue;
        let finishIn: number;
        if (e.type === "deliver") {
          const f = this.k.fixtureIdx.get(e.fixture);
          if (f === undefined) continue;
          finishIn = 2 + this.k.dist(at, f, key);
        } else finishIn = Math.max(s.tick + 2, e.posted) + e.carry_ticks - 1 - s.tick;
        if (this.snatchAllowed(s, e, s.tick + 1, s.tick + finishIn)) return true;
      }
    }
    return false;
  }

  override absorb(s: StateMsg): void {
    this.observe(s);
    if (woundUp(s, "maria")) this.youSnatch = true;
    this.yourStreak.observe(s.tick, s.maria.inventory);
    this.predict(s);
  }

  /** The tile a move from her position leads to, or null into a wall or a door she cannot open. */
  private moveTo(s: StateMsg, dir: Dir): Pos | null {
    return moveEnd(this.k, s.you.pos, dir);
  }

  /**
   * Her grab tick (SPEC 4.3): she keeps you in reach of where she predicts you will be. Her planned step if it does,
   * else WAIT if that does, else the first of N, E, S, W that does; else her planned step.
   */
  private grabMove(s: StateMsg, planned: Intent): Intent {
    const there = this.expectedNext(s);
    const keeps = (p: Pos | null) => p !== null && manhattan(p, there) <= 1;
    if (planned.kind === "MOVE" && keeps(this.moveTo(s, planned.dir))) return planned;
    if (keeps(s.you.pos)) return { kind: "WAIT" };
    for (const d of DIR_LIST) if (keeps(this.moveTo(s, d))) return { kind: "MOVE", dir: d };
    return planned;
  }

  /**
   * Her defense (SPEC 4.3): when you wound up last tick, she steps out of reach of where you stand. Her planned step
   * if it ends out of reach; else the first of N, E, S, W that does, nearest by walking to her plan's next waypoint;
   * else her planned move.
   */
  private dodge(s: StateMsg, planned: Intent, target: number): Intent {
    return stepOutOfReach(this.k, s.you.pos, s.maria.pos, planned, target, holdsKey(s.you.inventory)) ?? planned;
  }

  override decide(s: StateMsg): Intent {
    this.absorb(s);
    this.route.snatchGate = (e, at, finish) => this.snatchAllowed(s, e, at, finish);
    const planned = this.choose(s);
    if (woundUp(s, "you")) return this.grabMove(s, planned.intent);
    if (woundUp(s, "maria") && s.you.inventory.length > 0) return this.dodge(s, planned.intent, planned.target);
    return planned.intent;
  }

  /** What she would do this tick with no wind-up on either side, and the tile her plan heads for (-1 if none). */
  private choose(s: StateMsg): { intent: Intent; target: number } {
    const intent = this.chooseIntent(s);
    const first = this.last?.steps[0];
    return { intent, target: first ? first.tile : -1 };
  }

  private chooseIntent(s: StateMsg): Intent {
    this.last = null;
    if (this.shouldSnatch(s)) return { kind: "SNATCH" };
    const sig = this.sigilStep(s);
    if (sig) return sig;
    if (this.opts.chase > 0) {
      const at0 = this.k.idx(s.you.pos);
      const there = this.k.idx(this.expectedNext(s));
      const d = this.k.dist(at0, there, holdsKey(s.you.inventory));
      if (d <= this.opts.chase && this.shouldSnatch(s, Infinity)) {
        const dir = this.k.stepToward(at0, there, holdsKey(s.you.inventory));
        if (dir) return { kind: "MOVE", dir };
      }
    }
    const route = this.plan(s);
    this.last = route;
    const first = route.steps[0];
    const at = this.k.idx(s.you.pos);
    if (!first) return this.opts.shadow ? this.shadowStep(s) : { kind: "WAIT" };
    if (first.act.kind === "SNATCH") {
      if (manhattan(s.you.pos, s.maria.pos) <= 1) return s.you.energy >= this.k.params.snatch_cost ? { kind: "SNATCH" } : { kind: "WAIT" };
      const dir = this.k.stepToward(at, this.k.idx(s.maria.pos), holdsKey(s.you.inventory));
      return dir ? { kind: "MOVE", dir } : { kind: "WAIT" };
    }
    return freeSlot(this.k, s, first.tile, first.act, this.route.moveFor(at, holdsKey(s.you.inventory), first));
  }
}
