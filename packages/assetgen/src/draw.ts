import type { ColorName } from "@blackmaria/style";
import { Canvas } from "./raster.js";
import { box, circle, ellipse, intersect, polygon, segment, spade, subtract, union, wobble } from "./sdf.js";
import type { CatalogEntry } from "@blackmaria/style";

/** Deterministic per-name seed. */
export function nameSeed(name: string): number {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

type Painter = (c: Canvas, u: number, o: number) => void;


// ---------------------------------------------------------------------------
// Floor tiles: quiet, seamless, low-contrast. Patterns are periodic in the tile size.

function checker(c: Canvas, n: number, a: ColorName, b: ColorName, joint: number): void {
  const cell = c.w / n;
  for (let y = 0; y < c.h; y++)
    for (let x = 0; x < c.w; x++) {
      const cx = Math.floor(x / cell);
      const cy = Math.floor(y / cell);
      const lx = x - cx * cell;
      const ly = y - cy * cell;
      if (lx < joint || ly < joint) c.set(x, y, "cocoa");
      else c.set(x, y, (cx + cy) % 2 === 0 ? a : b);
    }
}

function tilePainter(room: string): Painter {
  return (c, u) => {
    const j = Math.max(1, Math.round(u * 1.5));
    switch (room) {
      case "hall":
      case "hall_mark":
        checker(c, 4, "cream", "mustard", j);
        if (room === "hall_mark") {
          const s = spade(c.w / 2, c.h / 2, c.w * 0.3);
          c.shape(s, "cocoa", Math.max(2, Math.round(u * 6)), "mustard");
        }
        break;
      case "kitchen":
        checker(c, 8, "cream", "coral", j);
        break;
      case "library": {
        // Herringbone: diagonal planks alternating direction per column band.
        const p = c.w / 8;
        for (let y = 0; y < c.h; y++)
          for (let x = 0; x < c.w; x++) {
            const band = Math.floor(x / p) % 2;
            const t = band === 0 ? x + y : x - y + c.w;
            const seam = ((t % p) + p) % p < j || x % p < j;
            c.set(x, y, seam ? "cocoa" : "mustard");
          }
        break;
      }
      case "study": {
        const p = c.h / 4;
        for (let y = 0; y < c.h; y++)
          for (let x = 0; x < c.w; x++) {
            const row = Math.floor(y / p);
            const off = (row % 2) * (c.w / 2);
            const seamV = (x + off) % (c.w / 1) < j;
            const seamH = y % p < j;
            const grainLine = Math.abs(((y % p) - p / 2 + Math.sin((x / c.w) * Math.PI * 4 + row) * u * 4)) < u * 0.6;
            c.set(x, y, seamH || seamV ? "cocoa" : grainLine ? "mustard" : "cream");
          }
        break;
      }
      case "chapel":
      case "corridor": {
        const n = 3;
        const cell = c.w / n;
        for (let y = 0; y < c.h; y++)
          for (let x = 0; x < c.w; x++) {
            const cy = Math.floor(y / cell);
            const off = (cy % 2) * (cell / 2);
            const cx = Math.floor((x + off) / cell) % n;
            const lx = (x + off) % cell;
            const ly = y % cell;
            const joint = lx < j || ly < j;
            const tealStone = room === "corridor" && (cx + cy * 2) % 5 === 1;
            c.set(x, y, joint ? "cocoa" : tealStone ? "teal" : "cream");
          }
        if (room === "chapel") c.grain(0.004, "moss", "cream", nameSeed(room));
        break;
      }
      case "cellar": {
        const bh = c.h / 6;
        const bw = c.w / 3;
        for (let y = 0; y < c.h; y++)
          for (let x = 0; x < c.w; x++) {
            const row = Math.floor(y / bh);
            const off = (row % 2) * (bw / 2);
            const joint = y % bh < j || (x + off) % bw < j;
            c.set(x, y, joint ? "cocoa" : "teal");
          }
        break;
      }
      case "conservatory": {
        const p = c.w / 4;
        for (let y = 0; y < c.h; y++)
          for (let x = 0; x < c.w; x++) {
            const lx = (x % p) - p / 2;
            const ly = (y % p) - p / 2;
            const d = Math.abs(lx) + Math.abs(ly);
            const edge = Math.abs(d - p / 2) < j;
            const star = d < p * 0.12;
            c.set(x, y, edge ? "cocoa" : star ? "mustard" : d < p / 2 ? "moss" : "cream");
          }
        break;
      }
      case "gallery": {
        c.fill("teal");
        const b = Math.max(2, Math.round(u * 6));
        for (let y = 0; y < c.h; y++)
          for (let x = 0; x < c.w; x++) {
            const e = Math.min(x, y, c.w - 1 - x, c.h - 1 - y);
            if (e < j) c.set(x, y, "cocoa");
            else if (e >= b && e < b + j) c.set(x, y, "mustard");
          }
        break;
      }
      case "nursery": {
        const p = c.h / 4;
        for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) c.set(x, y, y % p < j ? "cocoa" : "cream");
        const dots: [number, number, ColorName][] = [
          [0.2, 0.15, "coral"],
          [0.7, 0.35, "teal"],
          [0.4, 0.62, "coral"],
          [0.85, 0.85, "teal"],
          [0.1, 0.88, "teal"],
        ];
        for (const [dx, dy, col] of dots) c.shape(circle(dx * c.w, dy * c.h, u * 7), col, 0);
        break;
      }
      case "vault": {
        c.fill("cocoa");
        const p = c.w / 2;
        for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) if (x % p < j || y % p < j) c.set(x, y, "teal");
        for (const [rx, ry] of [
          [0.12, 0.12],
          [0.38, 0.12],
          [0.12, 0.38],
          [0.38, 0.38],
          [0.62, 0.62],
          [0.88, 0.62],
          [0.62, 0.88],
          [0.88, 0.88],
          [0.62, 0.12],
          [0.88, 0.12],
          [0.12, 0.62],
          [0.12, 0.88],
          [0.38, 0.62],
          [0.38, 0.88],
          [0.62, 0.38],
          [0.88, 0.38],
        ] as const)
          c.shape(circle(rx * c.w, ry * c.h, Math.max(1.5, u * 4)), "mustard", 0);
        break;
      }
      default:
        c.fill("cream");
    }
  };
}

// ---------------------------------------------------------------------------
// Walls: top cap in the upper third, front face below.

function wallPainter(stone: boolean): Painter {
  return (c, u) => {
    const j = Math.max(1, Math.round(u * 2));
    const cap = Math.round(c.h / 3);
    for (let y = 0; y < c.h; y++)
      for (let x = 0; x < c.w; x++) {
        if (y < cap) c.set(x, y, y > cap - j * 2 ? "cocoa" : "mustard");
        else c.set(x, y, "teal");
      }
    if (stone) {
      const bh = (c.h - cap) / 3;
      const bw = c.w / 2;
      for (let y = cap; y < c.h; y++)
        for (let x = 0; x < c.w; x++) {
          const row = Math.floor((y - cap) / bh);
          const off = (row % 2) * (bw / 2);
          if ((y - cap) % bh < j || (x + off) % bw < j) c.set(x, y, "cocoa");
        }
    } else {
      // Tiny framed picture and a wobbly crack.
      c.shape(box(c.w * 0.36, c.h * 0.48, c.w * 0.64, c.h * 0.72, u * 3), "cream", Math.max(1, Math.round(u * 3)));
      c.shape(circle(c.w * 0.5, c.h * 0.6, u * 6), "coral", 0);
      c.shape(segment(c.w * 0.12, c.h * 0.8, c.w * 0.2, c.h * 0.9, Math.max(0.6, u * 1.2)), "cocoa", 0);
    }
    for (let y = 0; y < c.h; y++) if (y % 1 === 0) for (const yy of [0, c.h - 1]) c.set(0, yy, "cocoa");
    for (let x = 0; x < c.w; x++) {
      for (let k = 0; k < j; k++) {
        c.set(x, k, "cocoa");
        c.set(x, c.h - 1 - k, "cocoa");
      }
    }
  };
}

// ---------------------------------------------------------------------------

function blobBody(c: Canvas, u: number, o: number, fill: ColorName, scale = 0.8): void {
  const w = c.w * scale;
  const f = wobble(box((c.w - w) / 2, c.h * 0.1, (c.w + w) / 2, c.h * 0.1 + w * 0.95, u * 22), u * 1.5, 0.09 / u);
  c.shape(f, fill, o);
}

const fixturePainters: Record<string, Painter> = {
  fireplace: (c, u, o) => {
    c.shape(wobble(box(u * 36, u * 50, u * 220, u * 220, u * 14), u * 1.5, 0.08 / u), "cream", o);
    c.shape(box(u * 28, u * 40, u * 228, u * 70, u * 8), "mustard", o);
    c.shape(box(u * 76, u * 110, u * 180, u * 220, u * 30), "cocoa", 0);
    for (const fx of [100, 128, 156]) c.shape(polygon([[u * fx, u * 140], [u * (fx + 14), u * 205], [u * (fx - 14), u * 205]]), "coral", 0);
  },
  well: (c, u, o) => {
    c.shape(box(u * 50, u * 30, u * 62, u * 170, 0), "cocoa", 0);
    c.shape(box(u * 194, u * 30, u * 206, u * 170, 0), "cocoa", 0);
    c.shape(polygon([[u * 30, u * 60], [u * 128, u * 14], [u * 226, u * 60]]), "coral", o);
    c.shape(wobble(ellipse(u * 128, u * 180, u * 92, u * 52), u * 1.5, 0.08 / u), "cream", o);
    c.shape(ellipse(u * 128, u * 168, u * 66, u * 26), "teal", o);
  },
  safe_closed: (c, u, o) => {
    c.shape(box(u * 60, u * 214, u * 84, u * 236, u * 6), "cocoa", 0);
    c.shape(box(u * 172, u * 214, u * 196, u * 236, u * 6), "cocoa", 0);
    c.shape(wobble(box(u * 40, u * 50, u * 216, u * 222, u * 20), u * 1.2, 0.08 / u), "teal", o);
    c.shape(circle(u * 128, u * 136, u * 38), "mustard", o);
    c.shape(segment(u * 128, u * 136, u * 128, u * 110, u * 5), "cocoa", 0);
  },
  safe_open: (c, u, o) => {
    c.shape(box(u * 60, u * 214, u * 84, u * 236, u * 6), "cocoa", 0);
    c.shape(box(u * 172, u * 214, u * 196, u * 236, u * 6), "cocoa", 0);
    c.shape(wobble(box(u * 40, u * 50, u * 216, u * 222, u * 20), u * 1.2, 0.08 / u), "teal", o);
    c.shape(box(u * 64, u * 74, u * 192, u * 198, u * 10), "cream", o);
    c.shape(polygon([[u * 192, u * 74], [u * 246, u * 54], [u * 246, u * 218], [u * 192, u * 198]]), "teal", o);
  },
  altar: (c, u, o) => {
    c.shape(box(u * 80, u * 30, u * 98, u * 110, u * 4), "cream", o);
    c.shape(box(u * 158, u * 30, u * 176, u * 110, u * 4), "cream", o);
    c.shape(circle(u * 89, u * 22, u * 10), "coral", 0);
    c.shape(circle(u * 167, u * 22, u * 10), "coral", 0);
    c.shape(wobble(box(u * 30, u * 104, u * 226, u * 226, u * 12), u * 1.2, 0.08 / u), "cream", o);
    c.shape(box(u * 30, u * 104, u * 226, u * 150, u * 12), "moss", o);
  },
  piano: (c, u, o) => {
    c.shape(wobble(box(u * 30, u * 50, u * 226, u * 226, u * 18), u * 1.2, 0.08 / u), "cocoa", 0);
    c.shape(box(u * 44, u * 130, u * 212, u * 160, u * 4), "cream", Math.max(1, o / 2));
    for (let k = 0; k < 7; k++) c.shape(box(u * (56 + k * 22), u * 130, u * (64 + k * 22), u * 146, 0), "cocoa", 0);
    c.shape(union(circle(u * 120, u * 30, u * 12), segment(u * 130, u * 30, u * 132, u * 0, u * 3)), "mustard", 0);
  },
  mirror: (c, u, o) => {
    c.shape(segment(u * 128, u * 200, u * 128, u * 236, u * 6), "cocoa", 0);
    c.shape(box(u * 84, u * 226, u * 172, u * 240, u * 6), "cocoa", 0);
    c.shape(wobble(ellipse(u * 128, u * 112, u * 70, u * 98), u * 1.2, 0.08 / u), "mustard", o);
    c.shape(ellipse(u * 128, u * 112, u * 50, u * 76), "teal", o);
  },
  bookcase: (c, u, o) => {
    c.shape(wobble(box(u * 40, u * 20, u * 216, u * 236, u * 12), u * 1.2, 0.08 / u), "cocoa", 0);
    const cols: ColorName[] = ["coral", "teal", "mustard", "cream", "coral", "mustard", "teal"];
    for (let shelf = 0; shelf < 3; shelf++)
      for (let k = 0; k < 6; k++)
        c.shape(box(u * (56 + k * 26), u * (36 + shelf * 66), u * (76 + k * 26), u * (90 + shelf * 66), u * 3), cols[(k + shelf) % cols.length]!, Math.max(1, o / 3));
  },
  bed: (c, u, o) => {
    c.shape(wobble(box(u * 40, u * 20, u * 216, u * 236, u * 18), u * 1.2, 0.08 / u), "cream", o);
    c.shape(box(u * 70, u * 36, u * 186, u * 86, u * 16), "cream", o);
    c.shape(box(u * 40, u * 100, u * 216, u * 236, u * 18), "moss", o);
    c.shape(circle(u * 104, u * 236, u * 12), "cream", o);
    c.shape(circle(u * 152, u * 236, u * 12), "cream", o);
  },
  clock: (c, u, o) => {
    c.shape(wobble(box(u * 70, u * 10, u * 186, u * 240, u * 20), u * 1.2, 0.08 / u), "cocoa", 0);
    c.shape(circle(u * 128, u * 70, u * 44), "cream", o);
    c.shape(circle(u * 112, u * 66, u * 7), "cocoa", 0);
    c.shape(circle(u * 144, u * 66, u * 7), "cocoa", 0);
    c.shape(box(u * 112, u * 140, u * 144, u * 210, u * 14), "mustard", Math.max(1, o / 2));
  },
  font: (c, u, o) => {
    c.shape(box(u * 108, u * 120, u * 148, u * 226, u * 6), "cream", o);
    c.shape(box(u * 76, u * 214, u * 180, u * 240, u * 8), "cream", o);
    c.shape(wobble(ellipse(u * 128, u * 100, u * 96, u * 48), u * 1.2, 0.08 / u), "cream", o);
    c.shape(ellipse(u * 128, u * 94, u * 72, u * 28), "teal", Math.max(1, o / 2));
    c.shape(union(circle(u * 140, u * 86, u * 12), circle(u * 152, u * 78, u * 7)), "mustard", Math.max(1, o / 3));
  },
  stove: (c, u, o) => {
    c.shape(box(u * 172, u * 0, u * 196, u * 70, u * 4), "cocoa", 0);
    c.shape(wobble(box(u * 36, u * 64, u * 220, u * 232, u * 18), u * 1.2, 0.08 / u), "cream", o);
    c.shape(circle(u * 90, u * 100, u * 20), "coral", o);
    c.shape(circle(u * 166, u * 100, u * 20), "coral", o);
    c.shape(box(u * 66, u * 140, u * 190, u * 210, u * 10), "cream", o);
  },
};

const itemPainters: Record<string, Painter> = {
  key: (c, u, o) => {
    c.shape(box(u * 120, u * 120, u * 136, u * 196, u * 4), "mustard", o);
    c.shape(box(u * 128, u * 168, u * 156, u * 180, u * 3), "mustard", o);
    c.shape(spade(u * 128, u * 98, u * 34), "mustard", o);
  },
  letter: (c, u, o) => {
    c.shape(wobble(box(u * 70, u * 92, u * 186, u * 170, u * 6), u, 0.1 / u), "cream", o);
    c.shape(polygon([[u * 72, u * 96], [u * 128, u * 140], [u * 184, u * 96]]), null, Math.max(1, o / 2));
    c.shape(circle(u * 128, u * 138, u * 13), "coral", Math.max(1, o / 2));
  },
  candle: (c, u, o) => {
    c.shape(ellipse(u * 128, u * 182, u * 52, u * 16), "mustard", o);
    c.shape(box(u * 108, u * 100, u * 148, u * 180, u * 6), "cream", o);
    c.shape(wobble(ellipse(u * 128, u * 82, u * 12, u * 20), u, 0.2 / u), "coral", Math.max(1, o / 2));
  },
  locket: (c, u, o) => {
    c.shape(segment(u * 128, u * 76, u * 128, u * 100, u * 3), "cocoa", 0);
    c.shape(wobble(circle(u * 128, u * 138, u * 40), u, 0.1 / u), "mustard", o);
    c.shape(circle(u * 128, u * 138, u * 10), "coral", 0);
  },
  ledger: (c, u, o) => {
    c.shape(wobble(box(u * 78, u * 82, u * 178, u * 186, u * 10), u, 0.1 / u), "cocoa", 0);
    c.shape(box(u * 86, u * 90, u * 92, u * 178, 0), "cream", 0);
    c.shape(box(u * 160, u * 120, u * 188, u * 148, u * 5), "mustard", Math.max(1, o / 2));
  },
  bottle: (c, u, o) => {
    c.shape(box(u * 112, u * 74, u * 144, u * 120, u * 6), "teal", o);
    c.shape(box(u * 114, u * 60, u * 142, u * 82, u * 5), "mustard", Math.max(1, o / 2));
    c.shape(wobble(circle(u * 128, u * 148, u * 42), u, 0.1 / u), "teal", o);
  },
  coin: (c, u, o) => {
    c.shape(wobble(circle(u * 128, u * 134, u * 50), u, 0.1 / u), "mustard", o);
    c.shape(spade(u * 128, u * 132, u * 22), "cocoa", 0);
  },
  ring: (c, u, o) => {
    c.shape(subtract(circle(u * 128, u * 150, u * 40), circle(u * 128, u * 150, u * 24)), "mustard", o);
    c.shape(circle(u * 128, u * 104, u * 20), "coral", o);
  },
  photograph: (c, u, o) => {
    c.shape(wobble(box(u * 76, u * 82, u * 180, u * 186, u * 6), u, 0.1 / u), "cream", o);
    c.shape(box(u * 92, u * 98, u * 164, u * 160, u * 3), "teal", Math.max(1, o / 2));
    c.shape(circle(u * 114, u * 130, u * 12), "cocoa", 0);
    c.shape(circle(u * 142, u * 134, u * 10), "cocoa", 0);
  },
  vial: (c, u, o) => {
    // The brief asks for lilac liquid; the web palette rule reserves lilac for Maria, so placeholders use coral.
    c.shape(box(u * 116, u * 80, u * 140, u * 120, u * 5), "cream", o);
    c.shape(box(u * 116, u * 68, u * 140, u * 86, u * 4), "mustard", Math.max(1, o / 2));
    c.shape(wobble(circle(u * 128, u * 148, u * 34), u, 0.1 / u), "coral", o);
  },
};

function vesselPainter(c: Canvas, u: number, o: number): void {
  c.shape(box(u * 92, u * 196, u * 112, u * 226, u * 8), "cream", o);
  c.shape(box(u * 144, u * 196, u * 164, u * 226, u * 8), "cream", o);
  c.shape(circle(u * 56, u * 150, u * 12), "cream", o);
  c.shape(circle(u * 200, u * 150, u * 12), "cream", o);
  c.shape(wobble(ellipse(u * 128, u * 132, u * 74, u * 88), u * 2, 0.06 / u), "cream", o);
  c.shape(intersect(ellipse(u * 128, u * 132, u * 74, u * 88), box(0, u * 150, c.w, u * 172)), "coral", Math.max(1, o / 2));
  c.shape(box(u * 150, u * 160, u * 172, u * 198, u * 6), "coral", Math.max(1, o / 2));
  c.shape(circle(u * 104, u * 110, u * 9), "cocoa", 0);
  c.shape(circle(u * 152, u * 110, u * 9), "cocoa", 0);
}

function ghost(c: Canvas, u: number, o: number, cx: number, cy: number, s: number, mood: "plain" | "sleepy" | "adept" | "master"): void {
  const k = (v: number) => v * s * u;
  const body = wobble(
    union(ellipse(cx * u, cy * u - k(10), k(70), k(64)), box(cx * u - k(70), cy * u - k(10), cx * u + k(70), cy * u + k(60), k(20))),
    k(3),
    0.07 / u,
  );
  const armL = circle(cx * u - k(78), cy * u + k(14), k(16));
  const armR = mood === "adept" ? circle(cx * u + k(84), cy * u - k(40), k(16)) : circle(cx * u + k(78), cy * u + k(14), k(16));
  c.shape(armL, "lilac", o);
  c.shape(armR, "lilac", o);
  c.shape(body, "lilac", o);
  const eyeY = cy * u - k(20);
  if (mood === "plain") {
    c.shape(circle(cx * u - k(24), eyeY, k(8)), "cocoa", 0);
    c.shape(circle(cx * u + k(24), eyeY, k(8)), "cocoa", 0);
  } else {
    const h = mood === "sleepy" ? 5 : mood === "adept" ? 4 : 2.5;
    c.shape(box(cx * u - k(36), eyeY - k(h), cx * u - k(12), eyeY + k(h), k(h)), "cocoa", 0);
    c.shape(box(cx * u + k(12), eyeY - k(h), cx * u + k(36), eyeY + k(h), k(h)), "cocoa", 0);
  }
  const grinW = mood === "master" ? 40 : mood === "adept" ? 30 : 20;
  c.shape(intersect(ellipse(cx * u, cy * u + k(10), k(grinW), k(16)), box(0, cy * u + k(10), c.w, c.h)), "cocoa", 0);
  c.shape(box(cx * u - k(6), cy * u + k(10), cx * u + k(6), cy * u + k(20), k(2)), "cream", 0);
  if (mood === "master") {
    c.shape(box(cx * u - k(30), cy * u - k(118), cx * u + k(30), cy * u - k(70), k(6)), "coral", o);
    c.shape(box(cx * u - k(46), cy * u - k(78), cx * u + k(46), cy * u - k(64), k(6)), "coral", o);
  }
}

function uiPainter(name: string): Painter {
  return (c, u, o) => {
    const W = c.w;
    const H = c.h;
    switch (name) {
      case "ui_logo_spade":
        ghost(c, u, o, 180, 110, 0.7, "plain");
        c.shape(spade(W * 0.45, H * 0.52, W * 0.34), "cocoa", Math.max(2, o * 1.5), "mustard");
        break;
      case "ui_frame_corner":
        c.shape(union(box(u * 20, u * 20, u * 60, H - u * 30, u * 18), box(u * 20, u * 20, W - u * 30, u * 60, u * 18)), "cocoa", 0);
        c.shape(spade(W - u * 34, u * 40, u * 26), "cocoa", 0);
        c.shape(spade(u * 40, H - u * 34, u * 26), "cocoa", 0);
        break;
      case "ui_divider":
        c.shape(wobble(box(H * 0.2, H * 0.42, W - H * 0.2, H * 0.58, H * 0.08), H * 0.04, 0.05), "cocoa", 0);
        c.shape(spade(W / 2, H / 2, H * 0.42), "cocoa", 0);
        break;
      case "ui_panel_dark":
        c.fill("cream");
        c.grain(0.02, "mustard", "cream", 7);
        break;
      case "ui_note":
      case "ui_note_done":
        c.shadow(box(o, o, W - o * 3, H - o * 3, u * 12), o, o);
        c.shape(box(o, o, W - o * 3, H - o * 3, u * 12), "cream", o);
        c.shape(subtract(box(W * 0.78, 0, W * 0.86, H * 0.3, u * 8), box(W * 0.795, H * 0.03, W * 0.845, H * 0.26, u * 4)), "coral", 0);
        if (name === "ui_note_done") c.shape(union(segment(W * 0.3, H * 0.5, W * 0.45, H * 0.75, H * 0.06), segment(W * 0.45, H * 0.75, W * 0.72, H * 0.22, H * 0.06)), "mustard", Math.max(1, o / 2));
        break;
      case "ui_button":
      case "ui_button_hover": {
        const pill = box(o, o, W - o * 3, H - o * 3, (H - o * 4) / 2);
        c.shadow(pill, o * 1.2, o * 1.2);
        c.shape(pill, name === "ui_button" ? "cream" : "mustard", o);
        break;
      }
      case "ui_meter_frame":
        c.shape(box(H * 0.5, H * 0.15, W - H * 0.5, H * 0.85, H * 0.35), "cream", o);
        c.shape(box(H * 0.9, H * 0.35, W - H * 0.9, H * 0.65, H * 0.15), null, Math.max(1, o / 2));
        c.shape(spade(H * 0.28, H * 0.5, H * 0.24), "cocoa", 0);
        c.shape(spade(W - H * 0.28, H * 0.5, H * 0.24), "cocoa", 0);
        break;
      case "ui_portrait_frame":
        c.shape(subtract(circle(W / 2, H / 2 + u * 6, W * 0.44), circle(W / 2, H / 2 + u * 6, W * 0.34)), "cream", o);
        c.shape(union(circle(W * 0.42, H * 0.1, W * 0.07), circle(W * 0.58, H * 0.1, W * 0.07)), "coral", Math.max(1, o / 2));
        break;
      case "ui_laurel":
        for (let k = 0; k < 7; k++) {
          const a = Math.PI * (0.65 + k * 0.12);
          const r = W * 0.36;
          c.shape(ellipse(W / 2 + Math.cos(a) * r, H / 2 + Math.sin(a) * r * -1 + H * 0.05, W * 0.06, W * 0.035), "moss", Math.max(1, o / 2));
          c.shape(ellipse(W / 2 - Math.cos(a) * r, H / 2 + Math.sin(a) * r * -1 + H * 0.05, W * 0.06, W * 0.035), "moss", Math.max(1, o / 2));
        }
        c.shape(union(polygon([[W * 0.5, H * 0.82], [W * 0.38, H * 0.95], [W * 0.44, H * 0.95]]), polygon([[W * 0.5, H * 0.82], [W * 0.62, H * 0.95], [W * 0.56, H * 0.95]])), "coral", Math.max(1, o / 2));
        break;
      case "ui_rank_1":
      case "ui_rank_2":
      case "ui_rank_3":
        c.shape(spade(W / 2, H / 2, W * 0.4), name === "ui_rank_1" ? "mustard" : name === "ui_rank_2" ? "cream" : "coral", o);
        break;
    }
  };
}

function artPainter(name: string): Painter {
  return (c, u, o) => {
    const W = c.w;
    const H = c.h;
    switch (name) {
      case "art_title": {
        c.fill("teal");
        for (const [sx, sy] of [[0.1, 0.12], [0.3, 0.2], [0.55, 0.08], [0.8, 0.18], [0.9, 0.4], [0.18, 0.4]] as const)
          c.shape(spade(sx * W, sy * H, H * 0.025), "cream", 0);
        c.shape(wobble(ellipse(W * 0.5, H * 1.15, W * 0.7, H * 0.5), H * 0.01, 0.02), "mustard", o);
        c.shape(polygon([[W * 0.36, H * 0.5], [W * 0.5, H * 0.3], [W * 0.64, H * 0.5]]), "coral", o);
        c.shape(wobble(box(W * 0.39, H * 0.48, W * 0.61, H * 0.78, H * 0.02), H * 0.006, 0.05), "cream", o);
        c.shape(box(W * 0.47, H * 0.56, W * 0.53, H * 0.66, H * 0.01), "coral", o);
        c.shape(box(W * 0.56, H * 0.28, W * 0.6, H * 0.42), "cream", o);
        ghost(c, H / 256, o, (W * 0.58) / (H / 256), (H * 0.22) / (H / 256), 0.35, "plain");
        break;
      }
      case "art_arena_bg":
        c.fill("cream");
        c.grain(0.01, "mustard", "cream", 3);
        c.shape(circle(W * 0.1, H * 0.85, H * 0.06), "teal", o);
        c.shape(circle(W * 0.92, H * 0.12, H * 0.04), "mustard", o);
        break;
      case "art_victory":
        c.fill("cream");
        for (let k = 0; k < 24; k++) {
          const x = ((k * 97) % 100) / 100;
          const y = ((k * 53) % 60) / 100;
          c.shape(box(x * W, y * H, x * W + H * 0.03, y * H + H * 0.05, H * 0.008), k % 2 ? "coral" : "mustard", Math.max(1, o / 2));
        }
        c.shape(box(W * 0.38, H * 0.25, W * 0.62, H * 0.95, H * 0.1), null, o * 1.5);
        {
          const sub = new Canvas(Math.round(H * 0.5), Math.round(H * 0.5));
          vesselPainter(sub, sub.w / 256, Math.max(2, Math.round(sub.w / 32)));
          blit(c, sub, Math.round(W / 2 - sub.w / 2), Math.round(H * 0.38));
        }
        break;
      case "art_defeat": {
        c.fill("cream");
        c.shape(box(0, H * 0.75, W, H), "mustard", o);
        const sub = new Canvas(Math.round(H * 0.4), Math.round(H * 0.4));
        vesselPainter(sub, sub.w / 256, Math.max(2, Math.round(sub.w / 32)));
        blit(c, sub, Math.round(W / 2 - sub.w / 2), Math.round(H * 0.5));
        ghost(c, H / 256, o, (W * 0.5) / (H / 256), (H * 0.25) / (H / 256), 0.5, "master");
        break;
      }
      case "art_email_banner":
        c.fill("cream");
        ghost(c, H / 256, o, (W * 0.56) / (H / 256), 110, 0.5, "plain");
        c.shape(spade(W * 0.5, H * 0.52, H * 0.34), "cocoa", Math.max(2, o * 1.5), "mustard");
        break;
    }
  };
}

function blit(dst: Canvas, src: Canvas, ox: number, oy: number): void {
  for (let y = 0; y < src.h; y++)
    for (let x = 0; x < src.w; x++) {
      const i = (y * src.w + x) * 4;
      if (src.data[i + 3] === 0) continue;
      const tx = ox + x;
      const ty = oy + y;
      if (tx < 0 || ty < 0 || tx >= dst.w || ty >= dst.h) continue;
      const j = (ty * dst.w + tx) * 4;
      for (let k = 0; k < 4; k++) dst.data[j + k] = src.data[i + k]!;
    }
}

const fxPainters: Record<string, Painter> = {
  fx_accord: (c, u, o) => {
    for (const ph of [0, Math.PI]) {
      for (let k = 0; k < 20; k++) {
        const t = k / 19;
        const y = u * (220 - t * 190);
        const x = u * 128 + Math.sin(t * Math.PI * 2 + ph) * u * 40;
        c.shape(circle(x, y, u * 12), "cream", Math.max(1, o / 2));
      }
    }
  },
  fx_touch: (c, u, o) => {
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      const r = u * (k % 2 ? 90 : 60);
      c.shape(spade(128 * u + Math.cos(a) * r, 128 * u + Math.sin(a) * r, u * (k % 2 ? 14 : 10)), k % 2 ? "coral" : "cream", Math.max(1, o / 2));
    }
    c.shape(circle(128 * u, 128 * u, 26 * u), "cream", o);
  },
  fx_puff: (c, u, o) => {
    c.shape(wobble(union(circle(110 * u, 140 * u, 46 * u), circle(150 * u, 130 * u, 54 * u), circle(130 * u, 100 * u, 40 * u)), u * 3, 0.08 / u), "cream", o);
  },
};

function doorPainter(locked: boolean): Painter {
  return (c, u, o) => {
    const arch = union(box(u * 40, u * 110, u * 216, u * 250), circle(u * 128, u * 110, u * 88));
    const inner = union(box(u * 70, u * 110, u * 186, u * 260), circle(u * 128, u * 110, u * 58));
    if (locked) {
      c.shape(arch, "cocoa", 0);
      c.shape(box(u * 104, u * 120, u * 152, u * 190, u * 10), "mustard", o);
      c.shape(subtract(circle(u * 128, u * 196, u * 26), circle(u * 128, u * 196, u * 14)), "coral", Math.max(1, o / 2));
      c.shape(box(u * 102, u * 196, u * 154, u * 240, u * 8), "coral", o);
    } else {
      c.shape(subtract(arch, inner), "mustard", o);
    }
  };
}

function painterFor(entry: CatalogEntry): Painter {
  const n = entry.name;
  if (n.startsWith("tile_floor_")) return tilePainter(n.slice("tile_floor_".length));
  if (n === "wall_plaster") return wallPainter(false);
  if (n === "wall_stone") return wallPainter(true);
  if (n === "door_open") return doorPainter(false);
  if (n === "door_locked") return doorPainter(true);
  if (n === "decal_sigil") return (c, u, o) => {
    c.shape(spade(c.w / 2, c.h / 2, c.w * 0.36), "cocoa", 0);
    c.grain(0.03, "cream", "cocoa", 11);
    void u;
    void o;
  };
  if (n.startsWith("fixture_")) return fixturePainters[n.slice(8)] ?? ((c, u, o) => blobBody(c, u, o, "cream"));
  if (n.startsWith("item_")) return itemPainters[n.slice(5)] ?? ((c, u, o) => c.shape(circle(128 * u, 140 * u, 50 * u), "cream", o));
  if (n === "vessel") return (c, u, o) => vesselPainter(c, u, o);
  if (n.startsWith("fx_")) return fxPainters[n] ?? (() => {});
  if (n.startsWith("ui_")) return uiPainter(n);
  if (n.startsWith("portrait_")) return (c, u, o) => {
    c.fill("cream");
    if (n === "portrait_you") {
      vesselPainter(c, u, o);
      c.shape(segment(u * 92, u * 88, u * 114, u * 94, u * 3), "cocoa", 0);
      c.shape(segment(u * 164, u * 88, u * 142, u * 94, u * 3), "cocoa", 0);
    } else {
      const mood = n.endsWith("novice") ? "sleepy" : n.endsWith("adept") ? "adept" : "master";
      ghost(c, u, o, 128, 150, 1, mood);
    }
  };
  if (n.startsWith("art_")) return artPainter(n);
  return (c, u, o) => blobBody(c, u, o, "cream");
}

/** Kinds whose placeholders carry a printed name label. Chrome and icons stay clean so they can be used as UI. */
function wantsLabel(entry: CatalogEntry): boolean {
  if (entry.name.startsWith("ui_")) return entry.name === "ui_logo_spade" || entry.name === "ui_laurel";
  return true;
}

export function drawPlaceholder(entry: CatalogEntry, w: number, h: number): Canvas {
  const c = new Canvas(w, h);
  const u = Math.min(w, h) / 256;
  const o = Math.max(2, Math.round(Math.min(w, h) / 32));
  painterFor(entry)(c, u, o);
  if (wantsLabel(entry)) {
    const scale = Math.max(1, Math.floor(Math.min(w, h) / 96));
    const short = entry.name.replace(/^(tile_floor_|fixture_|item_|decal_|portrait_|art_|fx_|ui_)/, "");
    c.label(short, w / 2, h - 2 * scale, w - 4, scale, "cocoa", "cream", true);
  }
  return c;
}
