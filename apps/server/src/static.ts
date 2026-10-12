import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".map": "application/json",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".ico": "image/x-icon",
  ".tgz": "application/gzip",
  ".gz": "application/gzip",
};

/** Resolve `rel` inside `root`, refusing anything that escapes it. */
export function safeJoin(root: string, rel: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(rel);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;
  const base = resolve(root);
  const full = resolve(join(base, normalize("/" + decoded)));
  if (full !== base && !full.startsWith(base + sep)) return null;
  return full;
}

export async function serveFile(root: string, rel: string, cache: string): Promise<Response | null> {
  const p = safeJoin(root, rel);
  if (!p) return null;
  try {
    const st = await stat(p);
    if (!st.isFile()) return null;
    const body = await readFile(p);
    return new Response(body, { headers: { "content-type": MIME[extname(p).toLowerCase()] ?? "application/octet-stream", "cache-control": cache } });
  } catch {
    return null;
  }
}
