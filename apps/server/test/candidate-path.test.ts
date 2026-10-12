import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { boot } from "./setup.js";

const ADMIN = { "x-admin-token": "admin-secret-123", "content-type": "application/json" };

function downloads(): string {
  const dir = mkdtempSync(join(tmpdir(), "bm-dl-"));
  writeFileSync(join(dir, "blackmaria-0.6.0.tgz"), "client");
  writeFileSync(join(dir, "black-maria-sim-0.6.0.tgz"), "sim");
  writeFileSync(join(dir, "blackmaria-public.tar.gz"), "repo");
  writeFileSync(join(dir, "secret.txt"), "not offered");
  return dir;
}

describe("the candidate path: where the code comes from, and the commands the portal gives", () => {
  it("serves the repository and the packages without a login, and /api/me says how to install and connect", async () => {
    const s = await boot({ publicUrl: "https://maria.example.com/", downloadsDir: downloads() });
    try {
      for (const [f, body] of [["blackmaria-0.6.0.tgz", "client"], ["black-maria-sim-0.6.0.tgz", "sim"], ["blackmaria-public.tar.gz", "repo"]] as const) {
        const r = await fetch(`${s.base}/download/${f}`);
        expect(r.status, f).toBe(200);
        expect(r.headers.get("content-type")).toBe("application/gzip");
        expect(await r.text()).toBe(body);
      }
      for (const f of ["secret.txt", "..%2Fblackmaria.db", "nope.tgz"]) expect((await fetch(`${s.base}/download/${f}`)).status, f).toBe(404);
      const token = s.token();
      const me = (await (await fetch(`${s.base}/api/me`, { headers: { authorization: `Bearer ${token}` } })).json()) as { get: { server: string; repo: string; install: string } };
      expect(me.get).toEqual({
        server: "https://maria.example.com",
        repo: "https://maria.example.com/download/blackmaria-public.tar.gz",
        install: "npm install https://maria.example.com/download/black-maria-sim-0.6.0.tgz https://maria.example.com/download/blackmaria-0.6.0.tgz",
      });
    } finally {
      await s.close();
    }
  });

  it("uses the registry names and the git URL when the operator says so, and offers nothing when there is nothing", async () => {
    const s = await boot({ publicUrl: "https://m.example", downloadsDir: downloads(), packagesOnNpm: true, publicRepoUrl: "https://git.example/bm.git" });
    const t = await boot({ publicUrl: "https://m.example", downloadsDir: join(tmpdir(), "bm-no-such-dir") });
    try {
      const get = async (b: typeof s) => ((await (await fetch(`${b.base}/api/me`, { headers: { authorization: `Bearer ${b.token()}` } })).json()) as { get: unknown }).get;
      expect(await get(s)).toEqual({ server: "https://m.example", repo: "https://git.example/bm.git", install: "npm install @black-maria/sim blackmaria" });
      expect(await get(t)).toEqual({ server: "https://m.example", repo: null, install: null });
    } finally {
      await s.close();
      await t.close();
    }
  });

  it("moves a candidate's clock for a rehearsal, and the official run email carries the official command", async () => {
    const s = await boot({ publicUrl: "https://maria.example.com" });
    try {
      const token = s.token("r@test");
      const auth = { authorization: `Bearer ${token}` };
      const put = (body: unknown, who = token) => fetch(`${s.base}/api/admin/candidates/${who}/clock`, { method: "PUT", headers: ADMIN, body: JSON.stringify(body) });
      const outbox = async () => ((await (await fetch(`${s.base}/api/admin/outbox?token=${token}`, { headers: ADMIN })).json()) as { outbox: { subject: string; body: string }[] }).outbox;
      expect((await fetch(`${s.base}/api/admin/candidates/${token}/clock`, { method: "PUT", body: "{}" })).status).toBe(403);
      expect((await put({ minute: 86 }, "0".repeat(32))).status).toBe(404);
      expect((await put({ minute: 91 })).status).toBe(400);

      // Minute 3: the official run is already open. Opening the Official page sends the email with the command.
      const r = (await (await put({ minute: 3 })).json()) as { minute: number; official: { open: boolean } };
      expect(r.minute).toBe(3);
      expect(r.official.open).toBe(true);
      await fetch(`${s.base}/api/official/reveal`, { method: "POST", headers: auth });
      expect(await outbox()).toHaveLength(1);
      expect((await outbox())[0]!.body).toContain(`npx blackmaria official --server https://maria.example.com --token ${token}`);

      // Minute 86 and 90: the closed and the expired states, for a rehearsal of those pages.
      expect(((await (await put({ minute: 86 })).json()) as { official: { open: boolean; reason: string } }).official).toEqual({ open: false, reason: "Too late for the official run. It had to start by minute 85." });
      expect(((await (await put({ minute: 90 })).json()) as { official: { reason: string } }).official.reason).toBe("Time's up, so the official run is closed.");

      // Minute 0 is a fresh start: the change is hidden again, and the next reveal emails again.
      await put({ minute: 0 });
      expect(s.db.getToken(token)!.change_revealed_at).toBeNull();
      expect(((await (await fetch(`${s.base}/api/me`, { headers: auth })).json()) as { change: unknown }).change).toBeNull();
      await fetch(`${s.base}/api/official/reveal`, { method: "POST", headers: auth });
      expect(await outbox()).toHaveLength(2);
    } finally {
      await s.close();
    }
  });
});
