import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { ChaosTick, ProfilerReport, ReplayDoc, RuleChangeText, Tier, WireQuality } from "@blackmaria/protocol";
import { adminFetch, adminToken, type MatchSummary, type Profile } from "../api.js";
import { biggestProblem, TITLES } from "../game/Profiler.js";
import { rankMarks, revealIndex } from "../game/layout.js";
import { AssetImg, Button, Card, Chip, ErrorNote, Loading } from "../ui/kit.js";
import { ProfileBadge } from "./Official.js";
import { ReplayView } from "./Replay.js";

/** One row of `GET /api/admin/candidates`. */
interface Row {
  token: string;
  email: string;
  name: string | null;
  cohort: string;
  rule_change: number | null;
  clock_minute: number | null;
  /** The clock minute at which the candidate first opened the Official page and saw the change (v6.3). */
  change_revealed_minute: number | null;
  novice: number | null;
  adept: number | null;
  master: number | null;
  composite: number | null;
  on_time_rate: number | null;
  attempts_used: number;
  practice: number;
  matches: number;
  submitted_at: string | null;
  decision: string;
}

type RunQuality = Omit<WireQuality, "blackhole"> & { matches: number; blackholes: number; blackholes_survived: number };

interface Run {
  id: string;
  attempt: number;
  started_at: string | null;
  finished_at: string | null;
  profile: Profile | null;
  matches: MatchSummary[];
  wire_quality: RunQuality | null;
}

interface TimelineEntry {
  match_id: string;
  tier: Tier;
  transport: string;
  ended_at: string;
  /** The match started after the candidate saw the change. */
  with_change?: boolean;
  profiler: ProfilerReport | null;
}

interface Seam {
  id: string;
  title: string;
  detail: string;
  reported: boolean;
}

/** `GET /api/admin/candidates/:token`. */
interface Detail {
  token: string;
  email: string;
  name: string | null;
  cohort: string;
  clock: { opened_at: string | null; ends_at: string | null; minute: number; expired: boolean; change_revealed: boolean } | null;
  change: RuleChangeText | null;
  change_emailed_at: string | null;
  change_revealed_at: string | null;
  change_revealed_minute: number | null;
  profile: Profile | null;
  wire_quality: RunQuality | null;
  runs: Run[];
  practice_timeline: TimelineEntry[];
  practice: MatchSummary[];
  submission: { code_url: string | null; code_zip: boolean; note: { built: string; noticed: string }; questions: { built: string; noticed: string }; submitted_at: string } | null;
  seams: { source: string | null; items: Seam[] };
  review: { notes: string; decision: string; updated_at: string } | null;
}

const pct = (x: number | null | undefined) => (x === null || x === undefined ? "-" : `${(100 * x).toFixed(1)}%`);
const when = (s: string | null | undefined) => (s ? s.slice(0, 16).replace("T", " ") : "-");

function Gate(props: { onOk: () => void }) {
  const [t, setT] = useState("");
  const [bad, setBad] = useState(false);
  const go = async () => {
    adminToken.set(t);
    const r = await adminFetch("/api/admin/candidates");
    if (r.ok) props.onOk();
    else {
      adminToken.set(null);
      setBad(true);
    }
  };
  return (
    <div className="center-page">
      <Card title="Reviewer">
        <p>Enter the admin token once for this browser session.</p>
        <input type="password" autoComplete="off" value={t} onChange={(e) => setT(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void go()} aria-label="admin token" />
        <div className="row" style={{ marginTop: 12 }}>
          <Button tone="go" onClick={() => void go()}>
            Open
          </Button>
        </div>
        {bad ? <ErrorNote>Wrong admin token.</ErrorNote> : null}
      </Card>
    </div>
  );
}

function useAdmin(): [boolean, () => void] {
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => {
    if (!adminToken.get()) return setOk(false);
    adminFetch("/api/admin/candidates").then(
      (r) => setOk(r.ok),
      () => setOk(false),
    );
  }, []);
  return [ok === true, () => setOk(true)];
}

async function downloadBlob(path: string, name: string): Promise<void> {
  const r = await adminFetch(path);
  if (!r.ok) return;
  const url = URL.createObjectURL(await r.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

type Key = keyof Row;
const COLS: { key: Key; label: string }[] = [
  { key: "email", label: "candidate" },
  { key: "cohort", label: "cohort" },
  { key: "rule_change", label: "change" },
  { key: "clock_minute", label: "minute" },
  { key: "change_revealed_minute", label: "saw change" },
  { key: "composite", label: "composite" },
  { key: "novice", label: "N" },
  { key: "adept", label: "A" },
  { key: "master", label: "M" },
  { key: "on_time_rate", label: "on time" },
  { key: "practice", label: "practice" },
  { key: "decision", label: "decision" },
  { key: "submitted_at", label: "submitted" },
];

/** The reviewer's list (SPEC 7): every candidate, sortable, with the profile and wire quality side by side. */
export function Review() {
  const [ok, setOk] = useAdmin();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: Key; dir: 1 | -1 }>({ key: "composite", dir: -1 });
  useEffect(() => {
    if (!ok) return;
    adminFetch("/api/admin/candidates")
      .then((r) => r.json())
      .then(
        (j: { candidates: Row[] }) => setRows(j.candidates),
        () => setErr("Couldn't load the candidates. Reload to try again."),
      );
  }, [ok]);
  const sorted = useMemo(() => {
    if (!rows) return [];
    return rows.slice().sort((a, b) => {
      const x = a[sort.key] ?? -Infinity;
      const y = b[sort.key] ?? -Infinity;
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
    });
  }, [rows, sort]);
  const ranks = useMemo(() => rankMarks(rows ?? []), [rows]);
  if (!ok) return <Gate onOk={setOk} />;
  if (err) return <ErrorNote>{err}</ErrorNote>;
  if (!rows) return <Loading label="loading candidates" />;
  return (
    <div className="review-page">
      <Card title="Candidates">
        <div className="row">
          <Button onClick={() => void downloadBlob("/api/admin/export.csv", "blackmaria-candidates.csv")}>Export CSV</Button>
          <span className="mono small">{rows.length} candidates · composite = N + 3A + 9M (of 39) · on time is the official run's wire quality, shown beside the score and never in it</span>
        </div>
        <div className="table-wrap">
          <table className="table sortable">
            <thead>
              <tr>
                {COLS.map((c) => (
                  <th key={c.key}>
                    <button className="th" onClick={() => setSort((s) => ({ key: c.key, dir: s.key === c.key ? (s.dir === 1 ? -1 : 1) : -1 }))}>
                      {c.label}
                      {sort.key === c.key ? (sort.dir === 1 ? " ↑" : " ↓") : ""}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.token}>
                  <td className="who-cell">
                    {ranks.has(r.token) ? <AssetImg name={`ui_rank_${ranks.get(r.token)}`} alt={`rank ${ranks.get(r.token)}`} className="rank-mark inline" /> : <span className="rank-mark inline" />}
                    <Link to={`/review/${encodeURIComponent(r.token)}`}>{r.email}</Link>
                  </td>
                  <td className="mono small">{r.cohort}</td>
                  <td className="mono">{r.rule_change ?? "-"}</td>
                  <td className="mono">{r.clock_minute ?? "-"}</td>
                  <td className="mono">{r.change_revealed_minute ?? "-"}</td>
                  <td className="mono">{r.composite ?? "-"}</td>
                  <td className="mono">{r.novice ?? "-"}</td>
                  <td className="mono">{r.adept ?? "-"}</td>
                  <td className="mono">{r.master ?? "-"}</td>
                  <td className="mono">{pct(r.on_time_rate)}</td>
                  <td className="mono">{r.practice}</td>
                  <td>{r.decision || "-"}</td>
                  <td className="mono small">{when(r.submitted_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function QualityLine(props: { q: RunQuality | null }) {
  const q = props.q;
  if (!q) return <p className="small">No wire quality yet. No official match has finished.</p>;
  return (
    <p className="mono small quality-line">
      on time {pct(q.on_time_rate)} · late {q.late} · missing {q.missing} · malformed {q.malformed} · resyncs {q.resyncs}
      {q.blackholes ? ` · blackholes survived ${q.blackholes_survived}/${q.blackholes}` : ""}
    </p>
  );
}

/**
 * The trajectory (SPEC 8.3): every practice match's profiler lines, in order, so a reviewer sees what the candidate
 * learned. A marked row shows when they first saw the change (v6.3): the matches below it were played with it.
 */
function Timeline(props: { entries: TimelineEntry[]; revealedMinute: number | null }) {
  const at = revealIndex(props.entries, props.revealedMinute !== null);
  const marker = (
    <tr key="reveal" className="reveal-row">
      <td colSpan={12}>
        <span className="reveal-mark mono small">saw the change at minute {props.revealedMinute}</span>
      </td>
    </tr>
  );
  if (!props.entries.length) return <p className="small">No practice matches were profiled.{props.revealedMinute !== null ? ` Saw the change at minute ${props.revealedMinute}.` : ""}</p>;
  return (
    <div className="table-wrap">
      <table className="table timeline">
        <thead>
          <tr>
            <th>#</th>
            <th>vs</th>
            <th>link</th>
            <th>score</th>
            <th>done</th>
            <th>Maria first</th>
            <th>expired</th>
            <th>idle</th>
            <th>network</th>
            <th>snatches</th>
            <th>biggest problem</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {props.entries.map((e, i) => {
            const r = e.profiler;
            return [
              at === i ? marker : null,
              <tr key={e.match_id} className={e.with_change ? "with-change" : undefined}>
                <td className="mono">{i + 1}</td>
                <td>{e.tier}</td>
                <td className="mono small">{e.transport}</td>
                {r ? (
                  <>
                    <td className="mono">
                      <Chip tone={r.result}>
                        {r.scores.you}–{r.scores.maria}
                      </Chip>
                    </td>
                    <td className="mono">
                      {r.completed.count} (+{r.completed.value})
                    </td>
                    <td className="mono">
                      {r.maria_first.count} ({r.maria_first.value})
                    </td>
                    <td className="mono">{r.expired_heading.count}</td>
                    <td className="mono">{r.idle.ticks}</td>
                    <td className="mono">{r.network.ticks}</td>
                    <td className="mono">
                      {r.snatches.for.count}/{r.snatches.against.count}
                    </td>
                    <td className="small">{TITLES[biggestProblem(r)]}</td>
                  </>
                ) : (
                  <td colSpan={8} className="small">
                    profiler unavailable
                  </td>
                )}
                <td>
                  <Link className="small" to={`/review/replay/${e.match_id}`}>
                    replay
                  </Link>
                </td>
              </tr>,
            ];
          })}
          {at === props.entries.length ? marker : null}
        </tbody>
      </table>
    </div>
  );
}

/** One candidate (SPEC 2.4, 7): the profile, the runs, the practice trajectory, and the note beside the seams checklist. */
export function ReviewCandidate() {
  const { token = "" } = useParams();
  const [ok, setOk] = useAdmin();
  const [d, setD] = useState<Detail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [decision, setDecision] = useState("");
  const [notes, setNotes] = useState("");
  const [seams, setSeams] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState<string | null>(null);
  useEffect(() => {
    if (!ok) return;
    adminFetch(`/api/admin/candidates/${encodeURIComponent(token)}`)
      .then((r) => (r.ok ? (r.json() as Promise<Detail>) : Promise.reject(new Error(String(r.status)))))
      .then(
        (j) => {
          setD(j);
          setDecision(j.review?.decision ?? "");
          setNotes(j.review?.notes ?? "");
          setSeams(Object.fromEntries(j.seams.items.map((s) => [s.id, s.reported])));
        },
        () => setErr("Couldn't load that candidate. Reload to try again."),
      );
  }, [ok, token]);
  if (!ok) return <Gate onOk={setOk} />;
  if (err) return <ErrorNote>{err}</ErrorNote>;
  if (!d) return <Loading label="loading the candidate" />;
  const save = async () => {
    const r = await adminFetch(`/api/admin/candidates/${encodeURIComponent(token)}/review`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision, notes, seams }),
    });
    setSaved(r.ok ? `saved ${new Date().toLocaleTimeString()}` : "not saved; try again");
  };
  const s = d.submission;
  return (
    <div className="candidate-page">
      <div className="candidate-head">
        <Card title={d.name ? `${d.name} · ${d.email}` : d.email}>
          <p className="mono small">
            {d.token} · cohort {d.cohort}
            {d.clock ? ` · minute ${Math.min(90, d.clock.minute)}${d.clock.expired ? " (clock out)" : ""}` : " · clock not started"}
          </p>
          {d.change ? (
            <p className="small">
              <strong>Change {d.change.id}:</strong> {d.change.rule}{" "}
              <span className="mono">{d.change_revealed_minute !== null ? `(seen at minute ${d.change_revealed_minute}${d.change_emailed_at ? `, emailed ${when(d.change_emailed_at)}` : ""})` : "(not seen yet)"}</span>
            </p>
          ) : (
            <p className="small">No change drawn for this cohort yet.</p>
          )}
          {d.profile ? <ProfileBadge profile={d.profile} /> : <p>No finished official run.</p>}
          <QualityLine q={d.wire_quality} />
        </Card>
        <Card title="Official run">
          {d.runs.length === 0 ? <p>No official run.</p> : null}
          {d.runs.map((r) => (
            <div key={r.id} className="run-row">
              <span className="mono small">
                attempt {r.attempt} · {when(r.started_at)}
                {r.finished_at ? "" : " · playing"}
              </span>
              <div className="run-matches">
                {r.matches.map((m) => (
                  <Link key={m.id} to={`/review/replay/${m.id}`} className="run-match" title={`${m.tier} ${m.result ?? ""} ${m.scores ? `${m.scores.you}–${m.scores.maria}` : ""}`}>
                    <Chip tone={m.result ?? "live"}>{m.tier[0]!.toUpperCase()}</Chip>
                  </Link>
                ))}
              </div>
            </div>
          ))}
          <p className="mono small">{d.practice.length} practice matches</p>
        </Card>
      </div>
      <Card title="Practice, match by match">
        <Timeline entries={d.practice_timeline} revealedMinute={d.change_revealed_minute} />
      </Card>
      <div className="note-seams">
        <Card title="The note">
          {s ? (
            <div className="notes-done">
              {(["built", "noticed"] as const).map((k) => (
                <div key={k}>
                  <h3>{s.questions[k]}</h3>
                  <p>{s.note[k]}</p>
                </div>
              ))}
              <p className="mono small">submitted {when(s.submitted_at)}</p>
            </div>
          ) : (
            <p>Nothing submitted yet.</p>
          )}
          <div className="row">
            {s?.code_url ? (
              <a href={s.code_url} target="_blank" rel="noreferrer noopener">
                {s.code_url}
              </a>
            ) : null}
            {s?.code_zip ? <Button onClick={() => void downloadBlob(`/api/admin/candidates/${encodeURIComponent(token)}/code.zip`, `code-${token.slice(0, 8)}.zip`)}>Download the code zip</Button> : null}
          </div>
        </Card>
        <Card title="Seams the note reports">
          {d.seams.items.length === 0 ? <p className="small">This server has no seams doc configured.</p> : null}
          <ul className="seams">
            {d.seams.items.map((x) => (
              <li key={x.id}>
                <label>
                  <input type="checkbox" checked={!!seams[x.id]} onChange={(e) => setSeams((m) => ({ ...m, [x.id]: e.target.checked }))} />
                  <span>
                    <strong>{x.title}</strong>
                    <span className="small"> {x.detail}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </Card>
      </div>
      <Card title="Decision">
        <textarea rows={6} value={notes} onChange={(e) => setNotes(e.target.value)} aria-label="reviewer notes" />
        <div className="row">
          {["advance", "hold", "reject"].map((x) => (
            <Button key={x} tone={decision === x ? "go" : undefined} onClick={() => setDecision(decision === x ? "" : x)}>
              {x}
            </Button>
          ))}
        </div>
        <div className="row">
          <Button tone="go" onClick={() => void save()}>
            Save decision, notes and seams
          </Button>
          {saved ? <span className="mono small">{saved}</span> : null}
        </div>
      </Card>
    </div>
  );
}

/** What the network did, tick by tick, beside the move's fate (reviewer only). */
function ChaosStrip(props: { ticks: ChaosTick[]; quality?: WireQuality | undefined }) {
  const max = Math.max(1, props.ticks.length);
  return (
    <Card title="The network, tick by tick" className="chaos-card">
      <div className="chaos-strip" aria-label="chaos timeline">
        {props.ticks.map((t) => {
          const drops = t.down.drop + t.up.drop;
          const title = `tick ${t.tick}: move ${t.move}; down drop ${t.down.drop} reorder ${t.down.reorder} dup ${t.down.duplicate} delay ${t.down.delay_max}ms; up drop ${t.up.drop} reorder ${t.up.reorder} dup ${t.up.duplicate} delay ${t.up.delay_max}ms${t.blackhole ? "; blackhole" : ""}${t.resyncs ? `; ${t.resyncs} resyncs` : ""}`;
          return (
            <span key={t.tick} className={`chaos-col ${t.blackhole ? "bh" : ""}`} style={{ left: `${(100 * t.tick) / max}%`, width: `${100 / max}%` }} title={title}>
              <span className="chaos-drop" style={{ height: `${Math.min(100, drops * 34)}%` }} />
              <span className={`mark m-${t.move}`} />
            </span>
          );
        })}
      </div>
      {props.quality ? (
        <p className="mono small">
          on time {pct(props.quality.on_time_rate)} · late {props.quality.late} · missing {props.quality.missing} · malformed {props.quality.malformed} · resyncs {props.quality.resyncs}
          {props.quality.blackhole ? ` · blackhole at tick ${props.quality.blackhole.tick}: ${props.quality.blackhole.survived ? "survived" : `${props.quality.blackhole.on_time}/${props.quality.blackhole.ticks} on time`}` : ""}
        </p>
      ) : null}
    </Card>
  );
}

export function ReviewReplay() {
  const { id = "" } = useParams();
  const [ok, setOk] = useAdmin();
  const [doc, setDoc] = useState<ReplayDoc | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!ok) return;
    adminFetch(`/api/replay/${encodeURIComponent(id)}`)
      .then((r) => (r.ok ? (r.json() as Promise<ReplayDoc>) : Promise.reject(new Error(String(r.status)))))
      .then(setDoc, () => setErr("Couldn't load that replay. Reload to try again."));
  }, [ok, id]);
  if (!ok) return <Gate onOk={setOk} />;
  if (err) return <ErrorNote>{err}</ErrorNote>;
  if (!doc) return <Loading label="loading the replay" />;
  return <ReplayView doc={doc} extra={doc.chaos_timeline ? <ChaosStrip ticks={doc.chaos_timeline} quality={doc.wire_quality} /> : null} />;
}
