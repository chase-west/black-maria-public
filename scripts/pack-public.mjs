#!/usr/bin/env node
// Build the two published npm packages as tarballs with no dependencies:
//   @black-maria/sim (bin: sim)          from packages/sim
//   blackmaria       (bin: blackmaria)   from packages/client
// The workspace packages they use (engine, protocol, house-bots) are bundled in with esbuild; type declarations are
// emitted by tsc and their workspace imports rewritten to relative paths.
//
// usage: node scripts/pack-public.mjs [--out DIR]     (default DIR: dist-publish)
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outArg = process.argv.indexOf("--out");
const out = resolve(outArg > 0 ? process.argv[outArg + 1] : join(root, "dist-publish"));
mkdirSync(out, { recursive: true });

// esbuild comes with tsx (a root dev dependency), so publishing needs no new dependency.
const req = createRequire(realpathSync(join(root, "node_modules/tsx/package.json")));
const esbuild = req(req.resolve("esbuild"));
const tsc = join(root, "node_modules/typescript/bin/tsc");

const WORKSPACE = {
  "@blackmaria/protocol/wire": "protocol/src/wire/index.js",
  "@blackmaria/protocol": "protocol/src/index.js",
  "@blackmaria/engine": "engine/src/index.js",
  "@blackmaria/house-bots": "house-bots/src/index.js",
  "@black-maria/sim": "sim/src/index.js",
  "@blackmaria/client": "client/src/index.js",
};

function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

/** Declarations for `entry` and everything it imports from the workspace, under `<stage>/types/<package>/src/...`. */
function emitTypes(pkgDir, stage) {
  const tmp = join(stage, ".tsconfig.types.json");
  const typesDir = join(stage, "types");
  writeFileSync(
    tmp,
    JSON.stringify({
      extends: join(root, "tsconfig.base.json"),
      compilerOptions: {
        rootDir: join(root, "packages"),
        outDir: typesDir,
        declaration: true,
        emitDeclarationOnly: true,
        noEmit: false,
        sourceMap: false,
        declarationMap: false,
        skipLibCheck: true,
        types: ["node"],
        typeRoots: [join(root, "node_modules/@types")],
        // Point workspace imports straight at their sources so tsc emits their declarations too.
        paths: Object.fromEntries(Object.entries(WORKSPACE).map(([k, v]) => [k, [join(root, "packages", v.replace(/\.js$/, ".ts"))]])),
      },
      files: [join(pkgDir, "src/index.ts")],
    }),
  );
  execFileSync(process.execPath, [tsc, "-p", tmp], { stdio: "inherit", cwd: pkgDir });
  rmSync(tmp);
  for (const f of walk(typesDir)) {
    if (!f.endsWith(".d.ts")) continue;
    let text = readFileSync(f, "utf8");
    text = text.replace(/(from |import\()(["'])(@black-?maria\/[a-z-]+(?:\/wire)?)\2/g, (m, pre, q, spec) => {
      const target = WORKSPACE[spec];
      if (!target) return m;
      let rel = relative(dirname(f), join(typesDir, target)).replace(/\\/g, "/");
      if (!rel.startsWith(".")) rel = "./" + rel;
      return `${pre}${q}${rel}${q}`;
    });
    writeFileSync(f, text);
  }
}

async function bundle(pkgDir, stage, entries) {
  await esbuild.build({
    absWorkingDir: pkgDir,
    entryPoints: entries,
    outdir: join(stage, "dist"),
    bundle: true,
    splitting: true,
    format: "esm",
    platform: "node",
    target: "node20",
    conditions: ["source"],
    legalComments: "none",
    logLevel: "warning",
    banner: { js: "// BLACK MARIA. Built from the workspace sources by scripts/pack-public.mjs." },
  });
  const bin = join(stage, "dist/bin.js");
  if (existsSync(bin)) writeFileSync(bin, "#!/usr/bin/env node\n" + readFileSync(bin, "utf8").replace(/^#!.*\n/gm, ""));
}

function pack(stage) {
  const r = execFileSync("npm", ["pack", "--json", "--pack-destination", out], { cwd: stage, encoding: "utf8" });
  const info = JSON.parse(r)[0];
  return join(out, info.filename);
}

const common = {
  version: "0.7.1",
  type: "module",
  license: "MIT",
  author: "Chase West",
  engines: { node: ">=20" },
  sideEffects: false,
  publishConfig: { access: "public" },
};
const repository = (directory) => ({ type: "git", url: "git+https://github.com/chase-west/black-maria.git", directory });

async function buildSim() {
  const pkgDir = join(root, "packages/sim");
  const stage = join(root, "packages/sim/.publish");
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });
  await bundle(pkgDir, stage, { index: "src/index.ts", bin: "src/bin.ts" });
  emitTypes(pkgDir, stage);
  cpSync(join(pkgDir, "README.md"), join(stage, "README.md"));
  cpSync(join(root, "LICENSE"), join(stage, "LICENSE"));
  writeFileSync(
    join(stage, "package.json"),
    JSON.stringify(
      {
        name: "@black-maria/sim",
        ...common,
        repository: repository("packages/sim"),
        description: "BLACK MARIA simulator: the engine, Maria's three tiers, a local match runner, a local wire server with the network profiles, a replay printer and the profiler.",
        bin: { sim: "dist/bin.js" },
        exports: { ".": { types: "./types/sim/src/index.d.ts", default: "./dist/index.js" } },
        types: "./types/sim/src/index.d.ts",
        files: ["dist", "types", "README.md", "LICENSE"],
      },
      null,
      2,
    ) + "\n",
  );
  return pack(stage);
}

async function buildClient() {
  const pkgDir = join(root, "packages/client");
  const stage = join(root, "packages/client/.publish");
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });
  await bundle(pkgDir, stage, { index: "src/index.ts", bin: "src/bin.ts" });
  emitTypes(pkgDir, stage);
  cpSync(join(pkgDir, "README.md"), join(stage, "README.md"));
  cpSync(join(pkgDir, "python"), join(stage, "python"), { recursive: true, filter: (p) => !p.includes("__pycache__") });
  cpSync(join(pkgDir, "src"), join(stage, "src"), { recursive: true });
  cpSync(join(pkgDir, "templates"), join(stage, "templates"), { recursive: true });
  cpSync(join(root, "LICENSE"), join(stage, "LICENSE"));
  writeFileSync(
    join(stage, "package.json"),
    JSON.stringify(
      {
        name: "blackmaria",
        ...common,
        repository: repository("packages/client"),
        description: "BLACK MARIA wire client in TypeScript and Python, with the starter bot. Mediocre on purpose: the README lists how.",
        bin: { blackmaria: "dist/bin.js" },
        exports: { ".": { types: "./types/client/src/index.d.ts", default: "./dist/index.js" } },
        types: "./types/client/src/index.d.ts",
        files: ["dist", "types", "src", "python", "templates", "README.md", "LICENSE"],
      },
      null,
      2,
    ) + "\n",
  );
  return pack(stage);
}

const sim = await buildSim();
const client = await buildClient();
console.log(sim);
console.log(client);
