import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import type { ReplayDoc } from "@blackmaria/protocol";
import { api } from "../api.js";
import { ArenaView } from "../game/ArenaView.js";
import { Board, Bodies, CaptionTicker, WireStrip } from "../game/Board.js";
import { ConnPanel } from "../game/ConnPanel.js";
import { connWindow } from "../practice/conn.js";
import { fromReplay } from "../game/view.js";
import { intentWords } from "../game/words.js";
import { AssetImg, Button, Card, ClockEnded, Loading, Segmented } from "../ui/kit.js";
import { CLOCK_ENDED_SENTENCE, useClock } from "../clock.js";

/** Replay viewer: the server expands the log into frames; this only shows them. The scrubber is instant. */
export function ReplayView(props: { doc: ReplayDoc; extra?: ReactNode }) {
  const { doc } = props;
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(8);
  const last = doc.frames.length - 1;
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => setI((x) => (x >= last ? x : x + 1)), 1000 / speed);
    return () => clearInterval(t);
  }, [playing, speed, last]);
  useEffect(() => {
    if (i >= last) setPlaying(false);
  }, [i, last]);
  // Keys: Space plays and pauses, the arrows step a tick (never while you type in a field).
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.ctrlKey || e.metaKey || e.altKey || (t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT", "BUTTON", "A"].includes(t.tagName)))) return;
      const step = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0;
      if (step) {
        setPlaying(false);
        setI((x) => Math.max(0, Math.min(last, x + step)));
      } else if (e.key === " ") setPlaying((p) => !p);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, [last]);
  const view = useMemo(() => fromReplay(doc, i), [doc, i]);
  const end = view.end ? `${view.end.result === "win" ? "you won" : view.end.result === "draw" ? "draw" : "you lost"} ${view.end.scores.you}–${view.end.scores.maria}` : null;
  return (
    <div className="replay-page">
      <div className="practice-main">
        <div className="stage">
          <ArenaView view={view} animate={playing && speed <= 8} />
          <CaptionTicker view={view} />
        </div>
        <aside className="practice-side">
          <Bodies view={view} />
          <Board view={view} />
        </aside>
      </div>
      {doc.conn_timeline ? (
        <ConnPanel ticks={connWindow(doc.conn_timeline, view.strip?.length ?? 0)} totals={doc.conn_totals} network={doc.params.chaos} />
      ) : doc.transport === "wire" ? (
        <WireStrip strip={view.strip ?? ""} resyncs={doc.resyncs} maxTick={doc.params.max_tick} />
      ) : null}
      <div className="scrub card">
        <div className="scrub-head">
          <span className="display scrub-title">
            Replay: {doc.mode} against {doc.tier}
          </span>
          <span className="mono scrub-tick">
            tick {view.tick} of {doc.params.max_tick}
            {end ? ` · ${end}` : ""}
          </span>
        </div>
        <input type="range" min={0} max={last} value={i} onChange={(e) => setI(Number(e.target.value))} aria-label="tick" />
        <div className="row">
          <Button onClick={() => setI((x) => Math.max(0, x - 1))}>Back a tick</Button>
          <Button tone="go" onClick={() => (i >= last ? (setI(0), setPlaying(true)) : setPlaying((p) => !p))}>
            {playing ? "Pause" : i >= last ? "Play again" : "Play"}
          </Button>
          <Button onClick={() => setI((x) => Math.min(last, x + 1))}>Forward a tick</Button>
          <Segmented label="ticks a second" value={speed} options={[2, 4, 8, 16, 32] as const} onChange={setSpeed} />
          <span className="mono small">
            space plays · arrows step · {doc.transport === "wire" ? "over the wire" : "over the WebSocket"}
            {doc.reviewer && view.yourIntent !== undefined ? ` · you: ${view.yourIntent ? intentWords(view.yourIntent) : "-"} · Maria: ${view.mariaIntent ? intentWords(view.mariaIntent) : "-"}` : ""}
          </span>
        </div>
      </div>
      {props.extra}
    </div>
  );
}

export function Replay() {
  const { id } = useParams();
  const [doc, setDoc] = useState<ReplayDoc | null>(null);
  const [err, setErr] = useState(false);
  const clock = useClock();
  useEffect(() => {
    if (id) api.replay(id).then(setDoc, () => setErr(true));
  }, [id]);
  // The server closes replays with the clock (SPEC 7).
  if (err && clock?.expired) return <ClockEnded sentence={CLOCK_ENDED_SENTENCE} />;
  if (err)
    return (
      <div className="center-page">
        <Card title="Replay not found.">
          <AssetImg name="art_404" alt="The cream fellow in an empty doorway." className="state-art" />
          <p>It&apos;s someone else&apos;s, or the match stopped before it ended. Your finished matches are on Practice.</p>
          <Button to="/practice">Go to Practice</Button>
        </Card>
      </div>
    );
  if (!doc) return <Loading label="loading the replay" />;
  return <ReplayView doc={doc} />;
}
