import { PALETTE } from "@blackmaria/style";
import type { AssetInfo } from "./AssetLoader.js";

/**
 * Runtime placeholder, drawn in the palette: a flat cream shape with a thick cocoa outline and the
 * asset name in small cocoa type. Used only when neither manifest yields a loadable file.
 */
export function drawPlaceholder(info: AssetInfo): HTMLCanvasElement {
  const square = info.kind === "tile" || info.kind === "wall" || info.kind === "sprite" || info.kind === "decal";
  const [nw, nh] = info.size;
  const max = square ? 128 : 512;
  const k = Math.min(1, max / Math.max(nw, nh));
  const w = Math.max(16, Math.round(nw * k));
  const h = Math.max(16, Math.round(nh * k));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  const o = Math.max(2, Math.round(Math.min(w, h) / 24));
  const round = (x: number, y: number, rw: number, rh: number, r: number, fill: string) => {
    g.beginPath();
    g.roundRect(x, y, rw, rh, r);
    g.fillStyle = fill;
    g.fill();
    g.lineWidth = o;
    g.strokeStyle = PALETTE.cocoa;
    g.stroke();
  };
  switch (info.kind) {
    case "tile":
      g.fillStyle = PALETTE.cream;
      g.fillRect(0, 0, w, h);
      g.fillStyle = PALETTE.cocoa;
      g.fillRect(0, 0, w, Math.max(1, o / 2));
      g.fillRect(0, 0, Math.max(1, o / 2), h);
      g.fillRect(0, h / 2, w, Math.max(1, o / 3));
      g.fillRect(w / 2, 0, Math.max(1, o / 3), h);
      break;
    case "wall":
      g.fillStyle = PALETTE.teal;
      g.fillRect(0, 0, w, h);
      g.fillStyle = PALETTE.mustard;
      g.fillRect(0, 0, w, h / 3);
      g.fillStyle = PALETTE.cocoa;
      g.fillRect(0, h / 3 - o, w, o);
      g.fillRect(0, 0, w, o);
      g.fillRect(0, h - o, w, o);
      break;
    case "decal":
      g.beginPath();
      g.ellipse(w / 2, h / 2, w * 0.4, h * 0.3, 0, 0, Math.PI * 2);
      g.fillStyle = PALETTE.moss;
      g.fill();
      g.lineWidth = o;
      g.strokeStyle = PALETTE.cocoa;
      g.stroke();
      break;
    case "sprite": {
      const s = info.name.startsWith("item_") ? 0.42 : info.name === "vessel" ? 0.7 : 0.8;
      const bw = w * s;
      const bh = h * s;
      round((w - bw) / 2, h * 0.85 - bh, bw, bh, Math.min(bw, bh) * 0.35, PALETTE.cream);
      break;
    }
    case "portrait":
      g.fillStyle = PALETTE.cream;
      g.fillRect(0, 0, w, h);
      g.beginPath();
      g.ellipse(w / 2, h * 0.55, w * 0.3, h * 0.32, 0, 0, Math.PI * 2);
      g.fillStyle = info.name.includes("maria") ? PALETTE.lilac : PALETTE.cream;
      g.fill();
      g.lineWidth = o;
      g.strokeStyle = PALETTE.cocoa;
      g.stroke();
      break;
    case "art":
      g.fillStyle = PALETTE.cream;
      g.fillRect(0, 0, w, h);
      g.fillStyle = PALETTE.teal;
      g.beginPath();
      g.arc(w * 0.15, h * 0.8, h * 0.12, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = PALETTE.mustard;
      g.beginPath();
      g.arc(w * 0.85, h * 0.2, h * 0.08, 0, Math.PI * 2);
      g.fill();
      break;
    default:
      round(o, o, w - o * 2, h - o * 2, Math.min(w, h) * 0.25, PALETTE.cream);
  }
  // Label.
  const label = info.name.replace(/^(tile_floor_|fixture_|item_|decal_|portrait_|art_|fx_|ui_)/, "").toUpperCase();
  let size = Math.max(7, Math.round(Math.min(w, h) / 9));
  g.font = `700 ${size}px 'Space Mono', monospace`;
  while (size > 6 && g.measureText(label).width > w - 6) {
    size--;
    g.font = `700 ${size}px 'Space Mono', monospace`;
  }
  const tw = g.measureText(label).width;
  // Key art keeps its label out of the way, in the top corner.
  const ty = info.kind === "art" ? size + 4 : h - size * 0.6 - 2;
  g.fillStyle = PALETTE.cream;
  g.fillRect((w - tw) / 2 - 3, ty - size * 0.8, tw + 6, size * 1.1);
  g.fillStyle = PALETTE.cocoa;
  g.textAlign = "center";
  g.textBaseline = "alphabetic";
  g.fillText(label, w / 2, ty + size * 0.15);
  return c;
}
