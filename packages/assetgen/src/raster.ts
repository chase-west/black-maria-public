import { PNG } from "pngjs";
import { RGB, type ColorName } from "@blackmaria/style";
import { GLYPH_H, GLYPH_W, glyph } from "./font.js";
import type { Sdf } from "./sdf.js";

/**
 * A tiny palette-only rasterizer. No antialiasing, so every opaque pixel
 * is exactly one of the seven palette colors.
 */
export class Canvas {
  readonly data: Uint8Array;
  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.data = new Uint8Array(w * h * 4);
  }

  set(x: number, y: number, c: ColorName): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    const [r, g, b] = RGB[c];
    this.data[i] = r;
    this.data[i + 1] = g;
    this.data[i + 2] = b;
    this.data[i + 3] = 255;
  }

  get(x: number, y: number): [number, number, number, number] {
    const i = (y * this.w + x) * 4;
    return [this.data[i]!, this.data[i + 1]!, this.data[i + 2]!, this.data[i + 3]!];
  }

  fill(c: ColorName): void {
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) this.set(x, y, c);
  }

  /** Paint a shape: outline band in `ink`, interior in `fill` (null leaves interior untouched). */
  shape(f: Sdf, fill: ColorName | null, outline = 0, ink: ColorName = "cocoa"): void {
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const d = f(x + 0.5, y + 0.5);
        if (d <= 0 && (outline === 0 || d <= -outline)) {
          if (fill) this.set(x, y, fill);
        } else if (outline > 0 && d <= 0) {
          this.set(x, y, ink);
        }
      }
    }
  }

  /** Hard offset shadow: paints `f` shifted by (dx, dy) in cocoa, only where transparent. */
  shadow(f: Sdf, dx: number, dy: number, c: ColorName = "cocoa"): void {
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (f(x + 0.5 - dx, y + 0.5 - dy) <= 0 && this.data[(y * this.w + x) * 4 + 3] === 0) this.set(x, y, c);
      }
    }
  }

  textWidth(s: string, scale: number): number {
    return s.length * (GLYPH_W + 1) * scale - scale;
  }

  text(s: string, x: number, y: number, scale: number, c: ColorName = "cocoa"): void {
    let cx = Math.round(x);
    const cy = Math.round(y);
    for (const ch of s) {
      const g = glyph(ch);
      for (let gy = 0; gy < GLYPH_H; gy++)
        for (let gx = 0; gx < GLYPH_W; gx++)
          if (g[gy]![gx]) for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) this.set(cx + gx * scale + sx, cy + gy * scale + sy, c);
      cx += (GLYPH_W + 1) * scale;
    }
  }

  /** Text wrapped to fit `maxW`, centered at (cx, cy). Breaks on underscores. */
  label(s: string, cx: number, cy: number, maxW: number, scale: number, c: ColorName = "cocoa", bg?: ColorName, bottom = false): void {
    const words = s.toUpperCase().split("_");
    const lines: string[] = [];
    let cur = "";
    for (const w of words) {
      const cand = cur ? `${cur}_${w}` : w;
      if (this.textWidth(cand, scale) > maxW && cur) {
        lines.push(cur);
        cur = w;
      } else cur = cand;
    }
    if (cur) lines.push(cur);
    let sc = scale;
    while (sc > 1 && lines.some((l) => this.textWidth(l, sc) > maxW)) sc--;
    const lh = (GLYPH_H + 2) * sc;
    const total = lines.length * lh - 2 * sc;
    lines.forEach((l, i) => {
      const tw = this.textWidth(l, sc);
      const tx = cx - tw / 2;
      const ty = (bottom ? cy - total : cy - total / 2) + i * lh;
      if (bg) for (let yy = -sc; yy < GLYPH_H * sc + sc; yy++) for (let xx = -sc; xx < tw + sc; xx++) this.set(Math.round(tx) + xx, Math.round(ty) + yy, bg);
      this.text(l, tx, ty, sc, c);
    });
  }

  /** Risograph grain: sparse dots in `c`, only on opaque pixels of color `on`. */
  grain(density: number, c: ColorName, on: ColorName, seed: number): void {
    let s = seed >>> 0 || 1;
    const [or, og, ob] = RGB[on];
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        s ^= s << 13;
        s ^= s >>> 17;
        s ^= s << 5;
        const r = (s >>> 0) / 4294967296;
        if (r < density) {
          const [pr, pg, pb, pa] = this.get(x, y);
          if (pa === 255 && pr === or && pg === og && pb === ob) this.set(x, y, c);
        }
      }
    }
  }

  png(): Buffer {
    const png = new PNG({ width: this.w, height: this.h });
    png.data = Buffer.from(this.data);
    return PNG.sync.write(png);
  }
}
