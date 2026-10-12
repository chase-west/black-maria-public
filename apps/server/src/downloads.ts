/**
 * What a candidate downloads (SPEC 6): the public repository and the two published packages. The portal and the
 * invitation point at them, so a candidate never has to ask where the client or the simulator comes from.
 *
 * The files live in `cfg.downloadsDir` (the image builds them; locally, `node scripts/pack-public.mjs` writes the
 * tarballs to `dist-publish/`) and are served at `/download/<file>` without a login, because `npm install <url>`
 * cannot send the portal's cookie. They hold nothing that is not public.
 */
import { readdirSync } from "node:fs";
import type { Config } from "./config.js";

const PATTERNS = {
  client: /^blackmaria-\d[\w.-]*\.tgz$/,
  sim: /^black-maria-sim-\d[\w.-]*\.tgz$/,
  repo: /^blackmaria-public\.tar\.gz$/,
} as const;

/** The download files present, by role (the newest name when there are several versions). */
export function downloadFiles(dir: string): { client: string | null; sim: string | null; repo: string | null } {
  let names: string[] = [];
  try {
    names = readdirSync(dir).sort();
  } catch {
    /* no downloads directory: nothing to offer */
  }
  const pick = (re: RegExp) => names.filter((n) => re.test(n)).pop() ?? null;
  return { client: pick(PATTERNS.client), sim: pick(PATTERNS.sim), repo: pick(PATTERNS.repo) };
}

/** Whether `name` is one of the files this server offers. */
export function isDownload(dir: string, name: string): boolean {
  const f = downloadFiles(dir);
  return name === f.client || name === f.sim || name === f.repo;
}

export interface Downloads {
  /** The portal address to give the client (`--server` or `BM_SERVER`). */
  server: string;
  /** The public repository: a git URL, or the tarball on this server, or null if neither is set up. */
  repo: string | null;
  /** One command that installs both packages in the current directory, or null if they are not available. */
  install: string | null;
}

export function downloadsFor(cfg: Pick<Config, "publicUrl" | "downloadsDir" | "publicRepoUrl" | "packagesOnNpm">): Downloads {
  const base = cfg.publicUrl.replace(/\/+$/, "");
  const f = downloadFiles(cfg.downloadsDir);
  const url = (name: string) => `${base}/download/${name}`;
  const install = cfg.packagesOnNpm ? "npm install @black-maria/sim blackmaria" : f.sim && f.client ? `npm install ${url(f.sim)} ${url(f.client)}` : null;
  return { server: base, repo: cfg.publicRepoUrl ?? (f.repo ? url(f.repo) : null), install };
}
