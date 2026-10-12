import { describe, expect, it } from "vitest";
import { RULESET_VERSION } from "../src/index.js";

describe("engine scaffold", () => {
  it("exports a ruleset version", () => {
    expect(RULESET_VERSION).toBe("bm-6.2");
  });
});
