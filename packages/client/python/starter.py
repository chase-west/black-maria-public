"""The starter bot, Python. The same bot as src/starter.ts, move for move, and bad in the same ways on purpose."""

from wire import DIRS, DXY

# Hard-coded, like everything else here. The match start has the real number.
INVENTORY_SLOTS = 4


class StarterBot:
    """Walks to the nearest open errand's next step and does it. Once it picks a target it walks there without
    looking again. It remembers where it saw each item and does not notice when Maria picks one up: it walks to the
    empty spot and only forgets the item when it gets there. It never checks expiry, never snatches, never thinks
    about Maria, hard-codes 4 inventory slots, and treats the locked door as a wall."""

    def __init__(self):
        self.start = None
        self.seen = {}  # every item seen on the floor, where we last saw it: id -> (kind, pos)
        self.goal = None  # the target we are walking to: (pos, act)

    def on_start(self, start):
        self.start = start

    def remember(self, s):
        """Note every item on the floor, forget the ones we hold and the ones that should be on our tile but are not.
        An item Maria picked up stays where we last saw it."""
        for it in s["items"]:
            self.seen[it["id"]] = (it["kind"], it["pos"])
        for it in s["you"]["inventory"]:
            self.seen.pop(it["id"], None)
        me = s["you"]["pos"]
        here = {i["id"] for i in s["items"] if i["pos"]["x"] == me["x"] and i["pos"]["y"] == me["y"]}
        for iid, (_, pos) in list(self.seen.items()):
            if pos["x"] == me["x"] and pos["y"] == me["y"] and iid not in here:
                del self.seen[iid]

    def decide(self, s):
        m = self.start
        if m is None:
            return {"kind": "WAIT"}
        self.remember(s)
        w, h, tiles = m["map"]["w"], m["map"]["h"], m["map"]["tiles"]
        dist = [[-1] * w for _ in range(h)]
        first = [[None] * w for _ in range(h)]
        here = s["you"]["pos"]
        queue = [(here["x"], here["y"])]
        dist[here["y"]][here["x"]] = 0
        i = 0
        while i < len(queue):
            px, py = queue[i]
            for d, (dx, dy) in enumerate(DXY):
                x, y = px + dx, py + dy
                if x < 0 or y < 0 or x >= w or y >= h or dist[y][x] >= 0:
                    continue
                if tiles[y][x] in ("wall", "door_locked"):
                    continue
                dist[y][x] = dist[py][px] + 1
                first[y][x] = {"kind": "MOVE", "dir": DIRS[d]} if i == 0 else first[py][px]
                queue.append((x, y))
            i += 1
        goals = []
        for e in s["board"]:
            if e["state"] == "open":
                goals.extend(self.goals_for(s, e))
        best, best_d = None, None
        # Keep walking to the last target while it is still a goal; otherwise pick the nearest.
        kept = self.goal
        if kept is not None and dist[kept[0]["y"]][kept[0]["x"]] >= 0 and any(same_goal(g, kept) for g in goals):
            best, best_d = kept, dist[kept[0]["y"]][kept[0]["x"]]
        else:
            for pos, act in goals:
                dd = dist[pos["y"]][pos["x"]]
                if dd >= 0 and (best_d is None or dd < best_d):
                    best, best_d = (pos, act), dd
        self.goal = best if best is not None and best_d > 0 else None
        if best is None:
            return {"kind": "WAIT"}
        if best_d == 0:
            return best[1] or {"kind": "WAIT"}
        return first[best[0]["y"]][best[0]["x"]]

    def goals_for(self, s, e):
        m = self.start
        if e["type"] == "visit":
            return [({"x": x, "y": y}, None) for y, row in enumerate(m["map"]["rooms"]) for x, r in enumerate(row) if r == e["room"]]
        mine = next((i for i in s["you"]["inventory"] if i["kind"] == e["item_kind"]), None)
        if mine is not None:
            if e["type"] == "carry":
                return []
            f = next((f for f in m["fixtures"] if f["id"] == e["fixture"]), None)
            return [(f["pos"], {"kind": "USE", "item": mine["id"]})] if f else []
        if len(s["you"]["inventory"]) >= INVENTORY_SLOTS:
            return []
        return [(pos, {"kind": "TAKE"}) for kind, pos in self.seen.values() if kind == e["item_kind"]]


def same_goal(a, b):
    """Two goals are the same target: the same tile and the same act."""
    (pa, xa), (pb, xb) = a, b
    return (pa["x"] == pb["x"] and pa["y"] == pb["y"] and (xa or {}).get("kind") == (xb or {}).get("kind")
            and (xa or {}).get("item") == (xb or {}).get("item"))

