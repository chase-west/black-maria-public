import { createServer, type Server } from "node:http";
import { mkdirSync } from "node:fs";
import { getRequestListener } from "@hono/node-server";
import { WebSocketServer } from "ws";
import { CandidateClock } from "./clock.js";
import type { Config } from "./config.js";
import { Db } from "./db.js";
import { createApp } from "./http.js";
import { Hub } from "./hub.js";
import { LogMailer, type Mailer } from "./mail.js";
import { WireServer } from "@black-maria/sim";
import { DbWireHost } from "./wire-host.js";

export interface Running {
  http: Server;
  hub: Hub;
  wire: WireServer;
  wireHost: DbWireHost;
  clock: CandidateClock;
  mailer: Mailer;
  /** The bound UDP port (`WIRE_PORT`). */
  wirePort: number;
  /** Every bound UDP port: the wire port, then the fallback (443) if it could be bound. */
  wirePorts: number[];
  db: Db;
  cfg: Config;
  port: number;
  close(): Promise<void>;
}

/** Assemble and start the single-process server: HTTP (Hono) and WebSocket on one port, the wire on UDP. */
export async function startServer(cfg: Config, opts: { db?: Db; log?: (m: string, e?: unknown) => void; mailer?: Mailer; now?: () => number } = {}): Promise<Running> {
  mkdirSync(cfg.replayDir, { recursive: true });
  mkdirSync(cfg.uploadDir, { recursive: true });
  const db = opts.db ?? new Db(cfg.dbPath);
  // Recover from a crash: unfinished matches are aborted; unfinished official runs give the attempt back.
  db.abortUnfinished(Date.now());
  db.sql.prepare("DELETE FROM official_runs WHERE finished_at IS NULL").run();
  const log = opts.log ?? ((m: string, e?: unknown) => console.error(m, e ?? ""));
  const mailer = opts.mailer ?? new LogMailer(db, (m) => log(m));
  const clock = new CandidateClock(cfg, db, mailer, log, opts.now ?? Date.now);
  const hub = new Hub(cfg, db, clock, opts.log);
  const wireHost = new DbWireHost(cfg, db, clock, log);
  // The portal's watch feed (SPEC 8): wire matches mirrored to the token's open portal tabs.
  wireHost.onTick = (info, state) => hub.wireTick(info, state);
  wireHost.onMatchEnd = (info, state, report) => hub.wireEnded(info, state, report);
  const wire = new WireServer({ host: wireHost, tickMs: cfg.tickMs.wire, limits: { sessionsPerIp: cfg.limits.wireSessionsPerIp }, ...(cfg.maxTickOverride !== null ? { maxTick: cfg.maxTickOverride } : {}) });
  const wirePort = await wire.listen(cfg.wirePort, cfg.host);
  if (cfg.wireFallbackPort !== null && cfg.wireFallbackPort !== cfg.wirePort) {
    // UDP 443 for networks that block unusual UDP ports (SPEC 5.2). Binding it may need privileges; carry on without.
    await wire.listen(cfg.wireFallbackPort, cfg.host).catch((err: unknown) => log(`wire: could not listen on UDP ${cfg.wireFallbackPort}; clients will use ${wirePort} only`, err));
  }
  // Practice ends with the clock, even for candidates who are not sending anything.
  const sweep = setInterval(() => {
    try {
      hub.expirePractice();
    } catch (err) {
      log("clock sweep failed", err);
    }
  }, cfg.clock.sweepMs);
  sweep.unref?.();
  const app = createApp({ cfg, db, hub, clock, wireLive: () => wire.liveMatches, wirePorts: () => wire.ports, mailer });
  const http = createServer(getRequestListener(app.fetch));
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024, perMessageDeflate: false });
  http.on("upgrade", (req, socket, head) => {
    const url = req.url ?? "";
    if (!url.startsWith("/ws")) {
      socket.destroy();
      return;
    }
    socket.on("error", () => socket.destroy());
    wss.handleUpgrade(req, socket, head, (ws) => hub.handleConnection(ws, req));
  });
  http.on("clientError", (_err, socket) => socket.destroy());
  await new Promise<void>((res) => http.listen(cfg.port, cfg.host, () => res()));
  const addr = http.address();
  const port = typeof addr === "object" && addr ? addr.port : cfg.port;
  return {
    http,
    hub,
    wire,
    wireHost,
    clock,
    mailer,
    wirePort,
    wirePorts: wire.ports,
    db,
    cfg,
    port,
    async close() {
      clearInterval(sweep);
      hub.shutdown();
      wire.close();
      wss.close();
      await new Promise<void>((res) => http.close(() => res()));
      http.closeAllConnections?.();
      db.close();
    },
  };
}
