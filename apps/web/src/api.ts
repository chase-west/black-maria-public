import type { ProfilerReport, ReplayDoc, Result, RuleChangeText, Tier, WireQuality } from "@blackmaria/protocol";

/** The candidate's clock, as `/api/me` reports it (SPEC 7). Times are ISO strings on the server's clock. */
export interface ClockInfo {
  opened_at: string;
  ends_at: string;
  official_closes_at: string;
  minute: number;
  seconds_left: number;
  expired: boolean;
}

export interface Me {
  token: string;
  email: string;
  name: string | null;
  window: { opens: string; closes: string; open: boolean };
  attempts_left: number;
  server_time: string;
  ws_path?: string;
  clock?: ClockInfo;
  /** The change, once revealed (the first time you open the Official page). */
  change?: RuleChangeText | null;
  change_revealed_at?: string | null;
  official?: { open: boolean; reason: string };
  /** Where the published client connects. */
  wire?: { host: string; ports: number[] };
  /** The portal address for the client, the public repository, and the install command for the two packages (SPEC 6). */
  get?: { server: string; repo: string | null; install: string | null };
}

export interface MatchSummary {
  id: string;
  mode: string;
  tier: Tier;
  transport?: "ws" | "wire";
  started_at: string;
  ended_at: string | null;
  result: Result | null;
  scores: { you: number; maria: number } | null;
  replay: string;
  run_id: string | null;
  run_index: number | null;
  wire_quality?: WireQuality | null;
}

export interface Profile {
  novice: number;
  adept: number;
  master: number;
  composite: number;
  played: number;
}

export interface OfficialRun {
  id: string;
  started_at: string;
  finished_at: string | null;
  profile: Profile | null;
  matches: MatchSummary[];
}

export interface OfficialLive {
  id: string;
  tier: Tier;
  tick: number;
  run_index: number | null;
  scores?: { you: number; maria: number };
  strip?: string;
}

export interface OfficialStatus {
  attempts_left: number;
  official?: { open: boolean; reason: string };
  best: Profile | null;
  live: OfficialLive[];
  runs: OfficialRun[];
  /** The change, once revealed. */
  change?: RuleChangeText | null;
  change_revealed_at?: string | null;
}

export interface Submission {
  code_url: string | null;
  code_zip: boolean;
  /** The two answers (SPEC 2.3). */
  note: { built: string; noticed: string };
  submitted_at: string;
}

async function getJson<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, { credentials: "same-origin", ...init });
  if (!r.ok) {
    let message = "";
    try {
      message = ((await r.json()) as { message?: string }).message ?? "";
    } catch {
      /* not json */
    }
    throw new ApiError(path, r.status, message);
  }
  return (await r.json()) as T;
}

export class ApiError extends Error {
  constructor(
    readonly path: string,
    readonly status: number,
    readonly sentence: string,
  ) {
    super(sentence || `${path}: ${status}`);
  }
}

export const adminToken = {
  get(): string | null {
    try {
      return sessionStorage.getItem("bm.admin");
    } catch {
      return null;
    }
  },
  set(t: string | null): void {
    try {
      if (t) sessionStorage.setItem("bm.admin", t);
      else sessionStorage.removeItem("bm.admin");
    } catch {
      /* ignore */
    }
  },
};

export async function adminFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const t = adminToken.get() ?? "";
  return fetch(path, { ...init, headers: { ...(init.headers ?? {}), "x-admin-token": t } });
}

export const api = {
  me: () => getJson<Me>("/api/me"),
  matches: (limit = 50) => getJson<{ matches: MatchSummary[] }>(`/api/matches?limit=${limit}`),
  replay: (id: string) => getJson<ReplayDoc>(`/api/replay/${encodeURIComponent(id)}`),
  profile: (id: string) => getJson<{ match_id: string; profiler: ProfilerReport | null }>(`/api/profiler/${encodeURIComponent(id)}`),
  official: () => getJson<OfficialStatus>("/api/official"),
  /** Reveal the change: the Official page calls this when it opens (v6.3). Idempotent. */
  reveal: () => getJson<{ change: RuleChangeText | null; change_revealed_at: string | null }>("/api/official/reveal", { method: "POST" }),
  submission: () => getJson<{ submission: Submission | null; questions?: { built: string; noticed: string }; max_zip: number; max_answer_words: number }>("/api/submission"),
  doc: async (name: "rules" | "wire") => {
    const r = await fetch(`/api/${name}`);
    if (!r.ok) throw new Error(`${name} unavailable`);
    return r.text();
  },
};

export function wsUrl(path = "/ws"): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}${path}`;
}
