import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { ProfilerLineKey, ProfilerReport } from "@blackmaria/protocol";
import { AssetImg, Button, Corners, ResultArt } from "../ui/kit.js";
import { bus } from "./bus.js";
import { REDUCED_MOTION } from "../settings.js";

export const TITLES: Record<ProfilerLineKey, string> = {
  completed: "Errands you completed",
  maria_first: "Errands Maria took first",
  expired_heading: "Expired on your way there",
  never_attempted: "Points you never went for",
  idle: "Idle ticks",
  network: "Ticks lost to the network",
  snatches: "Snatches",
  energy_unused: "Energy left at the end",
};
const ICONS: Record<ProfilerLineKey, string> = {
  completed: "icon_done",
  maria_first: "icon_taken",
  expired_heading: "icon_expired",
  never_attempted: "icon_untouched",
  idle: "icon_idle",
  network: "icon_network",
  snatches: "icon_snatch",
  energy_unused: "icon_unused",
};
const ORDER: ProfilerLineKey[] = ["completed", "maria_first", "expired_heading", "never_attempted", "idle", "network", "snatches", "energy_unused"];

/** A number that counts up from 0 when it appears. */
function Count(props: { to: number; delay: number }) {
  const [n, setN] = useState(REDUCED_MOTION ? props.to : 0);
  useEffect(() => {
    if (REDUCED_MOTION) return setN(props.to);
    let raf = 0;
    const t0 = performance.now() + props.delay;
    const tick = (now: number) => {
      const k = Math.max(0, Math.min(1, (now - t0) / 600));
      setN(Math.round(props.to * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [props.to, props.delay]);
  return <>{n}</>;
}

/** How much each line cost you, in points, to pick the biggest problem. */
function cost(r: ProfilerReport, k: ProfilerLineKey): number {
  switch (k) {
    case "maria_first":
      return r.maria_first.value;
    case "expired_heading":
      return r.expired_heading.value;
    case "never_attempted":
      return r.never_attempted.value * 0.5;
    case "idle":
      return r.idle.ticks / 12;
    case "network":
      return r.network.ticks / 4 + r.network.resyncs;
    case "snatches":
      return r.snatches.against.value - r.snatches.for.value;
    case "energy_unused":
      return r.energy_unused >= 60 ? 3 : 0;
    default:
      return -Infinity;
  }
}

export function biggestProblem(r: ProfilerReport): ProfilerLineKey {
  let best: ProfilerLineKey = "maria_first";
  for (const k of ORDER) if (cost(r, k) > cost(r, best)) best = k;
  return best;
}

function line(r: ProfilerReport, k: ProfilerLineKey): { main: number; unit: string; detail: string } {
  switch (k) {
    case "completed":
      return { main: r.completed.value, unit: "points", detail: `${r.completed.count} errands` };
    case "maria_first": {
      const behind = r.maria_first.errands.filter((e) => e.ticks_behind != null).map((e) => e.ticks_behind!);
      const avg = behind.length ? Math.round(behind.reduce((a, b) => a + b, 0) / behind.length) : null;
      return { main: r.maria_first.value, unit: "points", detail: `${r.maria_first.count} errands${avg !== null ? `, about ${avg} ticks behind` : ""}` };
    }
    case "expired_heading":
      return { main: r.expired_heading.value, unit: "points", detail: `${r.expired_heading.count} errands` };
    case "never_attempted":
      return { main: r.never_attempted.value, unit: "points", detail: `${r.never_attempted.count} errands you never moved toward` };
    case "idle":
      return { main: r.idle.ticks, unit: "ticks", detail: "WAIT, or a move that changed nothing" };
    case "network":
      return { main: r.network.ticks, unit: "ticks", detail: `${r.network.late} late, ${r.network.missing} missing, ${r.network.malformed} malformed, ${r.network.resyncs} resyncs` };
    case "snatches":
      return { main: r.snatches.for.count, unit: `for, ${r.snatches.against.count} against`, detail: `value swung +${r.snatches.for.value} / −${r.snatches.against.value}` };
    case "energy_unused":
      return { main: r.energy_unused, unit: "energy", detail: "unspent when the match ended" };
  }
}

/**
 * The profiler (SPEC 8.3, 8.4): over the arena the instant a practice match ends, cards sliding in one by one with
 * their numbers counting up, the biggest problem highlighted and linked to its heading under "What strong bots do".
 */
export function ProfilerOverlay(props: { report: ProfilerReport; onAgain?: () => void; onClose?: () => void; replay?: string }) {
  const r = props.report;
  const worst = biggestProblem(r);
  useEffect(() => bus.emit({ kind: "profiler_shown" }), [r.match_id]);
  const verdict = r.result === "win" ? "You won" : r.result === "draw" ? "Draw" : "You lost";
  return (
    <div className="profiler" role="dialog" aria-label="the profiler">
      <div className={`profiler-head ${r.result === "draw" ? "" : "with-art"}`}>
        <ResultArt result={r.result} />
        <div>
          <h2>
            {verdict}, {r.scores.you} to {r.scores.maria}.
          </h2>
          <p className="small">Where your points went. The yellow card is what to build next.</p>
        </div>
      </div>
      <ol className="profiler-cards">
        {ORDER.map((k, i) => {
          const l = line(r, k);
          const hot = k === worst;
          return (
            <li key={k} className={`pcard ${hot ? "hot" : ""}`} style={{ animationDelay: `${i * 110}ms` }}>
              <Corners />
              <AssetImg name={ICONS[k]} className="pcard-icon" />
              <div className="pcard-body">
                <span className="pcard-title">{TITLES[k]}</span>
                <span className="pcard-num">
                  <Count to={l.main} delay={i * 110 + 150} /> <span className="small">{l.unit}</span>
                </span>
                <span className="pcard-detail small">{l.detail}</span>
                <Link className="pcard-link small" to={`/rules#${r.links[k].anchor}`}>
                  {hot ? "Build this next: " : ""}
                  {r.links[k].heading}
                </Link>
              </div>
            </li>
          );
        })}
      </ol>
      <div className="row profiler-actions">
        {props.onAgain ? (
          <Button tone="go" onClick={props.onAgain}>
            Play again
          </Button>
        ) : null}
        {props.replay ? <Button to={props.replay}>Watch the replay</Button> : null}
        {props.onClose ? <Button onClick={props.onClose}>Close</Button> : null}
      </div>
    </div>
  );
}
