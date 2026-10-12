/**
 * Vitest global setup: keep a macOS host awake while the suite runs.
 *
 * The wire tests run real matches against the real clock (a 250 ms deadline per tick). A Mac that goes into
 * maintenance sleep (lid closed, display off; `pmset -g log` shows DarkWake windows of about 45 s between sleeps of
 * about 45 s) freezes every process for tens of seconds, which the wire checklist reads as a client that stopped
 * sending PING and missed its deadlines. `caffeinate -s -i -w <pid>` holds a power assertion only for as long as this
 * process lives; it changes no setting. Elsewhere this does nothing.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";

let child: ChildProcess | null = null;

export function setup(): void {
  if (process.platform !== "darwin" || !existsSync("/usr/bin/caffeinate")) return;
  child = spawn("/usr/bin/caffeinate", ["-s", "-i", "-w", String(process.pid)], { stdio: "ignore" });
  child.on("error", () => {
    child = null;
  });
  child.unref();
}

export function teardown(): void {
  child?.kill();
  child = null;
}
