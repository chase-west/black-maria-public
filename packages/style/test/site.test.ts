import { describe, expect, it } from "vitest";
import { SITE, absoluteAssetUrl, assetFile, renderIndexHtml } from "../src/index.js";

describe("the site head (ASSETS_SITE.md section 6)", () => {
  it("resolves logical names through the manifests, skipping failed and unsafe entries", () => {
    const art = { favicon: { file: "favicon.png" }, og_image: { file: "og.png", qa_status: "FAIL" }, bad: { file: "../etc/passwd" } };
    const ph = { og_image: { file: "ph/og_image.png" } };
    expect(assetFile([art, ph], "favicon")).toBe("favicon.png");
    expect(assetFile([art, ph], "og_image")).toBe("ph/og_image.png");
    expect(assetFile([art, ph], "bad")).toBe("bad.png");
    expect(assetFile([], "missing")).toBe("missing.png");
    expect(absoluteAssetUrl("https://x.test///", [art], "favicon")).toBe("https://x.test/assets/favicon.png");
  });
  it("fills every placeholder and escapes the values", () => {
    const html = renderIndexHtml('<a href="%BM_ASSET:favicon%"></a><b c="%BM_ASSET_URL:og_image%"></b><i d="%BM_PUBLIC_URL%">%BM_TITLE% %BM_DESCRIPTION%</i>', { publicUrl: 'https://x.test/"q', manifests: [{ favicon: { file: "favicon.png" }, og_image: { file: "og_image.png" } }] });
    expect(html).toBe(`<a href="/assets/favicon.png"></a><b c="https://x.test/&quot;q/assets/og_image.png"></b><i d="https://x.test/&quot;q/">Black Maria ${SITE.description}</i>`);
    expect(SITE.description.split(/[.:]\s/).length).toBeLessThanOrEqual(2);
    expect(SITE.description).not.toContain("!");
  });
});
