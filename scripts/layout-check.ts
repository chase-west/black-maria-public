// Layout stability, measured in a real browser (PROGRESS.md, "Layout stability"). jsdom cannot lay anything out, so
// this drives a headless Chrome over the DevTools protocol against the screens server
// (apps/server/scripts/screens-server.ts: the real server and the built web) and checks, at 1440 x 900 and 390 px:
//
//   - the footer's box is the same before and after a round trip through every route, on a short page and a long one;
//   - between two short pages the footer does not move in any frame, and on no navigation does it flash into view;
//   - every navigation has a cumulative layout shift of zero, and the viewport width (the scrollbar gutter) never changes;
//   - a fresh load of each route shifts less than 0.02 in total, fonts included.
//
// Run after `pnpm build`:  npx tsx scripts/layout-check.ts
//   --url http://localhost:8899   use a running screens server (control port = its port + 1) instead of starting one
//   --report file.json            write every measurement
//   --shots dir --tag before      screenshots of the footer on the shortest and longest routes
//   --states                      also play a practice match, a wire match and an official run, measuring the shifts
//   --overlap-only                only the overlap pass (the Practice arena and its cards from 375 to 1440 wide)
// Chrome comes from CHROME_PATH or the usual install places; with none, the check says so and exits 0, unless
// LAYOUT_REQUIRE=1. Exit 1 on any failed check.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = process.argv.slice(2);
const flag = (name: string): string | null => {
  const i = args.indexOf(name);
  return i >= 0 ? (args[i + 1] ?? "") : null;
};
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** The routes, in nav order. Submit is not in the nav; it is reached from Start Here and the Official page. */
const ROUTES = [
  { name: "start", href: "/" },
  { name: "rules", href: "/rules" },
  { name: "wire", href: "/wire" },
  { name: "sim", href: "/sim" },
  { name: "practice", href: "/practice" },
  { name: "official", href: "/official" },
  { name: "submit", href: "/submit" },
] as const;
const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900, mobile: false },
  { name: "390", width: 390, height: 844, mobile: true },
] as const;

function findChrome(): string | null {
  const c = [
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];
  return c.find((p): p is string => !!p && existsSync(p)) ?? null;
}

type Json = Record<string, unknown>;

/** A DevTools protocol session on one page. */
class Cdp {
  private n = 0;
  private readonly pending = new Map<number, { resolve: (v: Json) => void; reject: (e: Error) => void }>();
  private constructor(private readonly ws: WebSocket) {
    ws.addEventListener("message", (ev) => {
      const m = JSON.parse(String(ev.data)) as { id?: number; result?: Json; error?: { message: string } };
      if (m.id === undefined) return;
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      if (m.error) p.reject(new Error(m.error.message));
      else p.resolve(m.result ?? {});
    });
  }
  static connect(url: string): Promise<Cdp> {
    return new Promise((res, rej) => {
      const ws = new WebSocket(url);
      ws.addEventListener("open", () => res(new Cdp(ws)));
      ws.addEventListener("error", () => rej(new Error(`no DevTools socket at ${url}`)));
    });
  }
  send(method: string, params: Json = {}): Promise<Json> {
    const id = ++this.n;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  /** Evaluates an expression in the page (awaiting a promise) and returns its JSON value. */
  async eval<T>(expression: string): Promise<T> {
    const r = (await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })) as { result?: { value?: unknown }; exceptionDetails?: { text?: string; exception?: { description?: string } } };
    if (r.exceptionDetails) throw new Error(`page: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text ?? "error"}`);
    return r.result?.value as T;
  }
  close(): void {
    this.ws.close();
  }
}

/** Installed before any page script: every layout shift, with what moved. */
const INSTRUMENT = `
window.__ls = [];
(() => {
  const describe = (n) => {
    if (!n) return "(removed)";
    const el = n.nodeType === 1 ? n : n.parentElement;
    if (!el) return "(text)";
    const cls = typeof el.className === "string" && el.className.trim() ? "." + el.className.trim().split(/\\s+/).join(".") : "";
    return (n.nodeType === 1 ? "" : "text in ") + el.tagName.toLowerCase() + cls;
  };
  const r = (x) => x ? [Math.round(x.x), Math.round(x.y), Math.round(x.width), Math.round(x.height)].join(",") : "";
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries())
        window.__ls.push({ value: e.value, t: Math.round(e.startTime), input: e.hadRecentInput, path: location.pathname, sources: (e.sources || []).map((s) => describe(s.node) + " " + r(s.previousRect) + " -> " + r(s.currentRect)) });
    }).observe({ type: "layout-shift", buffered: true });
  } catch {}
})();
`;

interface Shift {
  value: number;
  t: number;
  input: boolean;
  path: string;
  sources: string[];
}
interface Box {
  top: number;
  height: number;
  docTop: number;
  bottomGap: number;
}
interface Frame {
  vh: number;
  sh: number;
  cw: number;
  sy: number;
  box: Box;
}
interface Step {
  from: string;
  to: string;
  frames: Frame[];
  shifts: Shift[];
  cls: number;
}

/** The page side of a measurement: the footer's box, the page height, the viewport width, the scroll. */
const FRAME = `(() => { const r = document.querySelector("footer.footer").getBoundingClientRect(); const d = document.documentElement; return { vh: innerHeight, sh: d.scrollHeight, cw: d.clientWidth, sy: Math.round(scrollY), box: { top: Math.round(r.top * 10) / 10, height: Math.round(r.height * 10) / 10, docTop: Math.round((r.top + scrollY) * 10) / 10, bottomGap: Math.round((innerHeight - r.bottom) * 10) / 10 } }; })()`;

/**
 * Navigates in the app (a nav link if there is one, a router navigation otherwise), recording the footer every frame
 * for `ms`, then every layout shift since the click.
 */
async function navigate(cdp: Cdp, href: string, ms = 2600): Promise<{ frames: Frame[]; shifts: Shift[] }> {
  return cdp.eval(`(async () => {
    const frame = () => ${FRAME};
    const mark = window.__ls.length;
    const frames = [frame()];
    const link = document.querySelector('.nav nav a[href="${href}"]') || document.querySelector('main a[href="${href}"]');
    if (link) link.click();
    else { history.pushState({}, "", "${href}"); dispatchEvent(new PopStateEvent("popstate")); }
    const t0 = performance.now();
    await new Promise((res) => { const step = () => { frames.push(frame()); if (performance.now() - t0 < ${ms}) requestAnimationFrame(step); else res(); }; requestAnimationFrame(step); });
    await new Promise((r) => setTimeout(r, 50));
    return { frames, shifts: window.__ls.slice(mark) };
  })()`);
}

const sum = (s: Shift[]) => Math.round(s.reduce((a, b) => a + b.value, 0) * 10000) / 10000;
const nameOf = (href: string) => ROUTES.find((r) => r.href === href)?.name ?? href;
const last = <T>(a: T[]): T => a[a.length - 1]!;

async function main(): Promise<number> {
  const chrome = findChrome();
  if (!chrome) {
    const msg = "layout-check: no Chrome found (set CHROME_PATH); skipped";
    console.log(msg);
    return process.env.LAYOUT_REQUIRE === "1" ? 1 : 0;
  }
  const procs: ChildProcess[] = [];
  const tmp = mkdtempSync(join(tmpdir(), "bm-layout-"));
  let base = flag("--url");
  try {
    if (!base) {
      const port = Number(process.env.LAYOUT_PORT ?? 8931);
      const srv = spawn(process.execPath, ["--import", "tsx", "--conditions=source", "scripts/screens-server.ts"], { cwd: join(ROOT, "apps/server"), env: { ...process.env, PORT: String(port), WIRE_PORT: String(port + 9000) }, stdio: ["ignore", "pipe", "inherit"] });
      procs.push(srv);
      await new Promise<void>((res, rej) => {
        const t = setTimeout(() => rej(new Error("the screens server did not start")), 60_000);
        srv.stdout?.on("data", (b: Buffer) => {
          if (String(b).includes("screens server on")) {
            clearTimeout(t);
            res();
          }
        });
        srv.on("exit", (c) => rej(new Error(`the screens server exited (${c})`)));
      });
      base = `http://localhost:${port}`;
    }
    const control = base.replace(/:(\d+)$/, (_, p: string) => `:${Number(p) + 1}`).replace("localhost", "127.0.0.1");
    const dport = Number(process.env.LAYOUT_DEVTOOLS_PORT ?? 9333);
    const br = spawn(chrome, ["--headless=new", `--remote-debugging-port=${dport}`, `--user-data-dir=${tmp}`, "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--force-color-profile=srgb", "about:blank"], { stdio: "ignore" });
    procs.push(br);
    let pageWs = "";
    for (let i = 0; i < 100 && !pageWs; i++) {
      await sleep(200);
      try {
        const list = (await (await fetch(`http://127.0.0.1:${dport}/json/list`)).json()) as { type: string; webSocketDebuggerUrl: string }[];
        pageWs = list.find((t) => t.type === "page")?.webSocketDebuggerUrl ?? "";
      } catch {
        /* not up yet */
      }
    }
    if (!pageWs) throw new Error("headless Chrome did not start");
    const cdp = await Cdp.connect(pageWs);
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Network.enable");
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: INSTRUMENT });
    // A little latency, so a block that arrives late is seen arriving.
    const latency = Number(process.env.LAYOUT_LATENCY ?? 120);
    await cdp.send("Network.emulateNetworkConditions", { offline: false, latency, downloadThroughput: -1, uploadThroughput: -1 });

    const failures: string[] = [];
    const report: Json = { base, latency, viewports: {} };
    const shotsDir = flag("--shots");
    const tag = flag("--tag") ?? "shot";

    for (const vp of args.includes("--overlap-only") ? [] : VIEWPORTS) {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: vp.width, height: vp.height, deviceScaleFactor: 1, mobile: vp.mobile });
      const tok = (await (await fetch(`${control}/token`, { method: "POST" })).json()) as { token: string; link: string };
      // A full page load: waits for the app to render and nothing in it to be loading, then for `wait` more.
      const go = async (url: string, wait = 3000) => {
        await cdp.send("Page.navigate", { url });
        await sleep(300);
        for (let i = 0; i < 100; i++) {
          const ready = await cdp.eval<boolean>(`document.readyState === "complete" && !!document.querySelector("footer.footer") && !document.querySelector(".loading")`).catch(() => false);
          if (ready) break;
          await sleep(100);
        }
        await sleep(wait);
      };
      // Sign in: the magic link sets the cookie and lands on Start Here.
      await go(tok.link.replace(/^http:\/\/localhost:\d+/, base));

      // Fresh loads: the layout shift of a whole page load, fonts included (a cold cache per viewport).
      await cdp.send("Network.clearBrowserCache");
      const loads: Record<string, { cls: number; shifts: Shift[] }> = {};
      for (const r of ROUTES) {
        await go(base + r.href, 4000);
        const shifts = await cdp.eval<Shift[]>("window.__ls");
        loads[r.name] = { cls: sum(shifts), shifts };
        if (sum(shifts) >= 0.02) failures.push(`${vp.name}: a fresh load of ${r.href} shifts ${sum(shifts)} (limit 0.02): ${shifts.flatMap((s) => s.sources).slice(0, 4).join("; ")}`);
      }

      // Navigation: forward through every route, back again, then forward once more (with the change pill now known).
      await go(base + "/", 3000);
      const order = [...ROUTES.map((r) => r.href), ...ROUTES.map((r) => r.href).reverse().slice(1), ...ROUTES.map((r) => r.href).slice(1)];
      const steps: Step[] = [];
      const settled = new Map<string, Frame[]>();
      let from = "/";
      settled.set("/", [await cdp.eval<Frame>(FRAME)]);
      for (const href of order.slice(1)) {
        const { frames, shifts } = await navigate(cdp, href);
        steps.push({ from: nameOf(from), to: nameOf(href), frames, shifts, cls: sum(shifts) });
        settled.set(href, [...(settled.get(href) ?? []), last(frames)]);
        from = href;
      }
      // Checks on every step.
      const widths = new Set<number>();
      for (const s of steps) {
        const a = s.frames[0]!;
        const z = last(s.frames);
        for (const f of s.frames) widths.add(f.cw);
        if (s.cls > 0) failures.push(`${vp.name}: ${s.from} -> ${s.to} shifts ${s.cls}: ${s.shifts.flatMap((x) => x.sources).slice(0, 4).join("; ")}`);
        // Where the footer shows in the viewport (null when it is below the fold).
        const seen = s.frames.map((f) => (f.box.top < f.vh ? f.box.top : null));
        const changes = seen.filter((v, i) => i > 0 && v !== seen[i - 1]).length;
        if (changes > 1) failures.push(`${vp.name}: ${s.from} -> ${s.to}: the footer moved ${changes} times in view (${[...new Set(seen)].join(", ")})`);
        const short = (f: Frame) => f.sh <= f.vh;
        if (short(a) && short(z) && changes > 0) failures.push(`${vp.name}: ${s.from} -> ${s.to}: both pages short, but the footer moved (${[...new Set(seen)].join(", ")})`);
        if (short(z) && Math.abs(z.box.bottomGap) > 0.5) failures.push(`${vp.name}: ${s.to} is short, but the footer's bottom is ${z.box.bottomGap}px off the viewport's`);
      }
      if (widths.size > 1) failures.push(`${vp.name}: the viewport width changed between pages (${[...widths].join(", ")})`);
      // The footer's box, before and after a round trip through every route, on the shortest and the longest page.
      const finals = ROUTES.map((r) => ({ href: r.href, frames: settled.get(r.href) ?? [] })).filter((x) => x.frames.length > 0);
      const byHeight = [...finals].sort((x, y) => last(x.frames).sh - last(y.frames).sh);
      const shortest = byHeight[0]!;
      const longest = last(byHeight);
      for (const pick of [shortest, longest]) {
        const boxes = pick.frames.map((f) => (f.sh <= f.vh ? `${f.box.top}/${f.box.height}` : `${f.box.docTop}/${f.box.height}`));
        if (new Set(boxes).size > 1) failures.push(`${vp.name}: the footer on ${nameOf(pick.href)} is not where it was after a round trip (${boxes.join(" vs ")})`);
      }
      // Screenshots of the footer on the shortest and the longest page.
      if (shotsDir) {
        mkdirSync(shotsDir, { recursive: true });
        for (const [label, pick] of [
          ["shortest", shortest],
          ["longest", longest],
        ] as const) {
          await navigate(cdp, pick.href, 2000);
          await cdp.eval(`(async () => { scrollTo(0, document.documentElement.scrollHeight); await new Promise((r) => setTimeout(r, 900)); })()`);
          const f = await cdp.eval<Frame>(FRAME);
          const y = Math.max(0, f.sy + f.box.top - 160);
          const shot = (await cdp.send("Page.captureScreenshot", { format: "jpeg", quality: 82, captureBeyondViewport: true, clip: { x: 0, y, width: vp.width, height: Math.min(f.sh - y, f.box.height + 160), scale: 1 } })) as { data: string };
          writeFileSync(join(shotsDir, `${tag}-${vp.name}-${label}-${nameOf(pick.href)}.jpg`), Buffer.from(shot.data, "base64"));
          await cdp.eval("scrollTo(0, 0)");
        }
      }

      // State changes: the clock ticking, a practice match from start to profiler, and the wire connection panel.
      // During a live match the board's errands arrive, flip and expire and the caption lines roll up: that is the
      // game moving, reported on its own as `play`. Everything else (`cls`) must not move at all.
      const PLAY = /^(li\.errand|li\.ticker-line|ol\.ticker|div\.body-head|span\.body-score|text in span\.(mono\.small|body-score|pcard-num|energy-num))/;
      const isPlay = (x: Shift) => x.sources.length > 0 && x.sources.every((src) => PLAY.test(src));
      const states: Record<string, { cls: number; play: number; shifts: Shift[] }> = {};
      const measure = async (name: string, body: string, ms: number) => {
        const shifts = await cdp.eval<Shift[]>(`(async () => { const mark = window.__ls.length; ${body}; await new Promise((r) => setTimeout(r, ${ms})); return window.__ls.slice(mark); })()`);
        const layout = shifts.filter((x) => !isPlay(x));
        states[name] = { cls: sum(layout), play: sum(shifts.filter(isPlay)), shifts };
        if (sum(layout) > 0) failures.push(`${vp.name}: ${name} shifts ${sum(layout)}: ${layout.flatMap((x) => x.sources).slice(0, 4).join("; ")}`);
      };
      await navigate(cdp, "/", 1500);
      await measure("clock ticking (5 s on Start Here)", "", 5000);
      if (args.includes("--states")) {
        await navigate(cdp, "/practice", 2500);
        const click = (text: string) => `[...document.querySelectorAll("button")].find((b) => b.textContent.trim() === ${JSON.stringify(text)})?.click()`;
        await measure("practice: start to profiler at 4x", `${click("4x")}; await new Promise((r) => setTimeout(r, 300)); ${click("Start a match")}`, 40_000);
        await navigate(cdp, "/practice", 2000);
        await cdp.eval(click("wire client"));
        await sleep(800);
        await fetch(`${control}/practice?token=${tok.token}&n=1`, { method: "POST" });
        await measure("practice: watching a wire match (connection panel)", click("Watch"), 25_000);
        if (vp.name === "desktop") {
          // The official run: the first row goes live, plays out and finishes while the next row starts.
          await navigate(cdp, "/official", 2500);
          await fetch(`${control}/official?token=${tok.token}`, { method: "POST" });
          await measure("official run: a row live, then done", "", 130_000);
        }
        await navigate(cdp, "/", 1500);
      }
      (report.viewports as Json)[vp.name] = {
        loads: Object.fromEntries(Object.entries(loads).map(([k, v]) => [k, v])),
        navigation: steps.map((s) => ({ from: s.from, to: s.to, cls: s.cls, footer: [...new Set(s.frames.map((f) => `${f.box.top}@${f.sh}`))], widths: [...new Set(s.frames.map((f) => f.cw))], shifts: s.shifts })),
        states,
        shortest: nameOf(shortest.href),
        longest: nameOf(longest.href),
      };
      const navByRoute = Object.fromEntries(ROUTES.map((r) => [r.name, Math.round(steps.filter((s) => s.to === r.name).reduce((m, s) => Math.max(m, s.cls), 0) * 10000) / 10000]));
      console.log(`${vp.name}: fresh-load CLS ${JSON.stringify(Object.fromEntries(Object.entries(loads).map(([k, v]) => [k, v.cls])))}`);
      console.log(`${vp.name}: worst navigation CLS into each route ${JSON.stringify(navByRoute)}`);
      console.log(`${vp.name}: states (layout / the game's own motion) ${JSON.stringify(Object.fromEntries(Object.entries(states).map(([k, v]) => [k, `${v.cls} / ${v.play}`])))}`);
      console.log(`${vp.name}: shortest ${nameOf(shortest.href)}, longest ${nameOf(longest.href)}, viewport widths ${[...widths].join(", ")}`);
    }
    // Nothing overlaps at any width from a phone to a desktop: the idle cards over the Practice arena (the wire
    // client's is the tallest) stay inside the arena, the arena stays under its controls, and no page scrolls sideways.
    const overlaps: Record<string, string> = {};
    {
      const tok = (await (await fetch(`${control}/token`, { method: "POST" })).json()) as { link: string };
      await cdp.send("Page.navigate", { url: tok.link.replace(/^http:\/\/localhost:\d+/, base) });
      await sleep(3000);
      for (const [w, h] of [
        [375, 812],
        [600, 800],
        [800, 600],
        [1024, 700],
        [1280, 720],
        [1440, 900],
      ] as const) {
        await cdp.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: w < 700 });
        for (const route of ["/practice", "/practice?mode=wire", "/practice?mode=code", "/practice?mode=hand"]) {
          await cdp.send("Page.navigate", { url: base + route });
          await sleep(2500);
          const bad = await cdp.eval<string[]>(`(() => {
            const r = (s) => document.querySelector(s)?.getBoundingClientRect();
            const out = [];
            const stage = r(".stage"), card = r(".stage > .stage-overlay > *"), acts = r(".practice-actions"), bar = r(".practice-bar"), side = r(".practice-side");
            if (stage && card && (card.top < stage.top - 0.5 || card.bottom > stage.bottom + 0.5)) out.push("the card over the arena spills out of it (" + Math.round(card.top) + "-" + Math.round(card.bottom) + " in " + Math.round(stage.top) + "-" + Math.round(stage.bottom) + ")");
            for (const [n, b] of [["the mode bar", bar], ["the match buttons", acts]]) if (stage && b && b.bottom > stage.top + 0.5) out.push("the arena overlaps " + n);
            if (stage && side && side.left < stage.right - 0.5 && side.top < stage.bottom - 0.5 && side.bottom > stage.top + 0.5) out.push("the arena overlaps the board column");
            const d = document.documentElement;
            if (d.scrollWidth > d.clientWidth) out.push("the page scrolls sideways (" + d.scrollWidth + " > " + d.clientWidth + ")");
            return out;
          })()`);
          if (shotsDir && w === 800 && route === "/practice?mode=wire") {
            // Two real viewports (a full-page capture would paint the fixed footer at the wrong place): the top, and
            // scrolled to the end of the arena.
            for (const [part, js] of [
              ["top", "scrollTo(0, 0)"],
              ["arena", `scrollTo(0, Math.max(0, document.querySelector(".stage").getBoundingClientRect().bottom + scrollY - innerHeight + 24))`],
            ] as const) {
              await cdp.eval(`(async () => { ${js}; await new Promise((r) => setTimeout(r, 600)); })()`);
              const shot = (await cdp.send("Page.captureScreenshot", { format: "jpeg", quality: 82 })) as { data: string };
              writeFileSync(join(shotsDir, `${tag}-800x600-practice-wire-${part}.jpg`), Buffer.from(shot.data, "base64"));
            }
            await cdp.eval("scrollTo(0, 0)");
          }
          if (bad.length) {
            overlaps[`${w}x${h} ${route}`] = bad.join("; ");
            failures.push(`${w}x${h} ${route}: ${bad.join("; ")}`);
          }
        }
      }
      console.log(`overlap: ${Object.keys(overlaps).length ? JSON.stringify(overlaps) : "none at 375, 600, 800, 1024, 1280 and 1440 wide"}`);
      report.overlaps = overlaps;
    }
    cdp.close();
    const out = flag("--report");
    if (out) writeFileSync(out, JSON.stringify(report, null, 2));
    for (const f of failures) console.log(`FAIL ${f}`);
    console.log(failures.length ? `layout-check: ${failures.length} failed` : "layout-check: all green");
    return failures.length ? 1 : 0;
  } finally {
    for (const p of procs) p.kill("SIGTERM");
    await sleep(300);
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().then(
  (code) => process.exit(code),
  (e: unknown) => {
    console.error(e);
    process.exit(1);
  },
);
