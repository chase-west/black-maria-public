/**
 * The starter bot that ships with the client. It plays, badly, on purpose:
 *
 * - it walks to the nearest open errand's next step and does it,
 * - once it has picked a target it walks there without looking again, so a nearer or better errand posted on the way
 *   waits until it arrives,
 * - it remembers where it saw each item and does not notice when Maria picks one up: it walks to the empty spot and
 *   only forgets the item when it gets there,
 * - it never checks whether it can finish before the errand expires,
 * - it never snatches, never steps away from Maria's wind-up, and never thinks about Maria,
 * - it hard-codes the parameters (4 inventory slots) instead of reading them from the match start,
 * - it never uses the key on purpose.
 *
 * Everything you need to do better is in docs/RULES.md under "What strong bots do".
 */
import type { Errand, Intent, ItemKind, MatchStartMsg, Pos, StateMsg } from "@blackmaria/protocol";

const INVENTORY_SLOTS = 4;
const DIRS = [
  { dir: "N", dx: 0, dy: -1 },
  { dir: "E", dx: 1, dy: 0 },
  { dir: "S", dx: 0, dy: 1 },
  { dir: "W", dx: -1, dy: 0 },
] as const;

interface Goal {
  pos: Pos;
  /** What to send on arrival; null for "just be there" (a visit). */
  act: Intent | null;
}

const sameGoal = (a: Goal, b: Goal): boolean =>
  a.pos.x === b.pos.x && a.pos.y === b.pos.y && (a.act?.kind ?? null) === (b.act?.kind ?? null) && (a.act && "item" in a.act ? a.act.item : null) === (b.act && "item" in b.act ? b.act.item : null);

export class StarterBot {
  private start: MatchStartMsg | null = null;
  /** Every item it has seen on the floor, where it last saw it. */
  private seen = new Map<string, { kind: ItemKind; pos: Pos }>();
  /** The target it is walking to, kept until it arrives or the target is gone. */
  private goal: Goal | null = null;

  onStart(start: MatchStartMsg): void {
    this.start = start;
  }

  decide(s: StateMsg): Intent {
    const m = this.start;
    if (!m) return { kind: "WAIT" };
    this.remember(s);
    // Breadth-first distances from where we stand. The locked door is treated as a wall.
    const { w, h, tiles } = m.map;
    const dist: number[][] = tiles.map((row) => row.map(() => -1));
    const first: (Intent | null)[][] = tiles.map((row) => row.map(() => null));
    const queue: Pos[] = [s.you.pos];
    dist[s.you.pos.y]![s.you.pos.x] = 0;
    for (let i = 0; i < queue.length; i++) {
      const p = queue[i]!;
      for (const d of DIRS) {
        const x = p.x + d.dx;
        const y = p.y + d.dy;
        if (x < 0 || y < 0 || x >= w || y >= h || dist[y]![x]! >= 0) continue;
        if (tiles[y]![x] === "wall" || tiles[y]![x] === "door_locked") continue;
        dist[y]![x] = dist[p.y]![p.x]! + 1;
        first[y]![x] = i === 0 ? { kind: "MOVE", dir: d.dir } : first[p.y]![p.x]!;
        queue.push({ x, y });
      }
    }
    const goals: Goal[] = [];
    for (const e of s.board) if (e.state === "open") goals.push(...this.goalsFor(s, e));
    let best: Goal | null = null;
    let bestDist = Infinity;
    // Keep walking to the last target while it is still a goal; otherwise pick the nearest.
    const kept = this.goal;
    if (kept && dist[kept.pos.y]![kept.pos.x]! >= 0 && goals.some((g) => sameGoal(g, kept))) {
      best = kept;
      bestDist = dist[kept.pos.y]![kept.pos.x]!;
    } else {
      for (const g of goals) {
        const d = dist[g.pos.y]![g.pos.x]!;
        if (d >= 0 && d < bestDist) {
          best = g;
          bestDist = d;
        }
      }
    }
    this.goal = best && bestDist > 0 ? best : null;
    if (!best) return { kind: "WAIT" };
    if (bestDist === 0) return best.act ?? { kind: "WAIT" };
    return first[best.pos.y]![best.pos.x]!;
  }

  /**
   * Update the remembered items: note every item on the floor, forget the ones we hold and the ones that should be
   * on our tile but are not. An item Maria picked up stays where we last saw it.
   */
  private remember(s: StateMsg): void {
    for (const it of s.items) this.seen.set(it.id, { kind: it.kind, pos: it.pos });
    for (const it of s.you.inventory) this.seen.delete(it.id);
    const here = new Set(s.items.filter((i) => i.pos.x === s.you.pos.x && i.pos.y === s.you.pos.y).map((i) => i.id));
    for (const [id, it] of this.seen) if (it.pos.x === s.you.pos.x && it.pos.y === s.you.pos.y && !here.has(id)) this.seen.delete(id);
  }

  /** Where to go next for an errand: the fixture if we hold the item, otherwise a remembered item; any tile of a visit's room. */
  private goalsFor(s: StateMsg, e: Errand): Goal[] {
    const m = this.start!;
    if (e.type === "visit") {
      const out: Goal[] = [];
      m.map.rooms.forEach((row, y) => row.forEach((r, x) => r === e.room && out.push({ pos: { x, y }, act: null })));
      return out;
    }
    const mine = s.you.inventory.find((i) => i.kind === e.item_kind);
    if (mine) {
      if (e.type === "carry") return [];
      const f = m.fixtures.find((x) => x.id === e.fixture);
      return f ? [{ pos: f.pos, act: { kind: "USE", item: mine.id } }] : [];
    }
    if (s.you.inventory.length >= INVENTORY_SLOTS) return [];
    const out: Goal[] = [];
    for (const it of this.seen.values()) if (it.kind === e.item_kind) out.push({ pos: it.pos, act: { kind: "TAKE" } });
    return out;
  }
}
