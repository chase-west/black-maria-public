import type { Pos } from "@blackmaria/protocol";
import type { GameMap } from "./types.js";

/** Walking distances from one tile to every tile: -1 where unreachable. Index `y * w + x`. */
export type DistanceField = Int16Array;

const DX = [0, 1, 0, -1];
const DY = [-1, 0, 1, 0];

/**
 * Breadth-first distances over passable tiles (everything but `wall`). The locked door is passable when `unlocked`
 * is true or when it is listed in `opened`. Expansion order is N, E, S, W.
 */
export function distanceField(map: GameMap, from: Pos, unlocked: boolean, opened: readonly Pos[] = []): DistanceField {
  const { w, h } = map;
  const dist = new Int16Array(w * h).fill(-1);
  if (from.x < 0 || from.y < 0 || from.x >= w || from.y >= h) return dist;
  const q = new Int32Array(w * h);
  let head = 0;
  let tail = 0;
  const s = from.y * w + from.x;
  dist[s] = 0;
  q[tail++] = s;
  const doorOpen = unlocked || opened.some((d) => d.x === map.vaultDoor.x && d.y === map.vaultDoor.y);
  while (head < tail) {
    const cur = q[head++]!;
    const cx = cur % w;
    const cy = (cur - cx) / w;
    for (let d = 0; d < 4; d++) {
      const nx = cx + DX[d]!;
      const ny = cy + DY[d]!;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      if (dist[ni]! >= 0) continue;
      const t = map.tiles[ny]![nx]!;
      if (t === "wall" || (t === "door_locked" && !doorOpen)) continue;
      dist[ni] = dist[cur]! + 1;
      q[tail++] = ni;
    }
  }
  return dist;
}

/** Distance between two tiles, or Infinity. */
export function walkDistance(map: GameMap, a: Pos, b: Pos, unlocked: boolean): number {
  const d = distanceField(map, a, unlocked)[b.y * map.w + b.x]!;
  return d < 0 ? Infinity : d;
}
