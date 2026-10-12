/**
 * The arena camera as plain math, so it can be tested without a canvas (SPEC 8.1). Two views: the whole house, or
 * following you up close. With no choice made, the house shows when it fits at 56 px a tile and the camera follows
 * you otherwise. Neither view ever leaves an empty band inside the frame: on an axis where the house is bigger than
 * the frame it fills it edge to edge, and on an axis where it is smaller it sits in the middle.
 */
export type CameraChoice = "follow" | "house";

export interface CameraInput {
  /** The frame, in CSS pixels. */
  sw: number;
  sh: number;
  /** The map, in tiles. */
  w: number;
  h: number;
  /** World units per tile. */
  tile: number;
  /** Your feet, in world units. */
  you: { x: number; y: number };
  choice: CameraChoice | null;
}

export interface CameraOut {
  x: number;
  y: number;
  s: number;
  /** The view on screen. */
  mode: CameraChoice;
  /** Whether the other view would look any different (if not, the toggle is hidden). */
  toggle: boolean;
}

export const MIN_PX_PER_TILE = 56;
/** Wall caps rise this many tiles above row 0. */
export const TOP_MARGIN = 0.4;
/** The whole house is never drawn larger than this. */
const MAX_HOUSE_SCALE = 1.4;

/** One axis: center the span if it fits, otherwise aim at `target` and clamp so the span covers the frame. */
export function axis(screen: number, lo: number, hi: number, s: number, target: number | null): number {
  const span = (hi - lo) * s;
  if (target === null || span <= screen) return (screen - span) / 2 - lo * s;
  const want = screen / 2 - target * s;
  return Math.min(-lo * s, Math.max(screen - hi * s, want));
}

/** Follow scale: about nine tiles tall, never under 56 px a tile, never over 1.1. */
export function followScale(sh: number, tile: number): number {
  return Math.max(MIN_PX_PER_TILE / tile, Math.min(1.1, sh / (9 * tile)));
}

export function camera(i: CameraInput): CameraOut {
  const sw = Math.max(1, i.sw);
  const sh = Math.max(1, i.sh);
  const top = -TOP_MARGIN * i.tile;
  const W = i.w * i.tile;
  const bottom = i.h * i.tile;
  const fit = Math.min(sw / W, sh / (bottom - top));
  const fits = fit >= MIN_PX_PER_TILE / i.tile;
  const fs = followScale(sh, i.tile);
  // Following shows something different only when the house overflows the frame at the follow scale.
  const toggle = W * fs > sw + 0.5 || (bottom - top) * fs > sh + 0.5;
  const mode: CameraChoice = !toggle ? "house" : (i.choice ?? (fits ? "house" : "follow"));
  if (mode === "house") {
    const s = Math.min(fit, MAX_HOUSE_SCALE);
    return { x: axis(sw, 0, W, s, null), y: axis(sh, top, bottom, s, null), s, mode, toggle };
  }
  const target = { x: i.you.x, y: i.you.y - i.tile * 0.5 };
  return { x: axis(sw, 0, W, fs, target.x), y: axis(sh, top, bottom, fs, target.y), s: fs, mode, toggle };
}

const KEY = "bm.camera";

/** The camera choice, kept for this browser session. */
export function loadCameraChoice(): CameraChoice | null {
  try {
    const v = sessionStorage.getItem(KEY);
    return v === "follow" || v === "house" ? v : null;
  } catch {
    return null;
  }
}

export function saveCameraChoice(c: CameraChoice): void {
  try {
    sessionStorage.setItem(KEY, c);
  } catch {
    /* storage blocked: the choice lasts until reload */
  }
}
