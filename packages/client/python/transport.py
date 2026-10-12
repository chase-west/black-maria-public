"""The transport, Python: everything between the UDP socket and your bot. Standard library only.

It owns the socket, HELLO and the port fallback, MATCH_START fragments, keyframes and deltas, acks, RESYNC, PING, and
the timing of every tick. It hands your bot a state and sends back what the bot decides.

Five hooks are where you change it. Override them in a subclass, or define them in your --bot file (see the README).
The shipped ones are the naive ones. They have the same names as in src/transport.ts:

    onPacket(packet)                      every decoded packet, before the transport handles it
    shouldResync(delta)                   every delta STATE: by the keyframe it names, or onto the last state
    predictState(last_state, pending)     a tick's STATE hasn't arrived halfway to its deadline
    planMoves(state)                      each state: the move, or a list of moves for this tick and the ones after
    onTick(record)                        a tick is settled: its trace record

One socket carries everything, so the three matches of the official run share it.
"""

import select
import socket
import struct
import time

from meter import Meter, trace_header, trace_line
from wire import (ITEM_KINDS, KEYFRAME, TIERS, TITLE, apply_delta, decode, decode_blob, header, intent_bytes,
                  match_start_json, snapshot_from_keyframe, state_json)

# Hard-coded, like everything the bot sees. The match start has the real numbers.
TICK_MS = 250
PING_EVERY = 1.0
HELLO_EVERY = 0.5
PORT_FALLBACK = 2.0  # SPEC 5.2: no HELLO_ACK within 2 s on a port, try the next one
RESYNC_MIN_MS = 100  # the server answers at most one RESYNC per 100 ms per match
LEAVE_EVERY = 0.2
PREDICT_AT = 0.5  # how far into a tick (share of its deadline) predictState is called when its STATE hasn't come
PREDICT_RUN = 40  # how many ticks past the last STATE to keep predicting
MAX_PLANNED = 16  # at most this many moves from one planMoves call
KEYFRAMES_KEPT = 8
SENT_KEPT = 64
WAIT = {"kind": "WAIT"}
HOOK_NAMES = ["onPacket", "shouldResync", "predictState", "planMoves", "onTick"]


class ClientError(Exception):
    """A sentence for the candidate."""


def now_ms():
    return time.monotonic() * 1000.0


class _Match:
    def __init__(self, mid):
        self.id = mid
        self.parts = None
        self.start = None
        self.kinds = {}
        self.bot = None
        self.latest = None  # the state the last STATE built, whatever its tick
        self.keyframes = {}  # keyframes by tick, the newest few
        self.last_state = None  # the state for the newest tick, as the bot saw it
        self.sent = {}  # the first move sent for each recent tick
        self.last_resync = float("-inf")
        self.ended = False
        self.leaving = False
        self.leave_at = None
        self.states = 0
        self.moves = 0
        self.early = []
        self.predict = None  # (when in ms, tick)
        self.traced = False


class Transport:
    def __init__(self, host, ports, token, official, tier, chaos, matches, bot_factory, log=None, on_hello_ack=None,
                 connect_timeout=20.0, trace=False, out=None, on_summary=None, probe_ticks=None):
        self.host, self.ports, self.token = host, list(ports), token
        self.port_index = 0
        self.port = self.ports[0]
        self.official, self.tier, self.chaos = official, tier, chaos
        self.want = 9 if official else max(1, matches)
        self.bot_factory = bot_factory
        self.log = log or (lambda line: None)
        self.out = out or self.log
        self.on_hello_ack = on_hello_ack
        self.on_summary = on_summary
        self.connect_timeout = connect_timeout
        self.trace = trace
        self.probe_ticks = probe_ticks
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.sock.bind(("0.0.0.0", 0))
        self.seq = 0
        self.ack_in = 0
        self.session = 0
        self.matches = {}
        self.done = []
        self.started = 0
        self.hello_at = None
        self.hello_since = None
        self.ping_at = None
        self.connected = False
        # The measurements behind --trace and the summary block.
        self.meter = Meter(self._settled)

    # -----------------------------------------------------------------------------------------------------------------
    # The hooks.

    def onPacket(self, packet):  # noqa: N802 - the same name as in TypeScript
        """Called with every decoded packet before the transport handles it; returning False drops it.
        Shipped: README weakness 3."""
        return True

    def shouldResync(self, delta):  # noqa: N802
        """Called with every delta STATE; True applies it to the keyframe it names, or sends RESYNC and skips it when
        that keyframe isn't held; False applies it to the last state built. Shipped: README weakness 2."""
        return False

    def predictState(self, last_state, pending_moves):  # noqa: N802
        """Called when a tick's deadline is half gone and its STATE has not arrived, with the last state and the moves
        sent since; a state returned is passed to planMoves, None sends nothing. Shipped: README weakness 1."""
        return None

    def planMoves(self, state):  # noqa: N802
        """Called with each state; returns a move for state["tick"], or a list of moves sent for ticks state["tick"],
        state["tick"] + 1, and so on. Shipped: README weakness 1 (it calls your bot's decide once)."""
        bot = self.bot_for(state["match_id"])
        return bot.decide(state) if bot is not None else WAIT

    def onTick(self, record):  # noqa: N802
        """Called once per settled tick with its trace record; the shipped one prints it with --trace."""
        if self.trace:
            self.out(trace_line(record))

    # -----------------------------------------------------------------------------------------------------------------

    def bot_for(self, match_id):
        m = self.matches.get(int(match_id))
        return None if m is None else m.bot

    def send(self, ptype, payload):
        self.seq = (self.seq + 1) & 0xFFFFFFFF
        self.sock.sendto(header(ptype, self.session, self.seq, self.ack_in) + payload, (self.host, self.port))

    def hello(self):
        self.session = 0
        self.hello_since = time.monotonic()
        self.send_hello()

    def send_hello(self):
        self.hello_at = time.monotonic()
        self.send(0x01, self.token + struct.pack("<BBB", 1 if self.official else 0, self.tier, self.chaos))

    def run(self):
        start = time.monotonic()
        self.hello()
        try:
            while len(self.done) < self.want:
                now = time.monotonic()
                if not self.connected and now - start > self.connect_timeout:
                    raise ClientError("No answer from the server at %s on UDP port %s. Check the host and that your network lets UDP out."
                                      % (self.host, " or ".join(str(p) for p in self.ports)))
                if self.session == 0 and self.hello_since is not None:
                    if now - self.hello_since > PORT_FALLBACK:
                        self.port_index = (self.port_index + 1) % len(self.ports)
                        nxt = self.ports[self.port_index]
                        if nxt != self.port:
                            self.log("No answer on UDP port %d; trying port %d." % (self.port, nxt))
                        self.port = nxt
                        self.hello()
                    elif now - self.hello_at > HELLO_EVERY:
                        self.send_hello()
                if self.session != 0 and (self.ping_at is None or now - self.ping_at > PING_EVERY):
                    self.ping_at = now
                    self.send(0x04, struct.pack("<I", int(now_ms()) & 0xFFFFFFFF))
                wait = self.timers()
                ready, _, _ = select.select([self.sock], [], [], max(0.0, min(0.05, wait)))
                if ready:
                    buf, _addr = self.sock.recvfrom(2048)
                    self.on_datagram(buf)
        finally:
            self.sock.close()
        return self.done

    def timers(self):
        """Run the predict and leave timers that are due. Returns seconds until the next one."""
        nxt = 0.05
        for m in list(self.matches.values()):
            if m.ended:
                continue
            if m.predict is not None and now_ms() >= m.predict[0]:
                tick = m.predict[1]
                m.predict = None
                self.predict_tick(m, tick)
            if m.predict is not None:
                nxt = min(nxt, (m.predict[0] - now_ms()) / 1000.0)
            if m.leaving and (m.leave_at is None or time.monotonic() - m.leave_at >= LEAVE_EVERY):
                m.leave_at = time.monotonic()
                self.send(0x06, struct.pack("<H", m.id))
        return nxt

    def on_datagram(self, buf):
        at = now_ms()
        d = decode(buf)
        if d is None:
            return
        ptype, seq, p = d
        if seq > self.ack_in:
            self.ack_in = seq
        kind, gap = self.meter.datagram(seq, at)
        keep = True
        try:
            keep = self.onPacket(p) is not False
        except Exception as err:  # noqa: BLE001 - a hook that raises doesn't stop the client
            self.log("onPacket raised: %s" % err)
        if not keep:
            if kind == "duplicate":
                self.meter.ignored_duplicate()
            return
        if ptype == 0x81:
            self.session = p["session"]
            self.hello_since = None
            self.connected = True
            if self.on_hello_ack:
                self.on_hello_ack(p)
        elif ptype == 0x82:
            self.on_fragment(p)
        elif ptype == 0x83:
            self.on_state(p, at, gap)
        elif ptype == 0x84:
            self.on_end(p)
        elif ptype == 0x85:
            if kind != "duplicate":
                self.meter.pong(((int(at) & 0xFFFFFFFF) - p["client_ms"]) & 0xFFFFFFFF)
        elif ptype == 0x86:
            if p["code"] in (1, 2, 3):
                raise ClientError(p["msg"])
            if p["code"] == 7:
                self.log("Server closed the session. Reconnecting.")
                self.hello()

    def match(self, mid):
        if mid not in self.matches:
            self.matches[mid] = _Match(mid)
        return self.matches[mid]

    def on_fragment(self, p):
        m = self.match(p["match"])
        self.send(0x05, struct.pack("<HB", p["match"], p["frag"]))
        if m.start is not None or m.ended:
            return
        if p["frag_count"] < 1 or p["frag"] >= p["frag_count"]:
            return
        if m.parts is None:
            m.parts = [None] * p["frag_count"]
        if len(m.parts) != p["frag_count"]:
            return
        if m.parts[p["frag"]] is None:
            m.parts[p["frag"]] = p["data"]
        if any(x is None for x in m.parts):
            return
        blob = decode_blob(b"".join(m.parts))
        if blob is None:
            return
        m.start = match_start_json(blob, str(p["match"]), "official" if self.official else "practice")
        m.kinds = {i["id"]: ITEM_KINDS[i["kind"]] for i in blob["items"]}
        m.bot = self.bot_factory()
        if hasattr(m.bot, "on_start"):
            m.bot.on_start(m.start)
        self.started += 1
        self.log("Match %d started against Maria (%s)." % (p["match"], TITLE[m.start["tier"]]))
        early, m.early = m.early, []
        for s in early:
            self.on_state(*s)

    def on_state(self, p, at, gap):
        m = self.match(p["match"])
        if m.ended or m.leaving:
            return
        if m.start is None:
            if len(m.early) < 32:
                m.early.append((p, at, gap))
            return
        m.states += 1
        self.meter.state(p["match"], p["tick"], at, p["deadline_ms"], m.start["params"]["tick_ms"], gap)
        if self.probe_ticks is not None and p["tick"] >= self.probe_ticks:
            self.leave(m)
            return
        snap = None
        if p["base"] == KEYFRAME:
            snap = snapshot_from_keyframe(p)
            if snap is not None:
                m.keyframes[p["tick"]] = snap
                if len(m.keyframes) > KEYFRAMES_KEPT:
                    del m.keyframes[next(iter(m.keyframes))]
        else:
            base = m.keyframes.get(p["base"])
            by_the_book = False
            try:
                by_the_book = bool(self.shouldResync({"match": p["match"], "tick": p["tick"], "base": p["base"], "have_base": base is not None}))
            except Exception as err:  # noqa: BLE001
                self.log("shouldResync raised: %s" % err)
            if by_the_book:
                # By the book: onto the keyframe it names, or, without that keyframe, ask for a new one and skip this delta.
                if base is not None:
                    snap = apply_delta(base, p)
                else:
                    self.resync(m, p["tick"])
            elif m.latest is not None:
                # Shipped: onto whatever state we had last, base or not. Without the base, that's driving blind.
                snap = apply_delta(m.latest, p)
                if base is None:
                    self.meter.blind(p["match"])
        if snap is None or m.bot is None:
            return
        m.latest = snap
        state = state_json(m.start, m.kinds, snap, p.get("events", []), p["tick"], TICK_MS)
        if m.last_state is None or p["tick"] >= m.last_state["tick"]:
            m.last_state = state
        # A line every 100 ticks, so a 100-second match is not 100 seconds of silence.
        if p["tick"] > 0 and p["tick"] % 100 == 0:
            self.log("Match %d: tick %d of %d, you %d, Maria %d." % (p["match"], p["tick"], m.start["params"]["max_tick"], state["scores"]["you"], state["scores"]["maria"]))
        self.act(m, state)
        self.schedule_predict(m, self.meter.max_tick(m.id) + 1)

    def act(self, m, state):
        """Ask the bot (through planMoves) and send what it plans, one INTENT per tick."""
        t0 = now_ms()
        planned = WAIT
        try:
            planned = self.planMoves(state)
        except Exception as err:  # noqa: BLE001 - a bot that raises plays WAIT
            self.log("Your bot raised on tick %d: %s" % (state["tick"], err))
        think = now_ms() - t0
        moves = list(planned)[:MAX_PLANNED] if isinstance(planned, (list, tuple)) else [planned]
        for k, move in enumerate(moves):
            self.send_move(m, state["tick"] + k, move or WAIT, think)

    def send_move(self, m, tick, move, think):
        m.moves += 1
        self.send(0x02, struct.pack("<HH", m.id, tick & 0xFFFF) + intent_bytes(move))
        if tick not in m.sent:
            m.sent[tick] = move
            if len(m.sent) > SENT_KEPT:
                del m.sent[next(iter(m.sent))]
        self.meter.move_sent(m.id, tick, now_ms(), think)

    def schedule_predict(self, m, tick):
        """Halfway into `tick`'s deadline, if its STATE still hasn't come and nothing went out for it, ask predictState."""
        m.predict = None
        start = self.meter.deadline_start(m.id, tick)
        if start is None or m.ended or m.leaving:
            return
        deadline = m.start["params"]["tick_ms"] if m.start else TICK_MS
        m.predict = (start + deadline * PREDICT_AT, tick)

    def predict_tick(self, m, tick):
        if m.ended or m.leaving or m.last_state is None:
            return
        if self.meter.max_tick(m.id) >= tick:
            return
        if tick not in m.sent:
            pending = [m.sent.get(t, WAIT) for t in range(m.last_state["tick"], tick)]
            guess = None
            try:
                guess = self.predictState(m.last_state, pending)
            except Exception as err:  # noqa: BLE001
                self.log("predictState raised: %s" % err)
            if guess is not None:
                guess = dict(guess)
                guess["tick"] = tick
                self.act(m, guess)
        if tick - self.meter.max_tick(m.id) < PREDICT_RUN:
            self.schedule_predict(m, tick + 1)

    def resync(self, m, tick):
        now = now_ms()
        if now - m.last_resync < RESYNC_MIN_MS:
            return
        m.last_resync = now
        self.send(0x03, struct.pack("<H", m.id))
        self.meter.resync(m.id, tick)

    def leave(self, m):
        """doctor: the probe is over. Leave the match (the server plays it out) and say so until MATCH_END comes."""
        if m.leaving:
            return
        m.leaving = True
        m.predict = None
        m.leave_at = time.monotonic()
        self.send(0x06, struct.pack("<H", m.id))

    def _settled(self, r):
        m = self.matches.get(r["match"])
        if self.trace and m is not None and not m.traced:
            m.traced = True
            self.out(trace_header())
        try:
            self.onTick(r)
        except Exception as err:  # noqa: BLE001
            self.log("onTick raised: %s" % err)

    def on_end(self, p):
        m = self.match(p["match"])
        if m.ended:
            return  # MATCH_END comes three times; count it once.
        m.ended = True
        m.predict = None
        m.leaving = False
        result = {2: "win", 1: "draw"}.get(p["result"], "loss")
        if m.bot is not None and hasattr(m.bot, "on_end"):
            m.bot.on_end({"result": result, "scores": {"you": p["score_you"], "maria": p["score_maria"]}})
        tier = m.start["tier"] if m.start else TIERS[self.tier]
        network = m.start["params"]["chaos"] if m.start else "off"
        conn = self.meter.end(p["match"], "Connection, match %d against Maria (%s), network %s:" % (p["match"], TITLE[tier], network),
                              self.probe_ticks)
        summary = {"match": p["match"], "tier": tier, "result": result, "you": p["score_you"], "maria": p["score_maria"],
                   "states": m.states, "moves": m.moves, "conn": conn}
        self.done.append(summary)
        self.log("Match %d ended." % p["match"])
        if self.on_summary:
            self.on_summary(conn, summary)
        if len(self.done) < self.want and not self.official and self.started < self.want:
            self.hello()


# The old name.
Client = Transport


def apply_hooks(transport, hooks):
    """Put hook functions (from a --bot file) onto a transport. Each is called with the transport as its first argument."""
    for name in HOOK_NAMES:
        fn = hooks.get(name)
        if callable(fn):
            setattr(transport, name, fn.__get__(transport))
