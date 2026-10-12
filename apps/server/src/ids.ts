import { randomBytes, randomInt } from "node:crypto";

export function newMatchId(): string {
  return "m_" + randomBytes(6).toString("hex");
}
export function newRunId(): string {
  return "r_" + randomBytes(6).toString("hex");
}
/** A token is 16 random bytes, written as 32 lowercase hex characters in magic links; the wire carries the raw bytes (SPEC 5.3). */
export function newToken(): string {
  return randomBytes(16).toString("hex");
}
export function randomSeed(): number {
  return randomInt(0, 2 ** 32 - 1) >>> 0;
}
/** A token's private official seed pool (official seeds are not published, so a run cannot be precomputed): 9 seeds per attempt. */
export function seedPool(attempts: number): number[] {
  return Array.from({ length: attempts * 9 }, () => randomSeed());
}
