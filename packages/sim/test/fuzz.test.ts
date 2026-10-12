import { createSocket, type Socket } from "node:dgram";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { MAGIC, PT, encode, type Packet } from "@blackmaria/protocol/wire";
import { LocalHost, WireServer } from "../src/index.js";

setFlagsFromString("--expose_gc");
const gc = runInNewContext("gc") as () => void;

/** Seeded generator (mulberry32). */
function rng(seed: number) {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (n: number) => Math.floor(next() * n);
  return { int, bytes: (n: number) => Uint8Array.from({ length: n }, () => int(256)) };
}

const TYPES = Object.values(PT);
const EXTREMES = [0, 1, 0x7f, 0x80, 0xfe, 0xff];

/** A valid client or server packet with random fields (the server must also survive server-type datagrams). */
function validPacket(r: ReturnType<typeof rng>, token: Uint8Array): Packet {
  switch (r.int(12)) {
    case 0:
      return { type: "HELLO", token, mode: r.int(2), tier: r.int(3), chaos: r.int(4) };
    case 1:
    case 2:
    case 3:
      return { type: "INTENT", match: r.int(8), tick: r.int(450), intent: { kind: r.int(7), dir: r.int(6), item: r.int(14) } };
    case 4:
      return { type: "RESYNC", match: r.int(8) };
    case 5:
      return { type: "PING", clientMs: r.int(2 ** 32) };
    case 6:
      return { type: "ACK_FRAG", match: r.int(8), frag: r.int(4) };
    case 7:
      return { type: "LEAVE", match: 9000 + r.int(8) };
    case 8:
      return { type: "STATE", match: r.int(8), tick: r.int(400), base: 0xffff, deadlineMs: 250, you: { x: r.int(24), y: r.int(24), energy: r.int(101) }, events: [{ kind: "moved", by: 1, dir: r.int(4) }] };
    case 9:
      return { type: "MATCH_START", match: r.int(8), frag: 0, fragCount: 2, data: r.bytes(1 + r.int(200)) };
    case 10:
      return { type: "ERROR", code: 1 + r.int(7), msg: "x" };
    default:
      return { type: "PONG", clientMs: r.int(1000), serverMs: r.int(1000) };
  }
}

function mutate(r: ReturnType<typeof rng>, b: Uint8Array): Uint8Array {
  const x = b.slice();
  switch (r.int(6)) {
    case 0: // bit flips
      for (let k = 0; k < 1 + r.int(4); k++) x[r.int(x.length)]! ^= 1 << r.int(8);
      return x;
    case 1: // byte set to an extreme
      for (let k = 0; k < 1 + r.int(3); k++) x[r.int(x.length)] = EXTREMES[r.int(EXTREMES.length)]!;
      return x;
    case 2: // truncate
      return x.slice(0, r.int(x.length));
    case 3: {
      // extend
      const y = new Uint8Array(x.length + 1 + r.int(40));
      y.set(x);
      y.set(r.bytes(y.length - x.length), x.length);
      return y;
    }
    case 4: // change the type byte
      x[1] = TYPES[r.int(TYPES.length)]!;
      return x;
    default: // overwrite a run
      for (let i = 12 + r.int(Math.max(1, x.length - 12)); i < x.length && r.int(4) > 0; i++) x[i] = r.int(256);
      return x;
  }
}

describe("wire server fuzz (SPEC 7)", () => {
  it("survives one million random and mutated datagrams with no crash and bounded memory", async () => {
    // Like production: only the eight issued tokens authenticate.
    class Strict extends LocalHost {
      override authenticate(raw: Uint8Array): string | null {
        return raw.length === 16 && raw.every((b) => b === raw[0]) && raw[0]! >= 1 && raw[0]! <= 8 ? super.authenticate(raw) : null;
      }
    }
    const host = new Strict({ log: () => {} });
    const server = new WireServer({ host, tickMs: 250, maxTick: 400, limits: { datagramsPerSecond: 1e9, datagramBurst: 1e9 } });
    const port = await server.listen(0, "127.0.0.1");
    const N = 1_000_000;
    const socks: Socket[] = [];
    const sessions: number[] = [];
    try {
      // Eight attackers, each with a real practice session so mutations reach the session and match code.
      for (let k = 0; k < 8; k++) {
        const s = createSocket("udp4");
        await new Promise<void>((res) => s.bind(0, "127.0.0.1", () => res()));
        const sid = new Promise<number>((res) => s.once("message", (m) => res(m.readUInt16LE(2))));
        s.send(encode({ session: 0, seq: 1, ack: 0, packet: { type: "HELLO", token: new Uint8Array(16).fill(k + 1), mode: 0, tier: 0, chaos: k % 4 } }), port, "127.0.0.1");
        sessions.push(await sid);
        s.on("message", () => {});
        socks.push(s);
      }
      await new Promise((r) => setTimeout(r, 300));
      gc();
      const heapBefore = process.memoryUsage().heapUsed;
      const r = rng(0xf022);
      let sent = 0;
      while (sent < N) {
        for (let k = 0; k < 256 && sent < N; k++, sent++) {
          const who = r.int(8);
          let b: Uint8Array;
          const mode = r.int(10);
          if (mode < 3) b = r.bytes(r.int(1300));
          else if (mode < 5) {
            b = r.bytes(12 + r.int(60));
            b[0] = MAGIC;
            b[1] = TYPES[r.int(TYPES.length)]!;
            const dv = new DataView(b.buffer);
            if (r.int(2)) dv.setUint16(2, sessions[who]!, true);
          } else {
            const pkt = validPacket(r, new Uint8Array(16).fill(who + 1));
            const d = { session: r.int(5) ? sessions[who]! : r.int(65536), seq: r.int(2 ** 32), ack: r.int(2 ** 32), packet: pkt };
            b = encode(d);
            if (mode >= 7) b = mutate(r, b);
          }
          socks[who]!.send(b, port, "127.0.0.1");
        }
        // Let the server drain the socket before sending more, so the kernel does not drop the batch.
        for (let w = 0; w < 200 && server.stats.received < sent - 64; w++) await new Promise((res) => setImmediate(res));
      }
      await new Promise((res) => setTimeout(res, 1500));
      gc();
      const heapAfter = process.memoryUsage().heapUsed;
      const grown = (heapAfter - heapBefore) / 1e6;
      console.log(`fuzz: sent ${sent}, server received ${server.stats.received}, dropped ${server.stats.dropped}, sessions ${server.sessionCount}, matches ${server.matchCount}, heap +${grown.toFixed(1)} MB`);
      expect(server.stats.received).toBeGreaterThan(N * 0.95);
      expect(server.sessionCount).toBeLessThanOrEqual(8);
      expect(server.matchCount).toBeLessThanOrEqual(8 * 4 + 8);
      expect(grown).toBeLessThan(64);
      // Still serving: a fresh HELLO gets a HELLO_ACK.
      const probe = createSocket("udp4");
      await new Promise<void>((res) => probe.bind(0, "127.0.0.1", () => res()));
      const ack = new Promise<number>((res) => probe.once("message", (m) => res(m[1]!)));
      probe.send(encode({ session: 0, seq: 1, ack: 0, packet: { type: "HELLO", token: new Uint8Array(16).fill(8), mode: 0, tier: 0, chaos: 0 } }), port, "127.0.0.1");
      expect(await ack).toBe(PT.HELLO_ACK);
      probe.close();
    } finally {
      for (const s of socks) s.close();
      server.close();
    }
  });

  it("drops datagrams over the per-address rate and says so at most once a second", async () => {
    const host = new LocalHost();
    const server = new WireServer({ host, tickMs: 250, limits: { datagramsPerSecond: 100, datagramBurst: 50 } });
    const out: Uint8Array[] = [];
    server.sendRaw = (b) => out.push(b);
    server.startDetached();
    try {
      const hello = encode({ session: 0, seq: 1, ack: 0, packet: { type: "HELLO", token: new Uint8Array(16).fill(9), mode: 0, tier: 0, chaos: 0 } });
      server.receive(hello, "10.0.0.1", 5000);
      const sid = new DataView(out[0]!.buffer).getUint16(2, true);
      const ping = encode({ session: sid, seq: 2, ack: 0, packet: { type: "PING", clientMs: 1 } });
      for (let i = 0; i < 500; i++) server.receive(ping, "10.0.0.1", 5000);
      expect(server.stats.dropped).toBeGreaterThan(400);
      const errors = out.filter((b) => b[1] === PT.ERROR && b[12] === 4);
      expect(errors).toHaveLength(1);
    } finally {
      server.close();
    }
  });
});
