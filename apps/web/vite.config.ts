import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { renderIndexHtml, type SiteManifest } from "../../packages/style/src/site.js";

const target = process.env.BM_SERVER_HTTP ?? "http://localhost:8787";
const assetsDir = fileURLToPath(new URL("../../assets/", import.meta.url));

function readManifest(file: string): SiteManifest {
  try {
    const j: unknown = JSON.parse(readFileSync(assetsDir + file, "utf8"));
    return j && typeof j === "object" && !Array.isArray(j) ? (j as SiteManifest) : {};
  } catch {
    return {};
  }
}

/**
 * The dev server fills the head's placeholders (favicon, social card) the way the server does for the built page.
 * The build leaves them in, for the server to fill with its PUBLIC_URL at request time.
 */
function siteHead(): Plugin {
  return {
    name: "blackmaria-site-head",
    apply: "serve",
    transformIndexHtml: {
      order: "pre",
      handler: (html) => renderIndexHtml(html, { publicUrl: process.env.PUBLIC_URL ?? "http://localhost:5173", manifests: [readManifest("manifest.json"), readManifest("manifest.placeholders.json")] }),
    },
  };
}

export default defineConfig({
  plugins: [react(), siteHead()],
  resolve: { conditions: ["source", "browser", "module", "import", "default"] },
  build: { assetsDir: "static", sourcemap: true, chunkSizeWarningLimit: 2000 },
  server: {
    port: 5173,
    proxy: {
      "/api": target,
      "/enter": target,
      "/assets": target,
      "/ws": { target: target.replace(/^http/, "ws"), ws: true },
    },
  },
});
