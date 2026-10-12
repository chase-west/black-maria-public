/**
 * Email. The server sends the official run email when the change is revealed (SPEC 2.2, 7, v6.3); the magic links go out with the cohort's invitation,
 * which the admin API can also queue (`POST /api/admin/tokens` with `"send": true`). The deployed mailer is a logged
 * stub: every message is written to the `outbox` table and the log, where an operator (or a real mail hook) can pick
 * it up. Each outbox message also renders as HTML (`site.ts`, `GET /api/admin/outbox/:id/html`) with the email art.
 */
import type { Db } from "./db.js";

export interface Mail {
  token: string | null;
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(m: Mail): void;
}

export class LogMailer implements Mailer {
  constructor(
    private readonly db: Db,
    private readonly log: (msg: string) => void,
  ) {}
  send(m: Mail): void {
    this.db.insertOutbox({ token: m.token, to_addr: m.to, subject: m.subject, body: m.text, sent_at: Date.now() });
    this.log(`email to ${m.to}: ${m.subject}`);
  }
}

/** The brief from SPEC 2.1, verbatim, one paragraph a line. */
export const BRIEF_LINES = [
  "**Goal.** Score as high as you can against Maria in the official run.",
  "**What you have.** Everything: the rules, Maria's code, the server's code, a simulator, and a client that already plays the official run, badly. Run it as-is and it'll beat Novice sometimes. The rest is up to you.",
  "**What's fair.** Anything the server accepts. If you find a way to score that we didn't intend, use it and tell us in your note. That's the best possible outcome. Off limits: attacking the server's availability and messing with other candidates' sessions.",
  "**The change.** The official run plays with one rule changed. You'll see which the first time you open the Official page. The simulator can play it before you commit. One shot, whenever you're ready.",
  "**Tools.** Any tool, any language, any AI.",
] as const;

/** The client command for the official run, with the server and the token filled in, as the official run email gives it. */
export function officialCommand(server: string, token: string): string {
  return `npx blackmaria official --server ${server.replace(/\/+$/, "")} --token ${token}`;
}

/** The invitation with the magic link (SPEC 2: 90 minutes from the moment you open it; the official run plays with one rule changed). */
export function invitationMail(to: string, token: string, link: string): Mail {
  return {
    token,
    to,
    subject: "BLACK MARIA: your magic link",
    text: [
      "Here's your magic link:",
      link,
      "",
      "You have 90 minutes from the moment you open it. The clock starts then and shows on every page. The official run is open from the start, and it plays with one rule changed. The Official page tells you which.",
      "",
      ...BRIEF_LINES.map((l) => `> ${l}`),
      "",
      "Open it on the computer you'll build on. It logs you in and remembers that browser.",
      "",
      "The client and the simulator run on your machine. The Simulator page has the install command and the two lines that point the client at the server. The client also needs your token: the last 32 characters of the link above.",
    ].join("\n"),
  };
}
