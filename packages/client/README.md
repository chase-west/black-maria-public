# blackmaria: the client

A working client for BLACK MARIA's wire, in TypeScript and Python, with a starter bot plugged in. It already plays the official run. Badly, on purpose.

```sh
npx blackmaria play --vs novice      # one practice match over the wire, on Novice's network
npx blackmaria init                  # writes my_bot.ts (or my_bot.py), the file you edit
npx blackmaria official              # your official run: 9 matches, 3 at a time
```

Both talk to the server set by `BM_SERVER` and `BM_TOKEN` (see "Where it connects"). Without them they talk to a local simulator on your machine. Good for practice, wrong for the official run.

Run it as-is and it'll beat Novice sometimes. The rest is up to you: fix the client, replace the bot, or replace both.

## Known weaknesses

All on purpose. Each one costs you points. None of them is hidden.

1. **It waits for `STATE` before thinking.** It sends the move for a tick only after that tick's `STATE` arrives. When the `STATE` is late or lost, you do `WAIT`. In [`predictState`](#the-transport) and [`planMoves`](#the-transport).
2. **It never resyncs.** It applies every delta to whatever state it last had, even when the delta names a base it never received. After a lost keyframe it drives blind until the next one. In [`shouldResync`](#the-transport).
3. **It does not skip repeats.** A duplicated or late `STATE` is decided again and its move sent again. In [`onPacket`](#the-transport).
4. **It hard-codes every parameter.** The deadline, the inventory size and the rest are constants, not read from the match start. Your official run plays with one of them changed. In `src/transport.ts` (`TICK_MS`) and the bot.
5. **Its bot goes for the nearest errand, ignores expiry, never snatches, and never steps out of reach when Maria winds up a snatch.**
6. **Its bot doesn't change its mind.** Once it picks a target it walks there without looking again. An errand posted right next to it, or a better one, waits until it arrives.
7. **Its bot doesn't notice when Maria picks an item up.** It remembers where it saw each item, walks to that spot anyway, and only forgets the item when it gets there and the floor is empty. Every item Maria takes first costs it a wasted trip.

Weaknesses 5 to 7 are in the bot (`src/starter.ts`). The profiler after each practice match shows what these cost you. "What strong bots do" in `docs/RULES.md` covers the bot, and `docs/WIRE.md` has every byte of the wire. To grade a client against the wire checklist, run `npx @black-maria/sim wire --check` and play a match against it.

## The transport

The client is two parts: the transport (`src/transport.ts`, `python/transport.py`) and your bot. The transport owns the socket, `HELLO`, fragments, keyframes and deltas, acks, `RESYNC`, `PING` and the timing of every tick. It calls five hooks, the same in TypeScript and Python:

| hook | called | the shipped one |
|---|---|---|
| `onPacket(packet)` | with every decoded packet from the server, before the transport handles it. `packet` is its fields plus `type` and `seq`. Returning `false` drops it | returns `true` (weakness 3) |
| `shouldResync(delta)` | with every delta `STATE`. `delta` is `{ match, tick, base, have_base }`. `true` applies it to the keyframe it names, or sends `RESYNC` and skips it when that keyframe isn't held. `false` applies it to the last state built | returns `false` (weakness 2) |
| `predictState(lastState, pendingMoves)` | when a tick's deadline is half gone and its `STATE` hasn't arrived, with the last state and the moves sent since. A state returned goes to `planMoves`; `null` sends nothing | returns `null` (weakness 1) |
| `planMoves(state)` | with each state. Returns a move for `state.tick`, or a list of moves sent for ticks `state.tick`, `state.tick + 1`, and so on | returns your bot's `decide(state)` (weakness 1) |
| `onTick(record)` | once per settled tick, with its trace record: `{ match, tick, state_ms, think_ms, sent_ms, status, margin_ms, resync, seq_gap }` | prints it with `--trace` |

Override them in a subclass of `Transport`, or put them in your `--bot` file:

```js
// bot.mjs: a bot, and one hook. `this` is the transport.
export default class Bot { decide(state) { return { kind: "WAIT" }; } }
export function onPacket(packet) { return true; }
```

A `--bot` file can export a bot (default export, or `Bot`), a `Transport` class (a subclass of this package's `Transport`), the hooks as named functions, or an object named `hooks`. In Python it's the same names: a class `Bot`, a class `Transport` (subclass of `blackmaria.Transport`), functions, or a dict `hooks`; Python hooks get the transport as their first argument.

## Measuring it

| command | what it prints |
|---|---|
| `blackmaria play ... --trace` | a line per tick: when the `STATE` arrived after the deadline started (or `missing`), how long the bot took, when the move left, on time, late or missing, whether a `RESYNC` went out, and the gap in the server's seq |
| every match, trace or not | the summary block: on time, moves late and missing, round trip p50 and p95 from `PING`/`PONG`, packets lost, duplicates and how many were skipped, resyncs, the longest silence of 400 ms or more and the ticks inside it, and the deadline margins in six buckets |
| `blackmaria doctor [--ticks 60]` | a 60-tick probe against Novice on the Master network profile, then the summary block and the numbers in it as sentences |

The deadline is the server's, and its clock isn't on the wire, so the client estimates when each tick's deadline started from the earliest-arriving recent `STATE`s. "On time" here is that estimate, less half the round trip. The portal's connection panel shows what the server actually saw.

## Where it connects

| flag | environment | meaning |
|---|---|---|
| `--server URL` | `BM_SERVER` | the portal address; the wire host and ports come from its `/api/me` |
| `--token T` | `BM_TOKEN` | the 32 characters at the end of your magic link |
| `--host H` | `BM_HOST` | the wire host, if you want to name it yourself |
| `--ports P` | `BM_PORTS` | UDP ports to try, in order (default `7777,443`) |

Flags beat the environment, and the environment beats a `.env` file in the directory you run it from. The portal's Simulator page shows the two `.env` lines, `BM_SERVER` and `BM_TOKEN`, with your server and token filled in. With none of them set, it plays a local simulator on 127.0.0.1. Start one with `npx @black-maria/sim wire`, which takes any token.

It tries UDP 7777 first. If no `HELLO_ACK` arrives within 2 seconds it tries UDP 443, since some networks block UDP on odd ports but allow 443.

## Commands

| command | what it does |
|---|---|
| `blackmaria init [--lang ts\|py]` | writes `my_bot.ts` (if there's a `package.json` here) or `my_bot.py` (if not) into this directory: the starter bot and the five hooks, as shipped. `--lang` picks. It won't overwrite a file that's already there |
| `blackmaria play --vs novice\|adept\|master` | practice over the wire, on that Maria's network profile, the same one the official run uses. `--chaos off` plays a clean link, `--chaos novice\|adept\|master` picks another profile. `--n N` plays N matches one after another |
| `blackmaria official` | the official run, one shot. Open from the start of your clock, and it has to start before minute 85 |
| `blackmaria doctor` | a 60-tick probe on the Master network profile, then the numbers (see "Measuring it") |
| `--trace` | a line per tick (see "Measuring it") |
| `--bot FILE` | your own bot instead of the starter: a JavaScript or TypeScript module whose default export (or export named `Bot`) is a class with `decide(state)` returning a move, and optionally `onStart(matchStart)` and `onEnd(end)`. It can also export transport hooks (see "The transport") |

`decide` gets the same state the WebSocket sends: `StateMsg` in `types/protocol/src/types.d.ts`, with every parameter in `onStart`'s `matchStart.params` (`MatchParams`). It returns one move: `{ kind: "WAIT" }`, `{ kind: "MOVE", dir: "N" }` (or `E`, `S`, `W`), `{ kind: "TAKE" }`, `{ kind: "DROP", item: "i7" }`, `{ kind: "USE", item: "i7" }` or `{ kind: "SNATCH" }`. `src/starter.ts` is a complete example.

The official run scores 1 per win against Novice, 3 against Adept and 9 against Master, out of 39. Practice never counts.

## Where to edit

- `my_bot.ts` or `my_bot.py`, in your directory. `blackmaria init` writes it: the bot and all five hooks, as shipped, in one file. Run it with `--bot my_bot.ts --trace`. Until you change it, it plays exactly like the client with no `--bot`.
- `src/starter.ts` (`python/starter.py`): the starter bot. `my_bot` imports it.
- `src/transport.ts` (`python/transport.py`): the transport and the shipped hooks.

`my_bot.ts` runs as it is on Node 22.18 or newer, which runs TypeScript without a build step.

## Python

`python/` is the same client in the same layers, standard library only, Python 3.9 or newer, with the same starter bot, the same hooks and the same weaknesses. Run `python/blackmaria.py`; the other files sit next to it.

```sh
python3 python/blackmaria.py init                              # writes my_bot.py
python3 python/blackmaria.py play --vs novice
python3 python/blackmaria.py official
python3 python/blackmaria.py play --vs adept --bot my_bot.py   # a file that defines class Bot, or hooks
python3 python/blackmaria.py doctor
```

## Where the code is

| file | what is in it |
|---|---|
| `src/transport.ts` | the transport: one socket, the `HELLO` handshake, fragments, keyframes and deltas, acks, `RESYNC`, `PING`, timing, and the five hooks |
| `src/meter.ts` | what `--trace`, the summary block and `doctor` measure |
| `src/starter.ts` | the starter bot |
| `src/client.ts` | `WireClient`, the old name of `Transport` |
| `src/cli.ts`, `src/doctor.ts`, `src/config.ts`, `src/init.ts` | the command line, `doctor`, where to connect, and `init` |
| `templates/my_bot.ts`, `templates/my_bot.py` | what `init` writes |
| `python/transport.py`, `python/meter.py`, `python/wire.py`, `python/starter.py`, `python/blackmaria.py` | all of the above, in Python |
