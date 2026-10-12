/**
 * Records every call the transport makes into its Meter during one practice match against the local simulator on the
 * Master network profile, and what came out: the trace records, the summary block and doctor's findings. The
 * TypeScript and Python meters are both tested against this file (test/meter.test.ts), so they must print the same.
 *
 *   npx tsx --conditions=source packages/client/test/fixtures/record-run.ts > packages/client/test/fixtures/master-run.json
 */
import { LocalHost, WireServer } from "@black-maria/sim";
import { summaryLines, type TickRecord } from "@blackmaria/protocol/wire";
import { Meter } from "../../src/meter.js";
import { StarterBot, Transport, findings, tokenBytes } from "../../src/index.js";

const SEED = 150; // its blackhole is at tick 105
const calls: unknown[][] = [];
const host = new LocalHost({ seed: SEED, rules: { params: {}, ruleChange: 0, chaosOverride: "master" } });
const server = new WireServer({ host, tickMs: 100, maxTick: 125, forceChaos: "master" });
const port = await server.listen(0, "127.0.0.1");
const t = new Transport({ host: "127.0.0.1", ports: [port], token: tokenBytes("5a".repeat(16)), official: false, tier: 0, chaos: 3, matches: 1, bot: () => new StarterBot() });
const meter = t.meter as unknown as Record<string, (...a: unknown[]) => unknown>;
for (const name of ["datagram", "ignoredDuplicate", "pong", "state", "moveSent", "resync", "blind", "end"]) {
  const orig = meter[name]!.bind(meter);
  meter[name] = (...args: unknown[]) => {
    calls.push([name, ...args]);
    return orig(...args);
  };
}
await t.run();
server.close();
// Replay into a fresh meter for the expected output.
const records: TickRecord[] = [];
const fresh = new Meter((r) => records.push(r)) as unknown as Record<string, (...a: unknown[]) => unknown>;
let summary: ReturnType<Meter["end"]> | null = null;
for (const [name, ...args] of calls) {
  const out = fresh[name as string]!(...args);
  if (name === "end") summary = out as ReturnType<Meter["end"]>;
}
process.stdout.write(JSON.stringify({ seed: SEED, calls, records, summary: summaryLines(summary!), findings: findings(summary!) }) + "\n");
