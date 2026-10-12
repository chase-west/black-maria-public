import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { api } from "../api.js";
import { Card, ErrorNote, Loading, Markdown } from "../ui/kit.js";
import { FixIt, useSetup } from "../ui/setup.js";

/** The two docs, rendered (SPEC 8: `/rules`, `/wire`). Headings carry anchors; the profiler links to them. */
export function DocPage(props: { name: "rules" | "wire" }) {
  const [text, setText] = useState<string | null>(null);
  const [err, setErr] = useState(false);
  const loc = useLocation();
  const setup = useSetup();
  useEffect(() => {
    setText(null);
    api.doc(props.name).then(setText, () => setErr(true));
  }, [props.name]);
  useEffect(() => {
    if (!text || !loc.hash) return;
    const el = document.getElementById(decodeURIComponent(loc.hash.slice(1)));
    if (el) {
      el.scrollIntoView({ block: "start" });
      el.classList.add("flash");
      setTimeout(() => el.classList.remove("flash"), 1600);
    }
  }, [text, loc.hash]);
  if (err) return <ErrorNote>Couldn&apos;t load the {props.name === "rules" ? "rules" : "wire doc"}. Reload to try again.</ErrorNote>;
  if (text === null) return <Loading label={props.name === "rules" ? "loading the rules" : "loading the wire doc"} />;
  return (
    <div className="doc-page">
      <Card flat className="doc-card">
        {props.name === "wire" ? <FixIt setup={setup} /> : null}
        <Markdown text={text} />
      </Card>
    </div>
  );
}
