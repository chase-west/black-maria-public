import type { ProfilerReport, Tier } from "@blackmaria/protocol";
import { ERR, type ErrCode } from "@blackmaria/protocol/wire";
import { scores, type MatchState } from "@blackmaria/engine";
import { tokenHex, type ReplayLog, type RunResult, type WireHost, type WireMatchInfo, type WireRules } from "@black-maria/sim";
import { OFFICIAL_LATE_SENTENCE, type CandidateClock } from "./clock.js";
import type { Config } from "./config.js";
import type { Db } from "./db.js";
import { newMatchId, newRunId, randomSeed } from "./ids.js";
import { profileOf, recordPracticeProfile } from "./profile.js";
import { wireQuality } from "./quality.js";
import { writeReplay } from "./replay.js";

/** The deployed server's wire host: tokens, the clock, limits, seeds and results all live in the database. */
export class DbWireHost implements WireHost {
  /** Live wire matches by id, for the portal's live view and replays in progress. */
  readonly live = new Map<string, WireMatchInfo>();
  onMatchEnd: ((info: WireMatchInfo, state: MatchState, report: ProfilerReport | null) => void) | null = null;
  onTick: ((info: WireMatchInfo, state: MatchState) => void) | null = null;

  constructor(
    private readonly cfg: Config,
    private readonly db: Db,
    private readonly clock: CandidateClock,
    private readonly warn: (msg: string, err?: unknown) => void,
  ) {}

  /** A known token; its first use on the wire starts its clock if the magic link has not. */
  authenticate(raw: Uint8Array): string | null {
    const token = tokenHex(raw);
    if (!this.db.getToken(token)) return null;
    this.clock.open(token);
    return token;
  }

  clockLeftS(token: string): number | null {
    const ms = this.clock.leftMs(token);
    return ms === null ? null : ms / 1000;
  }

  attemptsLeft(token: string): number {
    return Math.max(0, this.cfg.limits.officialAttempts - this.db.listRuns(token).length);
  }

  practiceAllowed(token: string, liveForToken: number): ErrCode | null {
    if (liveForToken >= this.cfg.limits.practiceConcurrent) return ERR.RATE_LIMITED;
    if (this.db.countMatchesSince(token, "practice", Date.now() - 3600_000) >= this.cfg.limits.practicePerHour) return ERR.RATE_LIMITED;
    return null;
  }

  practiceSeed(_token: string, _tier: Tier): number {
    return randomSeed();
  }

  /** One official run, startable from the moment the clock starts until minute 85 (SPEC 5.7, v6.3). */
  beginRun(token: string): { runId: string; seeds: number[] } | ErrCode | { code: ErrCode; msg: string } {
    const prior = this.db.listRuns(token);
    if (prior.length >= this.cfg.limits.officialAttempts) return ERR.NO_ATTEMPTS;
    const row = this.db.getToken(token);
    if (!row) return ERR.BAD_TOKEN;
    const st = this.clock.status(token);
    if (!st || st.expired) return ERR.CLOCK_EXPIRED;
    if (!st.official_open) return { code: ERR.CLOCK_EXPIRED, msg: OFFICIAL_LATE_SENTENCE };
    let pool: number[] = [];
    try {
      pool = JSON.parse(row.seed_pool_json) as number[];
    } catch {
      pool = [];
    }
    const attempt = prior.length;
    const seeds = Array.from({ length: 9 }, (_, i) => (pool[attempt * 9 + i] ?? randomSeed()) >>> 0);
    // The official run plays with the change. A run started without opening the Official page reveals it here, so the
    // HELLO_ACK that answers this HELLO already carries it.
    this.clock.reveal(token);
    const runId = newRunId();
    this.db.insertRun({ id: runId, token, attempt, started_at: Date.now(), finished_at: null, profile_json: null });
    return { runId, seeds };
  }

  /** The cohort's change once the token has seen it (SPEC 2.2, v6.3); the defaults before. */
  rules(token: string): WireRules {
    return this.clock.rulesFor(token);
  }

  newMatchId(): string {
    return newMatchId();
  }

  matchStarted(m: WireMatchInfo): void {
    this.live.set(m.id, m);
    try {
      this.db.insertMatch({ id: m.id, token: m.token, mode: m.mode, transport: "wire", tier: m.tier, seed: m.seed, started_at: Date.now(), ended_at: null, result: null, score_you: null, score_maria: null, replay_path: null, run_id: m.run?.id ?? null, run_index: m.run?.index ?? null });
    } catch (err) {
      this.warn("db insertMatch (wire) failed", err);
    }
  }

  tick(m: WireMatchInfo, state: MatchState): void {
    this.onTick?.(m, state);
  }

  matchEnded(m: WireMatchInfo, state: MatchState, log: ReplayLog): void {
    this.live.delete(m.id);
    let replayPath = "";
    try {
      replayPath = writeReplay(this.cfg.replayDir, log);
    } catch (err) {
      this.warn(`failed to write replay ${m.id}`, err);
    }
    const sc = scores(state);
    const result = sc.you > sc.maria ? "win" : sc.you === sc.maria ? "draw" : "loss";
    try {
      this.db.finishMatch(m.id, { ended_at: Date.now(), result, score_you: sc.you, score_maria: sc.maria, replay_path: replayPath, wire_json: JSON.stringify(wireQuality(log)) });
    } catch (err) {
      this.warn("db finishMatch (wire) failed", err);
    }
    const report = m.mode === "practice" ? recordPracticeProfile(this.db, m.token, log, this.warn) : null;
    this.onMatchEnd?.(m, state, report);
  }

  runFinished(runId: string, _token: string, results: RunResult[]): void {
    try {
      this.db.finishRun(runId, Date.now(), JSON.stringify(profileOf(results)));
    } catch (err) {
      this.warn("db finishRun failed", err);
    }
  }

  log(msg: string, err?: unknown): void {
    this.warn(msg, err);
  }
}
