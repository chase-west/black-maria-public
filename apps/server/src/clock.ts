/**
 * The candidate's clock and the change (SPEC 2, 2.2, 7, v6.3).
 *
 * - The clock starts on the first open of the magic link (or the token's first use anywhere, if that comes first).
 * - 90 minutes later every HTTP and wire action is refused, except an official run already in progress and the
 *   reviewer API.
 * - The official run is open from the moment the clock starts and must start before minute 85. One attempt.
 * - The cohort's change is revealed to a token the first time it opens the Official page, or when it starts the
 *   official run without opening it. From then on the API, `HELLO_ACK` and every match use it, and one email says so.
 */
import { RULE_CHANGES, isRuleChangeId, type RuleChangeId, type RuleChangeText } from "@blackmaria/protocol";
import { CHANGE_PARAMS, hashString } from "@blackmaria/engine";
import { DEFAULT_RULES, type WireRules } from "@black-maria/sim";
import type { Config } from "./config.js";
import type { Db, TokenRow } from "./db.js";
import { officialCommand, type Mailer } from "./mail.js";

export const CLOCK_MINUTES = 90;
export const OFFICIAL_CLOSES_MINUTE = 85;

export interface ClockStatus {
  opened_at: number;
  now: number;
  /** Clock minutes since it started (fractional). */
  minute: number;
  seconds_left: number;
  ends_at: number;
  official_closes_at: number;
  expired: boolean;
  /** The official run can be started now. */
  official_open: boolean;
}

/** The official run, in words, for the API and the portal (SPEC 8.5: errors are sentences). */
export function officialState(c: ClockStatus): { open: boolean; reason: string } {
  if (c.expired) return { open: false, reason: "Time's up, so the official run is closed." };
  if (c.minute >= OFFICIAL_CLOSES_MINUTE) return { open: false, reason: "Too late for the official run. It had to start by minute 85." };
  return { open: true, reason: "Official run's open. Start it by minute 85." };
}

export const EXPIRED_SENTENCE = "Time's up. Practice, the official run, and submissions are closed.";
export const OFFICIAL_LATE_SENTENCE = "Too late for the official run. It had to start by minute 85.";

/** The deterministic draw for a cohort the admin did not set: 1, 2 or 3 by a hash of its id. */
export function drawChange(cohort: string): RuleChangeId {
  return ((hashString(`change:${cohort}`) % 3) + 1) as RuleChangeId;
}

export function rulesForChange(change: RuleChangeId): WireRules {
  return { params: { ...CHANGE_PARAMS[change] }, ruleChange: change, chaosOverride: change === 3 ? "master" : null };
}

export class CandidateClock {
  /** opened_at by token, so the wire can check the clock on every datagram without a query. */
  private readonly opened = new Map<string, number>();

  constructor(
    private readonly cfg: Config,
    private readonly db: Db,
    private readonly mailer: Mailer,
    private readonly log: (msg: string, err?: unknown) => void = () => {},
    readonly now: () => number = Date.now,
  ) {}

  private get minuteMs(): number {
    return this.cfg.clock.minuteMs;
  }

  /** Start the token's clock if it has not started. Returns when it started. */
  open(token: string): number | null {
    const hit = this.opened.get(token);
    if (hit !== undefined) return hit;
    const at = this.db.openToken(token, this.now());
    if (at !== null) this.opened.set(token, at);
    return at;
  }

  /** Forget cached clock starts (after a test or an admin moves `opened_at`). */
  forget(token?: string): void {
    if (token) this.opened.delete(token);
    else this.opened.clear();
  }

  status(token: string): ClockStatus | null {
    let at = this.opened.get(token);
    if (at === undefined) {
      const row = this.db.getToken(token);
      if (!row || row.opened_at === null) return null;
      at = row.opened_at;
      this.opened.set(token, at);
    }
    const now = this.now();
    const m = this.minuteMs;
    const minute = (now - at) / m;
    const ends = at + CLOCK_MINUTES * m;
    return {
      opened_at: at,
      now,
      minute,
      seconds_left: Math.max(0, Math.floor((ends - now) / 1000)),
      ends_at: ends,
      official_closes_at: at + OFFICIAL_CLOSES_MINUTE * m,
      expired: now >= ends,
      official_open: minute < OFFICIAL_CLOSES_MINUTE && now < ends,
    };
  }

  /** Milliseconds left on the clock; null if it has not started. */
  leftMs(token: string): number | null {
    const s = this.status(token);
    return s ? Math.max(0, s.ends_at - s.now) : null;
  }

  expired(token: string): boolean {
    return this.status(token)?.expired ?? false;
  }

  /** The cohort's change, drawn and stored the first time it is needed if the admin has not set one. */
  cohortChange(cohort: string): RuleChangeId {
    const row = this.db.getCohort(cohort);
    if (row && isRuleChangeId(row.rule_change)) return row.rule_change;
    const drawn = drawChange(cohort);
    this.db.upsertCohort(cohort, drawn, this.now());
    return drawn;
  }

  /** When the token first saw the change, or null if it has not yet. */
  revealedAt(token: string): number | null {
    return this.db.getToken(token)?.change_revealed_at ?? null;
  }

  /** The change a token can see right now: null until it has opened the Official page (or started the run). */
  revealedChange(token: string): RuleChangeText | null {
    const row = this.db.getToken(token);
    if (!row || row.change_revealed_at === null) return null;
    return RULE_CHANGES[this.cohortChange(row.cohort)];
  }

  /**
   * Reveal the cohort's change to a token (the Official page's first open, or the official run's start). Records
   * `change_revealed_at` once and sends the email once. Returns the change.
   */
  reveal(token: string): RuleChangeText | null {
    const row = this.db.getToken(token);
    if (!row) return null;
    const change = RULE_CHANGES[this.cohortChange(row.cohort)];
    if (this.db.markChangeRevealed(token, this.now())) this.notify(row, change);
    return change;
  }

  /** The rules in force for a token now (SPEC 2.2): the defaults until the change is revealed, the change after. */
  rulesFor(token: string): WireRules {
    const c = this.revealedChange(token);
    return c ? rulesForChange(c.id) : DEFAULT_RULES;
  }

  /**
   * Email the change and the official command once, when it is revealed. A token past minute 85 (or out of time)
   * is marked and not emailed: "start it by minute 85" would no longer be true.
   */
  private notify(row: TokenRow, change: RuleChangeText): void {
    if (row.change_notified_at !== null) return;
    if (!this.db.markChangeNotified(row.token, this.now())) return;
    const st = this.status(row.token);
    if (!st || st.minute >= OFFICIAL_CLOSES_MINUTE || st.expired) return;
    try {
      this.mailer.send({
        token: row.token,
        to: row.email,
        subject: "BLACK MARIA: the change",
        text: [
          "You opened the Official page, so here's the change. Your official run plays with it:",
          "",
          change.rule,
          "",
          change.meaning,
          "",
          `To try it first, run the simulator with: ${change.flags}`,
          "",
          "The official run is open now. One shot. Start it before minute 85. Your clock ends at minute 90.",
          "",
          "Start it from your machine (9 matches, about 5 minutes, can't be stopped once it starts):",
          officialCommand(this.cfg.publicUrl, row.token),
        ].join("\n"),
      });
    } catch (err) {
      this.log("official run email failed", err);
    }
  }

  /** Whether the admin may still change a cohort's draw: not once any of its tokens has seen it. */
  cohortLocked(cohort: string): boolean {
    return this.db.cohortTokensRevealed(cohort) > 0;
  }
}
