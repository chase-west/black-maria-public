import { describe, expect, it } from "vitest";
import { COLOR_NAMES, PALETTE, PIXI_COLORS, RGB, cssVariables, nearestColor } from "../src/index.js";

describe("palette (SPEC 8.3)", () => {
  it("has exactly the seven colors", () => {
    expect(COLOR_NAMES).toEqual(["cream", "cocoa", "teal", "mustard", "coral", "moss", "lilac"]);
  });
  it("hex, pixi and rgb forms agree", () => {
    for (const n of COLOR_NAMES) {
      const hex = parseInt(PALETTE[n].slice(1), 16);
      expect(PIXI_COLORS[n]).toBe(hex);
      const [r, g, b] = RGB[n];
      expect((r << 16) | (g << 8) | b).toBe(hex);
    }
  });
  it("css variables define every color", () => {
    const css = cssVariables();
    for (const n of COLOR_NAMES) expect(css).toContain(`--${n}: ${PALETTE[n]}`);
  });
  it("nearestColor maps pure black to cocoa and white to cream", () => {
    expect(nearestColor(0, 0, 0)).toBe("cocoa");
    expect(nearestColor(255, 255, 255)).toBe("cream");
  });
});
