import { Application, Container, Graphics, Sprite, Texture } from "pixi.js";
import type { GameEvent, HeldItem, Pos, RoomOrCorridor, Who } from "@blackmaria/protocol";
import { PIXI_COLORS, PALETTE } from "@blackmaria/style";
import { AssetLoader, type AssetInfo } from "../assets/AssetLoader.js";
import { REDUCED_MOTION } from "../settings.js";
import { bus } from "./bus.js";
import { camera, type CameraChoice } from "./camera.js";
import { wallCover, wallSpan } from "./layout.js";
import type { View } from "./view.js";

/** World units per tile. The camera scales this to at least 56 screen pixels (SPEC 8.1). */
const T = 64;
const C = PIXI_COLORS;
const STONE_ROOMS = new Set<RoomOrCorridor>(["chapel", "cellar", "vault"]);
/** Furniture drawn at two tiles across (collision stays one tile). */
const BIG = new Set(["bed", "piano", "bookcase", "fireplace", "altar"]);
const UNDER = new Set(["rug_small", "cobweb"]);

/** One flat fill per room kind (SPEC 8.1): a palette color, and how strongly it sits over cream. */
const ROOM_FILL: Record<RoomOrCorridor, { color: number; alpha: number }> = {
  hall: { color: C.cream, alpha: 1 },
  library: { color: C.mustard, alpha: 0.32 },
  study: { color: C.cocoa, alpha: 0.16 },
  chapel: { color: C.cocoa, alpha: 0.07 },
  cellar: { color: C.teal, alpha: 0.55 },
  kitchen: { color: C.coral, alpha: 0.12 },
  conservatory: { color: C.moss, alpha: 0.32 },
  gallery: { color: C.teal, alpha: 0.28 },
  nursery: { color: C.coral, alpha: 0.08 },
  vault: { color: C.cocoa, alpha: 0.42 },
  corridor: { color: C.cocoa, alpha: 0.06 },
};

interface Tween {
  t0: number;
  dur: number;
  update: (k: number) => void;
  done?: () => void;
}

const easeOutCubic = (k: number) => 1 - Math.pow(1 - k, 3);
/** Overshoot for entrances; with reduced motion there is no overshoot, only the ease. */
const easeOutBack = (k: number) => {
  if (REDUCED_MOTION) return easeOutCubic(k);
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2);
};
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const samePos = (a: Pos, b: Pos) => a.x === b.x && a.y === b.y;
const feet = (p: Pos) => ({ x: p.x * T + T / 2, y: p.y * T + T * 0.82 });

const ITEM_KINDS = ["key", "letter", "candle", "locket", "ledger", "bottle", "coin", "ring", "photograph", "vial"];

function textureNames(v: View): string[] {
  const names = new Set<string>([
    "vessel",
    "you_happy",
    "you_sad",
    "you_grab",
    "maria_ghost",
    "maria_ghost_grab",
    "fx_touch",
    "fx_puff",
    "fx_accord",
    "door_open",
    "door_locked",
    "wall_cap_plaster",
    "wall_cap_stone",
    "wall_face_plaster",
    "wall_face_stone",
    "decal_sigil",
    "tile_floor_hall_mark",
    "fixture_safe_open",
    "fixture_safe_closed",
  ]);
  for (const row of v.map.rooms) for (const r of row) names.add(`tile_floor_${r}`);
  for (const f of v.fixtures) names.add(f.kind === "safe" ? "fixture_safe_closed" : `fixture_${f.kind}`);
  for (const d of v.decor) names.add(`decor_${d.kind}`);
  for (const k of ITEM_KINDS) names.add(`item_${k}`);
  return [...names];
}

interface Body {
  who: Who;
  root: Container;
  shadow: Graphics;
  ring: Graphics;
  sprite: Sprite;
  held: Container;
  heldKey: string;
  facing: 1 | -1;
  base: { x: number; y: number };
  pose: string;
  poseUntil: number;
  pos: Pos;
}

/**
 * The arena (SPEC 8.1, 8.2). It draws only what the server sent: the house, both bodies, the items, and feedback for
 * the events it received. It knows no rules.
 */
export class Arena {
  private readonly world = new Container();
  private readonly floor = new Container();
  private readonly under = new Container();
  private readonly walls = new Container();
  private readonly sorted = new Container();
  private readonly fx = new Container();
  private readonly light = new Sprite();
  private tex = new Map<string, Texture>();
  private info = new Map<string, AssetInfo>();
  private builtFor: string | null = null;
  private view: View | null = null;
  private pending: { v: View; animate: boolean } | null = null;
  private loading: Promise<void> | null = null;
  private items = new Map<string, { s: Sprite; shadow: Graphics; base: number }>();
  private fixtures = new Map<string, Sprite>();
  private doors = new Map<string, Sprite>();
  private sigils: Sprite[] = [];
  private bodies!: Record<Who, Body>;
  private tweens: Tween[] = [];
  private destroyed = false;
  private lastSize = "";
  private cam = { x: 0, y: 0, s: 1, init: false };
  private shakeUntil = 0;
  /** The view you picked, or null for the default: the whole house when it fits at 56 px a tile, else follow you. */
  private choice: CameraChoice | null = null;
  private camKey = "";
  private readonly resizer: ResizeObserver;
  /** Told whenever the view on screen or the toggle's use changes. */
  onCamera: ((c: { mode: CameraChoice; toggle: boolean }) => void) | null = null;

  private constructor(
    private readonly app: Application,
    private readonly host: HTMLElement,
  ) {
    this.sorted.sortableChildren = true;
    this.world.addChild(this.floor, this.under, this.walls, this.sorted, this.fx);
    app.stage.addChild(this.world, this.light);
    app.ticker.add(() => this.frame());
    // Pixi's `resizeTo` only listens to the window, so a host that changes size on its own (a side panel filling in,
    // a bar wrapping) kept a stale canvas: a cream band along one edge and a camera aimed at the wrong frame. The
    // canvas now follows the host itself.
    this.resizer = new ResizeObserver(() => this.fitCanvas());
    this.resizer.observe(host);
    if (import.meta.env.DEV) (globalThis as { __bmArena?: Arena }).__bmArena = this;
  }

  static async create(host: HTMLElement): Promise<Arena> {
    const app = new Application();
    await app.init({ resizeTo: host, backgroundAlpha: 0, antialias: true, autoDensity: true, resolution: Math.min(2, window.devicePixelRatio || 1) });
    app.canvas.classList.add("arena-canvas");
    host.appendChild(app.canvas);
    return new Arena(app, host);
  }

  destroy(): void {
    this.destroyed = true;
    this.resizer.disconnect();
    this.app.destroy({ removeView: true }, { children: true });
  }

  /** Resize the canvas to the host now, and aim the camera at the new frame. */
  private fitCanvas(): void {
    if (this.destroyed) return;
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    if (w > 0 && h > 0 && (this.app.screen.width !== w || this.app.screen.height !== h)) this.app.renderer.resize(w, h);
    this.lastSize = `${w}x${h}`;
    this.layout(true);
  }

  setChoice(c: CameraChoice | null): void {
    this.choice = c;
    this.layout(true);
  }

  /** Empty the arena (a stopped match): nothing drawn until the next view. */
  clear(): void {
    if (this.destroyed) return;
    this.pending = null;
    this.view = null;
    this.builtFor = null;
    this.tweens = [];
    for (const c of [this.floor, this.under, this.walls, this.sorted, this.fx]) c.removeChildren().forEach((d) => d.destroy());
    this.items.clear();
    this.fixtures.clear();
    this.doors.clear();
    this.sigils = [];
    this.light.visible = false;
  }

  /** Show a view. With `animate`, differences from the last view are tweened and their events played. */
  setView(v: View, animate = true): void {
    if (this.destroyed) return;
    const key = `${v.matchId}:${v.map.w}x${v.map.h}`;
    if (this.builtFor !== key) {
      this.pending = { v, animate: false };
      if (!this.loading) {
        this.loading = this.load(v).then(() => {
          this.loading = null;
          if (this.destroyed || !this.pending) return;
          const p = this.pending;
          this.pending = null;
          this.build(p.v);
          this.builtFor = `${p.v.matchId}:${p.v.map.w}x${p.v.map.h}`;
          this.view = p.v;
          this.sync(p.v, null);
        });
      }
      return;
    }
    if (this.loading) {
      this.pending = { v, animate };
      return;
    }
    const prev = this.view;
    this.view = v;
    this.sync(v, animate ? prev : null);
  }

  private async load(v: View): Promise<void> {
    const names = textureNames(v);
    const texes = await AssetLoader.preload(names);
    names.forEach((n, i) => {
      this.tex.set(n, texes[i]!);
      this.info.set(n, AssetLoader.info(n));
    });
  }

  private t(name: string): Texture {
    // Never Texture.WHITE: pure white is not in the palette.
    return this.tex.get(name) ?? Texture.EMPTY;
  }

  /** A sprite standing on a tile: its foot anchor at the tile's floor point, `width` tiles wide. */
  private stand(name: string, p: Pos, width = 1): Sprite {
    const info = this.info.get(name) ?? AssetLoader.info(name);
    const s = new Sprite(this.t(name));
    s.anchor.set(0.5, info.kind === "sprite" ? info.anchor[1] : 1);
    s.width = T * width;
    s.height = T * width * (info.size[1] / info.size[0]);
    const f = feet(p);
    s.position.set(f.x, f.y);
    s.zIndex = f.y;
    return s;
  }

  /** A soft cocoa ellipse shadow at 20% (SPEC 8.1). */
  private shadow(p: Pos, w: number): Graphics {
    const g = new Graphics();
    const f = feet(p);
    g.ellipse(0, 0, T * 0.36 * w, T * 0.12 * w).fill({ color: C.cocoa, alpha: 0.2 });
    g.position.set(f.x, f.y);
    g.zIndex = f.y - 1;
    return g;
  }

  private build(v: View): void {
    this.tweens = [];
    for (const c of [this.floor, this.under, this.walls, this.sorted, this.fx]) c.removeChildren().forEach((d) => d.destroy());
    this.items.clear();
    this.fixtures.clear();
    this.doors.clear();
    this.sigils = [];
    const { tiles, rooms, w, h } = v.map;
    const roomNear = (x: number, y: number): RoomOrCorridor => {
      for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [-1, 1], [1, -1], [-1, -1]] as const) {
        const t = tiles[y + dy]?.[x + dx];
        if (t && t !== "wall") return rooms[y + dy]![x + dx]!;
      }
      return "corridor";
    };
    const g = new Graphics();
    this.floor.addChild(g);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const kind = tiles[y]![x]!;
        if (kind === "wall") continue;
        // A doorway reads as part of the room it opens into.
        const room = kind === "door" || kind === "door_locked" ? roomNear(x, y) : rooms[y]![x]!;
        const fill = ROOM_FILL[room];
        g.rect(x * T, y * T, T, T).fill({ color: C.cream });
        g.rect(x * T, y * T, T, T).fill({ color: fill.color, alpha: fill.alpha });
        // The room's floor tile at 12% over its flat fill; corridors stay plain.
        if (room !== "corridor") {
          const s = new Sprite(this.t(x === v.start.x && y === v.start.y && room === "hall" ? "tile_floor_hall_mark" : `tile_floor_${room}`));
          s.position.set(x * T, y * T);
          s.width = s.height = T;
          s.alpha = x === v.start.x && y === v.start.y && room === "hall" ? 0.55 : 0.12;
          this.floor.addChild(s);
        }
      }
    // Walls: a cocoa cap with a slate face below where floor meets it (SPEC 8.1). A wall between two rooms is drawn
    // half a tile thick, with each room's floor running up to it.
    const fillHalf = (fx: number, fy: number, hw: number, hh: number, from: RoomOrCorridor) => {
      const f = ROOM_FILL[from];
      g.rect(fx, fy, hw, hh).fill({ color: C.cream });
      g.rect(fx, fy, hw, hh).fill({ color: f.color, alpha: f.alpha });
    };
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        if (tiles[y]![x] !== "wall") continue;
        // Solid wall mass with no floor around it is left open, so the backdrop shows and the rooms read as rooms.
        const span = wallSpan(tiles, x, y);
        if (span === "none") continue;
        const mat = STONE_ROOMS.has(roomNear(x, y)) ? "stone" : "plaster";
        const vertical = span === "vertical";
        const horizontal = span === "horizontal";
        const below = tiles[y + 1]?.[x];
        let cx = x * T;
        let cw = T;
        let capTop = y * T - T * 0.35;
        let capH = T;
        if (vertical) {
          fillHalf(x * T, y * T, T / 2, T, rooms[y]![x - 1]!);
          fillHalf(x * T + T / 2, y * T, T / 2, T, rooms[y]![x + 1]!);
          cx = x * T + T / 4;
          cw = T / 2;
        } else if (horizontal) {
          fillHalf(x * T, y * T, T, T / 2, rooms[y - 1]![x]!);
          fillHalf(x * T, y * T + T / 2, T, T / 2, rooms[y + 1]![x]!);
          capTop = y * T - T * 0.1;
          capH = T / 2;
        } else {
          const c = wallCover(tiles, x, y);
          cx = x * T + c.x0 * T;
          cw = (c.x1 - c.x0) * T;
          capTop = y * T + c.y0 * T - T * 0.35;
          capH = (c.y1 - c.y0) * T;
        }
        const cap = new Sprite(this.t(`wall_cap_${mat}`));
        cap.position.set(cx, capTop);
        cap.width = cw;
        cap.height = capH;
        this.walls.addChild(cap);
        if ((below !== undefined && below !== "wall") || horizontal) {
          const face = new Sprite(this.t(`wall_face_${mat}`));
          face.position.set(cx, capTop + capH);
          face.width = cw;
          face.height = T * 0.35 + 2;
          this.walls.addChild(face);
        }
      }
    // Doorways: the frame and a cream threshold strip.
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const kind = tiles[y]![x]!;
        if (kind !== "door" && kind !== "door_locked") continue;
        const th = new Graphics();
        const vertical = tiles[y - 1]?.[x] === "wall";
        if (vertical) th.rect(x * T, y * T + T * 0.4, T, T * 0.2).fill({ color: C.cream });
        else th.rect(x * T + T * 0.4, y * T, T * 0.2, T).fill({ color: C.cream });
        this.under.addChild(th);
        const d = this.stand(kind === "door_locked" ? "door_locked" : "door_open", { x, y }, 1);
        d.zIndex -= T * 0.2;
        this.sorted.addChild(d);
        if (kind === "door_locked") this.doors.set(`${x},${y}`, d);
      }
    // Sigils glow in their owner's color when charged.
    for (const sg of v.sigils) {
      const s = new Sprite(this.t("decal_sigil"));
      s.anchor.set(0.5);
      s.position.set(sg.pos.x * T + T / 2, sg.pos.y * T + T / 2);
      s.width = s.height = T * 0.9;
      this.under.addChild(s);
      this.sigils.push(s);
    }
    for (const d of v.decor) {
      const s = this.stand(`decor_${d.kind}`, d.pos, UNDER.has(d.kind) ? 1 : 0.8);
      if (UNDER.has(d.kind)) {
        s.anchor.set(0.5);
        s.position.set(d.pos.x * T + T / 2, d.pos.y * T + T / 2);
        this.under.addChild(s);
      } else {
        this.sorted.addChild(this.shadow(d.pos, 0.8), s);
      }
    }
    for (const f of v.fixtures) {
      const big = BIG.has(f.kind);
      const s = this.stand(f.kind === "safe" ? "fixture_safe_closed" : `fixture_${f.kind}`, f.pos, big ? 2 : 1.25);
      this.sorted.addChild(this.shadow(f.pos, big ? 1.8 : 1.2), s);
      this.fixtures.set(f.id, s);
    }
    this.bodies = { you: this.makeBody("you", v.you.pos), maria: this.makeBody("maria", v.maria.pos) };
    this.makeLight();
    this.light.visible = true;
    this.layout(true);
  }

  private makeBody(who: Who, p: Pos): Body {
    const root = new Container();
    const shadow = new Graphics();
    shadow.ellipse(0, 0, T * 0.34, T * 0.11).fill({ color: C.cocoa, alpha: 0.2 });
    const ring = new Graphics();
    ring.ellipse(0, 0, T * 0.46, T * 0.18).fill({ color: who === "you" ? C.mustard : C.lilac, alpha: 0.3 }).stroke({ width: 6, color: who === "you" ? C.mustard : C.lilac });
    const name = who === "you" ? "vessel" : "maria_ghost";
    const info = this.info.get(name) ?? AssetLoader.info(name);
    const sprite = new Sprite(this.t(name));
    sprite.anchor.set(0.5, info.anchor[1]);
    const width = who === "you" ? 1.35 : 1.4;
    sprite.width = T * width;
    sprite.height = T * width * (info.size[1] / info.size[0]);
    if (who === "maria") sprite.alpha = 0.92;
    const held = new Container();
    held.position.set(0, -T * 1.45);
    root.addChild(shadow, ring, sprite, held);
    const f = feet(p);
    root.position.set(f.x, f.y);
    root.zIndex = f.y + 2;
    this.sorted.addChild(root);
    return { who, root, shadow, ring, sprite, held, heldKey: "", facing: 1, base: { x: sprite.scale.x, y: sprite.scale.y }, pose: name, poseUntil: 0, pos: { ...p } };
  }

  /** A warm radial light on your body: cream to transparent, about 8 tiles, 25% (SPEC 8.1). */
  private makeLight(): void {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const g = c.getContext("2d")!;
    const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    grad.addColorStop(0, PALETTE.cream);
    grad.addColorStop(1, "transparent");
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);
    this.light.texture = Texture.from(c);
    this.light.anchor.set(0.5);
    this.light.alpha = 0.25;
    this.light.blendMode = "screen";
  }

  private pose(b: Body, name: string, ms: number): void {
    const info = this.info.get(name) ?? AssetLoader.info(name);
    b.sprite.texture = this.t(name);
    b.sprite.anchor.set(0.5, info.anchor[1]);
    b.pose = name;
    b.poseUntil = performance.now() + ms;
  }

  // -------------------------------------------------------------------------

  private sync(v: View, prev: View | null): void {
    this.syncItems(v, prev !== null);
    for (const [k, d] of this.doors) {
      if (v.doorsOpened.some((p) => `${p.x},${p.y}` === k)) d.texture = this.t("door_open");
    }
    for (const f of v.fixtures) if (f.kind === "safe") this.fixtures.get(f.id)!.texture = this.t(v.safesOpened.includes(f.id) ? "fixture_safe_open" : "fixture_safe_closed");
    v.sigils.forEach((sg, i) => {
      const s = this.sigils[i];
      if (!s) return;
      const charged = (v.sigilCharge[i] ?? 0) === 0;
      s.tint = charged ? (sg.owner === "you" ? C.mustard : C.lilac) : C.cocoa;
      s.alpha = charged ? 1 : 0.35;
    });
    for (const who of ["you", "maria"] as const) {
      const b = this.bodies[who];
      const to = who === "you" ? v.you.pos : v.maria.pos;
      if (prev && !samePos(b.pos, to)) this.walk(b, to);
      else if (!prev) this.placeBody(b, to);
      this.syncHeld(b, who === "you" ? v.you.inventory : v.maria.inventory);
    }
    if (prev && v.tick !== prev.tick) this.play(v, prev);
    this.layout(prev === null);
  }

  private placeBody(b: Body, p: Pos): void {
    b.pos = { ...p };
    const f = feet(p);
    b.root.position.set(f.x, f.y);
    b.root.zIndex = f.y + 2;
  }

  private walk(b: Body, to: Pos): void {
    const from = { x: b.root.x, y: b.root.y };
    const dx = to.x - b.pos.x;
    if (dx !== 0) b.facing = dx > 0 ? 1 : -1;
    const f = feet(to);
    const prev = { ...b.pos };
    b.pos = { ...to };
    b.root.zIndex = f.y + 2;
    this.tween(150, (k) => {
      const e = easeOutCubic(k);
      b.root.position.set(lerp(from.x, f.x, e), lerp(from.y, f.y, e));
    });
    if (b.who === "you") {
      this.squash(b);
      this.puff(prev);
      bus.emit({ kind: "step", dir: dx > 0 ? "E" : dx < 0 ? "W" : to.y > prev.y ? "S" : "N" });
    }
  }

  /** Each body carries its items as tiny icons above its head (SPEC 8.2). */
  private syncHeld(b: Body, inv: HeldItem[]): void {
    const key = inv.map((i) => i.id).join(",");
    if (key === b.heldKey) return;
    b.heldKey = key;
    b.held.removeChildren().forEach((d) => d.destroy());
    const size = T * 0.5;
    inv.forEach((it, i) => {
      const x = (i - (inv.length - 1) / 2) * size * 1.02;
      // A cream coin behind each item so it reads against any floor.
      const disc = new Graphics();
      disc.circle(x, -size / 2, size * 0.5).fill({ color: C.cream }).stroke({ width: 3, color: C.cocoa });
      const s = new Sprite(this.t(`item_${it.kind}`));
      s.anchor.set(0.5, 0.5);
      s.width = s.height = size * 0.82;
      s.position.set(x, -size / 2);
      b.held.addChild(disc, s);
      if (this.view && !REDUCED_MOTION) {
        // The item hops onto the head.
        const y0 = s.y;
        this.tween(300, (k) => {
          s.y = y0 - Math.sin(k * Math.PI) * T * 0.35;
        });
      }
    });
  }

  private syncItems(v: View, animate: boolean): void {
    const seen = new Set<string>();
    for (const it of v.items) {
      seen.add(it.id);
      const onFixture = v.fixtures.some((f) => samePos(f.pos, it.pos));
      let e = this.items.get(it.id);
      if (!e) {
        const s = this.stand(`item_${it.kind}`, it.pos, 0.9);
        const shadow = this.shadow(it.pos, 0.7);
        this.sorted.addChild(shadow, s);
        e = { s, shadow, base: s.y - (onFixture ? T * 0.3 : 0) - T * 0.12 };
        this.items.set(it.id, e);
        if (animate) {
          const sx = s.scale.x;
          const sy = s.scale.y;
          this.tween(260, (k) => s.scale.set(sx * easeOutBack(k), sy * easeOutBack(k)));
        }
      } else {
        const f = feet(it.pos);
        e.s.x = f.x;
        e.base = f.y - (onFixture ? T * 0.3 : 0) - T * 0.12;
        e.shadow.position.set(f.x, f.y);
        e.s.zIndex = f.y + 1;
      }
    }
    for (const [id, e] of this.items) {
      if (seen.has(id)) continue;
      this.items.delete(id);
      e.shadow.destroy();
      if (!animate) {
        e.s.destroy();
        continue;
      }
      // The item hops toward whoever picked it up (or into the fixture it was used on).
      const s = e.s;
      const from = { x: s.x, y: s.y };
      const taker = [v.you, v.maria].find((b) => b.inventory.some((i) => i.id === id));
      const to = taker ? { x: feet(taker.pos).x, y: feet(taker.pos).y - T * 1.35 } : { x: from.x, y: from.y - T * 0.6 };
      this.tween(
        260,
        (k) => {
          const e2 = easeOutCubic(k);
          s.position.set(lerp(from.x, to.x, e2), lerp(from.y, to.y, e2) - Math.sin(k * Math.PI) * T * 0.6);
          s.alpha = taker ? 1 - k * 0.6 : 1 - k;
        },
        () => s.destroy(),
      );
    }
  }

  /** The tick's events, as feedback. */
  private play(v: View, prev: View): void {
    for (const e of v.events) this.playEvent(e, v, prev);
  }

  private playEvent(e: GameEvent, v: View, prev: View): void {
    switch (e.kind) {
      case "snatched": {
        // The loudest thing in the game: shake, the fx_touch burst, the item flying from one body to the other.
        const thief = this.bodies[e.by];
        const victim = this.bodies[e.by === "you" ? "maria" : "you"];
        this.pose(thief, e.by === "you" ? "you_grab" : "maria_ghost_grab", 500);
        if (e.by === "maria") this.pose(victim, "you_sad", 600);
        this.shakeUntil = performance.now() + 380;
        this.burst("fx_touch", thief.root.x, thief.root.y - T * 0.6, 2.2, 650);
        const kind = [...prev.you.inventory, ...prev.maria.inventory].find((i) => i.id === e.item)?.kind;
        if (kind) this.fly(`item_${kind}`, { x: victim.root.x, y: victim.root.y - T * 1.35 }, { x: thief.root.x, y: thief.root.y - T * 1.35 });
        bus.emit({ kind: "snatched", by: e.by });
        return;
      }
      case "winding_up": {
        // The wind-up is the warning: the snatcher rears back and a small shake says "next tick".
        const who = this.bodies[e.by];
        this.pose(who, e.by === "you" ? "you_grab" : "maria_ghost_grab", 260);
        this.shakeUntil = performance.now() + 140;
        this.burst("fx_touch", who.root.x, who.root.y - T * 0.9, 1.1, 300);
        bus.emit({ kind: "winding_up", by: e.by });
        return;
      }
      case "returned":
        this.puff(e.pos);
        bus.emit({ kind: "returned" });
        return;
      case "completed": {
        const er = v.board.find((x) => x.id === e.errand);
        if (e.by === "you") this.pose(this.bodies.you, "you_happy", 500);
        else this.pose(this.bodies.you, "you_sad", 500);
        this.burst("fx_accord", this.bodies[e.by].root.x, this.bodies[e.by].root.y - T * 1.6, 1, 500);
        bus.emit({ kind: "completed", by: e.by, value: er?.value ?? 0 });
        return;
      }
      case "expired":
        bus.emit({ kind: "expired", errand: e.errand });
        return;
      case "delivered":
        this.puff(e.by === "you" ? v.you.pos : v.maria.pos);
        bus.emit({ kind: "delivered", by: e.by });
        return;
      case "took":
        bus.emit({ kind: "took", by: e.by });
        return;
      case "posted":
        bus.emit({ kind: "posted", value: e.errand.value });
        return;
      case "sigil": {
        const i = v.sigils.findIndex((s) => s.owner === e.owner);
        const sg = v.sigils[i];
        if (sg) this.burst("fx_accord", sg.pos.x * T + T / 2, sg.pos.y * T + T / 2, 1.4, 600);
        bus.emit({ kind: "sigil", owner: e.owner });
        return;
      }
      case "door_opened":
      case "safe_opened":
        bus.emit({ kind: e.kind });
        return;
      default:
        return;
    }
  }

  private fly(name: string, from: { x: number; y: number }, to: { x: number; y: number }): void {
    const s = new Sprite(this.t(name));
    s.anchor.set(0.5);
    s.width = s.height = T * 0.7;
    this.fx.addChild(s);
    this.tween(
      420,
      (k) => {
        const e = easeOutCubic(k);
        s.position.set(lerp(from.x, to.x, e), lerp(from.y, to.y, e) - Math.sin(k * Math.PI) * T * 0.9);
        s.rotation = k * Math.PI * 2;
      },
      () => s.destroy(),
    );
  }

  private squash(b: Body): void {
    if (REDUCED_MOTION) return;
    const base = b.base;
    this.tween(240, (k) => {
      const e = easeOutBack(k);
      b.sprite.scale.set(base.x * lerp(1.16, 1, e) * b.facing, base.y * lerp(0.8, 1, e));
    });
  }

  private burst(name: string, x: number, y: number, scale: number, dur: number): void {
    const s = new Sprite(this.t(name));
    s.anchor.set(0.5);
    const base = T * scale;
    s.position.set(x, y);
    this.fx.addChild(s);
    this.tween(
      dur,
      (k) => {
        const e = easeOutBack(Math.min(1, k * 1.6));
        s.width = s.height = base * (0.5 + 0.5 * e);
        s.alpha = 1 - Math.max(0, (k - 0.5) * 2);
      },
      () => s.destroy(),
    );
  }

  private puff(at: Pos): void {
    const s = new Sprite(this.t("fx_puff"));
    s.anchor.set(0.5, 0.85);
    const f = feet(at);
    s.position.set(f.x, f.y);
    s.width = s.height = T * 0.45;
    this.fx.addChildAt(s, 0);
    const y0 = s.y;
    this.tween(
      360,
      (k) => {
        s.y = y0 - k * T * 0.25;
        s.alpha = 0.9 * (1 - k);
        s.width = s.height = T * (0.45 + k * 0.25);
      },
      () => s.destroy(),
    );
  }

  private tween(dur: number, update: (k: number) => void, done?: () => void): void {
    const t: Tween = { t0: performance.now(), dur, update };
    if (done) t.done = done;
    this.tweens.push(t);
    update(0);
  }

  /** Camera (SPEC 8.1): the math is in camera.ts. */
  private layout(snap: boolean): void {
    if (!this.view || !this.bodies) return;
    const you = this.bodies.you.root;
    const c = camera({ sw: this.host.clientWidth, sh: this.host.clientHeight, w: this.view.map.w, h: this.view.map.h, tile: T, you: { x: you.x, y: you.y }, choice: this.choice });
    const key = `${c.mode}:${c.toggle}`;
    if (key !== this.camKey) {
      this.camKey = key;
      this.onCamera?.({ mode: c.mode, toggle: c.toggle });
    }
    // A change of scale (a toggle, a resize) snaps; following you glides.
    if (snap || !this.cam.init || Math.abs(c.s - this.cam.s) > 1e-6) this.cam = { x: c.x, y: c.y, s: c.s, init: true };
    else {
      this.cam.x = lerp(this.cam.x, c.x, 0.14);
      this.cam.y = lerp(this.cam.y, c.y, 0.14);
    }
  }

  private frame(): void {
    const now = performance.now();
    const keep: Tween[] = [];
    for (const t of this.tweens) {
      const k = Math.min(1, (now - t.t0) / t.dur);
      try {
        t.update(k);
        if (k < 1) keep.push(t);
        else t.done?.();
      } catch {
        /* its target was destroyed; drop the tween */
      }
    }
    this.tweens = keep;
    if (!this.view || !this.bodies) return;
    const size = `${this.host.clientWidth}x${this.host.clientHeight}`;
    if (size !== this.lastSize) this.fitCanvas();
    else this.layout(false);
    let sx = 0;
    let sy = 0;
    if (now < this.shakeUntil && !REDUCED_MOTION) {
      const a = ((this.shakeUntil - now) / 380) * 9;
      sx = Math.sin(now / 17) * a;
      sy = Math.cos(now / 23) * a;
    }
    this.world.scale.set(this.cam.s);
    this.world.position.set(Math.round(this.cam.x + sx), Math.round(this.cam.y + sy));
    // Items float with a slow 2 px bob.
    const bob = REDUCED_MOTION ? 0 : Math.sin(now / 520) * 2;
    for (const e of this.items.values()) e.s.y = e.base + bob;
    for (const b of Object.values(this.bodies)) {
      if (b.poseUntil && now > b.poseUntil) {
        b.poseUntil = 0;
        this.pose(b, b.who === "you" ? "vessel" : "maria_ghost", 0);
        b.poseUntil = 0;
      }
      // You bob in two frames; Maria floats.
      b.sprite.y = REDUCED_MOTION ? (b.who === "you" ? 0 : -T * 0.12) : b.who === "you" ? (Math.floor(now / 380) % 2 ? -T * 0.03 : 0) : -T * 0.12 + Math.sin(now / 300) * T * 0.06;
      b.held.y = -T * 1.45 + b.sprite.y;
      if (!this.tweens.length) b.sprite.scale.set(b.base.x * b.facing, b.base.y);
    }
    const you = this.bodies.you.root;
    this.light.position.set(this.world.x + you.x * this.cam.s, this.world.y + (you.y - T * 0.4) * this.cam.s);
    this.light.width = this.light.height = 16 * T * this.cam.s;
  }
}
