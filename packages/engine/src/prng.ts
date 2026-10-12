/**
 * Deterministic randomness. Two flavors:
 * - `SeqRng`: a sequential generator (mulberry32) for one-shot generation (map, objectives).
 * - `Rng`: a counter-based generator for `step`, so `step` stays a pure function of its inputs.
 */

/** 32-bit integer mix (splitmix32 finalizer). */
export function mix32(x: number): number {
  x = (x + 0x9e3779b9) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
}

/** Hash a string to 32 bits (FNV-1a). */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export class SeqRng {
  private s: number;
  constructor(seed: number) {
    this.s = mix32(seed >>> 0);
  }
  /** Uniform in [0, 2^32). */
  u32(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }
  /** Uniform integer in [0, n). */
  int(n: number): number {
    if (n <= 0) throw new Error("int(n) requires n > 0");
    return this.u32() % n;
  }
  /** Integer in [lo, hi] inclusive. */
  range(lo: number, hi: number): number {
    return lo + this.int(hi - lo + 1);
  }
  bool(): boolean {
    return (this.u32() & 1) === 1;
  }
  pick<T>(xs: readonly T[]): T {
    if (xs.length === 0) throw new Error("pick from empty list");
    return xs[this.int(xs.length)]!;
  }
  shuffle<T>(xs: readonly T[]): T[] {
    const a = xs.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      const t = a[i]!;
      a[i] = a[j]!;
      a[j] = t;
    }
    return a;
  }
}

/** Counter-based randomness for `step`. Pure: the same (seed, tick, stream) always gives the same value. */
export interface Rng {
  readonly seed: number;
  u32(tick: number, stream: number): number;
}

export function createRng(seed: number): Rng {
  const s = seed >>> 0;
  return {
    seed: s,
    u32(tick: number, stream: number): number {
      return mix32(mix32(s ^ Math.imul(stream + 1, 0x27d4eb2d)) ^ mix32(tick >>> 0));
    },
  };
}

