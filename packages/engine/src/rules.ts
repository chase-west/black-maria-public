/** Rule constants. Every number here is exact per SPEC 3 and appears in docs/RULES.md. */
export const RULES = {
  /** Energy cap. */
  energyMax: 100,
  /** Energy a charged sigil gives its owner. */
  sigilEnergy: 40,
  /** Ticks a sigil needs to charge again after it pays out. */
  sigilRecharge: 60,
  /** Errands on the board at tick 0. */
  initialErrands: 6,
  /** No errand is posted after `maxTick - postStopBefore` (tick 360 in a 400-tick match). */
  postStopBefore: 40,
  /** `carry` lengths. */
  carryTicks: [8, 12, 16] as readonly number[],
  /** Values are drawn by seed, independent of distance (SPEC 3.5, v6.2): an inclusive range per errand type. */
  deliverValue: [1, 9] as readonly [number, number],
  carryValue: [1, 6] as readonly [number, number],
  visitValue: [1, 3] as readonly [number, number],
  /** A deliver errand prefers fixtures at least this far from the nearest item of its kind. */
  deliverMinDistance: 3,
  itemsMin: 16,
  itemsMax: 20,
  maxPerKind: 3,
  /** Errand type draw: a number in [0, 20). Below 7 deliver, below 18 carry, otherwise visit (35%, 55%, 10%). */
  typeDraw: 20,
  deliverBelow: 7,
  carryBelow: 18,
} as const;

/**
 * Every number a bot might depend on (SPEC 3.9), as the engine uses them. The change (SPEC 2.2) alters
 * some of these; every match carries its own and both protocols publish them in `match_start`.
 */
export interface Params {
  maxTick: number;
  postInterval: number;
  expiryMin: number;
  expiryMax: number;
  snatchCost: number;
  regen: number;
  energyStart: number;
  inventorySlots: number;
  /** Ticks after delivery before the house puts an item back on the floor (SPEC 3.3). */
  returnTicks: number;
}

export const DEFAULT_PARAMS: Readonly<Params> = Object.freeze({
  maxTick: 400,
  postInterval: 6,
  expiryMin: 30,
  expiryMax: 70,
  snatchCost: 100,
  regen: 1,
  energyStart: 40,
  inventorySlots: 4,
  returnTicks: 40,
});

/** Parameters for the three possible changes (SPEC 2.2). */
export const CHANGE_PARAMS: Readonly<Record<1 | 2 | 3, Partial<Params>>> = Object.freeze({
  1: { postInterval: 3, expiryMin: 20, expiryMax: 45 },
  2: { snatchCost: 50, regen: 2 },
  3: {},
});

/** Validate and fill parameters. Throws on values the engine or the wire cannot carry. */
export function makeParams(p: Partial<Params> = {}): Params {
  const out: Params = { ...DEFAULT_PARAMS, ...p };
  const ok =
    Number.isInteger(out.maxTick) &&
    out.maxTick >= 1 &&
    out.maxTick <= 4000 &&
    Number.isInteger(out.postInterval) &&
    out.postInterval >= 1 &&
    out.postInterval <= 255 &&
    Number.isInteger(out.expiryMin) &&
    Number.isInteger(out.expiryMax) &&
    out.expiryMin >= 1 &&
    out.expiryMax >= out.expiryMin &&
    out.expiryMax <= 255 &&
    Number.isInteger(out.snatchCost) &&
    out.snatchCost >= 0 &&
    out.snatchCost <= 100 &&
    Number.isInteger(out.regen) &&
    out.regen >= 0 &&
    out.regen <= 100 &&
    Number.isInteger(out.energyStart) &&
    out.energyStart >= 0 &&
    out.energyStart <= 100 &&
    Number.isInteger(out.inventorySlots) &&
    out.inventorySlots >= 1 &&
    out.inventorySlots <= 12 &&
    Number.isInteger(out.returnTicks) &&
    out.returnTicks >= 1 &&
    out.returnTicks <= 255;
  if (!ok) throw new RangeError(`invalid match parameters: ${JSON.stringify(out)}`);
  return out;
}

/** The last tick on which an errand can be posted. */
export const lastPostTick = (p: Params): number => p.maxTick - RULES.postStopBefore;
