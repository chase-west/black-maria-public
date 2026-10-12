import { describe, expect, it } from "vitest";
import { boot, connect } from "./setup.js";

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

function garbage(r: () => number, depth = 0): unknown {
  const k = Math.floor(r() * 9);
  switch (k) {
    case 0:
      return null;
    case 1:
      return r() * 1e12 - 5e11;
    case 2:
      return Math.floor(r() * 500) - 100;
    case 3:
      return ["hello", "join", "intent", "leave", "MOVE", "WAIT", "TAKE", "USE", "DROP", "N", "practice", "official", "SEIZE", "novice", "m_1", ""][Math.floor(r() * 16)];
    case 4:
      return r() > 0.5;
    case 5:
      return depth > 3 ? 1 : Array.from({ length: Math.floor(r() * 4) }, () => garbage(r, depth + 1));
    default: {
      if (depth > 3) return {};
      const o: Record<string, unknown> = {};
      const keys = ["type", "token", "name", "mode", "tier", "match_id", "tick", "intent", "kind", "dir", "item", "__proto__", "constructor"];
      for (let i = 0; i < 1 + Math.floor(r() * 5); i++) o[keys[Math.floor(r() * keys.length)]!] = garbage(r, depth + 1);
      return o;
    }
  }
}

describe("protocol fuzz", () => {
  it("survives thousands of random frames from authenticated and anonymous sockets", async () => {
    const s = await boot({ limits: { framesPerSecond: 100000, frameBurst: 100000, practicePerHour: 1000, practiceConcurrent: 2 } as never });
    const r = rng(12345);
    const clients = await Promise.all([connect(s.url, s.token()), connect(s.url, s.token()), connect(s.url, null)]);
    for (let i = 0; i < 4000; i++) {
      const c = clients[i % clients.length]!;
      if (c.closed) continue;
      const g = garbage(r);
      c.send(r() < 0.1 ? JSON.stringify(g).slice(0, Math.floor(r() * 20)) : JSON.stringify(g ?? null));
    }
    await new Promise((res) => setTimeout(res, 500));
    const health = await fetch(`${s.base}/healthz`);
    expect(health.status).toBe(200);
    const ok = await connect(s.url, s.token());
    ok.send({ type: "join", mode: "practice", tier: "novice" });
    await ok.next("match_start");
    for (const c of [...clients, ok]) c.close();
    await s.close();
  });
});
