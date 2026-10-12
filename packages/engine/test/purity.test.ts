import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Hard rule: the engine is pure and deterministic, with no I/O.
describe("engine purity", () => {
  const dir = join(__dirname, "../src");
  const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));
  it("imports only its own modules and protocol types", () => {
    for (const f of files) {
      const src = readFileSync(join(dir, f), "utf8");
      for (const m of src.matchAll(/^import\s+(type\s+)?[^"']*from\s+["']([^"']+)["']/gm)) {
        const spec = m[2]!;
        const ok = spec.startsWith("./") || spec === "@blackmaria/protocol" || spec === "@blackmaria/protocol/wire";
        expect(ok, `${f} imports ${spec}`).toBe(true);
      }
    }
  });
  it("never touches clocks, randomness, timers, the network, or the process", () => {
    const banned = [/Math\.random/, /Date\.now/, /new Date/, /performance\./, /setTimeout/, /setInterval/, /process\./, /fetch\(/, /require\(/, /globalThis/, /console\./];
    for (const f of files) {
      const src = readFileSync(join(dir, f), "utf8");
      for (const b of banned) expect(b.test(src), `${f} matches ${b}`).toBe(false);
    }
  });
});
