/** Where to connect and as whom: flags, then the environment, then `./.env`, then the portal's `/api/me`. */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Used against a local simulator, which accepts any 16-byte token. */
export const LOCAL_TOKEN = "00000000000000000000000000000000";
export const DEFAULT_PORTS = [7777, 443];

export class ConfigError extends Error {}

/** KEY=value lines from `./.env`; real environment variables win. */
export function loadDotEnv(dir: string, env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  const file = join(dir, ".env");
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trim().startsWith("#")) continue;
    let v = m[2]!;
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (env[m[1]!] === undefined) out[m[1]!] = v;
  }
  return out;
}

export function tokenBytes(token: string): Uint8Array {
  if (!/^[0-9a-fA-F]{32}$/.test(token)) throw new ConfigError("A token is the 32 characters (0-9, a-f) at the end of your magic link.");
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) out[i] = parseInt(token.slice(2 * i, 2 * i + 2), 16);
  return out;
}

export function parsePorts(s: string): number[] {
  const ports = s.split(",").map((x) => Number(x.trim()));
  if (ports.length === 0 || ports.some((p) => !Number.isInteger(p) || p < 1 || p > 65535)) throw new ConfigError(`Ports are numbers from 1 to 65535, comma-separated, like 7777,443. You gave ${s}.`);
  return ports;
}

export interface Target {
  host: string;
  ports: number[];
  token: string;
  /** A sentence about where this came from, printed before connecting. */
  note: string | null;
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1"]);

/**
 * Resolve the wire host, ports and token. With a portal URL (`--server` or `BM_SERVER`), the host and ports come from
 * its `/api/me`, so you never type them. With nothing set, the client plays a local simulator on 127.0.0.1.
 */
export async function resolveTarget(flags: { token?: string; server?: string; host?: string; ports?: string }, env: NodeJS.ProcessEnv, cwd: string): Promise<Target> {
  const dot = loadDotEnv(cwd, env);
  const get = (k: string) => env[k] ?? dot[k];
  const server = flags.server ?? get("BM_SERVER");
  let host = flags.host ?? get("BM_HOST");
  const portsText = flags.ports ?? get("BM_PORTS");
  let ports = portsText ? parsePorts(portsText) : null;
  let token = flags.token ?? get("BM_TOKEN");
  let note: string | null = null;
  if (server && !host) {
    if (!token) throw new ConfigError("Set BM_TOKEN or pass --token: it's the last 32 characters of your magic link.");
    let me: { wire?: { host?: unknown; ports?: unknown } };
    try {
      const r = await fetch(new URL("/api/me", server), { headers: { authorization: `Bearer ${token}` } });
      if (r.status === 401) throw new ConfigError(`${server} doesn't know that token. Copy it again from your magic link.`);
      if (!r.ok) throw new ConfigError(`${server}/api/me answered ${r.status}. Check the address, or pass --host instead.`);
      me = (await r.json()) as typeof me;
    } catch (err) {
      if (err instanceof ConfigError) throw err;
      throw new ConfigError(`Couldn't reach ${server} (${err instanceof Error ? err.message : String(err)}). Check the address, or pass --host instead.`);
    }
    if (typeof me.wire?.host !== "string") throw new ConfigError(`${server}/api/me didn't say where the wire is. Pass --host instead.`);
    host = me.wire.host;
    if (!ports && Array.isArray(me.wire.ports) && me.wire.ports.every((p) => typeof p === "number")) ports = me.wire.ports as number[];
  }
  if (!host) {
    host = "127.0.0.1";
    note = "No server set, so this plays a local simulator on 127.0.0.1 (start one with: npx @black-maria/sim wire). To play the real server, set BM_SERVER and BM_TOKEN.";
  }
  if (!token) {
    if (!LOOPBACK.has(host)) throw new ConfigError("Set BM_TOKEN or pass --token: it's the last 32 characters of your magic link.");
    token = LOCAL_TOKEN;
  }
  tokenBytes(token);
  return { host, ports: ports ?? DEFAULT_PORTS, token, note };
}
