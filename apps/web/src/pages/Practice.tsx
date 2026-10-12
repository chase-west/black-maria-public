import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { EditorView } from "@codemirror/view";
import type { Dir, Intent, Tier } from "@blackmaria/protocol";
import { useAuth } from "../auth.js";
import { api, type MatchSummary } from "../api.js";
import { CLOCK_ENDED_SENTENCE, useClock } from "../clock.js";
import { ArenaView } from "../game/ArenaView.js";
import { Board, Bodies, CaptionTicker, WireStrip } from "../game/Board.js";
import { ConnPanel } from "../game/ConnPanel.js";
import { ProfilerOverlay } from "../game/Profiler.js";
import { bus } from "../game/bus.js";
import { createEditor } from "../editor/codemirror.js";
import { STARTER_JS } from "../editor/starter.js";
import { isBusy, resultLabel, Slot, type Mode, type Runs, type Settings, type SlotState, type Speed } from "../practice/slot.js";
import { practiceKey, queuedNote } from "../practice/keys.js";
import { openTransport } from "../practice/transports.js";
import { AssetImg, Button, Card, Chip, ClockEnded, ErrorNote, Loading, ResultArt, Segmented, useConfirm } from "../ui/kit.js";
import { FixIt, clientCommand, useSetup } from "../ui/setup.js";

const MODES: readonly Mode[] = ["starter", "code", "hand", "wire"];
const MODE_LABEL: Record<Mode, string> = { starter: "starter bot", code: "your code", hand: "by hand", wire: "wire client" };
const STORE = "bm.editor.code";
const KEY_DIR: Record<string, Dir> = { ArrowUp: "N", ArrowRight: "E", ArrowDown: "S", ArrowLeft: "W" };
/** Two practice matches at once per token (the server's limit). */
const PARALLEL = 2;

function loadCode(): string {
  try {
    return localStorage.getItem(STORE) ?? STARTER_JS;
  } catch {
    return STARTER_JS;
  }
}

interface LogLine {
  level: string;
  text: string;
  n: number;
}

/** Your recent matches, newest first, each with its replay (the empty state has its illustration and one sentence). */
function RecentMatches(props: { refresh: number }) {
  const [list, setList] = useState<MatchSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    api.matches(8).then(
      (r) => setList(r.matches.filter((m) => m.ended_at)),
      () => setFailed(true),
    );
  }, [props.refresh]);
  if (failed) return <p className="small side-empty">Couldn&apos;t load your matches. Reload to try again.</p>;
  if (!list) return <Loading label="loading your matches" />;
  if (list.length === 0)
    return (
      <div className="side-empty">
        <AssetImg name="art_empty_matches" alt="The cream fellow sitting on a crate, waiting." className="state-art" />
        <p className="small">No matches yet. Your first one shows up here, with its replay.</p>
      </div>
    );
  return (
    <section className="board recent" aria-label="your matches">
      <h3 className="board-title">Your matches</h3>
      <ol className="recent-list">
        {list.map((m) => (
          <li key={m.id}>
            <Link className="recent-row" to={m.replay}>
              <Chip tone={m.result ?? "live"}>{m.result === "win" ? "won" : m.result === "loss" ? "lost" : "draw"}</Chip>
              <span className="mono small">
                vs {m.tier}
                {m.mode === "official" ? " · official" : m.transport === "wire" ? " · wire" : ""}
              </span>
              <span className="mono recent-score">{m.scores ? `${m.scores.you} – ${m.scores.maria}` : "–"}</span>
              <span className="small recent-link">replay</span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Matches in a row: one chip per match, played or still to come. */
function SeriesStrip(props: { state: SlotState }) {
  const s = props.state;
  const runs = s.settings?.runs ?? 1;
  if (runs < 2) return null;
  return (
    <ol className="series" aria-label="matches in a row">
      {Array.from({ length: runs }, (_, i) => {
        const r = s.results[i];
        const now = !r && i === s.results.length && isBusy(s.phase);
        return (
          <li key={i}>
            {r ? (
              <Link to={`/replay/${r.matchId}`} className="series-link">
                <Chip tone={r.result}>{resultLabel(r)}</Chip>
              </Link>
            ) : (
              <Chip tone="live">{now ? "playing" : `match ${i + 1}`}</Chip>
            )}
          </li>
        );
      })}
    </ol>
  );
}

const verdict = (r: "win" | "loss" | "draw") => (r === "win" ? "You won." : r === "draw" ? "Draw." : "You lost.");

/** Everything one slot shows over its arena, by phase. */
function SlotOverlay(props: { state: SlotState; mode: Mode; idle: React.ReactNode; onStart: () => void; onClose?: (() => void) | undefined; setup: ReturnType<typeof useSetup> }) {
  const s = props.state;
  const v = s.view;
  const runs = s.settings?.runs ?? 1;
  if (s.phase === "idle") return <div className="stage-overlay">{props.idle}</div>;
  if (s.phase === "connecting" && s.settings?.mode === "wire")
    return (
      <div className="stage-overlay">
        <Card title="Waiting for your client">
          <p>Nothing&apos;s playing on the wire for your token yet. Start a practice match from your client and it&apos;ll show up here.</p>
          <pre className="cmd mono">{clientCommand(props.setup, "play --vs novice")}</pre>
        </Card>
      </div>
    );
  if (s.phase === "stopped" && s.settings?.mode === "wire")
    return (
      <div className="stage-overlay">
        <Card title="Stopped watching.">
          <p>Your client&apos;s match keeps going. Watch again to pick it up.</p>
          <div className="row">
            <Button tone="go" onClick={props.onStart}>
              Watch again
            </Button>
            {s.matchId && s.replayReady ? <Button to={`/replay/${s.matchId}`}>Watch the replay</Button> : null}
          </div>
        </Card>
      </div>
    );
  if (s.phase === "stopped")
    return (
      <div className="stage-overlay">
        <Card title="Stopped.">
          <div className="end-card">
            <AssetImg name="art_empty_matches" alt="The cream fellow sitting on a crate, waiting." className="result-art" />
            <div>
              <p>
                {s.stoppedAt !== null ? `You left at tick ${s.stoppedAt}. Maria finished it on her own.` : s.matchId ? "Left between matches." : "Stopped before it started."}
                {runs > 1 ? ` ${s.results.length} of ${runs} played.` : ""}
              </p>
              <div className="row">
                <Button tone="go" onClick={props.onStart}>
                  Start again
                </Button>
                {s.matchId && s.replayReady ? <Button to={`/replay/${s.matchId}`}>Watch the replay</Button> : null}
                {props.onClose ? <Button onClick={props.onClose}>Close</Button> : null}
              </div>
              {s.matchId && !s.replayReady ? <p className="small mono">saving the replay</p> : null}
            </div>
          </div>
        </Card>
      </div>
    );
  if (s.phase === "failed")
    return (
      <div className="stage-overlay">
        <Card title="That didn't start.">
          <p>{s.error ?? "Lost the connection to the server. Start again."}</p>
          <div className="row">
            <Button tone="go" onClick={props.onStart}>
              Try again
            </Button>
            {props.onClose ? <Button onClick={props.onClose}>Close</Button> : null}
          </div>
        </Card>
      </div>
    );
  if (s.phase === "ended" && v?.end && s.report)
    return (
      <>
        <ProfilerOverlay report={s.report} onAgain={props.onStart} replay={`/replay/${v.matchId}`} />
        {props.onClose ? (
          <button className="btn slot-close" onClick={props.onClose}>
            Close
          </button>
        ) : null}
      </>
    );
  if ((s.phase === "ending" || s.phase === "ended" || s.phase === "between") && v?.end) {
    const last = s.results.length >= runs;
    return (
      <div className="stage-overlay">
        <Card title={verdict(v.end.result)}>
          <div className={`end-card ${v.end.result === "draw" ? "no-art" : ""}`}>
            <ResultArt result={v.end.result} />
            <div>
              <p className="mono summary-line">{s.summary}</p>
              {s.phase === "ended" ? (
                <>
                  <p className="small">No profiler for this one. The replay has everything.</p>
                  <div className="row">
                    <Button tone="go" onClick={props.onStart}>
                      Play again
                    </Button>
                    <Button to={`/replay/${v.matchId}`}>Watch the replay</Button>
                    {props.onClose ? <Button onClick={props.onClose}>Close</Button> : null}
                  </div>
                </>
              ) : last ? (
                <Loading label="adding it up" />
              ) : (
                <p className="small mono">
                  next: match {s.results.length + 1} of {runs}
                </p>
              )}
            </div>
          </div>
        </Card>
      </div>
    );
  }
  return null;
}

/** One practice slot: its arena, its captions and overlays, and (beside or under it) both of you and the board. */
function SlotPanel(props: {
  slot: Slot;
  label: string | null;
  duo: boolean;
  mode: Mode;
  idle: React.ReactNode;
  side: React.ReactNode;
  onStart: () => void;
  onClose?: (() => void) | undefined;
  picker: React.ReactNode;
  setup: ReturnType<typeof useSetup>;
}) {
  const s = useSyncExternalStore(props.slot.subscribe, props.slot.getState);
  const v = s.view;
  const busy = isBusy(s.phase);
  const head =
    props.duo || (s.settings?.runs ?? 1) > 1 ? (
      <div className="slot-head">
        {props.label ? <span className="slot-label mono">{props.label}</span> : null}
        {s.settings ? (
          <span className="mono small">
            {MODE_LABEL[s.settings.mode]} · {s.settings.tier} · {s.settings.speed}x
          </span>
        ) : null}
        <SeriesStrip state={s} />
        {props.duo && busy ? (
          <Button tone="stop" onClick={() => props.slot.stop()}>
            Stop
          </Button>
        ) : null}
      </div>
    ) : null;
  return (
    <div className={`pslot ${props.duo ? "duo" : ""}`}>
      {head}
      <div className={props.duo ? "slot-main" : "practice-main"}>
        <div className="stage">
          <ArenaView view={v} waiting={s.phase === "connecting" || s.phase === "between"} />
          {v && s.phase === "live" ? <CaptionTicker view={v} /> : null}
          <SlotOverlay state={s} mode={props.mode} idle={props.idle} onStart={props.onStart} onClose={props.onClose} setup={props.setup} />
          {props.picker}
        </div>
        <aside className="practice-side">
          {v && s.phase !== "stopped" ? (
            <>
              <Bodies view={v} />
              <Board view={v} />
            </>
          ) : (
            props.side
          )}
        </aside>
      </div>
      {v && v.conn ? <ConnPanel ticks={v.conn} totals={v.connTotals} network={v.params.chaos} /> : v && (s.settings?.mode === "wire" || v.strip) ? <WireStrip strip={v.strip ?? ""} resyncs={v.resyncs ?? {}} maxTick={v.params.max_tick} /> : null}
    </div>
  );
}

/**
 * Practice (SPEC 8): watch the starter bot, run your own code in this tab, play by hand, or point the live view at a
 * wire practice session your own client is playing. Every practice match ends with the profiler. Two can run at once
 * (the starter bot and your code), and either can play several matches in a row.
 */
export function Practice() {
  const auth = useAuth();
  const setup = useSetup();
  const clock = useClock();
  const [params, setParams] = useSearchParams();
  const initial = (params.get("watch") === "starter" ? "starter" : (params.get("mode") as Mode | null)) ?? "starter";
  const [mode, setModeState] = useState<Mode>(MODES.includes(initial) ? initial : "starter");
  const [tier, setTier] = useState<Tier>("novice");
  const [speed, setSpeed] = useState<Speed>(1);
  const [runs, setRuns] = useState<Runs>(1);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [picker, setPicker] = useState<"USE" | "DROP" | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [second, setSecond] = useState(false);
  const [confirmNode, confirm] = useConfirm();
  const editorHost = useRef<HTMLDivElement>(null);
  const editor = useRef<EditorView | null>(null);
  const code = useRef<string>(loadCode());
  const seq = useRef(0);
  const autostarted = useRef(false);
  const token = auth.status === "ok" ? auth.me.token : null;
  const tokenRef = useRef(token);
  tokenRef.current = token;

  const makeSlot = useCallback(
    (prefix: string) =>
      new Slot({
        open: (s, h) => openTransport(tokenRef.current ?? "", s, h),
        fetchProfile: (id) => api.profile(id).then((x) => x.profiler),
        log: (level, text) => setLogs((l) => [...l.slice(-200), { level, text: prefix + text, n: ++seq.current }]),
        onSettled: () => setRefresh((n) => n + 1),
      }),
    [],
  );
  const slotA = useMemo(() => makeSlot(""), [makeSlot]);
  const slotB = useMemo(() => makeSlot("[2] "), [makeSlot]);
  const a = useSyncExternalStore(slotA.subscribe, slotA.getState);
  const b = useSyncExternalStore(slotB.subscribe, slotB.getState);

  // The sound hook: match start and end, from either slot.
  useEffect(() => {
    const seen = new Map<Slot, string>();
    const watch = (slot: Slot) =>
      slot.subscribe(() => {
        const s = slot.getState();
        const key = `${s.matchId}:${s.phase}`;
        if (seen.get(slot) === key) return;
        seen.set(slot, key);
        if (s.phase === "live" && s.view?.tick === 0) bus.emit({ kind: "match_start" });
        if (s.phase === "ending" && s.view?.end) bus.emit({ kind: "match_end", result: s.view.end.result });
      });
    const offA = watch(slotA);
    const offB = watch(slotB);
    return () => {
      offA();
      offB();
    };
  }, [slotA, slotB]);

  const settings = (): Settings => ({ mode, tier, speed, runs, code: code.current });
  const startA = () => {
    if (!token) return;
    setPicker(null);
    slotA.start(settings());
  };
  const startB = () => {
    if (!token) return;
    setSecond(true);
    slotB.start(settings());
  };
  const closeB = () => {
    slotB.dispose();
    setSecond(false);
  };
  const stopAll = () => {
    slotA.stop();
    slotB.stop();
  };

  const busyA = isBusy(a.phase);
  const busyB = second && isBusy(b.phase);
  const anyBusy = busyA || busyB;
  const parallelOk = mode === "starter" || mode === "code";

  /** Switching mode mid-match asks first; tier, speed and the row count wait for the next match. */
  const setMode = async (m: Mode) => {
    if (m === mode) return;
    if (anyBusy && !(await confirm(`Stop the running match${busyA && busyB ? "es" : ""} and switch to ${MODE_LABEL[m]}?`))) return;
    slotA.dispose();
    if (second) closeB();
    setPicker(null);
    setModeState(m);
    setParams(m === "starter" ? {} : { mode: m }, { replace: true });
  };

  // The first sixty seconds (SPEC 8.4): from Start Here, one click and the starter is playing.
  useEffect(() => {
    if (autostarted.current || !token || mode !== "starter" || params.get("watch") !== "starter") return;
    autostarted.current = true;
    slotA.start({ mode: "starter", tier: "novice", speed: 1, runs: 1, code: STARTER_JS });
  }, [token, mode, params, slotA]);

  // The editor, when your code is showing.
  useEffect(() => {
    if (mode !== "code" || !editorHost.current) return;
    editor.current = createEditor(editorHost.current, code.current, (c) => {
      code.current = c;
      try {
        localStorage.setItem(STORE, c);
      } catch {
        /* storage blocked: the code lives until reload */
      }
    });
    return () => {
      editor.current?.destroy();
      editor.current = null;
    };
  }, [mode]);

  // Leaving the page leaves the matches (the server plays them out and keeps the replays).
  useEffect(
    () => () => {
      slotA.dispose();
      slotB.dispose();
      // A remount (React's development double mount included) may start the starter again.
      autostarted.current = false;
    },
    [slotA, slotB],
  );

  const send = useCallback((intent: Intent) => slotA.submit(intent), [slotA]);
  const handLive = mode === "hand" && a.phase === "live";

  // Keys for playing by hand.
  useEffect(() => {
    if (!handLive) return;
    const down = (e: KeyboardEvent) => {
      if (picker) {
        const inv = slotA.getState().view?.you.inventory ?? [];
        const n = Number(e.key);
        if (e.key === "Escape") setPicker(null);
        else if (n >= 1 && n <= inv.length) {
          send({ kind: picker, item: inv[n - 1]!.id });
          setPicker(null);
        }
        e.preventDefault();
        return;
      }
      const dir = KEY_DIR[e.key];
      if (dir) send({ kind: "MOVE", dir });
      else if (e.key === " ") send({ kind: "WAIT" });
      else if (e.key === "t" || e.key === "T") send({ kind: "TAKE" });
      else if (e.key === "s" || e.key === "S") send({ kind: "SNATCH" });
      else if (e.key === "u" || e.key === "U") setPicker("USE");
      else if (e.key === "d" || e.key === "D") setPicker("DROP");
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, [handLive, picker, send, slotA]);

  // Shortcuts: Enter starts (or starts again), Escape stops, 1 2 4 set the speed of the next match.
  const keyState = useRef({ startA, stopAll, setSpeed, a, picker, anyBusy });
  keyState.current = { startA, stopAll, setSpeed, a, picker, anyBusy };
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const k = keyState.current;
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT", "BUTTON", "A"].includes(t.tagName) || !!t.closest(".cm-editor, .modal"));
      const action = practiceKey(e.key, { typing, modifier: e.ctrlKey || e.metaKey || e.altKey, picker: k.picker !== null, phase: k.a.phase, anyBusy: k.anyBusy });
      if (!action) return;
      e.preventDefault();
      if (action.kind === "start") k.startA();
      else if (action.kind === "stop") k.stopAll();
      else k.setSpeed(action.speed);
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, []);

  const resetCode = async () => {
    if (!(await confirm("Replace your code with the starter bot?"))) return;
    editor.current?.dispatch({ changes: { from: 0, to: editor.current.state.doc.length, insert: STARTER_JS } });
    code.current = STARTER_JS;
  };

  const inv = a.view?.you.inventory ?? [];
  // Once the clock has ended, practice is closed; a match already on screen stays until it is left.
  if (clock?.expired && !a.view && !anyBusy)
    return (
      <ClockEnded sentence={CLOCK_ENDED_SENTENCE}>
        <Button to="/official">Your official run</Button>
      </ClockEnded>
    );

  const duo = second;
  const running = a.settings && busyA ? a.settings : b.settings && busyB ? b.settings : null;
  const note = running ? queuedNote(running, { tier, speed, runs, mode }) : null;
  const notes = [note, duo && busyA && busyB ? `${PARALLEL} at once is the limit. Stop one to start another.` : null].filter(Boolean).join(" · ");
  const idleTitle = mode === "wire" ? "Watch your own client" : mode === "hand" ? "Play by hand" : mode === "code" ? "Your bot runs here" : "Watch the starter bot";
  const idle = (
    <Card title={idleTitle}>
      {mode === "wire" ? (
        <>
          <p>Start a practice match from your client, then press Watch. Under the arena: what the network did to each tick&apos;s packets, and what became of your move.</p>
          <pre className="cmd mono">{clientCommand(setup, "play --vs novice")}</pre>
          <p className="small">
            Practice plays on that Maria&apos;s network, same as the official run. Add <code>--chaos off</code> for a clean link.
          </p>
          <p className="small">
            Without <code>--server</code> and <code>--token</code> (or a <code>.env</code> with them, see Simulator), the client plays a local simulator and nothing shows up here.
          </p>
          <FixIt setup={setup} />
        </>
      ) : mode === "hand" ? (
        <p>
          Arrows move. Space waits. <kbd>T</kbd> takes, <kbd>U</kbd> uses, <kbd>D</kbd> drops, <kbd>S</kbd> snatches. After <kbd>U</kbd> or <kbd>D</kbd>, press the item&apos;s number. The first key you press in a tick is your move. No key means wait.
        </p>
      ) : mode === "code" ? (
        <p>Your code runs in this tab. Edit it below. It saves as you type.</p>
      ) : (
        <p>The bot we gave you: nearest errand first, never snatches. Watch it race Maria, then make yours better.</p>
      )}
      <Button tone="go" big onClick={startA}>
        {mode === "wire" ? "Watch" : runs > 1 && parallelOk ? `Start ${runs} matches` : "Start a match"}
      </Button>
    </Card>
  );
  const pickerNode = picker ? (
    <div className="stage-overlay">
      <Card title={picker === "USE" ? "Use which item?" : "Drop which item?"}>
        {inv.length === 0 ? <p>You&apos;re not holding anything. Press Escape.</p> : null}
        <div className="picker">
          {inv.map((it, i) => (
            <button
              key={it.id}
              className="btn"
              onClick={() => {
                send({ kind: picker, item: it.id });
                setPicker(null);
              }}
            >
              <span className="mono">{i + 1}</span> <AssetImg name={`item_${it.kind}`} className="picker-icon" /> {it.kind}
            </button>
          ))}
        </div>
      </Card>
    </div>
  ) : null;

  return (
    <div className={`practice ${mode === "code" ? "code-mode" : ""} ${mode === "wire" ? "wire-mode" : ""} ${duo ? "duo-mode" : ""}`}>
      {confirmNode}
      <div className="practice-bar">
        <Segmented label="play" value={mode} options={MODES} onChange={(m) => void setMode(m)} format={(m) => MODE_LABEL[m]} />
        {mode !== "wire" ? <Segmented label="against" value={tier} options={["novice", "adept", "master"] as const} onChange={setTier} /> : null}
        {mode !== "wire" ? <Segmented label="speed" value={speed} options={[1, 2, 4] as const} onChange={setSpeed} format={(s) => `${s}x`} /> : null}
        {parallelOk ? <Segmented label="in a row" value={runs} options={[1, 3, 5] as const} onChange={setRuns} /> : null}
      </div>
      {/* The match buttons and the notes have a row of their own, always there, so the arena never moves when a match starts or ends. */}
      <div className="practice-actions">
        <div className="practice-buttons">
          {!duo && busyA ? (
            <Button tone="stop" onClick={() => slotA.stop()}>
              {mode === "wire" ? "Stop watching" : "Stop"}
            </Button>
          ) : null}
          {parallelOk && busyA && !second ? <Button onClick={startB}>Start a second match</Button> : null}
          {duo && busyA && busyB ? (
            <Button tone="stop" onClick={stopAll}>
              Stop both
            </Button>
          ) : null}
        </div>
        {notes ? <p className="practice-note mono small">{notes}</p> : null}
        <p className="practice-keys mono small" aria-hidden="true">
          enter start · esc stop · 1 2 4 speed
        </p>
      </div>
      {a.error && a.phase !== "failed" ? <ErrorNote>{a.error}</ErrorNote> : null}
      {second && b.error && b.phase !== "failed" ? <ErrorNote>match B: {b.error}</ErrorNote> : null}
      <div className={duo ? "practice-duo" : ""}>
        <SlotPanel slot={slotA} label={duo ? "match A" : null} duo={duo} mode={mode} idle={idle} side={<RecentMatches refresh={refresh} />} onStart={startA} picker={pickerNode} setup={setup} />
        {duo ? <SlotPanel slot={slotB} label="match B" duo mode={mode} idle={null} side={null} onStart={startB} onClose={closeB} picker={null} setup={setup} /> : null}
      </div>
      {handLive ? (
        <div className="hand-pad">
          <Button onClick={() => send({ kind: "MOVE", dir: "N" })}>N</Button>
          <Button onClick={() => send({ kind: "MOVE", dir: "W" })}>W</Button>
          <Button onClick={() => send({ kind: "WAIT" })}>wait</Button>
          <Button onClick={() => send({ kind: "MOVE", dir: "E" })}>E</Button>
          <Button onClick={() => send({ kind: "MOVE", dir: "S" })}>S</Button>
          <Button onClick={() => send({ kind: "TAKE" })}>take</Button>
          <Button onClick={() => setPicker("USE")}>use</Button>
          <Button onClick={() => setPicker("DROP")}>drop</Button>
          <Button onClick={() => send({ kind: "SNATCH" })}>snatch</Button>
        </div>
      ) : null}
      {mode === "code" ? (
        <div className="code-panel">
          <div className="row">
            <Button onClick={() => void resetCode()}>Back to the starter</Button>
            <span className="small">Saved in this browser as you type. A match uses the code as it was when it started.</span>
          </div>
          <div className="code card" ref={editorHost} />
          <div className="console card">
            {logs.length === 0 ? <span className="mono small">console: your bot&apos;s logs show up here.</span> : null}
            {logs.map((l) => (
              <div key={l.n} className={`log ${l.level}`}>
                {l.text}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

