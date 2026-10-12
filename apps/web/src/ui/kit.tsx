import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { AssetLoader, aspectOf } from "../assets/AssetLoader.js";
import { tiltFor } from "../game/layout.js";
import { REDUCED_MOTION } from "../settings.js";

/** Rotate cards by a random -1.5 to 1.5 degrees on mount. Things may be slightly crooked on purpose. */
export function useTilt(): string {
  return useMemo(() => `${(Math.random() * 3 - 1.5).toFixed(2)}deg`, []);
}

export function Card(props: { children: ReactNode; className?: string; style?: CSSProperties; flat?: boolean; title?: ReactNode }) {
  const tilt = useTilt();
  const ref = useRef<HTMLElement>(null);
  const [deg, setDeg] = useState(Number.parseFloat(tilt));
  useLayoutEffect(() => {
    const w = ref.current?.offsetWidth ?? 0;
    setDeg(tiltFor(Number.parseFloat(tilt), w));
  }, [tilt]);
  return (
    <section ref={ref} className={`card pop ${props.className ?? ""}`} style={{ ["--tilt" as string]: props.flat ? "0deg" : `${deg.toFixed(2)}deg`, ...props.style }}>
      <Corners />
      {props.title ? <h2 className="card-title">{props.title}</h2> : null}
      {props.children}
    </section>
  );
}

export function Button(props: { children: ReactNode; onClick?: () => void; to?: string; disabled?: boolean; tone?: "plain" | "go" | "stop"; title?: string; type?: "button" | "submit"; big?: boolean; dataFirstRun?: boolean }) {
  const cls = `btn ${props.tone === "go" ? "go" : props.tone === "stop" ? "coral" : ""} ${props.big ? "big" : ""}`;
  if (props.to && !props.disabled) {
    return (
      <Link className={cls} to={props.to} title={props.title} onClick={props.onClick} data-first-run={props.dataFirstRun ? "" : undefined}>
        {props.children}
      </Link>
    );
  }
  return (
    <button className={cls} onClick={props.onClick} disabled={props.disabled} title={props.title} type={props.type ?? "button"}>
      {props.children}
    </button>
  );
}

/**
 * Any manifest image in the DOM, through AssetLoader. Until it loads, a box of the same class and the image's own
 * aspect ratio (`--ar`, read by `.asset` in design.css) holds its place, so its arrival moves nothing.
 */
export function AssetImg(props: { name: string; alt?: string; className?: string; style?: CSSProperties }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void AssetLoader.url(props.name).then((u) => live && setSrc(u));
    return () => {
      live = false;
    };
  }, [props.name]);
  const ar = aspectOf(props.name);
  const style = (ar ? { ["--ar" as string]: ar, ...props.style } : props.style) as CSSProperties | undefined;
  const cls = `asset ${props.className ?? ""}`;
  return src ? <img src={src} alt={props.alt ?? ""} className={cls} style={style} draggable={false} /> : <span className={cls} style={{ display: "inline-block", ...style }} />;
}

/** The `ui_frame_corner` ornament mirrored into the four corners of a card. Purely decorative. */
export function Corners() {
  return (
    <span className="corners" aria-hidden>
      <i className="c-tl" />
      <i className="c-tr" />
      <i className="c-bl" />
      <i className="c-br" />
    </span>
  );
}

const WALK = ["you_walk_1", "you_walk_2", "you_walk_3", "you_walk_4", "you_walk_5", "you_walk_6"];

/** The loading indicator (v6.3): the cream fellow walking in place, six frames. Reduced motion: one frame, breathing. */
export function WalkingFellow(props: { className?: string }) {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (REDUCED_MOTION) return;
    const t = setInterval(() => setFrame((f) => (f + 1) % WALK.length), 110);
    return () => clearInterval(t);
  }, []);
  // All six stay mounted so the cycle never waits on a load; only the current one shows.
  return (
    <span className={`walker ${props.className ?? ""}`} aria-hidden>
      {WALK.map((n, i) => (
        <AssetImg key={n} name={n} className={`walk-frame ${i === frame ? "on" : ""}`} />
      ))}
    </span>
  );
}

/** The loading indicator (v6.3): the cream fellow walking in place. */
export function Loading(props: { label?: string }) {
  return (
    <div className="loading" role="status">
      <WalkingFellow className="loading-vessel" />
      <span className="mono">{props.label ?? "loading"}</span>
    </div>
  );
}

/** The illustration for a result: victory on a win, defeat on a loss, nothing on a draw. */
export function ResultArt(props: { result: "win" | "loss" | "draw" | null | undefined; className?: string }) {
  if (props.result !== "win" && props.result !== "loss") return null;
  return <AssetImg name={props.result === "win" ? "art_victory" : "art_defeat"} alt={props.result === "win" ? "The cream fellow jumping in a doorway, confetti around him." : "The cream fellow sitting on the floor, Maria grinning above him."} className={`result-art ${props.className ?? ""}`} />;
}

/** The clock-ended state (SPEC 8.4: an illustration and one sentence), laid out like the other state cards. */
export function ClockEnded(props: { sentence: string; children?: ReactNode }) {
  return (
    <div className="center-page">
      <Card title="Closed.">
        <AssetImg name="art_expired" alt="The house at night, every window dark, Maria asleep on the roof." className="state-art" />
        <p>{props.sentence}</p>
        {props.children ? <div className="row">{props.children}</div> : null}
      </Card>
    </div>
  );
}

export function ErrorNote(props: { children: ReactNode }) {
  return <div className="error pop">{props.children}</div>;
}

export function Chip(props: { tone: "win" | "draw" | "loss" | "live" | "maria" | "plain"; children: ReactNode }) {
  return <span className={`chip chip-${props.tone}`}>{props.children}</span>;
}

/** The anchor a heading gets: lowercase, punctuation dropped, spaces to hyphens (the same as the profiler's links). */
export function headingAnchor(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^a-z0-9 -]/g, "")
    .trim()
    .replace(/ /g, "-");
}

/** Inline markdown: **bold** and `code`. */
function inlineMd(s: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    const tok = m[0];
    out.push(tok.startsWith("**") ? <strong key={`${key}-${i++}`}>{tok.slice(2, -2)}</strong> : <code key={`${key}-${i++}`} className={tok.length > 32 && tok.includes(" ") ? "long" : undefined}>{tok.slice(1, -1)}</code>);
    last = m.index + tok.length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

const cells = (line: string) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());

/** The anchors of every heading in a piece of markdown. */
export function anchorsIn(text: string): string[] {
  return [...text.matchAll(/^#{2,4} (.*)$/gm)].map((m) => headingAnchor(m[1]!.replace(/`/g, "")));
}

/**
 * A folded section of a doc (v6.3): collapsed by default, one click to open. It opens by itself when the address
 * points at a heading inside it, so links into the reference still land.
 */
function Fold(props: { title: string; text: string }) {
  const loc = useLocation();
  const inside = useMemo(() => new Set(anchorsIn(props.text)), [props.text]);
  const target = decodeURIComponent(loc.hash.slice(1));
  const [open, setOpen] = useState(() => inside.has(target));
  useEffect(() => {
    if (inside.has(target)) setOpen(true);
  }, [inside, target]);
  return (
    <section className={`md-fold ${open ? "open" : ""}`}>
      <button type="button" className="md-fold-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="md-fold-arrow" aria-hidden />
        {open ? `Hide ${props.title.toLowerCase()}` : `Show ${props.title.toLowerCase()}`}
        <span className="mono small md-fold-hint">{open ? "" : `${inside.size} sections, every table and number`}</span>
      </button>
      {open ? <Markdown text={props.text} /> : null}
    </section>
  );
}

/** A small markdown renderer for the two docs: headings, paragraphs, tables, lists, fenced code, pictures and folds. */
export function Markdown(props: { text: string }) {
  const lines = props.text.split("\n");
  const out: ReactNode[] = [];
  let i = 0;
  let k = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const t = line.trim();
    const key = `b${k++}`;
    if (t === "") {
      i++;
      continue;
    }
    // `<!-- art: name name | caption -->`: a small inline picture from the manifest, with the paragraph after it.
    // Invisible in plain Markdown, where the paragraph reads on its own.
    const art = /^<!-- art: ([\w ]+?) \| (.+?) -->$/.exec(t);
    if (art) {
      i++;
      while (i < lines.length && lines[i]!.trim() === "") i++;
      const para: string[] = [];
      while (i < lines.length && lines[i]!.trim() !== "" && !/^(#{1,4} |\||```|<!--)/.test(lines[i]!.trim())) para.push(lines[i++]!.trim());
      out.push(
        <div key={key} className="md-tile">
          <Corners />
          <figure className="md-art">
            <span className="md-art-row">
              {art[1]!.split(" ").map((n) => (
                <AssetImg key={n} name={n} alt="" className="md-art-img" />
              ))}
            </span>
            <figcaption className="mono small">{art[2]}</figcaption>
          </figure>
          {para.length ? <p>{inlineMd(para.join(" "), key)}</p> : null}
        </div>,
      );
      continue;
    }
    // `<!-- grid -->` up to `<!-- /grid -->`: the blocks inside sit side by side on a wide screen.
    if (t === "<!-- grid -->") {
      const body: string[] = [];
      i++;
      while (i < lines.length && lines[i]!.trim() !== "<!-- /grid -->") body.push(lines[i++]!);
      i++;
      out.push(
        <div key={key} className="md-grid">
          <Markdown text={body.join("\n")} />
        </div>,
      );
      continue;
    }
    // `<!-- fold: Title -->` up to `<!-- /fold -->`: collapsed on the portal, printed in full in the Markdown.
    const fold = /^<!-- fold: (.+?) -->$/.exec(t);
    if (fold) {
      const body: string[] = [];
      i++;
      while (i < lines.length && lines[i]!.trim() !== "<!-- /fold -->") body.push(lines[i++]!);
      i++;
      out.push(<Fold key={key} title={fold[1]!} text={body.join("\n")} />);
      continue;
    }
    if (t.startsWith("<!--")) {
      i++;
      continue;
    }
    if (t.startsWith("```")) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.trim().startsWith("```")) body.push(lines[i++]!);
      i++;
      out.push(
        <pre key={key} className="md-code">
          {body.join("\n")}
        </pre>,
      );
      continue;
    }
    const h = /^(#{1,4}) (.*)$/.exec(t);
    if (h) {
      const level = h[1]!.length;
      const content = inlineMd(h[2]!, key);
      const id = headingAnchor(h[2]!.replace(/`/g, ""));
      out.push(level === 1 ? <h1 key={key}>{content}</h1> : level === 2 ? <h2 key={key} id={id}>{content}</h2> : level === 3 ? <h3 key={key} id={id}>{content}</h3> : <h4 key={key} id={id}>{content}</h4>);
      i++;
      continue;
    }
    if (t.startsWith("|")) {
      const rows: string[] = [];
      while (i < lines.length && lines[i]!.trim().startsWith("|")) rows.push(lines[i++]!);
      const head = cells(rows[0]!);
      const body = rows.slice(rows[1] && /^\|?\s*:?-{3}/.test(rows[1].trim()) ? 2 : 1).map(cells);
      out.push(
        <div key={key} className="md-table-wrap">
          <table className="md-table">
            <thead>
              <tr>
                {head.map((c, j) => (
                  <th key={j}>{inlineMd(c, `${key}h${j}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {body.map((r, ri) => (
                <tr key={ri}>
                  {r.map((c, j) => (
                    <td key={j}>{inlineMd(c, `${key}r${ri}c${j}`)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    const li = /^(\s*)(\d+\.|-)\s+(.*)$/.exec(line);
    if (li) {
      const ordered = li[2] !== "-";
      const items: { depth: number; text: string }[] = [];
      while (i < lines.length) {
        const m = /^(\s*)(\d+\.|-)\s+(.*)$/.exec(lines[i]!);
        if (m) {
          items.push({ depth: m[1]!.length >= 3 ? 1 : 0, text: m[3]! });
          i++;
        } else if (lines[i]!.trim() !== "" && /^\s{2,}/.test(lines[i]!) && items.length && !lines[i]!.trim().startsWith("|")) {
          items[items.length - 1]!.text += " " + lines[i]!.trim();
          i++;
        } else break;
      }
      const list = items.map((it, j) => (
        <li key={j} className={it.depth ? "md-sub" : undefined}>
          {inlineMd(it.text, `${key}i${j}`)}
        </li>
      ));
      out.push(ordered ? <ol key={key}>{list}</ol> : <ul key={key}>{list}</ul>);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i]!.trim() !== "" && !/^(#{1,4} |\||```|<!--|\s*(\d+\.|-)\s)/.test(lines[i]!.trim())) para.push(lines[i++]!.trim());
    if (para.length === 0) {
      para.push(t);
      i++;
    }
    out.push(<p key={key}>{inlineMd(para.join(" "), key)}</p>);
  }
  return <div className="markdown">{out}</div>;
}

let grainUrl: string | null = null;
/** Risograph grain: a small tile of cocoa specks, laid over canvases and key art at about 7% opacity. */
export function grain(): string {
  if (grainUrl) return grainUrl;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  let s = 1234567;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  g.fillStyle = "#4A2C2A";
  for (let i = 0; i < 2600; i++) g.fillRect(Math.floor(rnd() * 128), Math.floor(rnd() * 128), 1, 1);
  grainUrl = c.toDataURL("image/png");
  return grainUrl;
}

export function Grain(props: { strength?: number }) {
  return <div className="grain" style={{ backgroundImage: `url(${grain()})`, opacity: props.strength ?? 0.07 }} aria-hidden />;
}

/** A row of chunky toggle buttons, in place of a native select (whose open menu is OS-styled). */
export function Segmented<T extends string | number>(props: { value: T; options: readonly T[]; onChange: (v: T) => void; label?: string; disabled?: boolean; format?: (v: T) => string }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={props.label}>
      {props.label ? <span className="mono small">{props.label}</span> : null}
      {props.options.map((o) => (
        <button key={String(o)} type="button" role="radio" aria-checked={o === props.value} className={`seg ${o === props.value ? "on" : ""}`} disabled={props.disabled} onClick={() => props.onChange(o)}>
          {props.format ? props.format(o) : String(o)}
        </button>
      ))}
    </div>
  );
}

/** An in-house confirm card (native dialogs are not in the visual language). */
export function useConfirm(): [ReactNode, (question: string) => Promise<boolean>] {
  const [ask, setAsk] = useState<{ q: string; resolve: (v: boolean) => void } | null>(null);
  const node = ask ? (
    <div className="modal" role="dialog" aria-modal="true">
      <Card title="Are you sure?">
        <p>{ask.q}</p>
        <div className="row">
          <Button
            tone="go"
            onClick={() => {
              ask.resolve(true);
              setAsk(null);
            }}
          >
            Yes
          </Button>
          <Button
            onClick={() => {
              ask.resolve(false);
              setAsk(null);
            }}
          >
            No
          </Button>
        </div>
      </Card>
    </div>
  ) : null;
  return [node, (q) => new Promise<boolean>((resolve) => setAsk({ q, resolve }))];
}
