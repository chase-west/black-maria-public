# Copy changes

Every candidate-facing string rewritten in the voice of `docs/VOICE.md`, as before → after, grouped by page. Strings that only moved into another file verbatim (the brief copied into the page and the email, test expectations, the profiler titles mirrored in the portal and SPEC) are listed once.

361 strings in all.

## Start Here and the brief (15)

`SPEC.md`

- **Before:** > **What you have.** The whole system: the rules, Maria's source, the server's source, a simulator, and a client that already plays the official run badly. Run it as-is and you will beat Novice sometimes. Everything from there is up to you.
  **After:** > **What you have.** Everything: the rules, Maria's code, the server's code, a simulator, and a client that already plays the official run, badly. Run it as-is and it'll beat Novice sometimes. The rest is up to you.

- **Before:** > **What is fair.** Anything the server accepts is fair. If you find a way to score that we did not intend, use it, and tell us in your note. That is the best possible outcome. The only things off limits are attacking the server's availability and touching other candidates' sessions.
  **After:** > **What's fair.** Anything the server accepts. If you find a way to score that we didn't intend, use it and tell us in your note. That's the best possible outcome. Off limits: attacking the server's availability and messing with other candidates' sessions.

- **Before:** > **The change.** The official run plays with one rule changed. You will see which one the first time you open the Official page, and the simulator can play with it before you commit. One attempt, whenever you are ready.
  **After:** > **The change.** The official run plays with one rule changed. You'll see which the first time you open the Official page. The simulator can play it before you commit. One shot, whenever you're ready.

`apps/web/src/pages/StartHere.tsx`

- **Before:** Run the client we gave you once
  **After:** Run the bot we gave you

- **Before:** Make it better, in whatever direction you think matters
  **After:** Make it better

- **Before:** Open the Official page to see the change
  **After:** See the change on the Official page

- **Before:** Adapt, with the simulator's flags for it
  **After:** Adapt to it (the simulator has flags)

- **Before:** Official run, before minute 85
  **After:** Official run (start by minute 85)

- **Before:** Note and submit
  **After:** Write the note, hand it in

- **Before:** There is a house with two bodies in it: yours, and Maria's, a ghost with her own agenda. A board of errands fills up over the match: deliver this item to that fixture, be in this room, carry this for a while. Whoever completes an errand first scores its value. There are more errands than you can finish, so choosing is the game. After 400 ticks the higher score wins.
  **After:** It's a house. You're in it, and so is Maria, a ghost. Errands show up on a board: bring this there, go stand in that room, hold onto this for a bit. First one to finish an errand gets the points. There are more errands than you can finish, so picking is the game. 400 ticks, higher score wins.

- **Before:** You have a client that already plays, badly. Make it win. It talks to the house over a bad network, and everything it touches is published: the rules, Maria's code, the server, a simulator. The official run is open now. You get one attempt, whenever you are ready.
  **After:** We give you a bot that already plays. It's bad. Make it good. Everything's open: the rules, Maria's code, the server, a simulator you can run locally. The network between you and the house is deliberately lossy. The official run is open now, and you get one shot at it.

- **Before:** Watch the client play Maria
  **After:** Watch the bot play Maria

- **Before:** No install. It starts at once, in this tab.
  **After:** No install. It runs right here in this tab.

- **Before:** Everything you need is in the repo. Nothing is hidden. Some things are not pointed at.
  **After:** Everything you need is in the repo. Nothing's hidden. Some things just aren't pointed out.

- **Before:** The simulator has flags for every rule that might change. Bots that read the rules from the match start have nothing to do when you see the change.
  **After:** The simulator has a flag for every rule that might change. If your bot reads the rules from the match start, the change costs you nothing.

## Portal shell (sign-in gate, the clock, 404, shared states) (16)

`apps/server/src/clock.ts`

- **Before:** Your 90 minutes are up, so practice, the official run and submission are closed.
  **After:** Time's up. Practice, the official run, and submissions are closed.

- **Before:** Your clock has run out, so the official run is closed.
  **After:** Time's up, so the official run is closed.

- **Before:** The official run had to start by minute 85, and your clock is past it.
  **After:** Too late for the official run. It had to start by minute 85.

- **Before:** The official run is open. Start it by minute 85.
  **After:** Official run's open. Start it by minute 85.

- **Before:** The official run had to start by minute 85. Your clock is past that, so it is closed.
  **After:** Too late for the official run. It had to start by minute 85.

`apps/web/src/App.tsx`

- **Before:** <Loading label="opening the door" />
  **After:** <Loading label="checking your link" />

- **Before:** <Card title="This house needs your magic link.">
  **After:** <Card title="You need your magic link.">

- **Before:** That link did not open anything. Check it against the email we sent and open it again.
  **After:** That link didn't work. Check it against the email we sent and try again.

- **Before:** Open the link from your invitation email. It lets you in and remembers this browser.
  **After:** Open the link from your invitation email. It logs you in and remembers this browser.

- **Before:** return "Your 90 minutes are up.";
  **After:** return "Time's up.";

- **Before:** The official run closed at minute 85. You can still practice and submit.
  **After:** Too late for the official run. You can still practice and submit.

- **Before:** The official run is open now. Start it before minute 85, in ${mmss(c.untilOfficialCloses)}.
  **After:** Official run's open. You've got ${mmss(c.untilOfficialCloses)} to start it.

- **Before:** <Card title="Nothing in this room.">
  **After:** <Card title="Nothing here.">

- **Before:** <p>That page is not part of the house. Start Here has everything.</p>
  **After:** <p>That page doesn't exist. Start Here has everything.</p>

`apps/web/src/ui/kit.tsx`

- **Before:** {props.label ?? "one moment"}
  **After:** {props.label ?? "loading"}

- **Before:** <Card title="The clock has ended.">
  **After:** <Card title="Closed.">

## Official page and the change (22)

`apps/web/src/pages/Official.tsx`

- **Before:** <p className="small">The simulator can play it first. These are the exact flags:</p>
  **After:** <p className="small">Try it in the simulator first:</p>

- **Before:** The official run's status did not load. It will retry.
  **After:** Couldn't load the official run. Retrying.

- **Before:** <Loading label="unlocking the front door" />
  **After:** <Loading label="loading the official run" />

- **Before:** <Card title="The official run is playing" flat>
  **After:** <Card title="Official run in progress" flat>

- **Before:** Nine matches, three at a time, one tier after another. It plays to the end on its own; your client only has to stay connected.
  **After:** 9 matches, 3 at a time, one tier after another. It runs to the end on its own. Your client just has to stay connected.

- **Before:** <Card title="Your official run is used">
  **After:** <Card title="You've used your official run">

- **Before:** <p>You have already played your one official run. Practice stays open until the clock runs out.</p>
  **After:** <p>You only get one. Practice stays open until time's up.</p>

- **Before:** <p className="small">You can still practice, and submit your note before minute 90.</p>
  **After:** <p className="small">You can still practice and submit before minute 90.</p>

- **Before:** <li>One attempt, with the change{shown ? `: ${shown.rule}` : "."}</li>
  **After:** <li>One shot, with the change{shown ? `: ${shown.rule}` : "."}</li>

- **Before:** <li>Nine matches, three per tier, three at a time.</li>
  **After:** <li>9 matches: 3 per tier, 3 at a time.</li>

- **Before:** <li>About five minutes.</li>
  **After:** <li>About 5 minutes.</li>

- **Before:** <li>Each win scores 1 against Novice, 3 against Adept, 9 against Master: 39 at most.</li>
  **After:** <li>A win is worth 1 against Novice, 3 against Adept, 9 against Master. 39 max.</li>

- **Before:** <li>It cannot be stopped once it starts.</li>
  **After:** <li>Once it starts, it can't be stopped.</li>

- **Before:** <p>The run is played by your client over the wire. Start it from your machine:</p>
  **After:** <p>Your client plays it over the wire. Start it from your machine:</p>

- **Before:** This page fills in the nine matches live as soon as your client says hello.
  **After:** This page fills in the 9 matches live once your client connects.

- **Before:** I am starting it now
  **After:** I'm starting it now

- **Before:** <Card title="The official run is open" className="official-open">
  **After:** <Card title="Official run's open" className="official-open">

- **Before:** <Loading label="ringing the bell" />
  **After:** <Loading label="loading the change" />

- **Before:** <p>One attempt, nine matches, played by your client over the wire, with the change. Start it whenever you are ready, before minute 85.</p>
  **After:** <p>One shot, 9 matches, played by your client over the wire, with the change. Start it whenever you're ready, before minute 85.</p>

`packages/protocol/src/change.ts`

- **Before:** The board is fuller and faster. Read post_interval, expiry_min and expiry_max from the match start.
  **After:** More errands, shorter lives. Read post_interval, expiry_min and expiry_max from the match start.

- **Before:** Maria can snatch about four times as often, and so can you. Read snatch_cost and regen from the match start.
  **After:** Maria can snatch about 4 times as often. So can you. Read snatch_cost and regen from the match start.

- **Before:** On the wire, every match now loses one message in ten each way and goes silent once for 400 ms. The match start says which network a match is on.
  **After:** Every match on the wire now loses 1 packet in 10 each way and goes silent once for 400 ms. The match start says which network a match is on.

## Practice (19)

`apps/web/src/pages/Practice.tsx`

- **Before:** Your matches did not load. Reload the page to try again.
  **After:** Couldn't load your matches. Reload to try again.

- **Before:** <Loading label="finding your matches" />
  **After:** <Loading label="loading your matches" />

- **Before:** You already have two practice matches running. Let one finish, or leave it, then start again.
  **After:** You've already got 2 practice matches running. Finish or leave one, then start again.

- **Before:** Practice is limited per hour. Wait a few minutes, then start again.
  **After:** You've hit the hourly practice limit. Wait a few minutes and try again.

- **Before:** Your 90 minutes are up, so practice is closed. Your submission and official results are kept.
  **After:** Time's up, so practice is closed. Your submission and official results are kept.

- **Before:** The assessment window is closed, so practice is too.
  **After:** This cohort's window is closed, so practice is too.

- **Before:** The house is full or restarting. Wait a few seconds and start again.
  **After:** The server's full or restarting. Wait a few seconds and try again.

- **Before:** The profiler for this match is not available yet; the replay has everything.
  **After:** No profiler for this match yet. The replay has everything.

- **Before:** <p>Start a practice match from your wire client on your machine, then press Watch. The strip under the arena marks every move that arrived on time, late, or not at all.</p>
  **After:** <p>Start a practice match from your client, then press Watch. The strip under the arena shows each move: on time, late, or missing.</p>

- **Before:** the client plays a local simulator, and nothing shows here.
  **After:** the client plays a local simulator and nothing shows up here.

- **Before:** Without <code>--server</code> and <code>--token</code> (or a <code>.env</code> with them, see Simulator) the client
  **After:** Without <code>--server</code> and <code>--token</code> (or a <code>.env</code> with them, see Simulator), the client

- **Before:** press the item's number. The first key in a tick is your move for it; no key is a wait.
  **After:** press the item's number. The first key you press in a tick is your move. No key means wait.

- **Before:** <p>Your code runs in this tab and plays one practice match while you watch. Edit it below; it saves as you type.</p>
  **After:** <p>Your code runs in this tab and plays one practice match. Edit it below. It saves as you type.</p>

- **Before:** <p>The bot the client ships with: nearest errand first, never snatches. Watch it race Maria, then make yours better.</p>
  **After:** <p>The bot we gave you: nearest errand first, never snatches. Watch it race Maria, then make yours better.</p>

- **Before:** <p>Nothing is playing on the wire for your token yet. Start a practice match from your client and it appears here.</p>
  **After:** <p>Nothing's playing on the wire for your token yet. Start a practice match from your client and it'll show up here.</p>

- **Before:** <p>Your hands are empty. Press Escape.</p>
  **After:** <p>You're not holding anything. Press Escape.</p>

- **Before:** You won." : view.end.result === "draw" ? "A draw." : "Maria won.
  **After:** You won." : view.end.result === "draw" ? "Draw." : "You lost.

- **Before:** <Loading label="adding up the profiler" />
  **After:** <Loading label="adding it up" />

- **Before:** console: what your bot logs shows up here.
  **After:** console: your bot's logs show up here.

## Game captions and the board (10)

As they render over the arena:

| before | after |
|---|---|
| you carried a ring for 16 ticks, +3 | you +3 · ring held 16 ticks |
| Maria got the letter to the fireplace first, +4 | Maria +4 · letter to fireplace |
| nobody did the library in time | expired · library |
| new errand: the coin to the altar, worth 6 | new · coin to altar · worth 6 |
| Maria is winding up a snatch: step out of reach now | Maria winding up · step out of reach |
| the house put a letter back | letter back on the floor |
| your sigil paid out: +40 energy | your sigil · +40 energy |

`apps/web/src/game/view.ts`

- **Before:** const verb = er.type === "deliver" ? "got" : er.type === "visit" ? "visited" : "carried"; return e.by === "you" ? { text: `you ${verb} ${errandWords(v, er)}, +${er.value}`, tone: "you" } : { text: `Maria ${verb} ${errandWords(v, er)} first, +${er.value}`, tone: "maria" };
  **After:** return e.by === "you" ? { text: `you +${er.value} · ${errandShort(v, er)}`, tone: "you" } : { text: `Maria +${er.value} · ${errandShort(v, er)}`, tone: "maria" };

- **Before:** { text: `nobody did ${errandWords(v, er)} in time`, tone: "plain" }
  **After:** { text: `expired · ${errandShort(v, er)}`, tone: "plain" }

- **Before:** { text: `you snatched the ${kind(e.item)} from Maria`, tone: "you" }
  **After:** { text: `you snatched Maria's ${kind(e.item)}`, tone: "you" }

- **Before:** { text: "you wound up a snatch: it lands next tick if Maria stays in reach", tone: "you" } : { text: "Maria is winding up a snatch: step out of reach now", tone: "maria" }
  **After:** { text: "you wind up · grab next tick if she stays in reach", tone: "you" } : { text: "Maria winding up · step out of reach", tone: "maria" }

- **Before:** { text: `the house put a ${e.item_kind} back`, tone: "plain" }
  **After:** { text: `${e.item_kind} back on the floor`, tone: "plain" }

- **Before:** { text: `new errand: ${errandWords(v, e.errand)}, worth ${e.errand.value}`, tone: "plain" }
  **After:** { text: `new · ${errandShort(v, e.errand)} · worth ${e.errand.value}`, tone: "plain" }

- **Before:** { text: "the vault door is open", tone: "plain" }
  **After:** { text: "vault door open", tone: "plain" }

- **Before:** { text: "the safe is open", tone: "plain" }
  **After:** { text: "safe open", tone: "plain" }

- **Before:** { text: "your sigil paid out: +40 energy", tone: "you" } : { text: "Maria's sigil paid out", tone: "maria" }
  **After:** { text: "your sigil · +40 energy", tone: "you" } : { text: "Maria's sigil paid out", tone: "maria" }

`apps/web/src/game/Board.tsx`

- **Before:** aria-label="both bodies"
  **After:** aria-label="you and Maria"

## The profiler (6)

`packages/protocol/src/profiler.ts`

- **Before:** title: "Errands that expired while you were heading for them"
  **After:** title: "Expired on your way there"

- **Before:** title: "Value you never attempted"
  **After:** title: "Points you never went for"

- **Before:** title: "Ticks idle"
  **After:** title: "Idle ticks"

- **Before:** title: "Energy unused at the end"
  **After:** title: "Energy left at the end"

`apps/web/src/game/Profiler.tsx`

- **Before:** left in the tank when the match ended
  **After:** unspent when the match ended

- **Before:** You won" : r.result === "draw" ? "A draw" : "Maria won
  **After:** You won" : r.result === "draw" ? "Draw" : "You lost

## Browser editor starter (6)

`apps/web/src/editor/starter.ts`

- **Before:** // decide(state) is called once a tick and must return a move:
  **After:** // decide(state) runs once a tick and returns a move:

- **Before:** // This one walks to the nearest open errand's next step and does it. Once it picks a target it walks there without // looking again, and it remembers where it saw each item, so when Maria picks one up it walks to the empty spot anyway. // It never checks expiry, never snatches, and assumes four inventory slots. "What strong bots do" in the rules is the // list of what to change.
  **After:** // This one walks to the nearest open errand and does it. Once it picks a target it doesn't look again. It remembers // where it saw each item, so if Maria picks one up it walks to the empty spot anyway. It never checks expiry, never // snatches, and assumes 4 inventory slots. "What strong bots do" in the rules lists what to fix.

- **Before:** this.seen = new Map(); // every item seen on the floor, where we last saw it this.goal = null; // the target we are walking to
  **After:** this.seen = new Map(); // every item we've seen on the floor, and where this.goal = null; // where we're walking

- **Before:** // Keep walking to the last target while it is still a goal; otherwise pick the nearest.
  **After:** // Stick with the last target while it's still a goal. Otherwise pick the nearest.

- **Before:** // Remember items: note every item on the floor, forget the ones we hold and the ones that should be on our tile // but are not. An item Maria picked up stays where we last saw it.
  **After:** // Note every item on the floor. Forget the ones we hold and the ones that should be on our tile but aren't. // An item Maria picked up stays where we last saw it.

- **Before:** // Where to go next for an errand: the fixture if we hold the item, otherwise a remembered item; any tile of a visit's room.
  **After:** // Where to go for an errand: the fixture if we hold the item, otherwise a remembered item, or any tile of a visit's room.

## Submit (12)

`apps/web/src/pages/Submit.tsx`

- **Before:** What did you notice about the system that we did not say?
  **After:** What did you figure out that we didn't tell you?

- **Before:** <Card title="Submitted. Thank you.">
  **After:** <Card title="Submitted.">

- **Before:** <p className="small">No official run is recorded. Your note and code are in.</p>
  **After:** <p className="small">No official run on record. Your note and code are in.</p>

- **Before:** <p className="small">You can change it until your clock runs out; the latest one counts.</p>
  **After:** <p className="small">You can resubmit until time's up. Last one counts.</p>

- **Before:** Your submission could not be loaded. Reload the page to try again.
  **After:** Couldn't load your submission. Reload to try again.

- **Before:** <Loading label="finding your folder" />
  **After:** <Loading label="loading your submission" />

- **Before:** The server refused the submission (status ${r.status}). Try again.
  **After:** The server rejected that (status ${r.status}). Try again.

- **Before:** The upload did not reach the server. Check your connection and submit again.
  **After:** The upload didn't reach the server. Check your connection and try again.

- **Before:** <p className="lede">Your code and two short answers. You can change them until the clock ends; the latest one counts.</p>
  **After:** <p className="lede">Code plus two short answers. You can resubmit until time's up. Last one counts.</p>

- **Before:** A zip of your client and bot (20 MB at most), or a link to the repository. A person reads it. Nobody runs it.
  **After:** A zip of your client and bot (20 MB max), or a repo link. A person reads it. Nobody runs it.

- **Before:** or a repository URL <input
  **After:** or a repo URL <input

- **Before:** <Loading label="handing it in" />
  **After:** <Loading label="sending" />

## Simulator, Replay, Rules and Wire pages, arena (15)

`apps/web/src/pages/Sim.tsx`

- **Before:** <p>The simulator is the engine, all three tiers of Maria, a local wire server with the three bad networks, and the profiler. It does everything the server does, offline, as fast as your bot decides.</p>
  **After:** <p>The simulator runs the whole game on your machine: all three Marias, the lossy network, the profiler. Same code as the server, no waiting on ticks.</p>

- **Before:** <code>--change 1</code>, <code>2</code> or <code>3</code> plays each possible change before you commit. The source is in the repository under{" "} <code>packages/sim</code>, with Maria in <code>packages/house-bots</code>.
  **After:** <code>--change 1</code>, <code>2</code> or <code>3</code> plays one of the possible changes. The source is in{" "} <code>packages/sim</code>, and Maria is in <code>packages/house-bots</code>.

- **Before:** <code>--chaos</code> and the rest), and <code>--change 1</code>
  **After:** <code>--chaos</code> and the rest). <code>--change 1</code>

- **Before:** The client plays a local simulator unless you tell it where this server is. Put these two lines in a <code>.env</code> file in the directory you run it from, and{" "} <code>npx blackmaria play --vs novice</code> plays here:
  **After:** By default the client plays a local simulator. To play on this server, put these two lines in a <code>.env</code> file where you run it, and{" "} <code>npx blackmaria play --vs novice</code> plays here:

`apps/web/src/ui/setup.tsx`

- **Before:** The source of everything, the server and Maria included, is the public repository:{" "}
  **After:** All the source, server and Maria included, is in the public repo:{" "}

- **Before:** . Its README says how to build it and run the same commands from it.
  **After:** . Its README covers building it and running the same commands from source.

`apps/web/src/pages/Replay.tsx`

- **Before:** <Card title="That replay is not here.">
  **After:** <Card title="Replay not found.">

- **Before:** <p>It may belong to another token, or the match was stopped before it ended. Your finished matches are listed on Practice.</p>
  **After:** <p>It's someone else's, or the match stopped before it ended. Your finished matches are on Practice.</p>

- **Before:** <Loading label="rewinding" />
  **After:** <Loading label="loading the replay" />

`apps/web/src/pages/Docs.tsx`

- **Before:** <ErrorNote>The {props.name === "rules" ? "rules" : "wire spec"} did not load. Reload the page to try again.</ErrorNote>
  **After:** <ErrorNote>Couldn't load the {props.name === "rules" ? "rules" : "wire doc"}. Reload to try again.</ErrorNote>

- **Before:** <Loading label={props.name === "rules" ? "finding the rules" : "unrolling the wire"} />
  **After:** <Loading label={props.name === "rules" ? "loading the rules" : "loading the wire doc"} />

`apps/web/src/game/ArenaView.tsx`

- **Before:** <Loading label="the house is waking" />
  **After:** <Loading label="loading the map" />

`apps/web/src/pages/Sim.tsx`

- **Before:** prints: `You (the starter bot) against Maria (Master), seed 7. Result: you lost 59 to 60. The profiler. ... Errands Maria took first     20, value 56 Ticks idle                   3 of 400 Snatches                     for you 0, against you 2 (value 8)`,
  **After:** prints: `You (the starter bot) against Maria (Master), seed 7. Result: you lost 78 to 131. The profiler. ... Errands Maria took first   25, value 104 Idle ticks                 52 of 400 Snatches                   for you 0 (value 0), against you 0 (value 0)`,

- **Before:** prints: `Parameters: ... snatch_cost 50, regen 2 ... seed 1951143280: you won 44 to 31 ... 5 matches: 2 won, 0 drawn, 3 lost (40.0% won).`,
  **After:** prints: `Parameters: ... snatch_cost 50, regen 2 ... seed 1115408942: you won 117 to 95 ... 5 matches: 1 won, 0 drawn, 4 lost (20.0% won).`,

- **Before:** prints: `A local wire server on UDP 127.0.0.1:7777, Master network profile. Point your client at it; when its match ends you get the ten-item checklist from docs/WIRE.md, each line pass or fail.`,
  **After:** prints: `Local wire server listening on UDP 127.0.0.1:7777. Any 16-byte token works. Ctrl-C stops it. Every match uses the Master network profile. Checking clients against the checklist in docs/WIRE.md. ... (when a match ends: the ten checks, each pass or FAIL)`,

## Reviewer pages (9)

`apps/web/src/pages/Review.tsx`

- **Before:** <ErrorNote>That token does not open the reviewer room.</ErrorNote>
  **After:** <ErrorNote>Wrong admin token.</ErrorNote>

- **Before:** The candidate list did not load. Reload to try again.
  **After:** Couldn't load the candidates. Reload to try again.

- **Before:** <Loading label="gathering the files" />
  **After:** <Loading label="loading candidates" />

- **Before:** That candidate could not be loaded.
  **After:** Couldn't load that candidate. Reload to try again.

- **Before:** <Loading label="opening the folder" />
  **After:** <Loading label="loading the candidate" />

- **Before:** That replay could not be loaded.
  **After:** Couldn't load that replay. Reload to try again.

- **Before:** <Loading label="rewinding" />
  **After:** <Loading label="loading the replay" />

- **Before:** <p className="small">No wire quality yet: no official match has finished.</p>
  **After:** <p className="small">No wire quality yet. No official match has finished.</p>

- **Before:** <p className="small">No seams document is configured on this server.</p>
  **After:** <p className="small">This server has no seams doc configured.</p>

## Link preview (1)

`packages/style/src/site.ts`

- **Before:** You have 90 minutes and a client that already plays, badly: make it beat Maria to the errands over the wire, then play the official run.
  **After:** You get 90 minutes and a bot that already plays, badly. Make it beat Maria over the wire, then play the official run.

## Emails (9)

`apps/server/src/mail.ts`

- **Before:** This is your magic link:
  **After:** Here's your magic link:

- **Before:** You have 90 minutes from the moment you open it. The clock starts then and is on every page. The official run is open from the start, and it plays with one rule changed. The Official page tells you which one.
  **After:** You have 90 minutes from the moment you open it. The clock starts then and shows on every page. The official run is open from the start, and it plays with one rule changed. The Official page tells you which.

- **Before:** Open the link on the computer you will build on. It lets you in and remembers that browser.
  **After:** Open it on the computer you'll build on. It logs you in and remembers that browser.

- **Before:** The client and the simulator run on your machine. The Simulator page has the one command that installs them and the two lines that point the client at the server. The client also needs your token: the 32 characters at the end of the link above.
  **After:** The client and the simulator run on your machine. The Simulator page has the install command and the two lines that point the client at the server. The client also needs your token: the last 32 characters of the link above.

`apps/server/src/clock.ts`

- **Before:** BLACK MARIA: your official run and the change
  **After:** BLACK MARIA: the change

- **Before:** You opened the Official page, so here is the change. Your official run plays with it:
  **After:** You opened the Official page, so here's the change. Your official run plays with it:

- **Before:** To try it first, give the simulator these flags: ${change.flags}
  **After:** To try it first, run the simulator with: ${change.flags}

- **Before:** The official run is open now. You get one attempt. Start it before minute 85. Your clock ends at minute 90.
  **After:** The official run is open now. One shot. Start it before minute 85. Your clock ends at minute 90.

- **Before:** Start it from your machine with the client (nine matches, about five minutes, it cannot be stopped):
  **After:** Start it from your machine (9 matches, about 5 minutes, can't be stopped once it starts):

## Server errors (WebSocket, HTTP, submission) (28)

`apps/server/src/hub.ts`

- **Before:** Something went wrong in the house. Start the match again.
  **After:** Something broke on the server. Start the match again.

- **Before:** You sent too many messages too fast. Send at most one move a tick.
  **After:** Too many messages too fast. Send at most one move a tick.

- **Before:** The WebSocket takes JSON text only. Send each message as text.
  **After:** The WebSocket only takes JSON text. Send each message as text.

- **Before:** Say hello first, with your token, then join a match.
  **After:** Send hello with your token first, then join a match.

- **Before:** That match is not running any more. Start a new one.
  **After:** That match isn't running anymore. Start a new one.

- **Before:** Your move for tick ${msg.tick} arrived after its deadline; the open tick is ${room.state.tick}. Send each move as soon as its state arrives.
  **After:** Your move for tick ${msg.tick} missed its deadline (the open tick is ${room.state.tick}). Send each move as soon as its state arrives.

- **Before:** This connection already said hello. Send join next.
  **After:** This connection already sent hello. Send join next.

- **Before:** The house does not know that token. Copy it again from your magic link.
  **After:** Unknown token. Copy it again from your magic link.

- **Before:** Your token has too many connections open. Close a tab or a client, then try again.
  **After:** Too many connections open on your token. Close a tab or a client and try again.

- **Before:** The house is restarting. Try again in a minute.
  **After:** The server's restarting. Try again in a minute.

- **Before:** The assessment window is not open, so practice is closed.
  **After:** This cohort's window isn't open, so practice is closed.

- **Before:** The official run is played over the wire, not the WebSocket. Start it from your client.
  **After:** The official run goes over the wire, not the WebSocket. Start it from your client.

- **Before:** Practice is limited to ${limit} matches an hour. Wait a few minutes and try again.
  **After:** Practice is capped at ${limit} matches an hour. Wait a few minutes and try again.

- **Before:** You can play at most ${this.cfg.limits.practiceConcurrent} practice matches at once. Finish or leave one first.
  **After:** You can run ${this.cfg.limits.practiceConcurrent} practice matches at once. Finish or leave one first.

- **Before:** The house is full right now. Wait a few seconds and start again.
  **After:** The server's full right now. Wait a few seconds and try again.

`apps/server/src/http.ts`

- **Before:** There is no profiler for that match. The profiler covers finished practice matches.
  **After:** No profiler for that match. The profiler only covers finished practice matches.

- **Before:** There is no such download. The Simulator page lists what you can download.
  **After:** No such download. The Simulator page lists what's available.

`apps/server/src/admin.ts`

- **Before:** What did you notice about the system that we did not say?
  **After:** What did you figure out that we didn't tell you?

- **Before:** The upload is over 20 MB. Remove build output and dependencies, or send a repository URL instead.
  **After:** The upload is over 20 MB. Leave out build output and dependencies, or send a repo URL.

- **Before:** The zip is over 20 MB. Remove build output and dependencies, or send a repository URL instead.
  **After:** The zip is over 20 MB. Leave out build output and dependencies, or send a repo URL.

- **Before:** The code file is not a zip. Upload a .zip, or send a repository URL instead.
  **After:** That file is not a zip. Upload a .zip or send a repo URL.

- **Before:** The repository URL must start with http:// or https://.
  **After:** The repo URL has to start with http:// or https://.

- **Before:** Attach your code as a zip, or give a repository URL.
  **After:** Attach your code as a zip or give a repo URL.

- **Before:** Answer the first question: what you built, and what you left out on purpose.
  **After:** Answer the first question: what you built and what you left out.

- **Before:** Answer the second question: what you noticed about the system that we did not say.
  **After:** Answer the second question: what you figured out that we didn't tell you.

- **Before:** The first answer is over ${MAX_ANSWER_WORDS} words. Shorten it and submit again.
  **After:** The first answer is over ${MAX_ANSWER_WORDS} words. Cut it down and submit again.

- **Before:** The second answer is over ${MAX_ANSWER_WORDS} words. Shorten it and submit again.
  **After:** The second answer is over ${MAX_ANSWER_WORDS} words. Cut it down and submit again.

`apps/server/src/http.ts`

- **Before:** c.text("wire spec unavailable", 500)
  **After:** c.text("wire doc unavailable", 500)

## Wire ERROR texts (3)

`packages/protocol/src/wire/types.ts`

- **Before:** 2: "Your clock has run out. Practice and the official run are closed."
  **After:** 2: "Time's up. Practice and the official run are closed."

- **Before:** 3: "You have already used your official run. Start a practice session instead."
  **After:** 3: "You've used your official run. Start a practice session instead."

- **Before:** 5: "That move was late or malformed, so your body did WAIT. Send moves before the deadline."
  **After:** 5: "That move was late or malformed, so you did WAIT. Send moves before the deadline."

## docs/RULES.md: Rules in a minute and What strong bots do (16)

`docs/RULES.md`

- **Before:** This is all you need to play. The exact numbers are folded below, under "Everything, exactly".
  **After:** This is all you need to play. Exact numbers are folded below, under "Everything, exactly".

- **Before:** **Two bodies.** You are the cream fellow. Maria is the lilac ghost. She has her own body and her own plan. You both act every tick, at the same time. You see everything she does, except her energy.
  **After:** **You and Maria.** You're the cream fellow. Maria's the lilac ghost, with her own plan. You both move every tick, at the same time. You see everything she does except her energy.

- **Before:** **The board.** Errands appear on the board during the match. Deliver an item to a fixture. Stand in a room. Carry an item for a few ticks. Whoever finishes an errand first scores it.
  **After:** **The board.** Errands show up on the board as the match goes: bring an item to a fixture, stand in a room, hold an item for a few ticks. First one to finish an errand gets the points.

- **Before:** <!-- art: icon_value icon_expiry | An errand card: its value and its expiry -->
  **After:** <!-- art: icon_value icon_expiry | An errand card: value and expiry -->

- **Before:** **Values and expiries.** Each errand has a value and an expiry. The value does not depend on distance, so a far errand can be worth more. An errand nobody finishes in time is gone.
  **After:** **Value and expiry.** Every errand has a value and an expiry. Value has nothing to do with distance. A far one can be worth way more than a near one. If nobody finishes it in time, it's gone.

- **Before:** **Items are scarce.** An item can only be in one place. While you hold it, Maria cannot use it. Delivered items come back later, somewhere else.
  **After:** **Items are scarce.** If you're holding it, she can't use it. Delivered items come back later, somewhere else.

- **Before:** **Snatch and energy.** You gain energy every tick. A snatch costs 100 and takes an item from a body on your tile or next to it. It winds up for one tick first, so the other body sees it coming and can step away.
  **After:** **Snatch and energy.** You gain energy every tick. A snatch costs 100 and grabs an item from whoever is on your tile or next to it. It winds up for a tick first, so the target sees it coming and can step away.

- **Before:** **The end.** A match is 400 ticks. The higher score wins.
  **After:** **The end.** A match is 400 ticks. Higher score wins.

- **Before:** The client you were given walks to the nearest errand and keeps walking to it when a better one appears, walks to items Maria has already picked up, ignores expiry, never snatches, never steps out of reach of a wind-up, hard-codes every parameter, and waits for every state before it thinks. These are the seven things that separate a good bot from it, in the order most people find them. The profiler points at them by name.
  **After:** The bot we gave you walks to the nearest errand and sticks with it even when a better one shows up. It walks to items Maria already took, ignores expiry, never snatches, never steps away from a wind-up, hard-codes every parameter, and waits for each state before it thinks. Here are the seven things that make a bot good, roughly in the order people find them. The profiler links to them by name.

- **Before:** Walk shortest paths, and compute them once. The map is fixed except for one door, so distances from every tile to every tile can be precomputed at match start and updated when the vault opens. Everything else below needs fast, exact distances, and recomputing a search per errand per tick wastes the deadline.
  **After:** Walk shortest paths, and compute them once. The map never changes except for one door, so work out the distance from every tile to every tile at match start and redo it when the vault opens. Everything below needs fast, exact distances. Searching again per errand per tick burns the deadline.

- **Before:** Values are drawn independently of distance, so the nearest errand is often not the best one. An errand worth 9 that takes 20 ticks beats one worth 2 that takes 10, and one worth 6 that takes 40 ticks is worse than one worth 2 that takes 5. Rank errands by value divided by the ticks it takes to finish from where you stand, counting the walk to the item, the pickup, the walk to the fixture and the use. This one change is the biggest jump in score from the client you were given.
  **After:** Value has nothing to do with distance, so the nearest errand often isn't the best one. An errand worth 9 that takes 20 ticks beats one worth 2 that takes 10. One worth 6 that takes 40 ticks loses to one worth 2 that takes 5. Rank errands by value divided by the ticks to finish from where you stand: the walk to the item, the pickup, the walk to the fixture, the use. This is the biggest single jump over the bot we gave you.

- **Before:** An errand you reach one tick after it expires is worth nothing, and every tick spent on it is lost. Before you commit, check that your finishing tick is before `expires`. Check again every tick, because Maria or a new posting can change the answer.
  **After:** An errand you reach one tick after it expires is worth nothing, and every tick you spent on it is gone. Before you commit, check that you finish before `expires`. Check again every tick, since Maria or a new posting can change the answer.

- **Before:** Where an errand leaves you matters as much as what it is worth. Two errands next to each other beat one good errand on the far side of the house. Plan short sequences of errands, two or three long, score each sequence as a whole, and follow the first step of the best one. Carrying is free while you walk: a `carry` item picked up on the way to something else completes by itself. Your four slots are part of the plan: an inventory full of items nothing needs blocks every pickup, so drop or deliver what you no longer need before you walk to the next item.
  **After:** Where an errand leaves you matters as much as what it's worth. Two errands next to each other beat one good errand across the house. Plan short sequences, two or three errands long, score each sequence as a whole, and take the first step of the best one. Carrying is free while you walk: a `carry` item you pick up on the way to something else finishes by itself. Your four slots are part of the plan too. An inventory full of things nothing needs blocks every pickup, so drop or deliver what you don't need before you walk to the next item.

- **Before:** Maria's code is published and deterministic. You see everything she sees, and her energy can be tracked exactly from the events. Run her policy on her view of the state and you know what she will do next tick, and usually for many ticks after. Skip the errands she will finish first. Go for the ones she will reach too late. Take the item she needs before she gets there. A snatch is announced a tick ahead: when you see her `winding_up`, step out of her reach and the grab misses while her energy stays spent. A copy of her knows even earlier, on the tick she sends it, so you can stay out of reach and her wind-up costs her nothing and gets nothing. When you wind up on her, the copy says where she will step on your grab tick, so you can stay in reach. Never stand on her tile holding something she wants while she can afford a snatch: from there one step cannot take you out of reach. Ties go to the body with less energy, which you can arrange.
  **After:** Maria's code is public and deterministic. You see everything she sees, and you can track her energy exactly from the events. Run her policy on her view of the state and you know her next move, and usually the ones after it. Skip the errands she'll finish first. Go for the ones she'll reach too late. Take the item she needs before she gets there. A snatch shows up a tick early: when you see her `winding_up`, step out of reach and the grab misses with her energy already spent. A copy of her knows even earlier, on the tick she sends it, so you can stay out of reach and her wind-up costs her nothing and gets nothing. When you wind up on her, the copy says where she'll step on your grab tick, so you can stay in reach. Never stand on her tile holding something she wants while she can afford a snatch: from there one step can't get you out of reach. Ties go to whoever has less energy, and you can arrange that.

- **Before:** On the wire, a state can arrive late or not at all, and a move that misses the deadline is a `WAIT`. You do not have to wait for the state of a tick to send its move: you know the rules and Maria's policy, so you can predict the state and send your move for the next tick early, and send it more than once, because the first copy that arrives counts and the rest are ignored. When a delta arrives for a keyframe you do not hold, ask for a resync instead of driving blind until the next keyframe.
  **After:** On the wire, a state can show up late or not at all, and a move that misses the deadline counts as `WAIT`. You don't have to wait for a tick's state to send its move. You know the rules and Maria's policy, so predict the state and send the next tick's move early. Send it more than once, too: the first copy that arrives counts and the rest are ignored. When a delta shows up for a keyframe you don't have, ask for a resync instead of driving blind until the next keyframe.

- **Before:** Your official run plays with one rule changed: errands come faster, snatching gets cheaper, or the network gets worse. The Official page shows you which, and the simulator has a flag for each. Every number that can change is in the match start. A bot that reads `post_interval`, `expiry_min`, `expiry_max`, `snatch_cost`, `regen`, `return_ticks` and `chaos` from there, and a client that copes with the worst network profile, has nothing to do when you see the change.
  **After:** Your official run plays with one rule changed: errands come faster, snatching gets cheaper, or the network gets worse. The Official page shows you which, and the simulator has a flag for each. Every number that can change is in the match start. If your bot reads `post_interval`, `expiry_min`, `expiry_max`, `snatch_cost`, `regen`, `return_ticks` and `chaos` from there, and your client copes with the worst network profile, the change costs you nothing.

## docs/RULES.md: Everything, exactly (54)

`docs/RULES.md`

- **Before:** There is a house with two bodies in it: yours, and Maria's. Maria is a ghost with her own agenda. A board of errands fills up over the match: deliver this item to that fixture, be in this room, carry this item for a while. Each errand has a value and an expiry. Whoever completes an errand first gets its value. There are more errands than two bodies can finish, so choosing is the game. Holding an item blocks the other body from every errand that needs it, and a rare, expensive move called a snatch, announced a tick ahead, takes one away. After 400 ticks, the higher score wins.
  **After:** It's a house. You're in it, and so is Maria, a ghost. Errands show up on a board over the match: bring this item to that fixture, go stand in this room, hold onto this item for a bit. Every errand has a value and an expiry. First one to finish an errand gets its value. There are more errands than the two of you can finish, so picking is the game. Holding an item keeps the other one off every errand that needs it, and a rare, expensive move called a snatch, announced a tick early, takes one away. After 400 ticks, higher score wins.

- **Before:** Everything in this document is complete. There are no other rules. The engine, all three versions of Maria, the board generator and the server are published as source, so you can run any match locally and get exactly the result the server gets. The only things you do not know are the seeds of the official run and Maria's energy, and her energy can be tracked from what you see.
  **After:** This page is complete. There are no other rules. The engine, all three Marias, the board generator and the server are all public, so you can run any match locally and get exactly what the server gets. The only things you don't know are the official run's seeds and Maria's energy, and you can track her energy from what you see.

- **Before:** Some numbers in these rules can change: your official run plays with one of them changed, and the Official page shows you which. Every match states all of them in its match start under `params`. The examples below use the defaults.
  **After:** Some numbers here can change. Your official run plays with one of them changed, and the Official page shows you which. Every match lists all of them in its match start under `params`. The examples below use the defaults.

- **Before:** Stepping through a doorway therefore leaves the room for one tick.
  **After:** So stepping through a doorway takes you out of the room for one tick.

- **Before:** opens it for good (it becomes a `door`) and uses up the key. The body does not move that tick.
  **After:** opens it for good (it becomes a `door`) and uses up the key. You stay put that tick.

- **Before:** Nothing blocks a body except walls and the locked door. Both bodies may stand on the same tile. Decor (plants, chairs, crates and so on) is listed in the match start for drawing and has no effect on the game.
  **After:** Only walls and the locked door block you. You and Maria can stand on the same tile. Decor (plants, chairs, crates and so on) is in the match start for drawing and does nothing.

- **Before:** never the vault or a corridor. Both bodies get a `returned` event.
  **After:** never the vault or a corridor. You both get a `returned` event.

- **Before:** The key opens either the vault door or the safe, never both, because using it uses it up. New ids continue the numbering: with 18 items at the start, the first item to come back is `i19`. Items are never used up, only out of circulation for a while.
  **After:** The key opens the vault door or the safe, not both, because using it uses it up. New ids continue the numbering: with 18 items at the start, the first item to come back is `i19`. Items never get used up. They're just out of play for a while.

- **Before:** ## 3. Your body and Maria's
  **After:** ## 3. You and Maria

- **Before:** Both bodies act every tick, at the same time. You see everything: both positions, both inventories, every item on the floor, the whole board, and your own energy. Maria sees the same from her side. The only thing you do not see is Maria's energy, and she does not see yours. Every change to it is an event you do see (her wind-ups, her sigil), so you can keep track of it exactly:
  **After:** You both act every tick, at the same time. You see everything: both positions, both inventories, every item on the floor, the whole board, and your own energy. Maria sees the same from her side. The only thing you don't see is Maria's energy, and she doesn't see yours. Every change to it is an event you do see (her wind-ups, her sigil), so you can track it exactly:

- **Before:** | Nothing. Also what your body does when your move is late, missing, or malformed. |
  **After:** | Nothing. Also what you do when your move is late, missing, or malformed. |

- **Before:** the door opens, the key is used up, and the body stays put this tick.
  **After:** the door opens, the key is used up, and you stay put this tick.

- **Before:** **The grab**, on the next tick, after both bodies move:
  **After:** **The grab**, on the next tick, after you both move:

- **Before:** You send nothing for the grab and may move on that tick.
  **After:** You send nothing for the grab and can move on that tick.

- **Before:** starting with the body that has less energy. A body whose inventory is full is skipped |
  **After:** starting with whoever has less energy. Anyone with a full inventory is skipped |

- **Before:** | both complete one errand in the same tick | the body with less energy |
  **After:** | both complete one errand in the same tick | whoever has less energy |

- **Before:** | both wind up a `SNATCH` | the body with more energy winds up; the other's does nothing and costs nothing |
  **After:** | both wind up a `SNATCH` | whoever has more energy winds up; the other's does nothing and costs nothing |

- **Before:** | equal energy | a coin drawn from the seed, one per tick, picks one body. That body counts as having less energy
  **After:** | equal energy | a coin drawn from the seed, one per tick, picks one of you. That one counts as having less energy

- **Before:** 1. **MOVE**, both bodies, against the map only.
  **After:** 1. **MOVE**, both of you, against the map only.

- **Before:** checked against where both bodies stand after moving.
  **After:** checked against where you both stand after moving.

- **Before:** 3. **TAKE**, both bodies, from where they stand after moving.
  **After:** 3. **TAKE**, both of you, from where you stand after moving.

- **Before:** 4. **DROP**, both bodies. An item dropped this tick cannot be taken until the next.
  **After:** 4. **DROP**, both of you. An item dropped this tick can't be taken until the next.

- **Before:** 5. **USE**, both bodies. An item grabbed this tick is gone before its holder can use it.
  **After:** 5. **USE**, both of you. An item grabbed this tick is gone before its holder can use it.

- **Before:** 6. **SNATCH wind-ups**, both bodies. A delivery made this tick cannot be snatched.
  **After:** 6. **SNATCH wind-ups**, both of you. A delivery made this tick can't be snatched.

- **Before:** 7. **Sigils.** Recharging sigils count down by one. Then each charged sigil with a body on it pays its owner 40 and starts recharging.
  **After:** 7. **Sigils.** Recharging sigils count down by one. Then each charged sigil with someone on it pays its owner 40 and starts recharging.

- **Before:** 8. **Energy.** Both bodies gain `regen`. Energy never goes above 100.
  **After:** 8. **Energy.** You both gain `regen`. Energy never goes above 100.

- **Before:** | a body `USE`s an item of that kind on that fixture |
  **After:** | someone `USE`s an item of that kind on that fixture |

- **Before:** | a body ends a tick in that room |
  **After:** | someone ends a tick in that room |

- **Before:** | a body has held an item of that kind
  **After:** | someone has held an item of that kind

- **Before:** The first body to complete an errand gets its value; then it is done and nobody else can complete it.
  **After:** Whoever completes an errand first gets its value. Then it's done and nobody else can complete it.

- **Before:** **Time is what you fight over.** There are more errands than two bodies can finish, so choosing is the game. Items are plentiful, 16 to 20, and come back after they are delivered, but while you hold an item Maria cannot use it for any errand, and the other way round, until it is dropped, delivered or snatched. A full inventory blocks every pickup until you drop or deliver something.
  **After:** **Time is the scarce thing.** There are more errands than the two of you can finish, so picking is the game. Items are plentiful, 16 to 20, and come back after delivery. But while you hold an item, Maria can't use it for anything, and the same goes for her items, until it's dropped, delivered or snatched. A full inventory blocks every pickup until you drop or deliver something.

- **Before:** An item is **in the world** if it is on the floor, held by either body,
  **After:** An item is **in the world** if it is on the floor, held by either of you,

- **Before:** | regeneration | +`regen` every tick (default 1), both bodies |
  **After:** | regeneration | +`regen` every tick (default 1), for both of you |

- **Before:** `snatch_cost` (default 100), so a body affords about three snatches a match |
  **After:** `snatch_cost` (default 100), so you can afford about three snatches a match |

- **Before:** When a body ends a tick on a charged `sigil`, the sigil's owner gains 40 energy, whoever is standing there, and the sigil starts recharging. If both bodies stand on it, it pays once.
  **After:** When anyone ends a tick on a charged `sigil`, the sigil's owner gains 40 energy, whoever is standing there, and the sigil starts recharging. If you're both on it, it pays once.

- **Before:** After each tick both bodies receive the tick's events, each from its own point of view: `by` and `owner` say `you` or `maria` relative to the receiver.
  **After:** After each tick you both get the tick's events, each from your own side: `by` and `owner` say `you` or `maria` relative to whoever receives them.

- **Before:** | `posted` | 0 | the errand record | a new errand, open from this tick |
  **After:** | `posted` | 0 | the errand | a new errand, open from this tick |

- **Before:** | `snatched` | 6 | `by`, item | `by` is the body that took it |
  **After:** | `snatched` | 6 | `by`, item | `by` is whoever took it |

- **Before:** | `moved` | 10 | `by`, `dir` | the other body's step, when it actually moved. Your own steps are implied by your position |
  **After:** | `moved` | 10 | `by`, `dir` | the other one's step, when they actually moved. Your own steps are implied by your position |

- **Before:** | `winding_up` | 11 | `by` | a snatch wound up this tick. The grab resolves next tick if the other body is still in reach after moving |
  **After:** | `winding_up` | 11 | `by` | a snatch wound up this tick. The grab resolves next tick if the target is still in reach after moving |

- **Before:** | late, missing or malformed move | your body does `WAIT` |
  **After:** | late, missing or malformed move | you do `WAIT` |

- **Before:** | `inventory_slots` | 4 | slots per body |
  **After:** | `inventory_slots` | 4 | slots each |

- **Before:** | the wire, UDP binary | wire practice and the official run. A bad network on purpose: datagrams are lost, reordered, duplicated and delayed. The server sends a keyframe (a full state) at tick 0, every 20 ticks and when you ask for a resync; the other states are a delta against a keyframe you hold. `docs/WIRE.md` has every byte |
  **After:** | the wire, UDP binary | wire practice and the official run. A bad network on purpose: packets get lost, reordered, duplicated and delayed. The server sends a keyframe (a full state) at tick 0, every 20 ticks and when you ask for a resync. The other states are a delta against a keyframe you hold. `docs/WIRE.md` has every byte |

- **Before:** | the clock | 90 minutes from the moment you first open your magic link. The first time you open the Official page it shows you the one changed rule; your official run and every match after that use it. Practice, the official run and submission close when the clock runs out; an official run already in progress plays to the end |
  **After:** | the clock | 90 minutes from the moment you first open your magic link. The first time you open the Official page it shows you the one changed rule. Your official run and every match after that use it. Practice, the official run and submission close when time's up. An official run already in progress plays to the end |

- **Before:** errands that expired while you were heading for them, value you never went for, idle ticks,
  **After:** errands that expired on your way there, points you never went for, idle ticks,

- **Before:** Maria comes in three tiers. All three are published as source in `@black-maria/sim` (`packages/house-bots`) and are deterministic: given the same observations they always choose the same move. They use no clock, no unseeded randomness, and fixed iteration counts. Maria sees exactly what you see from the other side: the map, both bodies, both inventories, the board, the events, and her own energy. She never sees your energy, but she keeps track of it from the events, exactly, the same way you can keep track of hers. Like you, she reads every parameter from the match start.
  **After:** Maria comes in three tiers. All three are public in `@black-maria/sim` (`packages/house-bots`) and deterministic: same observations, same move, every time. No clock, no unseeded randomness, fixed iteration counts. Maria sees exactly what you see, from her side: the map, both positions, both inventories, the board, the events, and her own energy. She never sees your energy, but she tracks it exactly from the events, same as you can with hers. Like you, she reads every parameter from the match start.

- **Before:** Next to a body that never steps away, the snatch policy gets its chances |
  **After:** Next to someone who never steps away, the snatch policy gets its chances |

- **Before:** Nothing in this game is hard because something was kept from you. The rules are on this page, Maria's code is published, and so is the server.
  **After:** Nothing here is hard because we hid something. The rules are on this page, and Maria's code and the server are public.

- **Before:** | The board is a scheduling problem with deadlines | Choosing which errands to do, in which order, before they expire, is the orienteering problem with time windows. It has no fast exact answer, so every better idea is a real algorithm with a visible score bump. |
  **After:** | The board is a scheduling problem with deadlines | Which errands, in what order, before they expire. That's orienteering with time windows: no fast exact answer, so every better idea is a real algorithm with a visible score bump. |

- **Before:** | Maria is a rival with a published policy | Modeling an opponent. Her next move can be computed, so the question is whether you compute it and use it: skipping races you lose, winning races you can, and snatching at the right moment. |
  **After:** | Maria is a rival with a published policy | Modeling an opponent. Her next move can be computed. The question is whether you use it. |

- **Before:** | Time is scarce | Contention for a shared board. There are more errands than two bodies can finish, and holding an item blocks her from every errand that needs it. |
  **After:** | Time is scarce | Contention for a shared board. More errands than the two of you can finish, and holding an item locks her out of every errand that needs it. |

- **Before:** | The deadline | Doing good work inside a fixed compute and time budget, the way real-time systems must. |
  **After:** | The deadline | Good work inside a fixed time budget, like any real-time system. |

- **Before:** | The network | The wire drops, reorders, duplicates and delays datagrams. Real systems have to keep working on a bad link. |
  **After:** | The network | The wire drops, reorders, duplicates and delays packets. Real systems keep working on a bad link. |

- **Before:** The challenge is to build a scheduler and a rival model that hold up on nine maps you have not seen, inside the deadline, over a bad network.
  **After:** The job: a scheduler and a model of Maria that hold up on nine maps you haven't seen, inside the deadline, over a bad network.

## docs/RULES.md: worked example (regenerated by `packages/engine/scripts/worked-example.ts`) (3)

`packages/engine/test/worked-example.ts`

- **Before:** This is seed ${ex.seed}, with every parameter at its default. Both bodies are played by the simplest possible bot:
  **After:** Seed ${ex.seed}, every parameter at its default. You and Maria are both played by the simplest bot there is:

- **Before:** Hers is ${sa.bodies.maria.energy}, though you are not told that.
  **After:** Hers is ${sa.bodies.maria.energy}, but you can't see that.

- **Before:** The energy columns show both, so you can follow the ties; in a real match you see only your own. Maria receives the same events from her side: where you see `by: maria`, she sees `by: you`, and she gets a `moved` event for your steps instead of hers. The section on the order of one tick explains why each row came out the way it did. After reading this page you should be able to predict any tick by hand.
  **After:** The energy columns show both so you can follow the ties. In a real match you only see your own. Maria gets the same events from her side: where you see `by: maria`, she sees `by: you`, and she gets a `moved` event for your steps instead of hers. "Order of one tick" in section 4 explains why each row came out the way it did. After this page you should be able to work out any tick by hand.

## docs/WIRE.md (worked example regenerated by `scripts/wire-examples.ts`) (27)

`docs/WIRE.md`

- **Before:** The client you were given already does all of this. You only need this page if you change how it talks to the house.
  **After:** The client we gave you already does all of this. You only need this page if you change how it talks to the server.

- **Before:** | each tick | A `STATE` arrives. A keyframe is the whole world. A delta is only what changed since a `base` tick. |
  **After:** | each tick | A `STATE` arrives. A keyframe is the full state. A delta is only what changed since a `base` tick. |

- **Before:** | a missing base | You hold no state for that `base`? Send `RESYNC` and wait for a keyframe. |
  **After:** | a missing base | Don't have the state for that `base`? Send `RESYNC` and wait for a keyframe. |

- **Before:** The wire is how your client talks to the server for wire practice and for the official run: binary datagrams over UDP, on a network that loses, reorders, duplicates and delays them on purpose. The published client already speaks it. You do not need to read this page to play; you need it to make the client better.
  **After:** The wire is how your client talks to the server, for wire practice and the official run: binary datagrams over UDP, on a network that loses, reorders, duplicates and delays them on purpose. The client we gave you already speaks it. You don't need this page to play. You need it to make the client better.

- **Before:** Every integer is little-endian. Every field has a fixed width. There is no bit-packing and there are no variable-length integers.
  **After:** Every integer is little-endian. Every field has a fixed width. No bit-packing, no variable-length integers.

- **Before:** is answered with `ERROR 5` and your body does `WAIT` unless a valid move for that tick arrives in time.
  **After:** is answered with `ERROR 5` and you do `WAIT` unless a valid move for that tick arrives in time.

- **Before:** | 2 | clock expired | Your clock has run out. Practice and the official run are closed. Also sent, with the sentence "The official run had to start by minute 85. Your clock is past that, so it is closed.", to an official `HELLO` after minute 85. |
  **After:** | 2 | clock expired | Time's up. Practice and the official run are closed. Also sent, with the sentence "Too late for the official run. It had to start by minute 85.", to an official `HELLO` after minute 85. |

- **Before:** | 3 | no attempts | You have used your official run. Start a practice session instead. |
  **After:** | 3 | no attempts | You've used your official run. Start a practice session instead. |

- **Before:** | 5 | bad move | The move was late or malformed, so your body did `WAIT`. Send moves before the deadline. |
  **After:** | 5 | bad move | The move was late or malformed, so you did `WAIT`. Send moves before the deadline. |

- **Before:** | `board` | u8 count, then an errand record for each of the errands on the board at tick 0 |
  **After:** | `board` | u8 count, then an errand (below) for each errand on the board at tick 0 |

- **Before:** **Errand record** (14 bytes):
  **After:** **Errand** (14 bytes):

- **Before:** | 4 | `board` | u8 count, then errand records |
  **After:** | 4 | `board` | u8 count, then errands |

- **Before:** | `posted` | 0 | an errand record |
  **After:** | `posted` | 0 | an errand |

- **Before:** A move for `t` that arrives after the deadline is dropped with `ERROR 5`, and your body does `WAIT`.
  **After:** A move for `t` that arrives after the deadline is dropped with `ERROR 5`, and you do `WAIT`.

- **Before:** Acting on a predicted state when a `STATE` is late is allowed, and the rules and Maria's code are published so you can predict well.
  **After:** Acting on a predicted state when a `STATE` is late is fine. The rules and Maria's code are public, so you can predict well.

- **Before:** If your client disconnects during the run, its matches keep going with your body doing `WAIT`, until they end or you reconnect with the same token.
  **After:** If your client disconnects during the run, its matches keep going with you doing `WAIT`, until they end or you reconnect with the same token.

- **Before:** | Reliability built on an unreliable transport, which is what every real protocol over UDP has to do. |
  **After:** | Reliability on top of an unreliable transport, like every real protocol over UDP. |

- **Before:** | Real-time systems cannot wait. Deciding before the data arrives, and deciding what to do when it does not. |
  **After:** | Real-time systems can't wait. Decide before the data arrives, and know what to do when it doesn't. |

- **Before:** Send a move for every tick, even when the `STATE` has not arrived. |
  **After:** Send a move for every tick, even when the `STATE` hasn't arrived. |

- **Before:** Plan for a few ticks with no news, and for the keyframe you will need afterwards. |
  **After:** Plan for a few ticks with no news, and for the keyframe you'll need after. |

- **Before:** | The `base` you do not have | A delta applies only to the state it names. If you missed the keyframe it is built on, applying it to anything else gives you a wrong world. Resync instead. |
  **After:** | The `base` you don't have | A delta applies only to the state it names. If you missed its keyframe, applying it to anything else gives you the wrong state. Resync instead. |

- **Before:** A client that passes these ten plays the official run properly.
  **After:** A client that passes these ten is ready for the official run.

`scripts/wire-examples.ts`

- **Before:** Every dump below is produced by the real codec.
  **After:** Every dump below comes straight from the real codec.

- **Before:** one 14-byte errand record each
  **After:** 14 bytes each

- **Before:** Only what changed since tick 0: both bodies moved and your energy went up by one.
  **After:** Only what changed since tick 0: you both moved and your energy went up by one.

- **Before:** you pay it and both of you get a `winding_up` event; otherwise it does nothing and costs nothing. The grab happens on the next tick, after both bodies move:
  **After:** you pay it and you both get a `winding_up` event. Otherwise it does nothing and costs nothing. The grab happens on the next tick, after you both move:

- **Before:** You send nothing extra for the grab, and you may move on that tick.
  **After:** You send nothing extra for the grab, and you can move on that tick.

## READMEs (root, client, simulator) (26)

`README.md`

- **Before:** The whole system behind the assessment: the game engine, Maria (all three tiers), the server as it is deployed, the portal, the simulator and the client you were given. Everything the server does, you can run and read here.
  **After:** Everything behind the assessment: the engine, all three Marias, the server as deployed, the portal, the simulator, and the client we gave you. Anything the server does, you can read and run here.

- **Before:** Start with the two documents, then the client:
  **After:** Read the two docs first, then the client:

- **Before:** | `packages/client/README.md` | the client you were given, its known weaknesses, and how to plug in your own bot |
  **After:** | `packages/client/README.md` | the client we gave you, what's wrong with it, and how to plug in your own bot |

- **Before:** `pnpm sim` and `pnpm client` are the same programs as `npx @black-maria/sim` and `npx blackmaria`. Run either with `help` for every flag.
  **After:** `pnpm sim` and `pnpm client` are the same programs as `npx @black-maria/sim` and `npx blackmaria`. Run either with `help` to see every flag.

- **Before:** The client plays a local simulator unless you tell it where the real server is. Put these two lines in a `.env` file in the directory you run it from (the portal's Simulator page shows them with your values filled in):
  **After:** By default the client plays a local simulator. To play the real server, put these two lines in a `.env` file where you run it (the portal's Simulator page shows them with your values filled in):

- **Before:** `pnpm client` and `pnpm sim` work in the directory you type them in: that is where `.env` and `--bot ./my-bot.js` are read from.
  **After:** `pnpm client` and `pnpm sim` read `.env` and `--bot ./my-bot.js` from the directory you run them in.

- **Before:** | `packages/client` | the client you were given, in TypeScript (`src/`) and Python (`python/blackmaria.py`) |
  **After:** | `packages/client` | the client we gave you, in TypeScript (`src/`) and Python (`python/blackmaria.py`) |

`packages/client/README.md`

- **Before:** A working client for BLACK MARIA's wire, in TypeScript and in Python, with a starter bot wired in. It already plays the official run. It plays it badly, on purpose.
  **After:** A working client for BLACK MARIA's wire, in TypeScript and Python, with a starter bot plugged in. It already plays the official run. Badly, on purpose.

- **Before:** Both talk to the server named by `BM_SERVER` and `BM_TOKEN` (see "Where it connects"). Without them they talk to a local simulator on your machine, which is what you want for practice and wrong for the official run.
  **After:** Both talk to the server set by `BM_SERVER` and `BM_TOKEN` (see "Where it connects"). Without them they talk to a local simulator on your machine. Good for practice, wrong for the official run.

- **Before:** Run it as it is and you will beat Novice sometimes. Everything from there is up to you: fix the client, replace the bot, or replace both.
  **After:** Run it as-is and it'll beat Novice sometimes. The rest is up to you: fix the client, replace the bot, or replace both.

- **Before:** These are deliberate. Each one costs you points, and none of them is hidden.
  **After:** All on purpose. Each one costs you points. None of them is hidden.

- **Before:** When the `STATE` is late or lost, your body does `WAIT`.
  **After:** When the `STATE` is late or lost, you do `WAIT`.

- **Before:** 4. **It hard-codes every parameter.** The deadline, the inventory size and the rest are constants in the code, not read from the match start. Your official run plays with one of them changed.
  **After:** 4. **It hard-codes every parameter.** The deadline, the inventory size and the rest are constants, not read from the match start. Your official run plays with one of them changed.

- **Before:** 6. **Its bot does not change its mind.** Once it picks a target it walks there without looking again, so an errand posted next to it, or a better one, waits until it arrives.
  **After:** 6. **Its bot doesn't change its mind.** Once it picks a target it walks there without looking again. An errand posted right next to it, or a better one, waits until it arrives.

- **Before:** 7. **Its bot does not notice when Maria picks an item up.** It remembers where it saw each item and walks to that spot anyway, and only forgets the item when it gets there and the floor is empty. Every item Maria takes first costs it a wasted trip.
  **After:** 7. **Its bot doesn't notice when Maria picks an item up.** It remembers where it saw each item, walks to that spot anyway, and only forgets the item when it gets there and the floor is empty. Every item Maria takes first costs it a wasted trip.

- **Before:** The profiler after each practice match shows what these cost you. `docs/RULES.md`, under "What strong bots do", says what to build instead, and `docs/WIRE.md` has every byte of the wire. To grade a client against the wire checklist, run `npx @black-maria/sim wire --check` and play a match against it.
  **After:** The profiler after each practice match shows what these cost you. "What strong bots do" in `docs/RULES.md` says what to build instead, and `docs/WIRE.md` has every byte of the wire. To grade a client against the wire checklist, run `npx @black-maria/sim wire --check` and play a match against it.

- **Before:** Flags win over the environment, and the environment wins over a `.env` file in the directory you run it from. The portal's Simulator page shows the two `.env` lines, `BM_SERVER` and `BM_TOKEN`, with your server and token filled in. With none of them set, it plays a local simulator on 127.0.0.1: start one with `npx @black-maria/sim wire`, which accepts any token.
  **After:** Flags beat the environment, and the environment beats a `.env` file in the directory you run it from. The portal's Simulator page shows the two `.env` lines, `BM_SERVER` and `BM_TOKEN`, with your server and token filled in. With none of them set, it plays a local simulator on 127.0.0.1. Start one with `npx @black-maria/sim wire`, which takes any token.

- **Before:** It tries UDP 7777 first. If no `HELLO_ACK` arrives within 2 seconds it tries UDP 443, because some networks block UDP on unusual ports and allow 443.
  **After:** It tries UDP 7777 first. If no `HELLO_ACK` arrives within 2 seconds it tries UDP 443, since some networks block UDP on odd ports but allow 443.

- **Before:** | `blackmaria official` | the official run, one attempt. It is open from the start of your clock and must start before minute 85 |
  **After:** | `blackmaria official` | the official run, one shot. Open from the start of your clock, and it has to start before minute 85 |

- **Before:** The official run scores 1 for each win against Novice, 3 against Adept and 9 against Master, out of 39. Practice matches never count.
  **After:** The official run scores 1 per win against Novice, 3 against Adept and 9 against Master, out of 39. Practice never counts.

`packages/sim/README.md`

- **Before:** The BLACK MARIA engine, Maria's three tiers (Novice, Adept, Master), a local match runner, a local wire server with the network profiles, a replay printer and the profiler. Everything runs on your machine.
  **After:** The simulator runs the whole game on your machine: the engine, all three Marias (Novice, Adept, Master), the lossy network, a replay printer and the profiler. Same code as the server, no waiting on ticks.

- **Before:** Any 16-byte token works, and the official run can be played as often as you like.
  **After:** Any 16-byte token works, and you can play the official run as often as you like.

- **Before:** | `sim wire --check` | the same server, grading your client against the ten-item checklist in `docs/WIRE.md`, with the Master network profile and parameters that are not the defaults |
  **After:** | `sim wire --check` | the same server, grading your client against the ten-item checklist in `docs/WIRE.md`, on the Master network profile with non-default parameters |

- **Before:** Your official run plays with one rule changed. The Official page tells you which. You can try all three before then:
  **After:** Your official run plays with one rule changed. The Official page shows you which. You can try all three first:

- **Before:** `--change 1`, `--change 2` and `--change 3` are the same thing in one flag. A bot that reads its parameters from the match start has nothing to do when you see the change.
  **After:** `--change 1`, `--change 2` and `--change 3` do the same thing in one flag. If your bot reads its parameters from the match start, the change costs you nothing.

- **Before:** Maria is deterministic: given the same observations she makes the same move, so a copy of her fed her view of the match predicts her exactly.
  **After:** Maria is deterministic: same observations, same move. Feed a copy of her the match from her side and it predicts her exactly.

## Client CLI (TypeScript) (16)

`packages/client/src/cli.ts`

- **Before:** Your official run: 9 matches, 3 at a time, one attempt. It is open from the start of your clock and must start by minute 85.
  **After:** Your official run: 9 matches, 3 at a time, one shot. Open from the start of your clock. It has to start by minute 85.

- **Before:** `Could not load ${file}:
  **After:** `Couldn't load ${file}:

- **Before:** a draw, ${m.you} to ${m.maria}
  **After:** draw, ${m.you} to ${m.maria}

- **Before:** There is no command "${cmd}". Run "blackmaria help" to see the commands.
  **After:** No command "${cmd}". Run "blackmaria help" for the list.

- **Before:** Say which Maria to play: --vs novice, adept or master.
  **After:** Pick a Maria: --vs novice, adept or master.

- **Before:** --vs must be novice, adept or master; you gave ${vs}.
  **After:** --vs takes novice, adept or master, not ${vs}.

- **Before:** --chaos must be off, novice, adept or master; you gave ${chaosName}.
  **After:** --chaos takes off, novice, adept or master, not ${chaosName}.

- **Before:** --n must be a whole number from 1 to 1000.
  **After:** --n takes a whole number from 1 to 1000.

- **Before:** This is your one official run: nine matches, three at a time, about five minutes. Once the server answers it cannot be stopped, and it plays to the end even if this program does not.
  **After:** This is your one official run: 9 matches, 3 at a time, about 5 minutes. Once the server answers, it can't be stopped. It plays to the end even if this program doesn't.

`packages/client/src/client.ts`

- **Before:** Check the host, and that your network lets UDP out.
  **After:** Check the host and that your network lets UDP out.

- **Before:** The server closed the session; reconnecting.
  **After:** Server closed the session. Reconnecting.

`packages/client/src/config.ts`

- **Before:** Ports are numbers from 1 to 65535, separated by commas, like 7777,443; you gave ${s}.
  **After:** Ports are numbers from 1 to 65535, comma-separated, like 7777,443. You gave ${s}.

- **Before:** Set BM_TOKEN or pass --token: it is the 32 characters at the end of your magic link.
  **After:** Set BM_TOKEN or pass --token: it's the last 32 characters of your magic link.

- **Before:** ${server} does not know that token. Copy it again from your magic link.
  **After:** ${server} doesn't know that token. Copy it again from your magic link.

- **Before:** `Could not reach ${server}
  **After:** `Couldn't reach ${server}

- **Before:** ${server}/api/me did not say where the wire is. Pass --host instead.
  **After:** ${server}/api/me didn't say where the wire is. Pass --host instead.

## Client CLI (Python) (19)

`packages/client/python/blackmaria.py`

- **Before:** 1: "Errands now post every 3 ticks instead of 6, and expire 20 to 45 ticks after they post instead of 30 to 70. " "The board is fuller and faster. Read post_interval, expiry_min and expiry_max from the match start.", 2: "A snatch now costs 50 energy instead of 100, and energy regenerates 2 per tick instead of 1. Maria can snatch " "about four times as often, and so can you. Read snatch_cost and regen from the match start.", 3: "The Master network profile now applies to every tier. Every match on the wire loses 10% of datagrams both ways " "and has one 400 ms blackhole. Read chaos from the match start.",
  **After:** 1: "Errands now post every 3 ticks instead of 6. They expire 20 to 45 ticks after they post, instead of 30 to 70. " "More errands, shorter lives. Read post_interval, expiry_min and expiry_max from the match start.", 2: "A snatch now costs 50 energy instead of 100, and energy regenerates 2 per tick instead of 1. Maria can snatch " "about 4 times as often. So can you. Read snatch_cost and regen from the match start.", 3: "The Master network profile now applies to every tier. Every match on the wire now loses 1 packet in 10 each way " "and goes silent once for 400 ms. The match start says which network a match is on.",

- **Before:** It is the same client as the TypeScript one, with the same starter bot, and it is mediocre in the same ways on purpose (the README lists them):
  **After:** Same client as the TypeScript one, same starter bot, and bad in the same ways on purpose (the README lists them):

- **Before:** - it does not dedupe: a duplicated or late STATE is decided again, and its move sent again;
  **After:** - it doesn't skip repeats: a duplicated or late STATE is decided again, and its move sent again;

- **Before:** Check the host, and that your network lets UDP out.
  **After:** Check the host and that your network lets UDP out.

- **Before:** self.log("The server closed the session; reconnecting.")
  **After:** self.log("Server closed the session. Reconnecting.")

- **Before:** Ports are numbers from 1 to 65535, separated by commas, like 7777,443; you gave %s.
  **After:** Ports are numbers from 1 to 65535, comma-separated, like 7777,443. You gave %s.

- **Before:** Set BM_TOKEN or pass --token: it is the 32 characters at the end of your magic link.
  **After:** Set BM_TOKEN or pass --token: it's the last 32 characters of your magic link.

- **Before:** Could not reach %s (%s). Check the address, or pass --host instead.
  **After:** Couldn't reach %s (%s). Check the address, or pass --host instead.

- **Before:** raise ClientError("Could not load %s." % path)
  **After:** raise ClientError("Couldn't load %s." % path)

- **Before:** raise ClientError("Could not load %s: %s" % (path, err))
  **After:** raise ClientError("Couldn't load %s: %s" % (path, err))

- **Before:** There is no command "%s". Run "python3 blackmaria.py help" to see the commands.
  **After:** No command "%s". Run "python3 blackmaria.py help" for the list.

- **Before:** Say which Maria to play: --vs novice, adept or master.
  **After:** Pick a Maria: --vs novice, adept or master.

- **Before:** --vs must be novice, adept or master; you gave %s.
  **After:** --vs takes novice, adept or master, not %s.

- **Before:** --chaos must be off, novice, adept or master; you gave %s.
  **After:** --chaos takes off, novice, adept or master, not %s.

- **Before:** --n must be a whole number from 1 to 1000.
  **After:** --n takes a whole number from 1 to 1000.

- **Before:** out("This is your one official run: nine matches, three at a time, about five minutes. Once the server answers it cannot be stopped, and it plays to the end even if this program does not.")
  **After:** out("This is your one official run: 9 matches, 3 at a time, about 5 minutes. Once the server answers, it can't be stopped. It plays to the end even if this program doesn't.")

- **Before:** a draw, %d to %d
  **After:** draw, %d to %d

- **Before:** %s does not know that token. Copy it again from your magic link.
  **After:** %s doesn't know that token. Copy it again from your magic link.

- **Before:** %s/api/me did not say where the wire is. Pass --host instead.
  **After:** %s/api/me didn't say where the wire is. Pass --host instead.

## Simulator CLI (21)

`packages/sim/src/words.ts`

- **Before:** return `a draw, ${you} to ${maria}`;
  **After:** return `draw, ${you} to ${maria}`;

- **Before:** wound up a snatch: it lands next tick if the other body is still in reach`
  **After:** wound up a snatch: the grab lands next tick if the target is still in reach`

- **Before:** return `the house put a ${e.item_kind} (${e.item}) back at ${e.pos.x},${e.pos.y}`;
  **After:** return `a ${e.item_kind} (${e.item}) is back on the floor at ${e.pos.x},${e.pos.y}`;

- **Before:** The profiler. Each line names the heading under "What strong bots do" in docs/RULES.md that deals with it.
  **After:** The profiler. Each "see:" is a heading under "What strong bots do" in docs/RULES.md.

`packages/sim/src/cli.ts`

- **Before:** and the official run can be played as often as you like. --check grades your client against the ten-item checklist in docs/WIRE.md.
  **After:** and you can play the official run as often as you like. --check grades your client against the ten-item checklist in docs/WIRE.md.

- **Before:** `Could not load ${file}:
  **After:** `Couldn't load ${file}:

- **Before:** the factory did not return an object with decide(state).`
  **After:** the factory didn't return an object with decide(state).`

- **Before:** The network profile only applies over the wire. This runner has no network, so nothing is lost; run "sim wire --chaos ${chaos}" and point your client at it.
  **After:** Network profiles only apply over the wire, and this runner has no network. To test one, run "sim wire --chaos ${chaos}" and point your client at it.

- **Before:** There is no file at ${file}.
  **After:** No file at ${file}.

- **Before:** ${file} is not a saved match (it is not JSON).
  **After:** ${file} isn't a saved match (not JSON).

- **Before:** ${file} is not a saved match.
  **After:** ${file} isn't a saved match.

- **Before:** `Could not listen on UDP
  **After:** `Couldn't listen on UDP

- **Before:** The local wire server is listening on UDP ${host}:${bound}. Any 16-byte token works. Stop it with Ctrl-C.
  **After:** Local wire server listening on UDP ${host}:${bound}. Any 16-byte token works. Ctrl-C stops it.

- **Before:** Checking clients against the checklist in docs/WIRE.md. The parameters are not the defaults on purpose. Play a match (or your official run) and the report prints when it ends.
  **After:** Checking clients against the checklist in docs/WIRE.md. The parameters aren't the defaults, on purpose. Play a match (or your official run) and the report prints when it ends.

- **Before:** There is no command "${cmd}". Run "sim help" to see the commands.
  **After:** No command "${cmd}". Run "sim help" for the list.

`packages/sim/src/args.ts`

- **Before:** --${name} must be a whole number from ${min} to ${max}; you gave ${v}.
  **After:** --${name} takes a whole number from ${min} to ${max}, not ${v}.

- **Before:** --${name} must be novice, adept or master; you gave ${v}.
  **After:** --${name} takes novice, adept or master, not ${v}.

- **Before:** --chaos must be off, novice, adept or master; you gave ${v}.
  **After:** --chaos takes off, novice, adept or master, not ${v}.

- **Before:** --expiry is two numbers with a colon, like 20:45; you gave ${expiry}.
  **After:** --expiry takes two numbers and a colon, like 20:45, not ${expiry}.

- **Before:** Those parameters do not fit together: expiry_min must be at most expiry_max, and every value must be in range.
  **After:** Those parameters don't fit together. expiry_min can't be above expiry_max, and every value has to be in range.

`packages/sim/src/check.ts`

- **Before:** The ack stayed 0 although datagrams arrived.
  **After:** The ack stayed 0 even though datagrams arrived.

## SPEC.md (copy sections only) (8)

`SPEC.md`

- **Before:** 2. What did you notice about the system that we did not say?
  **After:** 2. What did you figure out that we didn't tell you?

- **Before:** you got the letter to the fireplace, +4.
  **After:** you +4 · letter to fireplace.

- **Before:** 2. One paragraph: what you have and what to do with it. "A client that already plays, badly. Make it win." Under 60 words.
  **After:** 2. One paragraph: what you have and what to do with it. "We give you a bot that already plays. It's bad. Make it good." Under 60 words.

- **Before:** 5. One line in its own box: "Everything you need is in the repo. Nothing is hidden. Some things are not pointed at."
  **After:** 5. One line in its own box: "Everything you need is in the repo. Nothing's hidden. Some things just aren't pointed out."

- **Before:** 6. A numbered path with time estimates: Read the rules (10 min). Run the client we gave you once (5 min). Make it better, in whatever direction you think matters (40 min). Minute 60: the change arrives (read it, 2 min). Adapt (15 min). Official run (5 min). Note and submit (5 min). Each step is a link.
  **After:** 6. A numbered path with time estimates: Read the rules (10 min). Run the bot we gave you (5 min). Make it better (40 min). See the change on the Official page (2 min). Adapt to it (15 min). Official run, start by minute 85 (5 min). Write the note, hand it in (5 min). Each step is a link.

- **Before:** 7. One line: "The simulator has flags for every rule that might change. Bots that read the rules from the match start have nothing to do at minute 60."
  **After:** 7. One line: "The simulator has a flag for every rule that might change. If your bot reads the rules from the match start, the change costs you nothing."

- **Before:** **Copy rules.** Second person. Short sentences. No jargon that the rules doc has not defined on an earlier line. Every number the candidate needs is in a table, never in prose. No marketing language. No exclamation marks. The tone is a calm senior engineer explaining something they respect you enough to explain once.
  **After:** **Copy rules.** `docs/VOICE.md` is the standard, and it wins wherever this paragraph disagrees. Second person, present tense, short sentences, contractions welcome. No jargon the rules doc hasn't defined on an earlier line. Every number the candidate needs is in a table, not only in prose. No marketing language, no fake warmth, no exclamation marks. Plain, direct, a little dry.

- **Before:** **Errors are sentences.** Every `ERROR` code and every failure state on the portal says what happened and what to do next, in one sentence each. No codes shown to the candidate without the sentence.
  **After:** **Errors are sentences.** Every `ERROR` code and every failure state on the portal says what happened and what to do next, in one sentence each, in the voice. No codes shown to the candidate without the sentence.
