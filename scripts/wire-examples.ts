// Prints the worked example at the top of docs/WIRE.md: annotated hex dumps produced by the real codec, so the doc
// and the server agree to the byte. Run: npx tsx --conditions=source scripts/wire-examples.ts
// The output is everything from "## A worked example" up to "## 1." in docs/WIRE.md; a test checks they match.
import { createMatch, createRng, matchBlobFor, snapshotFor, step, wireEventsFor } from "../packages/engine/src/index.js";
import { ITEM_KINDS } from "../packages/protocol/src/index.js";
import { deltaFields, encode, encodeBlob, fragment, keyframeFields, maskOf, type Datagram, type ErrandRecord, type Packet } from "../packages/protocol/src/wire/index.js";

export function wireExamples(): string {
  type Field = [size: number, name: string, value: string];
  const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join(" ");
  const header = (type: string, d: Datagram): Field[] => [
    [1, "magic", "0xB1"],
    [1, "type", `\`${type}\``],
    [2, "session", String(d.session)],
    [4, "seq", String(d.seq)],
    [4, "ack", String(d.ack)],
  ];
  /** Render a datagram: its hex, then a table of fields whose sizes must add up to the datagram length. */
  function show(title: string, d: Datagram, fields: Field[], note = ""): string {
    const bytes = encode(d);
    const total = fields.reduce((n, f) => n + f[0], 0);
    if (total !== bytes.length) throw new Error(`${title}: fields cover ${total} bytes, datagram is ${bytes.length}`);
    const rows: string[] = [];
    let off = 0;
    for (const [size, name, value] of fields) {
      rows.push(`| ${off} | \`${hex(bytes.slice(off, off + size))}\` | \`${name}\` | ${value} |`);
      off += size;
    }
    return [`### ${title}`, "", note, "", "```hex", hex(bytes), "```", "", "| offset | bytes | field | value |", "|---|---|---|---|", ...rows, ""].filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n");
  }

  const TYPES = ["deliver", "visit", "carry"];
  const STATES = ["open", "done_by_you", "done_by_maria", "expired"];
  const describe = (e: ErrandRecord) =>
    `\`id\` ${e.id}, \`type\` ${e.type} ${TYPES[e.type]}, \`item_kind\` ${e.itemKind} ${ITEM_KINDS[e.itemKind] ?? "none"}, \`fixture\` ${e.fixture === 0xffff ? "0xFFFF none" : e.fixture}, \`room\` ${e.room === 0xff ? "0xFF none" : e.room}, \`carry_ticks\` ${e.carryTicks}, \`value\` ${e.value}, \`posted\` ${e.posted}, \`expires\` ${e.expires}, \`state\` ${e.state} ${STATES[e.state]}`;
  const out: string[] = ["## A worked example", "", "One session, from the first datagram to your first moves. Every dump below comes straight from the real codec.", ""];
  const token = Uint8Array.from({ length: 16 }, (_, i) => [0xde, 0xad, 0xbe, 0xef][i % 4]!);
  const SESSION = 4242;

  {
    const p: Packet = { type: "HELLO", token, mode: 0, tier: 2, chaos: 3 };
    const d: Datagram = { session: 0, seq: 1, ack: 0, packet: p };
    out.push(show("`HELLO` (client to server)", d, [...header("0x01 HELLO", d), [16, "token", "your 16 raw token bytes (the magic link's 32 hex characters)"], [1, "mode", "0 practice"], [1, "tier", "2 master"], [1, "chaos", "3 use the Master chaos profile"]], "Practice against Master with the Master chaos profile. `session` is 0 until the server gives you one."));
  }
  {
    const p: Packet = { type: "HELLO_ACK", session: SESSION, attemptsLeft: 1, clockS: 4380, ruleChange: 0 };
    const d: Datagram = { session: SESSION, seq: 1, ack: 1, packet: p };
    out.push(show("`HELLO_ACK` (server to client)", d, [...header("0x81 HELLO_ACK", d), [2, "session", `${SESSION}: put this in every datagram you send from now on`], [1, "attempts_left", "1 official run left"], [4, "clock_s", "4380 seconds left on the clock (73 minutes)"], [1, "rule_change", "0: you have not seen the change yet"]], "The match's parameters come in its `MATCH_START`, not here."));
  }
  const s0 = createMatch(7);
  const blob = encodeBlob(matchBlobFor(s0, "master", 0x1234abcd, { tick_ms: 250, chaos: "master" }));
  const frags = fragment(blob);
  {
    const p: Packet = { type: "MATCH_START", match: 3, frag: 0, fragCount: frags.length, data: frags[0]! };
    const d: Datagram = { session: SESSION, seq: 2, ack: 1, packet: p };
    const bytes = encode(d);
    const w = blob[5]!;
    out.push(
      [
        "### `MATCH_START`, fragment 0 of 2 (server to client)",
        "",
        `The match blob for this map is ${blob.length} bytes, so it comes in ${frags.length} fragments. This one carries the first ${bytes.length - 16} bytes of it. Answer every fragment with \`ACK_FRAG\`, and decode the blob only when every fragment has arrived. The first bytes:`,
        "",
        "```hex",
        hex(bytes.slice(0, 48)) + " ...",
        "```",
        "",
        "| offset | bytes | field | value |",
        "|---|---|---|---|",
        `| 0 | \`${hex(bytes.slice(0, 12))}\` | header | type 0x82 \`MATCH_START\`, session ${SESSION}, seq 2, ack 1 |`,
        `| 12 | \`${hex(bytes.slice(12, 14))}\` | \`match\` | 3 |`,
        `| 14 | \`${hex(bytes.slice(14, 15))}\` | \`frag\` | 0 |`,
        `| 15 | \`${hex(bytes.slice(15, 16))}\` | \`frag_count\` | ${frags.length} |`,
        `| 16 | \`${hex(bytes.slice(16, 17))}\` | \`blob: tier\` | 2 master |`,
        `| 17 | \`${hex(bytes.slice(17, 21))}\` | \`blob: seed_hint\` | 0x1234ABCD |`,
        `| 21 | \`${hex(bytes.slice(21, 23))}\` | \`blob: w, h\` | ${w} × ${blob[6]} |`,
        `| 23 | \`${hex(bytes.slice(23, 48))} ...\` | \`blob: tiles\` | ${w * blob[6]!} bytes, one tile kind per byte, row-major (the top row is all walls: 01) |`,
        "",
      ].join("\n"),
    );
  }
  const rng = createRng(7);
  const s1 = step(s0, { you: { kind: "MOVE", dir: "E" }, maria: { kind: "MOVE", dir: "N" } }, rng);
  {
    const f = keyframeFields(snapshotFor(s0), []);
    const p: Packet = { type: "STATE", match: 3, tick: 0, base: 0xffff, deadlineMs: 250, ...f };
    const d: Datagram = { session: SESSION, seq: 4, ack: 3, packet: p };
    const fields: Field[] = [
      ...header("0x83 STATE", d),
      [2, "match", "3"],
      [2, "tick", "0, the tick to send your move for"],
      [2, "base", "0xFFFF: a keyframe"],
      [2, "deadline_ms", "250"],
      [1, "mask", "0xFF: every field present"],
      [3, "you", `x ${f.you.x}, y ${f.you.y}, energy ${f.you.energy}`],
      [2, "maria", `x ${f.maria.x}, y ${f.maria.y}`],
      [2, "inventories", "your count 0, Maria's count 0"],
      [1 + 5 * f.items.length, "items", `count ${f.items.length}, then \`id\` u16, \`kind\`, \`x\`, \`y\` for each item on the floor`],
      [1, "board", `count ${f.board.length}: every errand posted so far, 14 bytes each`],
      [14, "errand 0", describe(f.board[0]!)],
      [14 * (f.board.length - 1), `errands 1 to ${f.board.length - 1}`, "five more records"],
      [1, "doors", "count 0 opened"],
      [3, "safes_and_sigils", `count 0 safes opened, then both sigils' charge: ${f.safesAndSigils.sigils.join(", ")} (0 is charged)`],
      [1, "events", "count 0 (tick 0 has none)"],
    ];
    out.push(show("A keyframe `STATE` (server to client)", d, fields, "The full state at tick 0. A keyframe comes at tick 0, every 20 ticks, and in answer to `RESYNC`."));
  }
  {
    const f = deltaFields(snapshotFor(s0), snapshotFor(s1), wireEventsFor(s1));
    const p: Packet = { type: "STATE", match: 3, tick: 1, base: 0, deadlineMs: 250, ...f };
    const d: Datagram = { session: SESSION, seq: 5, ack: 4, packet: p };
    const moved = f.events!.find((e) => e.kind === "moved")!;
    if (moved.kind !== "moved") throw new Error("expected moved");
    const fields: Field[] = [
      ...header("0x83 STATE", d),
      [2, "match", "3"],
      [2, "tick", "1"],
      [2, "base", "0: apply this to the state you hold for tick 0"],
      [2, "deadline_ms", "250"],
      [1, "mask", `0x${maskOf(f).toString(16)}: \`you\`, \`maria\`, \`events\``],
      [3, "you", `x ${f.you!.x}, y ${f.you!.y}: you moved east; energy ${f.you!.energy}`],
      [2, "maria", `x ${f.maria!.x}, y ${f.maria!.y}`],
      [1, "events", `count ${f.events!.length}`],
      [3, "moved", `event kind 10, by 1 (Maria), dir ${moved.dir} N`],
    ];
    if (f.events!.length !== 1 || !f.you || !f.maria || f.inventories || f.items || f.board || f.doors || f.safesAndSigils) throw new Error("unexpected delta shape");
    out.push(show("A delta `STATE` (server to client)", d, fields, "Only what changed since tick 0: you both moved and your energy went up by one. You get a `moved` event for Maria's step; your own is implied by your position. The base is a keyframe you hold, so you can apply it."));
  }
  {
    const p: Packet = { type: "INTENT", match: 3, tick: 1, intent: { kind: 1, dir: 1, item: 0 } };
    const d: Datagram = { session: SESSION, seq: 3, ack: 5, packet: p };
    out.push(show("`INTENT` (client to server)", d, [...header("0x02 INTENT", d), [2, "match", "3"], [2, "tick", "1"], [1, "kind", "1 `MOVE`"], [1, "dir", "1 E"], [2, "item", "0, unused for `MOVE`"]], "Your move for tick 1. `ack` 5 tells the server the newest datagram you have seen; when it is a keyframe's seq, the server knows you hold that keyframe and builds deltas on it."));
  }
  {
    const p: Packet = { type: "INTENT", match: 3, tick: 93, intent: { kind: 5, dir: 0, item: 0 } };
    const d: Datagram = { session: SESSION, seq: 97, ack: 140, packet: p };
    out.push(show("`INTENT` with `SNATCH` (client to server)", d, [...header("0x02 INTENT", d), [2, "match", "3"], [2, "tick", "93"], [1, "kind", "5 `SNATCH`"], [1, "dir", "0, unused"], [2, "item", "0, unused"]], "A snatch is two ticks. This is the wind-up: if Maria is on your tile or next to it after this tick's moves and you have at least `snatch_cost` energy, you pay it and you both get a `winding_up` event. Otherwise it does nothing and costs nothing. The grab happens on the next tick, after you both move: if she is still on your tile or next to it, one of her items (chosen by seed) moves to you, if she holds any and you have a free slot. You send nothing extra for the grab, and you can move on that tick."));
  }
  return out.join("\n");
}

if (process.argv[1]?.endsWith("wire-examples.ts")) console.log(wireExamples());
