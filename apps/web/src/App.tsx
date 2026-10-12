import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { BrowserRouter, Link, NavLink, Route, Routes, useLocation, useNavigationType } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth.js";
import { CLOCK_MINUTES, OFFICIAL_CLOSES_MINUTE, mmss, useClock } from "./clock.js";
import { AssetImg, Button, Card, Loading } from "./ui/kit.js";
import { ConfettiOnMoments, DecorVars, FooterScene } from "./ui/decor.js";
import { StartHere } from "./pages/StartHere.js";
import { DocPage } from "./pages/Docs.js";
import { SimPage } from "./pages/Sim.js";
import { Practice } from "./pages/Practice.js";
import { Replay } from "./pages/Replay.js";
import { Official } from "./pages/Official.js";
import { Submit } from "./pages/Submit.js";
import { Review, ReviewCandidate, ReviewReplay } from "./pages/Review.js";

function Gate(props: { children: ReactNode }) {
  const auth = useAuth();
  const loc = useLocation();
  if (auth.status === "loading") return <Loading label="checking your link" />;
  if (auth.status === "anon") {
    const bad = new URLSearchParams(loc.search).get("link") === "invalid";
    return (
      <div className="center-page">
        <Card title="You need your magic link.">
          <AssetImg name="art_locked" className="state-art" />
          <p>{bad ? "That link didn't work. Check it against the email we sent and try again." : "Open the link from your invitation email. It logs you in and remembers this browser."}</p>
        </Card>
      </div>
    );
  }
  return <>{props.children}</>;
}

/** The clock caption under the large clock on Start Here. */
function clockCaption(c: NonNullable<ReturnType<typeof useClock>>): string {
  if (c.expired) return "Time's up.";
  if (!c.officialOpen) return "Too late for the official run. You can still practice and submit.";
  return `Official run's open. You've got ${mmss(c.untilOfficialCloses)} to start it.`;
}

/** The clock, always visible in the nav row, with the minute-85 mark: the last moment to start the official run (SPEC 8.5, v6.3). */
export function ClockBar(props: { large?: boolean }) {
  const c = useClock();
  // Before the clock is known, the nav keeps its place: the same shape, unseen.
  if (!c)
    return props.large ? null : (
      <div className="clock clock-placeholder" aria-hidden>
        <span className="clock-time mono">0:00</span>
        <span className="clock-track" />
        <span className="clock-minute mono small">minute 0</span>
      </div>
    );
  const pct = Math.min(100, (100 * c.minute) / CLOCK_MINUTES);
  const mark = `${(100 * OFFICIAL_CLOSES_MINUTE) / CLOCK_MINUTES}%`;
  return (
    <div className={`clock ${props.large ? "large" : ""} ${c.expired ? "expired" : ""}`} aria-label="the clock">
      <span className="clock-time mono">{c.expired ? "0:00" : mmss(c.secondsLeft)}</span>
      <span className="clock-track">
        <span className="clock-fill" style={{ width: `${pct}%` }} />
        <span className="clock-mark" style={{ left: mark }} />
        {props.large ? (
          <span className="clock-mark-label mono" style={{ left: mark }}>
            start by 85
          </span>
        ) : null}
      </span>
      {!props.large ? <span className={`clock-minute mono small ${c.expired ? "unseen" : ""}`}>minute {Math.min(CLOCK_MINUTES, Math.floor(c.minute))}</span> : null}
      {props.large ? <span className="clock-caption small">{clockCaption(c)}</span> : null}
    </div>
  );
}

function Nav() {
  const auth = useAuth();
  return (
    <header className="nav">
      <NavLink to="/" className="brand">
        <AssetImg name="ui_logo_spade" className="brand-logo" />
        <span className="display">BLACK MARIA</span>
      </NavLink>
      {/* Rendered before sign-in too, unseen, so the nav is the same height and the page under it never moves. */}
      <nav className={auth.status === "ok" ? "" : "unseen"} aria-hidden={auth.status === "ok" ? undefined : true}>
        <NavLink to="/" end>
          Start
        </NavLink>
        <NavLink to="/rules">Rules</NavLink>
        <NavLink to="/wire">Wire</NavLink>
        <NavLink to="/sim">Simulator</NavLink>
        <NavLink to="/practice">Practice</NavLink>
        <NavLink to="/official">Official</NavLink>
      </nav>
      <ClockBar />
    </header>
  );
}

/**
 * Once you have seen the change on the Official page (v6.3), a small pill under the navigation keeps it in view on
 * every other page. It leads back to the Official page, where it is explained in full.
 */
function ChangePill() {
  const auth = useAuth();
  const loc = useLocation();
  const change = auth.status === "ok" ? auth.me.change : null;
  if (!change || loc.pathname === "/official") return null;
  return (
    <Link className="change-pill" to="/official">
      <AssetImg name="icon_step_change" className="pill-icon" />
      <span className="pill-text">The change: {change.rule}</span>
    </Link>
  );
}

/**
 * The footer (v6.3): a scene across the full width. It is fixed to the bottom of the viewport, under the page: a
 * short page leaves it in view, a long one slides up off it at the end. It never moves, whatever the page does.
 */
const Footer = memo(function Footer() {
  return (
    <footer className="footer">
      <FooterScene />
    </footer>
  );
});

/** How long a new route keeps the height of the one before at most, while its data loads. */
const HOLD_CAP_MS = 8000;

/**
 * Each route fades and rises in (250 ms on the bouncy easing; a plain fade with reduced motion). The new route
 * starts at least as tall as the one it replaces and keeps that height until the fade is done and nothing in it is
 * still loading, so the page never collapses to a spinner and grows back. A link to a new route lands at the top.
 */
function PageTransition(props: { children: ReactNode }) {
  const loc = useLocation();
  const nav = useNavigationType();
  const ref = useRef<HTMLDivElement>(null);
  const height = useRef(0);
  const [released, setReleased] = useState<string | null>(null);
  // The height of the route being left, read once per route change (the observer below keeps it current).
  const hold = useMemo(() => height.current, [loc.pathname]);
  const holding = hold > 0 && released !== loc.pathname;
  useLayoutEffect(() => {
    if (nav !== "POP" && !loc.hash) window.scrollTo(0, 0);
  }, [loc.pathname]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (!el.style.minHeight) height.current = el.offsetHeight;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [loc.pathname]);
  useEffect(() => {
    const el = ref.current;
    if (!el || !holding) return;
    const path = loc.pathname;
    const t0 = performance.now();
    let done = false;
    const release = () => {
      if (done) return;
      done = true;
      mo.disconnect();
      clearTimeout(fade);
      clearTimeout(cap);
      setReleased(path);
    };
    const check = () => {
      if (performance.now() - t0 >= 250 && !el.querySelector(".loading")) release();
    };
    const mo = new MutationObserver(check);
    mo.observe(el, { childList: true, subtree: true });
    const fade = setTimeout(check, 260);
    const cap = setTimeout(release, HOLD_CAP_MS);
    return () => {
      done = true;
      mo.disconnect();
      clearTimeout(fade);
      clearTimeout(cap);
    };
  }, [holding, loc.pathname]);
  return (
    <div key={loc.pathname} ref={ref} className="page-enter" style={holding ? { minHeight: hold } : undefined}>
      {props.children}
    </div>
  );
}

export function NotFound() {
  return (
    <div className="center-page">
      <Card title="Nothing here.">
        <AssetImg name="art_404" className="state-art" />
        <p>That page doesn&apos;t exist. Start Here has everything.</p>
        <Button to="/">Start Here</Button>
      </Card>
    </div>
  );
}

function CandidateRoutes() {
  return (
    <Gate>
      <ChangePill />
      <Routes>
        <Route path="/" element={<StartHere />} />
        <Route path="/rules" element={<DocPage name="rules" />} />
        <Route path="/wire" element={<DocPage name="wire" />} />
        <Route path="/sim" element={<SimPage />} />
        <Route path="/practice" element={<Practice />} />
        <Route path="/replay/:id" element={<Replay />} />
        <Route path="/official" element={<Official />} />
        <Route path="/submit" element={<Submit />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Gate>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <DecorVars />
        <ConfettiOnMoments />
        <div className="sheet">
          <Nav />
          <main className="page">
            <PageTransition>
              <Routes>
                <Route path="/review" element={<Review />} />
                <Route path="/review/replay/:id" element={<ReviewReplay />} />
                <Route path="/review/:token" element={<ReviewCandidate />} />
                <Route path="*" element={<CandidateRoutes />} />
              </Routes>
            </PageTransition>
          </main>
        </div>
        <Footer />
      </AuthProvider>
    </BrowserRouter>
  );
}
