import { createSocket, type Socket } from "node:dgram";
import { Reassembler, decode, decodeBlob, encode, type MatchBlob, type Packet } from "@blackmaria/protocol/wire";

/** A bare wire client for tests: send packets, collect what comes back, reassemble match blobs. */
export class RawWire {
  private readonly sock: Socket;
  private seq = 0;
  private ackIn = 0;
  session = 0;
  readonly got: { at: number; session: number; packet: Packet }[] = [];
  private readonly frags = new Map<number, Reassembler>();
  readonly blobs = new Map<number, MatchBlob>();
  readonly ready: Promise<void>;

  constructor(
    private readonly port: number,
    private readonly token: Uint8Array,
  ) {
    this.sock = createSocket("udp4");
    this.sock.on("message", (msg) => {
      const d = decode(new Uint8Array(msg.buffer, msg.byteOffset, msg.byteLength));
      if (!d) return;
      if (d.seq > this.ackIn) this.ackIn = d.seq;
      this.got.push({ at: Date.now(), session: d.session, packet: d.packet });
      const p = d.packet;
      if (p.type === "HELLO_ACK") this.session = p.session;
      if (p.type === "MATCH_START") {
        this.send({ type: "ACK_FRAG", match: p.match, frag: p.frag });
        let re = this.frags.get(p.match);
        if (!re) this.frags.set(p.match, (re = new Reassembler()));
        const whole = re.add(p.frag, p.fragCount, p.data);
        if (whole && !this.blobs.has(p.match)) {
          const b = decodeBlob(whole);
          if (b) this.blobs.set(p.match, b);
        }
      }
    });
    this.ready = new Promise((r) => this.sock.bind(0, "127.0.0.1", () => r()));
  }

  send(packet: Packet): void {
    this.seq++;
    this.sock.send(encode({ session: this.session, seq: this.seq, ack: this.ackIn, packet }), this.port, "127.0.0.1");
  }

  hello(mode: 0 | 1, tier: 0 | 1 | 2 = 0, chaos: 0 | 1 | 2 | 3 = 0): void {
    this.send({ type: "HELLO", token: this.token, mode, tier, chaos });
  }

  /** The first packet received from index `from` on that matches. */
  async wait<T extends Packet>(pred: (p: Packet) => p is T, ms = 5000, from = 0): Promise<T> {
    const t0 = Date.now();
    for (;;) {
      const hit = this.got.slice(from).find((g) => pred(g.packet));
      if (hit) return hit.packet as T;
      if (Date.now() - t0 > ms) throw new Error(`timed out; got ${this.got.slice(-4).map((g) => g.packet.type).join(", ")}`);
      await new Promise((r) => setTimeout(r, 10));
    }
  }

  /** HELLO, then the HELLO_ACK or the ERROR that answers it. */
  async helloAndWait(mode: 0 | 1, tier: 0 | 1 | 2 = 0, chaos: 0 | 1 | 2 | 3 = 0): Promise<Extract<Packet, { type: "HELLO_ACK" } | { type: "ERROR" }>> {
    const from = this.got.length;
    this.hello(mode, tier, chaos);
    return this.wait((p): p is Extract<Packet, { type: "HELLO_ACK" } | { type: "ERROR" }> => p.type === "HELLO_ACK" || p.type === "ERROR", 3000, from);
  }

  /** The blob of the next match that starts after index `from`. */
  async nextBlob(from: number, ms = 5000): Promise<{ match: number; blob: MatchBlob }> {
    const start = await this.wait((p): p is Extract<Packet, { type: "MATCH_START" }> => p.type === "MATCH_START", ms, from);
    const t0 = Date.now();
    while (!this.blobs.has(start.match)) {
      if (Date.now() - t0 > ms) throw new Error("no whole blob");
      await new Promise((r) => setTimeout(r, 10));
    }
    return { match: start.match, blob: this.blobs.get(start.match)! };
  }

  async matchEnd(match: number, ms = 20_000): Promise<Extract<Packet, { type: "MATCH_END" }>> {
    return this.wait((p): p is Extract<Packet, { type: "MATCH_END" }> => p.type === "MATCH_END" && p.match === match, ms);
  }

  get mark(): number {
    return this.got.length;
  }

  close(): void {
    try {
      this.sock.close();
    } catch {
      /* closed */
    }
  }
}
