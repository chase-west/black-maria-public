import type { Intent, ProfilerReport, ServerMsg, Tier } from "@blackmaria/protocol";
import { applyEnd, applyState, fromStart, type View } from "../game/view.js";
import { mergeConn } from "./conn.js";

/**
 * One practice slot: a match (or a run of matches in a row) from Start to the profiler, with Stop at any point. It
 * owns no browser APIs: the transport (a worker, the by-hand socket, the wire watch socket) is handed in, so the whole
 * lifecycle is testable with fakes.
 */

export type Mode = "starter" | "code" | "hand" | "wire";
export type Speed = 1 | 2 | 4;
export type Runs = 1 | 3 | 5;

export interface Settings {
  mode: Mode;
  tier: Tier;
  speed: Speed;
  /** Matches in a row (starter bot and your code only; the others always play 1). */
  runs: Runs;
  /** The source your code mode runs, as it was when you pressed Start. */
  code: string;
}

export interface TransportHandlers {
  server(m: ServerMsg): void;
  log(level: string, text: string): void;
  /** The transport closed (or its worker died) on its own. */
  closed(): void;
  /** A match it left has ended on the server, when no match_end could come over the transport itself. */
  replayReady?(matchId: string): void;
}

export interface Transport {
  /** Leave whatever is running so the server plays it out and writes its replay, then close within STOP_GRACE_MS. */
  stop(): void;
  /** Close everything now. */
  kill(): void;
  /** Leave a match this transport didn't ask for (an orphan the server handed back on hello). */
  leave(matchId: string): void;
  /** By hand: send a move. */
  submit?(intent: Intent): void;
}

export interface SlotDeps {
  open(s: Settings, h: TransportHandlers): Transport;
  fetchProfile(matchId: string): Promise<ProfilerReport | null>;
  log?(level: string, text: string): void;
  /** A match finished or was stopped (the page refreshes its list of matches). */
  onSettled?(): void;
  setTimer?(fn: () => void, ms: number): unknown;
  clearTimer?(id: unknown): void;
}

/**
 * idle: nothing yet. connecting: waiting for the match to start (or, on the wire, for your client). live: playing.
 * ending: the match just ended; its result and summary show for a moment. between: on to the next match in a row.
 * ended: the profiler. stopped: you pressed Stop. failed: it couldn't start, or the connection dropped.
 */
export type Phase = "idle" | "connecting" | "live" | "ending" | "between" | "ended" | "stopped" | "failed";

export interface SeriesResult {
  matchId: string;
  result: "win" | "loss" | "draw";
  you: number;
  maria: number;
}

export interface SlotState {
  phase: Phase;
  settings: Settings | null;
  view: View | null;
  report: ProfilerReport | null;
  results: SeriesResult[];
  /** The match on screen, or the one just finished or stopped. */
  matchId: string | null;
  /** The tick you stopped at, when you stopped mid-match. */
  stoppedAt: number | null;
  /** The stopped match has ended on the server, so its replay exists. */
  replayReady: boolean;
  /** One line on how the match went, shown before the profiler. */
  summary: string | null;
  error: string | null;
}

/** How long the result and its one-line summary show before the profiler or the next match. */
export const SUMMARY_MS = 1600;
/** The profiler follows match_end on the same socket; if it hasn't come by then, ask for it. */
export const PROFILE_WAIT_MS = 1500;
/** A stopped transport gets this long to leave cleanly before it closes anyway (transports enforce it). */
export const STOP_GRACE_MS = 3000;

export const BUSY: readonly Phase[] = ["connecting", "live", "between"];
export const isBusy = (p: Phase) => BUSY.includes(p);
/** Phases where Start (or Start again, or Play again) is on screen. */
export const canStart = (p: Phase) => p === "idle" || p === "ended" || p === "stopped" || p === "failed";

const IDLE: SlotState = { phase: "idle", settings: null, view: null, report: null, results: [], matchId: null, stoppedAt: null, replayReady: false, summary: null, error: null };

/** Errors are sentences with a next step (SPEC 8.5). */
export function errorSentence(code: string, message: string): string {
  switch (code) {
    case "too_many_concurrent":
      return "You've already got 2 practice matches running, maybe from your own client. Stop one, then start again.";
    case "rate_limited":
      return message || "You've hit the hourly practice limit. Wait a few minutes and try again.";
    case "clock_expired":
      return "Time's up, so practice is closed. Your submission and official results are kept.";
    case "window_closed":
      return "This cohort's window is closed, so practice is too.";
    case "server_busy":
      return "The server's full or restarting. Wait a few seconds and try again.";
    default:
      return message.endsWith(".") ? message : `${message}.`;
  }
}

const plural = (n: number) => (n === 1 ? "errand" : "errands");

/** The line between the result and the profiler: "you +41 · Maria +52 · 6 errands to 7". */
export function matchSummary(v: Pick<View, "scores" | "board">): string {
  const yours = v.board.filter((e) => e.state === "done_by_you").length;
  const hers = v.board.filter((e) => e.state === "done_by_maria").length;
  const errands = yours === hers ? `${yours} ${plural(yours)} each` : `${yours} ${plural(yours)} to ${hers}`;
  return `you +${v.scores.you} · Maria +${v.scores.maria} · ${errands}`;
}

/** A match in a row, the way the results strip shows it: "won 41–52". */
export function resultLabel(r: SeriesResult): string {
  return `${r.result === "win" ? "won" : r.result === "loss" ? "lost" : "draw"} ${r.you}–${r.maria}`;
}

const SKIP_ERRORS = new Set(["stale_tick", "duplicate_intent", "unknown_match"]);

export class Slot {
  private s: SlotState = IDLE;
  private readonly listeners = new Set<() => void>();
  private transport: Transport | null = null;
  /** Bumped for every transport, so a late message from an old one is ignored. */
  private gen = 0;
  private timers = new Set<unknown>();
  private summaryDone = false;
  private profileGaveUp = false;

  constructor(private readonly deps: SlotDeps) {}

  get state(): SlotState {
    return this.s;
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getState = (): SlotState => this.s;

  private set(patch: Partial<SlotState>): void {
    this.s = { ...this.s, ...patch };
    for (const l of this.listeners) l();
  }

  private timer(fn: () => void, ms: number): void {
    const set = this.deps.setTimer ?? ((f: () => void, m: number) => setTimeout(f, m));
    const id: unknown = set(() => {
      this.timers.delete(id);
      fn();
    }, ms);
    this.timers.add(id);
  }

  private clearTimers(): void {
    const clear = this.deps.clearTimer ?? ((id: unknown) => clearTimeout(id as ReturnType<typeof setTimeout>));
    for (const id of this.timers) clear(id);
    this.timers.clear();
  }

  /** Start a match (or a run of them) with these settings. Anything still running here is left first. */
  start(settings: Settings): void {
    this.abandon();
    const runs: Runs = settings.mode === "starter" || settings.mode === "code" ? settings.runs : 1;
    this.s = { ...IDLE, phase: "connecting", settings: { ...settings, runs } };
    this.begin();
  }

  /** Stop: leave the match (the server finishes it and keeps the replay), clear the arena, and offer Start again. */
  stop(): void {
    const p = this.s.phase;
    if (!isBusy(p) && p !== "ending") return;
    const t = this.transport;
    this.transport = null;
    this.clearTimers();
    // The stopped transport's own messages now only count for the replay link.
    this.stopGen = t ? this.gen : -1;
    this.gen++;
    t?.stop();
    // Mid-match, the replay exists once the server has finished the match without you; a match that already ended
    // (between two in a row, or showing its result) has it now.
    const matchId = this.s.matchId;
    this.set({ phase: "stopped", view: null, report: null, summary: null, matchId, stoppedAt: p === "live" ? (this.s.view?.tick ?? null) : null, replayReady: p !== "live" && matchId !== null, error: null });
    this.deps.onSettled?.();
  }

  /** Back to nothing, closing whatever is open (leaving the page, or closing the second slot). */
  dispose(): void {
    if (isBusy(this.s.phase)) this.stop();
    else this.abandon();
    this.set({ ...IDLE });
  }

  submit(intent: Intent): void {
    if (this.s.phase === "live") this.transport?.submit?.(intent);
  }

  /** A stopped transport still reports its match ending, which is when the replay exists. */
  private stopGen = -1;

  private abandon(): void {
    this.clearTimers();
    if (this.transport) {
      const t = this.transport;
      this.transport = null;
      if (isBusy(this.s.phase)) t.stop();
      else t.kill();
    }
    this.gen++;
  }

  private begin(): void {
    const settings = this.s.settings!;
    const g = ++this.gen;
    this.summaryDone = false;
    this.profileGaveUp = false;
    this.transport = this.deps.open(settings, {
      server: (m) => (g === this.gen ? this.onServer(m) : g === this.stopGen && m.type === "match_end" ? this.onStoppedEnd(m.match_id) : undefined),
      log: (level, text) => this.deps.log?.(level, text),
      closed: () => g === this.gen && this.onClosed(),
      replayReady: (id) => g === this.stopGen && this.onStoppedEnd(id),
    });
  }

  /** The match you stopped has ended on the server, so its replay exists. */
  private onStoppedEnd(matchId: string): void {
    if (this.s.phase !== "stopped" || matchId !== this.s.matchId || this.s.replayReady) return;
    this.set({ replayReady: true });
    this.deps.onSettled?.();
  }

  private onClosed(): void {
    const p = this.s.phase;
    this.transport = null;
    if (p === "connecting" || p === "live" || p === "between") {
      this.clearTimers();
      this.set({ phase: "failed", error: this.s.error ?? "Lost the connection to the server. Start again." });
      this.deps.onSettled?.();
    }
  }

  private onServer(m: ServerMsg): void {
    const s = this.s;
    switch (m.type) {
      case "match_start": {
        const waiting = s.phase === "connecting" || s.phase === "between";
        // On the wire your client may start another match after the last one ended.
        const wireNext = s.settings?.mode === "wire" && (s.phase === "ended" || s.phase === "ending");
        if (waiting || wireNext) {
          this.clearTimers();
          this.summaryDone = false;
          this.profileGaveUp = false;
          this.set({ phase: "live", view: fromStart(m), matchId: m.match_id, report: null, summary: null, error: null, ...(wireNext ? { results: [] } : {}) });
        } else if (m.match_id !== s.matchId && s.settings?.mode !== "wire") this.transport?.leave(m.match_id);
        return;
      }
      case "state":
        if (s.phase === "live" && s.view && s.view.matchId === m.match_id) this.set({ view: applyState(s.view, m) });
        return;
      case "wire_status":
        if (s.view && s.view.matchId === m.match_id)
          this.set({ view: { ...s.view, strip: m.strip, resyncs: m.resyncs, ...(m.conn ? { conn: mergeConn(s.view.conn, m.conn) } : {}), ...(m.conn_totals ? { connTotals: m.conn_totals } : {}) } });
        return;
      case "match_end": {
        if (s.phase !== "live" || !s.view || s.view.matchId !== m.match_id) return;
        const view = applyEnd(s.view, m);
        const results = [...s.results, { matchId: m.match_id, result: m.result, you: m.scores.you, maria: m.scores.maria }];
        this.set({ phase: "ending", view, results, summary: matchSummary(view) });
        this.timer(() => {
          this.summaryDone = true;
          this.advance();
        }, SUMMARY_MS);
        const id = m.match_id;
        this.timer(() => {
          if (this.s.report?.match_id === id) return;
          this.deps.fetchProfile(id).then(
            (r) => {
              if (this.s.matchId !== id) return;
              if (r) this.set({ report: r });
              else this.profileGaveUp = true;
              this.advance();
            },
            () => {
              if (this.s.matchId !== id) return;
              this.profileGaveUp = true;
              this.advance();
            },
          );
        }, PROFILE_WAIT_MS);
        return;
      }
      case "profile":
        if (m.report.match_id === s.matchId && (s.phase === "ending" || s.phase === "ended")) {
          this.set({ report: m.report });
          this.advance();
        }
        return;
      case "error": {
        if (SKIP_ERRORS.has(m.code)) return;
        const error = errorSentence(m.code, m.message);
        if (s.phase === "connecting" || s.phase === "between") {
          this.transport?.kill();
          this.transport = null;
          this.gen++;
          this.clearTimers();
          this.set({ phase: "failed", error });
          this.deps.onSettled?.();
        } else this.set({ error });
        return;
      }
      default:
        return;
    }
  }

  /** After a match: the next one in the row, or the profiler once its summary has had its moment. */
  private advance(): void {
    const s = this.s;
    if (s.phase !== "ending" || !this.summaryDone || !s.settings) return;
    const more = s.results.length < s.settings.runs;
    if (more) {
      // The next match gets a fresh transport; the old one closes on its own after the profiler, or now.
      this.transport?.kill();
      this.transport = null;
      this.set({ phase: "between" });
      this.deps.onSettled?.();
      this.begin();
      return;
    }
    if (!s.report && !this.profileGaveUp) return;
    this.clearTimers();
    this.set({ phase: "ended" });
    this.deps.onSettled?.();
  }
}
