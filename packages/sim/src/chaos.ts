import type { Tier } from "@blackmaria/protocol";
import { SeqRng, hashString, mix32 } from "@blackmaria/engine";

/** Chaos profiles (SPEC 5.6). Probabilities per datagram; delay is uniform in [0, delayMax] ms. */
export interface ChaosProfile {
  name: Tier;
  loss: number;
  reorder: number;
  duplicate: number;
  delayMax: number;
  blackhole: boolean;
}

export const CHAOS: Record<Tier, ChaosProfile> = {
  novice: { name: "novice", loss: 0.05, reorder: 0.05, duplicate: 0.02, delayMax: 30, blackhole: false },
  adept: { name: "adept", loss: 0.1, reorder: 0.1, duplicate: 0.05, delayMax: 60, blackhole: false },
  master: { name: "master", loss: 0.1, reorder: 0.1, duplicate: 0.05, delayMax: 70, blackhole: true },
};
export const HARSHNESS: Record<Tier, number> = { novice: 1, adept: 2, master: 3 };

export const BLACKHOLE_MS = 400;
/** A reordered datagram is released right after the next one in the same direction, or after this long if none follows. */
export const REORDER_MAX_HOLD_MS = 100;

/** The tick at which a Master-profile match's blackhole starts: seeded, in 100..300. */
export function blackholeTick(seed: number): number {
  return 100 + (mix32((seed >>> 0) ^ hashString("blackhole")) % 201);
}

/** Seeded randomness for one direction of one match's datagrams. */
export function chaosRng(seed: number, dir: "down" | "up", salt = 0): SeqRng {
  return new SeqRng(mix32((seed >>> 0) ^ hashString(`chaos-${dir}`)) ^ mix32(salt + 1));
}

export interface ChaosDecision {
  drop: boolean;
  /** Delay of each delivered copy (one, or two when duplicated). */
  delays: number[];
  reorder: boolean;
}

/** Roll the dice for one datagram. Always draws the same number of values, so a log is reproducible from its seed. */
export function roll(p: ChaosProfile, r: SeqRng): ChaosDecision {
  const u = () => r.u32() / 4294967296;
  const lost = u() < p.loss;
  const dup = u() < p.duplicate;
  const reorder = u() < p.reorder;
  const d1 = Math.floor(u() * (p.delayMax + 1));
  const d2 = Math.floor(u() * (p.delayMax + 1));
  return { drop: lost, delays: dup ? [d1, d2] : [d1], reorder };
}

export interface Timers {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(h: unknown): void;
}

interface Held {
  deliver: () => void;
  timer: unknown;
}

/**
 * One direction of one session's link. `send` applies a profile to a datagram and calls `deliver` zero, one or
 * two times, later. Reorder holds a datagram until the next one in this direction has gone (SPEC 5.6).
 */
export class ChaosLink {
  private held: Held[] = [];
  /** Until this time (Timers.now) every datagram in this direction is dropped. */
  blackholeUntil = 0;

  constructor(private readonly timers: Timers) {}

  /**
   * Returns what happened, for the replay log. `profile` null means a clean link (no chaos at all).
   */
  send(profile: ChaosProfile | null, rng: SeqRng | null, deliver: () => void): { action: "deliver" | "drop" | "duplicate" | "reorder" | "blackhole"; delays: number[] } {
    if (this.timers.now() < this.blackholeUntil) return { action: "blackhole", delays: [] };
    if (!profile || !rng) {
      deliver();
      this.releaseHeld(0);
      return { action: "deliver", delays: [0] };
    }
    const d = roll(profile, rng);
    if (d.drop) return { action: "drop", delays: [] };
    if (d.reorder) {
      const h: Held = { deliver, timer: null };
      h.timer = this.timers.setTimeout(() => {
        this.held = this.held.filter((x) => x !== h);
        deliver();
      }, REORDER_MAX_HOLD_MS);
      this.held.push(h);
      return { action: "reorder", delays: d.delays };
    }
    for (const ms of d.delays) this.later(ms, deliver);
    this.releaseHeld(d.delays[0]!);
    return { action: d.delays.length > 1 ? "duplicate" : "deliver", delays: d.delays };
  }

  private later(ms: number, fn: () => void): void {
    if (ms <= 0) fn();
    else this.timers.setTimeout(fn, ms);
  }

  /** Release held datagrams just after the one that was sent with delay `ms`. */
  private releaseHeld(ms: number): void {
    if (this.held.length === 0) return;
    const out = this.held;
    this.held = [];
    for (const h of out) {
      this.timers.clearTimeout(h.timer);
      this.later(ms + 1, h.deliver);
    }
  }

  close(): void {
    for (const h of this.held) this.timers.clearTimeout(h.timer);
    this.held = [];
  }
}
