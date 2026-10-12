/**
 * The site's head and email art, by logical asset name (ASSETS_SITE.md). Pure: the caller reads the manifests.
 * The server fills the built `index.html` with these at request time, and the Vite dev server does the same, so
 * the favicon and the social card resolve through `assets/manifest.json` like every other image.
 */

/** One manifest entry, as far as the site needs it. */
export interface SiteManifestEntry {
  file?: unknown;
  qa_status?: unknown;
}
export type SiteManifest = Record<string, SiteManifestEntry | undefined>;

/** What a link preview says (SPEC 8.5: plain words, no marketing). */
export const SITE = {
  title: "Black Maria",
  description: "You get 90 minutes and a bot that already plays, badly. Make it beat Maria over the wire, then play the official run.",
} as const;

const SAFE_PATH = /^[A-Za-z0-9_][A-Za-z0-9_./-]*$/;

/**
 * The file for a logical name, relative to the assets route: the first manifest (art, then placeholders) with a safe
 * path that did not fail QA, else `<name>.png`, which the placeholder manifest generator always writes.
 */
export function assetFile(manifests: readonly SiteManifest[], name: string): string {
  for (const m of manifests) {
    const e = m[name];
    if (!e || e.qa_status === "FAIL") continue;
    if (typeof e.file === "string" && SAFE_PATH.test(e.file) && !e.file.includes("..")) return e.file;
  }
  return `${name}.png`;
}

/** The public origin with no trailing slash. */
export function siteOrigin(publicUrl: string): string {
  return publicUrl.replace(/\/+$/, "");
}

/** An absolute URL for an asset, for crawlers and email clients that cannot resolve a path. */
export function absoluteAssetUrl(publicUrl: string, manifests: readonly SiteManifest[], name: string): string {
  return `${siteOrigin(publicUrl)}/assets/${assetFile(manifests, name)}`;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/**
 * Fill the placeholders in `index.html`:
 * `%BM_ASSET:name%` (a path under `/assets/`), `%BM_ASSET_URL:name%` (the same, absolute on `publicUrl`),
 * `%BM_PUBLIC_URL%`, `%BM_TITLE%` and `%BM_DESCRIPTION%`. Every value is escaped for an attribute.
 */
export function renderIndexHtml(html: string, opts: { publicUrl: string; manifests: readonly SiteManifest[] }): string {
  const origin = siteOrigin(opts.publicUrl);
  return html
    .replace(/%BM_ASSET:([a-z0-9_]+)%/g, (_m, n: string) => escapeHtml(`/assets/${assetFile(opts.manifests, n)}`))
    .replace(/%BM_ASSET_URL:([a-z0-9_]+)%/g, (_m, n: string) => escapeHtml(absoluteAssetUrl(origin, opts.manifests, n)))
    .replace(/%BM_PUBLIC_URL%/g, () => escapeHtml(`${origin}/`))
    .replace(/%BM_TITLE%/g, () => escapeHtml(SITE.title))
    .replace(/%BM_DESCRIPTION%/g, () => escapeHtml(SITE.description));
}
