import type { ProfilerReport, Result, Tier } from "@blackmaria/protocol";
import { profileReplay, type ReplayLog } from "@black-maria/sim";
import type { Db } from "./db.js";

/** The official run's strength profile (SPEC 9). */
export interface Profile {
  novice: number;
  adept: number;
  master: number;
  composite: number;
  played: number;
}

export { runTier, RUN_MATCHES } from "@black-maria/sim";

/** Strength profile (SPEC 9): wins per tier (3 matches each) and composite 1N + 3A + 9M out of 39. */
export function profileOf(results: readonly { tier: Tier; result: Result | null }[]): Profile {
  const p: Profile = { novice: 0, adept: 0, master: 0, composite: 0, played: 0 };
  for (const r of results) {
    if (r.result === null) continue;
    p.played++;
    if (r.result === "win") p[r.tier]++;
  }
  p.composite = p.novice + 3 * p.adept + 9 * p.master;
  return p;
}

export function bestProfile(profiles: readonly Profile[]): Profile | null {
  let best: Profile | null = null;
  for (const p of profiles) if (!best || p.composite > best.composite) best = p;
  return best;
}

/** The profiler for one practice match (SPEC 8.3), stored per token so reviewers see the timeline (SPEC 7). */
export function recordPracticeProfile(db: Db, token: string, log: ReplayLog, warn: (msg: string, err?: unknown) => void): ProfilerReport | null {
  try {
    const report = profileReplay(log);
    db.insertPracticeProfile({ match_id: log.match_id, token, tier: log.tier, transport: log.transport, ended_at: Date.now(), profile_json: JSON.stringify(report) });
    return report;
  } catch (err) {
    warn(`profiler failed for ${log.match_id}`, err);
    return null;
  }
}
