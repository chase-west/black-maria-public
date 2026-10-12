# @black-maria/sim: the simulator

The simulator runs the whole game on your machine: the engine, all three Marias (Novice, Adept, Master), the lossy network, a replay printer and the profiler. Same code as the server, no waiting on ticks.

```sh
npx @black-maria/sim play --vs master --seed 7
```

| command | what it does |
|---|---|
| `sim play --vs TIER` | plays matches against Maria on this machine, as fast as the bots decide, and prints the result and the profiler. `--seed N` fixes the map, `--n N` plays N seeds in a row, `--bot FILE` plays your bot instead of the starter, `--ticks` prints every tick, `--save FILE` keeps the match for `sim replay`, `--json` prints JSON |
| `sim wire` | a local wire server on UDP 127.0.0.1:7777. Any 16-byte token works, and you can play the official run as often as you like. `--port`, `--host`, `--seed`, `--save-dir DIR` |
| `sim wire --check` | the same server, grading your client against the ten-item checklist in `docs/WIRE.md`, on the Master network profile with non-default parameters. The report ends with the summary block for that client, as the server saw it |
| `sim wire --log` | the same server, printing every chaos action as it happens: match, tick, seq, direction, packet, and what happened to it |
| `sim replay FILE` | prints a saved match: the result, the profiler, and with `--ticks` every tick |
| `sim map --seed N` | prints the house for a seed |

## Every parameter, and the three possible changes

Every number in the match start is a flag, on `play` and on `wire`:

| flag | default |
|---|---|
| `--max-tick N` | 400 |
| `--tick-ms N` | 250 |
| `--post-interval N` | 6 |
| `--expiry A:B` | 30:70 |
| `--snatch-cost N` | 100 |
| `--regen N` | 1 |
| `--energy-start N` | 40 |
| `--inventory-slots N` | 4 |
| `--return-ticks N` | 40 |
| `--chaos PROFILE` | off (`novice`, `adept`, `master`; on `wire` it applies to every match) |

Your official run plays with one rule changed. The Official page shows you which. You can try all three first:

| change | flags |
|---|---|
| 1 | `--post-interval 3 --expiry 20:45` |
| 2 | `--snatch-cost 50 --regen 2` |
| 3 | `--chaos master` |

`--change 1`, `--change 2` and `--change 3` do the same thing in one flag. If your bot reads its parameters from the match start, the change costs you nothing.

## Your bot

`--bot FILE` loads a JavaScript module whose default export (or export named `Bot`) is a class with `decide(state)` returning a move, and optionally `onStart(matchStart)` and `onEnd(matchEnd)`. The shapes are the JSON in `docs/RULES.md`.

## Running Maria yourself

```js
import { Master, createMatch, matchStartFor, stateFor } from "@black-maria/sim";

const s = createMatch(7);
const maria = new Master(matchStartFor(s, "maria", { match_id: "m", mode: "practice", tier: "master", tick_ms: 250 }));
console.log(maria.decide(stateFor(s, "maria", { match_id: "m", deadline_ms: 250 })));
```

Maria is deterministic: same observations, same move. Feed a copy of her the match from her side and it predicts her exactly.
