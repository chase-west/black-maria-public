import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PROFILER_LINES, PROFILER_LINE_INFO, STRONG_BOT_HEADINGS, headingAnchor, type Intent, type StateMsg } from "@blackmaria/protocol";
import { Novice } from "@blackmaria/house-bots";
import { StarterBot, playLocal, profileReplay, replayStates, type LocalBot } from "../src/index.js";

const rules = readFileSync(join(__dirname, "../../../docs/RULES.md"), "utf8");

const waiter: LocalBot = { decide: (): Intent => ({ kind: "WAIT" }) };

describe("the profiler (SPEC 8.3)", () => {
  it("every line links to a heading under What strong bots do in RULES.md", () => {
    const strong = rules.split("## 10. What strong bots do")[1]!.split("\n## ")[0]!;
    for (const h of STRONG_BOT_HEADINGS) expect(strong).toContain(`### ${h}\n`);
    const r = profileReplay(playLocal(new StarterBot(), { seed: 3, tier: "novice" }).log);
    for (const k of PROFILER_LINES) {
      expect(r.links[k].heading).toBe(PROFILER_LINE_INFO[k].heading);
      expect(r.links[k].anchor).toBe(headingAnchor(r.links[k].heading));
    }
    expect(headingAnchor("Simulating Maria to skip races you lose and win races you can")).toBe("simulating-maria-to-skip-races-you-lose-and-win-races-you-can");
    expect(headingAnchor("Nearest-first pathing")).toBe("nearest-first-pathing");
  });

  it("a bot that only waits: every tick idle, nothing attempted, all its energy unused", () => {
    const { log, final } = playLocal(waiter, { seed: 11, tier: "adept" });
    const r = profileReplay(log);
    expect(r.ticks).toBe(400);
    expect(r.idle.ticks).toBe(400);
    expect(r.completed).toEqual({ count: 0, value: 0 });
    expect(r.never_attempted.count).toBe(final.board.length);
    expect(r.never_attempted.value).toBe(final.board.reduce((a, e) => a + e.value, 0));
    expect(r.maria_first.count).toBe(0);
    expect(r.expired_heading.count).toBe(0);
    expect(r.energy_unused).toBe(100);
    expect(r.network).toEqual({ ticks: 0, late: 0, missing: 0, malformed: 0, resyncs: 0 });
    expect(r.scores.you).toBe(0);
  });

  it("over 60 matches: the lines account for every errand and agree with the scores and the events", () => {
    for (let seed = 1; seed <= 60; seed++) {
      const tier = (["novice", "adept", "master"] as const)[seed % 3]!;
      const { log, final } = playLocal(new StarterBot(), { seed, tier });
      const r = profileReplay(log);
      expect(r.completed.value).toBe(r.scores.you);
      expect(r.completed.count).toBe(final.board.filter((e) => e.state === "done_by_you").length);
      // Every errand is completed by you, never attempted, or attempted and then lost one way or another.
      const lost = final.board.filter((e) => e.state !== "done_by_you").length;
      expect(r.never_attempted.count + r.maria_first.count + r.expired_heading.count).toBeLessThanOrEqual(lost);
      for (const e of r.maria_first.errands) {
        expect(final.board[e.id]!.state).toBe("done_by_maria");
        if (e.ticks_behind !== null && e.ticks_behind !== undefined) expect(e.ticks_behind).toBeGreaterThanOrEqual(0);
      }
      for (const e of r.expired_heading.errands) expect(final.board[e.id]!.state).toBe("expired");
      const snatched = (by: "you" | "maria") => log.ticks.reduce((a, t) => a + t.events_you.filter((ev) => ev.kind === "snatched" && ev.by === by).length, 0);
      expect(r.snatches.for.count).toBe(snatched("you"));
      expect(r.snatches.against.count).toBe(snatched("maria"));
      expect(r.energy_unused).toBe(final.bodies.you.energy);
      expect(r.idle.ticks).toBeGreaterThanOrEqual(0);
      expect(r.idle.ticks).toBeLessThanOrEqual(400);
    }
  });

  it("Maria taking errands first is counted with how far behind you were", () => {
    // Novice as your side races Master for the same errands.
    let found = 0;
    for (let seed = 1; seed <= 20 && found === 0; seed++) {
      let bot: Novice | null = null;
      const side: LocalBot = {
        onStart: (s) => {
          bot = new Novice(s);
        },
        decide: (s: StateMsg) => bot!.decide(s),
      };
      const r = profileReplay(playLocal(side, { seed, tier: "master" }).log);
      found += r.maria_first.errands.filter((e) => typeof e.ticks_behind === "number").length;
      if (r.maria_first.count) expect(r.maria_first.value).toBe(r.maria_first.errands.reduce((a, e) => a + e.value, 0));
    }
    expect(found).toBeGreaterThan(0);
  });

  it("counts late, missing and malformed moves and resyncs from the log", () => {
    const { log } = playLocal(new StarterBot(), { seed: 4, tier: "novice", params: { maxTick: 10 } });
    log.intent_status = "oollmxoomo";
    log.resyncs = { 3: 1, 7: 2 };
    const r = profileReplay(log, replayStates(log));
    expect(r.network).toEqual({ ticks: 5, late: 2, missing: 2, malformed: 1, resyncs: 3 });
  });
});
