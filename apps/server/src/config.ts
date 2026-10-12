import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface Config {
  port: number;
  host: string;
  dbPath: string;
  dataDir: string;
  replayDir: string;
  uploadDir: string;
  adminToken: string | null;
  windowOpens: Date;
  windowCloses: Date;
  maxConcurrentMatches: number;
  /** Deadline per tick: practice over the WebSocket, and everything over the wire (SPEC 5.1, 5.6). */
  tickMs: { practice: number; wire: number };
  /** UDP port for the wire (SPEC 5.2). */
  wirePort: number;
  /** The second UDP port the wire also listens on (SPEC 5.2: 443), or null for none. */
  wireFallbackPort: number | null;
  /** The wire's public hostname, given to clients by `/api/me` (a plain A record, never behind a proxying CDN). */
  wireHost: string;
  /** The UDP ports clients are told (`/api/me`) when they differ from the bound ones (a port-mapped test deploy), else null. */
  wirePortsPublic: number[] | null;
  /** The candidate clock (SPEC 7). `minuteMs` is the length of one clock minute: 60 000 in production, shorter in tests. */
  clock: { minuteMs: number; sweepMs: number };
  /** The reviewer's seams checklist, read if present (SPEC 2.4, 8). */
  reviewChecklist: string;
  /** Test hook: shorten matches. Never set in production. */
  maxTickOverride: number | null;
  publicUrl: string;
  /**
   * What candidates download (SPEC 6): the public repository and the two published packages. `downloadsDir` holds the
   * tarballs `scripts/pack-public.mjs` writes and `blackmaria-public.tar.gz` from `scripts/export-public.mjs`, served
   * at `/download/...`. `publicRepoUrl` (a git URL), when set, is shown instead of the repository tarball, and
   * `packagesOnNpm` says the two packages are on the npm registry, so the install line uses their names.
   */
  downloadsDir: string;
  publicRepoUrl: string | null;
  packagesOnNpm: boolean;
  webDist: string | null;
  assetsDir: string;
  docsDir: string;
  cookieSecure: boolean;
  devToken: string | null;
  limits: {
    practicePerHour: number;
    practiceConcurrent: number;
    officialAttempts: number;
    framesPerSecond: number;
    frameBurst: number;
    helloTimeoutMs: number;
    connectionsPerToken: number;
    connectionsPerIp: number;
    /** Wire sessions from one source address at once (candidates behind one NAT share it). */
    wireSessionsPerIp: number;
    maxConnections: number;
    httpPerMinute: number;
    enterPerMinute: number;
  };
  /** Trust X-Forwarded-For (behind Caddy). */
  trustProxy: boolean;
  /** On SIGTERM, wait this long for live matches to finish before stopping. */
  shutdownGraceMs: number;
}

/** The local development token (32 hex characters, so it also works on the wire). */
export const DEV_TOKEN = "deadbeefdeadbeefdeadbeefdeadbeef";

export function repoRoot(): string {
  let d = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (existsSync(join(d, "pnpm-workspace.yaml"))) return d;
    const up = dirname(d);
    if (up === d) return process.cwd();
    d = up;
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname || "localhost";
  } catch {
    return "localhost";
  }
}

function int(v: string | undefined, d: number): number {
  const n = v === undefined ? NaN : Number(v);
  return Number.isFinite(n) ? n : d;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, overrides: Partial<Config> = {}): Config {
  const root = repoRoot();
  const dataDir = resolve(env.DATA_DIR ?? join(root, "data"));
  const now = Date.now();
  const webDist = resolve(env.WEB_DIST ?? join(root, "apps/web/dist"));
  const base: Config = {
    port: int(env.PORT, 8787),
    host: env.HOST ?? "0.0.0.0",
    dataDir,
    dbPath: resolve(env.DB_PATH ?? join(dataDir, "blackmaria.db")),
    replayDir: resolve(env.REPLAY_DIR ?? join(dataDir, "replays")),
    uploadDir: resolve(env.UPLOAD_DIR ?? join(dataDir, "uploads")),
    adminToken: env.ADMIN_TOKEN && env.ADMIN_TOKEN.length >= 8 ? env.ADMIN_TOKEN : null,
    windowOpens: env.WINDOW_OPENS ? new Date(env.WINDOW_OPENS) : new Date(now - 24 * 3600_000),
    windowCloses: env.WINDOW_CLOSES ? new Date(env.WINDOW_CLOSES) : new Date(now + 7 * 24 * 3600_000),
    maxConcurrentMatches: int(env.MAX_CONCURRENT_MATCHES, 40),
    tickMs: { practice: int(env.TICK_MS_PRACTICE, 250), wire: int(env.TICK_MS_WIRE, 250) },
    wirePort: int(env.WIRE_PORT, 7777),
    wireFallbackPort: env.WIRE_PORT_FALLBACK === "0" || env.WIRE_PORT_FALLBACK === "off" ? null : int(env.WIRE_PORT_FALLBACK, 443),
    wirePortsPublic: env.WIRE_PORTS_PUBLIC ? env.WIRE_PORTS_PUBLIC.split(",").map((p) => Number(p.trim())).filter((p) => Number.isInteger(p) && p > 0 && p < 65536) : null,
    wireHost: env.WIRE_HOST ?? hostOf(env.PUBLIC_URL ?? `http://localhost:${int(env.PORT, 8787)}`),
    clock: { minuteMs: int(env.CLOCK_MINUTE_MS, 60_000), sweepMs: int(env.CLOCK_SWEEP_MS, 5_000) },
    reviewChecklist: resolve(env.REVIEW_CHECKLIST ?? join(resolve(env.DOCS_DIR ?? join(root, "docs")), "SEAMS.md")),
    maxTickOverride: null,
    publicUrl: env.PUBLIC_URL ?? `http://localhost:${int(env.PORT, 8787)}`,
    downloadsDir: resolve(env.DOWNLOADS_DIR ?? join(root, "dist-publish")),
    publicRepoUrl: env.PUBLIC_REPO_URL ? env.PUBLIC_REPO_URL : null,
    packagesOnNpm: env.PACKAGES_ON_NPM === "1",
    webDist: existsSync(webDist) ? webDist : null,
    assetsDir: resolve(env.ASSETS_DIR ?? join(root, "assets")),
    docsDir: resolve(env.DOCS_DIR ?? join(root, "docs")),
    cookieSecure: env.COOKIE_SECURE === "1" || (env.PUBLIC_URL ?? "").startsWith("https://"),
    devToken: env.DEV_TOKEN ?? (env.NODE_ENV === "production" ? null : DEV_TOKEN),
    limits: {
      practicePerHour: 60,
      practiceConcurrent: 2,
      officialAttempts: 1,
      framesPerSecond: 40,
      frameBurst: 80,
      helloTimeoutMs: 10_000,
      connectionsPerToken: 8,
      connectionsPerIp: int(env.WS_PER_IP, 64),
      wireSessionsPerIp: int(env.WIRE_SESSIONS_PER_IP, 16),
      maxConnections: int(env.MAX_CONNECTIONS, 1000),
      httpPerMinute: int(env.HTTP_PER_MINUTE, 600),
      enterPerMinute: 30,
    },
    trustProxy: env.TRUST_PROXY === "1",
    shutdownGraceMs: int(env.SHUTDOWN_GRACE_MS, 15_000),
  };
  return {
    ...base,
    ...overrides,
    limits: { ...base.limits, ...(overrides.limits ?? {}) },
    tickMs: { ...base.tickMs, ...(overrides.tickMs ?? {}) },
    clock: { ...base.clock, ...(overrides.clock ?? {}) },
  };
}
