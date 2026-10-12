import type { Dir, FixtureView, HeldItem, Intent, ItemKind, MatchParams, MatchStartMsg, Pos, RoomName, RoomOrCorridor, StateMsg, TileKind } from "@blackmaria/protocol";

export const DIR_LIST: readonly Dir[] = ["N", "E", "S", "W"];
export const DIR_DELTA: Record<Dir, { x: number; y: number }> = { N: { x: 0, y: -1 }, E: { x: 1, y: 0 }, S: { x: 0, y: 1 }, W: { x: -1, y: 0 } };
const DX = [0, 1, 0, -1];
const DY = [-1, 0, 1, 0];

/**
 * What a house bot knows about the map, from its match start: tiles, rooms, fixtures, sigils and the parameters,
 * plus exact walking distances. Distances are breadth-first and cached per source tile, once with the locked door
 * closed and once with it open.
 */
export class Knowledge {
  readonly w: number;
  readonly h: number;
  readonly n: number;
  readonly tiles: TileKind[];
  readonly rooms: RoomOrCorridor[];
  readonly params: MatchParams;
  readonly fixtures: FixtureView[];
  readonly fixtureIdx: Map<string, number>;
  readonly roomTiles = new Map<RoomName, number[]>();
  /** The locked door's tile index, or -1. */
  readonly vaultDoor: number;
  /** Sigils in row-major order, with whether they belong to the body this bot plays. */
  readonly sigils: { idx: number; mine: boolean }[];
  /** True once the vault door has been opened. */
  doorOpen = false;
  private readonly rowsClosed: (Int16Array | undefined)[];
  private readonly rowsOpen: (Int16Array | undefined)[];
  private readonly roomFields = new Map<string, Int16Array>();

  constructor(start: MatchStartMsg) {
    this.w = start.map.w;
    this.h = start.map.h;
    this.n = this.w * this.h;
    this.tiles = start.map.tiles.flat();
    this.rooms = start.map.rooms.flat();
    this.params = start.params;
    this.fixtures = start.fixtures;
    this.fixtureIdx = new Map(start.fixtures.map((f) => [f.id, this.idx(f.pos)]));
    let door = -1;
    const sig: number[] = [];
    for (let i = 0; i < this.n; i++) {
      const r = this.rooms[i]!;
      if (r !== "corridor") {
        const list = this.roomTiles.get(r);
        if (list) list.push(i);
        else this.roomTiles.set(r, [i]);
      }
      if (this.tiles[i] === "door_locked") door = i;
      if (this.tiles[i] === "sigil") sig.push(i);
    }
    this.vaultDoor = door;
    this.sigils = sig.map((idx, k) => ({ idx, mine: start.sigil_owner[k] === "you" }));
    this.rowsClosed = new Array(this.n);
    this.rowsOpen = new Array(this.n);
  }

  idx(p: Pos): number {
    return p.y * this.w + p.x;
  }
  pos(i: number): Pos {
    return { x: i % this.w, y: Math.floor(i / this.w) };
  }

  /** Record what a state says about the map (the vault door). */
  update(s: StateMsg): void {
    if (!this.doorOpen && this.vaultDoor >= 0) this.doorOpen = s.doors_opened.some((d) => this.idx(d) === this.vaultDoor);
  }

  private bfs(src: number, open: boolean, multi?: readonly number[]): Int16Array {
    const dist = new Int16Array(this.n).fill(-1);
    const q = new Int32Array(this.n);
    let head = 0;
    let tail = 0;
    for (const s of multi ?? [src]) {
      if (dist[s]! >= 0) continue;
      dist[s] = 0;
      q[tail++] = s;
    }
    while (head < tail) {
      const cur = q[head++]!;
      const cx = cur % this.w;
      const cy = (cur - cx) / this.w;
      for (let d = 0; d < 4; d++) {
        const nx = cx + DX[d]!;
        const ny = cy + DY[d]!;
        if (nx < 0 || ny < 0 || nx >= this.w || ny >= this.h) continue;
        const ni = ny * this.w + nx;
        if (dist[ni]! >= 0) continue;
        const t = this.tiles[ni]!;
        if (t === "wall" || (t === "door_locked" && !open)) continue;
        dist[ni] = dist[cur]! + 1;
        q[tail++] = ni;
      }
    }
    return dist;
  }

  /** Distances from `src` to every tile, with the locked door open or closed. -1 where unreachable. */
  row(src: number, open: boolean): Int16Array {
    const rows = open ? this.rowsOpen : this.rowsClosed;
    let r = rows[src];
    if (!r) {
      r = this.bfs(src, open);
      rows[src] = r;
    }
    return r;
  }

  /** Distances from every tile to the nearest tile of a room. */
  roomField(room: RoomName, open: boolean): Int16Array {
    const key = `${room}:${open ? 1 : 0}`;
    let f = this.roomFields.get(key);
    if (!f) {
      f = this.bfs(-1, open, this.roomTiles.get(room) ?? []);
      this.roomFields.set(key, f);
    }
    return f;
  }

  /**
   * Walking ticks from a to b for a body that does or does not hold the key. With the door closed and the key held, a
   * route through the door costs one extra tick (the body stays put while the door opens).
   */
  dist(a: number, b: number, hasKey: boolean): number {
    if (this.doorOpen) return nz(this.row(a, true)[b]!);
    const closed = nz(this.row(a, false)[b]!);
    if (!hasKey || this.vaultDoor < 0) return closed;
    return Math.min(closed, nz(this.row(a, true)[b]!) + 1);
  }

  /** Walking ticks from a to b with the vault door in a given state (for planning ahead of the real one). */
  distDoor(a: number, b: number, doorOpen: boolean, hasKey: boolean): number {
    if (doorOpen) return nz(this.row(a, true)[b]!);
    const closed = nz(this.row(a, false)[b]!);
    if (!hasKey || this.vaultDoor < 0) return closed;
    return Math.min(closed, nz(this.row(a, true)[b]!) + 1);
  }

  /** Walking ticks from a to the nearest tile of a room. */
  roomDist(a: number, room: RoomName, hasKey: boolean): number {
    if (this.doorOpen) return nz(this.roomField(room, true)[a]!);
    const closed = nz(this.roomField(room, false)[a]!);
    if (!hasKey || this.vaultDoor < 0) return closed;
    return Math.min(closed, nz(this.roomField(room, true)[a]!) + 1);
  }

  private useOpen(field: (open: boolean) => Int16Array, from: number, hasKey: boolean): boolean {
    if (this.doorOpen) return true;
    if (!hasKey) return false;
    return nz(field(true)[from]!) + 1 < nz(field(false)[from]!);
  }

  /** First step of a shortest route from `from` to `to` (N, E, S, W tie-break), or null when there or unreachable. */
  stepToward(from: number, to: number, hasKey: boolean): Dir | null {
    if (from === to) return null;
    const open = this.useOpen((o) => this.row(to, o), from, hasKey);
    return this.descend(from, this.row(to, open), open);
  }

  /** First step toward the nearest tile of a room, or null when in it or unreachable. */
  stepTowardRoom(from: number, room: RoomName, hasKey: boolean): Dir | null {
    if (this.rooms[from] === room) return null;
    const open = this.useOpen((o) => this.roomField(room, o), from, hasKey);
    return this.descend(from, this.roomField(room, open), open);
  }

  private descend(from: number, field: Int16Array, open: boolean): Dir | null {
    const here = field[from]!;
    if (here <= 0) return null;
    const fx = from % this.w;
    const fy = (from - fx) / this.w;
    for (let d = 0; d < 4; d++) {
      const nx = fx + DX[d]!;
      const ny = fy + DY[d]!;
      if (nx < 0 || ny < 0 || nx >= this.w || ny >= this.h) continue;
      const ni = ny * this.w + nx;
      const t = this.tiles[ni]!;
      if (t === "wall" || (t === "door_locked" && !open)) continue;
      if (field[ni] === here - 1) return DIR_LIST[d]!;
    }
    return null;
  }

  fixtureAt(i: number): FixtureView | undefined {
    return this.fixtures.find((f) => this.idx(f.pos) === i);
  }
}

const nz = (d: number): number => (d < 0 ? Infinity : d);

export const holdsKind = (inv: readonly HeldItem[], kind: ItemKind): HeldItem | undefined => inv.find((i) => i.kind === kind);
export const holdsKey = (inv: readonly HeldItem[]): boolean => inv.some((i) => i.kind === "key");
export const manhattan = (a: Pos, b: Pos): number => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

/** Whether `who` wound up a snatch on the last tick, so its grab resolves on this one (SPEC 3.4). */
export const woundUp = (s: StateMsg, who: "you" | "maria"): boolean => s.events.some((e) => e.kind === "winding_up" && e.by === who);

/** The tile one step in `dir` from `p`. */
export const stepFrom = (p: Pos, dir: Dir): Pos => ({ x: p.x + DIR_DELTA[dir].x, y: p.y + DIR_DELTA[dir].y });

/** Where a move from `p` ends: the next tile, or `p` itself into a wall, off the map or into the closed vault door. */
export function moveEnd(k: Knowledge, p: Pos, dir: Dir): Pos | null {
  const to = stepFrom(p, dir);
  if (to.x < 0 || to.y < 0 || to.x >= k.w || to.y >= k.h) return null;
  const t = k.tiles[k.idx(to)];
  if (t === "wall" || (t === "door_locked" && !k.doorOpen)) return null;
  return to;
}

/**
 * Stepping out of reach (RULES.md, "What strong bots do"): a move that ends more than one tile (Manhattan) from
 * `from`. The planned move if it does; else the first of N, E, S, W that does, nearest by walking to `target` (a tile
 * index, or -1 for none); null when no move does.
 */
export function stepOutOfReach(k: Knowledge, me: Pos, from: Pos, planned: Intent, target: number, hasKey: boolean): Intent | null {
  if (planned.kind === "MOVE") {
    const to = moveEnd(k, me, planned.dir);
    if (to && manhattan(to, from) > 1) return planned;
  }
  let best: { dir: Dir; d: number } | null = null;
  for (const dir of DIR_LIST) {
    const to = moveEnd(k, me, dir);
    if (!to || manhattan(to, from) <= 1) continue;
    const d = target >= 0 ? k.dist(k.idx(to), target, hasKey) : 0;
    if (!best || d < best.d) best = { dir, d };
  }
  return best ? { kind: "MOVE", dir: best.dir } : null;
}

/**
 * Consecutive tick ends a body has held each item kind, kept from the states a bot observes (one per tick).
 * `count(kind)` after observing the state for tick t is the number of tick ends up to t - 1.
 */
export class StreakTracker {
  private streak = new Map<ItemKind, number>();
  private lastTick = -1;
  observe(tick: number, inv: readonly HeldItem[]): void {
    if (tick === this.lastTick) return;
    const held = new Set(inv.map((i) => i.kind));
    const next = new Map<ItemKind, number>();
    const contiguous = tick === this.lastTick + 1;
    for (const k of held) next.set(k, (contiguous ? (this.streak.get(k) ?? 0) : 0) + 1);
    // Tick 0's state shows the start, before any tick has ended.
    if (tick === 0) next.clear();
    this.streak = next;
    this.lastTick = tick;
  }
  count(kind: ItemKind): number {
    return this.streak.get(kind) ?? 0;
  }
}

/**
 * The other body's energy, tracked exactly from public events (SPEC 3.3, 3.6): start energy, plus regen per tick,
 * minus `snatch_cost` per snatch it winds up, plus 40 per payout of its sigil, capped at 100.
 */
export class EnergyTracker {
  energy: number;
  private lastTick = 0;
  constructor(private readonly params: MatchParams) {
    this.energy = params.energy_start;
  }
  /** Fold in the state for `tick` (its events are those of tick - 1). */
  observe(s: StateMsg): void {
    if (s.tick <= this.lastTick) return;
    let e = this.energy;
    for (const ev of s.events) if (ev.kind === "winding_up" && ev.by === "maria") e -= this.params.snatch_cost;
    for (const ev of s.events) if (ev.kind === "sigil" && ev.owner === "maria") e = Math.min(100, e + ev.energy_gained);
    e = Math.min(100, e + this.params.regen);
    // A gap in the ticks (a missed state) is filled with regen only.
    for (let t = this.lastTick + 1; t < s.tick; t++) e = Math.min(100, e + this.params.regen);
    this.energy = e;
    this.lastTick = s.tick;
  }
}
