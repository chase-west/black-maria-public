import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { Markdown, anchorsIn } from "../src/ui/kit.js";

const docs = join(__dirname, "../../../docs");
const render = (text: string, at = "/rules") =>
  renderToString(
    <MemoryRouter initialEntries={[at]}>
      <Markdown text={text} />
    </MemoryRouter>,
  );

describe("the two docs on the portal (v6.3)", () => {
  const rules = readFileSync(join(docs, "RULES.md"), "utf8");
  it("renders the four summary pictures and folds everything, exactly", () => {
    const html = render(rules);
    expect(html.match(/class="md-tile"/g)).toHaveLength(4);
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("Show everything, exactly");
    expect(html).not.toContain('id="1-the-house"');
    expect(html).toContain('id="value-per-tick"');
  });
  it("opens the fold when the address points inside it", () => {
    expect(anchorsIn(rules)).toContain("9-maria");
    const html = render(rules, "/rules#9-maria");
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('id="9-maria"');
  });
  it("folds the wire reference and the worked example, and keeps the checklist open", () => {
    const html = render(readFileSync(join(docs, "WIRE.md"), "utf8"), "/wire");
    expect(html).not.toContain('id="1-transport-and-framing"');
    expect(html).not.toContain('id="a-worked-example"');
    expect(html).toContain('id="10-checklist"');
  });
});
