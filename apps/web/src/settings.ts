/** `prefers-reduced-motion: reduce`: the bounces become fades, the shake and the bobbing stop. */
export function prefersReducedMotion(): boolean {
  try {
    return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export const REDUCED_MOTION = prefersReducedMotion();
