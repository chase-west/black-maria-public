import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnTick, ConnTotals, Errand, MatchEndMsg, MatchStartMsg, ProfilerReport, ServerMsg, StateMsg } from "@blackmaria/protocol";
import { connWindow, mergeConn, netClass, tickLabels, youClass } from "../src/practice/conn.js";
import { axis, camera, followScale, MIN_PX_PER_TILE, TOP_MARGIN } from "../src/game/camera.js";
import { practiceKey, queuedNote } from "../src/practice/keys.js";
import { matchSummary, PROFILE_WAIT_MS, resultLabel, Slot, SUMMARY_MS, type Settings, type Transport, type TransportHandlers } from "../src/practice/slot.js";

const T = 64;

describe("the arena camera (SPEC 8.1)", () => {
  /** The world's visible edges on screen: left, right, top, bottom. */
  const edges = (c: { x: number; y: number; s: number }, w: number, h: number) => ({ l: c.x, r: c.x + w * T * c.s, t: c.y - TOP_MARGIN * T * c.s, b: c.y + h * T * c.s });

  it("never leaves an empty band: the house covers each axis it overflows, and sits centered on one it fits", () => {
    for (const [sw, sh] of [[946, 664], [1800, 500], [390, 480], [600, 1200], [1, 1]] as const)
      for (const [w, h] of [[30, 22], [12, 8], [40, 10]] as const)
        for (const choice of ["follow", "house", null] as const)
          for (const you of [{ x: 0, y: 0 }, { x: (w * T) / 2, y: (h * T) / 2 }, { x: w * T, y: h * T }]) {
            const c = camera({ sw, sh, w, h, tile: T, you, choice });
            const e = edges(c, w, h);
            const W = e.r - e.l;
            const H = e.b - e.t;
            if (W > sw + 1e-6) expect(e.l <= 1e-6 && e.r >= sw - 1e-6, `x ${sw}x${sh} ${w}x${h} ${choice}`).toBe(true);
            else expect(Math.abs(e.l - (sw - e.r))).toBeLessThan(1e-6);
            if (H > sh + 1e-6) expect(e.t <= 1e-6 && e.b >= sh - 1e-6, `y ${sw}x${sh} ${w}x${h} ${choice}`).toBe(true);
            else expect(Math.abs(e.t - (sh - e.b))).toBeLessThan(1e-6);
          }
  });

  it("the old follow clamp left a bar under the house; the bottom edge now meets the frame", () => {
    const c = camera({ sw: 900, sh: 600, w: 30, h: 22, tile: T, you: { x: 15 * T, y: 22 * T }, choice: "follow" });
    expect(c.y + 22 * T * c.s).toBeCloseTo(600);
  });

  it("a house wider than tall is centered across, not pinned to the left with a bar on the right", () => {
    const c = camera({ sw: 1800, sh: 500, w: 20, h: 22, tile: T, you: { x: 0, y: 0 }, choice: "follow" });
    expect(c.mode).toBe("follow");
    expect(c.x).toBeCloseTo((1800 - 20 * T * c.s) / 2);
  });

  it("defaults to the whole house when it fits at 56 px a tile, and to following you when it doesn't", () => {
    expect(camera({ sw: 2400, sh: 1600, w: 30, h: 22, tile: T, you: { x: 0, y: 0 }, choice: null }).mode).toBe("house");
    expect(camera({ sw: 946, sh: 664, w: 30, h: 22, tile: T, you: { x: 0, y: 0 }, choice: null }).mode).toBe("follow");
  });

  it("the toggle always changes the picture in both directions, or isn't offered", () => {
    for (const [sw, sh] of [[946, 664], [2400, 1600], [3000, 2400], [390, 480]] as const) {
      const base = { sw, sh, w: 30, h: 22, tile: T, you: { x: 400, y: 300 } };
      const house = camera({ ...base, choice: "house" });
      const follow = camera({ ...base, choice: "follow" });
      expect(house.toggle).toBe(follow.toggle);
      if (house.toggle) {
        expect(house.mode).toBe("house");
        expect(follow.mode).toBe("follow");
        expect(house.s).not.toBeCloseTo(follow.s);
      } else expect(follow.mode).toBe("house");
    }
  });

  it("following stays close: never under 56 px a tile", () => {
    for (const sh of [200, 500, 900, 2000]) expect(followScale(sh, T) * T).toBeGreaterThanOrEqual(MIN_PX_PER_TILE);
    expect(axis(100, 0, 10, 1, null)).toBe(45);
  });
});

// ---------------------------------------------------------------------------

const start = (id: string): MatchStartMsg =>
  ({
    type: "match_start",
    match_id: id,
    mode: "practice",
    tier: "novice",
    params: { max_tick: 400, tick_ms: 250, post_interval: 6, expiry_min: 30, expiry_max: 70, snatch_cost: 100, regen: 1, energy_start: 40, inventory_slots: 4, return_ticks: 40, chaos: "off" },
    map: { w: 3, h: 1, tiles: [["floor", "floor", "floor"]], rooms: [["hall", "hall", "hall"]] },
    room_names: ["hall"],
    fixtures: [{ id: "f1", kind: "fireplace", pos: { x: 2, y: 0 } }],
    items: [],
    safe_items: [],
    decor: [],
    start: { x: 1, y: 0 },
    maria_start: { x: 0, y: 0 },
    sigil_owner: [],
    board: [],
    you: { energy: 40 },
  }) as unknown as MatchStartMsg;
const errand = (id: number, state: Errand["state"], value = 5): Errand => ({ id, type: "visit", room: "hall", value, posted: 0, expires: 60, state }) as Errand;
const state = (id: string, tick: number): StateMsg =>
  ({ type: "state", match_id: id, tick, deadline_ms: 250, you: { pos: { x: 1, y: 0 }, inventory: [], energy: 40 }, maria: { pos: { x: 0, y: 0 }, inventory: [] }, items: [], board: [], doors_opened: [], safes_opened: [], sigil_charge: [], scores: { you: 0, maria: 0 }, events: [] }) as StateMsg;
const end = (id: string, you: number, maria: number): MatchEndMsg =>
  ({ type: "match_end", match_id: id, result: you > maria ? "win" : you < maria ? "loss" : "draw", scores: { you, maria }, board: [errand(0, "done_by_you", you), errand(1, "done_by_maria", maria)], replay: `/replay/${id}`, tick: 400, events: [] }) as MatchEndMsg;
const report = (id: string) => ({ match_id: id }) as unknown as ProfilerReport;

/** A fake transport per match, recording what the slot asked of it. */
class Fakes {
  opened: { s: Settings; h: TransportHandlers; t: Transport & { calls: string[] } }[] = [];
  open = (s: Settings, h: TransportHandlers) => {
    const calls: string[] = [];
    const t = { calls, stop: () => calls.push("stop"), kill: () => calls.push("kill"), leave: (id: string) => calls.push(`leave ${id}`), submit: () => calls.push("submit") };
    this.opened.push({ s, h, t });
    return t;
  };
  get last() {
    return this.opened.at(-1)!;
  }
  send(m: ServerMsg) {
    this.last.h.server(m);
  }
}

const settings = (over: Partial<Settings> = {}): Settings => ({ mode: "starter", tier: "novice", speed: 4, runs: 1, code: "", ...over });

describe("a practice slot, start to profiler (SPEC 8.3, 8.4)", () => {
  let f: Fakes;
  let slot: Slot;
  let settled: number;
  let profileFetch: ReturnType<typeof vi.fn<(id: string) => Promise<ProfilerReport | null>>>;
  beforeEach(() => {
    vi.useFakeTimers();
    f = new Fakes();
    settled = 0;
    profileFetch = vi.fn<(id: string) => Promise<ProfilerReport | null>>(() => Promise.resolve(null));
    slot = new Slot({ open: f.open, fetchProfile: profileFetch, onSettled: () => settled++ });
  });
  afterEach(() => vi.useRealTimers());

  it("plays a match, shows its summary, then the profiler", () => {
    slot.start(settings());
    expect(slot.state.phase).toBe("connecting");
    f.send(start("m1"));
    f.send(state("m1", 1));
    expect(slot.state.phase).toBe("live");
    expect(slot.state.view!.tick).toBe(1);
    f.send(end("m1", 41, 52));
    f.send({ type: "profile", match_id: "m1", report: report("m1") });
    // The result and its one line hold the screen first.
    expect(slot.state.phase).toBe("ending");
    expect(slot.state.summary).toBe("you +41 · Maria +52 · 1 errand each");
    vi.advanceTimersByTime(SUMMARY_MS);
    expect(slot.state.phase).toBe("ended");
    expect(slot.state.report!.match_id).toBe("m1");
    expect(settled).toBe(1);
  });

  it("asks for the profiler if it doesn't arrive, and settles without it if there is none", async () => {
    slot.start(settings());
    f.send(start("m1"));
    f.send(end("m1", 3, 1));
    vi.advanceTimersByTime(PROFILE_WAIT_MS);
    expect(profileFetch).toHaveBeenCalledWith("m1");
    await vi.runAllTimersAsync();
    expect(slot.state.phase).toBe("ended");
    expect(slot.state.report).toBeNull();
  });

  it("Stop leaves the match, clears the arena, and offers Start again and the replay once it has ended", () => {
    slot.start(settings());
    f.send(start("m1"));
    f.send(state("m1", 120));
    const first = f.last;
    slot.stop();
    expect(first.t.calls).toEqual(["stop"]);
    expect(slot.state).toMatchObject({ phase: "stopped", view: null, stoppedAt: 120, matchId: "m1", replayReady: false });
    // The server finishes the match without you; the stopped transport still says so.
    first.h.server(state("m1", 300));
    expect(slot.state.view).toBeNull();
    first.h.server(end("m1", 0, 80));
    expect(slot.state.replayReady).toBe(true);
    // Start again with a fresh transport; the old one is ignored from here.
    slot.start(settings());
    expect(f.opened).toHaveLength(2);
    first.h.server(start("ghost"));
    first.h.closed();
    expect(slot.state.phase).toBe("connecting");
    f.send(start("m2"));
    expect(slot.state.phase).toBe("live");
    expect(slot.state.matchId).toBe("m2");
  });

  it("Stop before the match starts needs no replay", () => {
    slot.start(settings());
    slot.stop();
    expect(slot.state).toMatchObject({ phase: "stopped", matchId: null, stoppedAt: null });
    slot.stop();
    expect(f.last.t.calls).toEqual(["stop"]);
  });

  it("plays several in a row with a fresh transport each, then shows the last one's profiler", () => {
    slot.start(settings({ runs: 3 }));
    for (const [i, id] of ["a", "b", "c"].entries()) {
      expect(f.opened).toHaveLength(i + 1);
      f.send(start(id));
      f.send(end(id, 10 + i, 5));
      vi.advanceTimersByTime(SUMMARY_MS);
    }
    expect(slot.state.phase).toBe("ending");
    f.send({ type: "profile", match_id: "c", report: report("c") });
    expect(slot.state.phase).toBe("ended");
    expect(slot.state.results.map(resultLabel)).toEqual(["won 10–5", "won 11–5", "won 12–5"]);
    expect(f.opened[0]!.t.calls).toContain("kill");
  });

  it("a stop between matches in a row keeps what was played", () => {
    slot.start(settings({ runs: 5 }));
    f.send(start("a"));
    f.send(end("a", 1, 2));
    vi.advanceTimersByTime(SUMMARY_MS);
    expect(slot.state.phase).toBe("between");
    slot.stop();
    expect(slot.state).toMatchObject({ phase: "stopped", replayReady: true, matchId: "a" });
    expect(slot.state.results).toHaveLength(1);
  });

  it("only the starter bot and your code play in a row", () => {
    slot.start(settings({ mode: "hand", runs: 5 }));
    expect(slot.state.settings!.runs).toBe(1);
  });

  it("an error before the match starts is a sentence with a next step, and Start works again", () => {
    slot.start(settings());
    f.send({ type: "error", code: "too_many_concurrent", message: "x" } as ServerMsg);
    expect(slot.state.phase).toBe("failed");
    expect(slot.state.error).toMatch(/Stop one, then start again\.$/);
    slot.start(settings());
    expect(slot.state.phase).toBe("connecting");
  });

  it("a dropped connection mid-match says so", () => {
    slot.start(settings());
    f.send(start("m1"));
    f.last.h.closed();
    expect(slot.state.phase).toBe("failed");
  });

  it("leaves a match the server hands back that it didn't ask for", () => {
    slot.start(settings());
    f.send(start("m1"));
    f.send(start("orphan"));
    expect(f.last.t.calls).toEqual(["leave orphan"]);
    expect(slot.state.matchId).toBe("m1");
  });

  it("watching the wire picks up your client's next match after one ends", () => {
    slot.start(settings({ mode: "wire" }));
    f.send(start("w1"));
    f.send(end("w1", 1, 0));
    vi.advanceTimersByTime(SUMMARY_MS);
    f.send({ type: "profile", match_id: "w1", report: report("w1") });
    expect(slot.state.phase).toBe("ended");
    f.send(start("w2"));
    expect(slot.state).toMatchObject({ phase: "live", matchId: "w2", report: null });
  });

  it("the connection panel: wire_status ticks merge into the view by tick, the newest copy wins, the last 100 stay", () => {
    slot.start(settings({ mode: "wire" }));
    f.send(start("w1"));
    const tick = (n: number, you = "o", late: number | null = null): ConnTick => ({ tick: n, state: { fate: n % 7 === 3 ? "dropped" : "delayed", delay: n % 7 === 3 ? 0 : 20 }, move: { fate: "delayed", delay: 9 }, blackout: false, you, late_ms: late, resyncs: 0 });
    const totals: ConnTotals = { ticks: 0, packets: 0, dropped: 0, duplicated: 0, reordered: 0, blackout: 0, delay_avg: 0, delay_max: 0, on_time: 0, late: 0, missing: 0, resyncs: 0 };
    f.send({ type: "wire_status", match_id: "w1", strip: "o".repeat(100), resyncs: {}, conn: Array.from({ length: 100 }, (_, i) => tick(i)), conn_totals: { ...totals, ticks: 100 } });
    f.send({ type: "wire_status", match_id: "w1", strip: "o".repeat(103), resyncs: {}, conn: [tick(99, "m", 41), tick(100), tick(101), tick(102)], conn_totals: { ...totals, ticks: 103 } });
    f.send({ type: "wire_status", match_id: "other", strip: "", resyncs: {}, conn: [tick(500)] });
    const v = slot.state.view!;
    expect(v.conn!.map((t) => t.tick)).toEqual(Array.from({ length: 100 }, (_, i) => i + 3));
    expect(v.conn!.find((t) => t.tick === 99)).toMatchObject({ you: "m", late_ms: 41 });
    expect(v.connTotals!.ticks).toBe(103);
    expect(mergeConn(undefined, [tick(5), tick(2)]).map((t) => t.tick)).toEqual([2, 5]);
    expect(connWindow(v.conn!, 50, 10).map((t) => t.tick)).toEqual([40, 41, 42, 43, 44, 45, 46, 47, 48, 49]);
  });

  it("the panel's words are labels: what the network did, and what became of the move", () => {
    const t: ConnTick = { tick: 143, state: { fate: "dropped", delay: 0 }, move: null, blackout: false, you: "m", late_ms: null, resyncs: 0 };
    expect(tickLabels(t)).toEqual({ network: "STATE dropped · move none", you: "missing" });
    expect(netClass(t)).toBe("n-dropped");
    expect(youClass(t)).toBe("m-m");
    const late: ConnTick = { tick: 7, state: { fate: "delayed", delay: 34 }, move: { fate: "duplicated", delay: 12 }, blackout: false, you: "m", late_ms: 18, resyncs: 1 };
    expect(tickLabels(late)).toEqual({ network: "STATE delayed 34 ms · move duplicated, 12 ms", you: "late by 18 ms · resync 1" });
    expect(youClass(late)).toBe("m-l");
    expect(netClass({ ...late, blackout: true })).toBe("n-blackout");
    expect(tickLabels({ ...t, state: { fate: "blackout", delay: 0 }, blackout: true }).network).toBe("STATE lost in the blackout · move none");
    expect(tickLabels({ ...late, blackout: true }).network).toBe("STATE delayed 34 ms · move duplicated, 12 ms · in the blackout");
  });
});

describe("practice copy and keys", () => {
  it("summarizes a match in one line", () => {
    expect(matchSummary({ scores: { you: 4, maria: 9 }, board: [errand(0, "done_by_you"), errand(1, "done_by_maria"), errand(2, "done_by_maria"), errand(3, "expired")] })).toBe("you +4 · Maria +9 · 1 errand to 2");
  });

  it("says what waits for the next match", () => {
    const running = settings({ tier: "novice", speed: 1, runs: 1 });
    expect(queuedNote(running, { mode: "starter", tier: "adept", speed: 2, runs: 1 })).toBe("adept · 2x from the next match");
    expect(queuedNote(running, { mode: "starter", tier: "novice", speed: 1, runs: 1 })).toBeNull();
    expect(queuedNote(running, { mode: "hand", tier: "adept", speed: 1, runs: 1 })).toBeNull();
  });

  it("Enter starts, Escape stops, 1 2 4 set the speed, never while typing", () => {
    const ctx = { typing: false, modifier: false, picker: false, phase: "idle" as const, anyBusy: false };
    expect(practiceKey("Enter", ctx)).toEqual({ kind: "start" });
    expect(practiceKey("Enter", { ...ctx, phase: "live", anyBusy: true })).toBeNull();
    expect(practiceKey("Escape", { ...ctx, phase: "live", anyBusy: true })).toEqual({ kind: "stop" });
    expect(practiceKey("Escape", ctx)).toBeNull();
    expect(practiceKey("2", ctx)).toEqual({ kind: "speed", speed: 2 });
    expect(practiceKey("3", ctx)).toBeNull();
    expect(practiceKey("Enter", { ...ctx, typing: true })).toBeNull();
    expect(practiceKey("1", { ...ctx, picker: true })).toBeNull();
  });
});

describe("matches left behind by a reload (the server hands them back on hello)", () => {
  it("are left, not played, and the join waits until they've ended", async () => {
    vi.useFakeTimers();
    const { OrphanGate, ORPHAN_WINDOW_MS } = await import("../src/live/orphans.js");
    const left: string[] = [];
    let joins = 0;
    const gate = new OrphanGate((id) => left.push(id), () => joins++);
    gate.welcome();
    expect(gate.take(start("old"))).toBe(true);
    expect(gate.take(state("old", 140))).toBe(true);
    vi.advanceTimersByTime(ORPHAN_WINDOW_MS);
    expect(left).toEqual(["old"]);
    expect(joins).toBe(0);
    expect(gate.take(end("old", 3, 9))).toBe(true);
    expect(joins).toBe(1);
    expect(gate.take({ type: "profile", match_id: "old", report: report("old") })).toBe(true);
    // The match this page asked for comes through.
    expect(gate.take(start("new"))).toBe(false);
    vi.useRealTimers();
  });

  it("joins straight after the window when nothing was left behind", async () => {
    vi.useFakeTimers();
    const { OrphanGate, ORPHAN_WINDOW_MS } = await import("../src/live/orphans.js");
    let joins = 0;
    const gate = new OrphanGate(() => undefined, () => joins++);
    gate.welcome();
    vi.advanceTimersByTime(ORPHAN_WINDOW_MS);
    vi.advanceTimersByTime(10_000);
    expect(joins).toBe(1);
    vi.useRealTimers();
  });
});
