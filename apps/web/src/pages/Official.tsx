import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { RuleChangeText, ServerMsg, Tier } from "@blackmaria/protocol";
import { useAuth } from "../auth.js";
import { REDUCED_MOTION } from "../settings.js";
import { CLOCK_ENDED_SENTENCE, useClock } from "../clock.js";
import { api, wsUrl, type MatchSummary, type OfficialRun, type OfficialStatus, type Profile } from "../api.js";
import { ArenaView } from "../game/ArenaView.js";
import { WireStrip } from "../game/Board.js";
import { bus } from "../game/bus.js";
import { applyEnd, applyState, fromStart, type View } from "../game/view.js";
import { bestByTier } from "../game/layout.js";
import { AssetImg, Button, Card, Chip, ClockEnded, Corners, ErrorNote, Loading, ResultArt } from "../ui/kit.js";
import { confetti } from "../ui/decor.js";
import { clientCommand, useSetup } from "../ui/setup.js";

const TIERS: Tier[] = ["novice", "adept", "master"];
const WEIGHT: Record<Tier, number> = { novice: 1, adept: 3, master: 9 };
/** The rank mark on each tier badge (v6.3): the hardest tier wears the first mark. Shown once a match in it is won. */
export const RANK: Record<Tier, string> = { master: "ui_rank_1", adept: "ui_rank_2", novice: "ui_rank_3" };

/** The strength profile as badges: wins per tier, the composite out of 39 (SPEC 9). */
export function ProfileBadge(props: { profile: Profile; count?: boolean; matches?: MatchSummary[] }) {
  const best = props.matches ? bestByTier(props.matches) : {};
  const p = props.profile;
  const [shown, setShown] = useState(props.count && !REDUCED_MOTION ? 0 : p.composite);
  useEffect(() => {
    if (!props.count || REDUCED_MOTION) return setShown(p.composite);
    let raf = 0;
    const t0 = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / 1400);
      setShown(Math.round(p.composite * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [p.composite, props.count]);
  return (
    <div className="profile-badge">
      <span className="composite">
        <AssetImg name="ui_laurel" className="laurel" />
        <span className="composite-score">
          <span className="composite-num">{shown}</span>
          <span className="small"> / 39</span>
        </span>
      </span>
      <div className="badges">
        {TIERS.map((t, i) => (
          <div key={t} className={`badge-cell ${props.count ? "rise" : ""}`} style={{ animationDelay: `${600 + i * 300}ms` }}>
            <span className="badge-wrap">
              <AssetImg name={`badge_${t}`} className="badge-img" />
              {p[t] > 0 ? <AssetImg name={RANK[t]} alt={`${t} won`} className="rank-mark" /> : null}
            </span>
            <span className="mono small">
              {t} {p[t]} of 3 won × {WEIGHT[t]}
            </span>
            {best[t]?.scores ? (
              <Link className="mono small badge-best" to={best[t]!.replay}>
                best {best[t]!.scores!.you} – {best[t]!.scores!.maria}
              </Link>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

/** A run's result for its illustration: a win if you won more of its matches than Maria did, a loss if fewer. */
export function runOutcome(run: OfficialRun): "win" | "loss" | "draw" {
  const won = run.matches.filter((m) => m.result === "win").length;
  const lost = run.matches.filter((m) => m.result === "loss").length;
  return won > lost ? "win" : won < lost ? "loss" : "draw";
}

/** The nine slots of a run: three Novice, three Adept, three Master. */
function slots(run: OfficialRun | null): { index: number; tier: Tier; match: MatchSummary | null }[] {
  return Array.from({ length: 9 }, (_, index) => ({ index, tier: TIERS[Math.floor(index / 3)]!, match: run?.matches.find((m) => m.run_index === index) ?? null }));
}

/** Live views of the run's matches, from the portal's watch feed. */
function useLiveViews(enabled: boolean): Map<string, View> {
  const auth = useAuth();
  const [views, setViews] = useState<Map<string, View>>(new Map());
  useEffect(() => {
    if (!enabled || auth.status !== "ok") return;
    const ws = new WebSocket(wsUrl());
    ws.onopen = () => ws.send(JSON.stringify({ type: "hello", token: auth.me.token, name: "portal-official" }));
    ws.onmessage = (ev) => {
      let m: ServerMsg;
      try {
        m = JSON.parse(String(ev.data)) as ServerMsg;
      } catch {
        return;
      }
      if (m.type === "welcome") ws.send(JSON.stringify({ type: "watch" }));
      else if (m.type === "match_start" && m.mode === "official") setViews((vs) => new Map(vs).set(m.match_id, fromStart(m)));
      else if (m.type === "state")
        setViews((vs) => {
          const v = vs.get(m.match_id);
          return v ? new Map(vs).set(m.match_id, applyState(v, m)) : vs;
        });
      else if (m.type === "match_end")
        setViews((vs) => {
          const v = vs.get(m.match_id);
          return v ? new Map(vs).set(m.match_id, applyEnd(v, m)) : vs;
        });
      else if (m.type === "wire_status")
        setViews((vs) => {
          const v = vs.get(m.match_id);
          return v ? new Map(vs).set(m.match_id, { ...v, strip: m.strip, resyncs: m.resyncs }) : vs;
        });
    };
    return () => ws.close();
  }, [enabled, auth]);
  return views;
}

/**
 * The nine cards. While the run is in progress (`reserve`) every card keeps the room of a live one, its arena slot
 * included, so a row going live or finishing never moves the rows under it or the score inside the card.
 */
function RunCards(props: { run: OfficialRun | null; live: OfficialStatus["live"]; views: Map<string, View>; reserve?: boolean }) {
  const flipped = useRef(new Set<number>());
  return (
    <ol className={`run-cards ${props.reserve ? "reserve" : ""}`}>
      {slots(props.run).map((s) => {
        const live = props.live.find((l) => l.run_index === s.index);
        const view = live ? props.views.get(live.id) : undefined;
        const done = s.match?.result ?? null;
        if (done && !flipped.current.has(s.index)) {
          flipped.current.add(s.index);
          bus.emit({ kind: "official_match_end", index: s.index, result: done });
        }
        return (
          <li key={s.index} className={`run-card ${done ? `done ${done}` : live ? "live" : "waiting"}`}>
            <Corners />
            <div className="run-card-head">
              <AssetImg name={`badge_${s.tier}`} className="run-badge" />
              <span className="run-title">
                {s.tier} {(s.index % 3) + 1}
              </span>
              {done ? <Chip tone={done}>{done}</Chip> : live ? <Chip tone="live">tick {view?.tick ?? live.tick}</Chip> : <Chip tone="plain">waiting</Chip>}
            </div>
            {live && view && !done ? (
              <div className="run-thumb">
                <ArenaView view={view} compact />
              </div>
            ) : props.reserve ? (
              <div className="run-thumb" aria-hidden />
            ) : null}
            <div className="run-foot">
              <span className="run-score mono">{s.match?.scores ? `${s.match.scores.you} – ${s.match.scores.maria}` : view ? `${view.scores.you} – ${view.scores.maria}` : "–"}</span>
              {s.match?.wire_quality ? <span className="mono small">on time {(100 * s.match.wire_quality.on_time_rate).toFixed(1)}%</span> : null}
              {done && s.match ? (
                <Link className="small" to={s.match.replay}>
                  replay
                </Link>
              ) : null}
            </div>
            {view?.strip ? <WireStrip strip={view.strip} resyncs={view.resyncs ?? {}} maxTick={view.params.max_tick} compact /> : null}
          </li>
        );
      })}
    </ol>
  );
}

/** The simulator command that plays the change before you commit (SPEC 2.2): the exact flags. */
export function changeCommand(change: RuleChangeText): string {
  return change.id === 3 ? `npx @black-maria/sim wire ${change.flags}` : `npx @black-maria/sim play --vs master ${change.flags}`;
}

/** The change, as the Official page shows it the first time it opens (v6.3): the illustration, the rule, one sentence, the flags. */
function ChangeCard(props: { change: RuleChangeText }) {
  const c = props.change;
  return (
    <section className="change-card" aria-label="the change">
      <Corners />
      <AssetImg name="art_change" alt="Maria ringing a bell beside the cream fellow." className="change-art" />
      <div className="change-text">
        <span className="mono small eyebrow">the change for your official run</span>
        <h2>{c.rule}</h2>
        <p>{c.meaning}</p>
        <p className="small">Try it in the simulator first:</p>
        <pre className="cmd mono">{changeCommand(c)}</pre>
      </div>
    </section>
  );
}

/**
 * The official run (SPEC 5.7, 8.4, 8.5, v6.3): open from the start of the clock. The first open reveals the change,
 * shown here with what it means and the simulator flags; then one button and a confirmation; then nine cards filling
 * in live, three at a time; then the results reel.
 */
export function Official() {
  const setup = useSetup();
  const clock = useClock();
  const auth = useAuth();
  const [change, setChange] = useState<RuleChangeText | null>(null);
  const [st, setSt] = useState<OfficialStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [armed, setArmed] = useState(false);
  // The page draws once the reveal has answered too, so the change card never replaces a spinner and moves the page.
  const [revealed, setRevealed] = useState(false);
  const reeled = useRef(false);
  const started = useRef(false);
  // The first open of this page reveals the change (the server records when, once). Every open asks again; it is idempotent.
  const refreshMe = auth.status === "ok" ? auth.refresh : null;
  useEffect(() => {
    let live = true;
    api.reveal().then(
      (r) => {
        if (!live) return;
        setRevealed(true);
        if (!r.change) return;
        setChange(r.change);
        bus.emit({ kind: "change_revealed", id: r.change.id });
        refreshMe?.();
      },
      () => {
        /* the clock ran out: the page shows that instead */
        if (live) setRevealed(true);
      },
    );
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    let live = true;
    const load = () =>
      api.official().then(
        (s) => live && setSt(s),
        (e: Error) => live && setErr(e.message || "Couldn't load the official run. Retrying."),
      );
    void load();
    const t = setInterval(load, 2000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);
  const run = st?.runs[0] ?? null;
  const running = !!run && !run.finished_at;
  const views = useLiveViews(running || armed);
  if (!st || !revealed) return err ? <ErrorNote>{err}</ErrorNote> : <Loading label="loading the official run" />;
  const shown = change ?? st.change ?? null;
  const finished = !!run?.finished_at;
  if (running && !started.current) {
    started.current = true;
    bus.emit({ kind: "official_started" });
  }
  if (finished && !reeled.current) {
    reeled.current = true;
    bus.emit({ kind: "official_done" });
    if (run && runOutcome(run) === "win") void confetti();
  }

  if (finished && run?.profile) {
    const outcome = runOutcome(run);
    return (
      <div className="official-page" key="reel">
        <Card title="Your official run" className="reel" flat>
          <div className={`reel-head ${outcome === "draw" ? "no-art" : ""}`}>
            <ProfileBadge profile={run.profile} count matches={run.matches} />
            <ResultArt result={outcome} />
          </div>
          <RunCards run={run} live={[]} views={views} />
          <div className="row reel-actions">
            <Button tone="go" big to="/submit">
              Write the note and submit
            </Button>
          </div>
        </Card>
      </div>
    );
  }
  // The reel and the run in progress are keyed: each is a new view, not the open card moved and refilled.
  if (running) {
    return (
      <div className="official-page" key="running">
        <Card title="Official run in progress" flat>
          <p className="small">9 matches, 3 at a time, one tier after another. It runs to the end on its own. Your client just has to stay connected.</p>
          <RunCards run={run} live={st.live} views={views} reserve />
        </Card>
      </div>
    );
  }
  if (clock?.expired) return <ClockEnded sentence={CLOCK_ENDED_SENTENCE} />;
  const open = st.official?.open ?? clock?.officialOpen ?? false;
  if (st.attempts_left <= 0)
    return (
      <div className="center-page">
        <Card title="You've used your official run">
          <p>You only get one. Practice stays open until time&apos;s up.</p>
        </Card>
      </div>
    );
  if (!open) {
    return (
      <div className="center-page">
        <Card title="The official run is closed">
          <AssetImg name="art_locked" className="state-art" />
          <p>{st.official?.reason ?? "The official run had to start by minute 85."}</p>
          <p className="small">You can still practice and submit before minute 90.</p>
          <Button to="/submit">Write the note</Button>
        </Card>
      </div>
    );
  }
  return (
    <div className="center-page">
      {confirming ? (
        <Card title="Before you start" className="official-confirm">
          <ul className="confirm-list">
            <li>One shot, with the change{shown ? `: ${shown.rule}` : "."}</li>
            <li>9 matches: 3 per tier, 3 at a time.</li>
            <li>About 5 minutes.</li>
            <li>A win is worth 1 against Novice, 3 against Adept, 9 against Master. 39 max.</li>
            <li>Once it starts, it can&apos;t be stopped.</li>
            <li>Your clock keeps running.</li>
          </ul>
          <p>Your client plays it over the wire. Start it from your machine:</p>
          <pre className="cmd mono">{clientCommand(setup, "official")}</pre>
          <p className="small">This page fills in the 9 matches live once your client connects.</p>
          <div className="row">
            <Button tone="go" onClick={() => setArmed(true)}>
              {armed ? "Watching for your client" : "I'm starting it now"}
            </Button>
            <Button onClick={() => setConfirming(false)}>Not yet</Button>
          </div>
        </Card>
      ) : (
        <Card title="Official run's open" className="official-open">
          {shown ? <ChangeCard change={shown} /> : <Loading label="loading the change" />}
          <p>One shot, 9 matches, played by your client over the wire, with the change. Start it whenever you&apos;re ready, before minute 85.</p>
          <Button tone="go" big onClick={() => setConfirming(true)}>
            Start the official run
          </Button>
        </Card>
      )}
    </div>
  );
}
