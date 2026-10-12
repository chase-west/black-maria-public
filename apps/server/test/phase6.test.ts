import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { MatchStartMsg } from "@blackmaria/protocol";
import { boot, connect, type Booted } from "./setup.js";

const ADMIN = { "x-admin-token": "admin-secret-123" };
const zipBytes = () => new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5, 6, 7, 8]);

describe("submission and reviewer (SPEC 2.3, 8)", () => {
  // The note is two answers of at most 150 words each.
  let s: Booted;
  beforeAll(async () => {
    s = await boot({ maxTickOverride: 20, tickMs: { practice: 40, wire: 12 } });
  });
  afterAll(async () => {
    await s.close();
  });

  const submit = (token: string, f: FormData) => fetch(`${s.base}/api/submit`, { method: "POST", body: f, headers: { authorization: `Bearer ${token}` } });

  it("stores code and the two-question note", async () => {
    const token = s.token("ada@example.com");
    const f = new FormData();
    f.set("code_zip", new File([zipBytes()], "bot.zip", { type: "application/zip" }));
    f.set("note_built", "One socket, one reader loop, a state store per match keyed by tick. A route planner over three errands. Left out: a full rival model.");
    f.set("note_noticed", "The server buffers moves ahead of the open tick. Claude for the codec.");
    const r = await submit(token, f);
    expect(r.status).toBe(200);
    const row = s.db.getSubmission(token)!;
    expect(row.note_built).toContain("route planner");
    expect(row.note_noticed).toContain("buffers moves");
    expect(row.code_path).toBeTruthy();
    const me = (await (await fetch(`${s.base}/api/submission`, { headers: { authorization: `Bearer ${token}` } })).json()) as any;
    expect(me.submission.note.noticed).toContain("Claude for the codec");
    expect(me.max_answer_words).toBe(150);
    expect(me.questions.built).toBe("What did you build, and what did you leave out on purpose?");
    expect(me.questions.noticed).toBe("What did you figure out that we didn't tell you?");
    // Reviewer downloads the code; candidates cannot use the admin API.
    const dl = await fetch(`${s.base}/api/admin/candidates/${token}/code.zip`, { headers: ADMIN });
    expect(dl.status).toBe(200);
    expect(new Uint8Array(await dl.arrayBuffer()).slice(0, 4)).toEqual(new Uint8Array([0x50, 0x4b, 0x03, 0x04]));
    expect((await fetch(`${s.base}/api/admin/candidates`, { headers: { authorization: `Bearer ${token}` } })).status).toBe(403);
  });

  it("validates: zip magic, repo URL scheme, both answers, 150 words each; errors are sentences", async () => {
    const token = s.token();
    const f = new FormData();
    f.set("code_zip", new File([new Uint8Array([1, 2, 3, 4, 5])], "evil.exe"));
    f.set("note_built", "word ".repeat(151));
    const r = await submit(token, f);
    expect(r.status).toBe(400);
    const body = (await r.json()) as any;
    expect(body.errors.join(" ")).toMatch(/not a zip/);
    expect(body.errors.join(" ")).toMatch(/first answer is over 150 words/);
    expect(body.errors.join(" ")).toMatch(/Answer the second question/);
    for (const e of body.errors as string[]) expect(e).toMatch(/^[A-Z].*\.$/);
    const g = new FormData();
    g.set("code_url", "javascript:alert(1)");
    g.set("note_built", "n");
    g.set("note_noticed", "n");
    expect((await submit(token, g)).status).toBe(400);
    const e = new FormData();
    e.set("code_url", "https://github.com/ada/bot");
    e.set("note_built", "n");
    expect((await submit(token, e)).status).toBe(400);
    const h = new FormData();
    h.set("code_url", "https://github.com/ada/bot");
    h.set("note_built", "n");
    h.set("note_noticed", "n");
    expect((await submit(token, h)).status).toBe(200);
    expect(s.db.getSubmission(token)!.code_url).toBe("https://github.com/ada/bot");
  });

  it("the reviewer sees candidates, saves a decision and notes, and exports CSV", async () => {
    const token = s.token("grace@example.com");
    expect((await fetch(`${s.base}/api/admin/candidates`)).status).toBe(403);
    const list = (await (await fetch(`${s.base}/api/admin/candidates`, { headers: ADMIN })).json()) as any;
    expect(list.candidates.some((x: { email: string }) => x.email === "grace@example.com")).toBe(true);
    const put = await fetch(`${s.base}/api/admin/candidates/${token}/review`, { method: "PUT", headers: { ...ADMIN, "content-type": "application/json" }, body: JSON.stringify({ decision: "advance", notes: "=HYPERLINK(\"x\") strong client" }) });
    expect(put.status).toBe(200);
    expect((await fetch(`${s.base}/api/admin/candidates/${token}/review`, { method: "PUT", headers: { ...ADMIN, "content-type": "application/json" }, body: JSON.stringify({ decision: "maybe" }) })).status).toBe(400);
    const detail = (await (await fetch(`${s.base}/api/admin/candidates/${token}`, { headers: ADMIN })).json()) as any;
    expect(detail.review.decision).toBe("advance");
    const csv = await (await fetch(`${s.base}/api/admin/export.csv`, { headers: ADMIN })).text();
    const line = csv.split("\r\n").find((l) => l.includes("grace@example.com"))!;
    expect(line).toContain(`"advance"`);
    expect(line).toContain(`"'=HYPERLINK`); // formula neutralized
    expect(csv.split("\r\n")[0]).toContain('"composite"');
  });

  it("the reviewer replay shows Maria's side; the candidate's does not", async () => {
    const token = s.token();
    const c = await connect(s.url, token);
    c.send({ type: "join", mode: "practice", tier: "master" });
    const start = await c.next<MatchStartMsg>("match_start");
    c.send({ type: "leave", match_id: start.match_id });
    await c.next("match_end");
    const mine = (await (await fetch(`${s.base}/api/replay/${start.match_id}`, { headers: { authorization: `Bearer ${token}` } })).json()) as any;
    const rev = (await (await fetch(`${s.base}/api/replay/${start.match_id}`, { headers: ADMIN })).json()) as any;
    expect(mine.frames[3].maria_energy).toBeUndefined();
    expect(typeof rev.frames[3].maria_energy).toBe("number");
    expect(rev.frames[3].maria_intent).toBeDefined();
    c.close();
  });
});
