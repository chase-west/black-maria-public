import { describe, expect, it } from "vitest";
import { RULE_CHANGES, type ErrorMsg, type MatchStartMsg, type StateMsg, type WelcomeMsg } from "@blackmaria/protocol";
import { ERR, ERROR_TEXT, type Packet } from "@blackmaria/protocol/wire";
import { tokenBytes } from "@black-maria/sim";
import { EXPIRED_SENTENCE, OFFICIAL_LATE_SENTENCE } from "../src/index.js";
import { RawWire } from "./raw-wire.js";
import { TestClient } from "./client.js";
import { boot, connect, type Booted } from "./setup.js";

const ADMIN = { "x-admin-token": "admin-secret-123", "content-type": "application/json" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const isError = (p: Packet): p is Extract<Packet, { type: "ERROR" }> => p.type === "ERROR";

async function enter(s: Booted, token: string): Promise<number> {
  const r = await fetch(`${s.base}/enter/${token}`, { redirect: "manual" });
  expect(r.status).toBe(302);
  return s.db.getToken(token)!.opened_at!;
}
const me = async (s: Booted, token: string) => (await (await fetch(`${s.base}/api/me`, { headers: { authorization: `Bearer ${token}` } })).json()) as any;

describe("the 90-minute clock (SPEC 7)", () => {
  it("starts on the first open of the magic link, and refuses the token everywhere once it runs out, except the reviewer API", async () => {
    // One clock minute is 20 ms: 90 minutes are 1.8 s.
    const s = await boot({ clock: { minuteMs: 20, sweepMs: 50 }, maxTickOverride: 400, tickMs: { practice: 25, wire: 25 } });
    try {
      const token = s.token();
      expect(s.db.getToken(token)!.opened_at).toBeNull();
      const t0 = await enter(s, token);
      expect(Math.abs(t0 - Date.now())).toBeLessThan(1000);
      // A second open does not restart it.
      await sleep(30);
      await enter(s, token);
      expect(s.db.getToken(token)!.opened_at).toBe(t0);
      const before = await me(s, token);
      expect(before.clock.expired).toBe(false);
      expect(before.clock.seconds_left).toBeLessThanOrEqual(2);
      expect(new Date(before.clock.ends_at).getTime()).toBe(t0 + 90 * 20);

      // A practice match over the WebSocket that would outlast the clock.
      const ws = await connect(s.url, token);
      const welcome = ws.msgs.find((m) => m.type === "welcome") as WelcomeMsg;
      expect(welcome.seconds_left).toBeLessThanOrEqual(2);
      ws.send({ type: "join", mode: "practice", tier: "novice" });
      const start = await ws.next<MatchStartMsg>("match_start");

      const raw = new RawWire(s.wirePort, tokenBytes(token)!);
      await raw.ready;
      const ack = await raw.helloAndWait(0);
      expect(ack.type).toBe("HELLO_ACK");
      if (ack.type === "HELLO_ACK") expect(ack.clockS).toBeLessThanOrEqual(2);

      await sleep(Math.max(0, t0 + 1900 - Date.now()));

      // The WebSocket practice match ends with the clock, and new moves and joins are refused with a sentence.
      const st = await ws.next<StateMsg>("state");
      ws.send({ type: "intent", match_id: start.match_id, tick: st.tick, intent: { kind: "WAIT" } });
      await ws.wait((m) => m.type === "match_end" && m.match_id === start.match_id, 5000);
      ws.send({ type: "join", mode: "practice", tier: "novice" });
      const refused = await ws.wait<ErrorMsg>((m) => m.type === "error" && m.code === "clock_expired", 2000);
      expect(refused.message).toBe(EXPIRED_SENTENCE);
      const late = new TestClient(s.url);
      await late.opened;
      late.send({ type: "hello", token });
      expect((await late.wait<ErrorMsg>((m) => m.type === "error")).code).toBe("clock_expired");

      // The wire: a session's datagrams get ERROR 2, and a new HELLO is refused with ERROR 2.
      const mark = raw.mark;
      raw.send({ type: "PING", clientMs: 1 });
      expect((await raw.wait(isError, 3000, mark)).code).toBe(ERR.CLOCK_EXPIRED);
      const again = await raw.helloAndWait(0);
      expect(again).toMatchObject({ type: "ERROR", code: ERR.CLOCK_EXPIRED, msg: ERROR_TEXT[2] });

      // HTTP: every candidate action is refused with a sentence; the status and the reviewer API still answer.
      const auth = { authorization: `Bearer ${token}` };
      for (const [method, path] of [["GET", "/api/matches"], ["GET", "/api/practice"], ["POST", "/api/submit"], ["GET", `/api/replay/${start.match_id}`]] as const) {
        const r = await fetch(`${s.base}${path}`, { method, headers: auth, ...(method === "POST" ? { body: new FormData() } : {}) });
        expect(r.status, path).toBe(403);
        expect(await r.json()).toEqual({ error: "clock_expired", message: EXPIRED_SENTENCE });
      }
      const after = await me(s, token);
      expect(after.clock.expired).toBe(true);
      expect(after.clock.seconds_left).toBe(0);
      expect(after.official).toEqual({ open: false, reason: "Time's up, so the official run is closed." });
      expect((await fetch(`${s.base}/api/official`, { headers: auth })).status).toBe(200);
      const rev = (await (await fetch(`${s.base}/api/admin/candidates/${token}`, { headers: ADMIN })).json()) as any;
      expect(rev.clock.expired).toBe(true);
      expect((await fetch(`${s.base}/api/replay/${start.match_id}`, { headers: ADMIN })).status).toBe(200);
      ws.close();
      late.close();
      raw.close();
    } finally {
      await s.close();
    }
  });

  it("an official run already in progress plays to the end after the clock runs out", async () => {
    const s = await boot({ clock: { minuteMs: 20, sweepMs: 50 }, maxTickOverride: 12, tickMs: { practice: 25, wire: 40 } });
    try {
      const token = s.token();
      const t0 = await enter(s, token);
      // Start late enough (minute 61) that the run is still playing when the clock runs out.
      await sleep(Math.max(0, t0 + 61 * 20 - Date.now()));
      const raw = new RawWire(s.wirePort, tokenBytes(token)!);
      await raw.ready;
      expect((await raw.helloAndWait(1)).type).toBe("HELLO_ACK");
      // Keep the session alive past minute 90 and let every match play out (moves are WAIT).
      const ping = setInterval(() => raw.send({ type: "PING", clientMs: 1 }), 300);
      try {
        for (let i = 0; i < 400 && !s.db.listRuns(token)[0]?.finished_at; i++) await sleep(25);
        await sleep(600); // the last MATCH_ENDs are still in flight
      } finally {
        clearInterval(ping);
      }
      expect(Date.now()).toBeGreaterThan(t0 + 90 * 20);
      const run = s.db.listRuns(token)[0]!;
      expect(run.finished_at).not.toBeNull();
      expect(run.finished_at!).toBeGreaterThan(t0 + 90 * 20);
      expect(JSON.parse(run.profile_json!).played).toBe(9);
      const ends = new Set(raw.got.flatMap((g) => (g.packet.type === "MATCH_END" ? [g.packet.match] : [])));
      expect(ends.size).toBe(9);
      // Nothing about the run was refused while it was in progress (after it, a PING is refused like anything else).
      expect(raw.got.filter((g) => g.at < run.finished_at! && g.packet.type === "ERROR" && g.packet.code === ERR.CLOCK_EXPIRED)).toHaveLength(0);
      raw.close();
    } finally {
      await s.close();
    }
  });
});

const official = (s: Booted, token: string) => fetch(`${s.base}/api/official`, { headers: { authorization: `Bearer ${token}` } }).then((r) => r.json() as Promise<any>);
const reveal = (s: Booted, token: string) => fetch(`${s.base}/api/official/reveal`, { method: "POST", headers: { authorization: `Bearer ${token}` } });

describe("the official run is open from the start and must start before minute 85 (SPEC 2, 5.7, v6.3)", () => {
  it("starts it at minute 0 with no wait, refuses it from minute 85 with ERROR 2, and has no ERROR 8", async () => {
    const s = await boot({ maxTickOverride: 10 });
    try {
      expect(Object.values(ERR)).not.toContain(8);
      expect(Object.keys(ERROR_TEXT)).not.toContain("8");
      await fetch(`${s.base}/api/admin/cohorts/default`, { method: "PUT", headers: ADMIN, body: JSON.stringify({ rule_change: 1 }) });

      // Minute 86: closed, with its own sentence, and nothing recorded.
      const late = s.token("late@example.com");
      await enter(s, late);
      s.openAt(late, 86);
      const lateRaw = new RawWire(s.wirePort, tokenBytes(late)!);
      await lateRaw.ready;
      expect(await lateRaw.helloAndWait(1)).toMatchObject({ type: "ERROR", code: ERR.CLOCK_EXPIRED, msg: OFFICIAL_LATE_SENTENCE });
      expect(s.db.listRuns(late)).toHaveLength(0);
      expect((await me(s, late)).official.reason).toBe("Too late for the official run. It had to start by minute 85.");
      lateRaw.close();

      // Minute 0: open at once. The candidate never opened the Official page, so starting the run reveals the change,
      // and the HELLO_ACK that answers it already carries it.
      const token = s.token();
      await enter(s, token);
      const now = await me(s, token);
      expect(now.clock.minute).toBe(0);
      expect(now.official).toEqual({ open: true, reason: "Official run's open. Start it by minute 85." });
      expect(now.change).toBeNull();
      expect((await official(s, token)).official.open).toBe(true);
      const raw = new RawWire(s.wirePort, tokenBytes(token)!);
      await raw.ready;
      const mark = raw.mark;
      expect(await raw.helloAndWait(1)).toMatchObject({ type: "HELLO_ACK", ruleChange: 1 });
      const { blob } = await raw.nextBlob(mark);
      expect(blob.tier).toBe(0);
      expect(blob.params).toMatchObject({ postInterval: 3, expiryMin: 20, expiryMax: 45 });
      expect(s.db.listRuns(token)).toHaveLength(1);
      expect(s.db.getToken(token)!.change_revealed_at).not.toBeNull();
      expect((await me(s, token)).change.id).toBe(1);
      // One attempt.
      raw.close();
    } finally {
      await s.close();
    }
  });
});

describe("the change, revealed the first time the Official page opens (SPEC 2.2, 7, v6.3)", () => {
  it("is hidden until then, then shows on the API, in HELLO_ACK, in the next match start on the same session, by email once, and on the WebSocket", async () => {
    const s = await boot({ maxTickOverride: 6, tickMs: { practice: 25, wire: 25 } });
    try {
      expect((await fetch(`${s.base}/api/admin/cohorts/spring`, { method: "PUT", headers: ADMIN, body: JSON.stringify({ rule_change: 2 }) })).status).toBe(200);
      const token = s.token("lin@example.com", "spring");
      await enter(s, token);
      s.openAt(token, 5);
      const before = await me(s, token);
      expect(before.change).toBeNull();
      expect(before.change_revealed_at).toBeNull();
      expect(before.wire).toEqual({ host: s.cfg.wireHost, ports: [s.wirePort] });
      expect((await official(s, token)).change).toBeNull();

      // Practice before the reveal plays the default rules.
      const raw = new RawWire(s.wirePort, tokenBytes(token)!);
      await raw.ready;
      let mark = raw.mark;
      const ack1 = await raw.helloAndWait(0);
      expect(ack1).toMatchObject({ type: "HELLO_ACK", ruleChange: 0 });
      const session = ack1.type === "HELLO_ACK" ? ack1.session : -1;
      const first = await raw.nextBlob(mark);
      expect(first.blob.params).toMatchObject({ snatchCost: 100, regen: 1, postInterval: 6 });
      await raw.matchEnd(first.match);
      expect(s.db.listOutbox(token)).toHaveLength(0);

      // The Official page opens: the change, its flags, and when, recorded once.
      const r = await reveal(s, token);
      expect(r.status).toBe(200);
      const shown = (await r.json()) as any;
      expect(shown.change).toEqual(RULE_CHANGES[2]);
      expect(shown.change.flags).toBe("--snatch-cost 50 --regen 2");
      const at = s.db.getToken(token)!.change_revealed_at;
      expect(at).not.toBeNull();
      expect(shown.change_revealed_at).toBe(new Date(at!).toISOString());
      const again = (await (await reveal(s, token)).json()) as any;
      expect(again.change_revealed_at).toBe(shown.change_revealed_at);
      expect((await official(s, token)).change.id).toBe(2);

      // Same socket, same session: the next match uses it.
      mark = raw.mark;
      const ack2 = await raw.helloAndWait(0);
      expect(ack2).toMatchObject({ type: "HELLO_ACK", ruleChange: 2, session });
      const second = await raw.nextBlob(mark);
      expect(second.blob.params).toMatchObject({ snatchCost: 50, regen: 2, postInterval: 6 });
      const after = await me(s, token);
      expect(after.change).toEqual({ id: 2, rule: RULE_CHANGES[2].rule, meaning: RULE_CHANGES[2].meaning, flags: RULE_CHANGES[2].flags });
      expect(after.official.open).toBe(true);

      // One email: the change, the flags, and the official command.
      const mail = s.db.listOutbox(token);
      expect(mail).toHaveLength(1);
      expect(mail[0]!.to_addr).toBe("lin@example.com");
      expect(mail[0]!.subject).toBe("BLACK MARIA: the change");
      expect(mail[0]!.body).toContain(RULE_CHANGES[2].rule);
      expect(mail[0]!.body).toContain("--snatch-cost 50 --regen 2");
      expect(mail[0]!.body).toContain(`npx blackmaria official --server`);
      expect(mail[0]!.body).not.toMatch(/minute 60/);

      const ws = await connect(s.url, token);
      expect((ws.msgs.find((m) => m.type === "welcome") as WelcomeMsg).rule_change).toBe(2);
      ws.send({ type: "join", mode: "practice", tier: "adept" });
      const st = await ws.next<MatchStartMsg>("match_start");
      expect(st.params).toMatchObject({ snatch_cost: 50, regen: 2 });
      ws.close();

      // The reviewer sees when it was revealed; the cohort's change is locked.
      const rev = (await (await fetch(`${s.base}/api/admin/candidates/${token}`, { headers: ADMIN })).json()) as any;
      expect(rev.change_revealed_minute).toBe(5);
      expect(rev.clock.change_revealed).toBe(true);
      const list = (await (await fetch(`${s.base}/api/admin/candidates`, { headers: ADMIN })).json()) as any;
      expect(list.candidates[0].change_revealed_minute).toBe(5);
      const locked = await fetch(`${s.base}/api/admin/cohorts/spring`, { method: "PUT", headers: ADMIN, body: JSON.stringify({ rule_change: 1 }) });
      expect(locked.status).toBe(409);
      expect(((await locked.json()) as { message: string }).message).toMatch(/^A candidate in this cohort has already seen its change/);
      raw.close();
    } finally {
      await s.close();
    }
  });

  it("change 3 puts the Master network profile on every tier, and a cohort nobody set gets a change drawn by its id", async () => {
    const s = await boot({ maxTickOverride: 6 });
    try {
      await fetch(`${s.base}/api/admin/cohorts/net`, { method: "PUT", headers: ADMIN, body: JSON.stringify({ rule_change: 3 }) });
      const token = s.token("net@example.com", "net");
      await enter(s, token);
      await reveal(s, token);
      const raw = new RawWire(s.wirePort, tokenBytes(token)!);
      await raw.ready;
      const mark = raw.mark;
      expect(await raw.helloAndWait(0, 0, 1)).toMatchObject({ type: "HELLO_ACK", ruleChange: 3 });
      const { blob } = await raw.nextBlob(mark);
      expect(blob.params.chaos).toBe(3);
      raw.close();

      const other = s.token("x@example.com", "unset-cohort");
      await enter(s, other);
      expect((await me(s, other)).change).toBeNull();
      await reveal(s, other);
      const c = (await me(s, other)).change;
      expect([1, 2, 3]).toContain(c.id);
      expect((await me(s, other)).change.id).toBe(c.id);
      const list = (await (await fetch(`${s.base}/api/admin/cohorts`, { headers: ADMIN })).json()) as any;
      expect(list.cohorts.find((x: { id: string }) => x.id === "unset-cohort").rule_change).toBe(c.id);
    } finally {
      await s.close();
    }
  });

  it("is not emailed to a candidate who first opens the Official page past minute 85", async () => {
    const s = await boot();
    try {
      const token = s.token("late@test");
      await enter(s, token);
      s.openAt(token, 88);
      expect((await reveal(s, token)).status).toBe(200);
      expect(s.db.getToken(token)!.change_revealed_at).not.toBeNull();
      expect(s.db.listOutbox(token)).toHaveLength(0);
    } finally {
      await s.close();
    }
  });
});
