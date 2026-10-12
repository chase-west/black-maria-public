import { describe, expect, it } from "vitest";
import type { ErrorMsg } from "@blackmaria/protocol";
import { TestClient } from "./client.js";
import { boot, connect } from "./setup.js";
import { loadConfig } from "../src/index.js";

const ADMIN = { "x-admin-token": "admin-secret-123", "content-type": "application/json" };

describe("hardening (SPEC 8)", () => {
  it("HTTP requests are limited per address", async () => {
    const s = await boot({ limits: { httpPerMinute: 20 } as never });
    const codes: number[] = [];
    for (let i = 0; i < 30; i++) codes.push((await fetch(`${s.base}/api/rules`)).status);
    expect(codes.filter((c) => c === 429).length).toBe(10);
    await s.close();
  });

  it("magic-link guessing is limited", async () => {
    const s = await boot();
    const codes: number[] = [];
    for (let i = 0; i < 40; i++) codes.push((await fetch(`${s.base}/enter/guess${i}`, { redirect: "manual" })).status);
    expect(codes.filter((c) => c === 429).length).toBeGreaterThan(5);
    await s.close();
  });

  it("caps WebSocket connections per address", async () => {
    const s = await boot({ limits: { connectionsPerIp: 3 } as never });
    const cs = [new TestClient(s.url), new TestClient(s.url), new TestClient(s.url)];
    await Promise.all(cs.map((c) => c.opened));
    const extra = new TestClient(s.url);
    await extra.opened.catch(() => {});
    await extra.closeWait();
    expect(extra.closed!.code).toBe(4008);
    for (const c of cs) c.close();
    await s.close();
  });

  it("draining refuses new matches while live ones finish", async () => {
    const s = await boot({ maxTickOverride: 10, tickMs: { practice: 20, wire: 20 } });
    const c = await connect(s.url, s.token());
    c.send({ type: "join", mode: "practice", tier: "novice" });
    await c.next("match_start");
    const drained = s.hub.drain(5000);
    c.send({ type: "join", mode: "practice", tier: "novice" });
    expect((await c.next<ErrorMsg>("error")).code).toBe("server_busy");
    await c.next("match_end");
    await drained;
    expect(s.hub.matches.size).toBe(0);
    c.close();
    await s.close();
  });

  it("the admin API creates tokens with magic links and reports metrics", async () => {
    const s = await boot();
    const r = await fetch(`${s.base}/api/admin/tokens`, { method: "POST", headers: ADMIN, body: JSON.stringify({ emails: ["a@x.org", "b@x.org"] }) });
    const body = (await r.json()) as { tokens: { email: string; token: string; link: string }[] };
    expect(body.tokens).toHaveLength(2);
    expect(body.tokens[0]!.link).toContain(`/enter/${body.tokens[0]!.token}`);
    expect(s.db.getToken(body.tokens[1]!.token)!.email).toBe("b@x.org");
    expect((await fetch(`${s.base}/api/admin/tokens`, { method: "POST", body: "{}" })).status).toBe(403);
    const m = (await (await fetch(`${s.base}/api/admin/metrics`, { headers: ADMIN })).json()) as Record<string, number>;
    expect(typeof m.late_p99_ms).toBe("number");
    expect(typeof m.event_loop_lag_ms).toBe("number");
    await s.close();
  });

  it("a port-mapped deploy tells clients its public wire ports, and wire sessions per address are configurable", async () => {
    const cfg = loadConfig({ WIRE_PORTS_PUBLIC: "17777, 18443", WIRE_SESSIONS_PER_IP: "64" });
    expect(cfg.wirePortsPublic).toEqual([17777, 18443]);
    expect(cfg.limits.wireSessionsPerIp).toBe(64);
    expect(loadConfig({}).wirePortsPublic).toBeNull();
    expect(loadConfig({}).limits.wireSessionsPerIp).toBe(16);
    const s = await boot({ wirePortsPublic: [17777, 18443] });
    const me = (await (await fetch(`${s.base}/api/me`, { headers: { authorization: `Bearer ${s.token()}` } })).json()) as { wire: { ports: number[] } };
    expect(me.wire.ports).toEqual([17777, 18443]);
    await s.close();
  });
});
