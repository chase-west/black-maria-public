import { useEffect, useState } from "react";
import { useAuth } from "./auth.js";

export const CLOCK_MINUTES = 90;
/** The official run is open from the start of the clock and must start before this minute (SPEC 2, v6.3). */
export const OFFICIAL_CLOSES_MINUTE = 85;
/** The clock-ended state's one sentence, the same as the server's refusal (apps/server/src/clock.ts). */
export const CLOCK_ENDED_SENTENCE = "Time's up. Practice, the official run, and submissions are closed.";

export interface ClockNow {
  /** Minutes since the clock started (fractional). */
  minute: number;
  secondsLeft: number;
  expired: boolean;
  /** The official run can be started now (from the start of the clock until minute 85). */
  officialOpen: boolean;
  /** Seconds until minute 85, the last moment to start the official run (0 once past). */
  untilOfficialCloses: number;
}

/** The candidate's clock, ticking once a second on the server's time (SPEC 2, 8.5: the clock on every page). */
export function useClock(): ClockNow | null {
  const auth = useAuth();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (auth.status !== "ok" || !auth.me.clock) return null;
  const me = auth.me;
  const skew = new Date(me.server_time).getTime() - auth.loadedAt;
  const t = now + skew;
  const opened = new Date(me.clock!.opened_at).getTime();
  const ends = new Date(me.clock!.ends_at).getTime();
  const minuteMs = (ends - opened) / CLOCK_MINUTES;
  const minute = Math.max(0, (t - opened) / minuteMs);
  const secondsLeft = Math.max(0, Math.round((ends - t) / 1000));
  return {
    minute,
    secondsLeft,
    expired: secondsLeft <= 0,
    officialOpen: minute < OFFICIAL_CLOSES_MINUTE && secondsLeft > 0,
    untilOfficialCloses: Math.max(0, Math.round(((OFFICIAL_CLOSES_MINUTE - minute) * minuteMs) / 1000)),
  };
}

export function mmss(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
