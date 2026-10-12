import { NONE8, type ErrandRecord, type StateFields, type WireEvent, type WireItem, type XY } from "./types.js";

/**
 * Everything a STATE carries about one tick except its events, from the candidate's point of view (SPEC 5.5).
 * Lists are canonical: items, board and safes by id, doors row-major. Inventories keep pickup order.
 */
export interface WireSnapshot {
  you: { x: number; y: number; energy: number };
  maria: XY;
  invYou: number[];
  invMaria: number[];
  /** Items on the floor. */
  items: WireItem[];
  /** Every errand ever posted. */
  board: ErrandRecord[];
  /** Every opened door. */
  doors: XY[];
  /** Every opened safe (fixture ids). */
  safes: number[];
  /** Per sigil, row-major: 0 charged, otherwise ticks until charged. */
  sigils: [number, number];
}

const byXY = (a: XY, b: XY) => a.y - b.y || a.x - b.x;

export function canonicalSnapshot(s: WireSnapshot): WireSnapshot {
  return {
    you: { ...s.you },
    maria: { x: s.maria.x, y: s.maria.y },
    invYou: s.invYou.slice(),
    invMaria: s.invMaria.slice(),
    items: s.items.map((i) => ({ ...i })).sort((a, b) => a.id - b.id),
    board: s.board.map((e) => ({ ...e })).sort((a, b) => a.id - b.id),
    doors: s.doors.map((d) => ({ ...d })).sort(byXY),
    safes: s.safes.slice().sort((a, b) => a - b),
    sigils: [s.sigils[0], s.sigils[1]],
  };
}

/** Keyframe fields: every field present, full lists (SPEC 5.5). */
export function keyframeFields(s: WireSnapshot, events: WireEvent[]): Required<StateFields> {
  const c = canonicalSnapshot(s);
  return {
    you: c.you,
    maria: c.maria,
    inventories: { you: c.invYou, maria: c.invMaria },
    items: c.items,
    board: c.board,
    doors: c.doors,
    safesAndSigils: { safes: c.safes, sigils: c.sigils },
    events,
  };
}

const sameXY = (a: XY, b: XY) => a.x === b.x && a.y === b.y;
const sameNums = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((x, i) => x === b[i]);
const sameErrand = (a: ErrandRecord, b: ErrandRecord) =>
  a.id === b.id && a.type === b.type && a.itemKind === b.itemKind && a.fixture === b.fixture && a.room === b.room && a.carryTicks === b.carryTicks && a.value === b.value && a.posted === b.posted && a.expires === b.expires && a.state === b.state;

/**
 * Delta fields against `base`: a field is present only when it differs from the base.
 * `inventories` carries both full lists when either changed. `items` lists only items whose floor state changed; an
 * item that left the floor has `x = y = 0xFF`. `board` lists errands posted or changed since the base. `doors` and the
 * safes in `safes_and_sigils` list only those opened since the base; the sigil bytes are always current.
 * `events` is present when there are any.
 */
export function deltaFields(base: WireSnapshot, cur: WireSnapshot, events: WireEvent[]): StateFields {
  const b = canonicalSnapshot(base);
  const c = canonicalSnapshot(cur);
  const f: StateFields = {};
  if (b.you.x !== c.you.x || b.you.y !== c.you.y || b.you.energy !== c.you.energy) f.you = c.you;
  if (!sameXY(b.maria, c.maria)) f.maria = c.maria;
  if (!sameNums(b.invYou, c.invYou) || !sameNums(b.invMaria, c.invMaria)) f.inventories = { you: c.invYou, maria: c.invMaria };
  const changed: WireItem[] = [];
  const before = new Map(b.items.map((i) => [i.id, i]));
  const after = new Map(c.items.map((i) => [i.id, i]));
  for (const i of c.items) {
    const p = before.get(i.id);
    if (!p || p.x !== i.x || p.y !== i.y || p.kind !== i.kind) changed.push(i);
  }
  for (const p of b.items) if (!after.has(p.id)) changed.push({ id: p.id, kind: p.kind, x: NONE8, y: NONE8 });
  changed.sort((x, y) => x.id - y.id);
  if (changed.length) f.items = changed;
  const oldBoard = new Map(b.board.map((e) => [e.id, e]));
  const board = c.board.filter((e) => {
    const o = oldBoard.get(e.id);
    return !o || !sameErrand(o, e);
  });
  if (board.length) f.board = board;
  const newDoors = c.doors.filter((d) => !b.doors.some((x) => sameXY(x, d)));
  if (newDoors.length) f.doors = newDoors;
  const newSafes = c.safes.filter((s) => !b.safes.includes(s));
  if (newSafes.length || b.sigils[0] !== c.sigils[0] || b.sigils[1] !== c.sigils[1]) f.safesAndSigils = { safes: newSafes, sigils: c.sigils };
  if (events.length) f.events = events;
  return f;
}

/** Apply STATE fields to the snapshot they are based on (a keyframe applies to anything). Returns a new canonical snapshot. */
export function applyFields(base: WireSnapshot, f: StateFields, keyframe: boolean): WireSnapshot {
  const s = canonicalSnapshot(base);
  if (f.you) s.you = { ...f.you };
  if (f.maria) s.maria = { ...f.maria };
  if (f.inventories) {
    s.invYou = f.inventories.you.slice();
    s.invMaria = f.inventories.maria.slice();
  }
  if (f.safesAndSigils) s.sigils = [f.safesAndSigils.sigils[0], f.safesAndSigils.sigils[1]];
  if (keyframe) {
    if (f.items) s.items = f.items.map((i) => ({ ...i }));
    // A keyframe that had to leave out old, closed errands (see `fitStateFields`) has gaps in its ids; the base's
    // records for those ids are kept.
    if (f.board) {
      const sent = new Set(f.board.map((e) => e.id));
      const newest = f.board.reduce((m, e) => Math.max(m, e.id), -1);
      s.board = [...s.board.filter((e) => !sent.has(e.id) && e.id < newest), ...f.board.map((e) => ({ ...e }))];
    }
    if (f.doors) s.doors = f.doors.map((d) => ({ ...d }));
    if (f.safesAndSigils) s.safes = f.safesAndSigils.safes.slice();
  } else {
    if (f.items) {
      const m = new Map(s.items.map((i) => [i.id, i]));
      for (const i of f.items) {
        if (i.x === NONE8) m.delete(i.id);
        else m.set(i.id, { ...i });
      }
      s.items = [...m.values()];
    }
    if (f.board) {
      const m = new Map(s.board.map((e) => [e.id, e]));
      for (const e of f.board) m.set(e.id, { ...e });
      s.board = [...m.values()];
    }
    if (f.doors) for (const d of f.doors) if (!s.doors.some((x) => sameXY(x, d))) s.doors.push({ ...d });
    if (f.safesAndSigils) for (const x of f.safesAndSigils.safes) if (!s.safes.includes(x)) s.safes.push(x);
  }
  return canonicalSnapshot(s);
}

/** A keyframe's fields as a snapshot (every field must be present). */
export function snapshotFromKeyframe(f: StateFields): WireSnapshot | null {
  if (!f.you || !f.maria || !f.inventories || !f.items || !f.board || !f.doors || !f.safesAndSigils) return null;
  return canonicalSnapshot({ you: f.you, maria: f.maria, invYou: f.inventories.you, invMaria: f.inventories.maria, items: f.items, board: f.board, doors: f.doors, safes: f.safesAndSigils.safes, sigils: f.safesAndSigils.sigils });
}

export function snapshotsEqual(a: WireSnapshot, b: WireSnapshot): boolean {
  return JSON.stringify(canonicalSnapshot(a)) === JSON.stringify(canonicalSnapshot(b));
}
