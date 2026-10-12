import { describe, expect, it } from "vitest";
import { ROOM_NAMES } from "@blackmaria/protocol";
import { MAX_CORRIDOR_RUN, MIN_ROOM, ROOM_DECOR, ROOM_FIXTURES, checkConnectivity, generateWorld, reachable, type World } from "../src/index.js";

const SEEDS = 1000;
const worlds: { seed: number; w: World }[] = Array.from({ length: SEEDS }, (_, k) => {
  const seed = (k * 747796405 + 2891336453) >>> 0;
  return { seed, w: generateWorld(seed) };
});

const count = (w: World, kind: string) => w.map.tiles.flat().filter((t) => t === kind).length;

describe(`3.1 / 3.2 mapgen (${SEEDS} seeds)`, () => {
  it("square grid with side S in [20, 24]", () => {
    for (const { w } of worlds) {
      expect(w.map.w).toBe(w.map.h);
      expect(w.map.w).toBeGreaterThanOrEqual(20);
      expect(w.map.w).toBeLessThanOrEqual(24);
      expect(w.map.tiles).toHaveLength(w.map.h);
      expect(w.map.rooms.every((r) => r.length === w.map.w)).toBe(true);
    }
  });

  it("7 or 8 rooms with names from the list; hall and vault always exist", () => {
    for (const { w } of worlds) {
      expect([7, 8]).toContain(w.map.roomList.length);
      expect(new Set(w.map.roomList).size).toBe(w.map.roomList.length);
      for (const r of w.map.roomList) expect(ROOM_NAMES).toContain(r);
      expect(w.map.roomList).toContain("hall");
      expect(w.map.roomList).toContain("vault");
    }
  });

  it("you start in the center of the hall, on a plain floor tile", () => {
    for (const { w } of worlds) {
      const { start } = w.map;
      expect(w.map.rooms[start.y]![start.x]).toBe("hall");
      expect(w.map.tiles[start.y]![start.x]).toBe("floor");
      const hallTiles = w.map.rooms.flatMap((row, y) => row.map((r, x) => (r === "hall" ? { x, y } : null))).filter((p) => p !== null);
      const xs = hallTiles.map((p) => p!.x);
      const ys = hallTiles.map((p) => p!.y);
      expect(start.x).toBe(Math.floor((Math.min(...xs) + Math.max(...xs)) / 2));
      expect(start.y).toBe(Math.floor((Math.min(...ys) + Math.max(...ys)) / 2));
    }
  });

  it("every floor tile is reachable from the start, except the Vault, which is reachable only through the door_locked tile", () => {
    for (const { w } of worlds) {
      expect(checkConnectivity(w.map)).toBe(true);
      const locked = reachable(w.map, w.map.start, false);
      for (let y = 0; y < w.map.h; y++)
        for (let x = 0; x < w.map.w; x++) if (w.map.rooms[y]![x] === "vault") expect(locked[y]![x]).toBe(false);
    }
  });

  it("exactly one door_locked, on the Vault boundary", () => {
    for (const { w } of worlds) {
      expect(count(w, "door_locked")).toBe(1);
      const { x, y } = w.map.vaultDoor;
      expect(w.map.tiles[y]![x]).toBe("door_locked");
      const nbr = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ].map(([dx, dy]) => w.map.rooms[y + dy!]?.[x + dx!]);
      expect(nbr).toContain("vault");
    }
  });

  it("exactly two sigils in two different non-hall rooms", () => {
    for (const { w } of worlds) {
      expect(count(w, "sigil")).toBe(2);
      expect(w.sigils).toHaveLength(2);
      const rooms = w.sigils.map((g) => w.map.rooms[g.pos.y]![g.pos.x]);
      expect(rooms[0]).not.toBe(rooms[1]);
      expect(rooms).not.toContain("hall");
      expect(rooms).not.toContain("corridor");
    }
  });

  it("only the five tile kinds appear; at least 3 doors", () => {
    for (const { w } of worlds) {
      for (const row of w.map.tiles) for (const t of row) expect(["floor", "wall", "door", "door_locked", "sigil"]).toContain(t);
      expect(count(w, "door")).toBeGreaterThanOrEqual(3);
    }
  });

  it("every tile carries a kind and a room", () => {
    for (const { w } of worlds) for (let y = 0; y < w.map.h; y++) for (let x = 0; x < w.map.w; x++) {
      expect(typeof w.map.tiles[y]![x]).toBe("string");
      expect(typeof w.map.rooms[y]![x]).toBe("string");
    }
  });

  it("fixtures: 1 or 2 per room, appropriate to it, on floor tiles, at most one per tile, at most one safe and never in the Vault", () => {
    for (const { w } of worlds) {
      for (const r of w.map.roomList) {
        const fs = w.fixtures.filter((f) => f.room === r);
        expect(fs.length).toBeGreaterThanOrEqual(1);
        expect(fs.length).toBeLessThanOrEqual(2);
        for (const f of fs) expect(ROOM_FIXTURES[r]).toContain(f.kind);
      }
      const tiles = new Set(w.fixtures.map((f) => `${f.pos.x},${f.pos.y}`));
      expect(tiles.size).toBe(w.fixtures.length);
      for (const f of w.fixtures) {
        expect(w.map.tiles[f.pos.y]![f.pos.x]).toBe("floor");
        expect(w.map.rooms[f.pos.y]![f.pos.x]).toBe(f.room);
      }
      const safes = w.fixtures.filter((f) => f.kind === "safe");
      expect(safes.length).toBeLessThanOrEqual(1);
      if (safes[0]) expect(safes[0].room).not.toBe("vault");
    }
  });

  it("items: 16 to 20, at most three of a kind, exactly one key, none inside the Vault; a safe starts closed holding one non-key item", () => {
    for (const { w } of worlds) {
      expect(w.items.length).toBeGreaterThanOrEqual(16);
      expect(w.items.length).toBeLessThanOrEqual(20);
      const perKind = new Map<string, number>();
      for (const i of w.items) perKind.set(i.kind, (perKind.get(i.kind) ?? 0) + 1);
      for (const n of perKind.values()) expect(n).toBeLessThanOrEqual(3);
      const keys = w.items.filter((i) => i.kind === "key");
      expect(keys).toHaveLength(1);
      expect(keys[0]!.loc.at).toBe("tile");
      for (const i of w.items) {
        if (i.loc.at === "tile") {
          const { x, y } = i.loc.pos;
          expect(w.map.tiles[y]![x]).toBe("floor");
          expect(w.map.rooms[y]![x]).not.toBe("vault");
          expect(w.map.rooms[y]![x]).not.toBe("corridor");
          expect(w.fixtures.some((f) => f.pos.x === x && f.pos.y === y)).toBe(false);
        } else expect(i.loc.at).toBe("safe");
      }
      const safe = w.fixtures.find((f) => f.kind === "safe");
      if (safe) {
        expect(w.safe).toEqual({ fixture: safe.id, open: false });
        const inside = w.items.filter((i) => i.loc.at === "safe");
        expect(inside).toHaveLength(1);
        expect(inside[0]!.kind).not.toBe("key");
      } else {
        expect(w.safe).toBeNull();
        expect(w.items.some((i) => i.loc.at === "safe")).toBe(false);
      }
    }
  });

  it("Maria starts on the hall tile farthest from your start (walking distance, ties row-major)", () => {
    for (const { w } of worlds) {
      const { start, mariaStart } = w.map;
      expect(w.map.rooms[mariaStart.y]![mariaStart.x]).toBe("hall");
      expect(w.map.tiles[mariaStart.y]![mariaStart.x]).toBe("floor");
      // The hall is a rectangle of floor, so walking distance inside it is the Manhattan distance.
      let best = -1;
      let at: { x: number; y: number } | null = null;
      for (let y = 0; y < w.map.h; y++)
        for (let x = 0; x < w.map.w; x++) {
          if (w.map.rooms[y]![x] !== "hall") continue;
          const d = Math.abs(x - start.x) + Math.abs(y - start.y);
          if (d > best) {
            best = d;
            at = { x, y };
          }
        }
      expect(mariaStart).toEqual(at);
      expect(w.items.some((i) => i.loc.at === "tile" && i.loc.pos.x === mariaStart.x && i.loc.pos.y === mariaStart.y)).toBe(false);
    }
  });

  it("is deterministic per seed", () => {
    expect(JSON.stringify(generateWorld(4242))).toBe(JSON.stringify(generateWorld(4242)));
  });
});

describe(`8.1 mapgen shape and decor (${SEEDS} seeds)`, () => {
  const at = (w: World, x: number, y: number) => w.map.tiles[y]?.[x];
  const roomAt = (w: World, x: number, y: number) => w.map.rooms[y]?.[x];
  const passable = (t: string | undefined) => t !== undefined && t !== "wall";

  it(`every room is at least ${MIN_ROOM}x${MIN_ROOM}: each of its tiles lies on a run of ${MIN_ROOM} room tiles across and down`, () => {
    for (const { w } of worlds)
      for (let y = 0; y < w.map.h; y++)
        for (let x = 0; x < w.map.w; x++) {
          const r = roomAt(w, x, y)!;
          if (r === "corridor" || at(w, x, y) === "wall") continue;
          const run = (dx: number, dy: number) => {
            let n = 1;
            for (let k = 1; roomAt(w, x + dx * k, y + dy * k) === r && at(w, x + dx * k, y + dy * k) !== "wall"; k++) n++;
            for (let k = 1; roomAt(w, x - dx * k, y - dy * k) === r && at(w, x - dx * k, y - dy * k) !== "wall"; k++) n++;
            return n;
          };
          expect(run(1, 0)).toBeGreaterThanOrEqual(MIN_ROOM);
          expect(run(0, 1)).toBeGreaterThanOrEqual(MIN_ROOM);
        }
  });

  it("at least one room is L-shaped, and the hall is the largest room and a rectangle", () => {
    for (const { w } of worlds) {
      const cells = new Map<string, { x: number; y: number }[]>();
      for (let y = 0; y < w.map.h; y++)
        for (let x = 0; x < w.map.w; x++) {
          const r = roomAt(w, x, y)!;
          if (r !== "corridor" && at(w, x, y) !== "wall") cells.set(r, [...(cells.get(r) ?? []), { x, y }]);
        }
      const shape = [...cells].map(([r, ps]) => {
        const xs = ps.map((p) => p.x);
        const ys = ps.map((p) => p.y);
        const box = (Math.max(...xs) - Math.min(...xs) + 1) * (Math.max(...ys) - Math.min(...ys) + 1);
        return { r, n: ps.length, rect: box === ps.length };
      });
      expect(shape.filter((x) => !x.rect).length).toBeGreaterThanOrEqual(1);
      const hall = shape.find((x) => x.r === "hall")!;
      expect(hall.rect).toBe(true);
      for (const x of shape) if (x.r !== "hall") expect(x.n).toBeLessThan(hall.n);
    }
  });

  it("corridors are one tile wide, have no dead ends, and never run straight more than 8 tiles without reaching a room", () => {
    for (const { w } of worlds) {
      for (let y = 0; y < w.map.h; y++)
        for (let x = 0; x < w.map.w; x++) {
          if (roomAt(w, x, y) !== "corridor" || at(w, x, y) !== "floor") continue;
          const n = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => passable(at(w, x + dx!, y + dy!))).length;
          expect(n, `dead end at ${x},${y}`).toBeGreaterThanOrEqual(2);
          // One tile wide: no 2x2 block of corridor floor.
          const c = (a: number, b: number) => roomAt(w, a, b) === "corridor" && at(w, a, b) === "floor";
          expect(c(x + 1, y) && c(x, y + 1) && c(x + 1, y + 1)).toBe(false);
        }
      // Straight runs between openings (tiles beside a door) are at most MAX_CORRIDOR_RUN.
      const opens = (x: number, y: number) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => ["door", "door_locked"].includes(at(w, x + dx!, y + dy!) ?? ""));
      for (const [dx, dy] of [[1, 0], [0, 1]] as const)
        for (let y = 0; y < w.map.h; y++)
          for (let x = 0; x < w.map.w; x++) {
            let run = 0;
            for (let k = 0; ; k++) {
              const px = x + dx * k;
              const py = y + dy * k;
              if (roomAt(w, px, py) !== "corridor" || at(w, px, py) !== "floor") break;
              run = opens(px, py) ? 0 : run + 1;
              expect(run).toBeLessThanOrEqual(MAX_CORRIDOR_RUN);
            }
          }
    }
  });

  it("decor: 1 to 3 props per room, from that room's list, on free floor away from doors", () => {
    for (const { w } of worlds) {
      const per = new Map<string, number>();
      const taken = new Set<string>([`${w.map.start.x},${w.map.start.y}`, `${w.map.mariaStart.x},${w.map.mariaStart.y}`, ...w.fixtures.map((f) => `${f.pos.x},${f.pos.y}`), ...w.items.flatMap((i) => (i.loc.at === "tile" ? [`${i.loc.pos.x},${i.loc.pos.y}`] : []))]);
      const seen = new Set<string>();
      for (const d of w.map.decor) {
        const k = `${d.pos.x},${d.pos.y}`;
        expect(at(w, d.pos.x, d.pos.y)).toBe("floor");
        expect(taken.has(k) || seen.has(k)).toBe(false);
        seen.add(k);
        const r = roomAt(w, d.pos.x, d.pos.y)!;
        expect(r).not.toBe("corridor");
        expect(ROOM_DECOR[r as keyof typeof ROOM_DECOR]).toContain(d.kind);
        per.set(r, (per.get(r) ?? 0) + 1);
      }
      for (const r of w.map.roomList) {
        expect(per.get(r) ?? 0).toBeGreaterThanOrEqual(1);
        expect(per.get(r) ?? 0).toBeLessThanOrEqual(3);
      }
    }
  });
});

