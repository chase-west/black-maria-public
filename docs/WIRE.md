# BLACK MARIA: the wire

The client we gave you already does all of this. You only need this page if you change how it talks to the server.

## The wire in a minute

| step | what you do |
|---|---|
| connect | Send `HELLO` with your token. `HELLO_ACK` gives you a session. Put it in every datagram. |
| stay alive | Send `PING` at least every 2000 ms. |
| start a match | `MATCH_START` comes in fragments. Answer each one with `ACK_FRAG`, and join them. |
| each tick | A `STATE` arrives. A keyframe is the full state. A delta is only what changed since a `base` tick. |
| a missing base | Don't have the state for that `base`? Send `RESYNC` and wait for a keyframe. |
| your move | Send one `INTENT` per tick, before the 250 ms deadline. The first copy that arrives counts. Later copies are ignored. |

All of it is UDP. Every integer is little-endian. Every field has a fixed width. Each datagram starts with a 12-byte header.

The network is bad on purpose. It loses, reorders, duplicates and delays datagrams. On the Master profile it also goes silent once for 400 ms. In the official run, three matches share one socket. Tell them apart by match id.

## Measure it

Four tools show what the network did and what your client did about it.

| tool | what it shows |
|---|---|
| `blackmaria play --trace` | A line per tick: when its `STATE` arrived after the deadline started, how long the bot took, when the move left, on time, late or missing, whether a `RESYNC` went out, and the gap in the server's seq. Every match ends with a summary block, trace or not. |
| `blackmaria doctor` | A 60-tick probe against Novice on the Master network profile. Prints the summary block, then the same numbers as sentences. |
| the connection panel | On Practice, watching your wire client, and on its replay. The last 100 ticks: what the chaos layer did to each tick's `STATE` and move on top, what became of your move below, and the match's totals beside. |
| `sim wire --log` | Every chaos action on the local simulator as it happens: match, tick, seq, direction, packet, and what happened to it. |

Practice gets the same network as the official run. `blackmaria play --vs master` plays on the Master profile. `--chaos off` gives you a clean link, and `--chaos novice`, `adept` or `master` picks a profile.

`--trace`, a tick whose `STATE` was dropped, then the next one:

```text
match  tick  state      think    sent       move     resync  gap
    2     1  missing    -        -          missing  no        0
    2     2  +0 ms      0 ms     +2 ms      on time  no        1
```

The summary block at the end of a match on the Master profile:

```text
Connection, match 1 against Maria (Novice), network master:
  on time          360 of 400 (90.0%)
  moves late       0
  moves missing    40
  round trip       p50 84 ms, p95 163 ms, from 92 pings
  packets lost     48 of 505 (gaps in the server's seq)
  duplicates       0 of 22 ignored
  resyncs          0, and 0 deltas applied to a base it never got
  blackout         780 ms from tick 13: acted on 0 of 2 ticks
  deadline margin  late          0
                   0-49 ms       0
                   50-99 ms     10  #
                   100-149 ms   93  #############
                   150-199 ms  206  ##############################
                   200+ ms      51  #######
```

`doctor`, after the block:

```text
Findings:
  4 of 60 ticks had no move before the deadline: 4 with none sent, 0 sent late.
  2 of the 2 ticks inside the 658 ms silent window from tick 40 had no move before the deadline.
  0 deltas named a base you never received and were applied anyway; 0 RESYNCs sent.
  7 of 81 packets from the server never arrived.
  4 packets arrived twice; 0 of them skipped.
  RTT p50 39 ms, p95 103 ms, from 12 PINGs.
```

The connection panel, one tick selected: `tick 195 · STATE dropped · move none · missing`.

`sim wire --log`:

```text
chaos  match   1  tick  10  seq    16  down STATE        dropped
chaos  match   1  tick  11  seq    17  up   INTENT       held, goes out after the next one
chaos  match   1  tick 105  seq     -  both              blackout: nothing gets through either way for 400 ms
```

The client can't read the server's clock, so its "on time" is an estimate: the deadline is taken to start when the earliest-arriving recent `STATE`s say it did, and a move counts if it left with half a round trip to spare. A blackout, to the client, is any 400 ms or more with nothing arriving. The panel and `sim wire --check` show what the server judged.

## Everything, exactly

The complete reference, then the worked example with every byte labelled.

<!-- fold: Everything, exactly -->

The wire is how your client talks to the server, for wire practice and the official run: binary datagrams over UDP, on a network that loses, reorders, duplicates and delays them on purpose. The client we gave you already speaks it. You don't need this page to play. You need it to make the client better.

Every integer is little-endian. Every field has a fixed width. No bit-packing, no variable-length integers.

## 1. Transport and framing

| fact | value |
|---|---|
| transport | UDP. The server listens on `WIRE_PORT` (default 7777) and also on UDP 443, because some campus and corporate networks block outbound UDP on unusual ports and allow 443 for QUIC |
| ports | the published client tries 7777 first and moves to 443 if no `HELLO_ACK` arrives within 2 seconds. The portal and `/api/me` give you the wire host and ports, so you never type them |
| identity | your source address and port. Replies go to them, from the port you last sent to |
| byte order | little-endian |
| largest datagram | 1200 bytes |
| keepalive | send `PING` at least every 2000 ms. After 10 000 ms with nothing from you the session is closed |

Every datagram starts with a 12-byte header:

| offset | size | field | meaning |
|---|---|---|---|
| 0 | u8 | magic | `0xB1` |
| 1 | u8 | type | the packet type below |
| 2 | u16 | session | 0 until `HELLO_ACK`, then the session it gave you |
| 4 | u32 | seq | per direction. Your first datagram is 1, and every datagram you send adds 1 |
| 8 | u32 | ack | the highest seq you have received from the other side so far, gaps allowed (0 before you have received anything) |

A datagram is valid only if it is exactly as long as its fields say. Anything else is dropped without a reply: a bad magic, an unknown type, the wrong session, a truncated payload, or trailing bytes. The server never crashes on any byte sequence.

The server learns which keyframe you hold from your `ack`: when the `ack` in a datagram you send equals the seq of a keyframe `STATE`, the server knows you have that keyframe and from then on sends deltas against it. Until it knows of one, every `STATE` is a keyframe.

## 2. Client to server

| type | name | payload |
|---|---|---|
| `0x01` | `HELLO` | `token` 16 raw bytes, `mode` u8 (0 practice, 1 official), `tier` u8 (0 novice, 1 adept, 2 master; ignored for official), `chaos` u8 (practice only: 0 off, 1 to 3 that tier's profile) |
| `0x02` | `INTENT` | `match` u16, `tick` u16, `kind` u8, `dir` u8, `item` u16. One move. The first valid move received for a `(match, tick)` is kept; later ones for it are ignored |
| `0x03` | `RESYNC` | `match` u16. The server answers with a keyframe `STATE` for the current tick. At most one per 100 ms per match; extra ones are ignored |
| `0x04` | `PING` | `client_ms` u32 |
| `0x05` | `ACK_FRAG` | `match` u16, `frag` u8. You received that `MATCH_START` fragment |
| `0x06` | `LEAVE` | `match` u16. Gives up a practice match (the rest plays out with you waiting). Ignored in the official run |

| move | `kind` | `dir` | `item` |
|---|---|---|---|
| `WAIT` | 0 | ignored | ignored |
| `MOVE` | 1 | 0 N, 1 E, 2 S, 3 W | ignored |
| `TAKE` | 2 | ignored | ignored |
| `DROP` | 3 | ignored | the item id |
| `USE` | 4 | ignored | the item id |
| `SNATCH` | 5 | ignored | ignored |

Write 0 in fields that are ignored. A `HELLO` with `mode` above 1, `tier` above 2 or `chaos` above 3 is dropped. A move with an unknown `kind`, or a `MOVE` with `dir` above 3, is answered with `ERROR 5` and you do `WAIT` unless a valid move for that tick arrives in time.

### Sessions

- Send `HELLO` with `session` 0 and keep sending it every few hundred ms until `HELLO_ACK` arrives. A repeated `HELLO` from the same address is answered with the same `HELLO_ACK`.
- Practice: a `HELLO` starts one practice match. After it ends, send `HELLO` again for the next one.
- Official: a `HELLO` with `mode` 1 starts your official run. If you lose your connection during the run, a `HELLO` with `mode` 1 from any address moves the run's live matches to the new session: their `MATCH_START` is sent again and their states restart from keyframes. The old session receives `ERROR 7`.
- A refused `HELLO` is answered with an `ERROR` carrying `session` 0 and `seq` 0.
- Your first `HELLO` starts your clock if your magic link has not. `HELLO_ACK` carries the seconds left on it and, once you have seen it, the change (`rule_change` 1 to 3; 0 before). You see it the first time you open the Official page, or when you start the official run. Every match that starts after that uses the change, including the next one on the same session.
- When your clock runs out, every datagram that is not about an official run in progress is answered with `ERROR 2` (at most one a second) and your practice matches end. An official run already in progress plays to the end.

## 3. Server to client

| type | name | payload |
|---|---|---|
| `0x81` | `HELLO_ACK` | `session` u16, `attempts_left` u8, `clock_s` u32 (seconds left on the clock; `0xFFFFFFFF` in the local simulator, which has no clock), `rule_change` u8 (0 not seen yet, 1 to 3 the change, once you have seen it) |
| `0x82` | `MATCH_START` | `match` u16, `frag` u8, `frag_count` u8, then a slice of the match blob: the rest of the datagram, 1 to 1000 bytes |
| `0x83` | `STATE` | `match` u16, `tick` u16, `base` u16 (the tick of the state this delta applies to, or `0xFFFF` for a keyframe), `deadline_ms` u16, `mask` u8, then the fields present, in mask-bit order (section 5) |
| `0x84` | `MATCH_END` | `match` u16, `result` u8 (0 loss, 1 draw, 2 win), `score_you` u8, `score_maria` u8 |
| `0x85` | `PONG` | `client_ms` u32 echoed, `server_ms` u32 |
| `0x86` | `ERROR` | `code` u8, `len` u8, `msg` (`len` bytes of printable ASCII) |

| `ERROR` code | meaning | what to do |
|---|---|---|
| 1 | bad token | Use the token from your magic link. |
| 2 | clock expired | Time's up. Practice and the official run are closed. Also sent, with the sentence "Too late for the official run. It had to start by minute 85.", to an official `HELLO` after minute 85. |
| 3 | no attempts | You've used your official run. Start a practice session instead. |
| 4 | rate limited | Slow down: at most 400 datagrams a second from one address. |
| 5 | bad move | The move was late or malformed, so you did `WAIT`. Send moves before the deadline. |
| 6 | unknown match | No live match with that id on this session. Wait for `MATCH_START`. |
| 7 | session closed | Send `HELLO` to open a new session. |

### Fragments

The match blob for a 21 to 24 tile map is 1200 to 1550 bytes, so it arrives in two `MATCH_START` fragments. They can arrive in any order and more than once. Send `ACK_FRAG` for every fragment you receive. The server resends the unacked ones every 100 ms for up to 2000 ms. The match's tick 0 starts when every fragment is acked, or when the 2000 ms are up.

### Match end

`MATCH_END` is sent three times, 100 ms apart, and again whenever you send anything about that match in the next 10 seconds. Expect duplicates. The final board is the one in the last `STATE` plus that tick's events; the scores are in `MATCH_END`. A score above 255 is sent as 255.

## 4. The match blob

The reassembled `MATCH_START` payload, in this order:

| field | encoding |
|---|---|
| `tier` | u8 |
| `seed_hint` | u32, an id for this match's replay; not the engine seed |
| `w`, `h` | u8, u8 |
| `tiles` | `w·h` bytes, one tile kind per byte, row-major: 0 floor, 1 wall, 2 door, 3 locked door, 4 sigil |
| `rooms` | `w·h` bytes, one room id per byte, row-major. `0xFF` is corridor |
| `room_names` | u8 count, then each name as u8 length and ASCII. The rooms on this map, in the order `hall, library, study, chapel, cellar, kitchen, conservatory, gallery, nursery, vault`. A room id is an index into this list |
| `sigil_owner` | u8 ×2: the owner of the first and second sigil in row-major order (0 you, 1 maria) |
| `params` | `max_tick` u16, `tick_ms` u16, `post_interval` u8, `expiry_min` u8, `expiry_max` u8, `snatch_cost` u8, `regen` u8, `energy_start` u8, `inventory_slots` u8, `return_ticks` u8, `chaos` u8 (0 off, 1 to 3 the tier profile on this match's link) |
| `maria_start` | `x` u8, `y` u8 |
| `board` | u8 count, then an errand (below) for each errand on the board at tick 0 |
| `fixtures` | u8 count, then each `id` u16, `kind` u8, `x` u8, `y` u8, `flags` u8 (bit 0: a closed safe). In id order |
| `items` | u8 count, then each `id` u16, `kind` u8, `x` u8, `y` u8, `flags` u8 (bit 0: inside the safe; then x, y are the safe's tile). In id order. Every item in the match is here, so this is where you learn each item's kind |
| `start` | `x` u8, `y` u8: your start |
| `decor` | u8 count, then each `kind` u8, `x` u8, `y` u8. Drawing only; it has no effect on the game |

**Errand** (14 bytes):

| field | encoding |
|---|---|
| `id` | u16 |
| `type` | u8: 0 deliver, 1 visit, 2 carry |
| `item_kind` | u8, or `0xFF` for a visit |
| `fixture` | u16, or `0xFFFF` unless a deliver |
| `room` | u8 room id, or `0xFF` unless a visit |
| `carry_ticks` | u8: `n` for a carry, otherwise 0 |
| `value` | u8 |
| `posted` | u16, the first tick it can be completed |
| `expires` | u16, the first tick it can no longer be completed |
| `state` | u8: 0 open, 1 done by you, 2 done by Maria, 3 expired |

Item ids are the numbers in the JSON ids (`i7` is 7), and so are fixture ids (`f3` is 3).

## 5. STATE: keyframes and deltas

A `STATE` is either a keyframe (`base = 0xFFFF`, `mask = 0xFF`, every field present, full lists) or a delta against the state you hold for tick `base`. If you do not hold that state, send `RESYNC`. The server sends a keyframe at tick 0, every 20 ticks, in answer to `RESYNC`, whenever it does not yet know which keyframe you hold, and whenever a delta against the keyframe you hold would not fit in one datagram. The server never resends a `STATE`.

A delta carries everything that changed since its `base`, not since the tick before it. Positions, energy, inventories, items, the board, doors, safes and sigils are all measured from `base`, which is normally the newest keyframe the server knows you hold. Only `events` are per tick: they are the events of the tick that just resolved. So apply each delta to the state for `base` that you kept, never to the state you built from the previous delta. Losing a delta then costs you only its events.

`tick` is the tick to send your move for. Its events are what happened in the tick before it.

| bit | field | encoding | in a delta |
|---|---|---|---|
| 0 | `you` | `x` u8, `y` u8, `energy` u8 | present if your position or energy changed since `base` |
| 1 | `maria` | `x` u8, `y` u8 | present if she moved |
| 2 | `inventories` | yours: u8 count, then `item` u16 each; then Maria's the same way. Both full lists, in pickup order | present if either changed |
| 3 | `items` | u8 count, then each `id` u16, `kind` u8, `x` u8, `y` u8 | only items whose place on the floor changed. An item that left the floor has `x = y = 0xFF`. A keyframe lists every item on the floor |
| 4 | `board` | u8 count, then errands | errands posted or changed since `base`. A keyframe lists every errand ever posted |
| 5 | `doors` | u8 count, then `x` u8, `y` u8 each | doors opened since `base`. A keyframe lists every opened door |
| 6 | `safes_and_sigils` | u8 count, then `fixture` u16 each (opened safes); then u8 ×2, each sigil's charge in row-major order (0 charged, otherwise ticks until charged) | present if a safe opened since `base` or a sigil's charge changed. The safes are those opened since `base`; the charges are current |
| 7 | `events` | u8 count, then each event | present if there were any. A keyframe always has the count, possibly 0 |

One exception keeps every `STATE` inside 1200 bytes: when errands are posted fast, "every errand ever posted" can outgrow a datagram near the end of a match. Then the server leaves out errands whose `expires` is at or before `tick`, expired ones first, oldest first, until it fits. It never leaves out an errand that can still be completed. Keep the records you already have for ids a keyframe skips. With the default parameters this never happens.

Each event is `kind` u8 and then:

| event | kind | payload |
|---|---|---|
| `posted` | 0 | an errand |
| `completed` | 1 | `id` u16, `by` u8 |
| `expired` | 2 | `id` u16 |
| `took` | 3 | `by` u8, `item` u16 |
| `dropped` | 4 | `by` u8, `item` u16 |
| `delivered` | 5 | `by` u8, `item` u16, `fixture` u16 |
| `snatched` | 6 | `by` u8, `item` u16 |
| `door_opened` | 7 | `x` u8, `y` u8 |
| `safe_opened` | 8 | `fixture` u16, `item` u16 |
| `sigil` | 9 | `owner` u8, `energy` u8 (always 40) |
| `moved` | 10 | `by` u8, `dir` u8: Maria's step, when she actually moved |
| `winding_up` | 11 | `by` u8: a snatch wound up this tick; its grab resolves on the next tick, after movement |
| `returned` | 12 | `item` u16, `kind` u8, `x` u8, `y` u8: the house put a delivered item back on the floor, with a new id |

`by` and `owner` are 0 for you and 1 for Maria.

An item the house puts back has a new id. Its kind is in the `returned` event, and in `items` while it is on the floor. Inventories carry ids only, so keep one map from item id to kind for the whole match, filled from the match blob and then from every `items` field and every `returned` event.

### The deadline

The deadline for tick `t` is `deadline_ms` from the moment the server sent the `STATE` for `t`, measured on the server's clock. In a `STATE` sent in answer to `RESYNC`, `deadline_ms` is the time left. A move for `t` that arrives after the deadline is dropped with `ERROR 5`, and you do `WAIT`.

## 6. The chaos layer

Applied to both directions of every official session and every practice session with chaos on, one datagram at a time, from a seeded generator so the replay records exactly what happened.

| profile | loss | reorder | duplicate | delay | burst |
|---|---|---|---|---|---|
| Novice | 5% | 5% | 2% | uniform 0 to 30 ms | none |
| Adept | 10% | 10% | 5% | uniform 0 to 60 ms | none |
| Master | 10% | 10% | 5% | uniform 0 to 70 ms | one 400 ms blackhole at a seeded tick from 100 to 300 |

- **Delay** is added to every datagram. A duplicate gets its own delay.
- **Reorder** holds a datagram and releases it just after the next datagram in the same direction (or after 100 ms if none follows).
- **The blackhole** drops everything in both directions on your session for 400 ms.
- `PING` and `PONG` go through the chaos layer like everything else. `HELLO` and `HELLO_ACK` do not.

The official deadline is 250 ms. Under the Master profile a client that waits for `STATE` before thinking has about 150 ms to think in the worst case, and none during the blackhole. Acting on a predicted state when a `STATE` is late is fine. The rules and Maria's code are public, so you can predict well.

## 7. The official run

`HELLO` with `mode` 1 starts your official run if it is before minute 85 on your clock and you have not run it yet. It is open from the moment your clock starts. From minute 85 the answer is `ERROR 2`. The run plays with the change; if you had not opened the Official page yet, this `HELLO` reveals it, and its `HELLO_ACK` carries it. The server sends three `MATCH_START`s at once, interleaves their `STATE`s on the one socket, and plays the 9 matches one tier at a time: three Novice, then three Adept, then three Master. Each match uses its tier's chaos profile, unless the change says otherwise. Results are recorded on the server. A second official `HELLO` after the run is over gets `ERROR 3`.

If your client disconnects during the run, its matches keep going with you doing `WAIT`, until they end or you reconnect with the same token.

## A worked example

One session, from the first datagram to your first moves. Every dump below comes straight from the real codec.

### `HELLO` (client to server)

Practice against Master with the Master chaos profile. `session` is 0 until the server gives you one.

```hex
b1 01 00 00 01 00 00 00 00 00 00 00 de ad be ef de ad be ef de ad be ef de ad be ef 00 02 03
```

| offset | bytes | field | value |
|---|---|---|---|
| 0 | `b1` | `magic` | 0xB1 |
| 1 | `01` | `type` | `0x01 HELLO` |
| 2 | `00 00` | `session` | 0 |
| 4 | `01 00 00 00` | `seq` | 1 |
| 8 | `00 00 00 00` | `ack` | 0 |
| 12 | `de ad be ef de ad be ef de ad be ef de ad be ef` | `token` | your 16 raw token bytes (the magic link's 32 hex characters) |
| 28 | `00` | `mode` | 0 practice |
| 29 | `02` | `tier` | 2 master |
| 30 | `03` | `chaos` | 3 use the Master chaos profile |

### `HELLO_ACK` (server to client)

The match's parameters come in its `MATCH_START`, not here.

```hex
b1 81 92 10 01 00 00 00 01 00 00 00 92 10 01 1c 11 00 00 00
```

| offset | bytes | field | value |
|---|---|---|---|
| 0 | `b1` | `magic` | 0xB1 |
| 1 | `81` | `type` | `0x81 HELLO_ACK` |
| 2 | `92 10` | `session` | 4242 |
| 4 | `01 00 00 00` | `seq` | 1 |
| 8 | `01 00 00 00` | `ack` | 1 |
| 12 | `92 10` | `session` | 4242: put this in every datagram you send from now on |
| 14 | `01` | `attempts_left` | 1 official run left |
| 15 | `1c 11 00 00` | `clock_s` | 4380 seconds left on the clock (73 minutes) |
| 19 | `00` | `rule_change` | 0: you have not seen the change yet |

### `MATCH_START`, fragment 0 of 2 (server to client)

The match blob for this map is 1562 bytes, so it comes in 2 fragments. This one carries the first 1000 bytes of it. Answer every fragment with `ACK_FRAG`, and decode the blob only when every fragment has arrived. The first bytes:

```hex
b1 82 92 10 02 00 00 00 01 00 00 00 03 00 00 02 02 cd ab 34 12 18 18 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 ...
```

| offset | bytes | field | value |
|---|---|---|---|
| 0 | `b1 82 92 10 02 00 00 00 01 00 00 00` | header | type 0x82 `MATCH_START`, session 4242, seq 2, ack 1 |
| 12 | `03 00` | `match` | 3 |
| 14 | `00` | `frag` | 0 |
| 15 | `02` | `frag_count` | 2 |
| 16 | `02` | `blob: tier` | 2 master |
| 17 | `cd ab 34 12` | `blob: seed_hint` | 0x1234ABCD |
| 21 | `18 18` | `blob: w, h` | 24 × 24 |
| 23 | `01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 ...` | `blob: tiles` | 576 bytes, one tile kind per byte, row-major (the top row is all walls: 01) |

### A keyframe `STATE` (server to client)

The full state at tick 0. A keyframe comes at tick 0, every 20 ticks, and in answer to `RESYNC`.

```hex
b1 83 92 10 04 00 00 00 03 00 00 00 03 00 00 00 ff ff fa 00 ff 13 11 28 10 16 00 00 13 01 00 06 0c 08 02 00 01 13 07 03 00 00 09 0d 04 00 03 14 11 05 00 02 16 04 06 00 09 13 04 07 00 07 06 12 08 00 02 0c 03 09 00 03 14 14 0a 00 04 15 10 0b 00 06 16 11 0c 00 03 05 02 0d 00 05 14 01 0e 00 08 14 04 0f 00 09 03 04 10 00 06 03 03 11 00 08 0a 01 12 00 02 03 05 13 00 07 12 14 06 00 00 00 06 05 00 ff 00 08 00 00 41 00 00 01 00 02 06 ff ff ff 0c 04 00 00 2b 00 00 02 00 02 03 ff ff ff 08 03 00 00 1e 00 00 03 00 00 01 05 00 ff 00 05 00 00 3b 00 00 04 00 02 07 ff ff ff 08 01 00 00 20 00 00 05 00 02 01 ff ff ff 08 05 00 00 3b 00 00 00 00 00 00 00
```

| offset | bytes | field | value |
|---|---|---|---|
| 0 | `b1` | `magic` | 0xB1 |
| 1 | `83` | `type` | `0x83 STATE` |
| 2 | `92 10` | `session` | 4242 |
| 4 | `04 00 00 00` | `seq` | 4 |
| 8 | `03 00 00 00` | `ack` | 3 |
| 12 | `03 00` | `match` | 3 |
| 14 | `00 00` | `tick` | 0, the tick to send your move for |
| 16 | `ff ff` | `base` | 0xFFFF: a keyframe |
| 18 | `fa 00` | `deadline_ms` | 250 |
| 20 | `ff` | `mask` | 0xFF: every field present |
| 21 | `13 11 28` | `you` | x 19, y 17, energy 40 |
| 24 | `10 16` | `maria` | x 16, y 22 |
| 26 | `00 00` | `inventories` | your count 0, Maria's count 0 |
| 28 | `13 01 00 06 0c 08 02 00 01 13 07 03 00 00 09 0d 04 00 03 14 11 05 00 02 16 04 06 00 09 13 04 07 00 07 06 12 08 00 02 0c 03 09 00 03 14 14 0a 00 04 15 10 0b 00 06 16 11 0c 00 03 05 02 0d 00 05 14 01 0e 00 08 14 04 0f 00 09 03 04 10 00 06 03 03 11 00 08 0a 01 12 00 02 03 05 13 00 07 12 14` | `items` | count 19, then `id` u16, `kind`, `x`, `y` for each item on the floor |
| 124 | `06` | `board` | count 6: every errand posted so far, 14 bytes each |
| 125 | `00 00 00 06 05 00 ff 00 08 00 00 41 00 00` | `errand 0` | `id` 0, `type` 0 deliver, `item_kind` 6 coin, `fixture` 5, `room` 0xFF none, `carry_ticks` 0, `value` 8, `posted` 0, `expires` 65, `state` 0 open |
| 139 | `01 00 02 06 ff ff ff 0c 04 00 00 2b 00 00 02 00 02 03 ff ff ff 08 03 00 00 1e 00 00 03 00 00 01 05 00 ff 00 05 00 00 3b 00 00 04 00 02 07 ff ff ff 08 01 00 00 20 00 00 05 00 02 01 ff ff ff 08 05 00 00 3b 00 00` | `errands 1 to 5` | five more records |
| 209 | `00` | `doors` | count 0 opened |
| 210 | `00 00 00` | `safes_and_sigils` | count 0 safes opened, then both sigils' charge: 0, 0 (0 is charged) |
| 213 | `00` | `events` | count 0 (tick 0 has none) |

### A delta `STATE` (server to client)

Only what changed since tick 0: you both moved and your energy went up by one. You get a `moved` event for Maria's step; your own is implied by your position. The base is a keyframe you hold, so you can apply it.

```hex
b1 83 92 10 05 00 00 00 04 00 00 00 03 00 01 00 00 00 fa 00 83 14 11 29 10 15 01 0a 01 00
```

| offset | bytes | field | value |
|---|---|---|---|
| 0 | `b1` | `magic` | 0xB1 |
| 1 | `83` | `type` | `0x83 STATE` |
| 2 | `92 10` | `session` | 4242 |
| 4 | `05 00 00 00` | `seq` | 5 |
| 8 | `04 00 00 00` | `ack` | 4 |
| 12 | `03 00` | `match` | 3 |
| 14 | `01 00` | `tick` | 1 |
| 16 | `00 00` | `base` | 0: apply this to the state you hold for tick 0 |
| 18 | `fa 00` | `deadline_ms` | 250 |
| 20 | `83` | `mask` | 0x83: `you`, `maria`, `events` |
| 21 | `14 11 29` | `you` | x 20, y 17: you moved east; energy 41 |
| 24 | `10 15` | `maria` | x 16, y 21 |
| 26 | `01` | `events` | count 1 |
| 27 | `0a 01 00` | `moved` | event kind 10, by 1 (Maria), dir 0 N |

### `INTENT` (client to server)

Your move for tick 1. `ack` 5 tells the server the newest datagram you have seen; when it is a keyframe's seq, the server knows you hold that keyframe and builds deltas on it.

```hex
b1 02 92 10 03 00 00 00 05 00 00 00 03 00 01 00 01 01 00 00
```

| offset | bytes | field | value |
|---|---|---|---|
| 0 | `b1` | `magic` | 0xB1 |
| 1 | `02` | `type` | `0x02 INTENT` |
| 2 | `92 10` | `session` | 4242 |
| 4 | `03 00 00 00` | `seq` | 3 |
| 8 | `05 00 00 00` | `ack` | 5 |
| 12 | `03 00` | `match` | 3 |
| 14 | `01 00` | `tick` | 1 |
| 16 | `01` | `kind` | 1 `MOVE` |
| 17 | `01` | `dir` | 1 E |
| 18 | `00 00` | `item` | 0, unused for `MOVE` |

### `INTENT` with `SNATCH` (client to server)

A snatch is two ticks. This is the wind-up: if Maria is on your tile or next to it after this tick's moves and you have at least `snatch_cost` energy, you pay it and you both get a `winding_up` event. Otherwise it does nothing and costs nothing. The grab happens on the next tick, after you both move: if she is still on your tile or next to it, one of her items (chosen by seed) moves to you, if she holds any and you have a free slot. You send nothing extra for the grab, and you can move on that tick.

```hex
b1 02 92 10 61 00 00 00 8c 00 00 00 03 00 5d 00 05 00 00 00
```

| offset | bytes | field | value |
|---|---|---|---|
| 0 | `b1` | `magic` | 0xB1 |
| 1 | `02` | `type` | `0x02 INTENT` |
| 2 | `92 10` | `session` | 4242 |
| 4 | `61 00 00 00` | `seq` | 97 |
| 8 | `8c 00 00 00` | `ack` | 140 |
| 12 | `03 00` | `match` | 3 |
| 14 | `5d 00` | `tick` | 93 |
| 16 | `05` | `kind` | 5 `SNATCH` |
| 17 | `00` | `dir` | 0, unused |
| 18 | `00 00` | `item` | 0, unused |

<!-- /fold -->

## 8. Why this is hard

| challenge | the real-world skill |
|---|---|
| The match blob is bigger than one datagram | Fragmentation and reassembly, because real payloads exceed an MTU. |
| States are deltas against a keyframe, and you can miss one | State sync the way games and replicated databases do it: deltas, a known base, and a way to resync. |
| The network loses, reorders, duplicates and delays on purpose | Reliability on top of an unreliable transport, like every real protocol over UDP. |
| The deadline is 250 ms and a `STATE` can arrive late or never | Real-time systems can't wait. Decide before the data arrives, and know what to do when it doesn't. |
| Three matches share one socket | Multiplexing: real clients serve many streams at once. |

## 9. Things that will bite you

| what | why |
|---|---|
| Waiting for `STATE` before you act | A late or lost `STATE` means a `WAIT` for that tick. Send a move for every tick, even when the `STATE` hasn't arrived. |
| The blackhole | For 400 ms nothing gets through in either direction. Plan for a few ticks with no news, and for the keyframe you'll need after. |
| Duplicates | Both directions duplicate. You will receive the same `STATE`, fragment and `MATCH_END` more than once. Key everything by match and tick. |
| The `base` you don't have | A delta applies only to the state it names. If you missed its keyframe, applying it to anything else gives you the wrong state. Resync instead. |

## 10. Checklist

A client that passes these ten is ready for the official run. The simulator's local wire server runs the same checklist against your client with `sim wire --check`.

1. It sends `HELLO` with `session` 0 and repeats it until `HELLO_ACK`, then puts the session in every datagram.
2. Its `seq` starts at 1 and rises by one per datagram; its `ack` is the highest seq it has received.
3. It sends `PING` at least every 2000 ms.
4. It reassembles `MATCH_START` from fragments in any order and sends `ACK_FRAG` for every fragment, duplicates included.
5. It keeps keyframes by tick and applies a delta only to the base it names.
6. It sends `RESYNC` when it lacks a delta's base, no more than once per 100 ms per match.
7. It ignores duplicate `STATE`, fragment and `MATCH_END` datagrams.
8. It sends a move for every tick before that tick's deadline, including ticks whose `STATE` is late.
9. It plays three matches at once on one socket, keyed by match id.
10. It reads every parameter from the match blob (`post_interval`, `expiry_min`, `expiry_max`, `snatch_cost`, `regen`, `chaos` and the rest) instead of assuming the defaults.
