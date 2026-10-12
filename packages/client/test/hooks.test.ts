/**
 * The transport's five hooks, one test each, in TypeScript and in Python (SPEC 6 item 5, the networking interface).
 * Each test plays a short match against the local wire server and checks what the server saw.
 */
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Intent, StateMsg } from "@blackmaria/protocol";
import { KEYFRAME, type Packet, type TickRecord } from "@blackmaria/protocol/wire";
import { LocalHost, WireServer, type ReplayLog } from "@black-maria/sim";
import { StarterBot, Transport, main, tokenBytes, type Delta, type TransportOptions, type WirePacket } from "../src/index.js";

const PY = join(__dirname, "../python/blackmaria.py");
const hasPython = (() => {
  try {
    execFileSync("python3", ["-c", "import sys; assert sys.version_info >= (3, 9)"]);
    return true;
  } catch {
    return false;
  }
})();

interface Serve {
  tickMs: number;
  maxTick: number;
  /** Withhold these server packets entirely (they still take a seq, like a loss). */
  hold?: (p: Packet) => boolean;
  /** Withhold the STATE of these ticks and send the next one as a delta against it (`sim wire --check`'s probe). */
  probe?: (tick: number) => boolean;
}

async function serve(o: Serve) {
  const host = new LocalHost({ seed: 9 });
  const server = new WireServer({ host, tickMs: o.tickMs, maxTick: o.maxTick, ...(o.hold ? { observer: { hold: (_k: string, p: Packet) => o.hold!(p) } } : {}), ...(o.probe ? { probe: o.probe } : {}) });
  const port = await server.listen(0, "127.0.0.1");
  const log = (): ReplayLog => host.ended[host.ended.length - 1]!.log;
  return { host, server, port, log };
}

const opts = (port: number, extra: Partial<TransportOptions> = {}): TransportOptions => ({ host: "127.0.0.1", ports: [port], token: tokenBytes("3c".repeat(16)), official: false, tier: 0, chaos: 0, matches: 1, bot: () => new StarterBot(), ...extra });

/** A non-keyframe STATE withheld every 5 ticks (3, 8, 13, ...): the client has to act without it. */
const heldTick = (t: number) => t % 5 === 3;
const holdSome = (p: Packet) => p.type === "STATE" && p.base !== KEYFRAME && heldTick(p.tick);
const statusAt = (log: ReplayLog, pick: (t: number) => boolean) => [...log.intent_status].filter((_, t) => pick(t)).join("");
const resyncsIn = (log: ReplayLog) => Object.values(log.resyncs).reduce((a, b) => a + b, 0);

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

/** A Python --bot file in a fresh directory. */
function pyBot(source: string): string {
  const f = join(mkdtempSync(join(tmpdir(), "bm-hooks-")), "hooks.py");
  writeFileSync(f, source);
  return f;
}

describe("the transport's hooks (TypeScript)", () => {
  it("onPacket sees every decoded packet first, and a false drops it", async () => {
    const s = await serve({ tickMs: 50, maxTick: 20 });
    try {
      const seen = new Set<string>();
      class Deaf extends Transport {
        override onPacket(p: WirePacket): boolean {
          expect(p.seq).toBeGreaterThan(0);
          seen.add(p.type);
          return p.type !== "STATE";
        }
      }
      const [r] = await new Deaf(opts(s.port)).run();
      expect([...seen]).toEqual(expect.arrayContaining(["HELLO_ACK", "MATCH_START", "STATE", "MATCH_END"]));
      expect(r!.states).toBe(0);
      expect(s.log().intent_status).toBe("m".repeat(20));
    } finally {
      s.server.close();
    }
  });

  it("shouldResync: the shipped one applies deltas blind; true skips a delta without its base and resyncs", async () => {
    const probe = (t: number) => t % 40 === 13;
    for (const byTheBook of [false, true]) {
      const s = await serve({ tickMs: 60, maxTick: 60, probe });
      try {
        const asked: Delta[] = [];
        class T extends Transport {
          override shouldResync(d: Delta): boolean {
            asked.push(d);
            return byTheBook ? true : super.shouldResync(d);
          }
        }
        const [r] = await new T(opts(s.port)).run();
        expect(asked.some((d) => !d.have_base && d.base === 13)).toBe(true);
        expect(asked.filter((d) => d.have_base).length).toBeGreaterThan(30);
        if (byTheBook) {
          expect(resyncsIn(s.log())).toBeGreaterThan(0);
          expect(r!.conn.blind).toBe(0);
          expect(r!.conn.resyncs).toBeGreaterThan(0);
        } else {
          expect(resyncsIn(s.log())).toBe(0);
          expect(r!.conn.blind).toBeGreaterThan(0);
        }
      } finally {
        s.server.close();
      }
    }
  });

  it("predictState: when a STATE doesn't come, a guess lets the bot act anyway", async () => {
    for (const guess of [false, true]) {
      const s = await serve({ tickMs: 120, maxTick: 30, hold: holdSome });
      try {
        let calls = 0;
        class T extends Transport {
          override predictState(last: StateMsg, pending: Intent[]): StateMsg | null {
            calls++;
            expect(pending.length).toBeGreaterThan(0);
            return guess ? { ...last, events: [] } : super.predictState(last, pending);
          }
        }
        await new T(opts(s.port)).run();
        expect(calls).toBeGreaterThan(3);
        const held = statusAt(s.log(), (t) => heldTick(t) && t > 0);
        expect(held).toBe(guess ? "o".repeat(held.length) : "m".repeat(held.length));
      } finally {
        s.server.close();
      }
    }
  });

  it("planMoves: a list of moves goes out for this tick and the ones after it", async () => {
    const s = await serve({ tickMs: 120, maxTick: 30, hold: holdSome });
    try {
      const planned: number[] = [];
      class Ahead extends Transport {
        override planMoves(state: StateMsg): Intent | Intent[] {
          planned.push(state.tick);
          const move = super.planMoves(state) as Intent;
          return [move, move];
        }
      }
      const [r] = await new Ahead(opts(s.port)).run();
      expect(r!.moves).toBe(2 * planned.length);
      // The held ticks got the second move sent the tick before.
      const held = statusAt(s.log(), (t) => heldTick(t));
      expect(held).toBe("o".repeat(held.length));
    } finally {
      s.server.close();
    }
  });

  it("onTick gets one record per tick, in order, with what arrived and what left", async () => {
    const s = await serve({ tickMs: 80, maxTick: 30, hold: holdSome });
    try {
      const records: TickRecord[] = [];
      class T extends Transport {
        override onTick(r: TickRecord): void {
          records.push(r);
        }
      }
      const [r] = await new T(opts(s.port)).run();
      expect(records.map((x) => x.tick)).toEqual(Array.from({ length: records.length }, (_, i) => i));
      expect(records.length).toBeGreaterThanOrEqual(29);
      for (const x of records) {
        if (heldTick(x.tick)) expect(x).toMatchObject({ state_ms: null, sent_ms: null, status: "missing", margin_ms: null });
        else expect(x.state_ms).not.toBeNull();
        if (x.sent_ms !== null) expect(x.margin_ms).not.toBeNull();
      }
      expect(records.some((x) => x.seq_gap > 0)).toBe(true);
      expect(r!.conn.ticks).toBe(records.length);
      expect(r!.conn.missing).toBe(records.filter((x) => x.status === "missing").length);
    } finally {
      s.server.close();
    }
  });

  it("--bot loads hooks or a Transport subclass from a file, and --trace prints a line per tick and the summary", async () => {
    const s = await serve({ tickMs: 120, maxTick: 25, hold: holdSome });
    try {
      const dir = mkdtempSync(join(tmpdir(), "bm-hooks-"));
      const hooksFile = join(dir, "hooks.mjs");
      writeFileSync(hooksFile, "export function predictState(last) { return { ...last, events: [] }; }\n");
      const lines: string[] = [];
      expect(await main(["play", "--vs", "novice", "--chaos", "off", "--ports", String(s.port), "--bot", hooksFile, "--trace", "--quiet"], { out: (l) => lines.push(l), err: (l) => lines.push(l) }, {}, dir)).toBe(0);
      const held = statusAt(s.log(), (t) => heldTick(t) && t > 0);
      expect(held).toBe("o".repeat(held.length));
      expect(lines.some((l) => /^match\s+tick\s+state\s+think\s+sent\s+move\s+resync\s+gap$/.test(l))).toBe(true);
      expect(lines.filter((l) => /^\s+\d+\s+\d+\s+(\+\d+ ms|missing)\s/.test(l)).length).toBeGreaterThanOrEqual(24);
      expect(lines).toContain(lines.find((l) => /^Connection, match \d+ against Maria \(Novice\), network off:$/.test(l)));
      expect(lines.some((l) => /^ {2}on time {10}\d+ of \d+ \(\d+\.\d%\)$/.test(l))).toBe(true);

      const sub = join(__dirname, "fixtures/ahead-transport.ts");
      const out: string[] = [];
      expect(await main(["play", "--vs", "novice", "--chaos", "off", "--ports", String(s.port), "--bot", sub, "--quiet"], { out: (l) => out.push(l), err: (l) => out.push(l) }, {}, dir)).toBe(0);
      const held2 = statusAt(s.log(), (t) => heldTick(t));
      expect(held2).toBe("o".repeat(held2.length));
      expect(out.some((l) => l.startsWith("  deadline margin"))).toBe(true);
    } finally {
      s.server.close();
    }
  });

  it("doctor probes 30 ticks on the Master network profile and names the hook for each weak number", async () => {
    const s = await serve({ tickMs: 100, maxTick: 400 });
    try {
      const lines: string[] = [];
      expect(await main(["doctor", "--ticks", "30", "--ports", String(s.port), "--quiet"], { out: (l) => lines.push(l), err: (l) => lines.push(l) }, {}, tmpdir())).toBe(0);
      const text = lines.join("\n");
      expect(text).toContain("Doctor: a 30-tick probe against Maria (Novice) on the Master network profile, on 127.0.0.1.");
      expect(text).toMatch(/network master:\n {2}on time {10}\d+ of 30 /);
      expect(text).toContain("\nFindings:\n");
      expect(text).toMatch(/\n {2}\d+ of 30 ticks had no move before the deadline: \d+ with none sent, \d+ sent late\.\n/);
      expect(text).toMatch(/\n {2}RTT p50 \d+ ms, p95 \d+ ms, from \d+ PINGs?\.$/);
      // Facts only: nothing in it says what to change.
      expect(text.split("Findings:")[1]).not.toMatch(/\bsee \w|planMoves|predictState|shouldResync|onPacket|should|try /i);
      // It left the match after the probe: the server played the rest out at once.
      expect(s.log().ticks.length).toBe(400);
      expect(s.log().intent_status.slice(40)).toBe("m".repeat(360));
    } finally {
      s.server.close();
    }
  });
});

describe.skipIf(!hasPython)("the transport's hooks (Python)", () => {
  it("onPacket sees every decoded packet first, and a false drops it", async () => {
    const s = await serve({ tickMs: 50, maxTick: 20 });
    try {
      const f = pyBot(`def onPacket(self, packet):\n    print("packet", packet["type"], packet["seq"] > 0)\n    return packet["type"] != "STATE"\n`);
      const r = await runPython(["play", "--vs", "novice", "--chaos", "off", "--ports", String(s.port), "--bot", f, "--quiet"], tmpdir());
      expect(r.err).toBe("");
      for (const t of ["HELLO_ACK", "MATCH_START", "STATE", "MATCH_END"]) expect(r.out).toContain(`packet ${t} True`);
      expect(r.out).toMatch(/States received 0, moves sent 0\./);
      expect(s.log().intent_status).toBe("m".repeat(20));
    } finally {
      s.server.close();
    }
  });

  it("shouldResync: true skips a delta without its base and resyncs", async () => {
    for (const byTheBook of [false, true]) {
      const s = await serve({ tickMs: 60, maxTick: 60, probe: (t) => t % 40 === 13 });
      try {
        const f = pyBot(`def shouldResync(self, delta):\n    if not delta["have_base"]:\n        print("no base", delta["base"])\n    return ${byTheBook ? "True" : "False"}\n`);
        const r = await runPython(["play", "--vs", "novice", "--chaos", "off", "--ports", String(s.port), "--bot", f, "--quiet"], tmpdir());
        expect(r.err).toBe("");
        expect(r.out).toContain("no base 13");
        if (byTheBook) {
          expect(resyncsIn(s.log())).toBeGreaterThan(0);
          expect(r.out).toMatch(/resyncs {10}[1-9]\d*, and 0 deltas applied to a base it never got/);
        } else {
          expect(resyncsIn(s.log())).toBe(0);
          expect(r.out).toMatch(/resyncs {10}0, and [1-9]\d* deltas applied to a base it never got/);
        }
      } finally {
        s.server.close();
      }
    }
  });

  it("predictState: when a STATE doesn't come, a guess lets the bot act anyway", async () => {
    const s = await serve({ tickMs: 120, maxTick: 30, hold: holdSome });
    try {
      const f = pyBot(`def predictState(self, last_state, pending_moves):\n    assert len(pending_moves) > 0\n    guess = dict(last_state)\n    guess["events"] = []\n    return guess\n`);
      const r = await runPython(["play", "--vs", "novice", "--chaos", "off", "--ports", String(s.port), "--bot", f, "--quiet"], tmpdir());
      expect(r.err).toBe("");
      const held = statusAt(s.log(), (t) => heldTick(t) && t > 0);
      expect(held).toBe("o".repeat(held.length));
    } finally {
      s.server.close();
    }
  });

  it("planMoves: a list of moves goes out for this tick and the ones after it, from a Transport subclass", async () => {
    const s = await serve({ tickMs: 120, maxTick: 30, hold: holdSome });
    try {
      const f = pyBot(
        [
          "import blackmaria",
          "",
          "class Transport(blackmaria.Transport):",
          "    def planMoves(self, state):",
          "        move = blackmaria.Transport.planMoves(self, state)",
          "        return [move, move]",
          "",
        ].join("\n"),
      );
      const r = await runPython(["play", "--vs", "novice", "--chaos", "off", "--ports", String(s.port), "--bot", f, "--quiet"], tmpdir());
      expect(r.err).toBe("");
      const m = /States received (\d+), moves sent (\d+)\./.exec(r.out)!;
      expect(Number(m[2])).toBe(2 * Number(m[1]));
      const held = statusAt(s.log(), (t) => heldTick(t));
      expect(held).toBe("o".repeat(held.length));
    } finally {
      s.server.close();
    }
  });

  it("onTick gets one record per tick, in order, with what arrived and what left; --trace prints them", async () => {
    const s = await serve({ tickMs: 80, maxTick: 30, hold: holdSome });
    try {
      const f = pyBot(`import json\n\nhooks = {"onTick": lambda self, record: print("record", json.dumps(record))}\n`);
      const r = await runPython(["play", "--vs", "novice", "--chaos", "off", "--ports", String(s.port), "--bot", f, "--quiet"], tmpdir());
      expect(r.err).toBe("");
      const records = r.out
        .split("\n")
        .filter((l) => l.startsWith("record "))
        .map((l) => JSON.parse(l.slice(7)) as TickRecord);
      expect(records.map((x) => x.tick)).toEqual(Array.from({ length: records.length }, (_, i) => i));
      expect(records.length).toBeGreaterThanOrEqual(29);
      for (const x of records) {
        expect(Object.keys(x).sort()).toEqual(["margin_ms", "match", "resync", "sent_ms", "seq_gap", "state_ms", "status", "think_ms", "tick"]);
        if (heldTick(x.tick)) expect(x).toMatchObject({ state_ms: null, sent_ms: null, status: "missing", margin_ms: null });
      }
      const traced = await runPython(["play", "--vs", "novice", "--chaos", "off", "--ports", String(s.port), "--trace", "--quiet"], tmpdir());
      expect(traced.out).toMatch(/^match\s+tick\s+state\s+think\s+sent\s+move\s+resync\s+gap$/m);
      expect(traced.out).toMatch(/^ {2}deadline margin {2}late/m);
    } finally {
      s.server.close();
    }
  });

  it("doctor probes on the Master network profile and names the hook for each weak number", async () => {
    const s = await serve({ tickMs: 100, maxTick: 400 });
    try {
      const r = await runPython(["doctor", "--ticks", "30", "--ports", String(s.port), "--quiet"], tmpdir());
      expect(r.err).toBe("");
      expect(r.out).toContain("Doctor: a 30-tick probe against Maria (Novice) on the Master network profile, on 127.0.0.1.");
      expect(r.out).toMatch(/network master:\n {2}on time {10}\d+ of 30 /);
      expect(r.out).toContain("\nFindings:\n");
      expect(s.log().intent_status.slice(40)).toBe("m".repeat(360));
    } finally {
      s.server.close();
    }
  });
});
