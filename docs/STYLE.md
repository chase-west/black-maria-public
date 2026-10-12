# Style

The visual language for every screen. Carried over verbatim from v2 SPEC 8.3. `ASSETS.md` lists every image.

`ASSETS.md` is the source of truth for the visual language. The web app follows it as strictly as the art does. The one-line brief: Saturday-morning retro. Flat, thick-outlined, a little silly, a little strange. Not gothic, not dark, not corporate.

- **Palette.** Only the seven colors in `ASSETS.md`: cream, cocoa, teal, mustard, coral, moss, lilac. Define them once as CSS variables and PixiJS constants. No other color appears anywhere, including focus rings, links, and error states. No pure black, no pure white. Errors are coral. Success is mustard. Maria is lilac and nothing else is.
- **Typography.** Display: Fraunces at weight 900 with the soft optical size and high wonk, for titles only. Body: Nunito at 17px or larger. Objective notes and the rules doc: Space Mono, for the typewriter-index-card feel. All from Google Fonts. No system sans anywhere.
- **Layout.** Cream paper is the main material. Every panel, button, and card has a thick 3px cocoa outline, 12px rounded corners, and a hard cocoa offset shadow at 4px right and 4px down. No soft shadows, no gradients, no glassmorphism, no emoji, no stock icon sets. Ornament comes only from the `ui_*` assets. Things may be slightly crooked on purpose: rotate cards by a random −1.5° to 1.5° on mount.
- **Motion.** Bouncy and quick. Overshoot easing on entrances, 200ms to 400ms. Squash and stretch on the Vessel when it moves. Buttons press down into their shadow on click. Ambient `fx_puff` particles appear at the Vessel's feet on each step. The loading indicator is the Vessel bouncing in place.
- **Post-process.** Risograph grain overlay at 3% opacity on the arena canvas (per SPEC 8.1, after the first pass read as noise) and 6% on key art. On the title screen only, a 1px off-register shift of the coral channel. No bloom, no scanlines, no vignette except during blackout.
- **The Vessel.** Code applies a 2-frame idle bob, flips the sprite horizontally for facing, and squashes it on each step. When Maria wins a tick, the sprite tints 20% toward lilac for 200ms; when the candidate wins, toward mustard.
- **Sound.** Out of scope for v1, but leave a hook: an event bus the renderer already emits for `contest`, `accord`, `shudder`, `held`, `blackout`, `touch`, and each step.

