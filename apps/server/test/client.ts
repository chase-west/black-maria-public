import WebSocket from "ws";
import type { ServerMsg } from "@blackmaria/protocol";

/** A minimal test client that queues server messages. */
export class TestClient {
  readonly ws: WebSocket;
  readonly msgs: ServerMsg[] = [];
  private waiters: { pred: (m: ServerMsg) => boolean; resolve: (m: ServerMsg) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }[] = [];
  closed: { code: number; reason: string } | null = null;
  readonly opened: Promise<void>;

  constructor(url: string, headers: Record<string, string> = {}) {
    this.ws = new WebSocket(url, { headers });
    this.opened = new Promise((res, rej) => {
      this.ws.once("open", () => res());
      this.ws.once("error", rej);
    });
    this.ws.on("message", (d) => {
      const m = JSON.parse(d.toString()) as ServerMsg;
      this.msgs.push(m);
      for (const w of this.waiters.slice()) {
        if (w.pred(m)) {
          clearTimeout(w.timer);
          this.waiters.splice(this.waiters.indexOf(w), 1);
          w.resolve(m);
        }
      }
    });
    this.ws.on("close", (code, reason) => {
      this.closed = { code, reason: reason.toString() };
    });
  }

  send(x: unknown): void {
    this.ws.send(typeof x === "string" ? x : JSON.stringify(x));
  }

  /** Resolve with the first message (already received after `from`, or future) matching `pred`. */
  wait<T extends ServerMsg = ServerMsg>(pred: (m: ServerMsg) => boolean, timeoutMs = 5000, from = 0): Promise<T> {
    const have = this.msgs.slice(from).find(pred);
    if (have) return Promise.resolve(have as T);
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timeout waiting for message; got " + JSON.stringify(this.msgs.slice(-3)))), timeoutMs);
      this.waiters.push({ pred, resolve: resolve as (m: ServerMsg) => void, reject, timer });
    });
  }

  /** Queue semantics: the next unconsumed message of `type` (consumes everything before it). */
  private cursor = 0;
  async next<T extends ServerMsg = ServerMsg>(type: ServerMsg["type"], timeoutMs = 5000): Promise<T> {
    const m = await this.wait<T>((x) => x.type === type, timeoutMs, this.cursor);
    this.cursor = this.msgs.indexOf(m, this.cursor) + 1;
    return m;
  }
  /** Index of the next unconsumed message. */
  get position(): number {
    return this.cursor;
  }

  closeWait(): Promise<void> {
    return new Promise((res) => {
      if (this.closed) return res();
      this.ws.once("close", () => res());
    });
  }

  close(): void {
    this.ws.close();
  }
}
