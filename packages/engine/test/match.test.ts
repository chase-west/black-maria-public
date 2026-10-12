import { describe, expect, it } from "vitest";
import type { Intent } from "@blackmaria/protocol";
import { SeqRng, createMatch, createRng, deserialize, hashState, replayMatch, serialize, step, type Intents, type MatchState } from "../src/index.js";

function randomIntent(r: SeqRng): Intent {
  const k = r.int(10);
  if (k < 5) return { kind: "MOVE", dir: (["N", "E", "S", "W"] as const)[r.int(4)]! };
  if (k === 5) return { kind: "WAIT" };
  if (k === 6) return { kind: "TAKE" };
  if (k === 7) return { kind: "SNATCH" };
  const item = `i${1 + r.int(12)}`;
  return k < 9 ? { kind: "USE", item } : { kind: "DROP", item };
}

function randomStream(seed: number, n: number): Intents[] {
  const r = new SeqRng(seed ^ 0x5eed);
  return Array.from({ length: n }, () => ({ you: randomIntent(r), maria: randomIntent(r) }));
}

describe("determinism (SPEC 1.2)", () => {
  it("same seed and moves give a byte-identical hash: 500 random seeds with random intent streams", () => {
    for (let k = 0; k < 500; k++) {
      const seed = (k * 0x9e3779b1 + 17) >>> 0;
      const intents = randomStream(seed, 400);
      const a = replayMatch(seed, intents);
      const b = replayMatch(seed, intents);
      expect(a.length).toBe(b.length);
      // Every 40th tick and the final state, by hash.
      for (let t = 0; t < a.length; t += 40) expect(hashState(a[t]!)).toBe(hashState(b[t]!));
      expect(hashState(a.at(-1)!)).toBe(hashState(b.at(-1)!));
      expect(serialize(a.at(-1)!)).toBe(serialize(b.at(-1)!));
    }
  });

  it("every per-tick hash matches across runs (20 seeds, all ticks)", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const intents = randomStream(seed, 400);
      const ha = replayMatch(seed, intents).map(hashState);
      const hb = replayMatch(seed, intents).map(hashState);
      expect(ha).toEqual(hb);
    }
  });

  it("different intents give a different hash", () => {
    const a = replayMatch(1, randomStream(1, 50)).at(-1)!;
    const b = replayMatch(1, randomStream(2, 50)).at(-1)!;
    expect(hashState(a)).not.toBe(hashState(b));
  });

  it("step never mutates its input state", () => {
    const intents = randomStream(77, 200);
    let s = createMatch(77);
    const rng = createRng(77);
    for (const i of intents) {
      const before = serialize(s);
      const next = step(s, i, rng);
      expect(serialize(s)).toBe(before);
      s = next;
    }
  });

  it("serialize/deserialize round-trips mid-match and continues identically", () => {
    const intents = randomStream(5, 400);
    const states = replayMatch(5, intents);
    const mid = states[150]!;
    let resumed: MatchState = deserialize(serialize(mid));
    expect(hashState(resumed)).toBe(hashState(mid));
    const rng = createRng(5);
    for (let t = 150; t < intents.length && !resumed.done; t++) resumed = step(resumed, intents[t]!, rng);
    expect(hashState(resumed)).toBe(hashState(states.at(-1)!));
  });

  it("mapgen and the board are deterministic per seed and vary across seeds", () => {
    expect(serialize(createMatch(123))).toBe(serialize(createMatch(123)));
    expect(createMatch(123).mapHash).not.toBe(createMatch(124).mapHash);
  });
});
