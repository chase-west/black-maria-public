# BLACK MARIA: the rules

## Rules in a minute

This is all you need to play. Exact numbers are folded below, under "Everything, exactly".

<!-- grid -->

<!-- art: portrait_you maria_ghost | You and Maria -->

**You and Maria.** You're the cream fellow. Maria's the lilac ghost, with her own plan. You both move every tick, at the same time. You see everything she does except her energy.

<!-- art: ui_note | The board -->

**The board.** Errands show up on the board as the match goes: bring an item to a fixture, stand in a room, hold an item for a few ticks. First one to finish an errand gets the points.

<!-- art: icon_value icon_expiry | An errand card: value and expiry -->

**Value and expiry.** Every errand has a value and an expiry. Value has nothing to do with distance. A far one can be worth way more than a near one. If nobody finishes it in time, it's gone.

**Items are scarce.** If you're holding it, she can't use it. Delivered items come back later, somewhere else.

<!-- art: maria_ghost_grab you_grab | The snatch wind-up -->

**Snatch and energy.** You gain energy every tick. A snatch costs 100 and grabs an item from whoever is on your tile or next to it. It winds up for a tick first, so the target sees it coming and can step away.

**The end.** A match is 400 ticks. Higher score wins.

<!-- /grid -->

## 10. What strong bots do

The bot we gave you walks to the nearest errand and sticks with it even when a better one shows up. It walks to items Maria already took, ignores expiry, never snatches, never steps away from a wind-up, hard-codes every parameter, and waits for each state before it thinks. Here are the seven things that make a bot good, roughly in the order people find them. The profiler links to them by name.

### Nearest-first pathing

Walk shortest paths, and compute them once. The map never changes except for one door, so work out the distance from every tile to every tile at match start and redo it when the vault opens. Everything below needs fast, exact distances. Searching again per errand per tick burns the deadline.

### Value per tick

Value has nothing to do with distance, so the nearest errand often isn't the best one. An errand worth 9 that takes 20 ticks beats one worth 2 that takes 10. One worth 6 that takes 40 ticks loses to one worth 2 that takes 5. Rank errands by value divided by the ticks to finish from where you stand: the walk to the item, the pickup, the walk to the fixture, the use. This is the biggest single jump over the bot we gave you.

### Dropping errands you cannot make before expiry

An errand you reach one tick after it expires is worth nothing, and every tick you spent on it is gone. Before you commit, check that you finish before `expires`. Check again every tick, since Maria or a new posting can change the answer.

### Planning the next three errands as a route

Where an errand leaves you matters as much as what it's worth. Two errands next to each other beat one good errand across the house. Plan short sequences, two or three errands long, score each sequence as a whole, and take the first step of the best one. Carrying is free while you walk: a `carry` item you pick up on the way to something else finishes by itself. Your four slots are part of the plan too. An inventory full of things nothing needs blocks every pickup, so drop or deliver what you don't need before you walk to the next item.

### Simulating Maria to skip races you lose and win races you can

Maria's code is public and deterministic. You see everything she sees, and you can track her energy exactly from the events. Run her policy on her view of the state and you know her next move, and usually the ones after it. Skip the errands she'll finish first. Go for the ones she'll reach too late. Take the item she needs before she gets there. A snatch shows up a tick early: when you see her `winding_up`, step out of reach and the grab misses with her energy already spent. A copy of her knows even earlier, on the tick she sends it, so you can stay out of reach and her wind-up costs her nothing and gets nothing. When you wind up on her, the copy says where she'll step on your grab tick, so you can stay in reach. Never stand on her tile holding something she wants while she can afford a snatch: from there one step can't get you out of reach. Ties go to whoever has less energy, and you can arrange that.

### Sending moves ahead and resyncing so the network costs nothing

On the wire, a state can show up late or not at all, and a move that misses the deadline counts as `WAIT`. You don't have to wait for a tick's state to send its move. You know the rules and Maria's policy, so predict the state and send the next tick's move early. Send it more than once, too: the first copy that arrives counts and the rest are ignored. When a delta shows up for a keyframe you don't have, ask for a resync instead of driving blind until the next keyframe.

### Reading every parameter from the match start

Your official run plays with one rule changed: errands come faster, snatching gets cheaper, or the network gets worse. The Official page shows you which, and the simulator has a flag for each. Every number that can change is in the match start. If your bot reads `post_interval`, `expiry_min`, `expiry_max`, `snatch_cost`, `regen`, `return_ticks` and `chaos` from there, and your client copes with the worst network profile, the change costs you nothing.

## Everything, exactly

Every table and every number. Read it when you need it.

<!-- fold: Everything, exactly -->

It's a house. You're in it, and so is Maria, a ghost. Errands show up on a board over the match: bring this item to that fixture, go stand in this room, hold onto this item for a bit. Every errand has a value and an expiry. First one to finish an errand gets its value. There are more errands than the two of you can finish, so picking is the game. Holding an item keeps the other one off every errand that needs it, and a rare, expensive move called a snatch, announced a tick early, takes one away. After 400 ticks, higher score wins.

This page is complete. There are no other rules. The engine, all three Marias, the board generator and the server are all public, so you can run any match locally and get exactly what the server gets. The only things you don't know are the official run's seeds and Maria's energy, and you can track her energy from what you see.

Some numbers here can change. Your official run plays with one of them changed, and the Official page shows you which. Every match lists all of them in its match start under `params`. The examples below use the defaults.

## A worked example: ten ticks of a real match

Seed 80, every parameter at its default. You and Maria are both played by the simplest bot there is: walk to the nearest open errand's next step, `TAKE` or `USE` on arrival. You start at (4, 5), the center of the hall. Maria starts at (1, 1), the hall tile farthest from you. Both of you have 40 energy.

**The board at tick 0.** Six errands are posted before the first move.

| id | errand | value | posted | expires |
|---|---|---|---|---|
| 0 | `carry`: a photograph for 16 ticks | 1 | 0 | 68 |
| 1 | `carry`: a ledger for 16 ticks | 6 | 0 | 35 |
| 2 | `carry`: a letter for 8 ticks | 2 | 0 | 51 |
| 3 | `visit`: the library | 3 | 0 | 67 |
| 4 | `carry`: a bottle for 12 ticks | 4 | 0 | 37 |
| 5 | `carry`: a ring for 12 ticks | 4 | 0 | 65 |

**Tick 41.** Skip ahead. The score is you 9, Maria 5. You are at (8, 19) holding i15 (ledger), i9 (ring), i10 (locket). Maria is at (8, 19) holding i4 (ring), i1 (candle), i16 (coin). Your energy is 81. Hers is 100, but you can't see that. These errands are open:

| id | errand | value | posted | expires |
|---|---|---|---|---|
| 0 | `carry`: a photograph for 16 ticks | 1 | 0 | 68 |
| 2 | `carry`: a letter for 8 ticks | 2 | 0 | 51 |
| 7 | `deliver`: a coin to the clock `f1` in the hall | 2 | 12 | 67 |
| 9 | `deliver`: a locket to the fireplace `f6` in the library | 3 | 24 | 91 |
| 10 | `carry`: a ledger for 16 ticks | 2 | 30 | 76 |
| 11 | `carry`: a coin for 8 ticks | 2 | 36 | 83 |

Items on the floor: i2 (vial) at (1, 14), i3 (letter) at (11, 18), i5 (vial) at (1, 16), i6 (vial) at (3, 4), i7 (coin) at (4, 20), i8 (photograph) at (9, 19), i11 (locket) at (7, 9), i12 (key) at (18, 4), i13 (bottle) at (1, 15), i14 (candle) at (17, 5).

| tick | your move | Maria's move | you after | Maria after | your energy | her energy | events you receive | events Maria receives |
|---|---|---|---|---|---|---|---|---|
| 41 | `MOVE E` | `MOVE E` | (9, 19) | (9, 19) | 82 | 100 | `moved {by: maria, E}`, `posted {errand 12}` | `moved {by: maria, E}`, `posted {errand 12}` |
| 42 | `TAKE` | `TAKE` | (9, 19) | (9, 19) | 83 | 100 | `took {by: you, i8}` | `took {by: maria, i8}` |
| 43 | `MOVE N` | `MOVE N` | (9, 18) | (9, 18) | 84 | 100 | `moved {by: maria, N}`, `completed {11, by: maria}` | `moved {by: maria, N}`, `completed {11, by: you}` |
| 44 | `MOVE N` | `MOVE E` | (9, 17) | (10, 18) | 85 | 100 | `moved {by: maria, E}` | `moved {by: maria, N}` |
| 45 | `MOVE E` | `MOVE E` | (10, 17) | (11, 18) | 86 | 100 | `moved {by: maria, E}`, `completed {10, by: you}` | `moved {by: maria, E}`, `completed {10, by: maria}` |
| 46 | `USE i10` | `TAKE` | (10, 17) | (11, 18) | 87 | 100 | `took {by: maria, i3}`, `delivered {by: you, i10, f6}`, `completed {9, by: you}` | `took {by: you, i3}`, `delivered {by: maria, i10, f6}`, `completed {9, by: maria}` |
| 47 | `MOVE S` | `MOVE N` | (10, 18) | (11, 17) | 88 | 100 | `moved {by: maria, N}`, `posted {errand 13}` | `moved {by: maria, S}`, `posted {errand 13}` |
| 48 | `MOVE S` | `MOVE W` | (10, 19) | (10, 17) | 89 | 100 | `moved {by: maria, W}` | `moved {by: maria, S}` |
| 49 | `MOVE S` | `MOVE W` | (10, 20) | (9, 17) | 90 | 100 | `moved {by: maria, W}` | `moved {by: maria, S}` |
| 50 | `MOVE S` | `MOVE W` | (10, 21) | (8, 17) | 91 | 100 | `moved {by: maria, W}`, `expired {2}` | `moved {by: maria, S}`, `expired {2}` |

After tick 50 the score is you 14, Maria 7.

The energy columns show both so you can follow the ties. In a real match you only see your own. Maria gets the same events from her side: where you see `by: maria`, she sees `by: you`, and she gets a `moved` event for your steps instead of hers. "Order of one tick" in section 4 explains why each row came out the way it did. After this page you should be able to work out any tick by hand.

## 1. The house

| fact | value |
|---|---|
| map | square, side `S` from 21 to 24, chosen by seed |
| coordinates | `x` rightward, `y` downward, origin top-left |
| rooms | 7 or 8, generated by binary space partition, joined by one corridor and doors. Every room is at least 5 by 5. At least one room is L-shaped. The corridor is one tile wide, never runs straight more than 8 tiles without reaching a door, and has no dead ends |
| room names | drawn from `hall, library, study, chapel, cellar, kitchen, conservatory, gallery, nursery, vault`; `hall` and `vault` always exist |
| hall | the largest room, always a rectangle |
| your start | the center of the hall |
| Maria's start | the hall tile farthest from yours by walking distance (ties go to the first in row-major order) |
| vault | its only door is the single `door_locked` tile |
| reachability | every floor tile is reachable from the start, except the vault, which needs the locked door opened |

Every tile has a `kind` and a `room`. The room is a room name, or `corridor` for corridor floor and for every door and locked-door tile. So stepping through a doorway takes you out of the room for one tick.

| kind | id | behavior |
|---|---|---|
| `floor` | 0 | Passable. |
| `wall` | 1 | Impassable. |
| `door` | 2 | Passable. A room boundary. |
| `door_locked` | 3 | Impassable. Moving into it while holding the `key` opens it for good (it becomes a `door`) and uses up the key. You stay put that tick. Exactly one per map, on the vault. |
| `sigil` | 4 | Passable. An energy source: two per map, in two different rooms that are neither the hall nor the vault. One belongs to you and one to Maria. The match start says which is whose (`sigil_owner`). See section 6. |

Only walls and the locked door block you. You and Maria can stand on the same tile. Decor (plants, chairs, crates and so on) is in the match start for drawing and does nothing.

## 2. Fixtures and items

Fixtures sit on floor tiles and are passable, at most one per tile. Each room has 1 or 2, chosen from that room's list:

| room | possible fixtures |
|---|---|
| hall | clock, mirror, fireplace |
| library | bookcase, fireplace, clock |
| study | bookcase, safe, clock, fireplace |
| chapel | altar, font, mirror |
| cellar | well, safe, stove |
| kitchen | stove, well, fireplace |
| conservatory | font, well, piano |
| gallery | mirror, piano, clock |
| nursery | bed, piano, mirror |
| vault | altar, mirror, clock |

| fixture kind | id |
|---|---|
| `fireplace`, `well`, `safe`, `altar`, `piano`, `mirror`, `bookcase`, `bed`, `clock`, `font`, `stove` | 0 to 10, in that order |

| fact | value |
|---|---|
| items per map | 16 to 20, at most three of a kind |
| item kinds | `key`, `letter`, `candle`, `locket`, `ledger`, `bottle`, `coin`, `ring`, `photograph`, `vial`: ids 0 to 9, in that order |
| the key | exactly one. Never in the vault, never in the safe. It is never asked for by an errand |
| other items | never in the vault at the start |
| the safe | at most one per map, never in the vault. It starts closed and holds one item that is not the key. The match start lists that item as inside the safe |
| placement | no item, fixture or sigil starts on either start tile or directly beside a door |
| the house puts things back | an item delivered at tick `t` reappears at the end of tick `t + return_ticks` (default 40), with a new id, on a floor tile chosen by seed: a tile with no fixture, in a room other than the one it was delivered in, never the vault or a corridor. You both get a `returned` event. The key and the item that started in the safe never come back |

The key opens the vault door or the safe, not both, because using it uses it up. New ids continue the numbering: with 18 items at the start, the first item to come back is `i19`. Items never get used up. They're just out of play for a while.

## 3. You and Maria

| stat | start | rule |
|---|---|---|
| inventory | empty | `inventory_slots` slots (default 4 slots). Every item takes one |
| energy | `energy_start` (default 40) | +`regen` every tick (default +1), at most 100. Spent only on `SNATCH` |
| score | 0 | the sum of the values of the errands you completed |

You both act every tick, at the same time. You see everything: both positions, both inventories, every item on the floor, the whole board, and your own energy. Maria sees the same from her side. The only thing you don't see is Maria's energy, and she doesn't see yours. Every change to it is an event you do see (her wind-ups, her sigil), so you can track it exactly: `energy_start`, plus `regen` per tick, minus `snatch_cost` per wind-up she makes, plus 40 per payout of her sigil, never above 100.

## 4. Moves

| move | id | args | effect |
|---|---|---|---|
| `WAIT` | 0 | | Nothing. Also what you do when your move is late, missing, or malformed. |
| `MOVE` | 1 | `dir`: 0 N, 1 E, 2 S, 3 W | Step one tile. Into a `wall` or off the map: nothing happens. Into `door_locked` while holding the key: the door opens, the key is used up, and you stay put this tick. Without the key: nothing. |
| `TAKE` | 2 | | Pick up the items on your tile in ascending id order until your inventory is full. |
| `DROP` | 3 | `item` | Put that item down on your tile. Nothing if you do not hold it. |
| `USE` | 4 | `item` | Needs a fixture on your tile and the item held. The key on a closed safe opens it: the key is used up and the item inside lands on the safe's tile. Any other item on any fixture is delivered: it leaves the world until the house puts it back (section 2). No fixture, or the item not held: nothing. |
| `SNATCH` | 5 | | Two ticks. **The wind-up**, on the tick you send it: if Maria is on your tile or on one of the four tiles next to it after this tick's moves, and you have at least `snatch_cost` energy (default 100), you pay `snatch_cost` and both of you get a `winding_up` event. Otherwise nothing happens and it costs nothing. **The grab**, on the next tick, after you both move: if she is still on your tile or next to it, one of her items, chosen by seed, moves to you (if she holds any and you have a free slot). If she stepped out of reach, nothing happens and the energy stays spent. You send nothing for the grab and can move on that tick. She can snatch from you the same way. |

Reach is counted in tiles, ignoring walls: your tile and the four next to it. Standing on the same tile as the snatcher, one step cannot take you out of reach; standing next to it, one step away can, unless the snatcher follows.

**Ties.** Three things can tie in one tick: both of you `TAKE` on one tile, both of you complete the same errand, both of you wind up a `SNATCH`. All three are decided by energy at the start of the tick:

| tie | who wins |
|---|---|
| both `TAKE` on one tile | the items are taken one at a time, alternating, starting with whoever has less energy. Anyone with a full inventory is skipped |
| both complete one errand in the same tick | whoever has less energy |
| both wind up a `SNATCH` | whoever has more energy winds up; the other's does nothing and costs nothing |
| equal energy | a coin drawn from the seed, one per tick, picks one of you. That one counts as having less energy for the first two rows and more energy for the third |

### Order of one tick

1. **MOVE**, both of you, against the map only.
2. **The grab** of last tick's wind-up, if there was one, checked against where you both stand after moving.
3. **TAKE**, both of you, from where you stand after moving.
4. **DROP**, both of you. An item dropped this tick can't be taken until the next.
5. **USE**, both of you. An item grabbed this tick is gone before its holder can use it.
6. **SNATCH wind-ups**, both of you. A delivery made this tick can't be snatched.
7. **Sigils.** Recharging sigils count down by one. Then each charged sigil with someone on it pays its owner 40 and starts recharging.
8. **Energy.** You both gain `regen`. Energy never goes above 100.
9. **The board.** Errands completed this tick are marked done and scored. Then every open errand whose `expires` is the next tick is marked expired: this tick was its last chance, so its `expired` event arrives with this tick's events.
10. **The house puts things back.** Items delivered `return_ticks` ago reappear (section 2).
11. **Posting.** If the next tick is a posting tick, a new errand is posted for it.

## 5. The board

The board is the list of errands. Everyone sees all of it, all the time: every errand ever posted, open or not, and who completed what.

| field | meaning |
|---|---|
| `id` | 0, 1, 2 and so on, in posting order |
| `type` | `deliver`, `visit` or `carry` |
| target | an item kind and a fixture, a room, or an item kind and a length |
| `value` | what completing it scores |
| `posted` | the first tick it can be completed |
| `expires` | the first tick it can no longer be completed. It is open on ticks `posted` to `expires − 1` |
| `state` | `open`, `done_by_you`, `done_by_maria` or `expired`. Ids 0 to 3 |

| type | id | fields | completes when | value |
|---|---|---|---|---|
| `deliver` | 0 | item kind, fixture | someone `USE`s an item of that kind on that fixture | drawn by seed from 1 to 9 |
| `visit` | 1 | room | someone ends a tick in that room | drawn by seed from 1 to 3 |
| `carry` | 2 | item kind, `n` | someone has held an item of that kind at the end of each of the last `n` ticks, all of them at or after `posted`: holding it before the errand was posted does not count (n is 8, 12 or 16) | drawn by seed from 1 to 6 |

Whoever completes an errand first gets its value. Then it's done and nobody else can complete it. A `carry` does not use up the item: one item can complete several `carry` errands at once and then be delivered. Holding two items of a kind counts as holding that kind. Dropping it, delivering it, or having it snatched breaks the run.

**Time is the scarce thing.** There are more errands than the two of you can finish, so picking is the game. Items are plentiful, 16 to 20, and come back after delivery. But while you hold an item, Maria can't use it for anything, and the same goes for her items, until it's dropped, delivered or snatched. A full inventory blocks every pickup until you drop or deliver something.

| posting | rule |
|---|---|
| tick 0 | 6 errands, in the match start |
| after that | one new errand on every tick that is a multiple of `post_interval` (default 6), up to tick 360 (40 ticks before the end) |
| per match | about 65 with the defaults |
| expiry | `expires = posted + e`, with `e` drawn by seed from `expiry_min` to `expiry_max` inclusive (defaults 30 and 70) |
| feasibility | an errand is only posted if it can be completed with the items in the world when it is posted, ignoring who holds them |

### How an errand is drawn

This is the whole generator. It runs after the tick before the posting tick has resolved, so it sees where everything is right then. Every random number comes from the seed.

1. Draw a number from 0 to 19. Below 7 the errand is a `deliver`, below 18 a `carry`, otherwise a `visit`. If that type has no possible errand, try `deliver`, then `carry`, then `visit`. If none is possible, nothing is posted.
2. An item is **in the world** if it is on the floor, held by either of you, or inside the closed safe while the key still exists. The vault counts as reachable if its door is open or the key still exists. The key itself never appears in an errand.
3. **`deliver`.** Possible kinds: kinds with an item in the world. For a kind, possible fixtures: every fixture that is not a safe, not in an unreachable vault, and not already the target of an open `deliver` for that kind. Draw a kind from the kinds that have a possible fixture. For each possible fixture, take the walking distance from the nearest item of the kind (an item that is held counts from its holder's tile, an item in the safe from the safe's tile; the locked door counts as open). Prefer fixtures at least 3 tiles away: draw one from those if there are any, otherwise from all of them.
4. **`carry`.** Draw a kind from the kinds with an item in the world and no open `carry`. Draw `n` from 8, 12, 16.
5. **`visit`.** Draw a room from every room except the hall, except the vault when it is unreachable, and except rooms that already have an open `visit`.
6. Draw `e` for the expiry.
7. Draw the value from the type's range: 1 to 9 for a `deliver`, 1 to 6 for a `carry`, 1 to 3 for a `visit`. The value does not depend on distance, so a far errand can be worth far more than a near one.

Kinds are considered in item-id order, fixtures in fixture-id order, rooms in the order of the room list above. Because the generator looks at where items are, where you leave an item changes what gets posted.

## 6. Energy and sigils

| rule | value |
|---|---|
| starting energy | `energy_start` (default 40) |
| regeneration | +`regen` every tick (default 1), for both of you |
| cap | 100 |
| spent on | a `SNATCH` wind-up only, `snatch_cost` (default 100), so you can afford about three snatches a match |
| sigil payout | +40 to the sigil's owner, whoever is standing on it |
| sigil recharge | 60 ticks: a sigil that pays out at tick `t` can pay out again at tick `t + 60` at the earliest |

When anyone ends a tick on a charged `sigil`, the sigil's owner gains 40 energy, whoever is standing there, and the sigil starts recharging. If you're both on it, it pays once. The `sigil` event always says 40, even when the owner was near the cap, so it never reveals the owner's energy. Each state lists, per sigil, how many ticks it still needs to charge.

## 7. Events

After each tick you both get the tick's events, each from your own side: `by` and `owner` say `you` or `maria` relative to whoever receives them. They come in resolution order: moves, the grab, takes, drops, uses, wind-ups, sigils, completions, expiries, returns, posting.

| kind | id | fields | notes |
|---|---|---|---|
| `posted` | 0 | the errand | a new errand, open from this tick |
| `completed` | 1 | errand id, `by` | |
| `expired` | 2 | errand id | |
| `took` | 3 | `by`, item | one per item taken |
| `dropped` | 4 | `by`, item | |
| `delivered` | 5 | `by`, item, fixture | the item has left the world |
| `snatched` | 6 | `by`, item | `by` is whoever took it |
| `door_opened` | 7 | `x`, `y` | |
| `safe_opened` | 8 | fixture, item | the item is now on the safe's tile |
| `sigil` | 9 | `owner`, `energy_gained` | always 40 |
| `moved` | 10 | `by`, `dir` | the other one's step, when they actually moved. Your own steps are implied by your position |
| `winding_up` | 11 | `by` | a snatch wound up this tick. The grab resolves next tick if the target is still in reach after moving |
| `returned` | 12 | item, item kind, `x`, `y` | the house put a delivered item back, with a new id |

## 8. Ticks, the deadline, and the end of the match

| fact | value |
|---|---|
| ticks per match | `max_tick` (default 400), numbered 0 to 399 |
| your move for tick `t` | due within the deadline after the server sends the state for tick `t` |
| the deadline | `tick_ms`: 250 ms by default (practice on the WebSocket can run 2 or 4 times faster) |
| late, missing or malformed move | you do `WAIT` |
| end | after tick 399 resolves |
| score | the sum of the values of the errands you completed |
| result | win, draw or loss by comparing your score with Maria's |

When the match ends you receive both scores and the final board.

### Parameters

Every number a bot might depend on is in the match start, under `params`, on both the WebSocket and the wire. Your official run plays with one of them changed, so read them instead of hard-coding them.

| parameter | default | meaning |
|---|---|---|
| `max_tick` | 400 | ticks per match |
| `tick_ms` | 250 | the deadline |
| `post_interval` | 6 | a new errand every this many ticks |
| `expiry_min`, `expiry_max` | 30, 70 | the range an errand's lifetime is drawn from |
| `snatch_cost` | 100 | energy a snatch's wind-up costs, and the minimum needed |
| `regen` | 1 | energy gained per tick |
| `energy_start` | 40 | energy at tick 0 |
| `inventory_slots` | 4 | slots each |
| `return_ticks` | 40 | ticks before a delivered item comes back |
| `chaos` | off | the network profile on this match's link (section on the wire) |

### How you connect

| path | what it is for |
|---|---|
| WebSocket, JSON | practice and playing by hand. A full state every tick on a clean link. It cannot start an official run |
| the wire, UDP binary | wire practice and the official run. A bad network on purpose: packets get lost, reordered, duplicated and delayed. The server sends a keyframe (a full state) at tick 0, every 20 ticks and when you ask for a resync. The other states are a delta against a keyframe you hold. `docs/WIRE.md` has every byte |
| the official run | one per candidate, over the wire: 9 matches, 3 per tier, 3 at a time on one socket, with the deadline at 250 ms. It is open from the moment your clock starts and must start before minute 85. Start it from your client: `npx blackmaria official` |
| its score | each win scores 1 against Novice, 3 against Adept and 9 against Master, so 39 at most. A draw or a loss scores 0. Practice never counts |
| the clock | 90 minutes from the moment you first open your magic link. The first time you open the Official page it shows you the one changed rule. Your official run and every match after that use it. Practice, the official run and submission close when time's up. An official run already in progress plays to the end |
| the profiler | after every practice match, one screen that shows where your points went: errands you completed, errands Maria took first and by how many ticks, errands that expired on your way there, points you never went for, idle ticks, ticks lost to the network, snatches, and energy left over. Each line links to the matching heading under "What strong bots do" |

## 9. Maria

Maria comes in three tiers. All three are public in `@black-maria/sim` (`packages/house-bots`) and deterministic: same observations, same move, every time. No clock, no unseeded randomness, fixed iteration counts. Maria sees exactly what you see, from her side: the map, both positions, both inventories, the board, the events, and her own energy. She never sees your energy, but she tracks it exactly from the events, same as you can with hers. Like you, she reads every parameter from the match start.

All three find paths by breadth-first search over walking distance and step along a shortest path, trying N, E, S, W in that order. A route through the locked door counts one extra tick for opening it. The **next step** for an errand is: for a `deliver`, the fixture if she holds an item of that kind, otherwise the nearest item of that kind on the floor; for a `carry`, the nearest item of that kind on the floor, unless she already holds one (then holding is the work); for a `visit`, the nearest tile of the room. Items you hold are not on the floor.

**Freeing a slot.** All three use the same rule when their inventory is full and the next step is a pickup. The item to drop: never the key and never an item of the kind on the pickup tile; of the rest, the lowest-id item no open errand needs, otherwise the lowest-id item. If no floor item is on her tile she `DROP`s it there. If one is, she walks on and drops on a later tile; standing on the pickup tile itself, she steps to the first neighbor (N, E, S, W) with no floor item on it, or drops there if every neighbor has one. The route search counts the drop as one tick where she stands.

**Wind-ups.** The tick after she winds up a snatch is her grab tick; what she does on it is in each tier's table. A wind-up of yours shows in the events she receives, the same as hers do in yours.

### Novice

| behavior | rule |
|---|---|
| choice | every tick, the open errand whose next step is nearest to her by walking distance (ties: lowest errand id) |
| actions | `TAKE` on the item's tile, `USE` on the fixture's tile, otherwise the first `MOVE` of the path |
| skipped | errands whose next step she cannot reach, and carries she is already doing by holding |
| full inventory | she frees a slot first (above) |
| the key | she goes through the locked door only if she happens to be holding the key |
| expiry | never checked |
| snatch | never |
| idle | `WAIT` when nothing is left |

### Adept

| behavior | rule |
|---|---|
| ways to do an errand | for each open errand, the fastest way with her own hands: walk to an item (fetching the key first if the item is in the safe or the fixture is in the vault), 1 tick to `TAKE`, walk to the fixture, 1 tick to `USE` for a `deliver`; walk to the room for a `visit`; walk to an item and `TAKE` for a `carry`, which then finishes `n` ticks after the pickup while she walks on. A `carry` whose kind she already holds is left out: it finishes by itself |
| snatching as a way | if you hold an item of the kind and she has a free slot: walk until she is next to your tile, wait if she is short of energy, wind up (1 tick) and grab (1 tick), then go on as above from your tile. Its value counts as value × (your items of that kind ÷ all your items), because a snatch takes one of your items chosen by seed |
| effort and finish | effort is the ticks until her hands are free again (for a `carry`, until the pickup); finish is the tick the errand completes |
| expiry | she drops every way that would finish at or after the errand's expiry |
| ranking | every way, best value ÷ effort first (ties: lowest errand id, her own hands before a snatch), re-planned from scratch every tick |
| route of two | she takes the two best-ranked errands she can do with her own hands and plays them out as a route both ways round, the first then the second and the second then the first, with the same walking model. She goes for the first errand of the order with more value per tick over both (the two values ÷ the ticks until her hands are free after the second; ties: the better-ranked first). If only one order can finish both before they expire, she takes it; if neither can, or only one errand is doable, she goes for the best-ranked one. A snatch ranked first is followed as it is |
| sigil | first of all: if her sigil is charged and 1 to 3 steps away, she steps toward it |
| snatch | she winds up when you are on her tile or next to it, you hold the kind the errand she is going for needs, and she has at least `snatch_cost` energy and a free slot. She looks at where you stand now: she does not predict you |
| grab tick | she `WAIT`s. She does not follow you, so stepping out of her reach on that tick escapes the grab every time you can |
| your wind-ups | she does nothing about them |
| idle | `WAIT` when nothing is feasible |

### Master

| part | rule |
|---|---|
| predicting you | a weight per open errand for "you are going for this". Every tick, for each open errand: if your last step reduced your walking distance to its next step (or you hold the kind of a `carry`), its weight is multiplied by 3, otherwise by 0.5; then the weights are normalized to sum to 1. A newly posted errand starts at the average weight of the others |
| where you will be | she expects you to take one step toward the next step of the errand with the highest weight (ties: lowest id), or to stay if you are on it |
| the race | for each open errand she works out when you would finish it from where you stand, the same way Adept does. The chance you win the race is 1 ÷ (1 + 2^(your finish − her finish)), and the chance she wins is 1 minus that. The prediction discount is 1 − (its weight ÷ the largest weight) × the chance you win + (its weight ÷ the largest weight) × the chance she wins: an errand you are going for counts for less when you would get there first and for more, up to twice its value, when she would, because taking it from you is worth its value twice |
| route search | every tick, a beam search over sequences of up to 4 errands: beam width 8, depth 4. Each sequence is played out with exact walking distances and the engine's rules: `TAKE` takes a tick and picks up everything on the tile in id order until the inventory is full, `USE` takes a tick, the key is fetched when the vault door or the safe is in the way, a `carry` finishes `n` ticks after the pickup while she walks on (and only counts if its item is still held at the end of the sequence), and an errand finished at or after its expiry scores nothing. A sequence scores the sum, over its errands and over the carries it would finish just by holding, of value × prediction discount × 0.99 per tick until she would finish it, plus 2 for every item other than the key she would hold at the end of the sequence (holding an item keeps it from you). A full inventory costs one tick to free a slot before a pickup. A sequence may include one snatch of an item you hold (walking next to your tile as it is now, waiting for the energy if she is short, then the wind-up tick and the grab tick), if the snatch policy would allow it; that errand counts at value × your items of that kind ÷ all your items. She follows the first step of the best sequence (ties: lower errand ids first) |
| snatch policy | she winds up when you are on her tile or next to it now and will still be after your expected step, she has at least `snatch_cost` energy and a free slot, and one of your items has an open `deliver` or `carry` worth at least 3 that she could finish (a `deliver`: the grab tick, the walk from your tile to the fixture and 1 tick to `USE`; a `carry`: from the grab tick, `n` ticks) before you could snatch it back. You could snatch it back on the first tick after the grab, within the next 6, at which your energy would reach `snatch_cost`. Until you have wound up a snatch in this match, she assumes you never will |
| the chase | if the snatch policy would allow a snatch and your expected tile is at most 6 steps away, she steps toward it |
| grab tick | she keeps you in reach of your expected tile: her planned step if it ends within one tile of it, else `WAIT` if that does, else the first of N, E, S, W that does, else her planned step |
| defense | on the tick after you wind up, if she holds anything, she steps out of reach of where you stand: her planned step if it ends more than one tile from you, else the first of N, E, S, W that does, nearest by walking to her plan's next waypoint, else her planned move. She does not expect you to follow |
| sigil | the same rule as Adept, before the route search |
| shadowing | when no sequence scores more than doing nothing (nothing is feasible, or nothing beats holding what she holds), she steps toward your expected tile along a shortest path, or `WAIT`s if she is already on it or next to it or cannot reach it. Next to someone who never steps away, the snatch policy gets its chances |
| order each tick | update the weights; snatch if the policy says so; the sigil; the chase; the route search; shadowing if the route search found nothing better than doing nothing. Then, on her grab tick, the grab-tick rule replaces that move, and on the tick after your wind-up, the defense does |
| budget | beam 8 × depth 4, with the predictions above. Fixed, never time-based |

With the simulator you can reproduce every decision she makes, tick by tick: give a copy of her the same observations she gets (rebuilt from yours, with her energy tracked from the events) and it chooses exactly her move.

## 11. Why this is hard

Nothing here is hard because we hid something. The rules are on this page, and Maria's code and the server are public.

| challenge | what it tests |
|---|---|
| The board is a scheduling problem with deadlines | Which errands, in what order, before they expire. That's orienteering with time windows: no fast exact answer, so every better idea is a real algorithm with a visible score bump. |
| Maria is a rival with a published policy | Modeling an opponent. Her next move can be computed. The question is whether you use it. |
| Time is scarce | Contention for a shared board. More errands than the two of you can finish, and holding an item locks her out of every errand that needs it. |
| Nine maps you have not seen | Generalization. The official run uses seeds you never practiced on. |
| The deadline | Good work inside a fixed time budget, like any real-time system. |
| The network | The wire drops, reorders, duplicates and delays packets. Real systems keep working on a bad link. |
| The official run changes one rule | Building for change. A bot that reads its parameters from the match start has nothing to do. |

The job: a scheduler and a model of Maria that hold up on nine maps you haven't seen, inside the deadline, over a bad network.

<!-- /fold -->
