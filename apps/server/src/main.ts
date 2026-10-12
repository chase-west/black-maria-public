import { loadConfig } from "./config.js";
import { startServer } from "./server.js";
import { ensureDevToken } from "./tokens.js";

const cfg = loadConfig();
const running = await startServer(cfg);
if (cfg.devToken) {
  ensureDevToken(running.db, cfg.devToken);
  console.log(`dev token: ${cfg.devToken}`);
  console.log(`magic link: ${cfg.publicUrl}/enter/${cfg.devToken}  (web dev server: http://localhost:5173/enter/${cfg.devToken})`);
}
console.log(`BLACK MARIA server on :${running.port} (db ${cfg.dbPath}, max ${cfg.maxConcurrentMatches} matches)`);

let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  console.log(`draining: waiting up to ${cfg.shutdownGraceMs}ms for ${running.hub.matches.size} live matches`);
  await running.hub.drain(cfg.shutdownGraceMs);
  await running.close();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
process.on("uncaughtException", (err) => console.error("uncaught", err));
process.on("unhandledRejection", (err) => console.error("unhandled", err));
