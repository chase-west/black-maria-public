import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, type Me } from "./api.js";

type AuthState = { status: "loading" } | { status: "anon" } | { status: "ok"; me: Me; refresh: () => void; loadedAt: number };

const Ctx = createContext<AuthState>({ status: "loading" });

/** Who is looking: the candidate behind the session cookie, refreshed every 20 seconds (the clock and the change). */
export function AuthProvider(props: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading" });
  useEffect(() => {
    let live = true;
    const load = () => {
      api.me().then(
        (me) => live && setState({ status: "ok", me, refresh: load, loadedAt: Date.now() }),
        () => live && setState((s) => (s.status === "ok" ? s : { status: "anon" })),
      );
    };
    load();
    const t = setInterval(load, 20_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);
  return <Ctx.Provider value={state}>{props.children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
