import { AssetImg, Card } from "../ui/kit.js";
import { EnvBlock, GetTheCode, useSetup } from "../ui/setup.js";

const EXAMPLES: { cmd: string; prints: string }[] = [
  {
    cmd: "npx @black-maria/sim play --vs master --seed 7",
    prints: `You (the starter bot) against Maria (Master), seed 7.
Result: you lost 78 to 131.
The profiler. ...
  Errands Maria took first   25, value 104
  Idle ticks                 52 of 400
  Snatches                   for you 0 (value 0), against you 0 (value 0)`,
  },
  {
    cmd: "npx @black-maria/sim play --vs novice --n 5 --change 2 --bot ./bot.js",
    prints: `Parameters: ... snatch_cost 50, regen 2 ...
seed 1115408942: you won 117 to 95
...
5 matches: 1 won, 0 drawn, 4 lost (20.0% won).`,
  },
  {
    cmd: "npx @black-maria/sim wire --check",
    prints: `Local wire server listening on UDP 127.0.0.1:7777. Any 16-byte token works. Ctrl-C stops it.
Every match uses the Master network profile.
Checking clients against the checklist in docs/WIRE.md. ...
(when a match ends: the ten checks, each pass or FAIL)`,
  },
];

/**
 * The simulator page (SPEC 8.5): install command, three example commands with what they print, a link to the source,
 * and the two lines that point the client at this server instead of a local simulator.
 */
export function SimPage() {
  const setup = useSetup();
  return (
    <div className="sim-page">
      <Card
        title={
          <>
            <AssetImg name="icon_step_build" className="card-title-icon" />
            Run Maria on your machine
          </>
        }
        flat
      >
        <p>The simulator runs the whole game on your machine: all three Marias, the lossy network, the profiler. Same code as the server, no waiting on ticks.</p>
        <GetTheCode setup={setup} />
        {EXAMPLES.map((e) => (
          <div key={e.cmd} className="example">
            <pre className="cmd mono">{e.cmd}</pre>
            <span className="prints-label mono">prints</span>
            <pre className="prints mono small">{e.prints}</pre>
          </div>
        ))}
        <p className="small">
          Every parameter is a flag (<code>--post-interval</code>, <code>--expiry</code>, <code>--snatch-cost</code>, <code>--regen</code>, <code>--chaos</code> and the rest). <code>--change 1</code>, <code>2</code> or <code>3</code> plays one of the possible changes. The source is in{" "}
          <code>packages/sim</code>, and Maria is in <code>packages/house-bots</code>.
        </p>
        <p className="small">
          <code>npx @black-maria/sim wire --log</code> prints every chaos action as it happens: tick, seq, what happened to the packet.
        </p>
        <p className="small">
          <code>npx blackmaria doctor</code> plays a 60-tick probe on the Master network profile and prints the numbers: on time, late, missing, round trip, packets lost.
        </p>
        <p>
          By default the client plays a local simulator. To play on this server, put these two lines in a <code>.env</code> file where you run it, and{" "}
          <code>npx blackmaria play --vs novice</code> plays here:
        </p>
        <EnvBlock setup={setup} />
      </Card>
    </div>
  );
}
