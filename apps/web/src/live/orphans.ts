import type { ServerMsg } from "@blackmaria/protocol";

/** How long after `welcome` a resent `match_start` counts as an orphan. The server sends them with the welcome. */
export const ORPHAN_WINDOW_MS = 250;
/** The longest to wait for left orphans to end before joining anyway. */
export const ORPHAN_WAIT_MS = 3000;

/**
 * On hello the server hands this token's unattached practice matches to the new connection (a page that was reloaded
 * mid-match leaves one behind). A fresh Start shouldn't pick one of those up and play it, and they count against the
 * limit of 2 at once. So: right after `welcome`, leave every match that turns up, wait for them to end, then join.
 */
export class OrphanGate {
  private open = false;
  private joined = false;
  private readonly orphans = new Set<string>();
  private running = 0;
  private timers: ReturnType<typeof setTimeout>[] = [];

  constructor(
    private readonly leave: (matchId: string) => void,
    private readonly join: () => void,
    private readonly timer: (fn: () => void, ms: number) => ReturnType<typeof setTimeout> = (fn, ms) => setTimeout(fn, ms),
  ) {}

  /** Call on `welcome`. */
  welcome(): void {
    this.open = true;
    this.timers.push(
      this.timer(() => {
        this.open = false;
        this.maybeJoin();
      }, ORPHAN_WINDOW_MS),
      this.timer(() => this.doJoin(), ORPHAN_WAIT_MS),
    );
  }

  /** True when the message belonged to an orphan and was handled here. */
  take(m: ServerMsg): boolean {
    if (m.type === "match_start" && this.open && !this.joined) {
      this.orphans.add(m.match_id);
      this.running++;
      this.leave(m.match_id);
      return true;
    }
    const id = "match_id" in m ? m.match_id : undefined;
    if (typeof id !== "string" || !this.orphans.has(id)) return false;
    if (m.type === "match_end") {
      this.running--;
      this.maybeJoin();
    }
    return true;
  }

  private maybeJoin(): void {
    if (!this.open && this.running <= 0) this.doJoin();
  }

  private doJoin(): void {
    if (this.joined) return;
    this.joined = true;
    for (const t of this.timers) clearTimeout(t);
    this.join();
  }
}
