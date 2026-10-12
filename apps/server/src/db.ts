import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Mode, Result, Tier } from "@blackmaria/protocol";

export interface TokenRow {
  token: string;
  email: string;
  created_at: number;
  seed_pool_json: string;
  name: string | null;
  /** The first open of the magic link (or first use of the token): the clock starts here (SPEC 7). */
  opened_at: number | null;
  /** The cohort whose change applies to this token's official run (SPEC 2.2). */
  cohort: string;
  /** When the change email went out. */
  change_notified_at: number | null;
  /** The first time this token opened the Official page (or started the official run): the change is revealed here. */
  change_revealed_at: number | null;
}
export interface CohortRow {
  id: string;
  /** 1 to 3 (SPEC 2.2), or null until the admin sets it or it is first needed (drawn by the cohort's id). */
  rule_change: number | null;
  created_at: number;
}
export interface PracticeProfileRow {
  match_id: string;
  token: string;
  tier: Tier;
  transport: string;
  ended_at: number;
  profile_json: string;
}
export interface OutboxRow {
  id: number;
  token: string | null;
  to_addr: string;
  subject: string;
  body: string;
  sent_at: number;
}
export interface MatchRow {
  id: string;
  token: string;
  mode: Mode;
  transport: "ws" | "wire";
  tier: Tier;
  seed: number;
  started_at: number;
  ended_at: number | null;
  result: Result | null;
  score_you: number | null;
  score_maria: number | null;
  replay_path: string | null;
  run_id: string | null;
  run_index: number | null;
  /** Wire quality from the replay (on-time moves, resyncs, the blackhole), JSON. Null for WebSocket matches. */
  wire_json?: string | null;
}
export interface RunRow {
  id: string;
  token: string;
  attempt: number;
  started_at: number;
  finished_at: number | null;
  profile_json: string | null;
}
export interface SubmissionRow {
  token: string;
  code_path: string | null;
  code_url: string | null;
  /** The note's two answers (SPEC 2.3), at most 150 words each: what you built and left out; what you noticed. */
  note_built: string;
  note_noticed: string;
  submitted_at: number;
}
export const DECISIONS = ["", "advance", "hold", "reject"] as const;
export type Decision = (typeof DECISIONS)[number];
export interface ReviewRow {
  token: string;
  notes: string;
  decision: Decision;
  /** The seams checklist: seam id to whether the note reported it. */
  seams_json: string;
  updated_at: number;
}

/**
 * Bumped whenever a table changes shape. Older databases are dev data and are rebuilt, except a version 5 database,
 * which only gains `tokens.change_revealed_at` (v6.3) and keeps its candidates.
 */
export const SCHEMA_VERSION = 6;
export const DEFAULT_COHORT = "default";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tokens(
  token TEXT PRIMARY KEY, email TEXT NOT NULL, created_at INTEGER NOT NULL, seed_pool_json TEXT NOT NULL, name TEXT,
  opened_at INTEGER, cohort TEXT NOT NULL DEFAULT 'default', change_notified_at INTEGER, change_revealed_at INTEGER
);
CREATE TABLE IF NOT EXISTS cohorts(
  id TEXT PRIMARY KEY, rule_change INTEGER, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS matches(
  id TEXT PRIMARY KEY, token TEXT NOT NULL, mode TEXT NOT NULL, transport TEXT NOT NULL, tier TEXT NOT NULL, seed INTEGER NOT NULL,
  started_at INTEGER NOT NULL, ended_at INTEGER, result TEXT, score_you INTEGER, score_maria INTEGER, replay_path TEXT,
  run_id TEXT, run_index INTEGER, wire_json TEXT
);
CREATE TABLE IF NOT EXISTS practice_profiles(
  match_id TEXT PRIMARY KEY, token TEXT NOT NULL, tier TEXT NOT NULL, transport TEXT NOT NULL, ended_at INTEGER NOT NULL, profile_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS practice_profiles_token ON practice_profiles(token, ended_at);
CREATE TABLE IF NOT EXISTS outbox(
  id INTEGER PRIMARY KEY AUTOINCREMENT, token TEXT, to_addr TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL, sent_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS matches_token_started ON matches(token, started_at);
CREATE INDEX IF NOT EXISTS matches_run ON matches(run_id);
CREATE TABLE IF NOT EXISTS official_runs(
  id TEXT PRIMARY KEY, token TEXT NOT NULL, attempt INTEGER NOT NULL, started_at INTEGER NOT NULL, finished_at INTEGER, profile_json TEXT
);
CREATE INDEX IF NOT EXISTS runs_token ON official_runs(token);
CREATE TABLE IF NOT EXISTS submissions(
  token TEXT PRIMARY KEY, code_path TEXT, code_url TEXT, note_built TEXT NOT NULL, note_noticed TEXT NOT NULL, submitted_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS reviews(
  token TEXT PRIMARY KEY, notes TEXT NOT NULL, decision TEXT NOT NULL, seams_json TEXT NOT NULL DEFAULT '{}', updated_at INTEGER NOT NULL
);
`;

export class Db {
  readonly sql: Database.Database;
  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.sql = new Database(path);
    this.sql.pragma("journal_mode = WAL");
    this.sql.pragma("busy_timeout = 5000");
    const version = this.sql.pragma("user_version", { simple: true }) as number;
    if (version === 5) {
      // v6.3: the change is revealed per token on the Official page instead of at minute 60.
      const cols = this.sql.prepare("PRAGMA table_info(tokens)").all() as { name: string }[];
      if (cols.length && !cols.some((c) => c.name === "change_revealed_at")) this.sql.exec("ALTER TABLE tokens ADD COLUMN change_revealed_at INTEGER");
      this.sql.pragma(`user_version = ${SCHEMA_VERSION}`);
    } else if (version !== SCHEMA_VERSION) {
      for (const t of ["tokens", "cohorts", "matches", "official_runs", "submissions", "reviews", "practice_profiles", "outbox"]) this.sql.exec(`DROP TABLE IF EXISTS ${t}`);
      this.sql.pragma(`user_version = ${SCHEMA_VERSION}`);
    }
    this.sql.exec(SCHEMA);
  }
  close(): void {
    this.sql.close();
  }

  // tokens
  insertToken(t: Pick<TokenRow, "token" | "email" | "created_at" | "seed_pool_json" | "name"> & { cohort?: string }): void {
    this.sql
      .prepare("INSERT OR IGNORE INTO tokens(token, email, created_at, seed_pool_json, name, cohort) VALUES (@token, @email, @created_at, @seed_pool_json, @name, @cohort)")
      .run({ ...t, cohort: t.cohort ?? DEFAULT_COHORT });
  }
  /** Set `opened_at` if it is not set yet. Returns the (possibly earlier) value. */
  openToken(token: string, now: number): number | null {
    this.sql.prepare("UPDATE tokens SET opened_at = ? WHERE token = ? AND opened_at IS NULL").run(now, token);
    return this.getToken(token)?.opened_at ?? null;
  }
  /** Test and admin hook: move a token's clock. */
  setOpenedAt(token: string, at: number | null): void {
    this.sql.prepare("UPDATE tokens SET opened_at = ? WHERE token = ?").run(at, token);
  }
  /** Admin hook (a rehearsal back at minute 0): hide the change again and let its email go out again. */
  resetChangeRevealed(token: string): void {
    this.sql.prepare("UPDATE tokens SET change_revealed_at = NULL, change_notified_at = NULL WHERE token = ?").run(token);
  }
  /** Record the reveal. True only the first time. */
  markChangeRevealed(token: string, at: number): boolean {
    return this.sql.prepare("UPDATE tokens SET change_revealed_at = ? WHERE token = ? AND change_revealed_at IS NULL").run(at, token).changes === 1;
  }
  markChangeNotified(token: string, at: number): boolean {
    return this.sql.prepare("UPDATE tokens SET change_notified_at = ? WHERE token = ? AND change_notified_at IS NULL").run(at, token).changes === 1;
  }

  // cohorts
  getCohort(id: string): CohortRow | null {
    return (this.sql.prepare("SELECT * FROM cohorts WHERE id = ?").get(id) as CohortRow | undefined) ?? null;
  }
  listCohorts(): CohortRow[] {
    return this.sql.prepare("SELECT * FROM cohorts ORDER BY created_at").all() as CohortRow[];
  }
  upsertCohort(id: string, ruleChange: number | null, now: number): void {
    this.sql.prepare("INSERT INTO cohorts(id, rule_change, created_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET rule_change = excluded.rule_change").run(id, ruleChange, now);
  }
  /** Tokens in a cohort that have seen the change. */
  cohortTokensRevealed(id: string): number {
    return (this.sql.prepare("SELECT COUNT(*) AS n FROM tokens WHERE cohort = ? AND change_revealed_at IS NOT NULL").get(id) as { n: number }).n;
  }
  getToken(token: string): TokenRow | null {
    return (this.sql.prepare("SELECT * FROM tokens WHERE token = ?").get(token) as TokenRow | undefined) ?? null;
  }
  listTokens(): TokenRow[] {
    return this.sql.prepare("SELECT * FROM tokens ORDER BY created_at").all() as TokenRow[];
  }
  setName(token: string, name: string): void {
    this.sql.prepare("UPDATE tokens SET name = ? WHERE token = ?").run(name, token);
  }

  // matches
  insertMatch(m: MatchRow): void {
    this.sql
      .prepare(
        "INSERT INTO matches(id, token, mode, transport, tier, seed, started_at, ended_at, result, score_you, score_maria, replay_path, run_id, run_index, wire_json) VALUES (@id, @token, @mode, @transport, @tier, @seed, @started_at, @ended_at, @result, @score_you, @score_maria, @replay_path, @run_id, @run_index, @wire_json)",
      )
      .run({ wire_json: null, ...m });
  }
  finishMatch(id: string, f: { ended_at: number; result: Result; score_you: number; score_maria: number; replay_path: string; wire_json?: string | null }): void {
    this.sql
      .prepare("UPDATE matches SET ended_at=@ended_at, result=@result, score_you=@score_you, score_maria=@score_maria, replay_path=@replay_path, wire_json=@wire_json WHERE id=@id")
      .run({ id, wire_json: null, ...f });
  }
  getMatch(id: string): MatchRow | null {
    return (this.sql.prepare("SELECT * FROM matches WHERE id = ?").get(id) as MatchRow | undefined) ?? null;
  }
  listMatches(token: string, limit: number): MatchRow[] {
    return this.sql.prepare("SELECT * FROM matches WHERE token = ? ORDER BY started_at DESC LIMIT ?").all(token, limit) as MatchRow[];
  }
  countMatchesSince(token: string, mode: Mode, since: number): number {
    const r = this.sql.prepare("SELECT COUNT(*) AS n FROM matches WHERE token = ? AND mode = ? AND started_at >= ?").get(token, mode, since) as { n: number };
    return r.n;
  }
  runMatches(runId: string): MatchRow[] {
    return this.sql.prepare("SELECT * FROM matches WHERE run_id = ? ORDER BY run_index").all(runId) as MatchRow[];
  }
  /** Matches left unfinished by a crash: mark them aborted. */
  abortUnfinished(now: number): number {
    return this.sql.prepare("UPDATE matches SET ended_at = ?, result = NULL WHERE ended_at IS NULL").run(now).changes;
  }

  // runs
  insertRun(r: RunRow): void {
    this.sql.prepare("INSERT INTO official_runs(id, token, attempt, started_at, finished_at, profile_json) VALUES (@id, @token, @attempt, @started_at, @finished_at, @profile_json)").run(r);
  }
  finishRun(id: string, finished_at: number, profile_json: string): void {
    this.sql.prepare("UPDATE official_runs SET finished_at = ?, profile_json = ? WHERE id = ?").run(finished_at, profile_json, id);
  }
  listRuns(token: string): RunRow[] {
    return this.sql.prepare("SELECT * FROM official_runs WHERE token = ? ORDER BY attempt").all(token) as RunRow[];
  }
  allRuns(): RunRow[] {
    return this.sql.prepare("SELECT * FROM official_runs ORDER BY started_at").all() as RunRow[];
  }
  closeOpenRuns(now: number): void {
    this.sql.prepare("UPDATE official_runs SET finished_at = ? WHERE finished_at IS NULL").run(now);
  }

  // practice profiles (the profiler timeline, SPEC 7)
  insertPracticeProfile(r: PracticeProfileRow): void {
    this.sql
      .prepare("INSERT OR REPLACE INTO practice_profiles(match_id, token, tier, transport, ended_at, profile_json) VALUES (@match_id, @token, @tier, @transport, @ended_at, @profile_json)")
      .run(r);
  }
  practiceProfiles(token: string): PracticeProfileRow[] {
    return this.sql.prepare("SELECT * FROM practice_profiles WHERE token = ? ORDER BY ended_at, match_id").all(token) as PracticeProfileRow[];
  }
  getPracticeProfile(matchId: string): PracticeProfileRow | null {
    return (this.sql.prepare("SELECT * FROM practice_profiles WHERE match_id = ?").get(matchId) as PracticeProfileRow | undefined) ?? null;
  }

  // the email stub's outbox
  insertOutbox(o: Omit<OutboxRow, "id">): void {
    this.sql.prepare("INSERT INTO outbox(token, to_addr, subject, body, sent_at) VALUES (@token, @to_addr, @subject, @body, @sent_at)").run(o);
  }
  getOutbox(id: number): OutboxRow | null {
    return (this.sql.prepare("SELECT * FROM outbox WHERE id = ?").get(id) as OutboxRow | undefined) ?? null;
  }
  listOutbox(token?: string): OutboxRow[] {
    return token ? (this.sql.prepare("SELECT * FROM outbox WHERE token = ? ORDER BY id").all(token) as OutboxRow[]) : (this.sql.prepare("SELECT * FROM outbox ORDER BY id").all() as OutboxRow[]);
  }

  // submissions
  upsertSubmission(s: SubmissionRow): void {
    this.sql
      .prepare(
        `INSERT INTO submissions(token, code_path, code_url, note_built, note_noticed, submitted_at) VALUES (@token, @code_path, @code_url, @note_built, @note_noticed, @submitted_at)
         ON CONFLICT(token) DO UPDATE SET code_path=excluded.code_path, code_url=excluded.code_url, note_built=excluded.note_built, note_noticed=excluded.note_noticed, submitted_at=excluded.submitted_at`,
      )
      .run(s);
  }
  getSubmission(token: string): SubmissionRow | null {
    return (this.sql.prepare("SELECT * FROM submissions WHERE token = ?").get(token) as SubmissionRow | undefined) ?? null;
  }

  // reviews
  getReview(token: string): ReviewRow | null {
    return (this.sql.prepare("SELECT * FROM reviews WHERE token = ?").get(token) as ReviewRow | undefined) ?? null;
  }
  upsertReview(r: ReviewRow): void {
    this.sql
      .prepare(
        "INSERT INTO reviews(token, notes, decision, seams_json, updated_at) VALUES (@token, @notes, @decision, @seams_json, @updated_at) ON CONFLICT(token) DO UPDATE SET notes=excluded.notes, decision=excluded.decision, seams_json=excluded.seams_json, updated_at=excluded.updated_at",
      )
      .run(r);
  }
}
