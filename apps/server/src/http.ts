import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Hono, type Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import type { ProfilerReport, WireQuality } from "@blackmaria/protocol";
import type { WireMatchInfo } from "@black-maria/sim";
import { EXPIRED_SENTENCE, officialState, type CandidateClock } from "./clock.js";
import type { Config } from "./config.js";
import type { Db, MatchRow } from "./db.js";
import { COOKIE, type Hub } from "./hub.js";
import { chaosTimeline, connTicks, connTotals, wireQuality } from "./quality.js";
import { ReplayMismatch, expandReplay, readReplay } from "./replay.js";
import { serveFile } from "./static.js";
import { downloadsFor, isDownload } from "./downloads.js";
import { indexHtml } from "./site.js";
import type { Mailer } from "./mail.js";
import { mountPortalApi } from "./admin.js";
import { WindowCounter } from "./ratelimit.js";

export interface AppDeps {
  cfg: Config;
  db: Db;
  hub: Hub;
  clock: CandidateClock;
  /** Live wire matches (official runs are played on the wire). */
  wireLive?: () => WireMatchInfo[];
  /** The UDP ports the wire is bound to, in the order a client should try them. */
  wirePorts?: () => number[];
  /** The mailer (the outbox stub), for the admin's invitations. */
  mailer?: Mailer;
}

/**
 * What a candidate may still do once the clock has run out (SPEC 7): read their status, the rules, the official run
 * (an official run in progress plays to the end, and its results stay visible) and what they submitted.
 */
const OPEN_AFTER_CLOCK = new Set(["GET /api/me", "GET /api/rules", "GET /api/wire", "POST /api/logout", "GET /api/official", "GET /api/submission"]);

function parseJson<T>(s: string | null | undefined): T | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

/** The candidate's token from the session cookie or an Authorization: Bearer header. Never from the URL. */
export function requestToken(c: Context, deps: AppDeps): string | null {
  const auth = c.req.header("authorization");
  const bearer = auth && auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  const t = bearer ?? getCookie(c, COOKIE) ?? null;
  if (!t) return null;
  return deps.hub.lookupToken(t) ? t : null;
}

export function isAdmin(c: Context, deps: AppDeps): boolean {
  const want = deps.cfg.adminToken;
  if (!want) return false;
  const got = c.req.header("x-admin-token") ?? (c.req.header("authorization")?.startsWith("Admin ") ? c.req.header("authorization")!.slice(6) : null);
  if (!got || got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ got.charCodeAt(i);
  return diff === 0;
}

export function matchSummary(m: MatchRow) {
  return {
    id: m.id,
    mode: m.mode,
    tier: m.tier,
    transport: m.transport,
    started_at: new Date(m.started_at).toISOString(),
    ended_at: m.ended_at ? new Date(m.ended_at).toISOString() : null,
    result: m.result,
    scores: m.score_you === null ? null : { you: m.score_you, maria: m.score_maria },
    replay: `/replay/${m.id}`,
    run_id: m.run_id,
    run_index: m.run_index,
    wire_quality: parseJson<WireQuality>(m.wire_json),
  };
}

export function createApp(deps: AppDeps): Hono {
  const { cfg, db, hub, clock } = deps;
  const app = new Hono();

  app.onError((err, c) => {
    console.error("http error", err);
    return c.json({ error: "internal" }, 500);
  });

  // Per-address request limits (the WebSocket has its own frame limits).
  const perIp = new WindowCounter(cfg.limits.httpPerMinute, 60_000);
  const enterIp = new WindowCounter(cfg.limits.enterPerMinute, 60_000);
  const ipOf = (c: Context) => {
    const fwd = cfg.trustProxy ? (c.req.header("x-forwarded-for") ?? "").split(",")[0]!.trim() : "";
    const env = c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined;
    return fwd || env?.incoming?.socket?.remoteAddress || "?";
  };
  app.use("*", async (c, next) => {
    const p = c.req.path;
    if (p.startsWith("/api/") || p.startsWith("/enter/")) {
      const ip = ipOf(c);
      if (!perIp.hit(ip) || (p.startsWith("/enter/") && !enterIp.hit(ip))) return c.json({ error: "rate_limited" }, 429);
    }
    await next();
    c.header("x-content-type-options", "nosniff");
    c.header("referrer-policy", "same-origin");
    c.header("x-frame-options", "DENY");
  });

  // The clock (SPEC 7): a candidate's first authenticated request starts it if the magic link has not, and once it has
  // run out every candidate action is refused with a sentence. The reviewer API is never on the clock.
  app.use("/api/*", async (c, next) => {
    const p = c.req.path;
    if (p.startsWith("/api/admin/") || (p.startsWith("/api/replay/") && isAdmin(c, deps))) return next();
    const token = requestToken(c, deps);
    if (token) {
      clock.open(token);
      if (clock.expired(token) && !OPEN_AFTER_CLOCK.has(`${c.req.method} ${p}`)) return c.json({ error: "clock_expired", message: EXPIRED_SENTENCE }, 403);
    }
    await next();
  });

  app.get("/healthz", (c) => c.json({ ok: true, ...hub.stats() }));

  // Magic link: set an httpOnly session cookie and go home.
  app.get("/enter/:token", (c) => {
    const token = c.req.param("token");
    if (!hub.lookupToken(token)) return c.redirect("/?link=invalid", 302);
    // The first open starts the 90 minutes (SPEC 2, 7).
    clock.open(token);
    setCookie(c, COOKIE, token, { httpOnly: true, sameSite: "Lax", secure: cfg.cookieSecure, path: "/", maxAge: 60 * 60 * 24 * 30 });
    return c.redirect("/", 302);
  });

  app.get("/api/me", (c) => {
    const token = requestToken(c, deps);
    if (!token) return c.json({ error: "not_authenticated" }, 401);
    const row = hub.lookupToken(token)!;
    const st = clock.status(token)!;
    const iso = (t: number) => new Date(t).toISOString();
    const change = clock.revealedChange(token);
    return c.json({
      token,
      email: row.email,
      name: row.name,
      window: { opens: cfg.windowOpens.toISOString(), closes: cfg.windowCloses.toISOString(), open: hub.windowOpen() },
      attempts_left: hub.attemptsLeft(token),
      server_time: iso(st.now),
      clock: {
        opened_at: iso(st.opened_at),
        ends_at: iso(st.ends_at),
        official_closes_at: iso(st.official_closes_at),
        minute: Math.floor(st.minute),
        seconds_left: st.seconds_left,
        expired: st.expired,
      },
      // Revealed the first time you open the Official page, and not before (SPEC 2.2, v6.3).
      change: change ? { id: change.id, rule: change.rule, meaning: change.meaning, flags: change.flags } : null,
      change_revealed_at: (() => {
        const at = clock.revealedAt(token);
        return at === null ? null : iso(at);
      })(),
      official: officialState(st),
      // Where the wire is, so the client never asks you to type it (SPEC 5.2).
      wire: { host: cfg.wireHost, ports: (cfg.wirePortsPublic?.length ? cfg.wirePortsPublic : null) ?? deps.wirePorts?.() ?? [cfg.wirePort, ...(cfg.wireFallbackPort !== null && cfg.wireFallbackPort !== cfg.wirePort ? [cfg.wireFallbackPort] : [])] },
      ws_path: "/ws",
      // Where the public repository and the two packages come from, and the address to give the client (SPEC 6).
      get: downloadsFor(cfg),
    });
  });

  app.post("/api/logout", (c) => {
    setCookie(c, COOKIE, "", { httpOnly: true, sameSite: "Lax", secure: cfg.cookieSecure, path: "/", maxAge: 0 });
    return c.json({ ok: true });
  });

  app.get("/api/rules", (c) => {
    try {
      return c.text(readFileSync(join(cfg.docsDir, "RULES.md"), "utf8"));
    } catch {
      return c.text("rules unavailable", 500);
    }
  });

  // The wire specification (SPEC 5), served as published so the portal and the repository agree.
  app.get("/api/wire", (c) => {
    try {
      return c.text(readFileSync(join(cfg.docsDir, "WIRE.md"), "utf8"));
    } catch {
      return c.text("wire doc unavailable", 500);
    }
  });

  app.get("/api/matches", (c) => {
    const token = requestToken(c, deps);
    if (!token) return c.json({ error: "not_authenticated" }, 401);
    const limit = Math.max(1, Math.min(200, Number(c.req.query("limit") ?? 50) || 50));
    return c.json({ matches: db.listMatches(token, limit).map(matchSummary) });
  });

  // The profiler for one of your practice matches, and all of them in order (SPEC 8.3).
  app.get("/api/profiler/:id", (c) => {
    const token = requestToken(c, deps);
    if (!token) return c.json({ error: "not_authenticated" }, 401);
    const row = db.getPracticeProfile(c.req.param("id"));
    if (!row || row.token !== token) return c.json({ error: "not_found", message: "No profiler for that match. The profiler only covers finished practice matches." }, 404);
    return c.json({ match_id: row.match_id, ended_at: new Date(row.ended_at).toISOString(), profiler: parseJson<ProfilerReport>(row.profile_json) });
  });
  app.get("/api/practice", (c) => {
    const token = requestToken(c, deps);
    if (!token) return c.json({ error: "not_authenticated" }, 401);
    return c.json({ timeline: practiceTimeline(db, token) });
  });

  app.get("/api/replay/:id", (c) => {
    const id = c.req.param("id");
    if (!/^m_[0-9a-f]{1,32}$/.test(id)) return c.json({ error: "not_found" }, 404);
    const admin = isAdmin(c, deps);
    const token = requestToken(c, deps);
    const row = db.getMatch(id);
    if (!row || (!admin && row.token !== token)) return c.json({ error: "not_found" }, 404);
    const live = hub.matches.get(id);
    try {
      const log = live ? live.replayLog : row.replay_path ? readReplay(row.replay_path) : null;
      if (!log) return c.json({ error: "not_found" }, 404);
      const reviewer = admin && c.req.query("reviewer") !== "0";
      const doc = expandReplay(log, { reviewer, finished: !live && row.ended_at !== null });
      if (reviewer && log.transport === "wire") {
        doc.chaos_timeline = chaosTimeline(log);
        doc.wire_quality = wireQuality(log);
      }
      // The connection panel: for your own wire matches (no one else's reach this point) and for reviewers.
      if (log.transport === "wire") {
        doc.conn_timeline = connTicks(log);
        doc.conn_totals = connTotals(log);
      }
      return c.json(doc);
    } catch (err) {
      if (err instanceof ReplayMismatch) return c.json({ error: "replay_corrupt", message: err.message }, 500);
      return c.json({ error: "not_found" }, 404);
    }
  });

  mountPortalApi(app, deps);

  // Art, through the manifest, straight from the assets directory so art can be swapped without a rebuild.
  app.get("/assets/*", async (c) => {
    const rel = c.req.path.slice("/assets/".length);
    const res = await serveFile(cfg.assetsDir, rel, rel.endsWith(".json") ? "no-cache" : "public, max-age=300");
    return res ?? c.text("not found", 404);
  });

  // The public repository and the published packages (SPEC 6), for `npm install <url>`: no login, nothing private.
  app.get("/download/:file", async (c) => {
    const file = c.req.param("file");
    if (!isDownload(cfg.downloadsDir, file)) return c.text("No such download. The Simulator page lists what's available.", 404);
    const res = await serveFile(cfg.downloadsDir, file, "public, max-age=300");
    return res ?? c.text("No such download. The Simulator page lists what's available.", 404);
  });

  // The web app (built), with SPA fallback.
  app.get("*", async (c) => {
    const p = c.req.path;
    if (!cfg.webDist) return p !== "/" && p.includes(".") ? c.text("not found", 404) : c.text("BLACK MARIA server. Build apps/web to serve the portal.", 200);
    if (p !== "/" && p !== "/index.html" && p.includes(".")) {
      const res = await serveFile(cfg.webDist, p, p.startsWith("/static/") ? "public, max-age=31536000, immutable" : "no-cache");
      if (res) return res;
      return c.text("not found", 404);
    }
    // The head is filled per request: the favicon and the social card resolve through the manifest on PUBLIC_URL.
    const index = indexHtml(cfg.webDist, cfg.assetsDir, cfg.publicUrl);
    if (index === null) return c.text("not found", 404);
    c.header("cache-control", "no-cache");
    return c.html(index);
  });

  return app;
}

/**
 * A token's practice matches with their profiler lines, oldest first (SPEC 7, 8.3). `with_change` says whether the match
 * started after the candidate saw the change (v6.3), so the reviewer's timeline can mark the reveal.
 */
export function practiceTimeline(db: Db, token: string) {
  const revealed = db.getToken(token)?.change_revealed_at ?? null;
  return db.practiceProfiles(token).map((r) => {
    const started = db.getMatch(r.match_id)?.started_at ?? r.ended_at;
    return { match_id: r.match_id, tier: r.tier, transport: r.transport, ended_at: new Date(r.ended_at).toISOString(), with_change: revealed !== null && started >= revealed, profiler: parseJson<ProfilerReport>(r.profile_json) };
  });
}
