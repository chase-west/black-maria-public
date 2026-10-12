"""The client's measurements, Python: one record per tick per match, the summary block, and doctor's facts.

The same code as src/meter.ts, src/doctor.ts and @blackmaria/protocol/wire's trace.ts, and it prints the same text.
The transport feeds it what it sees, with the time it saw it (ms), and nothing else.

The server's clock is never on the wire, so the deadline for tick t is estimated: it starts when the server sent that
tick's STATE, which is about when the least-delayed STATE of recent ticks says it should be. That is the smallest
(arrival - tick * tick_ms) over the last 10 STATEs.
"""

import math

# Nothing arriving for at least this long, with a match running, is a blackout, whatever caused it.
BLACKOUT_MS = 400
MARGIN_BUCKETS = ["late", "0-49 ms", "50-99 ms", "100-149 ms", "150-199 ms", "200+ ms"]
# A tick's record is final once a STATE this many ticks later has arrived, or the match ended.
FINAL_LAG = 3
ANCHOR_WINDOW = 10
MISSING_CAP = 4096
BAR_MAX = 30
PROBE_TICKS = 60


def margin_bucket(ms):
    if ms < 0:
        return 0
    return min(len(MARGIN_BUCKETS) - 1, 1 + ms // 50)


def percentile(xs, p):
    """Nearest-rank percentile of whole numbers, or None for none."""
    if not xs:
        return None
    s = sorted(xs)
    i = max(0, min(len(s) - 1, math.ceil(p * len(s) / 100) - 1))
    return s[i]


def pct(part, whole):
    """`part` of `whole` as a percentage with one decimal, rounded down."""
    if whole <= 0:
        return "0.0"
    tenths = (1000 * part) // whole
    return "%d.%d" % (tenths // 10, tenths % 10)


STATUS_WORDS = {"on_time": "on time", "late": "late", "missing": "missing"}


def _ms(v, signed):
    if v is None:
        return "-"
    return "%s%d ms" % ("+" if signed and v >= 0 else "", v)


def trace_header():
    return "%s  %s  %s  %s  %s  %s  %s  %s" % ("match".rjust(5), "tick".rjust(4), "state".ljust(9), "think".ljust(7),
                                              "sent".ljust(9), "move".ljust(7), "resync".ljust(6), "gap".rjust(3))


def trace_line(r):
    state = "missing" if r["state_ms"] is None else _ms(r["state_ms"], True)
    return "%s  %s  %s  %s  %s  %s  %s  %s" % (str(r["match"]).rjust(5), str(r["tick"]).rjust(4), state.ljust(9),
                                              _ms(r["think_ms"], False).ljust(7), _ms(r["sent_ms"], True).ljust(9),
                                              STATUS_WORDS[r["status"]].ljust(7), ("yes" if r["resync"] else "no").ljust(6),
                                              str(r["seq_gap"]).rjust(3))


def summary_lines(s):
    def row(label, value):
        return "  %s %s" % (label.ljust(16), value)

    out = [s["title"]]
    out.append(row("on time", "%d of %d (%s%%)" % (s["on_time"], s["ticks"], pct(s["on_time"], s["ticks"]))))
    out.append(row("moves late", str(s["late"])))
    out.append(row("moves missing", str(s["missing"])))
    out.append(row("round trip", "no PONG came back" if s["rtt_p50"] is None else
                   "p50 %d ms, p95 %d ms, from %d pings" % (s["rtt_p50"], s["rtt_p95"], s["pings"])))
    out.append(row("packets lost", "%d of %d (gaps in the server's seq)" % (s["lost"], s["lost"] + s["received"])))
    out.append(row("duplicates", "%d arrived twice" % s["duplicates"] if s["duplicates_ignored"] is None else
                   "%d of %d ignored" % (s["duplicates_ignored"], s["duplicates"])))
    out.append(row("resyncs", str(s["resyncs"]) if s["blind"] is None else
                   "%d, and %d deltas applied to a base it never got" % (s["resyncs"], s["blind"])))
    b = s["blackout"]
    out.append(row("blackout", "none seen" if b is None else "%d ms from tick %d: acted on %d of %d ticks%s" % (
        b["ms"], b["from_tick"], b["acted"], b["ticks"], ", survived" if b["ticks"] > 0 and b["acted"] == b["ticks"] else "")))
    top = max([1] + list(s["margins"]))
    for i, name in enumerate(MARGIN_BUCKETS):
        n = s["margins"][i]
        bar = "" if n == 0 else "#" * max(1, (n * BAR_MAX) // top)
        out.append(("  %s %s %s  %s" % (("deadline margin" if i == 0 else "").ljust(16), name.ljust(10), str(n).rjust(4), bar)).rstrip())
    return out


def _n(n, one, many):
    return "%d %s" % (n, one if n == 1 else many)


def findings(s):
    """The facts behind the summary block, one line each. The same lines as src/doctor.ts."""
    out = []
    b = s["blackout"]
    out.append("%d of %d ticks had no move before the deadline: %d with none sent, %d sent late."
               % (s["missing"] + s["late"], s["ticks"], s["missing"], s["late"]))
    if b is not None:
        out.append("%d of the %s inside the %d ms silent window from tick %d had no move before the deadline."
                   % (b["ticks"] - b["acted"], _n(b["ticks"], "tick", "ticks"), b["ms"], b["from_tick"]))
    else:
        out.append("No silent window of 400 ms or more in this probe.")
    if s["blind"] is not None:
        out.append("%s named a base you never received and %s applied anyway; %s sent."
                   % (_n(s["blind"], "delta", "deltas"), "was" if s["blind"] == 1 else "were", _n(s["resyncs"], "RESYNC", "RESYNCs")))
    out.append("%d of %d packets from the server never arrived." % (s["lost"], s["lost"] + s["received"]))
    if s["duplicates_ignored"] is not None:
        out.append("%s arrived twice; %d of them skipped." % (_n(s["duplicates"], "packet", "packets"), s["duplicates_ignored"]))
    out.append("No PONG came back, so no round trip." if s["rtt_p50"] is None else
               "RTT p50 %d ms, p95 %d ms, from %s." % (s["rtt_p50"], s["rtt_p95"], _n(s["pings"], "PING", "PINGs")))
    return out


class _MatchMeter:
    def __init__(self, match):
        self.match = match
        self.tick_ms = 250
        self.deadline_ms = 250
        self.anchors = []
        self.open = {}
        self.records = []
        self.starts = []
        self.next = 0
        self.max_tick = -1
        self.resyncs = 0
        self.blind = 0
        self.first_at = None
        self.last_at = None
        self.done = False

    def anchor(self):
        return min(self.anchors) if self.anchors else None

    def tick(self, t):
        o = self.open.get(t)
        if o is None:
            o = {"state_at": None, "deadline_ms": None, "sent_at": None, "think_ms": None, "resync": False, "gap": 0}
            self.open[t] = o
        return o


class Meter:
    def __init__(self, on_record=None):
        self.on_record = on_record or (lambda r: None)
        self.max_seq = 0
        self.missing_seqs = {}  # an insertion-ordered set
        self.lost_old = 0
        self.received = 0
        self.duplicates = 0
        self.ignored = 0
        self.rtts = []
        self.last_arrival = None
        self.silences = []
        self.matches = {}

    def _m(self, match):
        if match not in self.matches:
            self.matches[match] = _MatchMeter(match)
        return self.matches[match]

    def datagram(self, seq, at):
        """Any datagram from the server that decoded: ("new" | "late" | "duplicate", seqs it skipped)."""
        if self.last_arrival is not None and at - self.last_arrival >= BLACKOUT_MS:
            self.silences.append((self.last_arrival, at))
        self.last_arrival = at
        if seq == 0:
            return "new", 0
        if seq > self.max_seq:
            gap = seq - self.max_seq - 1
            for s in range(self.max_seq + 1, seq):
                if len(self.missing_seqs) >= MISSING_CAP:
                    oldest = next(iter(self.missing_seqs))
                    del self.missing_seqs[oldest]
                    self.lost_old += 1
                self.missing_seqs[s] = True
            self.max_seq = seq
            self.received += 1
            return "new", gap
        if seq in self.missing_seqs:
            del self.missing_seqs[seq]
            self.received += 1
            return "late", 0
        self.duplicates += 1
        return "duplicate", 0

    def ignored_duplicate(self):
        self.ignored += 1

    def pong(self, rtt_ms):
        self.rtts.append(int(math.floor(rtt_ms)))

    def state(self, match, tick, at, deadline_ms, tick_ms, gap):
        m = self._m(match)
        if m.done:
            return
        m.tick_ms = tick_ms
        m.deadline_ms = deadline_ms
        if m.first_at is None:
            m.first_at = at
        m.last_at = at
        o = m.tick(tick)
        if o["state_at"] is None:
            o["state_at"] = at
            o["deadline_ms"] = deadline_ms
            o["gap"] = gap
        m.anchors.append(at - tick * tick_ms)
        if len(m.anchors) > ANCHOR_WINDOW:
            m.anchors.pop(0)
        if tick > m.max_tick:
            m.max_tick = tick
        self._finalize(m, tick - FINAL_LAG)

    def move_sent(self, match, tick, at, think_ms):
        m = self._m(match)
        if m.done:
            return
        o = m.tick(tick)
        if o["sent_at"] is not None:
            return
        o["sent_at"] = at
        o["think_ms"] = think_ms

    def resync(self, match, tick):
        m = self._m(match)
        if m.done:
            return
        m.resyncs += 1
        m.tick(tick)["resync"] = True

    def blind(self, match):
        self._m(match).blind += 1

    def deadline_start(self, match, tick):
        m = self.matches.get(match)
        a = m.anchor() if m is not None else None
        return None if a is None else a + tick * m.tick_ms

    def max_tick(self, match):
        m = self.matches.get(match)
        return -1 if m is None else m.max_tick

    def end(self, match, title, limit=None):
        m = self._m(match)
        if not m.done:
            self._finalize(m, m.max_tick if limit is None else min(m.max_tick, limit - 1))
            m.done = True
        return self._summary(m, title)

    def _finalize(self, m, up_to):
        a = m.anchor()
        one_way = percentile(self.rtts, 50) // 2 if self.rtts else 0
        while m.next <= up_to:
            t = m.next
            o = m.open.pop(t, None)
            start = None if a is None else a + t * m.tick_ms

            def rel(x):
                return None if x is None or start is None else int(math.floor(x - start))

            sent = rel(o["sent_at"] if o else None)
            deadline = o["deadline_ms"] if o and o["deadline_ms"] is not None else m.deadline_ms
            margin = None if sent is None else deadline - sent - one_way
            r = {
                "match": m.match,
                "tick": t,
                "state_ms": rel(o["state_at"] if o else None),
                "think_ms": None if not o or o["think_ms"] is None else int(math.floor(o["think_ms"])),
                "sent_ms": sent,
                "status": "missing" if margin is None else "on_time" if margin >= 0 else "late",
                "margin_ms": margin,
                "resync": o["resync"] if o else False,
                "seq_gap": o["gap"] if o else 0,
            }
            m.records.append(r)
            m.starts.append(start)
            self.on_record(r)
            m.next += 1

    def _summary(self, m, title):
        rs = m.records
        margins = [0] * len(MARGIN_BUCKETS)
        for r in rs:
            if r["margin_ms"] is not None:
                margins[margin_bucket(r["margin_ms"])] += 1
        blackout = None
        if m.first_at is not None and m.last_at is not None:
            best = None
            for s in self.silences:
                if s[0] >= m.first_at and s[1] <= m.last_at and (best is None or s[1] - s[0] > best[1] - best[0]):
                    best = s
            if best is not None:
                inside = [r for i, r in enumerate(rs) if m.starts[i] is not None and m.starts[i] >= best[0]
                          and m.starts[i] + m.deadline_ms <= best[1]]
                after = next((i for i in range(len(rs)) if m.starts[i] is not None and m.starts[i] >= best[0]), -1)
                first = inside[0]["tick"] if inside else rs[after]["tick"] if after >= 0 else m.next
                blackout = {"from_tick": first, "ticks": len(inside), "acted": sum(1 for r in inside if r["status"] == "on_time"),
                            "ms": int(math.floor(best[1] - best[0]))}
        return {
            "title": title,
            "ticks": len(rs),
            "on_time": sum(1 for r in rs if r["status"] == "on_time"),
            "late": sum(1 for r in rs if r["status"] == "late"),
            "missing": sum(1 for r in rs if r["status"] == "missing"),
            "rtt_p50": percentile(self.rtts, 50),
            "rtt_p95": percentile(self.rtts, 95),
            "pings": len(self.rtts),
            "lost": len(self.missing_seqs) + self.lost_old,
            "received": self.received,
            "duplicates": self.duplicates,
            "duplicates_ignored": self.ignored,
            "resyncs": m.resyncs,
            "blind": m.blind,
            "blackout": blackout,
            "margins": margins,
        }
