import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { RULE_CHANGES, isRuleChangeId, type WireQuality } from "@blackmaria/protocol";
import { EXPIRED_SENTENCE, officialState } from "./clock.js";
import type { AppDeps } from "./http.js";
import { isAdmin, matchSummary, practiceTimeline, requestToken } from "./http.js";
import { RUN_MATCHES, bestProfile, type Profile } from "./profile.js";
import { metrics } from "./match.js";
import { sumQuality } from "./quality.js";
import { loadSeams } from "./seams.js";
import { createToken } from "./tokens.js";
import { invitationMail } from "./mail.js";
import { emailHtml, readManifests } from "./site.js";
import { DECISIONS, DEFAULT_COHORT, type Decision, type RunRow } from "./db.js";

export const MAX_ZIP = 20 * 1024 * 1024;
/** Each of the note's two answers (SPEC 2.3). */
export const MAX_ANSWER_WORDS = 150;
export const NOTE_QUESTIONS = { built: "What did you build, and what did you leave out on purpose?", noticed: "What did you figure out that we didn't tell you?" } as const;

function runProfile(r: RunRow): Profile | null {
  if (!r.profile_json) return null;
  try {
    return JSON.parse(r.profile_json) as Profile;
  } catch {
    return null;
  }
}

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
const isZip = (b: Uint8Array) => b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05) && (b[3] === 0x04 || b[3] === 0x06);
const safeUrl = (u: string) => {
  try {
    const x = new URL(u);
    return x.protocol === "https:" || x.protocol === "http:" ? x.toString() : null;
  } catch {
    return null;
  }
};
const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  // Neutralize spreadsheet formulas and quote everything.
  const t = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${t.replace(/"/g, '""')}"`;
};
const iso = (t: number | null) => (t === null ? null : new Date(t).toISOString());
const COHORT_ID = /^[\w.-]{1,64}$/;

/** Candidate-facing official status and submission, and the reviewer API. */
export function mountPortalApi(app: Hono, deps: AppDeps): void {
  const { cfg, db, hub, clock } = deps;

  const runsOf = (token: string) =>
    db.listRuns(token).map((r) => {
      const matches = db.runMatches(r.id).map(matchSummary);
      const quality = matches.map((m) => m.wire_quality).filter((q): q is WireQuality => q !== null);
      return {
        id: r.id,
        attempt: r.attempt + 1,
        started_at: iso(r.started_at),
        finished_at: iso(r.finished_at),
        profile: runProfile(r),
        matches,
        wire_quality: quality.length ? sumQuality(quality) : null,
      };
    });
  const bestOf = (runs: ReturnType<typeof runsOf>) => bestProfile(runs.map((r) => r.profile).filter((p): p is Profile => !!p && p.played === RUN_MATCHES));

  app.get("/api/official", (c) => {
    const token = requestToken(c, deps);
    if (!token) return c.json({ error: "not_authenticated" }, 401);
    const runs = runsOf(token);
    const live = (deps.wireLive?.() ?? []).filter((m) => m.token === token && m.mode === "official").map((m) => ({ id: m.id, tier: m.tier, tick: m.live.state.tick, run_index: m.run?.index ?? null }));
    const st = clock.status(token);
    const change = clock.revealedChange(token);
    const revealed = clock.revealedAt(token);
    return c.json({
      attempts_left: hub.attemptsLeft(token),
      runs,
      live,
      best: bestOf(runs),
      official: st ? officialState(st) : { open: false, reason: "Open your magic link to start your clock." },
      // The change, once this token has opened the Official page (v6.3); null before.
      change,
      change_revealed_at: iso(revealed),
    });
  });

  // The first open of the Official page reveals the change (SPEC 2, v6.3). The official run uses it, and so does every
  // match from then on. Idempotent: later calls return the same change and record nothing.
  app.post("/api/official/reveal", (c) => {
    const token = requestToken(c, deps);
    if (!token) return c.json({ error: "not_authenticated" }, 401);
    const change = clock.reveal(token);
    return c.json({ change, change_revealed_at: iso(clock.revealedAt(token)) });
  });

  app.get("/api/submission", (c) => {
    const token = requestToken(c, deps);
    if (!token) return c.json({ error: "not_authenticated" }, 401);
    const s = db.getSubmission(token);
    return c.json({
      submission: s ? { code_url: s.code_url, code_zip: !!s.code_path, note: { built: s.note_built, noticed: s.note_noticed }, submitted_at: iso(s.submitted_at) } : null,
      questions: NOTE_QUESTIONS,
      max_zip: MAX_ZIP,
      max_answer_words: MAX_ANSWER_WORDS,
    });
  });

  app.post(
    "/api/submit",
    bodyLimit({ maxSize: MAX_ZIP + 1024 * 1024, onError: (c) => c.json({ error: "too_large", message: "The upload is over 20 MB. Leave out build output and dependencies, or send a repo URL." }, 413) }),
    async (c) => {
      const token = requestToken(c, deps);
      if (!token) return c.json({ error: "not_authenticated" }, 401);
      if (clock.expired(token)) return c.json({ error: "clock_expired", message: EXPIRED_SENTENCE }, 403);
      if (Date.now() > cfg.windowCloses.getTime()) return c.json({ error: "window_closed", message: "Submissions for this cohort are closed." }, 403);
      let body: Record<string, string | File | (string | File)[]>;
      try {
        body = await c.req.parseBody({ all: false });
      } catch {
        return c.json({ error: "bad_request", message: "Send the submission as a multipart form." }, 400);
      }
      const str = (k: string) => (typeof body[k] === "string" ? (body[k] as string) : "");
      const file = (k: string) => (body[k] instanceof File && (body[k] as File).size > 0 ? (body[k] as File) : null);
      const errors: string[] = [];
      const dir = join(cfg.uploadDir, token.replace(/[^\w-]/g, "_"));
      mkdirSync(dir, { recursive: true });

      // Code: a zip (<= 20MB) or a repository URL. Stored for review only; never unpacked or run.
      let codePath: string | null = null;
      let codeUrl: string | null = null;
      let codeBytes: Uint8Array | null = null;
      const zip = file("code_zip");
      if (zip) {
        if (zip.size > MAX_ZIP) errors.push("The zip is over 20 MB. Leave out build output and dependencies, or send a repo URL.");
        else {
          const bytes = new Uint8Array(await zip.arrayBuffer());
          if (!isZip(bytes)) errors.push("That file is not a zip. Upload a .zip or send a repo URL.");
          else codeBytes = bytes;
        }
      } else if (str("code_url")) {
        codeUrl = safeUrl(str("code_url"));
        if (!codeUrl) errors.push("The repo URL has to start with http:// or https://.");
      } else errors.push("Attach your code as a zip or give a repo URL.");

      // The note: two questions, at most 150 words each (SPEC 2.3).
      const built = str("note_built");
      const noticed = str("note_noticed");
      if (!built.trim()) errors.push("Answer the first question: what you built and what you left out.");
      if (!noticed.trim()) errors.push("Answer the second question: what you figured out that we didn't tell you.");
      if (words(built) > MAX_ANSWER_WORDS) errors.push(`The first answer is over ${MAX_ANSWER_WORDS} words. Cut it down and submit again.`);
      if (words(noticed) > MAX_ANSWER_WORDS) errors.push(`The second answer is over ${MAX_ANSWER_WORDS} words. Cut it down and submit again.`);
      if (errors.length) return c.json({ error: "invalid", errors }, 400);

      if (codeBytes) {
        codePath = join(dir, "code.zip");
        writeFileSync(codePath, codeBytes);
      }
      const prev = db.getSubmission(token);
      db.upsertSubmission({ token, code_path: codePath ?? (codeUrl ? null : (prev?.code_path ?? null)), code_url: codeUrl, note_built: built, note_noticed: noticed, submitted_at: Date.now() });
      return c.json({ ok: true });
    },
  );

  // ---------------------------------------------------------------- reviewer
  app.use("/api/admin/*", async (c, next) => {
    if (!isAdmin(c, deps)) return c.json({ error: "forbidden" }, 403);
    await next();
  });

  const changeOf = (cohort: string) => {
    const row = db.getCohort(cohort);
    return row && isRuleChangeId(row.rule_change) ? row.rule_change : null;
  };

  const candidates = () =>
    db.listTokens().map((t) => {
      const runs = runsOf(t.token);
      const best = bestOf(runs);
      const sub = db.getSubmission(t.token);
      const review = db.getReview(t.token);
      const st = clock.status(t.token);
      return {
        token: t.token,
        email: t.email,
        name: t.name,
        cohort: t.cohort,
        rule_change: changeOf(t.cohort),
        opened_at: iso(t.opened_at),
        change_revealed_minute: st && t.change_revealed_at !== null ? Math.floor((t.change_revealed_at - st.opened_at) / cfg.clock.minuteMs) : null,
        clock_minute: st ? Math.min(90, Math.floor(st.minute)) : null,
        novice: best?.novice ?? null,
        adept: best?.adept ?? null,
        master: best?.master ?? null,
        composite: best?.composite ?? null,
        on_time_rate: runs[0]?.wire_quality?.on_time_rate ?? null,
        attempts_used: runs.length,
        practice: db.practiceProfiles(t.token).length,
        matches: (db.sql.prepare("SELECT COUNT(*) AS n FROM matches WHERE token = ?").get(t.token) as { n: number }).n,
        submitted_at: sub ? iso(sub.submitted_at) : null,
        decision: review?.decision ?? "",
      };
    });

  app.get("/api/admin/metrics", (c) => {
    const lag = monitorLag();
    return c.json({ ...hub.stats(), ...metrics.summary(), event_loop_lag_ms: lag, rss_mb: Math.round(process.memoryUsage().rss / 1e6) });
  });

  app.post("/api/admin/tokens", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "bad_request", message: "Send JSON: {\"emails\": [...], \"cohort\": \"...\"}." }, 400);
    }
    const b = body as { emails?: unknown; cohort?: unknown; send?: unknown };
    const emails = b.emails;
    if (!Array.isArray(emails) || emails.length === 0 || emails.length > 500 || !emails.every((e) => typeof e === "string" && e.length < 200)) return c.json({ error: "bad_request", message: "emails must be a list of 1 to 500 addresses." }, 400);
    const cohort = b.cohort === undefined ? DEFAULT_COHORT : b.cohort;
    if (typeof cohort !== "string" || !COHORT_ID.test(cohort)) return c.json({ error: "bad_request", message: "A cohort id is 1 to 64 letters, digits, dots, dashes or underscores." }, 400);
    if (!db.getCohort(cohort)) db.upsertCohort(cohort, null, Date.now());
    const out = (emails as string[]).map((email) => {
      const token = createToken(db, email, undefined, cfg.limits.officialAttempts, cohort);
      const link = `${cfg.publicUrl}/enter/${token}`;
      // Queue the invitation through the mailer (the outbox stub) when asked; otherwise the operator sends the links.
      if (b.send === true && deps.mailer) deps.mailer.send(invitationMail(email, token, link));
      return { email, token, cohort, link };
    });
    return c.json({ tokens: out });
  });

  // The change per cohort (SPEC 2.2): the admin draws it; it locks once any of the cohort's candidates has seen it.
  app.get("/api/admin/cohorts", (c) =>
    c.json({
      cohorts: db.listCohorts().map((r) => ({ id: r.id, rule_change: isRuleChangeId(r.rule_change) ? r.rule_change : null, change: isRuleChangeId(r.rule_change) ? RULE_CHANGES[r.rule_change] : null, locked: clock.cohortLocked(r.id), created_at: iso(r.created_at) })),
    }),
  );
  app.put("/api/admin/cohorts/:id", async (c) => {
    const id = c.req.param("id");
    if (!COHORT_ID.test(id)) return c.json({ error: "bad_request", message: "A cohort id is 1 to 64 letters, digits, dots, dashes or underscores." }, 400);
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "bad_request", message: "Send JSON: {\"rule_change\": 1, 2 or 3}." }, 400);
    }
    const rc = (body as { rule_change?: unknown }).rule_change;
    if (!isRuleChangeId(rc)) return c.json({ error: "bad_request", message: "rule_change must be 1, 2 or 3." }, 400);
    if (clock.cohortLocked(id) && changeOf(id) !== rc) return c.json({ error: "locked", message: "A candidate in this cohort has already seen its change, so it can no longer be changed." }, 409);
    db.upsertCohort(id, rc, Date.now());
    return c.json({ ok: true, id, rule_change: rc, change: RULE_CHANGES[rc] });
  });

  // Rehearsal (RUNBOOK): set a candidate's clock to a minute, as if they had opened the link that long ago, for
  // example 86 to see the official run closed or 90 for the clock-ended state. Minute 0 is a fresh start: the change
  // is hidden again and its email can go out again.
  app.put("/api/admin/candidates/:token/clock", async (c) => {
    const token = c.req.param("token");
    if (!db.getToken(token)) return c.json({ error: "not_found", message: "No candidate has that token. Check it against GET /api/admin/candidates." }, 404);
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "bad_request", message: 'Send JSON: {"minute": 86}.' }, 400);
    }
    const minute = (body as { minute?: unknown }).minute;
    if (typeof minute !== "number" || !Number.isFinite(minute) || minute < 0 || minute > 90) return c.json({ error: "bad_request", message: "minute must be a number from 0 to 90." }, 400);
    db.setOpenedAt(token, clock.now() - minute * cfg.clock.minuteMs);
    if (minute === 0) db.resetChangeRevealed(token);
    clock.forget(token);
    const st = clock.status(token)!;
    return c.json({ ok: true, token, minute: Math.floor(st.minute), seconds_left: st.seconds_left, official: officialState(st) });
  });

  /** The change email stub's outbox. */
  app.get("/api/admin/outbox", (c) => c.json({ outbox: db.listOutbox(c.req.query("token") || undefined).map((o) => ({ ...o, sent_at: iso(o.sent_at), html: `/api/admin/outbox/${o.id}/html` })) }));
  /** One outbox message as the HTML email it will be when real email is wired: the banner, the text, the footer. */
  app.get("/api/admin/outbox/:id/html", (c) => {
    const id = Number(c.req.param("id"));
    const row = Number.isInteger(id) ? db.getOutbox(id) : null;
    if (!row) return c.json({ error: "not_found" }, 404);
    return c.html(emailHtml(row.subject, row.body, { publicUrl: cfg.publicUrl, manifests: readManifests(cfg.assetsDir) }));
  });
  /** The invitation a token would get, as HTML, without sending it. */
  app.get("/api/admin/invitation/:token/html", (c) => {
    const t = db.getToken(c.req.param("token"));
    if (!t) return c.json({ error: "not_found" }, 404);
    const m = invitationMail(t.email, t.token, `${cfg.publicUrl}/enter/${t.token}`);
    return c.html(emailHtml(m.subject, m.text, { publicUrl: cfg.publicUrl, manifests: readManifests(cfg.assetsDir) }));
  });

  app.get("/api/admin/candidates", (c) => c.json({ candidates: candidates() }));

  app.get("/api/admin/candidates/:token", (c) => {
    const token = c.req.param("token");
    const t = db.getToken(token);
    if (!t) return c.json({ error: "not_found" }, 404);
    const runs = runsOf(token);
    const sub = db.getSubmission(token);
    const review = db.getReview(token);
    const st = clock.status(token);
    const rc = changeOf(t.cohort);
    const seams = loadSeams(cfg.reviewChecklist);
    let checked: Record<string, boolean> = {};
    try {
      checked = review ? (JSON.parse(review.seams_json) as Record<string, boolean>) : {};
    } catch {
      checked = {};
    }
    return c.json({
      token,
      email: t.email,
      name: t.name,
      cohort: t.cohort,
      clock: st ? { opened_at: iso(st.opened_at), ends_at: iso(st.ends_at), minute: Math.floor(st.minute), expired: st.expired, change_revealed: t.change_revealed_at !== null } : null,
      change: rc ? RULE_CHANGES[rc] : null,
      change_emailed_at: iso(t.change_notified_at),
      // When the candidate first opened the Official page and saw the change (v6.3); the timeline marks it.
      change_revealed_at: iso(t.change_revealed_at),
      change_revealed_minute: st && t.change_revealed_at !== null ? Math.floor((t.change_revealed_at - st.opened_at) / cfg.clock.minuteMs) : null,
      // The profile (SPEC 9): the official run's wins per tier and composite, with wire quality beside it.
      profile: bestOf(runs),
      wire_quality: runs[0]?.wire_quality ?? null,
      runs,
      // Every practice match's profiler lines, in order: the trajectory (SPEC 8.3).
      practice_timeline: practiceTimeline(db, token),
      practice: db.listMatches(token, 500).filter((m) => m.mode !== "official").map(matchSummary),
      submission: sub ? { code_url: sub.code_url, code_zip: !!sub.code_path, note: { built: sub.note_built, noticed: sub.note_noticed }, questions: NOTE_QUESTIONS, submitted_at: iso(sub.submitted_at) } : null,
      // The seams checklist beside the note (SPEC 2.4): reviewer-only, read from the seams document if it exists.
      seams: { source: seams.source, items: seams.seams.map((s) => ({ ...s, reported: checked[s.id] === true })) },
      review: review ? { notes: review.notes, decision: review.decision, updated_at: iso(review.updated_at) } : null,
    });
  });

  app.put("/api/admin/candidates/:token/review", async (c) => {
    const token = c.req.param("token");
    if (!db.getToken(token)) return c.json({ error: "not_found" }, 404);
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "bad_request" }, 400);
    }
    const b = body as { decision?: unknown; notes?: unknown; seams?: unknown };
    const decision = (typeof b.decision === "string" ? b.decision : "") as Decision;
    if (!DECISIONS.includes(decision)) return c.json({ error: "bad_request", message: `decision must be one of: ${DECISIONS.filter(Boolean).join(", ")}, or empty` }, 400);
    const notes = typeof b.notes === "string" ? b.notes.slice(0, 100_000) : "";
    const known = new Set(loadSeams(cfg.reviewChecklist).seams.map((s) => s.id));
    const seams: Record<string, boolean> = {};
    if (b.seams && typeof b.seams === "object") for (const [k, v] of Object.entries(b.seams as Record<string, unknown>)) if (known.has(k) && typeof v === "boolean") seams[k] = v;
    db.upsertReview({ token, notes, decision, seams_json: JSON.stringify(seams), updated_at: Date.now() });
    return c.json({ ok: true });
  });

  const download = (kind: "code") => (c: Context) => {
    const sub = db.getSubmission(c.req.param("token") ?? "");
    const p = sub?.code_path;
    if (!p) return c.json({ error: "not_found" }, 404);
    try {
      const data = readFileSync(p);
      return new Response(data, { headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="${kind}-${(c.req.param("token") ?? "").slice(0, 8)}.zip"` } });
    } catch {
      return c.json({ error: "not_found" }, 404);
    }
  };
  app.get("/api/admin/candidates/:token/code.zip", download("code"));

  app.get("/api/admin/export.csv", () => {
    const header = ["email", "name", "token", "cohort", "rule_change", "novice", "adept", "master", "composite", "on_time_rate", "attempts_used", "practice", "matches", "submitted_at", "decision", "seams_reported", "notes"];
    const rows = candidates().map((x) => {
      const review = db.getReview(x.token);
      let reported = 0;
      try {
        reported = Object.values(JSON.parse(review?.seams_json ?? "{}") as Record<string, boolean>).filter(Boolean).length;
      } catch {
        reported = 0;
      }
      return [x.email, x.name, x.token, x.cohort, x.rule_change, x.novice, x.adept, x.master, x.composite, x.on_time_rate, x.attempts_used, x.practice, x.matches, x.submitted_at, x.decision, reported, review?.notes ?? ""];
    });
    const csv = [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
    return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="blackmaria-candidates.csv"' } });
  });
}

let lastLag = 0;
let lagTimer: ReturnType<typeof setInterval> | null = null;
/** Event-loop lag, sampled every 500 ms (started lazily). */
function monitorLag(): number {
  if (!lagTimer) {
    let expected = performance.now() + 500;
    lagTimer = setInterval(() => {
      const now = performance.now();
      lastLag = Math.max(0, now - expected);
      expected = now + 500;
    }, 500);
    lagTimer.unref?.();
  }
  return +lastLag.toFixed(2);
}
