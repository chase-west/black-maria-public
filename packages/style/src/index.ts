export * from "./assets.js";
export * from "./site.js";
/**
 * The BLACK MARIA visual language, defined once (SPEC 8.3, ASSETS.md).
 * Seven colors. Nothing else may appear anywhere.
 */
export const PALETTE = {
  cream: "#F6E7C8",
  cocoa: "#4A2C2A",
  teal: "#2A9D8F",
  mustard: "#E9B44C",
  coral: "#F07167",
  moss: "#7FB069",
  lilac: "#B8A1E3",
} as const;

export type ColorName = keyof typeof PALETTE;
export const COLOR_NAMES = Object.keys(PALETTE) as ColorName[];

/** Palette as 0xRRGGBB numbers for PixiJS. */
export const PIXI_COLORS: Record<ColorName, number> = {
  cream: 0xf6e7c8,
  cocoa: 0x4a2c2a,
  teal: 0x2a9d8f,
  mustard: 0xe9b44c,
  coral: 0xf07167,
  moss: 0x7fb069,
  lilac: 0xb8a1e3,
};

/** Palette as RGB triples, for rasterizers and quantizers. */
export const RGB: Record<ColorName, readonly [number, number, number]> = {
  cream: [0xf6, 0xe7, 0xc8],
  cocoa: [0x4a, 0x2c, 0x2a],
  teal: [0x2a, 0x9d, 0x8f],
  mustard: [0xe9, 0xb4, 0x4c],
  coral: [0xf0, 0x71, 0x67],
  moss: [0x7f, 0xb0, 0x69],
  lilac: [0xb8, 0xa1, 0xe3],
};

/** Semantic roles. Maria is lilac and nothing else is. */
export const ROLE = {
  paper: "cream",
  ink: "cocoa",
  you: "mustard",
  maria: "lilac",
  error: "coral",
  success: "mustard",
  wall: "teal",
  soft: "moss",
} as const satisfies Record<string, ColorName>;

export const FONTS = {
  display: "'Fraunces', 'Fraunces Fallback', serif",
  body: "'Nunito', 'Nunito Fallback', serif",
  mono: "'Space Mono', 'Space Mono Fallback', monospace",
} as const;

/**
 * Size-adjusted stand-ins for the three Google fonts, used only if they have not arrived (the portal waits up to
 * 2.5 s for them before its first render): a local face scaled to the same width per line and given the same ascent
 * and descent, so text that swaps to the real face later does not reflow. Measured against the real faces in Chrome.
 */
export function fontFallbackFaces(): string {
  const face = (family: string, local: string, weight: string, size: number, ascent: number, descent: number) =>
    `@font-face { font-family: "${family}"; src: local("${local}"); font-weight: ${weight}; size-adjust: ${size}%; ascent-override: ${ascent}%; descent-override: ${descent}%; line-gap-override: 0%; }`;
  return [
    face("Fraunces Fallback", "Georgia Bold", "100 1000", 85.6, 114.5, 30.4),
    face("Nunito Fallback", "Georgia", "100 600", 102, 99, 34.6),
    face("Nunito Fallback", "Georgia Bold", "601 1000", 93, 108.6, 37.6),
    face("Space Mono Fallback", "Courier New", "100 600", 102, 109.8, 35.3),
    face("Space Mono Fallback", "Courier New Bold", "601 1000", 102, 109.8, 35.3),
  ].join("\n");
}

/** Google Fonts stylesheet: Fraunces 900 with soft optical size and high wonk, Nunito, Space Mono. */
export const GOOGLE_FONTS_HREF =
  "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght,SOFT,WONK@9..144,900,100,1&family=Nunito:wght@400;700;900&family=Space+Mono:wght@400;700&display=swap";

export const SHAPE = {
  outline: 3,
  radius: 12,
  shadowX: 4,
  shadowY: 4,
  bodySize: 17,
  grainOpacity: 0.07,
} as const;

export const MOTION = {
  /** Overshoot easing for entrances. */
  overshoot: "cubic-bezier(0.34, 1.56, 0.64, 1)",
  fast: 200,
  slow: 400,
} as const;

/** CSS custom properties for the palette and shape tokens. */
export function cssVariables(): string {
  const lines = COLOR_NAMES.map((n) => `  --${n}: ${PALETTE[n]};`);
  lines.push(
    `  --outline: ${SHAPE.outline}px;`,
    `  --radius: ${SHAPE.radius}px;`,
    `  --shadow: ${SHAPE.shadowX}px ${SHAPE.shadowY}px 0 0 ${PALETTE.cocoa};`,
    `  --font-display: ${FONTS.display};`,
    `  --font-body: ${FONTS.body};`,
    `  --font-mono: ${FONTS.mono};`,
    `  --ease-over: ${MOTION.overshoot};`,
  );
  return `:root {\n${lines.join("\n")}\n}\n`;
}

/** Nearest palette color for an RGB value (Euclidean in RGB). */
export function nearestColor(r: number, g: number, b: number): ColorName {
  let best: ColorName = "cream";
  let bestD = Infinity;
  for (const n of COLOR_NAMES) {
    const [cr, cg, cb] = RGB[n];
    const d = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2;
    if (d < bestD) {
      bestD = d;
      best = n;
    }
  }
  return best;
}
