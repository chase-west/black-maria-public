import { execFileSync, spawn } from "node:child_process";
import { createSocket } from "node:dgram";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ERR } from "@blackmaria/protocol/wire";
import { LocalHost, WireServer, startWire, type WireMatchInfo, type WireRules } from "@black-maria/sim";
import { ClientError, StarterBot, WireClient, main, resolveTarget, tokenBytes } from "../src/index.js";

const PY = join(__dirname, "../python/blackmaria.py");
const README = readFileSync(join(__dirname, "../README.md"), "utf8");
const hasPython = (() => {
  try {
    execFileSync("python3", ["-c", "import sys; assert sys.version_info >= (3, 9)"]);
    return true;
  } catch {
    return false;
  }
})();

async function serve(o: { tickMs?: number; maxTick?: number; rules?: WireRules; seed?: number; host?: LocalHost } = {}) {
  const host = o.host ?? new LocalHost({ ...(o.rules ? { rules: o.rules } : {}), ...(o.seed !== undefined ? { seed: o.seed } : {}) });
  let live = 0;
  let peak = 0;
  const started = host.matchStarted;
  host.matchStarted = (m: WireMatchInfo) => {
    live++;
    peak = Math.max(peak, live);
    started?.(m);
  };
  const ended = host.matchEnded.bind(host);
  host.matchEnded = (info, st, log) => {
    live--;
    ended(info, st, log);
  };
  const server = new WireServer({ host, tickMs: o.tickMs ?? 250, maxTick: o.maxTick ?? 30, ...(o.rules?.chaosOverride ? { forceChaos: o.rules.chaosOverride } : {}) });
  const port = await server.listen(0, "127.0.0.1");
  return { host, server, port, peak: () => peak };
}

const io = () => {
  const lines: string[] = [];
  const errs: string[] = [];
  return { lines, errs, out: (l: string) => lines.push(l), err: (l: string) => errs.push(l) };
};

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

const MASTER: WireRules = { params: {}, ruleChange: 0, chaosOverride: "master" };

describe("the published client (SPEC 6 item 5)", () => {
  it("completes an official-shaped run, 9 matches, 3 at a time, through the Master network profile", async () => {
    const s = await serve({ rules: MASTER, maxTick: 24 });
    try {
      const results = await new WireClient({ host: "127.0.0.1", ports: [s.port], token: tokenBytes("ab".repeat(16)), official: true, tier: 0, chaos: 0, matches: 1, bot: () => new StarterBot() }).run();
      expect(results).toHaveLength(9);
      expect(s.host.runs).toHaveLength(1);
      expect(s.host.runs[0]!.results.map((r) => r.tier)).toEqual(["novice", "novice", "novice", "adept", "adept", "adept", "master", "master", "master"]);
      expect(s.peak()).toBe(3);
      const logs = s.host.ended.map((e) => e.log);
      expect(logs.every((l) => l.mode === "official" && l.chaos_profile === "master")).toBe(true);
      expect(logs.some((l) => l.chaos.some((c) => c.action === "drop"))).toBe(true);
      // It plays: most moves arrive, even though it never resyncs and sends each move once.
      const onTime = logs.reduce((a, l) => a + [...l.intent_status].filter((c) => c === "o").length, 0) / logs.reduce((a, l) => a + l.ticks.length, 0);
      expect(onTime).toBeGreaterThan(0.5);
      expect(logs.every((l) => Object.keys(l.resyncs).length === 0)).toBe(true);
    } finally {
      s.server.close();
    }
  });

  it("tries UDP 7777 first and moves to the next port when no HELLO_ACK arrives within 2 seconds (SPEC 5.2)", async () => {
    const silent = createSocket("udp4");
    const dead = await new Promise<number>((r) => silent.bind(0, "127.0.0.1", () => r(silent.address().port)));
    const s = await serve({ maxTick: 5, tickMs: 50 });
    try {
      const lines: string[] = [];
      const c = new WireClient({ host: "127.0.0.1", ports: [dead, s.port], token: tokenBytes("cd".repeat(16)), official: false, tier: 0, chaos: 0, matches: 1, bot: () => new StarterBot(), log: (l) => lines.push(l) });
      const t0 = Date.now();
      const r = await c.run();
      expect(r).toHaveLength(1);
      expect(c.connectedPort).toBe(s.port);
      expect(Date.now() - t0).toBeGreaterThanOrEqual(1900);
      expect(lines).toContain(`No answer on UDP port ${dead}; trying port ${s.port}.`);
    } finally {
      s.server.close();
      silent.close();
    }
  });

  it("stops with the server's sentence when the token is refused, or the official run is used", async () => {
    class Refusing extends LocalHost {
      override authenticate(): string | null {
        return null;
      }
    }
    class Used extends LocalHost {
      override beginRun(): ReturnType<LocalHost["beginRun"]> {
        return ERR.NO_ATTEMPTS;
      }
    }
    for (const [host, code, text] of [
      [new Refusing(), 1, "Unknown token. Use the token from your magic link."],
      [new Used(), 3, "You've used your official run. Start a practice session instead."],
    ] as const) {
      const s = await serve({ host, maxTick: 5 });
      try {
        const err = await new WireClient({ host: "127.0.0.1", ports: [s.port], token: tokenBytes("ef".repeat(16)), official: true, tier: 0, chaos: 0, matches: 1, bot: () => new StarterBot() }).run().then(
          () => null,
          (e: unknown) => e,
        );
        expect(err).toBeInstanceOf(ClientError);
        expect((err as ClientError).code).toBe(code);
        expect((err as ClientError).message).toBe(text);
      } finally {
        s.server.close();
      }
    }
  });

  it("blackmaria play --vs novice: reads the ports from ./.env and prints each result in plain words", async () => {
    const s = await serve({ maxTick: 20, tickMs: 50 });
    const dir = mkdtempSync(join(tmpdir(), "bm-client-"));
    writeFileSync(join(dir, ".env"), `BM_PORTS=${s.port}\n`);
    try {
      const o = io();
      expect(await main(["play", "--vs", "novice", "--n", "2"], o, {}, dir)).toBe(0);
      const text = o.lines.join("\n");
      expect(text).toContain("No server set, so this plays a local simulator on 127.0.0.1");
      // No --chaos: practice plays on Novice's network, like the official run.
      expect(text).toContain("Practice against Maria (Novice) on 127.0.0.1, 2 matches, network novice.");
      expect(s.host.ended.map((e) => e.log.chaos_profile)).toEqual(["novice", "novice"]);
      expect(text).toMatch(/Connected on UDP port \d+: no clock \(a local simulator\)/);
      expect(o.lines.filter((l) => /^Match \d+ against Maria \(Novice\): (you won|you lost|draw)/.test(l))).toHaveLength(2);
      expect(text).toMatch(/2 matches: \d won, \d drawn, \d lost\./);
      expect(text).not.toMatch(/\bintent|objective/i);
      const bad = io();
      expect(await main(["play", "--vs", "wizard"], bad, {}, dir)).toBe(2);
      expect(bad.errs[0]).toBe("--vs takes novice, adept or master, not wizard.");
      const noToken = io();
      expect(await main(["play", "--vs", "novice", "--host", "wire.example.com"], noToken, {}, dir)).toBe(2);
      expect(noToken.errs[0]).toMatch(/^Set BM_TOKEN or pass --token/);
    } finally {
      s.server.close();
    }
  });

  it("asks the portal's /api/me for the wire host and ports, with the token as a bearer", async () => {
    const token = "12".repeat(16);
    const http = createServer((req, res) => {
      if (req.url === "/api/me" && req.headers.authorization === `Bearer ${token}`) {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ token, wire: { host: "wire.example.com", ports: [7777, 443] } }));
      } else {
        res.statusCode = 401;
        res.end("{}");
      }
    });
    const port = await new Promise<number>((r) => http.listen(0, "127.0.0.1", () => r((http.address() as { port: number }).port)));
    try {
      const t = await resolveTarget({}, { BM_SERVER: `http://127.0.0.1:${port}`, BM_TOKEN: token }, tmpdir());
      expect(t).toMatchObject({ host: "wire.example.com", ports: [7777, 443], token, note: null });
      await expect(resolveTarget({}, { BM_SERVER: `http://127.0.0.1:${port}`, BM_TOKEN: "34".repeat(16) }, tmpdir())).rejects.toThrow(/doesn't know that token/);
      await expect(resolveTarget({ token: "nothex" }, {}, tmpdir())).rejects.toThrow(/32 characters/);
    } finally {
      http.close();
    }
  });

  it("the README lists its weaknesses exactly as SPEC 6 describes them", () => {
    const list = README.split("## Known weaknesses")[1]!.split("\n## ")[0]!;
    for (const w of ["It waits for `STATE` before thinking.", "It never resyncs.", "After a lost keyframe it drives blind until the next one.", "It does not skip repeats.", "It hard-codes every parameter.", "Its bot goes for the nearest errand, ignores expiry, never snatches, and never steps out of reach when Maria winds up a snatch."])
      expect(list).toContain(w);
    expect(README).toContain("npx blackmaria play --vs novice");
    expect(README).toContain("npx blackmaria official");
    expect(README).toMatch(/UDP 7777 first.*UDP 443/s);
    expect(README.replace(/`[^`]*`/g, "")).not.toMatch(/\bintent\b|\bobjective/i);
  });

  it("sim wire --check grades it: the handshake, seq, PING and fragments pass; resync and hard-coded parameters fail", async () => {
    const o = io();
    let port = 0;
    const server = await startWire(["--check", "--port", "0", "--max-tick", "140", "--tick-ms", "150", "--chaos", "novice", "--seed", "5"], o, (_srv, p) => {
      port = p;
    });
    try {
      await new WireClient({ host: "127.0.0.1", ports: [port], token: tokenBytes("56".repeat(16)), official: false, tier: 1, chaos: 0, matches: 1, bot: () => new StarterBot() }).run();
      for (let i = 0; i < 100 && !o.lines.join("\n").includes("Checklist"); i++) await new Promise((r) => setTimeout(r, 50));
      const text = o.lines.join("\n");
      const status = (n: number) => new RegExp(`^\\s*${n}\\. (pass|FAIL|not checked) `, "m").exec(text)?.[1];
      expect(status(1)).toBe("pass");
      expect(status(2)).toBe("pass");
      expect(status(3)).toBe("pass");
      expect(status(4)).toBe("pass");
      expect(status(5)).toBe("FAIL");
      expect(status(6)).toBe("FAIL");
      expect(status(9)).toBe("not checked");
      expect(status(10)).toBe("FAIL");
      expect(text).toContain("inventory_slots was 3 and it sent TAKE with a full inventory");
      // And the summary block, as the server saw this client.
      expect(text).toMatch(/^Connection, as the server saw it:\n {2}on time {10}\d+ of 140 \(\d+\.\d%\)$/m);
      expect(text).toMatch(/^ {2}round trip {7}p50 \d+ ms, p95 \d+ ms, from \d+ pings$/m);
      expect(text).toMatch(/^ {2}duplicates {7}\d+ arrived twice$/m);
      expect(text).toMatch(/^ {2}blackout {9}(none seen|400 ms from tick \d+: acted on \d+ of \d+ ticks)/m);
      expect(text).toMatch(/^ {2}deadline margin {2}late +\d+/m);
    } finally {
      server.close();
    }
  });

  it("sim wire --log prints every chaos action as it happens: match, tick, seq, direction, packet, what happened", async () => {
    const o = io();
    let port = 0;
    const server = await startWire(["--port", "0", "--chaos", "master", "--log", "--seed", "150", "--max-tick", "112", "--tick-ms", "60"], o, (_srv, p) => {
      port = p;
    });
    try {
      await new WireClient({ host: "127.0.0.1", ports: [port], token: tokenBytes("6b".repeat(16)), official: false, tier: 0, chaos: 0, matches: 1, bot: () => new StarterBot() }).run();
      for (let i = 0; i < 40 && !o.lines.some((l) => l.includes(") ended:")); i++) await new Promise((r) => setTimeout(r, 50));
      const lines = o.lines.filter((l) => l.startsWith("chaos  "));
      expect(lines.length).toBeGreaterThan(200);
      for (const l of lines) expect(l).toMatch(/^chaos {2}match +\d+ {2}tick +(\d+|-) {2}seq +(\d+|-) {2}(down|up|both) +[A-Z_]* +(delayed \d+ ms|duplicated, delayed \d+ and \d+ ms|held, goes out after the next one|dropped|lost in the blackout|blackout: nothing gets through either way for 400 ms)$/);
      expect(lines).toContain("chaos  match   1  tick 105  seq     -  both              blackout: nothing gets through either way for 400 ms");
      expect(lines.some((l) => / down STATE +dropped$/.test(l))).toBe(true);
      expect(lines.some((l) => / up {3}INTENT +delayed \d+ ms$/.test(l))).toBe(true);
      // The same actions the replay logs: every drop and everything lost in the blackout, one line each.
      const log = (server.host as LocalHost).ended[0]!.log;
      expect(lines.filter((l) => l.endsWith(" dropped")).length).toBe(log.chaos.filter((c) => c.action === "drop").length);
      expect(lines.filter((l) => l.includes("blackout")).length).toBe(log.chaos.filter((c) => c.action === "blackhole").length);
      expect(lines.length).toBeLessThanOrEqual(log.chaos.length);
    } finally {
      server.close();
    }
  });

  describe.skipIf(!hasPython)("Python", () => {
    it("plays exactly the same moves as the TypeScript client on a clean link", async () => {
      const s = await serve({ maxTick: 120, tickMs: 60, seed: 7 });
      try {
        await new WireClient({ host: "127.0.0.1", ports: [s.port], token: tokenBytes("78".repeat(16)), official: false, tier: 2, chaos: 0, matches: 1, bot: () => new StarterBot() }).run();
        const py = await runPython(["play", "--vs", "master", "--chaos", "off", "--ports", String(s.port), "--token", "9a".repeat(16)], tmpdir());
        expect(py.err).toBe("");
        expect(py.code).toBe(0);
        expect(py.out).toMatch(/Match \d+ against Maria \(Master\): /);
        expect(s.host.ended).toHaveLength(2);
        const [ts, pyLog] = s.host.ended.map((e) => e.log);
        expect(ts!.intent_status).toBe("o".repeat(120));
        expect(pyLog!.intent_status).toBe("o".repeat(120));
        expect(pyLog!.ticks.map((t) => t.you)).toEqual(ts!.ticks.map((t) => t.you));
      } finally {
        s.server.close();
      }
    });

    it("completes an official-shaped run through the Master network profile", async () => {
      const s = await serve({ rules: MASTER, maxTick: 24 });
      try {
        const py = await runPython(["official", "--ports", String(s.port), "--quiet"], tmpdir());
        expect(py.err).toBe("");
        expect(py.code).toBe(0);
        expect(py.out).toMatch(/^Official run done\. Novice \d of 3 won, Adept \d of 3, Master \d of 3\. Score \d+ out of 39\.$/m);
        expect(s.host.runs).toHaveLength(1);
        expect(s.peak()).toBe(3);
        expect(s.host.ended.every((e) => e.log.chaos_profile === "master")).toBe(true);
      } finally {
        s.server.close();
      }
    });

    it("refuses bad input with one sentence", async () => {
      const r = await runPython(["play", "--vs", "wizard"], tmpdir());
      expect(r.code).toBe(1);
      expect(r.err.trim()).toBe("--vs takes novice, adept or master, not wizard.");
    });
  });
});

