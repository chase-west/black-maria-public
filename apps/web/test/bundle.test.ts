import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PALETTE } from "@blackmaria/style";

const root = join(__dirname, "..");
function walk(d: string, out: string[] = []): string[] {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
const src = walk(join(root, "src")).filter((f) => /\.(ts|tsx|css)$/.test(f));

describe("web: no engine or house-bot code in the browser bundle", () => {
  it("source never imports the engine or the house bots", () => {
    for (const f of src) {
      const text = readFileSync(f, "utf8");
      expect(text, f).not.toMatch(/@blackmaria\/(engine|house-bots|server)/);
      expect(text, f).not.toMatch(/(from|import\()\s*["'][^"']*packages\/(engine|house-bots)/);
    }
  });
  it("only type-only imports from the protocol package (no zod in the bundle)", () => {
    for (const f of src) {
      for (const m of readFileSync(f, "utf8").matchAll(/^import\s+(type\s+)?[^;]*from\s+"@blackmaria\/protocol"/gm)) expect(m[1], f).toBe("type ");
    }
  });
  it("the built bundle carries no engine code", () => {
    const dist = join(root, "dist");
    if (!existsSync(dist)) execSync("npx vite build", { cwd: root, stdio: "ignore" });
    const js = walk(dist).filter((f) => f.endsWith(".js"));
    const sentinels = ["mapgen: no valid map", "objective_complete\",mind", "STREAM", "touchStreak", "blackoutExitWill", "sigilRecharge", "ROOM_FIXTURES"];
    for (const f of js) {
      const text = readFileSync(f, "utf8");
      for (const s of sentinels) expect(text.includes(s), `${f} contains ${s}`).toBe(false);
    }
  });
});

describe("web: visual language (SPEC 8.3)", () => {
  const allowed = new Set(Object.values(PALETTE).map((h) => h.toLowerCase()));
  it("no color outside the seven palette colors appears in any source file", () => {
    for (const f of src) {
      const text = readFileSync(f, "utf8").replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "");
      for (const m of text.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) expect(allowed.has(m[0].toLowerCase()), `${f}: ${m[0]}`).toBe(true);
      expect(/\brgba?\(|\bhsla?\(/.test(text), `${f} uses rgb()/hsl()`).toBe(false);
      const keyword = f.endsWith(".css") ? /:[^;{}]*(?<![\w-])(white|black)(?![\w-])/ : /["'`](white|black)["'`]/;
      expect(keyword.test(text), `${f} uses white/black as a color`).toBe(false);
    }
  });
  it("only the three fonts are named", () => {
    for (const f of src) {
      const text = readFileSync(f, "utf8");
      for (const m of text.matchAll(/font-family:\s*([^;]+);/g)) expect(m[1]!.trim(), f).toMatch(/^var\(--font-(display|body|mono)\)$/);
      for (const m of text.matchAll(/'([A-Z][A-Za-z ]+)'/g)) if (/Mono|Nunito|Fraunces|sans|serif/i.test(m[1]!)) expect(["Space Mono", "Nunito", "Fraunces"], f).toContain(m[1]);
    }
    const html = readFileSync(join(root, "index.html"), "utf8");
    expect(html).toContain("family=Fraunces:opsz,wght,SOFT,WONK@9..144,900,100,1");
    expect(html).toContain("family=Nunito");
    expect(html).toContain("family=Space+Mono");
  });
  it("no browser-native dialogs or select menus (they are not in the visual language)", () => {
    for (const f of src) {
      const text = readFileSync(f, "utf8");
      expect(/window\.confirm|\balert\(|\bprompt\(|<select/.test(text), f).toBe(false);
    }
  });
  it("there are no soft shadows: every box-shadow is hard (zero blur)", () => {
    for (const f of src.filter((x) => x.endsWith(".css"))) {
      for (const m of readFileSync(f, "utf8").matchAll(/box-shadow:\s*([^;]+);/g)) {
        const v = m[1]!.trim();
        if (v.startsWith("var(") || v === "none") continue;
        expect(v, f).toMatch(/^-?\d+(px)? -?\d+(px)? 0( 0)? var\(--cocoa\)$/);
      }
    }
  });
});
