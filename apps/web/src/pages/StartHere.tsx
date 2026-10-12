import { Link } from "react-router-dom";
import { ClockBar } from "../App.js";
import { CLOCK_ENDED_SENTENCE, useClock } from "../clock.js";
import { AssetImg, Button, ClockEnded, Corners, Grain } from "../ui/kit.js";
import { HeroSky } from "../ui/decor.js";

/** The step the first sixty seconds go through (SPEC 8.4): one click and the shipped bot is playing. */
const FIRST_RUN = "/practice?watch=starter";

/** The path (SPEC 8.5, item 6, v6.3): each step a link, with its time. No step waits for the clock. */
const STEPS: { icon: string; text: string; time: string; to: string }[] = [
  { icon: "icon_step_read", text: "Read the rules", time: "10 min", to: "/rules" },
  { icon: "icon_step_run", text: "Run the bot we gave you", time: "5 min", to: FIRST_RUN },
  { icon: "icon_step_build", text: "Make it better", time: "40 min", to: "/sim" },
  { icon: "icon_step_change", text: "See the change on the Official page", time: "2 min", to: "/official" },
  { icon: "icon_step_adapt", text: "Adapt to it (the simulator has flags)", time: "15 min", to: "/sim" },
  { icon: "icon_step_official", text: "Official run (start by minute 85)", time: "5 min", to: "/official" },
  { icon: "icon_step_submit", text: "Write the note, hand it in", time: "5 min", to: "/submit" },
];

/** Start Here (SPEC 8.5): the first screen after the magic link, exactly these seven things, in order. */
export function StartHere() {
  const clock = useClock();
  if (clock?.expired)
    return (
      <ClockEnded sentence={CLOCK_ENDED_SENTENCE}>
        <Button to="/official">Your official run</Button>
        <Button to="/submit">Your submission</Button>
      </ClockEnded>
    );
  return (
    <div className="start">
      <figure className="hero">
        <AssetImg name="art_title" alt="A crooked cartoon house at dusk on a mustard hill, Maria peeking out of the chimney." className="hero-art" />
        <HeroSky />
        <Grain strength={0.06} />
      </figure>
      <p className="lede">
        It&apos;s a house. You&apos;re in it, and so is Maria, a ghost. Errands show up on a board: bring this there, go stand in that room, hold onto this for a bit. First one to finish an errand gets the points.
        There are more errands than you can finish, so picking is the game. 400 ticks, higher score wins.
      </p>
      <p className="lede">
        We give you a bot that already plays. It&apos;s bad. Make it good. Everything&apos;s open: the rules, Maria&apos;s code, the server, a simulator you can run locally. The network between you and the house is deliberately lossy. The official run is open now, and you get one shot at it.
      </p>
      <div className="first-run">
        <Button tone="go" big to={FIRST_RUN} dataFirstRun>
          <AssetImg name="icon_step_run" className="btn-icon" /> Watch the bot play Maria
        </Button>
        <span className="small">No install. It runs right here in this tab.</span>
      </div>
      <ClockBar large />
      <blockquote className="brief card flat-card">
        <p>
          <strong>Goal.</strong> Score as high as you can against Maria in the official run.
        </p>
        <p>
          <strong>What you have.</strong> Everything: the rules, Maria&apos;s code, the server&apos;s code, a simulator, and a client that already plays the official run, badly. Run it as-is and it&apos;ll beat Novice sometimes. The rest is up to you.
        </p>
        <p>
          <strong>What&apos;s fair.</strong> Anything the server accepts. If you find a way to score that we didn&apos;t intend, use it and tell us in your note. That&apos;s the best possible outcome. Off limits: attacking the server&apos;s availability and messing with other candidates&apos; sessions.
        </p>
        <p>
          <strong>The change.</strong> The official run plays with one rule changed. You&apos;ll see which the first time you open the Official page. The simulator can play it before you commit. One shot, whenever you&apos;re ready.
        </p>
        <p>
          <strong>Tools.</strong> Any tool, any language, any AI.
        </p>
      </blockquote>
      <p className="boxed">Everything you need is in the repo. Nothing&apos;s hidden. Some things just aren&apos;t pointed out.</p>
      <ol className="path">
        {STEPS.map((s, i) => (
          <li key={s.text}>
            <Link to={s.to} className={`path-step ${s.to === FIRST_RUN ? "now" : ""}`}>
              <Corners />
              <span className="path-n">{i + 1}</span>
              <AssetImg name={s.icon} className="path-icon" />
              <span className="path-text">{s.text}</span>
              <span className="path-time mono">{s.time}</span>
            </Link>
          </li>
        ))}
      </ol>
      <p className="small">The simulator has a flag for every rule that might change. If your bot reads the rules from the match start, the change costs you nothing.</p>
    </div>
  );
}
