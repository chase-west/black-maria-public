/**
 * The simulator's command line: `sim play`, `sim wire`, `sim replay`, `sim map`. Everything it prints uses the plain
 * words of the rules (SPEC 8.5). `main` takes its output streams so tests can run it in-process.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";
import type { ChaosName, Intent, MatchEndMsg, MatchStartMsg, ProfilerReport, StateMsg, Tier } from "@blackmaria/protocol";
import { createMatch, makeParams, resultFor, scores, eventsFor, type MatchState, type Params } from "@blackmaria/engine";
import { PARAM_HELP, UsageError, int, paramFlags, parseFlags, str, tierFlag, type Parsed } from "./args.js";
import { PT, summaryText } from "@blackmaria/protocol/wire";
import { CHECK_PARAMS, WireCheck, checkText, isProbeTick } from "./check.js";
import type { ReplayLog } from "./live.js";
import { LocalHost } from "./local-host.js";
import { playLocal, type LocalBot } from "./local.js";
import { profileReplay, replayStates } from "./profiler.js";
import { StarterBot } from "./starter.js";
import { WireServer, type ChaosEvent, type WireMatchInfo, type WireRules } from "./wire-server.js";
import { TIER_TITLE, eventWords, moveWords, paramsLine, profilerText, resultLine } from "./words.js";

export interface Io {
  out(line: string): void;
  err(line: string): void;
}
const stdio: Io = { out: (l) => process.stdout.write(l + "\n"), err: (l) => process.stderr.write(l + "\n") };

export const VERSION = "0.7.1";

const HELP = `BLACK MARIA simulator ${VERSION}

  sim play --vs TIER [--seed N] [--n N] [--bot FILE] [--ticks] [--save FILE] [--json]
      Play matches on this machine against Maria (novice, adept or master), as fast as the bots decide,
      and print the result and the profiler. Your side is the starter bot unless you give --bot.
  sim wire [--port 7777] [--host 127.0.0.1] [--seed N] [--save-dir DIR] [--check] [--log]
      Run a local wire server with the network profiles. Point your client at it; any 16-byte token works,
      and you can play the official run as often as you like. --check grades your client against the
      ten-item checklist in docs/WIRE.md. --log prints every chaos action as it happens.
  sim replay FILE [--ticks] [--json]
      Print a saved match: the result, the profiler, and with --ticks every tick.
  sim map [--seed N]
      Print the house for a seed.

${PARAM_HELP}

--bot FILE is a JavaScript module whose default export (or export named Bot) is a class with
decide(state) returning a move, and optionally onStart(matchStart) and onEnd(matchEnd).
The rules are in docs/RULES.md, the wire in docs/WIRE.md.`;

const BARE = new Set(["ticks", "json", "check", "help", "quiet", "log"]);

type BotFactory = () => LocalBot;

/** Load a bot module from the candidate's own machine (`--bot`). */
export async function loadBot(file: string): Promise<BotFactory> {
  const url = pathToFileURL(resolve(file)).href;
  let mod: Record<string, unknown>;
  try {
    mod = (await import(url)) as Record<string, unknown>;
  } catch (err) {
    throw new UsageError(`Couldn't load ${file}: ${err instanceof Error ? err.message : String(err)}`);
  }
  const x = mod.default ?? mod.Bot ?? mod.createBot;
  if (typeof x === "function") {
    const f = x as { prototype?: { decide?: unknown } } & ((...a: unknown[]) => unknown);
    if (f.prototype && typeof f.prototype.decide === "function") return () => new (x as new () => LocalBot)();
    return () => {
      const b = (x as () => unknown)();
      if (!b || typeof (b as LocalBot).decide !== "function") throw new UsageError(`${file}: the factory didn't return an object with decide(state).`);
      return b as LocalBot;
    };
  }
  if (x && typeof (x as LocalBot).decide === "function") {
    const obj = x as LocalBot;
    return () => obj;
  }
  throw new UsageError(`${file} has no default export, Bot class, or createBot function with decide(state).`);
}

function chaosOf(c: ChaosName | undefined): ChaosName {
  return c ?? "off";
}

async function play(p: Parsed, io: Io): Promise<number> {
  const tier = tierFlag(p, "vs", undefined);
  const { params, chaos, tickMs } = paramFlags(p);
  const seed0 = int(p, "seed", 0, 0xffffffff) ?? Math.floor(Math.random() * 0xffffffff);
  const n = int(p, "n", 1, 10_000) ?? 1;
  const botFile = str(p, "bot");
  const factory: BotFactory = botFile ? await loadBot(botFile) : () => new StarterBot();
  const json = p.flags.has("json");
  const save = str(p, "save");
  const full = makeParams(params);
  if (!json) {
    io.out(`You (${botFile ? botFile : "the starter bot"}) against Maria (${TIER_TITLE[tier]}), ${n === 1 ? `seed ${seed0}` : `${n} matches from seed ${seed0}`}.`);
    io.out(`Parameters: ${paramsLine(full, chaosOf(chaos))}.`);
    if (chaos && chaos !== "off") io.out(`Network profiles only apply over the wire, and this runner has no network. To test one, run "sim wire --chaos ${chaos}" and point your client at it.`);
  }
  const results: { seed: number; result: string; you: number; maria: number }[] = [];
  const reports: ProfilerReport[] = [];
  for (let k = 0; k < n; k++) {
    const seed = (seed0 + k) >>> 0;
    const bot = factory();
    const showTicks = p.flags.has("ticks") && !json;
    let prev: MatchState | null = null;
    const r = playLocal(bot, {
      seed,
      tier,
      params,
      chaos: chaosOf(chaos),
      ...(tickMs !== undefined ? { tickMs } : {}),
      ...(showTicks
        ? {
            onTick: (s: MatchState) => {
              const t = s.tick - 1;
              const rec = s.last;
              const lines = eventsFor(s, "you").map((e) => eventWords(e, s));
              if (rec) io.out(`tick ${t}: you ${moveWords(rec.submitted.you, prev ?? s)}, Maria ${moveWords(rec.submitted.maria, prev ?? s)}${lines.length ? `; ${lines.join("; ")}` : ""}`);
              prev = s;
            },
          }
        : {}),
    });
    const sc = scores(r.final);
    results.push({ seed, result: resultFor(r.final), you: sc.you, maria: sc.maria });
    const report = profileReplay(r.log);
    reports.push(report);
    if (save) {
      const file = n === 1 ? save : save.replace(/(\.json)?$/, `-${seed}.json`);
      writeFileSync(file, JSON.stringify(r.log));
      if (!json) io.out(`Saved the match to ${file}. Print it with: sim replay ${file}`);
    }
    if (!json) {
      if (n === 1) {
        io.out("");
        io.out(`Result: ${resultLine(resultFor(r.final), sc.you, sc.maria)}.`);
        io.out("");
        io.out(profilerText(report));
      } else io.out(`seed ${seed}: ${resultLine(resultFor(r.final), sc.you, sc.maria)}`);
    }
  }
  if (json) {
    io.out(JSON.stringify({ tier, params: full, matches: results.map((x, i) => ({ ...x, profiler: reports[i] })) }));
    return 0;
  }
  if (n > 1) {
    const w = results.filter((x) => x.result === "win").length;
    const d = results.filter((x) => x.result === "draw").length;
    const avg = (f: (x: (typeof results)[number]) => number) => (results.reduce((a, x) => a + f(x), 0) / n).toFixed(2);
    io.out("");
    io.out(`${n} matches: ${w} won, ${d} drawn, ${n - w - d} lost (${((100 * w) / n).toFixed(1)}% won). Average score: you ${avg((x) => x.you)}, Maria ${avg((x) => x.maria)}.`);
  }
  return 0;
}

function readLog(file: string): ReplayLog {
  let raw: Buffer;
  try {
    raw = readFileSync(file);
  } catch {
    throw new UsageError(`No file at ${file}.`);
  }
  const text = raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw).toString("utf8") : raw.toString("utf8");
  let log: ReplayLog;
  try {
    log = JSON.parse(text) as ReplayLog;
  } catch {
    throw new UsageError(`${file} isn't a saved match (not JSON).`);
  }
  if (!log || typeof log.seed !== "number" || !Array.isArray(log.ticks)) throw new UsageError(`${file} isn't a saved match.`);
  return log;
}

function replay(p: Parsed, io: Io): number {
  const file = p.positionals[1];
  if (!file) throw new UsageError("Give the file to print: sim replay FILE.");
  const log = readLog(file);
  let states: MatchState[];
  try {
    states = replayStates(log, true);
  } catch (err) {
    throw new UsageError(err instanceof Error ? err.message : String(err));
  }
  const report = profileReplay(log, states);
  if (p.flags.has("json")) {
    io.out(JSON.stringify({ match_id: log.match_id, seed: log.seed, tier: log.tier, params: log.params, profiler: report }));
    return 0;
  }
  const final = states[states.length - 1]!;
  io.out(`Match ${log.match_id}: ${log.mode} against Maria (${TIER_TITLE[log.tier]}), seed ${log.seed}, over ${log.transport === "wire" ? "the wire" : log.transport === "ws" ? "the WebSocket" : "the simulator"}.`);
  io.out(`Parameters: ${paramsLine(log.params, log.chaos_profile ?? "off")}.`);
  if (log.chaos.length) {
    const c = (a: string) => log.chaos.filter((x) => x.action === a).length;
    io.out(`The network: ${log.chaos.length} datagrams logged; ${c("drop")} lost, ${c("reorder")} reordered, ${c("duplicate")} duplicated, ${c("blackhole")} in the blackhole.`);
  }
  if (p.flags.has("ticks")) {
    for (let t = 1; t < states.length; t++) {
      const s = states[t]!;
      const rec = log.ticks[t - 1]!;
      const lines = eventsFor(s, "you").map((e) => eventWords(e, s));
      const st = log.intent_status[t - 1];
      const net = st === "l" ? " (your move was late)" : st === "m" ? " (your move was missing)" : st === "x" ? " (your move was malformed)" : "";
      io.out(`tick ${t - 1}: you ${moveWords(rec.you, states[t - 1]!)}${net}, Maria ${moveWords(rec.maria, states[t - 1]!)}${lines.length ? `; ${lines.join("; ")}` : ""}`);
    }
  }
  const sc = scores(final);
  io.out("");
  io.out(`Result: ${resultLine(resultFor(final), sc.you, sc.maria)}.`);
  io.out("");
  io.out(profilerText(report));
  return 0;
}

function map(p: Parsed, io: Io): number {
  const seed = int(p, "seed", 0, 0xffffffff) ?? 1;
  const s = createMatch(seed);
  const ch: Record<string, string> = { wall: "#", floor: ".", door: "+", door_locked: "L", sigil: "$" };
  for (let y = 0; y < s.map.h; y++) {
    let line = "";
    for (let x = 0; x < s.map.w; x++) {
      let c = ch[s.map.tiles[y]![x]!]!;
      if (s.fixtures.some((f) => f.pos.x === x && f.pos.y === y)) c = "F";
      if (s.items.some((i) => i.loc.at === "tile" && i.loc.pos.x === x && i.loc.pos.y === y)) c = "i";
      if (s.map.mariaStart.x === x && s.map.mariaStart.y === y) c = "M";
      if (s.map.start.x === x && s.map.start.y === y) c = "@";
      line += c;
    }
    io.out(line);
  }
  io.out("");
  io.out("@ you   M Maria   # wall   + door   L the locked vault door   $ sigil   F fixture   i item");
  io.out(`Rooms: ${s.map.roomList.join(", ")}.`);
  io.out(`Fixtures: ${s.fixtures.map((f) => `${f.id} ${f.kind} (${f.room}, ${f.pos.x},${f.pos.y})`).join("; ")}.`);
  io.out(`Items: ${s.items.map((i) => `${i.id} ${i.kind}${i.loc.at === "safe" ? " (in the safe)" : i.loc.at === "tile" ? ` (${i.loc.pos.x},${i.loc.pos.y})` : ""}`).join("; ")}.`);
  return 0;
}

/** Runs until the process is stopped; resolves with the server for tests. */
export async function wire(p: Parsed, io: Io, opts: { onReady?: (server: WireServer, port: number, check: WireCheck | null) => void } = {}): Promise<WireServer> {
  const check = p.flags.has("check");
  const { params: given, change, tickMs, chaos } = paramFlags(p);
  // The checklist runs with parameters that are not the defaults; flags you give still win.
  const params: Partial<Params> = check ? { ...CHECK_PARAMS, ...given } : given;
  const profile: Tier | null = chaos && chaos !== "off" ? chaos : check ? "master" : null;
  const port = int(p, "port", 0, 65535) ?? 7777;
  const host = str(p, "host") ?? "127.0.0.1";
  const seed = int(p, "seed", 0, 0xffffffff);
  const saveDir = str(p, "save-dir");
  if (saveDir) mkdirSync(saveDir, { recursive: true });
  const rules: WireRules = { params, ruleChange: change, chaosOverride: profile };
  const checker = check ? new WireCheck() : null;
  const reported = new Set<string>();
  const report = (key: string) => {
    if (!checker) return;
    io.out(checkText(checker.report(key)));
    const conn = checker.summary(key);
    if (conn) io.out(summaryText(conn));
  };
  const local = new LocalHost({
    rules,
    ...(seed !== undefined ? { seed } : {}),
    log: (m, e) => io.err(`${m}${e ? `: ${e instanceof Error ? e.message : String(e)}` : ""}`),
    onEnd: (info: WireMatchInfo, state: MatchState, log: ReplayLog) => {
      const sc = scores(state);
      const onTime = [...log.intent_status].filter((c) => c === "o").length;
      const resyncs = Object.values(log.resyncs).reduce((a, b) => a + b, 0);
      io.out(
        `Match ${info.wireId} (${info.mode}${info.run ? ` ${info.run.index + 1} of 9` : ""}, ${TIER_TITLE[info.tier]}, network ${log.chaos_profile ?? "off"}) ended: ${resultLine(resultFor(state), sc.you, sc.maria)}. Moves on time ${((100 * onTime) / Math.max(1, log.ticks.length)).toFixed(1)}%, resyncs ${resyncs}.`,
      );
      if (saveDir) {
        const file = resolve(saveDir, `${info.id}.json`);
        writeFileSync(file, JSON.stringify(log));
        io.out(`  Saved to ${file}.`);
      }
      if (checker) {
        checker.matchEnded(info, log);
        const key = checker.sessionOf(info.wireId);
        if (key && info.mode === "practice") report(key);
      }
    },
    onRun: (runId, results) => {
      const w = (t: Tier) => results.filter((r) => r.tier === t && r.result === "win").length;
      io.out(`Official run ${runId} finished: Novice ${w("novice")} of 3 won, Adept ${w("adept")} of 3, Master ${w("master")} of 3. Score ${w("novice") + 3 * w("adept") + 9 * w("master")} out of 39.`);
      if (checker) {
        const first = results[0];
        const key = first ? checker.sessionKeys().find((k) => !reported.has(k)) : undefined;
        if (key) {
          reported.add(key);
          report(key);
        }
      }
    },
  });
  const server = new WireServer({
    host: local,
    tickMs: tickMs ?? 250,
    ...(params.maxTick !== undefined ? { maxTick: params.maxTick } : {}),
    forceChaos: profile,
    ...(checker ? { observer: checker, probe: isProbeTick } : {}),
    ...(p.flags.has("log") ? { onChaos: (e: ChaosEvent) => io.out(chaosLine(e)) } : {}),
  });
  let bound: number;
  try {
    bound = await server.listen(port, host);
  } catch (err) {
    server.close();
    throw new UsageError(`Couldn't listen on UDP ${host}:${port} (${err instanceof Error ? err.message : String(err)}). Pick another port with --port.`);
  }
  io.out(`Local wire server listening on UDP ${host}:${bound}. Any 16-byte token works. Ctrl-C stops it.`);
  io.out(`Parameters: ${paramsLine(makeParams(params), profile ?? "off")}; deadline ${tickMs ?? 250} ms.`);
  if (profile) io.out(`Every match uses the ${TIER_TITLE[profile]} network profile.`);
  if (checker) io.out("Checking clients against the checklist in docs/WIRE.md. The parameters aren't the defaults, on purpose. Play a match (or your official run) and the report prints when it ends.");
  if (p.flags.has("log")) io.out(profile ? "Logging every chaos action: match, tick, seq, direction, packet, what happened." : "Logging chaos actions, but this server has no network profile. Practice HELLOs that ask for one (--chaos in the client) get it.");
  opts.onReady?.(server, bound, checker);
  return server;
}

const PACKET_NAME = new Map<number, string>(Object.entries(PT).map(([k, v]) => [v, k]));

/** One `sim wire --log` line: what the chaos layer did to one datagram, as it happened. */
export function chaosLine(e: ChaosEvent): string {
  const head = `chaos  match ${String(e.match.wireId).padStart(3)}  tick ${e.tick < 0 ? "  -" : String(e.tick).padStart(3)}  `;
  if (e.type === 0) return `${head}seq     -  both ${"".padEnd(11)}  blackout: nothing gets through either way for ${e.delays[0] ?? 400} ms`;
  const what =
    e.action === "deliver"
      ? `delayed ${e.delays[0] ?? 0} ms`
      : e.action === "duplicate"
        ? `duplicated, delayed ${e.delays[0] ?? 0} and ${e.delays[1] ?? 0} ms`
        : e.action === "reorder"
          ? "held, goes out after the next one"
          : e.action === "drop"
            ? "dropped"
            : "lost in the blackout";
  return `${head}seq ${(e.seq === 0 ? "-" : String(e.seq)).padStart(5)}  ${e.dir.padEnd(4)} ${(PACKET_NAME.get(e.type) ?? `0x${e.type.toString(16)}`).padEnd(11)}  ${what}`;
}

/** `sim wire` with these arguments (after the word `wire`), for tests and embedding: resolves once it listens. */
export function startWire(argv: readonly string[], io: Io, onReady?: (server: WireServer, port: number, check: WireCheck | null) => void): Promise<WireServer> {
  return wire(parseFlags(["wire", ...argv], BARE), io, onReady ? { onReady } : {});
}

/** Run the CLI. Returns the exit code (for `wire`, resolves once the server is up and keeps running). */
export async function main(argv: readonly string[], io: Io = stdio): Promise<number> {
  try {
    const p = parseFlags(argv, BARE);
    const cmd = p.positionals[0];
    if (!cmd || cmd === "help" || p.flags.has("help")) {
      io.out(HELP);
      return 0;
    }
    if (cmd === "play") return await play(p, io);
    if (cmd === "replay") return replay(p, io);
    if (cmd === "map") return map(p, io);
    if (cmd === "wire") {
      await wire(p, io);
      return -1;
    }
    throw new UsageError(`No command "${cmd}". Run "sim help" for the list.`);
  } catch (err) {
    if (err instanceof UsageError) {
      io.err(err.message);
      return 2;
    }
    throw err;
  }
}

export type { Intent, MatchEndMsg, MatchStartMsg, StateMsg };
