import type { Errand, FixtureKind, Intent, ItemKind, Pos, RoomName, RoomOrCorridor, TileKind } from "@blackmaria/protocol";
import { RULESET_VERSION, canonical, createRng, makeParams, sha256Hex, step, type Body, type Intents, type Item, type MatchState, type Params, type Rng } from "../src/index.js";

export const W: Intent = { kind: "WAIT" };
export const T: Intent = { kind: "TAKE" };
export const S: Intent = { kind: "SNATCH" };
export const M = (dir: "N" | "E" | "S" | "W"): Intent => ({ kind: "MOVE", dir });
export const DROP = (item: string): Intent => ({ kind: "DROP", item });
export const USE = (item: string): Intent => ({ kind: "USE", item });

/** An errand draft: everything but the id and state, which `build` fills in. */
export type ErrandDraft =
  | { type: "deliver"; item_kind: ItemKind; fixture: string; value?: number; posted?: number; expires?: number }
  | { type: "visit"; room: RoomName; value?: number; posted?: number; expires?: number }
  | { type: "carry"; item_kind: ItemKind; carry_ticks: number; value?: number; posted?: number; expires?: number };

export interface BuildOpts {
  /** Room letters per tile, mapped through `legend`. Defaults to: every non-wall tile is the hall. */
  rooms?: string[];
  legend?: Record<string, RoomOrCorridor>;
  items?: { id: string; kind: ItemKind; pos?: Pos; inSafe?: string; heldBy?: Body }[];
  fixtures?: { id: string; kind: FixtureKind; pos: Pos; room?: RoomName }[];
  safeOpen?: boolean;
  sigils?: { pos: Pos; owner: Body; cooldown?: number }[];
  board?: ErrandDraft[];
  energy?: { you?: number; maria?: number };
  seed?: number;
  tick?: number;
  params?: Partial<Params>;
}

const CH: Record<string, TileKind> = { "#": "wall", ".": "floor", "@": "floor", M: "floor", "+": "door", L: "door_locked", $: "sigil" };

/**
 * Build a hand-made state from an ASCII map, for rule tests. `@` is your body, `M` is Maria's (on `@` if absent).
 * The board starts with exactly the drafts given and nothing is posted unless a posting tick comes round.
 */
export function build(ascii: string[], o: BuildOpts = {}): MatchState {
  const h = ascii.length;
  const w = ascii[0]!.length;
  let you: Pos = { x: 1, y: 1 };
  let maria: Pos | null = null;
  const tiles: TileKind[][] = ascii.map((row, y) =>
    [...row].map((c, x) => {
      if (c === "@") you = { x, y };
      if (c === "M") maria = { x, y };
      const k = CH[c];
      if (!k) throw new Error(`bad map char ${c}`);
      return k;
    }),
  );
  const mariaPos: Pos = maria ?? you;
  const legend: Record<string, RoomOrCorridor> = { h: "hall", c: "corridor", l: "library", v: "vault", k: "kitchen", s: "study", g: "gallery", ...(o.legend ?? {}) };
  const rooms: RoomOrCorridor[][] = o.rooms
    ? o.rooms.map((row) => [...row].map((c) => legend[c] ?? "corridor"))
    : tiles.map((row) => row.map((t) => (t === "wall" || t === "door" || t === "door_locked" ? "corridor" : "hall")));
  const roomList = [...new Set(rooms.flat().filter((r): r is RoomName => r !== "corridor"))];
  const lockedAt = tiles.flatMap((row, y) => row.map((t, x) => (t === "door_locked" ? { x, y } : null))).find((p) => p) ?? { x: 0, y: 0 };
  const fixtures = (o.fixtures ?? []).map((f) => ({ id: f.id, kind: f.kind, pos: f.pos, room: f.room ?? "hall" }));
  const items: Item[] = (o.items ?? []).map((i) => ({
    id: i.id,
    kind: i.kind,
    loc: i.inSafe ? { at: "safe", fixture: i.inSafe } : i.heldBy ? { at: "held", by: i.heldBy } : { at: "tile", pos: i.pos ?? you },
  }));
  const safeFx = fixtures.find((f) => f.kind === "safe");
  const params = makeParams({ postInterval: 255, ...o.params });
  const board: Errand[] = (o.board ?? []).map((d, id) => {
    const value = d.value ?? (d.type === "visit" ? 1 : d.type === "carry" ? ({ 8: 2, 12: 3, 16: 4 } as Record<number, number>)[d.carry_ticks]! : 3);
    return { ...d, id, value, posted: d.posted ?? 0, expires: d.expires ?? 1000, state: "open" } as Errand;
  });
  const held = (b: Body) => items.filter((i) => i.loc.at === "held" && i.loc.by === b).map((i) => i.id);
  return {
    ruleset: RULESET_VERSION,
    seed: o.seed ?? 1,
    params,
    tick: o.tick ?? 1,
    map: { w, h, tiles, rooms, roomList, start: you, mariaStart: mariaPos, vaultDoor: lockedAt, decor: [] },
    mapHash: sha256Hex(canonical({ tiles, rooms })),
    fixtures,
    items,
    safe: safeFx ? { fixture: safeFx.id, open: o.safeOpen ?? false } : null,
    bodies: {
      you: { pos: { ...you }, inventory: held("you"), energy: o.energy?.you ?? 40, score: 0, streak: {} },
      maria: { pos: { ...mariaPos }, inventory: held("maria"), energy: o.energy?.maria ?? 40, score: 0, streak: {} },
    },
    board,
    doorsOpened: [],
    sigils: (o.sigils ?? []).map((g) => ({ pos: g.pos, owner: g.owner, cooldown: g.cooldown ?? 0, room: "library" })),
    pendingGrab: null,
    last: null,
    done: false,
  };
}

/** A small open room. You are in the middle, Maria two tiles east. */
export const ROOM = ["#######", "#.....#", "#.....#", "#..@.M#", "#.....#", "#.....#", "#######"];

export function run(s: MatchState, seq: [Intent, Intent][], rng: Rng = createRng(s.seed)): MatchState {
  for (const [you, maria] of seq) s = step(s, { you, maria }, rng);
  return s;
}

export function tick(s: MatchState, you: Intent, maria: Intent, rng: Rng = createRng(s.seed)): MatchState {
  return step(s, { you, maria } as Intents, rng);
}

export function evKinds(s: MatchState): string[] {
  return (s.last?.events ?? []).map((e) => e.kind);
}

/** A seed whose tie coin at `tick` lands on the given body (for tie tests with equal energy). */
export function seedWithCoin(tick: number, want: Body): number {
  for (let seed = 1; ; seed++) if (((createRng(seed).u32(tick, 1) & 1) === 0 ? "you" : "maria") === want) return seed;
}
