# Voice

How every word on the site, in the docs, in the client, and in the emails should read. This replaces the copy rules in SPEC 8.5 wherever they disagree.

## The one rule

Write like a sharp person explaining something to a friend who is also sharp. Plain, direct, a little dry. Never like a product, never like a textbook, never like a model trying to sound thoughtful.

## What that means

- **Say the thing.** "Pick up the key" not "Acquire the key item from its tile." "You lost" not "Maria completed more errands than you did."
- **Short sentences, normal words.** If a sentence has a comma and a clause explaining the first half, split it or cut the second half.
- **No framing, no throat-clearing.** Never "Note that," "It is worth mentioning," "In other words," "Essentially," "Simply," "Importantly." Start with the content.
- **No stacked synonyms, no triplets.** "drops, reorders, and delays" is fine when each word is a different thing. "fast, quick, and responsive" is not.
- **No poetry.** No "the house hums," no "whispers," no "the body obeys." It's a house, a bot, a ghost, a board. Charm comes from the art and the ghost, not from adjectives.
- **No fake warmth.** No "Great job!", no "Welcome aboard," no exclamation marks anywhere.
- **No lecturing.** The rules say what happens. They do not say why it is interesting unless the section is literally "Why this is hard," and even then, one line each.
- **No hedging.** "about five minutes" is fine. "approximately five minutes, though this may vary" is not.
- **Contractions are fine.** "You've got one shot" reads better than "You have one attempt."
- **Second person, present tense.** "You start in the hall." "Maria wants the same things you do."
- **Numbers as numbers.** "400 ticks," "9 matches," "100 energy."
- **Machine copy is terse and lowercase.** `npx blackmaria play --vs master`, `resync at tick 140`, `late by 32 ms`.

## Before and after

| before | after |
|---|---|
| There is a house with two bodies in it: yours, and Maria's, a ghost with her own agenda. A board of errands fills up over the match: deliver this item to that fixture, be in this room, carry this for a while. Whoever completes an errand first scores its value. | It's a house. You're in it, and so is Maria, a ghost. Errands show up on a board: bring this there, go stand in that room, hold onto this for a bit. First one to finish an errand gets the points. |
| You have a client that already plays, badly. Make it win. It talks to the house over a bad network, and everything it touches is published: the rules, Maria's code, the server, a simulator. | We give you a bot that already plays. It's bad. Make it good. Everything's open: the rules, Maria's code, the server, a simulator you can run locally. The network between you and the house is deliberately lossy. |
| The official run is open now. Start it before minute 85, in 84:44. | Official run's open. You've got until minute 85 to start it. |
| Your 90 minutes are up, so practice, the official run and submission are closed. | Time's up. Practice, the official run, and submissions are closed. |
| The profiler is on its way. | Adding it up. |
| An errand card: its value and its expiry. Each errand has a value and an expiry. The value does not depend on distance, so a far errand can be worth more. | Every errand has a value and a deadline. Value has nothing to do with distance. A far one can be worth way more than a near one. |
| The simulator is the engine, all three tiers of Maria, a local wire server with the three bad networks, and the profiler. It does everything the server does, offline, as fast as your bot decides. | The simulator runs the whole game on your machine: all three Marias, the lossy network, the profiler. Same code as the server, no waiting on ticks. |
| Items are scarce. An item can only be in one place. While you hold it, Maria cannot use it. | Items are scarce. If you're holding it, she can't use it. |
| What did you notice about the system that we did not say? | What did you figure out that we didn't tell you? |
| Hand it in. Your code and two short answers. You can change them until the clock ends; the latest one counts. | Hand it in. Code plus two short answers. You can resubmit until time's up. Last one counts. |

## Things to kill on sight

"leverage," "utilize," "in order to," "it is important to note," "ensure," "facilitate," "robust," "seamless," "journey," "experience" (as a noun for using the site), "powerful," "intuitive," "elegant," "delve," "navigate" (unless literally moving on the map), "the body" (it's you, or your bot, or Maria), "the Vessel," "intent" (it's a move), "errand record," "datagram" outside the wire reference.
