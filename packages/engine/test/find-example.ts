// Research: find the worked example window (`find`), or write it into docs/RULES.md (`write`). Run with tsx.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { EXAMPLE, exampleAt, findExample, renderExample } from "./worked-example.js";
if (process.argv[2] === "write") {
  const p = join(new URL(".", import.meta.url).pathname, "../../../docs/RULES.md");
  const s = readFileSync(p, "utf8");
  const i = s.indexOf("## A worked example");
  const j = s.indexOf("## 1. The house");
  writeFileSync(p, s.slice(0, i) + renderExample(exampleAt(EXAMPLE.seed, EXAMPLE.from)) + "\n\n" + s.slice(j));
} else {
  const ex = findExample();
  console.log(JSON.stringify({ seed: ex.seed, from: ex.from }));
}
