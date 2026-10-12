import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CATALOG, anchorFor, type CatalogEntry, type ManifestEntry } from "@blackmaria/style";
import { drawPlaceholder } from "./draw.js";

export { CATALOG, anchorFor, ROOM_NAMES, FIXTURE_ASSETS, ITEM_ASSETS, RETIRED_ASSETS, type CatalogEntry, type ManifestEntry, type AssetKind } from "@blackmaria/style";
export { drawPlaceholder } from "./draw.js";
export { Canvas } from "./raster.js";

/** Placeholder pixel size: a quarter of nominal, at least 64 on the short side. */
export function placeholderSize(e: CatalogEntry): [number, number] {
  const [w, h] = e.size;
  const k = Math.max(0.25, 64 / Math.min(w, h));
  return [Math.round(w * k), Math.round(h * k)];
}

export interface GenerateResult {
  manifest: Record<string, ManifestEntry>;
  files: number;
}

/**
 * Write `placeholders/<file>` and `manifest.placeholders.json` under `assetsDir`.
 * Never touches `manifest.json` or real art: those are owned by the art pipeline.
 */
export function generatePlaceholders(assetsDir: string, only?: (e: CatalogEntry) => boolean): GenerateResult {
  const outDir = join(assetsDir, "placeholders");
  mkdirSync(outDir, { recursive: true });
  const manifest: Record<string, ManifestEntry> = {};
  let files = 0;
  for (const e of CATALOG) {
    const file = `${e.name}.png`;
    const entry: ManifestEntry = { file: `placeholders/${file}`, kind: e.kind, size: e.size, anchor: anchorFor(e.kind) };
    manifest[e.name] = entry;
    if (only && !only(e)) continue;
    const [w, h] = placeholderSize(e);
    writeFileSync(join(outDir, file), drawPlaceholder(e, w, h).png());
    files++;
  }
  writeFileSync(join(assetsDir, "manifest.placeholders.json"), JSON.stringify(manifest, null, 2) + "\n");
  return { manifest, files };
}
