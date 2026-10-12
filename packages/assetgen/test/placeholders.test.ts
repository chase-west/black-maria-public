import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { RGB } from "@blackmaria/style";
import { CATALOG, RETIRED_ASSETS, generatePlaceholders } from "../src/index.js";

const repoAssetsDoc = ["ASSETS.md", "ASSETS_MAP.md", "ASSETS_SITE.md", "ASSETS_DECOR.md"]
  .map((f) => readFileSync(join(__dirname, "../../..", f), "utf8"))
  .join("\n")
  .split("\n")
  .filter((l) => !/Delete\./.test(l))
  .join("\n");

describe("asset catalog", () => {
  it("covers every filename in ASSETS.md, ASSETS_MAP.md, ASSETS_SITE.md and ASSETS_DECOR.md exactly (except the style sheet and deleted files)", () => {
    const names = new Set([...repoAssetsDoc.matchAll(/`([a-z0-9_]+)\.png`/g)].map((m) => m[1]!));
    // "`you_walk_1.png` through `you_walk_6.png`" names the frames in between too.
    for (const m of repoAssetsDoc.matchAll(/`([a-z_]+_)(\d+)\.png` through `\1(\d+)\.png`/g)) for (let i = Number(m[2]); i <= Number(m[3]); i++) names.add(`${m[1]}${i}`);
    names.delete("_stylesheet");
    // ASSETS_MAP.md replaces these two with the cap and face pairs.
    names.delete("wall_plaster");
    names.delete("wall_stone");
    // Names the v6 rules no longer use (the threshold, the rug, the held ring, the shudder, the v2 icons).
    for (const n of RETIRED_ASSETS) names.delete(n);
    const catalog = new Set(CATALOG.map((e) => e.name));
    expect([...names].filter((n) => !catalog.has(n))).toEqual([]);
    expect([...catalog].filter((n) => !names.has(n))).toEqual([]);
  });
});

describe("placeholder generator", () => {
  const dir = mkdtempSync(join(tmpdir(), "bm-ph-"));
  const subset = new Set(["tile_floor_hall", "vessel", "ui_button", "art_title", "decal_sigil"]);
  const { manifest } = generatePlaceholders(dir, (e) => subset.has(e.name));

  it("writes manifest.placeholders.json and never manifest.json", () => {
    expect(existsSync(join(dir, "manifest.placeholders.json"))).toBe(true);
    expect(existsSync(join(dir, "manifest.json"))).toBe(false);
    expect(Object.keys(manifest).length).toBe(CATALOG.length);
  });

  it("writes no pixel-mode set: no px entries and no placeholders/px directory", () => {
    for (const e of CATALOG) expect(Object.keys(manifest[e.name]!)).not.toContain("px");
    expect(existsSync(join(dir, "placeholders/px"))).toBe(false);
  });

  it("anchors sprites at their feet", () => {
    expect(manifest.vessel!.anchor).toEqual([0.5, 0.85]);
    expect(manifest.tile_floor_hall!.anchor).toEqual([0, 0]);
  });

  it("uses only palette colors or full transparency", () => {
    const allowed = new Set(Object.values(RGB).map(([r, g, b]) => `${r},${g},${b}`));
    for (const n of subset) {
      for (const f of [`placeholders/${n}.png`]) {
        if (!existsSync(join(dir, f))) continue;
        const png = PNG.sync.read(readFileSync(join(dir, f)));
        for (let i = 0; i < png.data.length; i += 4) {
          const a = png.data[i + 3]!;
          if (a === 0) continue;
          expect(a).toBe(255);
          const key = `${png.data[i]},${png.data[i + 1]},${png.data[i + 2]}`;
          if (!allowed.has(key)) throw new Error(`${f}: off-palette pixel ${key}`);
        }
      }
    }
  });
});
