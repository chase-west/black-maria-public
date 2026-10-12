import type { ServerMsg } from "@blackmaria/protocol";
import { api, wsUrl } from "../api.js";
import { workerSource } from "../editor/runtime.js";
import { STARTER_JS } from "../editor/starter.js";
import { OrphanGate } from "../live/orphans.js";
import { LiveMatch } from "../live/socket.js";
import { STOP_GRACE_MS, type Settings, type Transport, type TransportHandlers } from "./slot.js";

/**
 * Leave a match from a short-lived socket of its own. Any connection on your token can leave your match, so this
 * cleans up after a worker that had to be killed (its code stuck in a loop) before it could leave.
 */
function leaveFromAside(token: string, matchId: string, h: TransportHandlers): void {
  const ws = new WebSocket(wsUrl());
  ws.onopen = () => ws.send(JSON.stringify({ type: "hello", token, name: "portal-stop" }));
  ws.onmessage = (ev) => {
    let m: ServerMsg;
    try {
      m = JSON.parse(String(ev.data)) as ServerMsg;
    } catch {
      return;
    }
    if (m.type === "welcome") ws.send(JSON.stringify({ type: "leave", match_id: matchId }));
  };
  setTimeout(() => ws.close(), STOP_GRACE_MS);
  // The match ends on the server a moment later; its profiler appearing means the replay is there too.
  let tries = 0;
  const poll = () =>
    void api.profile(matchId).then(
      (x) => (x.profiler ? h.replayReady?.(matchId) : ++tries < 8 && setTimeout(poll, 600)),
      () => ++tries < 8 && setTimeout(poll, 600),
    );
  setTimeout(poll, 600);
}

/** A bot (the starter, or your code) in a Web Worker in this tab, playing one match. */
function workerTransport(token: string, s: Settings, h: TransportHandlers): Transport {
  const blob = new Blob([workerSource(s.mode === "code" ? s.code : STARTER_JS)], { type: "text/javascript" });
  const url = URL.createObjectURL(blob);
  const w = new Worker(url);
  URL.revokeObjectURL(url);
  let alive = true;
  let matchId: string | null = null;
  let ended = false;
  const kill = () => {
    if (!alive) return;
    alive = false;
    w.terminate();
  };
  w.onerror = (e) => {
    h.log("error", `your code: ${e.message}${e.lineno ? ` (line ${e.lineno})` : ""}`);
    e.preventDefault();
    if (!alive) return;
    kill();
    if (matchId && !ended) leaveFromAside(token, matchId, h);
    h.closed();
  };
  w.onmessage = (e: MessageEvent) => {
    const m = e.data as { type: string; level?: string; text?: string; msg?: ServerMsg };
    if (m.type === "log") h.log(m.level ?? "log", m.text ?? "");
    else if (m.type === "server" && m.msg) {
      if (m.msg.type === "match_start" && !matchId) matchId = m.msg.match_id;
      if (m.msg.type === "match_end" && m.msg.match_id === matchId) ended = true;
      h.server(m.msg);
    } else if (m.type === "done" || m.type === "closed") {
      // The worker has closed its socket; nothing more will come.
      kill();
      h.closed();
    }
  };
  w.postMessage({ type: "init", token, url: wsUrl(), tier: s.tier, speed: s.speed });
  return {
    stop() {
      if (!alive) return;
      w.postMessage({ type: "stop" });
      // If your code is stuck, the worker never gets to leave: close it and leave from a socket of our own.
      setTimeout(() => {
        if (!alive) return;
        h.log("warn", "your code didn't stop in time, so it was shut down");
        kill();
        if (matchId && !ended) leaveFromAside(token, matchId, h);
      }, STOP_GRACE_MS);
    },
    kill,
    leave(id) {
      if (alive) w.postMessage({ type: "leave", match_id: id });
    },
  };
}

/** Playing by hand: the page's own socket. */
function handTransport(token: string, s: Settings, h: TransportHandlers): Transport {
  const live = new LiveMatch(
    token,
    s.tier,
    {
      onStart: (m) => h.server(m),
      onState: (m) => h.server(m),
      onEnd: (m) => h.server(m),
      onProfile: (report) => h.server({ type: "profile", match_id: report.match_id, report }),
      onError: (m) => h.server(m),
      onClose: () => h.closed(),
    },
    s.speed,
  );
  return {
    stop: () => live.leave(),
    kill: () => live.close(),
    leave: () => undefined,
    submit: (intent) => void live.submit(intent),
  };
}

/** Watching your own wire client: the server mirrors this token's wire matches to this socket. */
function watchTransport(token: string, h: TransportHandlers): Transport {
  const ws = new WebSocket(wsUrl());
  // A practice match left behind by a reload would be handed to this socket too; it isn't a wire match.
  const gate = new OrphanGate(
    (id) => ws.send(JSON.stringify({ type: "leave", match_id: id })),
    () => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ type: "watch" })),
  );
  ws.onopen = () => ws.send(JSON.stringify({ type: "hello", token, name: "portal-watch" }));
  ws.onmessage = (ev) => {
    let m: ServerMsg;
    try {
      m = JSON.parse(String(ev.data)) as ServerMsg;
    } catch {
      return;
    }
    if (gate.take(m)) return;
    if (m.type === "welcome") gate.welcome();
    else h.server(m);
  };
  ws.onclose = () => h.closed();
  return { stop: () => ws.close(), kill: () => ws.close(), leave: () => undefined };
}

/** The transport for a slot's settings. */
export function openTransport(token: string, s: Settings, h: TransportHandlers): Transport {
  if (s.mode === "hand") return handTransport(token, s, h);
  if (s.mode === "wire") return watchTransport(token, h);
  return workerTransport(token, s, h);
}
