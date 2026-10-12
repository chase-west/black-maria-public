import { describe, expect, it } from "vitest";
import { RULE_CHANGES, RULE_CHANGE_IDS } from "../src/index.js";

/** The change's words follow the copy rules of SPEC 8.5: plain words, short sentences, no exclamation marks. */
describe("the change texts", () => {
  for (const id of RULE_CHANGE_IDS) {
    const t = RULE_CHANGES[id];
    it(`change ${id} is in plain words`, () => {
      expect(t.id).toBe(id);
      for (const text of [t.rule, t.meaning]) {
        expect(text).not.toMatch(/datagram|blackhole|chaos|!/i);
        expect(text.endsWith(".")).toBe(true);
        for (const sentence of text.split(/\.\s+/)) expect(sentence.split(/\s+/).length).toBeLessThanOrEqual(22);
      }
      // The flags are the simulator's own, so the Official page can say exactly how to play it first.
      expect(t.flags).toMatch(/^(--[a-z-]+ [\w:]+ ?)+$/);
    });
  }
});
