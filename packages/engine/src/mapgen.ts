import type { DecorKind, FixtureKind, ItemKind, Pos, RoomName, RoomOrCorridor, TileKind } from "@blackmaria/protocol";
import { ITEM_KINDS, ROOM_NAMES } from "@blackmaria/protocol";
import { SeqRng, hashString, mix32 } from "./prng.js";
import { RULES } from "./rules.js";
import type { Body, Fixture, GameMap, Item, Sigil } from "./types.js";

/** Fixtures appropriate to each room (SPEC 3.2). At most one safe per map, never in the Vault. */
export const ROOM_FIXTURES: Record<RoomName, FixtureKind[]> = {
  hall: ["clock", "mirror", "fireplace"],
  library: ["bookcase", "fireplace", "clock"],
  study: ["bookcase", "safe", "clock", "fireplace"],
  chapel: ["altar", "font", "mirror"],
  cellar: ["well", "safe", "stove"],
  kitchen: ["stove", "well", "fireplace"],
  conservatory: ["font", "well", "piano"],
  gallery: ["mirror", "piano", "clock"],
  nursery: ["bed", "piano", "mirror"],
  vault: ["altar", "mirror", "clock"],
};

export interface World {
  map: GameMap;
  fixtures: Fixture[];
  items: Item[];
  sigils: Sigil[];
  safe: { fixture: string; open: boolean } | null;
}

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Decor props by room kind (SPEC 8.1): purely visual, passable, 1 to 3 per room. */
export const ROOM_DECOR: Record<RoomName, DecorKind[]> = {
  hall: ["plant", "chair", "vase", "candelabra", "rug_small"],
  library: ["bookstack", "chair", "table_small", "candelabra", "rug_small"],
  study: ["bookstack", "chair", "table_small", "plant"],
  chapel: ["candelabra", "vase", "cushion", "rug_small"],
  cellar: ["crate", "barrel", "cobweb", "stool"],
  kitchen: ["stool", "barrel", "crate", "table_small"],
  conservatory: ["plant", "vase", "stool", "cushion"],
  gallery: ["vase", "plant", "chair", "rug_small"],
  nursery: ["cushion", "rug_small", "chair", "plant"],
  vault: ["cobweb", "crate", "candelabra"],
};

/** Every room's floor is at least this many tiles on each side (SPEC 8.1). */
export const MIN_ROOM = 5;
/** A straight corridor run never goes more than this many tiles without reaching a room (SPEC 8.1). */
export const MAX_CORRIDOR_RUN = 8;
const WALL = -2;
const CORRIDOR = -1;

export function isPassableKind(k: TileKind): boolean {
  return k !== "wall" && k !== "door_locked";
}

/** Generate the house for a seed. Deterministic. Retries internally until every invariant holds. */
export function generateWorld(seed: number): World {
  for (let attempt = 0; attempt < 4000; attempt++) {
    const w = tryGenerate(seed >>> 0, attempt);
    if (w) return w;
  }
  throw new Error(`mapgen: no valid map for seed ${seed}`);
}

const N4 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

function tryGenerate(seed: number, attempt: number): World | null {
  const rnd = new SeqRng(mix32(seed ^ hashString("map")) ^ mix32(attempt + 1));
  // S from 21: seven or eight rooms of at least 5x5 plus a corridor do not fit inside a 20x20 house.
  const S = rnd.range(21, 24);
  const tiles: TileKind[][] = Array.from({ length: S }, () => Array<TileKind>(S).fill("wall"));
  const rooms: RoomOrCorridor[][] = Array.from({ length: S }, () => Array<RoomOrCorridor>(S).fill("corridor"));
  const region: number[][] = Array.from({ length: S }, () => Array<number>(S).fill(WALL));

  // --- BSP. The first split leaves a one-tile corridor between the halves; the rest share one wall.
  const roomCount = rnd.range(7, 8);
  const target = roomCount + 1; // two leaves are merged into the L-shaped room
  const leaves: Rect[] = [{ x0: 1, y0: 1, x1: S - 2, y1: S - 2 }];
  let corridorLine: { axis: "v" | "h"; at: number; from: number; to: number } | null = null;
  // How many rooms of at least MIN_ROOM a rectangle can still be cut into with shared walls.
  const cap = (r: Rect) => Math.floor((r.x1 - r.x0 + 2) / (MIN_ROOM + 1)) * Math.floor((r.y1 - r.y0 + 2) / (MIN_ROOM + 1));
  while (leaves.length < target) {
    const total = leaves.reduce((n, l) => n + cap(l), 0);
    const options: { i: number; A: Rect; B: Rect; axis: "v" | "h"; k: number }[] = [];
    const corridor = corridorLine === null;
    const gap = corridor ? 3 : 1;
    leaves.forEach((L, i) => {
      for (const axis of ["v", "h"] as const) {
        const lo = (axis === "v" ? L.x0 : L.y0) + MIN_ROOM;
        const hi = (axis === "v" ? L.x1 : L.y1) - MIN_ROOM - gap + 1;
        for (let k = lo; k <= hi; k++) {
          const A: Rect = axis === "v" ? { ...L, x1: k - 1 } : { ...L, y1: k - 1 };
          const B: Rect = axis === "v" ? { ...L, x0: k + gap } : { ...L, y0: k + gap };
          if (total - cap(L) + cap(A) + cap(B) >= target) options.push({ i, A, B, axis, k });
        }
      }
    });
    if (options.length === 0) return null;
    // Prefer splitting the largest leaf, as BSP does; among its options pick by seed.
    const biggest = Math.max(...options.map((o) => area(leaves[o.i]!)));
    const pool = options.filter((o) => area(leaves[o.i]!) === biggest);
    const o = rnd.pick(pool);
    const L = leaves[o.i]!;
    if (corridor) corridorLine = o.axis === "v" ? { axis: "v", at: o.k + 1, from: L.y0, to: L.y1 } : { axis: "h", at: o.k + 1, from: L.x0, to: L.x1 };
    leaves.splice(o.i, 1, o.A, o.B);
  }
  if (!corridorLine) return null;
  const line = corridorLine as { axis: "v" | "h"; at: number; from: number; to: number };
  const lineTile = (t: number): Pos => (line.axis === "v" ? { x: line.at, y: t } : { x: t, y: line.at });

  // --- Regions: one per leaf, then two top- or left-aligned neighbours of different length merged into an L.
  leaves.forEach((L, idx) => {
    for (let y = L.y0; y <= L.y1; y++)
      for (let x = L.x0; x <= L.x1; x++) {
        tiles[y]![x] = "floor";
        region[y]![x] = idx;
      }
  });
  for (let t = line.from; t <= line.to; t++) {
    const p = lineTile(t);
    tiles[p.y]![p.x] = "floor";
    region[p.y]![p.x] = CORRIDOR;
  }
  const merges: { a: number; b: number; wall: Pos[] }[] = [];
  for (let i = 0; i < leaves.length; i++)
    for (let j = i + 1; j < leaves.length; j++) {
      const A = leaves[i]!;
      const B = leaves[j]!;
      const wall: Pos[] = [];
      if (A.x1 + 2 === B.x0 || B.x1 + 2 === A.x0) {
        // Side by side: an L when the tops (or bottoms) line up and the heights differ.
        const x = A.x1 + 2 === B.x0 ? A.x1 + 1 : B.x1 + 1;
        const y0 = Math.max(A.y0, B.y0);
        const y1 = Math.min(A.y1, B.y1);
        const aligned = A.y0 === B.y0 || A.y1 === B.y1;
        if (y1 - y0 + 1 >= MIN_ROOM && aligned && A.y1 - A.y0 !== B.y1 - B.y0) for (let y = y0; y <= y1; y++) wall.push({ x, y });
      } else if (A.y1 + 2 === B.y0 || B.y1 + 2 === A.y0) {
        const y = A.y1 + 2 === B.y0 ? A.y1 + 1 : B.y1 + 1;
        const x0 = Math.max(A.x0, B.x0);
        const x1 = Math.min(A.x1, B.x1);
        const aligned = A.x0 === B.x0 || A.x1 === B.x1;
        if (x1 - x0 + 1 >= MIN_ROOM && aligned && A.x1 - A.x0 !== B.x1 - B.x0) for (let x = x0; x <= x1; x++) wall.push({ x, y });
      }
      if (wall.length && wall.every((p) => region[p.y]![p.x] === WALL)) merges.push({ a: i, b: j, wall });
    }
  if (merges.length === 0) return null;
  // The merged room may not outgrow the largest other leaf: the hall stays the largest room, and a rectangle.
  const sizes = leaves.map(area);
  const okMerges = merges.filter((m) => sizes[m.a]! + sizes[m.b]! + m.wall.length < Math.max(...sizes.filter((_, k) => k !== m.a && k !== m.b)));
  if (okMerges.length === 0) return null;
  const merge = rnd.pick(okMerges);
  for (const p of merge.wall) {
    tiles[p.y]![p.x] = "floor";
    region[p.y]![p.x] = merge.a;
  }
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (region[y]![x] === merge.b) region[y]![x] = merge.a;
  // Region ids after the merge: every leaf except merge.b.
  const regionIds = leaves.map((_, i) => i).filter((i) => i !== merge.b);
  const regionArea = (r: number) => (r === merge.a ? sizes[merge.a]! + sizes[merge.b]! + merge.wall.length : sizes[r]!);

  // --- Names. Hall is the largest room (always a plain rectangle); the vault the smallest of the rest.
  const byArea = regionIds.map((i) => ({ i, a: regionArea(i) }));
  const ranked = byArea.slice().sort((p, q) => q.a - p.a || p.i - q.i);
  const hallIdx = ranked[0]!.i;
  if (hallIdx === merge.a || ranked[0]!.a === ranked[1]!.a) return null;
  const vaultIdx = byArea.filter((p) => p.i !== hallIdx && p.i !== merge.a).sort((p, q) => p.a - q.a || p.i - q.i)[0]!.i;
  const others = rnd.shuffle(ROOM_NAMES.filter((n) => n !== "hall" && n !== "vault"));
  const names = new Map<number, RoomName>();
  let oi = 0;
  for (const i of regionIds) names.set(i, i === hallIdx ? "hall" : i === vaultIdx ? "vault" : others[oi++]!);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const r = region[y]![x]!;
      if (r >= 0) rooms[y]![x] = names.get(r)!;
    }

  // --- Door candidates: wall tiles with a region on both sides, in a straight line.
  const cands = new Map<string, { a: number; b: number; tiles: Pos[] }>();
  for (let y = 1; y < S - 1; y++)
    for (let x = 1; x < S - 1; x++) {
      if (region[y]![x] !== WALL) continue;
      for (const [dx, dy] of [
        [1, 0],
        [0, 1],
      ] as const) {
        const ra = region[y - dy]![x - dx]!;
        const rb = region[y + dy]![x + dx]!;
        if (ra === WALL || rb === WALL || ra === rb) continue;
        if (region[y - dx]![x - dy] !== WALL || region[y + dx]![x + dy] !== WALL) continue;
        const a = Math.min(ra, rb);
        const b = Math.max(ra, rb);
        const k = `${a}:${b}`;
        let e = cands.get(k);
        if (!e) {
          e = { a, b, tiles: [] };
          cands.set(k, e);
        }
        e.tiles.push({ x, y });
      }
    }
  const edges = [...cands.values()];
  const vaultEdges = edges.filter((e) => e.a === vaultIdx || e.b === vaultIdx);
  if (vaultEdges.length === 0) return null;
  const vaultEdge = rnd.pick(vaultEdges);
  const rest = rnd.shuffle(edges.filter((e) => e.a !== vaultIdx && e.b !== vaultIdx));
  const parent = new Map<number, number>();
  const find = (n: number): number => {
    let p = parent.get(n) ?? n;
    if (p !== n) {
      p = find(p);
      parent.set(n, p);
    }
    return p;
  };
  const chosen: typeof edges = [];
  const unused: typeof edges = [];
  for (const e of rest) {
    const ra = find(e.a);
    const rb = find(e.b);
    if (ra !== rb) {
      parent.set(ra, rb);
      chosen.push(e);
    } else unused.push(e);
  }
  const nodes = [CORRIDOR, ...regionIds].filter((n) => n !== vaultIdx);
  const root = find(nodes[0]!);
  if (nodes.some((n) => find(n) !== root)) return null;
  chosen.push(...rnd.shuffle(unused).slice(0, Math.min(unused.length, rnd.range(2, 3))));

  const doors: Pos[] = [];
  const near = (p: Pos) => doors.some((d) => Math.abs(d.x - p.x) + Math.abs(d.y - p.y) <= 1);
  const addDoor = (p: Pos) => {
    tiles[p.y]![p.x] = "door";
    doors.push(p);
  };
  for (const e of chosen) {
    const apart = e.tiles.filter((t) => !near(t));
    addDoor(rnd.pick(apart.length ? apart : e.tiles));
  }
  const vaultApart = vaultEdge.tiles.filter((t) => !near(t));
  const vaultDoor = rnd.pick(vaultApart.length ? vaultApart : vaultEdge.tiles);
  tiles[vaultDoor.y]![vaultDoor.x] = "door_locked";

  // --- The corridor: no dead ends, and no straight run longer than 8 tiles without reaching a room.
  const opensAt = (t: number) => {
    const p = lineTile(t);
    return N4.some(([dx, dy]) => {
      const k = tiles[p.y + dy]?.[p.x + dx];
      return k === "door" || k === "door_locked";
    });
  };
  // Doors from the corridor into a room beside it, at corridor position t, if there is one.
  const sideDoor = (t: number): Pos | null => {
    const p = lineTile(t);
    const opts: Pos[] = [];
    for (const s of [-1, 1]) {
      const w = line.axis === "v" ? { x: p.x + s, y: p.y } : { x: p.x, y: p.y + s };
      const beyond = line.axis === "v" ? { x: p.x + 2 * s, y: p.y } : { x: p.x, y: p.y + 2 * s };
      const r = region[beyond.y]?.[beyond.x];
      if (r !== undefined && r >= 0 && r !== vaultIdx && tiles[w.y]![w.x] === "wall" && !near(w)) opts.push(w);
    }
    return opts.length ? rnd.pick(opts) : null;
  };
  let lastOpen = line.from - 1;
  for (let t = line.from; t <= line.to; t++) {
    if (opensAt(t)) lastOpen = t;
    else if (t - lastOpen >= MAX_CORRIDOR_RUN) {
      // Put a door somewhere in the last stretch.
      let placed = false;
      for (let u = t; u > lastOpen && !placed; u--) {
        const d = sideDoor(u);
        if (d) {
          addDoor(d);
          lastOpen = u;
          placed = true;
        }
      }
      if (!placed) return null;
    }
  }
  // Prune dead ends: corridor tiles beyond the outermost openings become wall.
  let first = line.from;
  let last = line.to;
  while (first <= line.to && !opensAt(first)) first++;
  while (last >= line.from && !opensAt(last)) last--;
  if (first > last) return null;
  for (let t = line.from; t <= line.to; t++)
    if (t < first || t > last) {
      const p = lineTile(t);
      tiles[p.y]![p.x] = "wall";
      region[p.y]![p.x] = WALL;
    }
  for (let t = first, run = 0; t <= last; t++) {
    run = opensAt(t) ? 0 : run + 1;
    if (run > MAX_CORRIDOR_RUN) return null;
  }

  const hall = leaves[hallIdx]!;
  const start = { x: Math.floor((hall.x0 + hall.x1) / 2), y: Math.floor((hall.y0 + hall.y1) / 2) };
  const mariaStart = farthestInRoom(tiles, region, hallIdx, start);

  // --- Free tiles per room: floor, not a start, not used, not directly beside a door.
  const used = new Set<string>([key(start), key(mariaStart)]);
  const nearDoor = (p: Pos) =>
    N4.some(([dx, dy]) => {
      const t = tiles[p.y + dy]?.[p.x + dx];
      return t === "door" || t === "door_locked";
    });
  const freeIn = (idx: number): Pos[] => {
    const out: Pos[] = [];
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const p = { x, y };
        if (region[y]![x] === idx && tiles[y]![x] === "floor" && !used.has(key(p)) && !nearDoor(p)) out.push(p);
      }
    return out;
  };
  const place = (idx: number): Pos | null => {
    const free = freeIn(idx);
    if (free.length === 0) return null;
    const p = rnd.pick(free);
    used.add(key(p));
    return p;
  };
  const nameOf = (idx: number) => names.get(idx)!;

  // --- Sigils: two different non-hall, non-Vault rooms; one owned by each mind.
  const sigilRooms = rnd.shuffle(regionIds.filter((i) => i !== hallIdx && i !== vaultIdx)).slice(0, 2);
  const owners: Body[] = rnd.bool() ? ["you", "maria"] : ["maria", "you"];
  const sigils: Sigil[] = [];
  for (let k = 0; k < 2; k++) {
    const idx = sigilRooms[k]!;
    const p = place(idx);
    if (!p) return null;
    tiles[p.y]![p.x] = "sigil";
    sigils.push({ pos: p, room: nameOf(idx), owner: owners[k]!, cooldown: 0 });
  }

  // --- Fixtures: 1 or 2 per room, appropriate to it.
  const fixtures: Fixture[] = [];
  let safeId: string | null = null;
  for (const idx of regionIds) {
    const name = nameOf(idx);
    const n = rnd.range(1, 2);
    const kinds = rnd.shuffle(ROOM_FIXTURES[name].filter((k) => k !== "safe" || (safeId === null && name !== "vault"))).slice(0, n);
    for (const kind of kinds) {
      const p = place(idx);
      if (!p) return null;
      const id = `f${fixtures.length + 1}`;
      fixtures.push({ id, kind, pos: p, room: name });
      if (kind === "safe") safeId = id;
    }
  }

  // --- Items: 16 to 20, at most three of a kind, exactly one key, none inside the Vault.
  const count = rnd.range(RULES.itemsMin, RULES.itemsMax);
  const nonKeyPool = ITEM_KINDS.filter((k) => k !== "key").flatMap((k) => Array<ItemKind>(RULES.maxPerKind).fill(k));
  const kinds: ItemKind[] = rnd.shuffle(["key", ...rnd.shuffle(nonKeyPool).slice(0, count - 1)]);
  const itemRooms = regionIds.filter((i) => i !== vaultIdx);
  const items: Item[] = [];
  for (let k = 0; k < kinds.length; k++) {
    const p = place(rnd.pick(itemRooms));
    if (!p) return null;
    items.push({ id: `i${k + 1}`, kind: kinds[k]!, loc: { at: "tile", pos: p } });
  }
  let safe: World["safe"] = null;
  if (safeId) {
    const inside = rnd.pick(items.filter((i) => i.kind !== "key"));
    inside.loc = { at: "safe", fixture: safeId };
    inside.fromSafe = true;
    safe = { fixture: safeId, open: false };
  }

  // --- Decor: 1 to 3 visual props per room, on free floor (SPEC 8.1).
  const decor: { kind: DecorKind; pos: Pos }[] = [];
  for (const idx of regionIds) {
    const kinds = rnd.shuffle(ROOM_DECOR[nameOf(idx)]).slice(0, rnd.range(1, 3));
    for (const kind of kinds) {
      const p = place(idx);
      if (p) decor.push({ kind, pos: p });
    }
  }

  const roomList = [...names.values()].sort((a, b) => ROOM_NAMES.indexOf(a) - ROOM_NAMES.indexOf(b));
  const map: GameMap = { w: S, h: S, tiles, rooms, roomList, start, mariaStart, vaultDoor, decor };
  if (!checkConnectivity(map)) return null;
  return { map, fixtures, items, sigils, safe };
}

/** The tile of region `idx` farthest from `from` by walking distance inside the region; ties go to the first in row-major order. */
function farthestInRoom(tiles: TileKind[][], region: number[][], idx: number, from: Pos): Pos {
  const h = tiles.length;
  const w = tiles[0]!.length;
  const dist = Array.from({ length: h }, () => Array<number>(w).fill(-1));
  dist[from.y]![from.x] = 0;
  const q: Pos[] = [from];
  for (let i = 0; i < q.length; i++) {
    const p = q[i]!;
    for (const [dx, dy] of N4) {
      const x = p.x + dx;
      const y = p.y + dy;
      if (y < 0 || x < 0 || y >= h || x >= w || dist[y]![x]! >= 0 || region[y]![x] !== idx || tiles[y]![x] !== "floor") continue;
      dist[y]![x] = dist[p.y]![p.x]! + 1;
      q.push({ x, y });
    }
  }
  let best = from;
  let bd = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (dist[y]![x]! > bd) {
        bd = dist[y]![x]!;
        best = { x, y };
      }
  return best;
}

function area(r: Rect): number {
  return (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1);
}
const key = (p: Pos) => `${p.x},${p.y}`;

/** BFS over passable tiles from `from`. `unlocked` treats door_locked as passable. */
export function reachable(map: GameMap, from: Pos, unlocked: boolean): boolean[][] {
  const seen = Array.from({ length: map.h }, () => Array<boolean>(map.w).fill(false));
  const q: Pos[] = [from];
  seen[from.y]![from.x] = true;
  while (q.length) {
    const p = q.shift()!;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = p.x + dx;
      const ny = p.y + dy;
      if (nx < 0 || ny < 0 || nx >= map.w || ny >= map.h || seen[ny]![nx]) continue;
      const t = map.tiles[ny]![nx]!;
      if (t === "wall" || (t === "door_locked" && !unlocked)) continue;
      seen[ny]![nx] = true;
      q.push({ x: nx, y: ny });
    }
  }
  return seen;
}

/** Every passable tile is reachable from the start, except the Vault, which needs the locked door. */
export function checkConnectivity(map: GameMap): boolean {
  const locked = reachable(map, map.start, false);
  const open = reachable(map, map.start, true);
  for (let y = 0; y < map.h; y++)
    for (let x = 0; x < map.w; x++) {
      const t = map.tiles[y]![x]!;
      if (t === "wall") continue;
      if (!open[y]![x]) return false;
      const inVault = map.rooms[y]![x] === "vault";
      if (t === "door_locked") continue;
      if (inVault === locked[y]![x]) return false;
    }
  return true;
}
