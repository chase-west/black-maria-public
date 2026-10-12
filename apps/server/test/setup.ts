import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, startServer, createToken, type Config, type Running } from "../src/index.js";
import { TestClient } from "./client.js";

export type Booted = Running & {
  url: string;
  base: string;
  token: (email?: string, cohort?: string) => string;
  /** Put a token's clock at `minute` (its first open was that many clock minutes ago). */
  openAt: (token: string, minute: number) => void;
};

export async function boot(over: Partial<Config> = {}): Promise<Booted> {
  const dir = mkdtempSync(join(tmpdir(), "bm-srv-"));
  const cfg = loadConfig(
    { DATA_DIR: dir, NODE_ENV: "test", ADMIN_TOKEN: "admin-secret-123" },
    { port: 0, wirePort: 0, wireFallbackPort: null, host: "127.0.0.1", tickMs: { practice: 60, wire: 25 }, maxTickOverride: 40, ...over },
  );
  const r = await startServer(cfg, { log: () => {} });
  let n = 0;
  return {
    ...r,
    url: `ws://127.0.0.1:${r.port}/ws`,
    base: `http://127.0.0.1:${r.port}`,
    token: (email = `t${++n}@test`, cohort?: string) => createToken(r.db, email, undefined, 1, cohort),
    openAt: (token, minute) => {
      r.db.setOpenedAt(token, Date.now() - minute * cfg.clock.minuteMs);
      r.clock.forget(token);
    },
  };
}

export async function connect(url: string, token: string | null, name = "test-bot"): Promise<TestClient> {
  const c = new TestClient(url);
  await c.opened;
  if (token !== null) {
    c.send({ type: "hello", token, name });
    await c.next("welcome");
  }
  return c;
}
