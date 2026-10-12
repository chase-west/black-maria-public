import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { generatePlaceholders } from "./index.js";

function repoRoot(): string {
  let d = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(d, "pnpm-workspace.yaml"))) {
    const up = dirname(d);
    if (up === d) throw new Error("repo root not found");
    d = up;
  }
  return d;
}

const assetsDir = resolve(process.env.ASSETS_DIR ?? join(repoRoot(), "assets"));
const t0 = Date.now();
const { files } = generatePlaceholders(assetsDir);
console.log(`placeholders: wrote ${files} files to ${join(assetsDir, "placeholders")} in ${Date.now() - t0}ms`);
