import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PROFILER_LINE_INFO } from "@blackmaria/protocol";
import { main, type Io } from "../src/index.js";

function capture(): Io & { lines: string[]; errs: string[] } {
  const lines: string[] = [];
  const errs: string[] = [];
  return { lines, errs, out: (l) => lines.push(...l.split("\n")), err: (l) => errs.push(l) };
}

const root = join(__dirname, "../../..");

describe("sim play (SPEC 6 item 3)", () => {
  it("play --vs master --seed 7 prints the parameters, the result and every profiler line with its heading", async () => {
    const io = capture();
    expect(await main(["play", "--vs", "master", "--seed", "7"], io)).toBe(0);
    const text = io.lines.join("\n");
    expect(text).toContain("against Maria (Master), seed 7");
    expect(text).toMatch(/Parameters: max_tick 400, post_interval 6, expiry 30 to 70, snatch_cost 100, regen 1/);
    expect(text).toMatch(/^Result: (you won|you lost|draw)/m);
    for (const info of Object.values(PROFILER_LINE_INFO)) {
      expect(text).toContain(info.title);
      expect(text).toContain(`see: ${info.heading}`);
    }
    // Deterministic: the same seed prints the same match.
    const again = capture();
    await main(["play", "--vs", "master", "--seed", "7"], again);
    expect(again.lines).toEqual(io.lines);
  });

  it("has a flag for every parameter and for each of the three changes (SPEC 2.2, 3.9)", async () => {
    const one = capture();
    await main(["play", "--vs", "novice", "--seed", "1", "--post-interval", "3", "--expiry", "20:45"], one);
    expect(one.lines.join("\n")).toContain("post_interval 3, expiry 20 to 45");
    const two = capture();
    await main(["play", "--vs", "novice", "--seed", "1", "--change", "2"], two);
    expect(two.lines.join("\n")).toContain("snatch_cost 50, regen 2");
    const three = capture();
    await main(["play", "--vs", "novice", "--seed", "1", "--chaos", "master"], three);
    expect(three.lines.join("\n")).toContain("chaos master");
    expect(three.lines.join("\n")).toContain('run "sim wire --chaos master"');
    const all = capture();
    await main(["play", "--vs", "adept", "--seed", "2", "--max-tick", "120", "--snatch-cost", "45", "--regen", "3", "--energy-start", "70", "--inventory-slots", "2", "--json"], all);
    const j = JSON.parse(all.lines.join("")) as { params: Record<string, number>; matches: { profiler: { ticks: number } }[] };
    expect(j.params).toMatchObject({ maxTick: 120, snatchCost: 45, regen: 3, energyStart: 70, inventorySlots: 2 });
    expect(j.matches[0]!.profiler.ticks).toBe(120);
  });

  it("refuses bad flags with one sentence and exit code 2", async () => {
    for (const argv of [["play", "--vs", "wizard"], ["play"], ["play", "--vs", "novice", "--expiry", "9"], ["play", "--vs", "novice", "--expiry", "90:30"], ["play", "--vs", "novice", "--regen", "x"], ["frobnicate"], ["replay", "/nonexistent/file.json"]]) {
      const io = capture();
      expect(await main(argv, io), argv.join(" ")).toBe(2);
      expect(io.errs).toHaveLength(1);
      expect(io.errs[0]).toMatch(/^[A-Z-].*[.]$/);
    }
  });

  it("--n plays several seeds and prints the totals", async () => {
    const io = capture();
    await main(["play", "--vs", "novice", "--seed", "10", "--n", "4", "--max-tick", "100"], io);
    expect(io.lines.filter((l) => /^seed \d+: /.test(l))).toHaveLength(4);
    expect(io.lines.join("\n")).toMatch(/4 matches: \d+ won, \d+ drawn, \d+ lost/);
  });

  it("--save and sim replay print the same match; --ticks prints every tick in plain words", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bm-sim-"));
    const file = join(dir, "m.json");
    const io = capture();
    await main(["play", "--vs", "adept", "--seed", "5", "--save", file], io);
    const result = io.lines.find((l) => l.startsWith("Result: "));
    const r = capture();
    expect(await main(["replay", file, "--ticks"], r)).toBe(0);
    expect(r.lines).toContain(result);
    expect(r.lines.filter((l) => /^tick \d+: you /.test(l))).toHaveLength(400);
    expect(r.lines.join("\n")).toMatch(/errand \d+ posted: /);
    expect(r.lines.join("\n")).not.toMatch(/\bintent\b|\bobjective/i);
    // A tampered replay is refused.
    const log = JSON.parse(readFileSync(file, "utf8")) as { ticks: { hash: string }[] };
    log.ticks[3]!.hash = "0".repeat(64);
    writeFileSync(file, JSON.stringify(log));
    const bad = capture();
    expect(await main(["replay", file], bad)).toBe(2);
    expect(bad.errs[0]).toContain("does not match the engine at tick 3");
  });

  it("--bot plays a bot module from your machine", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bm-bot-"));
    const file = join(dir, "bot.mjs");
    writeFileSync(file, "export default class Bot { decide() { return { kind: 'WAIT' }; } }\n");
    const io = capture();
    await main(["play", "--vs", "novice", "--seed", "3", "--bot", file, "--json"], io);
    const j = JSON.parse(io.lines.join("")) as { matches: { you: number; profiler: { idle: { ticks: number }; completed: { count: number } } }[] };
    expect(j.matches[0]!.you).toBe(0);
    expect(j.matches[0]!.profiler.idle.ticks).toBe(400);
    expect(j.matches[0]!.profiler.completed.count).toBe(0);
  });

  it("map prints the house", async () => {
    const io = capture();
    await main(["map", "--seed", "3"], io);
    expect(io.lines.some((l) => l.includes("@"))).toBe(true);
    expect(io.lines.join("\n")).toContain("Rooms: hall");
  });

  it("help names the commands and the flags for the three changes", async () => {
    const io = capture();
    await main(["help"], io);
    const text = io.lines.join("\n");
    for (const s of ["sim play", "sim wire", "sim replay", "--check", "--post-interval 3 --expiry 20:45", "--snatch-cost 50 --regen 2", "--chaos master"]) expect(text).toContain(s);
  });

  it("ships the client's starter bot, byte for byte", () => {
    expect(readFileSync(join(root, "packages/sim/src/starter.ts"), "utf8")).toBe(readFileSync(join(root, "packages/client/src/starter.ts"), "utf8"));
  });
});
