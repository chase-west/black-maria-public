import { memo, useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { AssetLoader } from "../assets/AssetLoader.js";
import { bus } from "../game/bus.js";
import { REDUCED_MOTION } from "../settings.js";
import { AssetImg } from "./kit.js";

/**
 * The decoration layer (v6.3 design pass): the footer scene, the hero sky, card corners, the page texture, the cursors,
 * the walking loading fellow and confetti. Every image is loaded by name through AssetLoader (ASSETS_DECOR.md,
 * ASSETS.md); a name that has not landed falls back to its placeholder like any other.
 */

/** A DOM URL for a manifest image (or its placeholder), once loaded. */
export function useAssetUrl(name: string): string | null {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void AssetLoader.url(name).then((u) => live && setSrc(u));
    return () => {
      live = false;
    };
  }, [name]);
  return src;
}

/** An image scaled down onto a small canvas: cursors must be small, and 128 px art makes a giant pointer. */
async function smallCopy(name: string, size: number): Promise<string | null> {
  const url = await AssetLoader.url(name);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement("canvas");
        c.width = c.height = size;
        c.getContext("2d")!.drawImage(img, 0, 0, size, size);
        resolve(c.toDataURL("image/png"));
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/**
 * Page-wide images as CSS variables, set once: the card corner, the page texture, the heading ornament, and the two
 * cursors. Until a variable is set, every rule that uses it falls back to plain CSS (no corner, no texture, the
 * system cursor).
 */
export function DecorVars() {
  useEffect(() => {
    let live = true;
    const root = document.documentElement.style;
    for (const [v, name] of [
      ["--img-corner", "ui_frame_corner"],
      ["--img-panel", "ui_panel_dark"],
      ["--img-ornament", "ornament_header"],
    ] as const) {
      void AssetLoader.url(name).then((u) => live && root.setProperty(v, `url("${u}")`));
    }
    void smallCopy("cursor_spade", 32).then((u) => live && u && root.setProperty("--cur-default", `url("${u}") 6 4, auto`));
    void smallCopy("cursor_hand", 32).then((u) => live && u && root.setProperty("--cur-pointer", `url("${u}") 10 2, pointer`));
    return () => {
      live = false;
    };
  }, []);
  return null;
}

/** Scroll position of an element, written to CSS variables for parallax. Reduced motion: never written. */
function useParallax<T extends HTMLElement>(): RefObject<T | null> {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    if (REDUCED_MOTION) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight || 1;
      // --p: how much of the element has come up into view (0 just entering at the bottom, 1 all of it).
      // --out: how many pixels of it have scrolled away past the top.
      const p = Math.max(0, Math.min(1, (vh - r.top) / Math.max(1, r.height)));
      el.style.setProperty("--p", p.toFixed(4));
      el.style.setProperty("--out", Math.max(0, -r.top).toFixed(1));
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);
  return ref;
}

/**
 * The footer's parallax, from the scroll position alone (the footer is fixed to the bottom of the viewport and the
 * page slides up off it). --p is how much of it the page has uncovered: 1 - (what is left to scroll) / its height,
 * 0 while the page still covers it, 1 at the end of the page and on any page shorter than the screen. The base is
 * the document's bottom, so a route change or a block loading never moves the layers: the value is written again
 * before the next paint whenever the page's height changes. Reduced motion: never written.
 */
function useFooterParallax<T extends HTMLElement>(): RefObject<T | null> {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    if (REDUCED_MOTION) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const el = ref.current;
      if (!el) return;
      const d = document.documentElement;
      const left = d.scrollHeight - window.innerHeight - window.scrollY;
      const p = Math.max(0, Math.min(1, 1 - left / Math.max(1, el.offsetHeight)));
      el.style.setProperty("--p", p.toFixed(4));
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    // The page's height changing (a route, a block arriving) is seen before paint, so the layers never show stale.
    const ro = new ResizeObserver(update);
    ro.observe(document.body);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      ro.disconnect();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);
  return ref;
}

/** A strip image repeated along x, at its own aspect, as a background layer. */
function Strip(props: { name: string; className: string }) {
  const src = useAssetUrl(props.name);
  return <div className={`scene-layer ${props.className}`} aria-hidden style={src ? { backgroundImage: `url("${src}")` } : undefined} />;
}

/** Where the stars sit in the footer sky and the hero, as fractions, with a twinkle delay each. */
const STARS: { x: number; y: number; s: number; d: number }[] = [
  { x: 0.04, y: 0.18, s: 1, d: 0 },
  { x: 0.13, y: 0.42, s: 0.7, d: 1.3 },
  { x: 0.24, y: 0.12, s: 0.85, d: 2.1 },
  { x: 0.36, y: 0.34, s: 0.6, d: 0.6 },
  { x: 0.47, y: 0.1, s: 1, d: 1.8 },
  { x: 0.58, y: 0.38, s: 0.7, d: 2.7 },
  { x: 0.69, y: 0.16, s: 0.9, d: 0.9 },
  { x: 0.8, y: 0.4, s: 0.65, d: 2.4 },
  { x: 0.91, y: 0.14, s: 1, d: 1.1 },
  { x: 0.97, y: 0.46, s: 0.6, d: 3 },
];

function Stars(props: { className?: string; count?: number }) {
  return (
    <div className={`scene-layer stars ${props.className ?? ""}`} aria-hidden>
      {STARS.slice(0, props.count ?? STARS.length).map((st, i) => (
        <AssetImg key={i} name="sky_star" className="star" style={{ left: `${st.x * 100}%`, top: `${st.y * 100}%`, ["--s" as string]: st.s, animationDelay: `${st.d}s` } as CSSProperties} />
      ))}
    </div>
  );
}

/**
 * The footer, as a scene (v6.3): the night sky with twinkling stars, the mustard hill, the roofline with its chimneys,
 * the ghost drifting slowly from chimney to chimney (asleep on the way, waving when she stops), the fence, the trees,
 * the bushes and the lamp post. Layers move at different speeds as the page scrolls; with reduced motion nothing
 * moves. Mounted once, outside the routes, and memoized: a route change never re-mounts or re-renders it.
 */
export const FooterScene = memo(function FooterScene(props: { children?: ReactNode }) {
  const ref = useFooterParallax<HTMLDivElement>();
  return (
    <div className="scene" ref={ref}>
      <Stars />
      <Strip name="footer_strip" className="roofline" />
      <div className="ghost-drift" aria-hidden>
        <div className="ghost-bob">
          <AssetImg name="maria_sleep" className="ghost ghost-sleep" />
          <AssetImg name="maria_wave" className="ghost ghost-wave" />
        </div>
      </div>
      <Strip name="scene_hill" className="hill" />
      <Strip name="scene_fence" className="fence" />
      <div className="scene-layer props" aria-hidden>
        <AssetImg name="scene_tree" className="prop tree t1" />
        <AssetImg name="scene_bush_a" className="prop bush b1" />
        <AssetImg name="scene_lamp" className="prop lamp" />
        <AssetImg name="scene_bush_b" className="prop bush b2" />
        <AssetImg name="scene_tree" className="prop tree t2" />
        <AssetImg name="scene_bush_a" className="prop bush b3" />
      </div>
      {props.children}
    </div>
  );
});

/** The Start Here sky: the moon, clouds and stars on a slow parallax, around the house art (v6.3). */
export function HeroSky() {
  const ref = useParallax<HTMLDivElement>();
  return (
    <div className="hero-sky" ref={ref} aria-hidden>
      <Stars className="hero-stars" count={8} />
      <AssetImg name="sky_cloud_b" className="cloud cloud-b" />
      <AssetImg name="sky_moon" className="moon" />
      <AssetImg name="sky_cloud_a" className="cloud cloud-a" />
      <AssetImg name="sky_cloud_c" className="cloud cloud-c" />
    </div>
  );
}

const CONFETTI = ["confetti_a", "confetti_b", "confetti_c", "confetti_d"];

/** Pieces of a confetti fall: where each starts, how it drifts and spins, deterministic per index. */
export function confettiPieces(n: number): { name: string; x: number; delay: number; dur: number; drift: number; spin: number; size: number }[] {
  return Array.from({ length: n }, (_, i) => {
    const r = (k: number) => ((Math.sin((i + 1) * 12.9898 * k) * 43758.5453) % 1 + 1) % 1;
    return { name: CONFETTI[i % CONFETTI.length]!, x: r(1) * 100, delay: r(2) * 600, dur: 1800 + r(3) * 1400, drift: (r(4) - 0.5) * 160, spin: (r(5) - 0.5) * 1080, size: 14 + r(6) * 14 };
  });
}

/** Confetti over the page for a few seconds (a win, a submission). Reduced motion: none. */
export async function confetti(n = 48): Promise<void> {
  if (REDUCED_MOTION || typeof document === "undefined") return;
  const urls = await Promise.all(CONFETTI.map((c) => AssetLoader.url(c)));
  const layer = document.createElement("div");
  layer.className = "confetti";
  layer.setAttribute("aria-hidden", "true");
  for (const p of confettiPieces(n)) {
    const img = document.createElement("img");
    img.src = urls[CONFETTI.indexOf(p.name)]!;
    img.alt = "";
    img.className = "confetti-piece";
    img.style.left = `${p.x}%`;
    img.style.width = img.style.height = `${p.size}px`;
    img.style.animationDelay = `${p.delay}ms`;
    img.style.animationDuration = `${p.dur}ms`;
    img.style.setProperty("--drift", `${p.drift}px`);
    img.style.setProperty("--spin", `${p.spin}deg`);
    layer.appendChild(img);
  }
  document.body.appendChild(layer);
  setTimeout(() => layer.remove(), 3800);
}

/** Confetti on the bus's moments: a practice win and a submission. The official reel calls it on a winning run. */
export function ConfettiOnMoments() {
  useEffect(
    () =>
      bus.on((e) => {
        if ((e.kind === "match_end" && e.result === "win") || e.kind === "submitted") void confetti();
      }),
    [],
  );
  return null;
}
