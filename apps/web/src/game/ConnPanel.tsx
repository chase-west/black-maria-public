import { useState } from "react";
import type { ChaosName, ConnTick, ConnTotals } from "@blackmaria/protocol";
import { CONN_TICKS, netClass, tickLabels, youClass } from "../practice/conn.js";

const LEGEND: readonly (readonly [string, string])[] = [
  ["n-delayed-key", "delayed"],
  ["n-dropped", "dropped"],
  ["n-duplicated", "duplicated"],
  ["n-reordered", "reordered"],
  ["n-blackout", "blackout"],
  ["m-o", "on time"],
  ["m-l", "late"],
  ["m-m", "missing"],
  ["m-x", "malformed"],
];

/** The longest delay the chaos layer adds (Master), for the height of a delayed tick's bar. */
const DELAY_MAX = 70;

/** The panel's header: the profile on this match's link, so a clean run never passes for a lossy one. */
export const networkHeader = (chaos: ChaosName): string => (chaos === "off" ? "network: off, clean link" : `network: ${chaos}`);

/**
 * The connection panel under the arena (wire matches only): which network profile the match is on, the last 100
 * ticks, what the network did to each tick's packets on top, what became of your move below, the selected tick's
 * labels, and the match's totals.
 */
export function ConnPanel(props: { ticks: readonly ConnTick[]; totals?: ConnTotals | undefined; network: ChaosName }) {
  const [hover, setHover] = useState<number | null>(null);
  const [pinned, setPinned] = useState<number | null>(null);
  const ticks = props.ticks.slice(-CONN_TICKS);
  const pick = pinned ?? hover;
  const sel = ticks.find((t) => t.tick === pick) ?? ticks[ticks.length - 1] ?? null;
  const labels = sel ? tickLabels(sel) : null;
  const tt = props.totals;
  const cells = (row: "net" | "you") =>
    ticks.map((t) => (
      <span
        key={t.tick}
        className={`conn-cell ${row === "net" ? netClass(t) : youClass(t)} ${row === "you" && t.resyncs ? "resync" : ""} ${sel?.tick === t.tick ? "sel" : ""}`}
        style={row === "net" && t.state?.fate === "delayed" ? { ["--h" as string]: `${Math.min(100, 20 + (80 * t.state.delay) / DELAY_MAX)}%` } : undefined}
        onMouseEnter={() => setHover(t.tick)}
        onClick={() => setPinned((p) => (p === t.tick ? null : t.tick))}
      />
    ));
  return (
    <section className="conn-panel" aria-label="the connection">
      <h2 className="conn-network mono" style={{ gridColumn: "1 / -1", margin: 0 }}>
        {networkHeader(props.network)}
      </h2>
      <div className="conn-main">
        <div className="conn-rows" onMouseLeave={() => setHover(null)}>
          <span className="conn-label mono small">network</span>
          <div className="conn-cells">{cells("net")}</div>
          <span className="conn-label mono small">your move</span>
          <div className="conn-cells">{cells("you")}</div>
        </div>
        <p className="conn-sel mono small" aria-live="polite">
          {sel && labels ? (
            <>
              <b>tick {sel.tick}</b> · {labels.network} · <b>{labels.you}</b>
              {pinned !== null ? " · pinned" : ""}
            </>
          ) : (
            "no ticks yet"
          )}
        </p>
        <div className="strip-legend mono small">
          {LEGEND.map(([cls, word]) => (
            <span key={word} className="conn-key">
              <span className={`key ${cls}`} /> {word}
            </span>
          ))}
        </div>
      </div>
      {tt ? (
        <dl className="conn-totals mono small">
          <dt>network</dt>
          <dd>
            {tt.packets} packets · {tt.dropped} dropped · {tt.duplicated} duplicated · {tt.reordered} reordered · {tt.blackout} in the blackout
          </dd>
          <dt>delay</dt>
          <dd>
            avg {tt.delay_avg} ms · max {tt.delay_max} ms
          </dd>
          <dt>your moves</dt>
          <dd>
            {tt.on_time} on time · {tt.late} late · {tt.missing} missing of {tt.ticks}
          </dd>
          <dt>resyncs</dt>
          <dd>{tt.resyncs}</dd>
        </dl>
      ) : null}
    </section>
  );
}
