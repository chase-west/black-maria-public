// `pnpm dev`: the server (seeds the dev token) and the Vite dev server together.
import { spawn } from "node:child_process";

const procs = [
  spawn("pnpm", ["--filter", "@blackmaria/server", "run", "dev"], { stdio: "inherit", env: process.env }),
  spawn("pnpm", ["--filter", "@blackmaria/web", "run", "dev"], { stdio: "inherit", env: process.env }),
];
console.log("\n  BLACK MARIA dev: open http://localhost:5173/enter/deadbeefdeadbeefdeadbeefdeadbeef\n");
const stop = () => {
  for (const p of procs) p.kill("SIGTERM");
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
for (const p of procs) p.on("exit", (code) => code && stop());
