import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // `blackmaria` is the published client's name: the file `blackmaria init` writes imports it.
  resolve: { conditions: ["source"], alias: [{ find: /^blackmaria$/, replacement: fileURLToPath(new URL("packages/client/src/index.ts", import.meta.url)) }] },
  ssr: { resolve: { conditions: ["source"], externalConditions: ["source"] } },
  test: {
    include: ["packages/*/test/**/*.test.ts", "apps/*/test/**/*.test.ts", "apps/*/test/**/*.test.tsx"],
    testTimeout: 240_000,
    pool: "forks",
    // Real-time wire tests: keep a sleeping Mac awake while they run (DECISIONS.md, "Fix: wire checklist stall").
    globalSetup: ["scripts/vitest-awake.ts"],
  },
});
