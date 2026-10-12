// Debug aid: print a generated house as ASCII. Usage: tsx --conditions=source scripts/print-map.ts <seed>
import { createMatch } from "../src/index.js";

const seed = Number(process.argv[2] ?? 1);
const s = createMatch(seed);
const ch: Record<string, string> = { wall: "#", floor: ".", door: "+", door_locked: "L", sigil: "$" };
for (let y = 0; y < s.map.h; y++) {
  let line = "";
  for (let x = 0; x < s.map.w; x++) {
    let c = ch[s.map.tiles[y]![x]!]!;
    if (s.map.start.x === x && s.map.start.y === y) c = "@";
    if (s.map.mariaStart.x === x && s.map.mariaStart.y === y) c = "M";
    if (s.fixtures.some((f) => f.pos.x === x && f.pos.y === y)) c = "F";
    if (s.items.some((i) => i.loc.at === "tile" && i.loc.pos.x === x && i.loc.pos.y === y)) c = "i";
    if (c === "." && s.map.rooms[y]![x] !== "corridor") c = s.map.rooms[y]![x]![0]!;
    line += c;
  }
  console.log(line);
}
console.log(s.map.roomList.join(","));
console.log("fixtures", s.fixtures.map((f) => `${f.id}:${f.kind}@${f.room}`).join(" "));
console.log("items", s.items.map((i) => `${i.id}:${i.kind}:${i.loc.at}`).join(" "));
console.log("sigils", JSON.stringify(s.sigils));
console.log("board", s.board.map((e) => JSON.stringify(e)).join("\n      "));
