import type { Dir, Intent } from "@blackmaria/protocol";

export const WAIT: Intent = Object.freeze({ kind: "WAIT" }) as Intent;

const DIRS: ReadonlySet<string> = new Set(["N", "E", "S", "W"]);

/** Coerce anything into a valid move. Missing or malformed input becomes WAIT (SPEC 3.4). */
export function normalizeIntent(x: unknown): Intent {
  if (typeof x !== "object" || x === null) return { kind: "WAIT" };
  const o = x as Record<string, unknown>;
  switch (o.kind) {
    case "MOVE":
      return typeof o.dir === "string" && DIRS.has(o.dir) ? { kind: "MOVE", dir: o.dir as Dir } : { kind: "WAIT" };
    case "WAIT":
      return { kind: "WAIT" };
    case "TAKE":
      return { kind: "TAKE" };
    case "SNATCH":
      return { kind: "SNATCH" };
    case "DROP":
    case "USE":
      return typeof o.item === "string" && o.item.length > 0 && o.item.length <= 64 ? { kind: o.kind, item: o.item } : { kind: "WAIT" };
    default:
      return { kind: "WAIT" };
  }
}

export const DELTA: Record<Dir, { x: number; y: number }> = {
  N: { x: 0, y: -1 },
  E: { x: 1, y: 0 },
  S: { x: 0, y: 1 },
  W: { x: -1, y: 0 },
};

/** Item ids are `i<n>`; order them numerically. */
export function compareItemIds(a: string, b: string): number {
  const na = Number(a.slice(1));
  const nb = Number(b.slice(1));
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Fixture ids are `f<n>`; order them numerically. */
export const compareFixtureIds = compareItemIds;
