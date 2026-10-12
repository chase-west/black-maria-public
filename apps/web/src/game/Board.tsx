import { useEffect, useRef, useState } from "react";
import type { Errand, HeldItem } from "@blackmaria/protocol";
import { AssetImg, Corners } from "../ui/kit.js";
import { errandTitle, type View } from "./view.js";
import { isNewErrand, tickerLines } from "./layout.js";
import { REDUCED_MOTION } from "../settings.js";

const ICON: Record<Errand["type"], string> = { deliver: "icon_deliver", visit: "icon_visit", carry: "icon_carry" };
/** Resolved cards stay on the board this many ticks before they leave. */
const LINGER = 18;
/** The expiry bar turns coral in an errand's last 20 ticks (SPEC 8.4). */
const URGENT = 20;

/**
 * The board (SPEC 8.2): every open errand as a note card with its icon, value and a shrinking expiry bar. Cards flip
 * mustard when you complete them, lilac when Maria does, and fade when they expire. New cards drop in.
 */
export function Board(props: { view: View }) {
  const v = props.view;
  const resolvedAt = useRef(new Map<number, number>());
  const seen = useRef(new Set<number>());
  const matchRef = useRef(v.matchId);
  if (matchRef.current !== v.matchId) {
    matchRef.current = v.matchId;
    resolvedAt.current.clear();
    seen.current.clear();
  }
  const cards: { e: Errand; fresh: boolean; flipped: boolean }[] = [];
  for (const e of v.board) {
    if (e.posted > v.tick) continue;
    let fresh = false;
    if (!seen.current.has(e.id)) {
      seen.current.add(e.id);
      fresh = v.tick > 0;
    }
    if (e.state !== "open") {
      if (!resolvedAt.current.has(e.id)) resolvedAt.current.set(e.id, v.tick);
      const at = resolvedAt.current.get(e.id)!;
      if (v.tick - at > LINGER) continue;
      cards.push({ e, fresh, flipped: true });
    } else cards.push({ e, fresh, flipped: false });
  }
  // Open first (soonest expiry first), then the ones just resolved.
  cards.sort((a, b) => Number(a.flipped) - Number(b.flipped) || (a.flipped ? b.e.id - a.e.id : a.e.expires - b.e.expires));
  return (
    <section className="board" aria-label="the board">
      <Corners />
      <h3 className="board-title">
        The board <span className="mono small">tick {v.tick} of {v.params.max_tick}</span>
      </h3>
      <ol className="cards">
        {cards.map(({ e, fresh, flipped }) => {
          const life = Math.max(1, e.expires - e.posted);
          const left = Math.max(0, e.expires - v.tick);
          const tone = e.state === "done_by_you" ? "you" : e.state === "done_by_maria" ? "maria" : e.state === "expired" ? "gone" : "open";
          return (
            <li key={`${v.matchId}-${e.id}`} className={`errand ${tone} ${fresh ? "drop-in" : ""} ${flipped ? "flip" : ""}`}>
              <AssetImg name={ICON[e.type]} className="errand-icon" />
              {isNewErrand(e, v.tick) ? <AssetImg name="sticker_new" alt="new" className="errand-new" /> : null}
              <span className="errand-text">{errandTitle(v, e)}</span>
              <span className="errand-value">
                {e.value}
              </span>
              {flipped ? (
                <span className="errand-caption">{tone === "you" ? `yours, +${e.value}` : tone === "maria" ? `Maria's, +${e.value}` : "expired"}</span>
              ) : (
                <span className={`expiry ${left <= URGENT ? "urgent" : ""}`}>
                  <span className="expiry-fill" style={{ width: `${(100 * left) / life}%` }} />
                </span>
              )}
            </li>
          );
        })}
        {cards.length === 0 ? <li className="errand empty">Nothing on the board right now.</li> : null}
      </ol>
    </section>
  );
}

/** A portrait inside the `ui_portrait_frame` plate (the plate's circle is its outline). */
function Portrait(props: { name: string }) {
  return (
    <span className="portrait-frame">
      <AssetImg name="ui_portrait_frame" className="portrait-plate" />
      <AssetImg name={props.name} className="portrait" />
    </span>
  );
}

function Slots(props: { items: HeldItem[]; slots: number }) {
  return (
    <div className="slots">
      {Array.from({ length: props.slots }, (_, i) => {
        const it = props.items[i];
        return (
          <span key={i} className={`slot ${it ? "full" : ""}`}>
            {it ? <AssetImg name={`item_${it.kind}`} alt={it.kind} /> : null}
          </span>
        );
      })}
    </div>
  );
}

/** Energy, with the snatch line marked (SPEC 8.2). Maria's shows as unknown unless a reviewer is watching. */
function Energy(props: { energy: number | null; snatch: number; who: "you" | "maria" }) {
  const e = props.energy;
  return (
    <div className={`energy ${props.who}`}>
      <AssetImg name="icon_energy" className="energy-icon" />
      <div className="energy-bar" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={e ?? undefined} aria-label={`${props.who} energy`}>
        {e === null ? <span className="energy-unknown">unknown</span> : <span className="energy-fill" style={{ width: `${Math.min(100, e)}%` }} />}
        <span className="snatch-line" style={{ left: `${Math.min(100, props.snatch)}%` }} />
      </div>
      <span className="energy-num mono">{e === null ? "?" : e}</span>
      <span className="energy-key mono">energy · snatch at {props.snatch}</span>
    </div>
  );
}

/** A score that counts up when points land, with a small hop. A new match (a lower score) just shows the number. */
export function ScoreTicker(props: { value: number }) {
  const [shown, setShown] = useState(props.value);
  const [hop, setHop] = useState(0);
  const from = useRef(props.value);
  useEffect(() => {
    const start = from.current;
    const to = props.value;
    from.current = to;
    if (REDUCED_MOTION || to <= start) {
      setShown(to);
      return;
    }
    setHop((h) => h + 1);
    let raf = 0;
    const t0 = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / 420);
      setShown(Math.round(start + (to - start) * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [props.value]);
  return (
    <span key={hop} className={`body-score ${hop ? "hop" : ""}`}>
      {shown}
    </span>
  );
}

/** Both bodies side by side: portraits, scores, energy, and what each carries. */
export function Bodies(props: { view: View }) {
  const v = props.view;
  const slots = v.params.inventory_slots;
  const leading = v.scores.you > v.scores.maria ? "you" : v.scores.maria > v.scores.you ? "maria" : null;
  const row = (who: "you" | "maria") => (
    <div className={`body-row ${who} ${leading === who ? "leading" : ""}`}>
      <Corners />
      <div className="body-head">
        <Portrait name={who === "you" ? "portrait_you" : `portrait_maria_${v.tier}`} />
        <span className="body-title">
          <span className="body-name">{who === "you" ? "You" : "Maria"}</span>
          <ScoreTicker value={v.scores[who]} />
        </span>
      </div>
      <Energy energy={who === "you" ? v.you.energy : (v.mariaEnergy ?? null)} snatch={v.params.snatch_cost} who={who} />
      <Slots items={who === "you" ? v.you.inventory : v.maria.inventory} slots={slots} />
    </div>
  );
  return (
    <section className="bodies" aria-label="you and Maria">
      {row("you")}
      {row("maria")}
    </section>
  );
}

/**
 * What just happened, over the arena (SPEC 8.4: "a short caption"): the newest lines pop in at the bottom and leave
 * after a few ticks, so the moment is where the eyes already are.
 */
export function CaptionTicker(props: { view: View }) {
  const shown = tickerLines(props.view.captions, props.view.tick);
  return (
    <ol className="ticker" aria-live="polite">
      {shown.map((c) => (
        <li key={c.n} className={`ticker-line ${c.tone}`}>
          {c.text}
        </li>
      ))}
    </ol>
  );
}

/** What just happened, newest first. */
export function Captions(props: { view: View }) {
  return (
    <ol className="captions" aria-live="polite">
      {props.view.captions
        .slice(-6)
        .reverse()
        .map((c) => (
          <li key={c.n} className={`caption ${c.tone}`}>
            <span className="mono small">{c.tick}</span> {c.text}
          </li>
        ))}
    </ol>
  );
}

/** The wire health strip (SPEC 8): one mark per tick, on time, late, missing or malformed, and resyncs. */
export function WireStrip(props: { strip: string; resyncs?: Record<number, number>; maxTick: number; compact?: boolean }) {
  const marks = [...props.strip];
  const count = (c: string) => marks.filter((m) => m === c).length;
  const rs = Object.values(props.resyncs ?? {}).reduce((a, b) => a + b, 0);
  return (
    <div className={`wire-strip ${props.compact ? "compact" : ""}`} aria-label="wire health">
      <div className="strip-marks">
        {marks.map((m, i) => (
          <span key={i} className={`mark m-${m} ${props.resyncs?.[i] ? "resync" : ""}`} style={{ left: `${(100 * i) / props.maxTick}%` }} />
        ))}
      </div>
      {props.compact ? null : (
        <div className="strip-legend mono small">
          <span className="key m-o" /> on time {count("o")} <span className="key m-l" /> late {count("l")} <span className="key m-m" /> missing {count("m")} <span className="key m-x" /> malformed {count("x")} · resyncs {rs}
        </div>
      )}
    </div>
  );
}
