/**
 * `blackmaria init`: write `my_bot.ts` or `my_bot.py` into a directory. It's the starter bot and the transport's five
 * hooks as shipped, from `templates/`, so `--bot my_bot.ts` plays exactly like the client with no `--bot`.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

export type Lang = "ts" | "py";
export const BOT_FILES: Record<Lang, string> = { ts: "my_bot.ts", py: "my_bot.py" };

// src/init.ts, dist/init.js and the published bundle's dist/*.js all sit one level under the package root.
const TEMPLATES = fileURLToPath(new URL("../templates/", import.meta.url));
const PYTHON_CLI = fileURLToPath(new URL("../python/blackmaria.py", import.meta.url));

export class InitError extends Error {}

/** The Python client's path as you'd type it from `dir`. */
function pythonCli(dir: string): string {
  const rel = relative(dir, PYTHON_CLI);
  const path = rel.startsWith("..") ? PYTHON_CLI : rel;
  return /\s/.test(path) ? `"${path}"` : path;
}

/**
 * Write the bot file. Without `lang`: TypeScript if `dir` has a package.json, Python if not. Never overwrites.
 * Returns the file written and the command that runs it.
 */
export function initBot(dir: string, lang?: Lang): { file: string; lang: Lang; run: string } {
  const l: Lang = lang ?? (existsSync(join(dir, "package.json")) ? "ts" : "py");
  const name = BOT_FILES[l];
  const file = join(dir, name);
  if (existsSync(file)) throw new InitError(`${name} is already here. init won't overwrite it.`);
  let text = readFileSync(join(TEMPLATES, name), "utf8");
  if (l === "py") text = text.replace("python3 python/blackmaria.py", `python3 ${pythonCli(dir)}`);
  writeFileSync(file, text, { flag: "wx" });
  const run = /^(?:\/\/|#) Run it: (.*)$/m.exec(text)?.[1] ?? "";
  return { file, lang: l, run };
}
