/**
 * The Web Worker runtime that hosts the candidate's code in their own browser. It connects to the
 * server over WebSocket and plays one practice match (the official run is played over the wire, not here), reporting
 * everything to the page. Nothing here runs on our servers.
 */
export const RUNTIME_JS = `
"use strict";
const __post = (m) => self.postMessage(m);
const __fmt = (a) => { try { return typeof a === "string" ? a : JSON.stringify(a); } catch { return String(a); } };
for (const level of ["log", "info", "warn", "error"]) {
  console[level] = (...args) => __post({ type: "log", level, text: args.map(__fmt).join(" ") });
}
let __cfg = null, __ws = null, __done = false, __closeTimer = null, __stopping = false;
const __bots = new Map();
self.onmessage = (e) => {
  const m = e.data;
  if (m && m.type === "init") { __cfg = m; __connect(); }
  else if (m && m.type === "stop") { __stop(); }
  else if (m && m.type === "leave") { __send({ type: "leave", match_id: m.match_id }); }
};
// Stop: leave every match so the server plays it out and writes its replay, then close once it has ended (at most 3 s).
function __stop() {
  __stopping = true;
  for (const id of __bots.keys()) __send({ type: "leave", match_id: id });
  setTimeout(__maybeDone, 3000);
}
let __gateOpen = false, __joined = false, __orphansRunning = 0;
const __orphans = new Set();
function __join() { if (__joined || __stopping) return; __joined = true; __send({ type: "join", mode: "practice", tier: __cfg.tier, speed: __cfg.speed || 1 }); }
function __maybeJoin() { if (!__gateOpen && __orphansRunning <= 0) __join(); }
function __send(m) { if (__ws && __ws.readyState === 1) __ws.send(JSON.stringify(m)); }
function __maybeDone() {
  if (__done) return;
  __done = true; __post({ type: "done" }); try { __ws && __ws.close(); } catch {}
}
function __connect() {
  __ws = new WebSocket(__cfg.url);
  __ws.onopen = () => __send({ type: "hello", token: __cfg.token, name: "browser-editor" });
  __ws.onclose = () => { if (!__done) __post({ type: "closed" }); };
  __ws.onerror = () => __post({ type: "log", level: "error", text: "connection error" });
  __ws.onmessage = async (ev) => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    // Matches the server hands back right after welcome were left behind by a reload: leave them, then join.
    if (m.type === "match_start" && __gateOpen) { __orphans.add(m.match_id); __orphansRunning++; __send({ type: "leave", match_id: m.match_id }); return; }
    if (m.match_id && __orphans.has(m.match_id)) { if (m.type === "match_end") { __orphansRunning--; __maybeJoin(); } return; }
    __post({ type: "server", msg: m });
    if (m.type === "welcome") { if (__stopping) __maybeDone(); else { __gateOpen = true; setTimeout(() => { __gateOpen = false; __maybeJoin(); }, 250); setTimeout(__join, 3000); } }
    else if (m.type === "match_start") {
      if (__bots.has(m.match_id)) return;
      if (__stopping) { __send({ type: "leave", match_id: m.match_id }); return; }
      let bot = null;
      try { bot = new Bot(); __bots.set(m.match_id, bot); if (bot.onStart) await bot.onStart(m); }
      catch (err) { console.error("onStart threw:", err && err.message ? err.message : String(err)); }
    } else if (m.type === "state") {
      const bot = __bots.get(m.match_id);
      if (!bot || __stopping) return;
      const received = performance.now();
      const budget = Math.max(0, m.deadline_ms - Math.min(50, m.deadline_ms / 2));
      let settled = false;
      const submit = (intent) => {
        if (settled) return; settled = true; clearTimeout(timer);
        __send({ type: "intent", match_id: m.match_id, tick: m.tick, intent });
        __post({ type: "sent", match_id: m.match_id, tick: m.tick, intent });
      };
      const timer = setTimeout(() => { console.warn("tick " + m.tick + ": decide ran out of time, sent WAIT"); submit({ kind: "WAIT" }); }, budget);
      try {
        const intent = await bot.decide(m);
        if (performance.now() - received > budget) submit({ kind: "WAIT" });
        else submit(intent && typeof intent === "object" ? intent : { kind: "WAIT" });
      } catch (err) {
        console.error("decide threw at tick " + m.tick + ":", err && err.message ? err.message : String(err));
        submit({ kind: "WAIT" });
      }
    } else if (m.type === "match_end") {
      const bot = __bots.get(m.match_id);
      __bots.delete(m.match_id);
      if (__stopping) { if (__bots.size === 0) __maybeDone(); return; }
      try { if (bot && bot.onEnd) await bot.onEnd(m); } catch (err) { console.error("onEnd threw:", String(err)); }
      // The profiler follows match_end on the same socket: wait for it (at most 2 s) before closing.
      __closeTimer = setTimeout(__maybeDone, 2000);
    } else if (m.type === "profile") {
      if (__closeTimer) { clearTimeout(__closeTimer); __closeTimer = null; __maybeDone(); }
    } else if (m.type === "error" && m.code !== "stale_tick") {
      console.warn("server: " + m.code + ": " + m.message);
      if (["window_closed", "clock_expired", "bad_token", "too_many_concurrent", "rate_limited", "server_busy", "bad_message"].includes(m.code) && __bots.size === 0) __maybeDone();
    }
  };
}
`;

/** Build the worker source: runtime, then the candidate's code, then a check that Bot exists. */
export function workerSource(userCode: string): string {
  return `${RUNTIME_JS}\n;// ---- your code ----\n${userCode}\n;// ---- end of your code ----\nif (typeof Bot !== "function") { console.error("Define a class named Bot."); }\n`;
}
