/** Signed distance functions. Negative inside, positive outside. Units are pixels. */
export type Sdf = (x: number, y: number) => number;

export const circle = (cx: number, cy: number, r: number): Sdf => (x, y) => Math.hypot(x - cx, y - cy) - r;

export const ellipse = (cx: number, cy: number, rx: number, ry: number): Sdf => (x, y) => {
  // Approximate: scale to unit circle, then rescale by the smaller radius.
  const dx = (x - cx) / rx;
  const dy = (y - cy) / ry;
  return (Math.hypot(dx, dy) - 1) * Math.min(rx, ry);
};

export const box = (x0: number, y0: number, x1: number, y1: number, r = 0): Sdf => {
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const hx = (x1 - x0) / 2 - r;
  const hy = (y1 - y0) / 2 - r;
  return (x, y) => {
    const qx = Math.abs(x - cx) - hx;
    const qy = Math.abs(y - cy) - hy;
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
  };
};

export const polygon = (pts: readonly (readonly [number, number])[]): Sdf => (x, y) => {
  const n = pts.length;
  const p0 = pts[0]!;
  let d = (x - p0[0]) ** 2 + (y - p0[1]) ** 2;
  let s = 1;
  for (let i = 0, j = n - 1; i < n; j = i, i++) {
    const [ix, iy] = pts[i]!;
    const [jx, jy] = pts[j]!;
    const ex = jx - ix;
    const ey = jy - iy;
    const wx = x - ix;
    const wy = y - iy;
    const t = Math.max(0, Math.min(1, (wx * ex + wy * ey) / (ex * ex + ey * ey)));
    const bx = wx - ex * t;
    const by = wy - ey * t;
    d = Math.min(d, bx * bx + by * by);
    const c1 = y >= iy;
    const c2 = y < jy;
    const c3 = ex * wy > ey * wx;
    if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) s = -s;
  }
  return s * Math.sqrt(d);
};

export const segment = (ax: number, ay: number, bx: number, by: number, r: number): Sdf => (x, y) => {
  const px = x - ax;
  const py = y - ay;
  const ex = bx - ax;
  const ey = by - ay;
  const t = Math.max(0, Math.min(1, (px * ex + py * ey) / (ex * ex + ey * ey || 1)));
  return Math.hypot(px - ex * t, py - ey * t) - r;
};

export const union = (...fs: Sdf[]): Sdf => (x, y) => {
  let d = Infinity;
  for (const f of fs) d = Math.min(d, f(x, y));
  return d;
};

export const subtract = (a: Sdf, b: Sdf): Sdf => (x, y) => Math.max(a(x, y), -b(x, y));

export const intersect = (a: Sdf, b: Sdf): Sdf => (x, y) => Math.max(a(x, y), b(x, y));

/** A hand-drawn wobble: perturbs the boundary by a smooth pseudo-noise. */
export const wobble = (f: Sdf, amp: number, freq: number, phase = 0): Sdf => (x, y) =>
  f(x, y) + amp * (Math.sin(x * freq + phase) * 0.6 + Math.sin(y * freq * 1.37 + phase * 2.1) * 0.4);

/** The society mark: a chubby spade with a rounded point and a short stem. Centered on (cx, cy), height ~ 2*s. */
export const spade = (cx: number, cy: number, s: number): Sdf => {
  const lobeR = s * 0.46;
  const left = circle(cx - s * 0.42, cy + s * 0.18, lobeR);
  const right = circle(cx + s * 0.42, cy + s * 0.18, lobeR);
  const body = polygon([
    [cx, cy - s * 0.95],
    [cx + s * 0.86, cy + s * 0.12],
    [cx, cy + s * 0.5],
    [cx - s * 0.86, cy + s * 0.12],
  ]);
  const tip = circle(cx, cy - s * 0.78, s * 0.2);
  const stem = polygon([
    [cx - s * 0.12, cy + s * 0.4],
    [cx + s * 0.12, cy + s * 0.4],
    [cx + s * 0.3, cy + s * 0.95],
    [cx - s * 0.3, cy + s * 0.95],
  ]);
  const roundBody = (x: number, y: number) => body(x, y) - s * 0.06;
  return union(left, right, roundBody, tip, stem);
};
