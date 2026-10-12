#!/usr/bin/env python3
"""BLACK MARIA wire client, Python. Standard library only, Python 3.9 or newer.

    python3 blackmaria.py init
    python3 blackmaria.py play --vs novice
    python3 blackmaria.py official
    python3 blackmaria.py doctor

The same client as the TypeScript one, in the same layers, and bad in the same ways on purpose (the README lists them):

    wire.py        bytes in and out, and the JSON shapes the bot sees
    transport.py   the socket, HELLO, fragments, keyframes and deltas, acks, RESYNC, PING, timing, and five hooks:
                   onPacket, shouldResync, predictState, planMoves, onTick
    meter.py       --trace, the summary block after every match, and doctor's facts
    starter.py     the starter bot
    blackmaria.py  this: where to connect, and the command line

Your bot is a class with decide(state) -> move, and optionally on_start(match_start) and on_end(end). The state and
the match start are dicts with the same shape as the JSON in docs/RULES.md: state["you"]["pos"]["x"],
state["board"], match_start["map"]["tiles"][y][x], and so on. A move is a dict: {"kind": "MOVE", "dir": "N"},
{"kind": "TAKE"}, {"kind": "USE", "item": "i3"}, {"kind": "DROP", "item": "i3"}, {"kind": "SNATCH"} or
{"kind": "WAIT"}. Use --bot path/to/file.py, where the file defines a class named Bot, a class named Transport
(a subclass of transport.Transport), the hooks as functions, or a dict named hooks.
"""

import importlib.util
import json
import os
import sys
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from meter import PROBE_TICKS, findings, summary_lines, trace_line  # noqa: E402,F401
from starter import StarterBot  # noqa: E402,F401
from transport import HOOK_NAMES, Client, ClientError, Transport, apply_hooks  # noqa: E402,F401
from wire import CHANGES, CHAOS, TIERS, TITLE  # noqa: E402

VERSION = "0.7.1"
DEFAULT_PORTS = [7777, 443]
LOCAL_TOKEN = "0" * 32
BOT_FILES = {"ts": "my_bot.ts", "py": "my_bot.py"}
TEMPLATES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "templates")


# ---------------------------------------------------------------------------------------------------------------------
# Configuration and the command line


def load_dotenv(path):
    out = {}
    if not os.path.exists(path):
        return out
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            v = v.strip()
            if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
                v = v[1:-1]
            out[k.strip()] = v
    return out


def token_bytes(token):
    if len(token) != 32 or any(c not in "0123456789abcdefABCDEF" for c in token):
        raise ClientError("A token is the 32 characters (0-9, a-f) at the end of your magic link.")
    return bytes.fromhex(token)


def parse_ports(s):
    try:
        ports = [int(x.strip()) for x in s.split(",")]
    except ValueError:
        ports = []
    if not ports or any(p < 1 or p > 65535 for p in ports):
        raise ClientError("Ports are numbers from 1 to 65535, comma-separated, like 7777,443. You gave %s." % s)
    return ports


def resolve_target(flags, env, cwd):
    dot = load_dotenv(os.path.join(cwd, ".env"))
    get = lambda k: env.get(k, dot.get(k))
    server = flags.get("server") or get("BM_SERVER")
    host = flags.get("host") or get("BM_HOST")
    ports_text = flags.get("ports") or get("BM_PORTS")
    ports = parse_ports(ports_text) if ports_text else None
    token = flags.get("token") or get("BM_TOKEN")
    note = None
    if server and not host:
        if not token:
            raise ClientError("Set BM_TOKEN or pass --token: it's the last 32 characters of your magic link.")
        req = urllib.request.Request(server.rstrip("/") + "/api/me", headers={"authorization": "Bearer " + token})
        try:
            with urllib.request.urlopen(req, timeout=10) as r:
                me = json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as err:
            if err.code == 401:
                raise ClientError("%s doesn't know that token. Copy it again from your magic link." % server)
            raise ClientError("%s/api/me answered %d. Check the address, or pass --host instead." % (server, err.code))
        except (urllib.error.URLError, OSError, ValueError) as err:
            raise ClientError("Couldn't reach %s (%s). Check the address, or pass --host instead." % (server, err))
        wire = me.get("wire") or {}
        if not isinstance(wire.get("host"), str):
            raise ClientError("%s/api/me didn't say where the wire is. Pass --host instead." % server)
        host = wire["host"]
        if ports is None and isinstance(wire.get("ports"), list):
            ports = [int(p) for p in wire["ports"]]
    if not host:
        host = "127.0.0.1"
        note = ("No server set, so this plays a local simulator on 127.0.0.1 (start one with: npx @black-maria/sim wire). "
                "To play the real server, set BM_SERVER and BM_TOKEN.")
    if not token:
        if host not in ("127.0.0.1", "localhost", "::1"):
            raise ClientError("Set BM_TOKEN or pass --token: it's the last 32 characters of your magic link.")
        token = LOCAL_TOKEN
    token_bytes(token)
    return host, ports or list(DEFAULT_PORTS), token, note


HELP = """BLACK MARIA client %s (Python)

  python3 blackmaria.py init [--lang ts|py]
      Write my_bot.py (or my_bot.ts) here: the starter bot and the five transport hooks, as
      shipped. TypeScript if this directory has a package.json, Python if not. Never overwrites.
  python3 blackmaria.py play --vs novice|adept|master [--n N] [--chaos off|novice|adept|master]
      Practice over the wire on that Maria's network profile, like the official run.
      --chaos off plays a clean link, --chaos <profile> picks another one. --n plays N
      matches one after another.
  python3 blackmaria.py official
  python3 blackmaria.py doctor [--ticks 60]
      A %d-tick probe against Novice on the Master network profile, then the numbers.

  Where to connect (flags, then the environment, then a .env file in this directory):
    --server URL   BM_SERVER   the portal address; the wire host and ports come from it
    --token T      BM_TOKEN    the 32 characters at the end of your magic link
    --host H       BM_HOST     the wire host, if you want to name it yourself
    --ports P      BM_PORTS    UDP ports to try in order (7777,443)
  With none of these, it plays a local simulator on 127.0.0.1 (npx @black-maria/sim wire).

  --trace        a line per tick: when the STATE came, how long the bot took, when the move left,
                 and whether it made the deadline. Every match ends with a summary.
  --bot FILE.py  a file that defines a class named Bot with decide(state), a Transport subclass,
                 or the hooks. Without it, the starter bot plays on the shipped transport.
""" % (VERSION, PROBE_TICKS)


def init_bot(cwd, lang=None):
    """Write my_bot.py or my_bot.ts into cwd: the starter bot and the five hooks as shipped. Never overwrites.
    Returns (path written, the command that runs it)."""
    if lang is None:
        lang = "ts" if os.path.exists(os.path.join(cwd, "package.json")) else "py"
    name = BOT_FILES[lang]
    path = os.path.join(cwd, name)
    if os.path.exists(path):
        raise ClientError("%s is already here. init won't overwrite it." % name)
    with open(os.path.join(TEMPLATES, name), encoding="utf-8") as f:
        text = f.read()
    if lang == "py":
        me = os.path.abspath(__file__)
        rel = os.path.relpath(me, cwd)
        cli = me if rel.startswith("..") else rel
        if any(c.isspace() for c in cli):
            cli = '"%s"' % cli
        text = text.replace("python3 python/blackmaria.py", "python3 " + cli, 1)
    try:
        with open(path, "x", encoding="utf-8", newline="\n") as f:
            f.write(text)
    except FileExistsError:
        raise ClientError("%s is already here. init won't overwrite it." % name)
    run = next((line.split("Run it: ", 1)[1] for line in text.splitlines() if "Run it: " in line), "")
    return path, run


def load_bot_file(path):
    """(bot class, transport class or None, hooks dict) from a --bot file."""
    spec = importlib.util.spec_from_file_location("candidate_bot", path)
    if spec is None or spec.loader is None:
        raise ClientError("Couldn't load %s." % path)
    mod = importlib.util.module_from_spec(spec)
    # `import blackmaria` in the bot file gets this module, not a second copy of it.
    sys.modules.setdefault("blackmaria", sys.modules[__name__])
    try:
        spec.loader.exec_module(mod)
    except Exception as err:  # noqa: BLE001
        raise ClientError("Couldn't load %s: %s" % (path, err))
    hooks = dict(getattr(mod, "hooks", None) or {})
    for name in HOOK_NAMES:
        if name not in hooks and callable(getattr(mod, name, None)):
            hooks[name] = getattr(mod, name)
    transport = getattr(mod, "Transport", None)
    if not (isinstance(transport, type) and issubclass(transport, Transport)) or transport is Transport:
        transport = None
    bot = getattr(mod, "Bot", None)
    if bot is None and transport is None and not hooks:
        raise ClientError("%s has no class named Bot, no Transport, and no hooks." % path)
    return bot or StarterBot, transport, hooks


def network_words(chaos):
    """The network in words: network master, or network off, clean link."""
    return "network off, clean link" if chaos == "off" else "network " + chaos


def load_bot(path):
    """The bot class from a --bot file (the old way in)."""
    return load_bot_file(path)[0]

def main(argv, out=print, err=lambda s: print(s, file=sys.stderr), env=None, cwd=None):
    env = os.environ if env is None else env
    cwd = os.getcwd() if cwd is None else cwd
    pos, flags = [], {}
    i = 0
    try:
        while i < len(argv):
            a = argv[i]
            if a.startswith("--"):
                if "=" in a:
                    k, v = a[2:].split("=", 1)
                    flags[k] = v
                elif a in ("--help", "--quiet", "--trace"):
                    flags[a[2:]] = True
                else:
                    if i + 1 >= len(argv) or argv[i + 1].startswith("--"):
                        raise ClientError("%s needs a value." % a)
                    flags[a[2:]] = argv[i + 1]
                    i += 1
            else:
                pos.append(a)
            i += 1
        cmd = pos[0] if pos else None
        if not cmd or cmd == "help" or flags.get("help"):
            out(HELP)
            return 0
        if cmd == "init":
            lang = flags.get("lang")
            if lang is not None and lang not in BOT_FILES:
                raise ClientError("--lang takes ts or py, not %s." % lang)
            path, run = init_bot(cwd, lang)
            out("Wrote %s. Run it:" % os.path.basename(path))
            out("  " + run)
            return 0
        if cmd not in ("play", "official", "doctor"):
            raise ClientError('No command "%s". Run "python3 blackmaria.py help" for the list.' % cmd)
        official = cmd == "official"
        doctor = cmd == "doctor"
        vs = "novice" if doctor else flags.get("vs") or ("novice" if official else None)
        if not vs:
            raise ClientError("Pick a Maria: --vs novice, adept or master.")
        if vs not in TIERS:
            raise ClientError("--vs takes novice, adept or master, not %s." % vs)
        # Practice plays on its Maria's network profile, like the official run, unless --chaos says otherwise.
        chaos_name = "master" if doctor else flags.get("chaos") or ("off" if official else vs)
        if chaos_name not in CHAOS:
            raise ClientError("--chaos takes off, novice, adept or master, not %s." % chaos_name)
        try:
            n = 1 if doctor else int(flags.get("n") or 1)
        except ValueError:
            n = 0
        if n < 1 or n > 1000:
            raise ClientError("--n takes a whole number from 1 to 1000.")
        probe = None
        if doctor:
            try:
                probe = int(flags.get("ticks") or PROBE_TICKS)
            except ValueError:
                probe = 0
            if probe < 10 or probe > 400:
                raise ClientError("--ticks takes a whole number from 10 to 400.")
        bot_cls, transport_cls, hooks = load_bot_file(flags["bot"]) if flags.get("bot") else (StarterBot, None, {})
        host, ports, token, note = resolve_target(flags, env, cwd)
        quiet = bool(flags.get("quiet"))
        if note:
            out(note)
        if doctor:
            out("Doctor: a %d-tick probe against Maria (Novice) on the Master network profile, on %s." % (probe, host))
        elif official:
            out("This is your one official run: 9 matches, 3 at a time, about 5 minutes. Once the server answers, it can't be stopped. It plays to the end even if this program doesn't.")
            out("Starting your official run on %s." % host)
        else:
            out("Practice against Maria (%s) on %s, %d match%s, %s." % (TITLE[vs], host, n, "" if n == 1 else "es", network_words(chaos_name)))
        announced = []
        client = None

        def on_ack(a):
            if announced:
                return
            announced.append(True)
            clock = "no clock (a local simulator)" if a["clock_s"] == 0xFFFFFFFF else "%d minutes %d seconds left on your clock" % (a["clock_s"] // 60, a["clock_s"] % 60)
            if official:
                out("Connected on UDP port %d: %s. The run has started." % (client.port, clock))
            else:
                out("Connected on UDP port %d: %s, official runs left %d." % (client.port, clock, a["attempts_left"]))
            if a["rule_change"] in CHANGES:
                out("The change: " + CHANGES[a["rule_change"]])

        def on_summary(conn, _match):
            for line in summary_lines(conn):
                out(line)

        client = (transport_cls or Transport)(host, ports, token_bytes(token), official, TIERS.index(vs), CHAOS.index(chaos_name), n,
                                              bot_cls, log=None if quiet else out, on_hello_ack=on_ack, trace=bool(flags.get("trace")),
                                              out=out, on_summary=on_summary, probe_ticks=probe)
        apply_hooks(client, hooks)
        results = client.run()
        if doctor:
            if results:
                out("")
                out("Findings:")
                for line in findings(results[-1]["conn"]):
                    out("  " + line)
            return 0
        for m in results:
            words = ("you won %d to %d" if m["result"] == "win" else "you lost %d to %d" if m["result"] == "loss" else "draw, %d to %d") % (m["you"], m["maria"])
            out("Match %d against Maria (%s): %s. States received %d, moves sent %d." % (m["match"], TITLE[m["tier"]], words, m["states"], m["moves"]))
        won = lambda t: sum(1 for m in results if m["tier"] == t and m["result"] == "win")
        if official:
            out("Official run done. Novice %d of 3 won, Adept %d of 3, Master %d of 3. Score %d out of 39."
                % (won("novice"), won("adept"), won("master"), won("novice") + 3 * won("adept") + 9 * won("master")))
        elif len(results) > 1:
            w = sum(1 for m in results if m["result"] == "win")
            d = sum(1 for m in results if m["result"] == "draw")
            out("%d matches: %d won, %d drawn, %d lost." % (len(results), w, d, len(results) - w - d))
        return 0
    except ClientError as e:
        err(str(e))
        return 1
    except KeyboardInterrupt:
        err("Stopped.")
        return 130


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
