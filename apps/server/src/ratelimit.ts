/** Token bucket for per-connection frame rate limiting. Uses the server clock only. */
export class TokenBucket {
  private tokens: number;
  private last: number;
  constructor(
    private readonly rate: number,
    private readonly burst: number,
    private readonly now: () => number = () => performance.now(),
  ) {
    this.tokens = burst;
    this.last = now();
  }
  take(n = 1): boolean {
    const t = this.now();
    this.tokens = Math.min(this.burst, this.tokens + ((t - this.last) / 1000) * this.rate);
    this.last = t;
    if (this.tokens < n) return false;
    this.tokens -= n;
    return true;
  }
}

/** Fixed-window counter per key (per-IP HTTP limits). Memory is bounded by pruning on each window. */
export class WindowCounter {
  private counts = new Map<string, number>();
  private windowStart = 0;
  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = () => Date.now(),
  ) {}
  hit(key: string): boolean {
    const t = this.now();
    if (t - this.windowStart >= this.windowMs) {
      this.counts.clear();
      this.windowStart = t;
    }
    const n = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, n);
    return n <= this.limit;
  }
}
