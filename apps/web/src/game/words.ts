import type { Intent } from "@blackmaria/protocol";

const DIR: Record<string, string> = { N: "north", E: "east", S: "south", W: "west" };

/** A move in plain words. */
export function intentWords(i: Intent): string {
  switch (i.kind) {
    case "MOVE":
      return `go ${DIR[i.dir]}`;
    case "WAIT":
      return "wait";
    case "TAKE":
      return "take";
    case "DROP":
      return `drop ${i.item}`;
    case "USE":
      return `use ${i.item}`;
    case "SNATCH":
      return "snatch";
  }
}
