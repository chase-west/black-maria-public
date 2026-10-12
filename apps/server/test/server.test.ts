import { existsSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import type { ErrorMsg, MatchEndMsg, MatchStartMsg, ReplayDoc, ServerMsg, StateMsg, WelcomeMsg } from "@blackmaria/protocol";
import { readReplay } from "../src/index.js";
import { boot, connect, type Booted } from "./setup.js";
import { TestClient } from "./client.js";


/** Play a whole match: answer every state with `pick(state)`. */
async function playOut(c: TestClient, pick: (s: StateMsg) => unknown): Promise<{ start: MatchStartMsg; states: StateMsg[]; end: MatchEndMsg }> {
  const start = await c.next<MatchStartMsg>("match_start");
  const states: StateMsg[] = [];
  return await new Promise((resolve, reject) => {
    const backlog = c.msgs.slice(c.position);
    const onMsg = (d: WebSocket.RawData | ServerMsg) => {
      const m = (Buffer.isBuffer(d) || Array.isArray(d) || d instanceof ArrayBuffer ? JSON.parse(d.toString()) : d) as ServerMsg;
      if (m.type === "state" && m.match_id === start.match_id) {
        states.push(m);
        const intent = pick(m);
        if (intent !== undefined) c.send({ type: "intent", match_id: m.match_id, tick: m.tick, intent });
      } else if (m.type === "match_end" && m.match_id === start.match_id) {
        c.ws.off("message", onMsg);
        resolve({ start, states, end: m });
      }
    };
    c.ws.on("message", onMsg);
    for (const m of backlog) onMsg(m);
    setTimeout(() => reject(new Error("match did not finish")), 20000);
  });
}

describe("server core (SPEC 5, 7)", () => {
  let s: Booted;
  beforeAll(async () => {
    s = await boot();
  });
  afterAll(async () => {
    await s.close();
  });

  it("drives two fake clients through full matches concurrently", async () => {
    const [a, b] = await Promise.all([connect(s.url, s.token()), connect(s.url, s.token())]);
    a.send({ type: "join", mode: "practice", tier: "novice" });
    b.send({ type: "join", mode: "practice", tier: "novice" });
    const dirs = ["N", "E", "S", "W"] as const;
    const [ra, rb] = await Promise.all([playOut(a, (st) => ({ kind: "MOVE", dir: dirs[st.tick % 4] })), playOut(b, () => ({ kind: "WAIT" }))]);
    for (const r of [ra, rb]) {
      expect(r.start.params.max_tick).toBe(40);
      expect(r.start.params.tick_ms).toBe(60);
      expect(r.start.map.tiles.length).toBe(r.start.map.h);
      expect(r.start.board).toHaveLength(6);
      expect(r.start.you.energy).toBe(40);
      expect(r.states.map((x) => x.tick)).toEqual(Array.from({ length: 40 }, (_, i) => i));
      expect(r.states[0]!.events).toEqual([]);
      expect(r.states.filter((x) => x.events.some((e) => e.kind === "moved")).length).toBeGreaterThan(5);
      expect(r.states[0]!.deadline_ms).toBe(60);
      expect(r.end.board.length).toBeGreaterThanOrEqual(6);
      expect(["win", "draw", "loss"]).toContain(r.end.result);
      const row = s.db.getMatch(r.start.match_id)!;
      expect(row.result).toBe(r.end.result);
      expect(row.score_you).toBe(r.end.scores.you);
      expect(existsSync(row.replay_path!)).toBe(true);
    }
    expect(ra.start.match_id).not.toBe(rb.start.match_id);
    a.close();
    b.close();
  });

  it("late intents become WAIT and are refused with stale_tick", async () => {
    const c = await connect(s.url, s.token());
    c.send({ type: "join", mode: "practice", tier: "novice" });
    let late = 0;
    const r = await playOut(c, (st) => {
      if (st.tick % 2 === 1) {
        setTimeout(() => c.send({ type: "intent", match_id: st.match_id, tick: st.tick, intent: { kind: "TAKE" } }), 150);
        late++;
        return undefined;
      }
      return { kind: "MOVE", dir: "N" };
    });
    const log = readReplay(s.db.getMatch(r.start.match_id)!.replay_path!);
    for (let t = 0; t < log.ticks.length; t++) {
      expect(log.ticks[t]!.you).toEqual(t % 2 === 1 ? { kind: "WAIT" } : { kind: "MOVE", dir: "N" });
    }
    const stale = c.msgs.filter((m) => m.type === "error" && (m as ErrorMsg).code === "stale_tick");
    expect(stale.length).toBeGreaterThan(late / 2);
    c.close();
  });

  it("an intent for the wrong tick is dropped with stale_tick; a second intent for a tick is a duplicate", async () => {
    const c = await connect(s.url, s.token());
    c.send({ type: "join", mode: "practice", tier: "novice" });
    const start = await c.next<MatchStartMsg>("match_start");
    const st = await c.wait<StateMsg>((m) => m.type === "state");
    c.send({ type: "intent", match_id: start.match_id, tick: st.tick + 5, intent: { kind: "WAIT" } });
    expect((await c.next<ErrorMsg>("error")).code).toBe("stale_tick");
    const st2 = await c.next<StateMsg>("state");
    c.send({ type: "intent", match_id: start.match_id, tick: st2.tick, intent: { kind: "WAIT" } });
    c.send({ type: "intent", match_id: start.match_id, tick: st2.tick, intent: { kind: "TAKE" } });
    expect((await c.next<ErrorMsg>("error")).code).toBe("duplicate_intent");
    c.send({ type: "leave", match_id: start.match_id });
    await c.next("match_end");
    c.close();
  });

  it("malformed frames yield error and never crash the server", async () => {
    const c = await connect(s.url, s.token());
    const bad: unknown[] = [
      "not json",
      "{",
      "[]",
      "42",
      "null",
      '"hello"',
      "{}",
      { type: 7 },
      { type: "nope" },
      { type: "join" },
      { type: "join", mode: "practice", tier: "grandmaster" },
      { type: "join", mode: "lol" },
      { type: "intent" },
      { type: "intent", match_id: 5, tick: 1, intent: {} },
      { type: "intent", match_id: "m_00", tick: -1, intent: { kind: "WAIT" } },
      { type: "intent", match_id: "m_00", tick: 1.5, intent: { kind: "WAIT" } },
      { type: "intent", match_id: "m_00", tick: 1, intent: { kind: "MOVE", dir: "UP" } },
      { type: "intent", match_id: "m_00", tick: 1, intent: { kind: "WAIT" } },
      { type: "leave", match_id: "m_00" },
      { type: "leave" },
      '{"type":"hello","__proto__":{"polluted":true}}',
      '{"type":"join","constructor":{"prototype":{"x":1}},"mode":"practice","tier":"novice"}',
      "[".repeat(3000) + "]".repeat(3000),
      JSON.stringify({ type: "intent", match_id: "m_" + "f".repeat(5000), tick: 1, intent: { kind: "WAIT" } }),
      "\u0000\u0001\u0002",
      "{\"type\":\"intent\",\"match_id\":\"m_1\",\"tick\":1e309,\"intent\":{\"kind\":\"WAIT\"}}",
    ];
    for (const b of bad) c.send(b);
    c.ws.send(Buffer.from([1, 2, 3]), { binary: true });
    await new Promise((r) => setTimeout(r, 300));
    const errors = c.msgs.filter((m) => m.type === "error");
    expect(errors.length).toBeGreaterThanOrEqual(bad.length - 2);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(c.closed).toBeNull();
    // An oversize frame closes only that socket.
    const big = await connect(s.url, s.token());
    big.ws.send("x".repeat(200 * 1024));
    await big.closeWait();
    // The server is fine and still plays.
    const res = await fetch(`${s.base}/healthz`);
    expect(res.status).toBe(200);
    c.send({ type: "join", mode: "practice", tier: "novice" });
    await c.next("match_start");
    c.close();
  });

  it("frames before hello are refused, and a bad token closes the socket", async () => {
    const c = await connect(s.url, null);
    c.send({ type: "join", mode: "practice", tier: "novice" });
    expect((await c.next<ErrorMsg>("error")).code).toBe("not_authenticated");
    c.send({ type: "hello", token: "nope" });
    expect((await c.next<ErrorMsg>("error")).code).toBe("bad_token");
    await c.closeWait();
    expect(c.closed!.code).toBe(4001);
  });

  it("replays round-trip: the server expands the log into frames and verifies every hash", async () => {
    const token = s.token();
    const c = await connect(s.url, token);
    c.send({ type: "join", mode: "practice", tier: "novice" });
    const r = await playOut(c, (st) => (st.tick % 3 ? { kind: "MOVE", dir: "E" } : { kind: "TAKE" }));
    const res = await fetch(`${s.base}/api/replay/${r.start.match_id}`, { headers: { authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);
    const doc = (await res.json()) as ReplayDoc;
    expect(doc.frames).toHaveLength(41);
    expect(doc.reviewer).toBe(false);
    expect(doc.frames[0]!.maria_energy).toBeUndefined();
    expect(doc.frames[0]!.maria_intent).toBeUndefined();
    expect(doc.scores).toEqual(r.end.scores);
    const last = doc.frames.at(-1)!;
    expect(last.board).toEqual(r.end.board);
    for (let t = 1; t < 40; t++) {
      expect(doc.frames[t]!.you).toEqual(r.states[t]!.you);
      expect(doc.frames[t]!.maria).toEqual(r.states[t]!.maria);
      expect(doc.frames[t]!.board).toEqual(r.states[t]!.board);
      expect(doc.frames[t]!.events).toEqual(r.states[t]!.events);
    }
    // Someone else cannot read it; the reviewer sees Maria's side.
    const other = await fetch(`${s.base}/api/replay/${r.start.match_id}`, { headers: { authorization: `Bearer ${s.token()}` } });
    expect(other.status).toBe(404);
    const rev = (await (await fetch(`${s.base}/api/replay/${r.start.match_id}`, { headers: { "x-admin-token": "admin-secret-123" } })).json()) as ReplayDoc;
    expect(rev.reviewer).toBe(true);
    expect(typeof rev.frames[5]!.maria_energy).toBe("number");
    expect(rev.frames[5]!.maria_intent).toBeDefined();
    c.close();
  });

  it("enforces 2 concurrent practice matches per token", async () => {
    const c = await connect(s.url, s.token());
    c.send({ type: "join", mode: "practice", tier: "novice" });
    c.send({ type: "join", mode: "practice", tier: "novice" });
    c.send({ type: "join", mode: "practice", tier: "novice" });
    expect((await c.next<ErrorMsg>("error")).code).toBe("too_many_concurrent");
    c.close();
  });

  it("reconnect: a dropped connection's match continues and re-binds on the next hello", async () => {
    const token = s.token();
    const c = await connect(s.url, token);
    c.send({ type: "join", mode: "practice", tier: "novice" });
    const start = await c.next<MatchStartMsg>("match_start");
    await c.next("state");
    c.ws.terminate();
    await new Promise((r) => setTimeout(r, 100));
    const c2 = await connect(s.url, token);
    const again = await c2.next<MatchStartMsg>("match_start");
    expect(again.match_id).toBe(start.match_id);
    const st = await c2.next<StateMsg>("state");
    expect(st.tick).toBeGreaterThanOrEqual(1);
    c2.send({ type: "intent", match_id: st.match_id, tick: st.tick, intent: { kind: "WAIT" } });
    const end = await c2.next<MatchEndMsg>("match_end", 10000);
    expect(end.match_id).toBe(start.match_id);
    c2.close();
  });

  it("magic link sets an httpOnly cookie that authenticates HTTP and WebSocket", async () => {
    const token = s.token();
    const res = await fetch(`${s.base}/enter/${token}`, { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/");
    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toContain("HttpOnly");
    const pair = cookie.split(";")[0]!;
    const me = await fetch(`${s.base}/api/me`, { headers: { cookie: pair } });
    expect(((await me.json()) as { token: string }).token).toBe(token);
    const ws = new TestClient(s.url, { cookie: pair });
    await ws.opened;
    ws.send({ type: "hello", name: "browser" });
    const w = await ws.next<WelcomeMsg>("welcome");
    expect(w.attempts_left).toBe(1);
    ws.close();
    const bad = await fetch(`${s.base}/enter/not-a-token`, { redirect: "manual" });
    expect(bad.headers.get("location")).toBe("/?link=invalid");
  });

  it("serves the public rules doc and refuses path traversal under /assets", async () => {
    const rules = await (await fetch(`${s.base}/api/rules`)).text();
    expect(rules.startsWith("# BLACK MARIA")).toBe(true);
    for (const p of ["/assets/../package.json", "/assets/%2e%2e/package.json", "/assets/..%2fpackage.json"]) {
      const r = await fetch(`${s.base}${p}`);
      expect(r.status).toBe(404);
    }
    const ok = await fetch(`${s.base}/assets/manifest.placeholders.json`);
    expect([200, 404]).toContain(ok.status);
  });
});

describe("rate limits (SPEC 5.1)", () => {
  it("practice is limited per hour per token", async () => {
    const s = await boot({ limits: { practicePerHour: 3, practiceConcurrent: 5 } as never });
    const c = await connect(s.url, s.token());
    for (let i = 0; i < 3; i++) {
      c.send({ type: "join", mode: "practice", tier: "novice" });
      await c.next("match_start");
    }
    c.send({ type: "join", mode: "practice", tier: "novice" });
    expect((await c.next<ErrorMsg>("error")).code).toBe("rate_limited");
    c.close();
    await s.close();
  });

  it("the global concurrent match cap holds", async () => {
    const s = await boot({ maxConcurrentMatches: 2 });
    const a = await connect(s.url, s.token());
    const b = await connect(s.url, s.token());
    a.send({ type: "join", mode: "practice", tier: "novice" });
    a.send({ type: "join", mode: "practice", tier: "novice" });
    await a.next("match_start");
    await new Promise((r) => setTimeout(r, 50));
    b.send({ type: "join", mode: "practice", tier: "novice" });
    expect((await b.next<ErrorMsg>("error")).code).toBe("server_busy");
    a.close();
    b.close();
    await s.close();
  });

  it("a frame flood is rate limited and the flooder is eventually disconnected", async () => {
    const s = await boot();
    const c = await connect(s.url, s.token());
    for (let i = 0; i < 3000; i++) c.send({ type: "leave", match_id: "m_0" });
    await c.closeWait();
    expect(c.msgs.some((m) => m.type === "error" && (m as ErrorMsg).code === "rate_limited")).toBe(true);
    expect(c.closed!.code).toBe(4008);
    const ok = await connect(s.url, s.token());
    ok.close();
    await s.close();
  });

  it("joins are refused outside the window", async () => {
    const s = await boot({ windowOpens: new Date(Date.now() + 3600_000), windowCloses: new Date(Date.now() + 7200_000) });
    const c = await connect(s.url, s.token());
    c.send({ type: "join", mode: "practice", tier: "novice" });
    expect((await c.next<ErrorMsg>("error")).code).toBe("window_closed");
    c.close();
    await s.close();
  });
});
