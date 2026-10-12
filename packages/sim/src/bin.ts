#!/usr/bin/env node
import { main } from "./cli.js";

// Run through `pnpm client` or `pnpm sim` from the repository root, pnpm starts this in the package's directory and
// sets INIT_CWD to where you typed the command. Work from there, so `--bot ./bot.js` and `.env` mean what you expect.
if (process.env.npm_lifecycle_event === "sim" && process.env.INIT_CWD && process.env.INIT_CWD !== process.cwd()) process.chdir(process.env.INIT_CWD);

const code = await main(process.argv.slice(2));
// `sim wire` keeps running until it is stopped.
if (code >= 0) process.exit(code);
