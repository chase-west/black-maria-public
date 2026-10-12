/**
 * `blackmaria play --vs novice` and `blackmaria official`: the published client's command line. `main` takes its
 * output streams so tests can run it in-process.
 */
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { RULE_CHANGES, isRuleChangeId } from "@blackmaria/protocol";
import { summaryLines } from "@blackmaria/protocol/wire";
import * as nodeModule from "node:module";
import { ConfigError, resolveTarget, tokenBytes } from "./config.js";
import { PROBE_TICKS, findings } from "./doctor.js";
import { InitError, initBot, type Lang } from "./init.js";
import { StarterBot } from "./starter.js";
import { ClientError, HOOK_NAMES, Transport, applyHooks, type Bot, type Hooks, type MatchSummary, type TransportOptions } from "./transport.js";

export interface Io {
  out(line: string): void;
  err(line: string): void;
}
const stdio: Io = { out: (l) => process.stdout.write(l + "\n"), err: (l) => process.stderr.write(l + "\n") };

export const VERSION = "0.7.1";

const HELP = `BLACK MARIA client ${VERSION}

  blackmaria init [--lang ts|py]
      Write my_bot.ts (or my_bot.py) here: the starter bot and the five transport hooks, as
      shipped. TypeScript if this directory has a package.json, Python if not. Never overwrites.
  blackmaria play --vs novice|adept|master [--n N] [--chaos off|novice|adept|master]
      Practice over the wire on that Maria's network profile, like the official run.
      --chaos off plays a clean link, --chaos <profile> picks another one. --n plays N
      matches one after another.
  blackmaria official
      Your official run: 9 matches, 3 at a time, one shot. Open from the start of your
      clock. It has to start by minute 85.
  blackmaria doctor [--ticks 60]
      A ${PROBE_TICKS}-tick probe against Novice on the Master network profile, then the numbers.

  --trace      print a line per tick: when the STATE came, how long the bot took, when the
               move left, and whether it made the deadline. Every match ends with a summary.

  Where to connect (flags, then the environment, then a .env file in this directory):
    --server URL   BM_SERVER   the portal address; the wire host and ports come from it
    --token T      BM_TOKEN    the 32 characters at the end of your magic link
    --host H       BM_HOST     the wire host, if you want to name it yourself
    --ports P      BM_PORTS    UDP ports to try in order (7777,443)
  With none of these, it plays a local simulator on 127.0.0.1 (npx @black-maria/sim wire).

  --bot FILE   a JavaScript module whose default export (or export named Bot) is a class with
               decide(state) returning a move. It can also export a Transport subclass, or
               hooks (onPacket, shouldResync, predictState, planMoves, onTick). Without it,
               the starter bot plays on the shipped transport.

The README lists what this client does badly. Fixing that is the job.`;

const TIERS = ["novice", "adept", "master"] as const;
const TITLE = { novice: "Novice", adept: "Adept", master: "Master" } as const;

class UsageError extends Error {}

function flags(argv: readonly string[]): { pos: string[]; f: Map<string, string | true> } {
  const f = new Map<string, string | true>();
  const pos: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith("--")) {
      pos.push(a);
      continue;
    }
    const eq = a.indexOf("=");
    if (eq > 0) f.set(a.slice(2, eq), a.slice(eq + 1));
    else if (a === "--help" || a === "--quiet" || a === "--trace") f.set(a.slice(2), true);
    else {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith("--")) throw new UsageError(`${a} needs a value.`);
      f.set(a.slice(2), v);
      i++;
    }
  }
  return { pos, f };
}

const val = (f: Map<string, string | true>, k: string): string | undefined => {
  const v = f.get(k);
  return v === true ? undefined : v;
};

/** What a --bot file gave: a bot, a transport subclass, hooks, or any of them. */
export interface BotFile {
  bot: () => Bot;
  transport: (new (o: TransportOptions) => Transport) | null;
  hooks: Partial<Hooks>;
}

const isTransport = (x: unknown): x is new (o: TransportOptions) => Transport =>
  typeof x === "function" && !!(x as { prototype?: object }).prototype && HOOK_NAMES.every((h) => typeof ((x as { prototype: Record<string, unknown> }).prototype[h]) === "function");

type Resolved = { url: string; format?: string | null };
type ResolveHook = (specifier: string, context: unknown, next: (specifier: string, context: unknown) => Resolved) => Resolved & { shortCircuit?: boolean };
let hooked = false;
/** Bot files loaded so far, by URL. */
const botUrls = new Set<string>();

/**
 * Two things for --bot files, through Node's module.registerHooks (without it, nothing changes):
 * - a `.ts` bot file is always an ES module, even where the nearest package.json doesn't say `"type": "module"`;
 * - `import ... from "blackmaria"` works when the package isn't installed where the file is (run through npx, say):
 *   if Node can't find it, it gets this copy.
 */
function hookBotFiles(url: string): void {
  botUrls.add(url);
  const register = (nodeModule as { registerHooks?: (hooks: { resolve: ResolveHook }) => unknown }).registerHooks;
  if (hooked || typeof register !== "function") return;
  hooked = true;
  const self = new URL(import.meta.url.endsWith(".ts") ? "./index.ts" : "./index.js", import.meta.url).href;
  register({
    resolve(specifier, context, next) {
      let r: Resolved;
      try {
        r = next(specifier, context);
      } catch (err) {
        if (specifier === "blackmaria") return { url: self, format: "module", shortCircuit: true };
        throw err;
      }
      return botUrls.has(r.url) && r.url.endsWith(".ts") ? { ...r, format: "module-typescript", shortCircuit: true } : r;
    },
  });
}

/**
 * Load a --bot file. Its default export (or export named Bot) is a bot class with decide(state), or a function that
 * returns one. It may also export `Transport` (a subclass of this package's Transport) and `hooks` (an object with
 * any of the five hooks), or the hooks as named functions.
 */
export async function loadBotFile(file: string): Promise<BotFile> {
  let mod: Record<string, unknown>;
  const url = pathToFileURL(resolve(file)).href;
  hookBotFiles(url);
  try {
    mod = (await import(url)) as Record<string, unknown>;
  } catch (err) {
    throw new UsageError(`Couldn't load ${file}: ${err instanceof Error ? err.message : String(err)}`);
  }
  const hooks: Partial<Hooks> = {};
  const fromObject = mod.hooks && typeof mod.hooks === "object" ? (mod.hooks as Record<string, unknown>) : {};
  for (const h of HOOK_NAMES) {
    const fn = fromObject[h] ?? mod[h];
    if (typeof fn === "function") Object.assign(hooks, { [h]: fn });
  }
  const x = mod.default ?? mod.Bot;
  const transport = isTransport(mod.Transport) ? mod.Transport : isTransport(x) ? x : null;
  let bot: (() => Bot) | null = null;
  if (x !== transport && typeof x === "function" && (x as { prototype?: { decide?: unknown } }).prototype?.decide) bot = () => new (x as new () => Bot)();
  else if (x !== transport && typeof x === "function") bot = x as () => Bot;
  if (!bot && !transport && Object.keys(hooks).length === 0) throw new UsageError(`${file} has no Bot class with decide(state), no Transport, and no hooks.`);
  return { bot: bot ?? (() => new StarterBot()), transport, hooks };
}

/** "network master", or "network off, clean link". */
export const networkWords = (chaos: string): string => (chaos === "off" ? "network off, clean link" : `network ${chaos}`);

function resultWords(m: MatchSummary): string {
  return m.result === "win" ? `you won ${m.you} to ${m.maria}` : m.result === "loss" ? `you lost ${m.you} to ${m.maria}` : `draw, ${m.you} to ${m.maria}`;
}

export async function main(argv: readonly string[], io: Io = stdio, env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): Promise<number> {
  let client: Transport | null = null;
  const onSigint = () => {
    io.err("Stopped.");
    client?.close();
    process.exit(130);
  };
  try {
    const { pos, f } = flags(argv);
    const cmd = pos[0];
    if (!cmd || cmd === "help" || f.has("help")) {
      io.out(HELP);
      return 0;
    }
    if (cmd === "init") {
      const lang = val(f, "lang");
      if (lang !== undefined && lang !== "ts" && lang !== "py") throw new UsageError(`--lang takes ts or py, not ${lang}.`);
      const made = initBot(cwd, lang as Lang | undefined);
      io.out(`Wrote ${basename(made.file)}. Run it:`);
      io.out(`  ${made.run}`);
      return 0;
    }
    if (cmd !== "play" && cmd !== "official" && cmd !== "doctor") throw new UsageError(`No command "${cmd}". Run "blackmaria help" for the list.`);
    const official = cmd === "official";
    const doctor = cmd === "doctor";
    const vs = doctor ? "novice" : (val(f, "vs") ?? (official ? "novice" : undefined));
    if (!vs) throw new UsageError("Pick a Maria: --vs novice, adept or master.");
    const tier = TIERS.indexOf(vs as (typeof TIERS)[number]);
    if (tier < 0) throw new UsageError(`--vs takes novice, adept or master, not ${vs}.`);
    // Practice plays on its Maria's network profile, like the official run, unless --chaos says otherwise.
    const chaosName = doctor ? "master" : (val(f, "chaos") ?? (official ? "off" : vs));
    const chaos = ["off", ...TIERS].indexOf(chaosName);
    if (chaos < 0) throw new UsageError(`--chaos takes off, novice, adept or master, not ${chaosName}.`);
    const n = doctor ? 1 : Number(val(f, "n") ?? 1);
    if (!Number.isInteger(n) || n < 1 || n > 1000) throw new UsageError("--n takes a whole number from 1 to 1000.");
    const probe = doctor ? Number(val(f, "ticks") ?? PROBE_TICKS) : undefined;
    if (probe !== undefined && (!Number.isInteger(probe) || probe < 10 || probe > 400)) throw new UsageError("--ticks takes a whole number from 10 to 400.");
    const botFile = val(f, "bot");
    const file = botFile ? await loadBotFile(resolve(cwd, botFile)) : { bot: () => new StarterBot(), transport: null, hooks: {} };
    const target = await resolveTarget({ token: val(f, "token"), server: val(f, "server"), host: val(f, "host"), ports: val(f, "ports") }, env, cwd);
    const quiet = f.has("quiet");
    if (target.note) io.out(target.note);
    if (official) io.out("This is your one official run: 9 matches, 3 at a time, about 5 minutes. Once the server answers, it can't be stopped. It plays to the end even if this program doesn't.");
    if (doctor) io.out(`Doctor: a ${probe}-tick probe against Maria (Novice) on the Master network profile, on ${target.host}.`);
    else io.out(official ? `Starting your official run on ${target.host}.` : `Practice against Maria (${TITLE[TIERS[tier]!]}) on ${target.host}, ${n} match${n === 1 ? "" : "es"}, ${networkWords(chaosName)}.`);
    let announced = false;
    let last: MatchSummary | null = null;
    const opts: TransportOptions = {
      host: target.host,
      ports: target.ports,
      token: tokenBytes(target.token),
      official,
      tier: tier as 0 | 1 | 2,
      chaos: chaos as 0 | 1 | 2 | 3,
      matches: n,
      bot: file.bot,
      trace: f.has("trace"),
      out: (line) => io.out(line),
      log: (line) => {
        if (!quiet) io.out(line);
      },
      onSummary: (s, m) => {
        last = m;
        for (const line of summaryLines(s)) io.out(line);
      },
      onHelloAck: (a) => {
        if (announced) return;
        announced = true;
        const clock = a.clockS === 0xffffffff ? "no clock (a local simulator)" : `${Math.floor(a.clockS / 60)} minutes ${a.clockS % 60} seconds left on your clock`;
        io.out(official ? `Connected on UDP port ${client?.connectedPort}: ${clock}. The run has started.` : `Connected on UDP port ${client?.connectedPort}: ${clock}, official runs left ${a.attemptsLeft}.`);
        if (isRuleChangeId(a.ruleChange)) io.out(`The change: ${RULE_CHANGES[a.ruleChange].rule} ${RULE_CHANGES[a.ruleChange].meaning}`);
      },
      ...(probe !== undefined ? { probeTicks: probe } : {}),
    };
    client = file.transport ? new file.transport(opts) : new Transport(opts);
    applyHooks(client, file.hooks);
    process.once("SIGINT", onSigint);
    const results = await client.run();
    process.off("SIGINT", onSigint);
    if (doctor) {
      const conn = (last as MatchSummary | null)?.conn;
      if (conn) {
        io.out("");
        io.out("Findings:");
        for (const line of findings(conn)) io.out(`  ${line}`);
      }
      return 0;
    }
    for (const m of results) io.out(`Match ${m.match} against Maria (${TITLE[m.tier]}): ${resultWords(m)}. States received ${m.states}, moves sent ${m.moves}.`);
    const won = (t: (typeof TIERS)[number]) => results.filter((m) => m.tier === t && m.result === "win").length;
    if (official) io.out(`Official run done. Novice ${won("novice")} of 3 won, Adept ${won("adept")} of 3, Master ${won("master")} of 3. Score ${won("novice") + 3 * won("adept") + 9 * won("master")} out of 39.`);
    else if (results.length > 1) {
      const w = results.filter((m) => m.result === "win").length;
      const d = results.filter((m) => m.result === "draw").length;
      io.out(`${results.length} matches: ${w} won, ${d} drawn, ${results.length - w - d} lost.`);
    }
    return 0;
  } catch (err) {
    process.off("SIGINT", onSigint);
    if (err instanceof UsageError || err instanceof ConfigError || err instanceof ClientError || err instanceof InitError) {
      io.err(err.message);
      return err instanceof ClientError || err instanceof InitError ? 1 : 2;
    }
    throw err;
  }
}
