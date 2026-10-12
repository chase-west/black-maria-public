/**
 * The browser editor's starter bot: the same logic as the starter bot that ships with the client (and the
 * calibration's "shipped bot"), in plain JavaScript. A test checks the two decide the same way.
 */
export const STARTER_JS = `// Your bot. It plays in this browser tab, over the WebSocket, against Maria.
// decide(state) runs once a tick and returns a move:
//   { kind: "WAIT" } | { kind: "MOVE", dir: "N" | "E" | "S" | "W" } | { kind: "TAKE" }
//   { kind: "DROP", item } | { kind: "USE", item } | { kind: "SNATCH" }
// This one walks to the nearest open errand and does it. Once it picks a target it doesn't look again. It remembers
// where it saw each item, so if Maria picks one up it walks to the empty spot anyway. It never checks expiry, never
// snatches, and assumes 4 inventory slots. "What strong bots do" in the rules lists what to fix.

const INVENTORY_SLOTS = 4;
const DIRS = [["N", 0, -1], ["E", 1, 0], ["S", 0, 1], ["W", -1, 0]];

function itemOf(act) {
  return act && "item" in act ? act.item : null;
}
function sameGoal(a, b) {
  return a.pos.x === b.pos.x && a.pos.y === b.pos.y && (a.act ? a.act.kind : null) === (b.act ? b.act.kind : null) && itemOf(a.act) === itemOf(b.act);
}

class Bot {
  onStart(start) {
    this.start = start;
    this.seen = new Map(); // every item we've seen on the floor, and where
    this.goal = null; // where we're walking
  }

  decide(s) {
    const m = this.start;
    this.remember(s);
    const { w, h, tiles } = m.map;
    // Breadth-first distances from where we stand. The locked door counts as a wall.
    const dist = tiles.map((row) => row.map(() => -1));
    const first = tiles.map((row) => row.map(() => null));
    const queue = [s.you.pos];
    dist[s.you.pos.y][s.you.pos.x] = 0;
    for (let i = 0; i < queue.length; i++) {
      const p = queue[i];
      for (const [dir, dx, dy] of DIRS) {
        const x = p.x + dx, y = p.y + dy;
        if (x < 0 || y < 0 || x >= w || y >= h || dist[y][x] >= 0) continue;
        if (tiles[y][x] === "wall" || tiles[y][x] === "door_locked") continue;
        dist[y][x] = dist[p.y][p.x] + 1;
        first[y][x] = i === 0 ? { kind: "MOVE", dir } : first[p.y][p.x];
        queue.push({ x, y });
      }
    }
    const goals = [];
    for (const e of s.board) if (e.state === "open") goals.push(...this.goalsFor(s, e));
    let best = null, bestDist = Infinity;
    // Stick with the last target while it's still a goal. Otherwise pick the nearest.
    const kept = this.goal;
    if (kept && dist[kept.pos.y][kept.pos.x] >= 0 && goals.some((g) => sameGoal(g, kept))) {
      best = kept;
      bestDist = dist[kept.pos.y][kept.pos.x];
    } else {
      for (const g of goals) {
        const d = dist[g.pos.y][g.pos.x];
        if (d >= 0 && d < bestDist) { best = g; bestDist = d; }
      }
    }
    this.goal = best && bestDist > 0 ? best : null;
    if (!best) return { kind: "WAIT" };
    if (bestDist === 0) return best.act || { kind: "WAIT" };
    return first[best.pos.y][best.pos.x];
  }

  // Note every item on the floor. Forget the ones we hold and the ones that should be on our tile but aren't.
  // An item Maria picked up stays where we last saw it.
  remember(s) {
    for (const it of s.items) this.seen.set(it.id, { kind: it.kind, pos: it.pos });
    for (const it of s.you.inventory) this.seen.delete(it.id);
    const here = new Set(s.items.filter((i) => i.pos.x === s.you.pos.x && i.pos.y === s.you.pos.y).map((i) => i.id));
    for (const [id, it] of this.seen) if (it.pos.x === s.you.pos.x && it.pos.y === s.you.pos.y && !here.has(id)) this.seen.delete(id);
  }

  // Where to go for an errand: the fixture if we hold the item, otherwise a remembered item, or any tile of a visit's room.
  goalsFor(s, e) {
    const m = this.start;
    if (e.type === "visit") {
      const out = [];
      m.map.rooms.forEach((row, y) => row.forEach((r, x) => { if (r === e.room) out.push({ pos: { x, y }, act: null }); }));
      return out;
    }
    const mine = s.you.inventory.find((i) => i.kind === e.item_kind);
    if (mine) {
      if (e.type === "carry") return [];
      const f = m.fixtures.find((x) => x.id === e.fixture);
      return f ? [{ pos: f.pos, act: { kind: "USE", item: mine.id } }] : [];
    }
    if (s.you.inventory.length >= INVENTORY_SLOTS) return [];
    const out = [];
    for (const it of this.seen.values()) if (it.kind === e.item_kind) out.push({ pos: it.pos, act: { kind: "TAKE" } });
    return out;
  }
}
`;
