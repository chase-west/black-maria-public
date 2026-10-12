/**
 * The profiler (SPEC 8.3): one screen after every practice match that says where the points went. Computed from the
 * match's replay by `@black-maria/sim` (`profileReplay`), shown by the portal and the simulator, and stored per token
 * for reviewers as a timeline. Every line links to a heading under "What strong bots do" in docs/RULES.md.
 */
import type { ErrandType, Result, Tier } from "./types.js";

/** The seven headings under "What strong bots do" in docs/RULES.md, in order. */
export const STRONG_BOT_HEADINGS = [
  "Nearest-first pathing",
  "Value per tick",
  "Dropping errands you cannot make before expiry",
  "Planning the next three errands as a route",
  "Simulating Maria to skip races you lose and win races you can",
  "Sending moves ahead and resyncing so the network costs nothing",
  "Reading every parameter from the match start",
] as const;
export type StrongBotHeading = (typeof STRONG_BOT_HEADINGS)[number];

/** The anchor a Markdown renderer gives a heading: lowercase, punctuation dropped, spaces to hyphens. */
export function headingAnchor(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^a-z0-9 -]/g, "")
    .trim()
    .replace(/ /g, "-");
}

export const PROFILER_LINES = ["completed", "maria_first", "expired_heading", "never_attempted", "idle", "network", "snatches", "energy_unused"] as const;
export type ProfilerLineKey = (typeof PROFILER_LINES)[number];

/** Each line's title as the candidate reads it, and the heading it links to. */
export const PROFILER_LINE_INFO: Readonly<Record<ProfilerLineKey, { title: string; heading: StrongBotHeading }>> = {
  completed: { title: "Errands you completed", heading: "Value per tick" },
  maria_first: { title: "Errands Maria took first", heading: "Simulating Maria to skip races you lose and win races you can" },
  expired_heading: { title: "Expired on your way there", heading: "Dropping errands you cannot make before expiry" },
  never_attempted: { title: "Points you never went for", heading: "Planning the next three errands as a route" },
  idle: { title: "Idle ticks", heading: "Nearest-first pathing" },
  network: { title: "Ticks lost to the network", heading: "Sending moves ahead and resyncing so the network costs nothing" },
  snatches: { title: "Snatches", heading: "Simulating Maria to skip races you lose and win races you can" },
  energy_unused: { title: "Energy left at the end", heading: "Reading every parameter from the match start" },
};

/** One errand named on a profiler line. */
export interface ProfilerErrand {
  id: number;
  type: ErrandType;
  value: number;
  /** In plain words, e.g. "deliver a letter to the fireplace". */
  label: string;
  /** Maria took first: how many more ticks you needed when she completed it; null when you could not have finished it. */
  ticks_behind?: number | null;
}

export interface ProfilerReport {
  match_id: string;
  tier: Tier;
  transport: "ws" | "wire" | "local";
  ticks: number;
  result: Result;
  scores: { you: number; maria: number };
  completed: { count: number; value: number };
  maria_first: { count: number; value: number; errands: ProfilerErrand[] };
  expired_heading: { count: number; value: number; errands: ProfilerErrand[] };
  never_attempted: { count: number; value: number };
  /** On-time ticks where you sent `WAIT` or a move that changed nothing. */
  idle: { ticks: number };
  /** Late, missing and malformed moves (your body did `WAIT`), and resyncs answered. */
  network: { ticks: number; late: number; missing: number; malformed: number; resyncs: number };
  snatches: { for: { count: number; value: number }; against: { count: number; value: number } };
  energy_unused: number;
  /** Per line: the heading under "What strong bots do" and its anchor in docs/RULES.md. */
  links: Record<ProfilerLineKey, { heading: string; anchor: string }>;
}
