import { cssVariables, fontFallbackFaces } from "@blackmaria/style";

/**
 * Installs the palette and shape tokens as CSS custom properties, defined once in @blackmaria/style, with the
 * size-adjusted fallback faces the font stacks name after each Google font.
 */
export function installTheme(): void {
  const el = document.createElement("style");
  el.dataset.bm = "tokens";
  el.textContent = `${cssVariables()}${fontFallbackFaces()}\n`;
  document.head.prepend(el);
}

/** The faces the portal draws with: each weight it uses, so none arrives after the first render and reflows text. */
const FACES = ["900 44px Fraunces", "400 17px Nunito", "700 17px Nunito", "900 17px Nunito", "400 15px 'Space Mono'", "700 15px 'Space Mono'"];

/**
 * Resolves once the three Google fonts are loaded, or after `capMs` (no network, a slow link): the first render
 * waits for it, so text is laid out once in its real face. A face that comes later swaps onto its size-adjusted
 * fallback (see fontFallbackFaces), which keeps the line lengths.
 */
export function fontsReady(capMs = 2500): Promise<void> {
  if (typeof document === "undefined" || !document.fonts) return Promise.resolve();
  const sheet = document.querySelector<HTMLLinkElement>('link[rel="stylesheet"][href*="fonts.googleapis.com"]');
  const css = new Promise<void>((resolve) => {
    if (!sheet || sheet.sheet) return resolve();
    sheet.addEventListener("load", () => resolve(), { once: true });
    sheet.addEventListener("error", () => resolve(), { once: true });
  });
  const load = css.then(() => Promise.all(FACES.map((f) => document.fonts.load(f).catch(() => [])))).then(() => undefined);
  return Promise.race([load, new Promise<void>((resolve) => setTimeout(resolve, capMs))]);
}
