import { describe, expect, it } from "vitest";
import type { Intent } from "@blackmaria/protocol";
import {
  MAX_DATAGRAM,
  Reassembler,
  applyFields,
  blobFromMatchStart,
  decode,
  decodeBlob,
  deltaFields,
  encode,
  encodeBlob,
  fitStateFields,
  fragment,
  itemKindsOf,
  keyframeFields,
  matchStartFromBlob,
  snapshotFromKeyframe,
  snapshotsEqual,
  stateDatagramSize,
  stateFromSnapshot,
  type WireSnapshot,
} from "@blackmaria/protocol/wire";
import { createMatch, createRng, matchBlobFor, matchStartFor, snapshotFor, stateFor, step, wireEventsFor, type MatchState, type Params } from "../src/index.js";
import { SeqRng } from "../src/prng.js";

const DIRS = ["N", "E", "S", "W"] as const;

/** A random move that is usually a step, sometimes an item action on something plausible. */
function randomIntent(r: SeqRng, s: MatchState, b: "you" | "maria"): Intent {
  const k = r.int(12);
  if (k < 6) return { kind: "MOVE", dir: DIRS[r.int(4)]! };
  if (k < 8) return { kind: "TAKE" };
  if (k === 8) return { kind: "SNATCH" };
  if (k === 9) return { kind: "WAIT" };
  const inv = s.bodies[b].inventory;
  const item = inv.length ? inv[r.int(inv.length)]! : `i${1 + r.int(12)}`;
  return k === 10 ? { kind: "USE", item } : { kind: "DROP", item };
}

/** Send a STATE through bytes and back. */
function roundTrip(fields: ReturnType<typeof deltaFields>, base: number, tick: number) {
  const bytes = encode({ session: 9, seq: tick + 1, ack: 0, packet: { type: "STATE", match: 3, tick, base, deadlineMs: 250, ...fields } });
  expect(bytes.length).toBeLessThanOrEqual(MAX_DATAGRAM);
  const p = decode(bytes)!.packet;
  if (p.type !== "STATE") throw new Error("expected STATE");
  return p;
}

function trajectories(n: number, params: Partial<Params>, seedBase: number) {
  let checks = 0;
  for (let k = 1; k <= n; k++) {
    const seed = seedBase + k;
    const r = new SeqRng(seed * 31 + 7);
    const rng = createRng(seed);
    let s = createMatch(seed, { params });
    const history: WireSnapshot[] = [snapshotFor(s)];
    while (!s.done) {
      s = step(s, { you: randomIntent(r, s, "you"), maria: randomIntent(r, s, "maria") }, rng);
      const cur = snapshotFor(s);
      history.push(cur);
      const events = wireEventsFor(s);
      // The keyframe for this tick, through bytes.
      const kf = snapshotFromKeyframe(roundTrip(fitStateFields(keyframeFields(cur, events), s.tick), 0xffff, s.tick))!;
      expect(snapshotsEqual(applyFields(history[s.tick - 1]!, { ...keyframeFields(kf, []), events: [] }, true), cur)).toBe(true);
      // Deltas against the server's keyframe cadence (every 20 ticks) and against a random earlier tick. A delta that
      // does not fit one datagram is never sent: the server sends the keyframe above instead.
      for (const b of [Math.floor(s.tick / 20) * 20, r.int(s.tick + 1)]) {
        const base = history[b]!;
        const d = deltaFields(base, cur, events);
        if (stateDatagramSize(d) > MAX_DATAGRAM) {
          checks++;
          continue;
        }
        const p = roundTrip(fitStateFields(d, s.tick), b, s.tick);
        expect(snapshotsEqual(applyFields(base, p, false), cur)).toBe(true);
        expect(p.events ?? []).toEqual(events);
        checks++;
      }
    }
  }
  return checks;
}

describe("wire deltas over real match trajectories (SPEC 5.5, Phase B)", () => {
  it("for 1000 random trajectories, a delta applied to its base reproduces the keyframe", () => {
    expect(trajectories(1000, {}, 0)).toBe(1000 * 400 * 2);
  });

  it("the same holds with errands posted every 3 ticks (change 1), where boards are largest", () => {
    expect(trajectories(100, { postInterval: 4, expiryMin: 25, expiryMax: 60 }, 5000)).toBe(100 * 400 * 2);
  });

  it("the blob for every map in 1000 seeds fits in two fragments, reassembles, and converts back to the JSON match_start", () => {
    for (let seed = 1; seed <= 1000; seed++) {
      const s = createMatch(seed);
      const ms = matchStartFor(s, "you", { match_id: "m", mode: "practice", tier: "master", tick_ms: 250, chaos: "master" });
      const blob = matchBlobFor(s, "master", seed * 3, { tick_ms: 250, chaos: "master" });
      const bytes = encodeBlob(blob);
      const frags = fragment(bytes);
      expect(frags.length).toBeLessThanOrEqual(2);
      const re = new Reassembler();
      let whole: Uint8Array | null = null;
      for (let k = frags.length - 1; k >= 0; k--) whole = re.add(k, frags.length, frags[k]!) ?? whole;
      const back = decodeBlob(whole!)!;
      expect(back).toEqual(blob);
      expect(matchStartFromBlob(back, { match_id: "m", mode: "practice" })).toEqual(ms);
      expect(blobFromMatchStart(ms, seed * 3)).toEqual(blob);
    }
  });

  it("a wire snapshot plus events converts back to the JSON state the WebSocket sends, items put back included", () => {
    let returned = 0;
    for (let seed = 1; seed <= 100; seed++) {
      const r = new SeqRng(seed);
      const rng = createRng(seed);
      let s = createMatch(seed, { params: { maxTick: 150, returnTicks: 3 } });
      const ms = matchStartFor(s, "you", { match_id: "m", mode: "practice", tier: "novice", tick_ms: 250 });
      // One map per match, as a client keeps it: the kinds of items put back are learned as they appear.
      const kinds = itemKindsOf(ms);
      while (!s.done) {
        s = step(s, { you: randomIntent(r, s, "you"), maria: randomIntent(r, s, "maria") }, rng);
        if (s.done) break;
        returned += s.last!.events.filter((e) => e.kind === "returned").length;
        const json = stateFor(s, "you", { match_id: "m", deadline_ms: 250 });
        const rebuilt = stateFromSnapshot(ms, snapshotFor(s), wireEventsFor(s), { tick: s.tick, deadline_ms: 250 }, kinds);
        expect(rebuilt).toEqual(json);
      }
    }
    expect(returned).toBeGreaterThan(0);
  });

  it("an item put back gets a new id, and a client that keeps one kinds map knows its kind once someone holds it", () => {
    const rng = createRng(3);
    let s = createMatch(3, { params: { returnTicks: 1 } });
    const ms = matchStartFor(s, "you", { match_id: "m", mode: "practice", tier: "novice", tick_ms: 250 });
    const kinds = itemKindsOf(ms);
    const at = (p: { x: number; y: number }) => ({ ...s, bodies: { ...s.bodies, you: { ...s.bodies.you, pos: { ...p } } } });
    const check = () => expect(stateFromSnapshot(ms, snapshotFor(s), wireEventsFor(s), { tick: s.tick, deadline_ms: 250 }, kinds)).toEqual(stateFor(s, "you", { match_id: "m", deadline_ms: 250 }));
    const it0 = s.items.find((i) => i.loc.at === "tile" && i.kind !== "key")!;
    s = step(at((it0.loc as { pos: { x: number; y: number } }).pos), { you: { kind: "TAKE" }, maria: { kind: "WAIT" } }, rng);
    check();
    const fx = s.fixtures.find((f) => f.kind !== "safe" && f.room !== "vault")!;
    s = step(at(fx.pos), { you: { kind: "USE", item: it0.id }, maria: { kind: "WAIT" } }, rng);
    check();
    s = step(s, { you: { kind: "WAIT" }, maria: { kind: "WAIT" } }, rng);
    const back = s.last!.events.find((e) => e.kind === "returned") as { item: string; pos: { x: number; y: number } } | undefined;
    expect(back).toBeDefined();
    expect(back!.item).not.toBe(it0.id);
    check();
    s = step(at(back!.pos), { you: { kind: "TAKE" }, maria: { kind: "WAIT" } }, rng);
    expect(s.bodies.you.inventory).toContain(back!.item);
    check();
  });
});
