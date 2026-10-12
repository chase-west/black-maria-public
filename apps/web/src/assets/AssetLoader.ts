import { Texture } from "pixi.js";
import { CATALOG, anchorFor, type AssetKind, type ManifestEntry } from "@blackmaria/style";
import { drawPlaceholder } from "./placeholder.js";

export interface AssetInfo {
  name: string;
  kind: AssetKind;
  size: [number, number];
  anchor: [number, number];
}

export type Manifest = Record<string, Partial<ManifestEntry>>;

const SAFE_PATH = /^[A-Za-z0-9_][A-Za-z0-9_./-]*$/;

function clean(p: unknown): string | null {
  return typeof p === "string" && SAFE_PATH.test(p) && !p.includes("..") ? p : null;
}

async function fetchManifest(url: string): Promise<Manifest> {
  try {
    const r = await fetch(url, { cache: "no-cache" });
    if (!r.ok) return {};
    const j: unknown = await r.json();
    return j && typeof j === "object" && !Array.isArray(j) ? (j as Manifest) : {};
  } catch {
    return {};
  }
}

/**
 * Candidate URLs for a name, best first: art manifest, then placeholder manifest. Only each entry's
 * `file` is used; any other path in an entry (such as the retired `px`) is ignored. Unsafe paths are ignored.
 */
export function candidateUrls(art: Manifest, ph: Manifest, name: string, base = "/assets/"): { url: string; from: "art" | "placeholder" }[] {
  const out: { url: string; from: "art" | "placeholder" }[] = [];
  for (const [m, from] of [
    [art, "art"],
    [ph, "placeholder"],
  ] as const) {
    const e = m[name];
    if (!e) continue;
    // Art the pipeline marked as failing its QA is skipped in favor of the placeholder.
    if ((e as { qa_status?: unknown }).qa_status === "FAIL") continue;
    const file = clean(e.file);
    if (file) out.push({ url: base + file, from });
  }
  return out;
}

/**
 * An image's aspect ratio as CSS (`w / h`), known before it loads: from the catalog, which every manifest entry
 * matches. The DOM reserves the image's box with it, so nothing moves when the image arrives.
 */
export function aspectOf(name: string): string | null {
  const size = CATALOG.find((c) => c.name === name)?.size;
  return size ? `${size[0]} / ${size[1]}` : null;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`missing ${url}`));
    img.src = url;
  });
}

/**
 * Every image goes through here, by logical name (ASSETS.md filenames).
 * Resolution per name: `assets/manifest.json` (owned by the art pipeline), then
 * `assets/manifest.placeholders.json` (generated), then a placeholder drawn at runtime.
 */
class Loader {
  private art: Manifest = {};
  private ph: Manifest = {};
  private readonly textures = new Map<string, Promise<Texture>>();
  private readonly urls = new Map<string, Promise<string>>();
  private readonly sources = new Map<string, "art" | "placeholder" | "runtime">();
  readonly ready: Promise<void>;

  constructor(private readonly base = "/assets/") {
    this.ready = Promise.all([fetchManifest(`${base}manifest.json`), fetchManifest(`${base}manifest.placeholders.json`)]).then(([a, p]) => {
      this.art = a;
      this.ph = p;
    });
  }

  info(name: string): AssetInfo {
    const e = this.art[name] ?? this.ph[name];
    const cat = CATALOG.find((c) => c.name === name);
    const kind = (e?.kind ?? cat?.kind ?? "sprite") as AssetKind;
    const size = Array.isArray(e?.size) && e.size.length === 2 ? (e.size as [number, number]) : (cat?.size ?? [1024, 1024]);
    const anchor = Array.isArray(e?.anchor) && e.anchor.length === 2 ? (e.anchor as [number, number]) : anchorFor(kind);
    return { name, kind, size, anchor };
  }

  private candidates(name: string): { url: string; from: "art" | "placeholder" }[] {
    return candidateUrls(this.art, this.ph, name, this.base);
  }

  private async resolve(name: string): Promise<{ img: CanvasImageSource; url: string }> {
    await this.ready;
    for (const c of this.candidates(name)) {
      try {
        const img = await loadImage(c.url);
        this.sources.set(name, c.from);
        return { img, url: c.url };
      } catch {
        /* next candidate */
      }
    }
    try {
      await document.fonts?.load("700 12px 'Space Mono'");
    } catch {
      /* draw with the fallback face */
    }
    const canvas = drawPlaceholder(this.info(name));
    this.sources.set(name, "runtime");
    return { img: canvas, url: canvas.toDataURL("image/png") };
  }

  /** A PixiJS texture for a logical asset name. Never rejects. */
  get(name: string): Promise<Texture> {
    let t = this.textures.get(name);
    if (!t) {
      t = this.resolve(name).then(({ img }) => {
        return Texture.from(img as HTMLImageElement);
      });
      this.textures.set(name, t);
    }
    return t;
  }

  /** A URL usable in the DOM (an image URL or a placeholder data URL). Never rejects. */
  url(name: string): Promise<string> {
    let u = this.urls.get(name);
    if (!u) {
      u = this.resolve(name).then(({ url }) => url);
      this.urls.set(name, u);
    }
    return u;
  }

  /** Where a resolved asset came from, once loaded. */
  source(name: string): "art" | "placeholder" | "runtime" | undefined {
    return this.sources.get(name);
  }

  preload(names: string[]): Promise<Texture[]> {
    return Promise.all(names.map((n) => this.get(n)));
  }
}

export const AssetLoader = new Loader();
export type { Loader };
