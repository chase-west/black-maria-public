import { randomBytes } from "node:crypto";
import type { Tier } from "@blackmaria/protocol";
import type { ErrCode } from "@blackmaria/protocol/wire";
import type { MatchState } from "@blackmaria/engine";
import type { ReplayLog } from "./live.js";
import { DEFAULT_RULES, tokenHex, type RunResult, type WireHost, type WireMatchInfo, type WireRules } from "./wire-server.js";

/**
 * The host for the local simulator's wire server: any 16-byte token is accepted, there is no clock, official runs
 * can be repeated, and seeds are random unless fixed.
 */
export class LocalHost implements WireHost {
  readonly ended: { info: WireMatchInfo; state: MatchState; log: ReplayLog }[] = [];
  readonly runs: { runId: string; token: string; results: RunResult[] }[] = [];
  private n = 0;
  /** Optional observer for tests and the CLI. */
  matchStarted?: (info: WireMatchInfo) => void;
  constructor(private readonly opts: { rules?: WireRules; seed?: number; officialSeeds?: number[]; log?: (m: string, e?: unknown) => void; onEnd?: (info: WireMatchInfo, state: MatchState, log: ReplayLog) => void; onRun?: (runId: string, results: RunResult[]) => void } = {}) {}
  rules(): WireRules {
    return this.opts.rules ?? DEFAULT_RULES;
  }
  authenticate(raw: Uint8Array): string | null {
    return raw.length === 16 ? tokenHex(raw) : null;
  }
  clockLeftS(): number | null {
    return null;
  }
  attemptsLeft(): number {
    return 1;
  }
  practiceAllowed(): ErrCode | null {
    return null;
  }
  practiceSeed(_token: string, _tier: Tier): number {
    return this.opts.seed !== undefined ? this.opts.seed >>> 0 : randomBytes(4).readUInt32LE(0);
  }
  beginRun(_token: string): ReturnType<WireHost["beginRun"]> {
    const seeds = this.opts.officialSeeds ?? Array.from({ length: 9 }, () => randomBytes(4).readUInt32LE(0));
    return { runId: `local_run_${++this.n}`, seeds };
  }
  newMatchId(): string {
    return `local_${randomBytes(5).toString("hex")}`;
  }
  matchEnded(info: WireMatchInfo, state: MatchState, log: ReplayLog): void {
    this.ended.push({ info, state, log });
    if (this.ended.length > 200) this.ended.shift();
    this.opts.onEnd?.(info, state, log);
  }
  runFinished(runId: string, token: string, results: RunResult[]): void {
    this.runs.push({ runId, token, results });
    this.opts.onRun?.(runId, results);
  }
  log(msg: string, err?: unknown): void {
    this.opts.log?.(msg, err);
  }
}
