/**
 * The reviewer's seams checklist (SPEC 2.4, 8): read from the reviewer-only seams document if it is present. Each seam
 * is a row of its first table, or failing that each `##`/`###` heading, or failing that each top-level list item.
 */
import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { headingAnchor } from "@blackmaria/protocol";

export interface Seam {
  id: string;
  title: string;
  detail: string;
}

export interface SeamsChecklist {
  /** The file it came from, or null when there is none (the public repository has no such file). */
  source: string | null;
  seams: Seam[];
}

const clean = (s: string) => s.replace(/`/g, "").replace(/\*\*/g, "").trim();

export function parseSeams(md: string): Seam[] {
  const lines = md.split(/\r?\n/);
  const out: Seam[] = [];
  // 1. The first table: first cell is the seam, the second its detail.
  const start = lines.findIndex((l, i) => /^\|.*\|\s*$/.test(l) && /^\|\s*:?-{3,}/.test(lines[i + 1] ?? ""));
  if (start >= 0) {
    for (let i = start + 2; i < lines.length && /^\|.*\|\s*$/.test(lines[i]!); i++) {
      const cells = lines[i]!.split("|").slice(1, -1).map(clean);
      if (cells[0]) out.push({ id: headingAnchor(cells[0]), title: cells[0], detail: cells.slice(1).join(" — ") });
    }
    if (out.length) return out;
  }
  // 2. Headings below the title.
  for (let i = 0; i < lines.length; i++) {
    const m = /^#{2,3}\s+(.+)$/.exec(lines[i]!);
    if (!m) continue;
    const body: string[] = [];
    for (let j = i + 1; j < lines.length && !/^#{1,3}\s/.test(lines[j]!); j++) if (lines[j]!.trim()) body.push(lines[j]!.trim());
    const title = clean(m[1]!);
    out.push({ id: headingAnchor(title), title, detail: clean(body.join(" ")).slice(0, 2000) });
  }
  if (out.length) return out;
  // 3. Top-level list items.
  for (const l of lines) {
    const m = /^[-*]\s+(.+)$/.exec(l);
    if (m) out.push({ id: headingAnchor(clean(m[1]!)).slice(0, 80), title: clean(m[1]!), detail: "" });
  }
  return out;
}

export function loadSeams(path: string): SeamsChecklist {
  if (!existsSync(path)) return { source: null, seams: [] };
  try {
    return { source: basename(path), seams: parseSeams(readFileSync(path, "utf8")) };
  } catch {
    return { source: null, seams: [] };
  }
}
