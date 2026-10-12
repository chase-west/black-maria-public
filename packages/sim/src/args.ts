/** Command-line flags for every parameter in SPEC 3.9 and the three possible changes in SPEC 2.2. */
import type { ChaosName, Tier } from "@blackmaria/protocol";
import { CHANGE_PARAMS, makeParams, type Params } from "@blackmaria/engine";

/** A mistake on the command line: printed as one sentence, exit code 2. */
export class UsageError extends Error {}

export const TIER_NAMES: readonly Tier[] = ["novice", "adept", "master"];
export const CHAOS_NAMES: readonly ChaosName[] = ["off", "novice", "adept", "master"];

export interface Parsed {
  positionals: string[];
  flags: Map<string, string | true>;
}

/** `--name value`, `--name=value`, or a bare `--name`. Flags that take no value are listed in `bare`. */
export function parseFlags(argv: readonly string[], bare: ReadonlySet<string>): Parsed {
  const flags = new Map<string, string | true>();
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith("--")) {
      positionals.push(a);
      continue;
    }
    const eq = a.indexOf("=");
    const name = eq > 0 ? a.slice(2, eq) : a.slice(2);
    if (eq > 0) flags.set(name, a.slice(eq + 1));
    else if (bare.has(name)) flags.set(name, true);
    else {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith("--")) throw new UsageError(`--${name} needs a value.`);
      flags.set(name, v);
      i++;
    }
  }
  return { positionals, flags };
}

export function str(p: Parsed, name: string): string | undefined {
  const v = p.flags.get(name);
  if (v === true) throw new UsageError(`--${name} needs a value.`);
  return v;
}

export function int(p: Parsed, name: string, min: number, max: number): number | undefined {
  const v = str(p, name);
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new UsageError(`--${name} takes a whole number from ${min} to ${max}, not ${v}.`);
  return n;
}

export function tierFlag(p: Parsed, name: string, fallback: Tier | undefined): Tier {
  const v = str(p, name) ?? fallback;
  if (v === undefined) throw new UsageError(`--${name} is required: novice, adept or master.`);
  if (!(TIER_NAMES as readonly string[]).includes(v)) throw new UsageError(`--${name} takes novice, adept or master, not ${v}.`);
  return v as Tier;
}

export function chaosFlag(p: Parsed): ChaosName | undefined {
  const v = str(p, "chaos");
  if (v === undefined) return undefined;
  if (!(CHAOS_NAMES as readonly string[]).includes(v)) throw new UsageError(`--chaos takes off, novice, adept or master, not ${v}.`);
  return v as ChaosName;
}

export const PARAM_FLAGS = ["max-tick", "tick-ms", "post-interval", "expiry", "expiry-min", "expiry-max", "snatch-cost", "regen", "energy-start", "inventory-slots", "return-ticks", "change"] as const;

/**
 * Engine parameters from the flags. `--change 1|2|3` applies that change's parameters first (change 3 is a network
 * profile: it sets chaos to master); explicit flags win over it.
 */
export function paramFlags(p: Parsed): { params: Partial<Params>; change: 0 | 1 | 2 | 3; tickMs: number | undefined; chaos: ChaosName | undefined } {
  const change = (int(p, "change", 1, 3) ?? 0) as 0 | 1 | 2 | 3;
  const out: Partial<Params> = change ? { ...CHANGE_PARAMS[change] } : {};
  let chaos = chaosFlag(p);
  if (change === 3 && chaos === undefined) chaos = "master";
  const set = <K extends keyof Params>(k: K, v: number | undefined) => {
    if (v !== undefined) out[k] = v as Params[K];
  };
  set("maxTick", int(p, "max-tick", 1, 4000));
  set("postInterval", int(p, "post-interval", 1, 255));
  const expiry = str(p, "expiry");
  if (expiry !== undefined) {
    const m = /^(\d+):(\d+)$/.exec(expiry);
    if (!m) throw new UsageError(`--expiry takes two numbers and a colon, like 20:45, not ${expiry}.`);
    out.expiryMin = Number(m[1]);
    out.expiryMax = Number(m[2]);
  }
  set("expiryMin", int(p, "expiry-min", 1, 255));
  set("expiryMax", int(p, "expiry-max", 1, 255));
  set("snatchCost", int(p, "snatch-cost", 0, 100));
  set("regen", int(p, "regen", 0, 100));
  set("energyStart", int(p, "energy-start", 0, 100));
  set("inventorySlots", int(p, "inventory-slots", 1, 12));
  set("returnTicks", int(p, "return-ticks", 1, 255));
  try {
    makeParams(out);
  } catch {
    throw new UsageError("Those parameters don't fit together. expiry_min can't be above expiry_max, and every value has to be in range.");
  }
  return { params: out, change, tickMs: int(p, "tick-ms", 1, 60_000), chaos };
}

export const PARAM_HELP = `Parameters (every number in the match start; the defaults are the rules):
  --max-tick N          ticks per match (400)
  --tick-ms N           the deadline in ms (250 on the wire)
  --post-interval N     a new errand every N ticks (6)
  --expiry A:B          errand lifetime drawn from A to B ticks (30:70)
  --snatch-cost N       energy a snatch costs (100)
  --regen N             energy gained per tick (1)
  --energy-start N      energy at tick 0 (40)
  --inventory-slots N   slots per body (4)
  --return-ticks N      ticks before a delivered item comes back (40)
  --chaos PROFILE       off, novice, adept or master: the network profile on the wire
  --change 1|2|3        one of the three possible changes:
                          1  --post-interval 3 --expiry 20:45
                          2  --snatch-cost 50 --regen 2
                          3  --chaos master on every tier`;
