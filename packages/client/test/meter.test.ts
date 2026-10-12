/**
 * The trace and the summary block against a recorded run (test/fixtures/master-run.json, made by
 * test/fixtures/record-run.ts): every call the transport made into its meter during a practice match on the Master
 * network profile. The TypeScript and the Python meter replay the same calls and must print the same thing.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { summaryLines, traceLine, type ConnSummary, type TickRecord } from "@blackmaria/protocol/wire";
import { Meter, findings } from "../src/index.js";

const FIXTURE = join(__dirname, "fixtures/master-run.json");
const run = JSON.parse(readFileSync(FIXTURE, "utf8")) as { calls: unknown[][]; records: TickRecord[]; summary: string[]; findings: string[] };
const hasPython = (() => {
  try {
    execFileSync("python3", ["-c", "import sys; assert sys.version_info >= (3, 9)"]);
    return true;
  } catch {
    return false;
  }
})();

function replayTs(): { records: TickRecord[]; summary: ConnSummary } {
  const records: TickRecord[] = [];
  const m = new Meter((r) => records.push(r)) as unknown as Record<string, (...a: unknown[]) => unknown>;
  let summary: ConnSummary | null = null;
  for (const [name, ...args] of run.calls) {
    const out = m[name as string]!(...args);
    if (name === "end") summary = out as ConnSummary;
  }
  return { records, summary: summary! };
}

const PY_REPLAY = `
import json, sys
sys.path.insert(0, sys.argv[1])
from meter import Meter, findings, summary_lines, trace_line
run = json.load(open(sys.argv[2]))
records = []
m = Meter(records.append)
names = {"ignoredDuplicate": "ignored_duplicate", "moveSent": "move_sent"}
summary = None
for call in run["calls"]:
    out = getattr(m, names.get(call[0], call[0]))(*call[1:])
    if call[0] == "end":
        summary = out
print(json.dumps({"records": records, "summary": summary_lines(summary), "findings": findings(summary), "trace": [trace_line(r) for r in records]}))
`;

describe("the client's measurements against a recorded Master-profile run", () => {
  it("the recorded run has the things worth measuring: losses, repeats, a late STATE, the blackout", () => {
    const names = new Set(run.calls.map((c) => c[0]));
    for (const n of ["datagram", "state", "moveSent", "pong", "end"]) expect(names).toContain(n);
    expect(run.records.some((r) => r.status === "missing")).toBe(true);
    expect(run.records.some((r) => r.status === "late")).toBe(true);
    expect(run.summary.join("\n")).toMatch(/blackout {9}\d+ ms from tick 10\d: acted on/);
  });

  it("TypeScript: the same records, the same summary block, the same findings", () => {
    const { records, summary } = replayTs();
    expect(records).toEqual(run.records);
    expect(summaryLines(summary)).toEqual(run.summary);
    expect(findings(summary)).toEqual(run.findings);
    // The block adds up: every tick is on time, late or missing, and every move that left is in a margin bucket.
    expect(summary.on_time + summary.late + summary.missing).toBe(summary.ticks);
    expect(summary.margins.reduce((a, b) => a + b, 0)).toBe(summary.ticks - summary.missing);
    expect(summary.margins[0]).toBe(summary.late);
  });

  it.skipIf(!hasPython)("Python: the same records, summary block, findings and trace lines as TypeScript", () => {
    const out = execFileSync("python3", ["-c", PY_REPLAY, join(__dirname, "../python"), FIXTURE], { encoding: "utf8" });
    const py = JSON.parse(out) as { records: TickRecord[]; summary: string[]; findings: string[]; trace: string[] };
    expect(py.records).toEqual(run.records);
    expect(py.summary).toEqual(run.summary);
    expect(py.findings).toEqual(run.findings);
    expect(py.trace).toEqual(run.records.map(traceLine));
  });
});
