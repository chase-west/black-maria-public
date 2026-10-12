"""BLACK MARIA wire format, Python: bytes in and out, and the JSON shapes the bot sees. Standard library only.

The same as @blackmaria/protocol/wire in TypeScript. docs/WIRE.md has every byte.
"""

import struct

MAGIC = 0xB1
KEYFRAME = 0xFFFF
NONE8 = 0xFF
NONE16 = 0xFFFF

TILE_KINDS = ["floor", "wall", "door", "door_locked", "sigil"]
FIXTURE_KINDS = ["fireplace", "well", "safe", "altar", "piano", "mirror", "bookcase", "bed", "clock", "font", "stove"]
ITEM_KINDS = ["key", "letter", "candle", "locket", "ledger", "bottle", "coin", "ring", "photograph", "vial"]
DECOR_KINDS = ["plant", "chair", "table_small", "stool", "crate", "barrel", "bookstack", "vase", "candelabra", "cushion", "rug_small", "cobweb"]
ERRAND_TYPES = ["deliver", "visit", "carry"]
ERRAND_STATES = ["open", "done_by_you", "done_by_maria", "expired"]
TIERS = ["novice", "adept", "master"]
CHAOS = ["off", "novice", "adept", "master"]
DIRS = ["N", "E", "S", "W"]
DXY = [(0, -1), (1, 0), (0, 1), (-1, 0)]
TITLE = {"novice": "Novice", "adept": "Adept", "master": "Master"}

CHANGES = {
    1: "Errands now post every 3 ticks instead of 6. They expire 20 to 45 ticks after they post, instead of 30 to 70. "
       "More errands, shorter lives. Read post_interval, expiry_min and expiry_max from the match start.",
    2: "A snatch now costs 50 energy instead of 100, and energy regenerates 2 per tick instead of 1. Maria can snatch "
       "about 4 times as often. So can you. Read snatch_cost and regen from the match start.",
    3: "The Master network profile now applies to every tier. Every match on the wire now loses 1 packet in 10 each way "
       "and goes silent once for 400 ms. The match start says which network a match is on.",
}

PACKET_NAMES = {0x81: "HELLO_ACK", 0x82: "MATCH_START", 0x83: "STATE", 0x84: "MATCH_END", 0x85: "PONG", 0x86: "ERROR"}


class Reader:
    def __init__(self, buf, off=0):
        self.buf = buf
        self.off = off

    def take(self, fmt):
        v = struct.unpack_from("<" + fmt, self.buf, self.off)
        self.off += struct.calcsize("<" + fmt)
        return v

    def u8(self):
        return self.take("B")[0]

    def u16(self):
        return self.take("H")[0]

    def u32(self):
        return self.take("I")[0]

    def raw(self, n):
        if self.off + n > len(self.buf):
            raise struct.error("truncated")
        b = self.buf[self.off:self.off + n]
        self.off += n
        return b


def header(ptype, session, seq, ack):
    return struct.pack("<BBHII", MAGIC, ptype, session, seq, ack)


def read_errand(r):
    e = {"id": r.u16(), "type": r.u8(), "item_kind": r.u8(), "fixture": r.u16(), "room": r.u8(), "carry_ticks": r.u8(),
         "value": r.u8(), "posted": r.u16(), "expires": r.u16(), "state": r.u8()}
    if e["type"] > 2 or e["state"] > 3:
        raise struct.error("bad errand")
    return e


def read_event(r):
    k = r.u8()
    if k == 0:
        return {"kind": "posted", "errand": read_errand(r)}
    if k == 1:
        return {"kind": "completed", "id": r.u16(), "by": r.u8()}
    if k == 2:
        return {"kind": "expired", "id": r.u16()}
    if k in (3, 4, 6):
        return {"kind": {3: "took", 4: "dropped", 6: "snatched"}[k], "by": r.u8(), "item": r.u16()}
    if k == 5:
        return {"kind": "delivered", "by": r.u8(), "item": r.u16(), "fixture": r.u16()}
    if k == 7:
        return {"kind": "door_opened", "x": r.u8(), "y": r.u8()}
    if k == 8:
        return {"kind": "safe_opened", "fixture": r.u16(), "item": r.u16()}
    if k == 9:
        return {"kind": "sigil", "owner": r.u8(), "energy": r.u8()}
    if k == 10:
        return {"kind": "moved", "by": r.u8(), "dir": r.u8()}
    if k == 11:
        return {"kind": "winding_up", "by": r.u8()}
    if k == 12:
        return {"kind": "returned", "item": r.u16(), "item_kind": r.u8(), "x": r.u8(), "y": r.u8()}
    raise struct.error("unknown event")


def read_state(r):
    p = {"match": r.u16(), "tick": r.u16(), "base": r.u16(), "deadline_ms": r.u16()}
    mask = r.u8()
    if mask & 1:
        p["you"] = {"x": r.u8(), "y": r.u8(), "energy": r.u8()}
    if mask & 2:
        p["maria"] = {"x": r.u8(), "y": r.u8()}
    if mask & 4:
        lists = []
        for _ in range(2):
            lists.append([r.u16() for _ in range(r.u8())])
        p["inventories"] = lists
    if mask & 8:
        p["items"] = [{"id": r.u16(), "kind": r.u8(), "x": r.u8(), "y": r.u8()} for _ in range(r.u8())]
    if mask & 16:
        p["board"] = [read_errand(r) for _ in range(r.u8())]
    if mask & 32:
        p["doors"] = [(r.u8(), r.u8()) for _ in range(r.u8())]
    if mask & 64:
        safes = [r.u16() for _ in range(r.u8())]
        p["safes_and_sigils"] = (safes, [r.u8(), r.u8()])
    if mask & 128:
        p["events"] = [read_event(r) for _ in range(r.u8())]
    return p


def decode(buf):
    """(type, seq, payload dict) or None for anything malformed."""
    if len(buf) < 12 or len(buf) > 1200 or buf[0] != MAGIC:
        return None
    try:
        _, ptype, _session, seq, _ack = struct.unpack_from("<BBHII", buf, 0)
        r = Reader(buf, 12)
        if ptype == 0x81:
            p = {"session": r.u16(), "attempts_left": r.u8(), "clock_s": r.u32(), "rule_change": r.u8()}
        elif ptype == 0x82:
            p = {"match": r.u16(), "frag": r.u8(), "frag_count": r.u8()}
            p["data"] = bytes(buf[r.off:])
            r.off = len(buf)
        elif ptype == 0x83:
            p = read_state(r)
        elif ptype == 0x84:
            p = {"match": r.u16(), "result": r.u8(), "score_you": r.u8(), "score_maria": r.u8()}
        elif ptype == 0x85:
            p = {"client_ms": r.u32(), "server_ms": r.u32()}
        elif ptype == 0x86:
            code = r.u8()
            p = {"code": code, "msg": r.raw(r.u8()).decode("ascii", "replace")}
        else:
            return None
        if r.off != len(buf):
            return None
        p["type"] = PACKET_NAMES[ptype]
        p["seq"] = seq
        return ptype, seq, p
    except struct.error:
        return None


def decode_blob(buf):
    try:
        r = Reader(buf)
        b = {"tier": r.u8(), "seed_hint": r.u32(), "w": r.u8(), "h": r.u8()}
        n = b["w"] * b["h"]
        b["tiles"] = r.raw(n)
        b["rooms"] = r.raw(n)
        b["room_names"] = [r.raw(r.u8()).decode("ascii") for _ in range(r.u8())]
        b["sigil_owner"] = [r.u8(), r.u8()]
        names = ["max_tick", "tick_ms", "post_interval", "expiry_min", "expiry_max", "snatch_cost", "regen",
                 "energy_start", "inventory_slots", "return_ticks", "chaos"]
        vals = [r.u16(), r.u16()] + [r.u8() for _ in range(9)]
        b["params"] = dict(zip(names, vals))
        b["maria_start"] = {"x": r.u8(), "y": r.u8()}
        b["board"] = [read_errand(r) for _ in range(r.u8())]
        b["fixtures"] = [{"id": r.u16(), "kind": r.u8(), "x": r.u8(), "y": r.u8(), "flags": r.u8()} for _ in range(r.u8())]
        b["items"] = [{"id": r.u16(), "kind": r.u8(), "x": r.u8(), "y": r.u8(), "flags": r.u8()} for _ in range(r.u8())]
        b["start"] = {"x": r.u8(), "y": r.u8()}
        b["decor"] = [{"kind": r.u8(), "x": r.u8(), "y": r.u8()} for _ in range(r.u8())]
        if r.off != len(buf):
            return None
        return b
    except (struct.error, UnicodeDecodeError):
        return None



# ---------------------------------------------------------------------------------------------------------------------
# JSON shapes (the same as the TypeScript client's)


def errand_json(rec, room_names):
    t = ERRAND_TYPES[rec["type"]]
    e = {"id": rec["id"], "value": rec["value"], "posted": rec["posted"], "expires": rec["expires"],
         "state": ERRAND_STATES[rec["state"]], "type": t}
    if t == "visit":
        if rec["room"] >= len(room_names):
            return None
        e["room"] = room_names[rec["room"]]
    else:
        if rec["item_kind"] > 9:
            return None
        e["item_kind"] = ITEM_KINDS[rec["item_kind"]]
        if t == "deliver":
            if rec["fixture"] == NONE16:
                return None
            e["fixture"] = "f%d" % rec["fixture"]
        else:
            e["carry_ticks"] = rec["carry_ticks"]
    return e


def match_start_json(b, match_id, mode):
    w, h = b["w"], b["h"]
    tiles = [[TILE_KINDS[b["tiles"][y * w + x]] for x in range(w)] for y in range(h)]
    rooms = [["corridor" if b["rooms"][y * w + x] == 0xFF else b["room_names"][b["rooms"][y * w + x]] for x in range(w)] for y in range(h)]
    fixtures = [{"id": "f%d" % f["id"], "kind": FIXTURE_KINDS[f["kind"]], "pos": {"x": f["x"], "y": f["y"]}} for f in b["fixtures"]]

    def safe_at(x, y):
        for f in fixtures:
            if f["pos"]["x"] == x and f["pos"]["y"] == y and f["kind"] == "safe":
                return f["id"]
        return ""

    params = dict(b["params"])
    params["chaos"] = CHAOS[params["chaos"]] if params["chaos"] < 4 else "off"
    board = [e for e in (errand_json(r, b["room_names"]) for r in b["board"]) if e is not None]
    return {
        "type": "match_start", "match_id": match_id, "mode": mode, "tier": TIERS[b["tier"]], "params": params,
        "map": {"w": w, "h": h, "tiles": tiles, "rooms": rooms}, "room_names": b["room_names"], "fixtures": fixtures,
        "items": [{"id": "i%d" % i["id"], "kind": ITEM_KINDS[i["kind"]], "pos": {"x": i["x"], "y": i["y"]}} for i in b["items"] if not i["flags"] & 1],
        "safe_items": [{"id": "i%d" % i["id"], "kind": ITEM_KINDS[i["kind"]], "fixture": safe_at(i["x"], i["y"])} for i in b["items"] if i["flags"] & 1],
        "decor": [{"kind": DECOR_KINDS[d["kind"]] if d["kind"] < len(DECOR_KINDS) else "plant", "pos": {"x": d["x"], "y": d["y"]}} for d in b["decor"]],
        "start": dict(b["start"]), "maria_start": dict(b["maria_start"]),
        "sigil_owner": ["you" if o == 0 else "maria" for o in b["sigil_owner"]], "board": board,
        "you": {"energy": params["energy_start"]},
    }


def event_json(e, room_names):
    who = lambda n: "you" if n == 0 else "maria"
    k = e["kind"]
    if k == "posted":
        er = errand_json(e["errand"], room_names)
        return {"kind": "posted", "errand": er} if er else None
    if k == "completed":
        return {"kind": "completed", "errand": e["id"], "by": who(e["by"])}
    if k == "expired":
        return {"kind": "expired", "errand": e["id"]}
    if k in ("took", "dropped", "snatched"):
        return {"kind": k, "by": who(e["by"]), "item": "i%d" % e["item"]}
    if k == "delivered":
        return {"kind": k, "by": who(e["by"]), "item": "i%d" % e["item"], "fixture": "f%d" % e["fixture"]}
    if k == "door_opened":
        return {"kind": k, "pos": {"x": e["x"], "y": e["y"]}}
    if k == "safe_opened":
        return {"kind": k, "fixture": "f%d" % e["fixture"], "item": "" if e["item"] == NONE16 else "i%d" % e["item"]}
    if k == "sigil":
        return {"kind": k, "owner": who(e["owner"]), "energy_gained": e["energy"]}
    if k == "moved":
        return {"kind": k, "by": who(e["by"]), "dir": DIRS[e["dir"]]} if e["dir"] <= 3 else None
    if k == "winding_up":
        return {"kind": k, "by": who(e["by"])}
    if k == "returned":
        if e["item_kind"] >= len(ITEM_KINDS):
            return None
        return {"kind": k, "item": "i%d" % e["item"], "item_kind": ITEM_KINDS[e["item_kind"]], "pos": {"x": e["x"], "y": e["y"]}}
    return None


def snapshot_from_keyframe(p):
    need = ("you", "maria", "inventories", "items", "board", "doors", "safes_and_sigils")
    if not all(k in p for k in need):
        return None
    return {"you": dict(p["you"]), "maria": dict(p["maria"]), "inv_you": list(p["inventories"][0]),
            "inv_maria": list(p["inventories"][1]), "items": {i["id"]: dict(i) for i in p["items"]},
            "board": {e["id"]: dict(e) for e in p["board"]}, "doors": list(p["doors"]),
            "safes": list(p["safes_and_sigils"][0]), "sigils": list(p["safes_and_sigils"][1])}


def apply_delta(s, p):
    """Apply a delta's fields onto `s`, whatever base it names."""
    s = {"you": dict(s["you"]), "maria": dict(s["maria"]), "inv_you": list(s["inv_you"]), "inv_maria": list(s["inv_maria"]),
         "items": dict(s["items"]), "board": dict(s["board"]), "doors": list(s["doors"]), "safes": list(s["safes"]),
         "sigils": list(s["sigils"])}
    if "you" in p:
        s["you"] = dict(p["you"])
    if "maria" in p:
        s["maria"] = dict(p["maria"])
    if "inventories" in p:
        s["inv_you"], s["inv_maria"] = list(p["inventories"][0]), list(p["inventories"][1])
    for i in p.get("items", []):
        if i["x"] == NONE8:
            s["items"].pop(i["id"], None)
        else:
            s["items"][i["id"]] = dict(i)
    for e in p.get("board", []):
        s["board"][e["id"]] = dict(e)
    for d in p.get("doors", []):
        if d not in s["doors"]:
            s["doors"].append(d)
    if "safes_and_sigils" in p:
        for f in p["safes_and_sigils"][0]:
            if f not in s["safes"]:
                s["safes"].append(f)
        s["sigils"] = list(p["safes_and_sigils"][1])
    return s


def state_json(start, kinds, snap, events, tick, deadline_ms):
    # Items the house puts back get new ids: learn their kinds from the floor and from "returned" events.
    for i in snap["items"].values():
        if i["kind"] < len(ITEM_KINDS):
            kinds[i["id"]] = ITEM_KINDS[i["kind"]]
    for e in events:
        if e["kind"] == "returned" and e["item_kind"] < len(ITEM_KINDS):
            kinds[e["item"]] = ITEM_KINDS[e["item_kind"]]
    names = start["room_names"]
    held = lambda ids: [{"id": "i%d" % i, "kind": kinds.get(i, "key")} for i in ids]
    board = [e for e in (errand_json(snap["board"][k], names) for k in sorted(snap["board"])) if e is not None]
    scores = {"you": sum(e["value"] for e in board if e["state"] == "done_by_you"),
              "maria": sum(e["value"] for e in board if e["state"] == "done_by_maria")}
    return {
        "type": "state", "match_id": start["match_id"], "tick": tick, "deadline_ms": deadline_ms,
        "you": {"pos": {"x": snap["you"]["x"], "y": snap["you"]["y"]}, "inventory": held(snap["inv_you"]), "energy": snap["you"]["energy"]},
        "maria": {"pos": dict(snap["maria"]), "inventory": held(snap["inv_maria"])},
        "items": [{"id": "i%d" % i["id"], "kind": ITEM_KINDS[i["kind"]], "pos": {"x": i["x"], "y": i["y"]}} for i in (snap["items"][k] for k in sorted(snap["items"]))],
        "board": board,
        "doors_opened": [{"x": x, "y": y} for (x, y) in sorted(snap["doors"], key=lambda d: (d[1], d[0]))],
        "safes_opened": ["f%d" % f for f in sorted(snap["safes"])],
        "sigil_charge": list(snap["sigils"]), "scores": scores,
        "events": [e for e in (event_json(x, names) for x in events) if e is not None],
    }


def intent_bytes(move):
    kind = ["WAIT", "MOVE", "TAKE", "DROP", "USE", "SNATCH"].index(move.get("kind", "WAIT")) if move.get("kind") in ("WAIT", "MOVE", "TAKE", "DROP", "USE", "SNATCH") else 0
    d = DIRS.index(move["dir"]) if kind == 1 and move.get("dir") in DIRS else 0
    item = 0
    if kind in (3, 4):
        try:
            item = int(str(move.get("item", "i0"))[1:])
        except ValueError:
            kind, item = 0, 0
    return struct.pack("<BBH", kind, d, item)
