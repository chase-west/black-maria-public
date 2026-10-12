import { describe, expect, it } from "vitest";
import { PT, decode, encode, type Packet } from "@blackmaria/protocol/wire";
import { Reassembler, decodeBlob } from "@blackmaria/protocol/wire";
import { LocalHost, WireServer, runTier, type WireRules } from "../src/index.js";

/** A detached server and a fake client address: datagrams in through `receive`, out through `sendRaw`. */
function detached(opts: { tickMs?: number; maxTick?: number; rules?: WireRules } = {}) {
  const host = new LocalHost(opts.rules ? { rules: opts.rules } : {});
  const server = new WireServer({ host, tickMs: opts.tickMs ?? 40, maxTick: opts.maxTick ?? 30 });
  const out: Packet[] = [];
  server.sendRaw = (b) => {
    const d = decode(b);
    if (d) out.push(d.packet);
  };
  server.startDetached();
  let seq = 0;
  let session = 0;
  const send = (packet: Packet) => server.receive(encode({ session, seq: ++seq, ack: 0, packet }), "10.1.1.1", 4242);
  const hello = (mode: 0 | 1 = 0) => {
    send({ type: "HELLO", token: new Uint8Array(16).fill(3), mode, tier: 0, chaos: 0 });
    const ack = out.find((p) => p.type === "HELLO_ACK");
    if (ack && ack.type === "HELLO_ACK") session = ack.session;
    return ack;
  };
  return { host, server, out, send, hello };
}

const until = async (cond: () => boolean, ms = 20_000) => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 5));
  }
};

describe("wire server (SPEC 5)", () => {
  it("HELLO_ACK carries the rule change; the match blob carries every parameter in force", () => {
    const t = detached({ rules: { params: { snatchCost: 50, regen: 2 }, ruleChange: 2, chaosOverride: null } });
    try {
      const ack = t.hello();
      expect(ack).toMatchObject({ type: "HELLO_ACK", ruleChange: 2, attemptsLeft: 1, clockS: 0xffffffff });
      const re = new Reassembler();
      let blob: Uint8Array | null = null;
      for (const p of t.out) if (p.type === "MATCH_START") blob = re.add(p.frag, p.fragCount, p.data) ?? blob;
      const b = decodeBlob(blob!)!;
      expect(b.params).toEqual({ maxTick: 30, tickMs: 40, postInterval: 6, expiryMin: 30, expiryMax: 70, snatchCost: 50, regen: 2, energyStart: 40, inventorySlots: 4, returnTicks: 40, chaos: 0 });
    } finally {
      t.server.close();
    }
  });

  it("buffers intents up to 10 ticks ahead; the first received for a tick wins; further ahead is refused", async () => {
    const t = detached({ tickMs: 30, maxTick: 15 });
    try {
      t.hello();
      const ms = t.out.find((p) => p.type === "MATCH_START")!;
      if (ms.type !== "MATCH_START") throw new Error("no MATCH_START");
      // Before acking the blob: send moves for ticks 0..10, then a different move for tick 3, and one for tick 11.
      for (let tick = 0; tick <= 10; tick++) t.send({ type: "INTENT", match: ms.match, tick, intent: { kind: 1, dir: 1, item: 0 } });
      t.send({ type: "INTENT", match: ms.match, tick: 3, intent: { kind: 1, dir: 3, item: 0 } });
      t.send({ type: "INTENT", match: ms.match, tick: 11, intent: { kind: 1, dir: 1, item: 0 } });
      expect(t.out.some((p) => p.type === "ERROR" && p.code === 5)).toBe(true);
      for (let f = 0; f < ms.fragCount; f++) t.send({ type: "ACK_FRAG", match: ms.match, frag: f });
      await until(() => t.host.ended.length === 1);
      const log = t.host.ended[0]!.log;
      expect(log.intent_status.slice(0, 11)).toBe("ooooooooooo");
      for (let tick = 0; tick <= 10; tick++) expect(log.ticks[tick]!.you).toEqual({ kind: "MOVE", dir: "E" });
    } finally {
      t.server.close();
    }
  });

  it("official runs: 9 matches, 3 per tier, one tier at a time", () => {
    expect([...Array(9).keys()].map(runTier)).toEqual(["novice", "novice", "novice", "adept", "adept", "adept", "master", "master", "master"]);
  });

  it("drops server-type datagrams and anything from an address without a session", () => {
    const t = detached();
    try {
      t.send({ type: "PING", clientMs: 1 });
      t.send({ type: "PONG", clientMs: 1, serverMs: 2 });
      expect(t.out).toHaveLength(0);
      expect(PT.HELLO).toBe(1);
    } finally {
      t.server.close();
    }
  });
});
