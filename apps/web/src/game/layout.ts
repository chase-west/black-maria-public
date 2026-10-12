import type { Tier } from "@blackmaria/protocol";
import type { Caption } from "./view.js";

/**
 * How a wall tile is drawn (SPEC 8.1): left out when no floor touches it (solid mass, so the backdrop shows); half a
 * tile thick when it stands between floor on both sides; otherwise a full tile with its face.
 */
export type WallSpan = "none" | "full" | "vertical" | "horizontal";

export function wallSpan(tiles: readonly (readonly string[])[], x: number, y: number): WallSpan {
  const open = (tx: number, ty: number): boolean => {
    const t = tiles[ty]?.[tx];
    return t !== undefined && t !== "wall";
  };
  let touches = false;
  for (let dy = -1; dy <= 1 && !touches; dy++) for (let dx = -1; dx <= 1 && !touches; dx++) if ((dx || dy) && open(x + dx, y + dy)) touches = true;
  if (!touches) return "none";
  if (open(x - 1, y) && open(x + 1, y)) return "vertical";
  if (open(x, y - 1) && open(x, y + 1)) return "horizontal";
  return "full";
}

/**
 * The part of an outer wall tile that is drawn, as fractions of the tile: the halves that face floor. A wall with floor
 * on one side only is half a tile thick on that side, a room's corner is a quarter, so two rooms back to back never
 * make a slab of solid wall.
 */
export function wallCover(tiles: readonly (readonly string[])[], x: number, y: number): { x0: number; x1: number; y0: number; y1: number } {
  const open = (tx: number, ty: number): boolean => {
    const t = tiles[ty]?.[tx];
    return t !== undefined && t !== "wall";
  };
  const any = (pts: [number, number][]) => pts.some(([dx, dy]) => open(x + dx, y + dy));
  const left = any([[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1]]);
  const right = any([[1, -1], [1, 0], [1, 1], [0, -1], [0, 1]]);
  const top = any([[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0]]);
  const bottom = any([[-1, 1], [0, 1], [1, 1], [-1, 0], [1, 0]]);
  return { x0: left ? 0 : 0.5, x1: right ? 1 : 0.5, y0: top ? 0 : 0.5, y1: bottom ? 1 : 0.5 };
}

/** How long a caption stays over the arena, in ticks. */
export const TICKER_TICKS = 14;

/**
 * The lines over the arena: the newest moments that involve a body (at most three, from the last few ticks); when
 * nothing involving a body happened lately, the single newest plain line from the last four ticks.
 */
export function tickerLines(captions: readonly Caption[], tick: number): Caption[] {
  const recent = captions.filter((c) => tick - c.tick <= TICKER_TICKS && c.tone !== "plain").slice(-3);
  return recent.length ? recent : captions.filter((c) => tick - c.tick <= 4).slice(-1);
}

/** For the results reel: each tier's best match, by margin, then by your score. */
export function bestByTier<M extends { tier: Tier; scores: { you: number; maria: number } | null }>(matches: readonly M[]): Partial<Record<Tier, M>> {
  const out: Partial<Record<Tier, M>> = {};
  for (const m of matches) {
    if (!m.scores) continue;
    const cur = out[m.tier];
    const margin = (x: M) => (x.scores ? x.scores.you - x.scores.maria : -Infinity);
    if (!cur || margin(m) > margin(cur) || (margin(m) === margin(cur) && m.scores.you > (cur.scores?.you ?? -Infinity))) out[m.tier] = m;
  }
  return out;
}

/**
 * The tilt a card of this width gets (STYLE.md: up to 1.5 degrees either way): the full tilt up to 560 px wide, then
 * less, so a wide card leans by the same few pixels at its edge as a small one instead of looking dropped.
 */
export function tiltFor(deg: number, width: number): number {
  return width <= 560 ? deg : (deg * 560) / width;
}

/** Where the reveal goes in the reviewer's timeline (v6.3): before the first match played with the change, or after the last. */
export function revealIndex(entries: { with_change?: boolean }[], revealed: boolean): number | null {
  if (!revealed) return null;
  const i = entries.findIndex((e) => e.with_change);
  return i < 0 ? entries.length : i;
}

/** How long a newly posted errand wears the `sticker_new` mark on the board (v6.3). */
export const NEW_TICKS = 10;
/** An open errand posted in the last `NEW_TICKS` ticks. */
export function isNewErrand(e: { posted: number; state: string }, tick: number): boolean {
  return e.state === "open" && tick >= e.posted && tick - e.posted < NEW_TICKS;
}

/** The reviewer's ranking marks (v6.3): the three best composites get `ui_rank_1` to `ui_rank_3`; ties share a mark. */
export function rankMarks(rows: { token: string; composite: number | null }[]): Map<string, 1 | 2 | 3> {
  const scores = [...new Set(rows.map((r) => r.composite).filter((c): c is number => c !== null && c > 0))].sort((a, b) => b - a).slice(0, 3);
  const out = new Map<string, 1 | 2 | 3>();
  for (const r of rows) {
    const i = r.composite === null ? -1 : scores.indexOf(r.composite);
    if (i >= 0) out.set(r.token, (i + 1) as 1 | 2 | 3);
  }
  return out;
}
