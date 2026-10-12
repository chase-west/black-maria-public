import { useEffect, useState, type FormEvent } from "react";
import { api, type OfficialRun, type Submission } from "../api.js";
import { bus } from "../game/bus.js";
import { AssetImg, Button, Card, ClockEnded, ErrorNote, Loading } from "../ui/kit.js";
import { CLOCK_ENDED_SENTENCE, useClock } from "../clock.js";
import { ProfileBadge } from "./Official.js";

const QUESTIONS = ["What did you build, and what did you leave out on purpose?", "What did you figure out that we didn't tell you?"];
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

/** The confirmation (SPEC 8.4): the score, the three badges, the two notes, and both characters waving. */
function Done(props: { sub: Submission; run: OfficialRun | null; onEdit: () => void; ended: boolean }) {
  return (
    <div className="submitted">
      <AssetImg name="art_submitted" className="submitted-art" />
      <Card title="Submitted.">
        {props.run?.profile ? <ProfileBadge profile={props.run.profile} matches={props.run.matches} /> : <p className="small">No official run on record. Your note and code are in.</p>}
        <AssetImg name="ui_divider" className="divider" />
        <div className="notes-done">
          <h3>{QUESTIONS[0]}</h3>
          <p>{props.sub.note.built}</p>
          <h3>{QUESTIONS[1]}</h3>
          <p>{props.sub.note.noticed}</p>
        </div>
        <p className="mono small">
          {props.sub.code_url ? `code: ${props.sub.code_url}` : props.sub.code_zip ? "code: the zip you uploaded" : ""} · submitted {new Date(props.sub.submitted_at).toLocaleString()}
        </p>
        {props.ended ? null : (
          <>
            <p className="small">You can resubmit until time&apos;s up. Last one counts.</p>
            <Button onClick={props.onEdit}>Edit the submission</Button>
          </>
        )}
      </Card>
    </div>
  );
}

/** Submission (SPEC 2.3): code (a zip of at most 20 MB, or a repository URL) and the two-question note. */
export function Submit() {
  const clock = useClock();
  const [info, setInfo] = useState<Awaited<ReturnType<typeof api.submission>> | null>(null);
  const [run, setRun] = useState<OfficialRun | null>(null);
  // Drawn once both answers are in, so the badges never replace a line and move the page.
  const [runLoaded, setRunLoaded] = useState(false);
  const [built, setBuilt] = useState("");
  const [noticed, setNoticed] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = () =>
    api.submission().then(
      (s) => {
        setInfo(s);
        if (s.submission) {
          setBuilt(s.submission.note.built);
          setNoticed(s.submission.note.noticed);
        }
      },
      () => setErrors(["Couldn't load your submission. Reload to try again."]),
    );
  useEffect(() => {
    void load();
    api.official().then(
      (o) => {
        setRun(o.runs.find((r) => r.finished_at) ?? null);
        setRunLoaded(true);
      },
      () => setRunLoaded(true),
    );
  }, []);
  if (!info || !runLoaded) return errors.length ? <ErrorNote>{errors[0]}</ErrorNote> : <Loading label="loading your submission" />;
  const max = info.max_answer_words ?? 150;
  const ended = clock?.expired ?? false;
  if (info.submission && (!editing || ended)) return <Done sub={info.submission} run={run} onEdit={() => setEditing(true)} ended={ended} />;
  if (ended) return <ClockEnded sentence={CLOCK_ENDED_SENTENCE} />;
  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setErrors([]);
    const f = new FormData(e.currentTarget);
    f.set("note_built", built);
    f.set("note_noticed", noticed);
    try {
      const r = await fetch("/api/submit", { method: "POST", body: f, credentials: "same-origin" });
      const body = (await r.json()) as { ok?: boolean; errors?: string[]; message?: string };
      if (r.ok) {
        bus.emit({ kind: "submitted" });
        setEditing(false);
        await load();
      } else setErrors(body.errors ?? [body.message ?? `The server rejected that (status ${r.status}). Try again.`]);
    } catch {
      setErrors(["The upload didn't reach the server. Check your connection and try again."]);
    } finally {
      setBusy(false);
    }
  };
  const over = words(built) > max || words(noticed) > max;
  return (
    <form onSubmit={onSubmit} className="submit-form">
      <header className="submit-head">
        <div>
          <h1>Hand it in</h1>
          <p className="lede">Code plus two short answers. You can resubmit until time&apos;s up. Last one counts.</p>
        </div>
      </header>
      <Card title="Your code" flat>
        <p className="small">A zip of your client and bot (20 MB max), or a repo link. A person reads it. Nobody runs it.</p>
        <div className="field-row">
          <label className="field">
            A zip <input type="file" name="code_zip" accept=".zip,application/zip" />
          </label>
          <label className="field">
            or a repo URL <input type="text" name="code_url" placeholder="https://" defaultValue={info.submission?.code_url ?? ""} />
          </label>
        </div>
      </Card>
      {[
        [built, setBuilt],
        [noticed, setNoticed],
      ].map(([value, set], i) => (
        <Card key={i} title={QUESTIONS[i]} flat>
          <textarea rows={4} value={value as string} onChange={(e) => (set as (v: string) => void)(e.target.value)} aria-label={QUESTIONS[i]} />
          <p className={`mono small ${words(value as string) > max ? "over" : ""}`}>
            {words(value as string)} / {max} words
          </p>
        </Card>
      ))}
      {errors.length ? (
        <ErrorNote>
          {errors.map((e) => (
            <div key={e}>{e}</div>
          ))}
        </ErrorNote>
      ) : null}
      {busy ? (
        <Loading label="sending" />
      ) : (
        <Button tone="go" big type="submit" disabled={over}>
          Submit
        </Button>
      )}
      {over ? <p className="small countdown-label">An answer is over {max} words. Shorten it to submit.</p> : null}
    </form>
  );
}
