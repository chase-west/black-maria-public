import { DEFAULT_COHORT, type Db } from "./db.js";
import { newToken, seedPool } from "./ids.js";

export function createToken(db: Db, email: string, token = newToken(), attempts = 1, cohort = DEFAULT_COHORT): string {
  db.insertToken({ token, email, created_at: Date.now(), seed_pool_json: JSON.stringify(seedPool(attempts)), name: null, cohort });
  return token;
}

/** Ensure the local development token exists. */
export function ensureDevToken(db: Db, token: string): void {
  if (!db.getToken(token)) createToken(db, "dev@localhost", token);
}
