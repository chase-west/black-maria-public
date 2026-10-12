import { describe, expect, it, vi } from "vitest";

vi.mock("pixi.js", () => ({ Texture: { from: () => ({}) } }));
vi.stubGlobal("fetch", () => Promise.resolve({ ok: false }));

const { candidateUrls } = await import("../src/assets/AssetLoader.js");

const art = { vessel: { file: "vessel.png", px: "px/vessel.png" }, art_title: { file: "art_title.png" } };
const ph = { vessel: { file: "placeholders/vessel.png", px: "placeholders/px/vessel.png" }, fx_puff: { file: "placeholders/fx_puff.png", px: "placeholders/px/fx_puff.png" } };

describe("AssetLoader resolution (SPEC 8.2)", () => {
  it("prefers manifest.json, then manifest.placeholders.json", () => {
    expect(candidateUrls(art, ph, "vessel").map((c) => c.url)).toEqual(["/assets/vessel.png", "/assets/placeholders/vessel.png"]);
  });
  it("ignores a leftover px path in a manifest entry (pixel mode is gone)", () => {
    expect(candidateUrls(art, ph, "vessel").some((c) => c.url.includes("/px/"))).toBe(false);
  });
  it("falls back per name to the placeholder manifest", () => {
    expect(candidateUrls(art, ph, "fx_puff")).toEqual([{ url: "/assets/placeholders/fx_puff.png", from: "placeholder" }]);
  });
  it("names nowhere yield no candidates (the runtime placeholder takes over)", () => {
    expect(candidateUrls(art, ph, "ui_laurel")).toEqual([]);
  });
  it("skips art marked qa_status FAIL and uses the placeholder", () => {
    const failed = { vessel: { file: "vessel.png", qa_status: "FAIL" } as never };
    expect(candidateUrls(failed, ph, "vessel").map((c) => c.from)).toEqual(["placeholder"]);
  });
  it("ignores unsafe paths in a manifest", () => {
    const bad = { vessel: { file: "../../etc/passwd", px: "https://evil.example/x.png" } };
    expect(candidateUrls(bad, {}, "vessel")).toEqual([]);
  });
});
