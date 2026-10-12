/**
 * `blackmaria init` writes the bot file, in TypeScript and in Python, and that file plays exactly like the shipped
 * client. Practice plays on its Maria's network unless `--chaos off` says otherwise.
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LocalHost, WireServer } from "@black-maria/sim";
import { HOOK_NAMES, main } from "../src/index.js";

const PY = join(__dirname, "../python/blackmaria.py");
const TEMPLATES = join(__dirname, "../templates");
const README = readFileSync(join(__dirname, "../README.md"), "utf8");
const hasPython = (() => {
  try {
    execFileSync("python3", ["-c", "import sys; assert sys.version_info >= (3, 9)"]);
    return true;
  } catch {
    return false;
  }
})();

const io = () => {
  const lines: string[] = [];
  const errs: string[] = [];
  return { lines, errs, out: (l: string) => lines.push(l), err: (l: string) => errs.push(l) };
};
const fresh = () => mkdtempSync(join(tmpdir(), "bm-init-"));

function runPython(args: string[], cwd: string): Promise<{ code: number; out: string; err: string }> {
  return new Promise((res) => {
    const p = spawn("python3", [PY, ...args], { cwd, env: { PATH: process.env.PATH ?? "" } });
    let out = "";
    let err = "";
    p.stdout.on("data", (d: Buffer) => (out += d.toString()));
    p.stderr.on("data", (d: Buffer) => (err += d.toString()));
    p.on("close", (code) => res({ code: code ?? -1, out, err }));
  });
}

async function serve(seed: number) {
  const host = new LocalHost({ seed });
  const server = new WireServer({ host, tickMs: 60, maxTick: 120 });
  const port = await server.listen(0, "127.0.0.1");
  return { host, server, port };
}

/** The "called" column of the README's hook table, one sentence per hook, as the comment above each hook reads. */
function readmeSentences(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of README.split("\n")) {
    const m = /^\| `(\w+)\(.*?\)` \| (.+?) \| .+ \|$/.exec(line);
    if (!m) continue;
    const first = m[2]!.split(/(?<=\.) /)[0]!;
    out[m[1]!] = `Called ${first.endsWith(".") ? first : first + "."}`;
  }
  return out;
}

describe("blackmaria init", () => {
  it("writes my_bot.ts with a package.json, my_bot.py without one, --lang picks, and it never overwrites", async () => {
    const ts = fresh();
    writeFileSync(join(ts, "package.json"), "{}\n");
    const a = io();
    expect(await main(["init"], a, {}, ts)).toBe(0);
    expect(a.lines).toEqual(["Wrote my_bot.ts. Run it:", "  npx blackmaria play --vs master --bot my_bot.ts --trace"]);
    expect(readFileSync(join(ts, "my_bot.ts"), "utf8")).toBe(readFileSync(join(TEMPLATES, "my_bot.ts"), "utf8"));
    writeFileSync(join(ts, "my_bot.ts"), "// mine\n");
    const again = io();
    expect(await main(["init"], again, {}, ts)).toBe(1);
    expect(again.errs).toEqual(["my_bot.ts is already here. init won't overwrite it."]);
    expect(readFileSync(join(ts, "my_bot.ts"), "utf8")).toBe("// mine\n");

    const py = fresh();
    const b = io();
    expect(await main(["init"], b, {}, py)).toBe(0);
    expect(b.lines[0]).toBe("Wrote my_bot.py. Run it:");
    expect(b.lines[1]).toMatch(/^ {2}python3 \S*blackmaria\.py play --vs master --bot my_bot\.py --trace$/);
    expect(existsSync(join(py, "my_bot.ts"))).toBe(false);
    expect(await main(["init", "--lang", "ts"], io(), {}, py)).toBe(0);
    expect(existsSync(join(py, "my_bot.ts"))).toBe(true);
    const bad = io();
    expect(await main(["init", "--lang", "rb"], bad, {}, py)).toBe(2);
    expect(bad.errs).toEqual(["--lang takes ts or py, not rb."]);
  });

  it("the file: three header lines, the bot, and each of the five hooks under the README's sentence for it", () => {
    const sentences = readmeSentences();
    expect(Object.keys(sentences).sort()).toEqual([...HOOK_NAMES].sort());
    for (const [name, def] of [
      ["my_bot.ts", (h: string) => `export function ${h}(`],
      ["my_bot.py", (h: string) => `def ${h}(`],
    ] as const) {
      const lines = readFileSync(join(TEMPLATES, name), "utf8").split("\n");
      const c = name.endsWith(".ts") ? "//" : "#";
      expect(lines[0]).toMatch(new RegExp(`^${c} ${name.replace(".", "\\.")}: `));
      expect(lines[1]).toMatch(new RegExp(`^${c} Run it: .*play --vs master --bot ${name.replace(".", "\\.")} --trace$`));
      expect(lines[2]).toMatch(new RegExp(`^${c} The state's shape: `));
      expect(lines[3]!.startsWith(c)).toBe(false);
      for (const h of HOOK_NAMES) {
        const at = lines.findIndex((l) => l.startsWith(def(h)));
        expect(at, `${name} ${h}`).toBeGreaterThan(0);
        expect(lines[at - 1], `${name} ${h}`).toBe(`${c} ${sentences[h]}`);
        expect(lines[at - 2], `${name} ${h}`).toBe("");
      }
      // Comments are the header and the five sentences, nothing else.
      expect(lines.filter((l) => l.trim().startsWith(c)).length).toBe(3 + HOOK_NAMES.length);
      expect(lines.join("\n")).not.toMatch(/\b(weakness|better|should|faster|instead|ahead|guess)\b/i);
    }
  });

  it("--bot my_bot.ts plays the same moves as the shipped client on a fixed seed over a clean link", async () => {
    const dir = fresh();
    writeFileSync(join(dir, "package.json"), "{}\n");
    expect(await main(["init"], io(), {}, dir)).toBe(0);
    const s = await serve(11);
    try {
      const shipped = io();
      expect(await main(["play", "--vs", "master", "--chaos", "off", "--ports", String(s.port), "--quiet"], shipped, {}, dir)).toBe(0);
      const mine = io();
      expect(await main(["play", "--vs", "master", "--chaos", "off", "--ports", String(s.port), "--bot", "my_bot.ts", "--trace", "--quiet"], mine, {}, dir)).toBe(0);
      expect(mine.errs).toEqual([]);
      expect(mine.lines).toContain("Practice against Maria (Master) on 127.0.0.1, 1 match, network off, clean link.");
      // The scaffold's onTick printed the trace.
      expect(mine.lines.filter((l) => /^\s+\d+\s+\d+\s+(\+\d+ ms|missing)\s/.test(l)).length).toBeGreaterThanOrEqual(100);
      const [a, b] = s.host.ended.map((e) => e.log);
      expect(a!.chaos_profile).toBeNull();
      expect(a!.intent_status).toBe("o".repeat(120));
      expect(b!.intent_status).toBe("o".repeat(120));
      expect(b!.ticks.map((t) => t.you)).toEqual(a!.ticks.map((t) => t.you));
    } finally {
      s.server.close();
    }
  });

  describe.skipIf(!hasPython)("Python", () => {
    it("python3 blackmaria.py init writes my_bot.py, and never overwrites it", async () => {
      const dir = fresh();
      const r = await runPython(["init"], dir);
      expect(r.err).toBe("");
      expect(r.code).toBe(0);
      expect(r.out).toMatch(/^Wrote my_bot\.py\. Run it:\n {2}python3 \S*blackmaria\.py play --vs master --bot my_bot\.py --trace\n$/);
      const text = readFileSync(join(dir, "my_bot.py"), "utf8");
      const template = readFileSync(join(TEMPLATES, "my_bot.py"), "utf8");
      expect(text.split("\n").slice(2)).toEqual(template.split("\n").slice(2));
      const again = await runPython(["init"], dir);
      expect(again.code).toBe(1);
      expect(again.err.trim()).toBe("my_bot.py is already here. init won't overwrite it.");
      const ts = fresh();
      writeFileSync(join(ts, "package.json"), "{}\n");
      expect((await runPython(["init"], ts)).out).toContain("Wrote my_bot.ts.");
      expect(readFileSync(join(ts, "my_bot.ts"), "utf8")).toBe(readFileSync(join(TEMPLATES, "my_bot.ts"), "utf8"));
    });

    it("--bot my_bot.py plays the same moves as the shipped Python client on a fixed seed over a clean link", async () => {
      const dir = fresh();
      expect((await runPython(["init"], dir)).code).toBe(0);
      const s = await serve(13);
      try {
        const shipped = await runPython(["play", "--vs", "master", "--chaos", "off", "--ports", String(s.port), "--quiet"], dir);
        expect(shipped.code).toBe(0);
        const mine = await runPython(["play", "--vs", "master", "--chaos", "off", "--ports", String(s.port), "--bot", "my_bot.py", "--trace", "--quiet"], dir);
        expect(mine.err).toBe("");
        expect(mine.code).toBe(0);
        expect(mine.out).toContain("Practice against Maria (Master) on 127.0.0.1, 1 match, network off, clean link.");
        expect(mine.out.split("\n").filter((l) => /^\s+\d+\s+\d+\s+(\+\d+ ms|missing)\s/.test(l)).length).toBeGreaterThanOrEqual(100);
        const [a, b] = s.host.ended.map((e) => e.log);
        expect(a!.intent_status).toBe("o".repeat(120));
        expect(b!.intent_status).toBe("o".repeat(120));
        expect(b!.ticks.map((t) => t.you)).toEqual(a!.ticks.map((t) => t.you));
      } finally {
        s.server.close();
      }
    });
  });
});

describe("practice plays on its Maria's network by default", () => {
  it("TypeScript: --vs picks the profile, --chaos off turns it off, --chaos picks another", async () => {
    const host = new LocalHost({ seed: 3 });
    const server = new WireServer({ host, tickMs: 40, maxTick: 20 });
    const port = await server.listen(0, "127.0.0.1");
    try {
      for (const [args, said, profile] of [
        [["--vs", "adept"], "Practice against Maria (Adept) on 127.0.0.1, 1 match, network adept.", "adept"],
        [["--vs", "adept", "--chaos", "off"], "Practice against Maria (Adept) on 127.0.0.1, 1 match, network off, clean link.", null],
        [["--vs", "novice", "--chaos", "master"], "Practice against Maria (Novice) on 127.0.0.1, 1 match, network master.", "master"],
      ] as const) {
        const o = io();
        expect(await main(["play", ...args, "--ports", String(port), "--quiet"], o, {}, tmpdir())).toBe(0);
        expect(o.lines).toContain(said);
        expect(host.ended[host.ended.length - 1]!.log.chaos_profile).toBe(profile);
      }
    } finally {
      server.close();
    }
  });

  it.skipIf(!hasPython)("Python: the same", async () => {
    const host = new LocalHost({ seed: 4 });
    const server = new WireServer({ host, tickMs: 40, maxTick: 20 });
    const port = await server.listen(0, "127.0.0.1");
    try {
      for (const [args, said, profile] of [
        [["--vs", "master"], "Practice against Maria (Master) on 127.0.0.1, 1 match, network master.", "master"],
        [["--vs", "master", "--chaos", "off"], "Practice against Maria (Master) on 127.0.0.1, 1 match, network off, clean link.", null],
        [["--vs", "adept", "--chaos", "novice"], "Practice against Maria (Adept) on 127.0.0.1, 1 match, network novice.", "novice"],
      ] as const) {
        const r = await runPython(["play", ...args, "--ports", String(port), "--quiet"], tmpdir());
        expect(r.code).toBe(0);
        expect(r.out.split("\n")).toContain(said);
        expect(host.ended[host.ended.length - 1]!.log.chaos_profile).toBe(profile);
      }
    } finally {
      server.close();
    }
  });
});
