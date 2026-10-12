import { canStart, type Mode, type Phase, type Runs, type Settings, type Speed } from "./slot.js";

export type KeyAction = { kind: "start" } | { kind: "stop" } | { kind: "speed"; speed: Speed };

/**
 * Practice shortcuts: Enter starts (or starts again), Escape stops, 1 2 4 pick the speed. Never while you type in the
 * editor or a form, with a modifier held, or while the by-hand item picker wants a number or Escape.
 */
export function practiceKey(key: string, ctx: { typing: boolean; modifier: boolean; picker: boolean; phase: Phase; anyBusy: boolean }): KeyAction | null {
  if (ctx.typing || ctx.modifier || ctx.picker) return null;
  if (key === "Enter") return canStart(ctx.phase) && !ctx.anyBusy ? { kind: "start" } : null;
  if (key === "Escape") return ctx.anyBusy ? { kind: "stop" } : null;
  if (key === "1" || key === "2" || key === "4") return { kind: "speed", speed: Number(key) as Speed };
  return null;
}

/** What changes with the next match, when the bar no longer matches the one running: "adept · 2x from the next match". */
export function queuedNote(running: Settings, next: { mode: Mode; tier: Settings["tier"]; speed: Speed; runs: Runs }): string | null {
  if (running.mode !== next.mode) return null;
  const parts: string[] = [];
  if (running.tier !== next.tier) parts.push(next.tier);
  if (running.speed !== next.speed) parts.push(`${next.speed}x`);
  if ((next.mode === "starter" || next.mode === "code") && running.runs !== next.runs) parts.push(`${next.runs} in a row`);
  return parts.length ? `${parts.join(" · ")} from the next match` : null;
}
