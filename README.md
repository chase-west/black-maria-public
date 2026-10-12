# BLACK MARIA

Everything behind the assessment: the engine, all three Marias, the server as deployed, the portal, the simulator,
and the client we gave you. Anything the server does, you can read and run here.

Read the two docs first, then the client:

| read | what it is |
|---|---|
| `docs/RULES.md` | the game, complete: a worked example, every rule and number, Maria's policy, and "What strong bots do" |
| `docs/WIRE.md` | the UDP protocol the client speaks, byte by byte, with the ten-item checklist |
| `packages/client/README.md` | the client we gave you, what's wrong with it, and how to plug in your own bot |

## Run it

Node 20 or newer and pnpm (`corepack enable` gives you the pinned version).

```sh
pnpm install
pnpm build
pnpm sim play --vs novice --seed 7          # one match on this machine, with the profiler
pnpm sim play --vs adept --n 20 --change 2  # twenty matches with one of the three possible changes
pnpm sim wire --check                       # a local wire server that grades a client against the checklist
pnpm client play --vs novice                # the client, against that local wire server
```

`pnpm sim` and `pnpm client` are the same programs as `npx @black-maria/sim` and `npx blackmaria`. Run either with
`help` to see every flag.

By default the client plays a local simulator. To play the real server, put these two lines in a `.env` file where
you run it (the portal's Simulator page shows them with your values filled in):

```sh
BM_SERVER=https://the-portal-address
BM_TOKEN=the-32-characters-at-the-end-of-your-magic-link
```

`pnpm client` and `pnpm sim` read `.env` and `--bot ./my-bot.js` from the directory you run them in.

## Where things are

| path | what is in it |
|---|---|
| `packages/engine` | the rules: map generation, the board, one tick of the game. Deterministic from a seed |
| `packages/house-bots` | Maria: Novice, Adept and Master |
| `packages/protocol` | message types, the wire codec, keyframes and deltas, the profiler |
| `packages/sim` | the simulator: local matches, the local wire server with the network profiles, the checklist |
| `packages/client` | the client we gave you, in TypeScript (`src/`) and Python (`python/blackmaria.py`) |
| `apps/server` | the deployed server: HTTP, the WebSocket, the wire |
| `apps/web` | the portal |
