# BLACK MARIA — Decoration and Motion Assets

A brief for Codex. Same art direction, palette, STYLE prefix, suffixes, and reject list as `ASSETS.md`. Generate into `assets/` with these exact filenames, update `assets/manifest.json`, write `assets/64/` copies for sprites, and run `python3 scripts/assets-missing.py` at the end to confirm zero missing. Reference `_stylesheet.png`, `vessel.png`, and `maria_ghost.png` in every prompt that shows a character.

## 1. Hero parallax (SPRITE suffix unless noted)

| file | size | prompt |
|---|---|---|
| `sky_moon.png` | 512×512 | A chubby cream crescent moon with a small sleepy face, cocoa outline. |
| `sky_star.png` | 128×128 | A single four-point cream star, cocoa outline. |
| `sky_cloud_a.png` | 1024×512 | A soft lumpy cream cloud, cocoa outline, flat. |
| `sky_cloud_b.png` | 1024×512 | A different lumpy cream cloud, longer and thinner. |
| `sky_cloud_c.png` | 512×256 | A small round cream cloud. |

## 2. Footer scene (SPRITE)

| file | size | prompt |
|---|---|---|
| `scene_tree.png` | 1024×1024 | A round moss tree on a short cocoa trunk, a few flat coral fruits. |
| `scene_bush_a.png` | 512×512 | A low round moss bush. |
| `scene_bush_b.png` | 512×512 | A low moss bush with one flat coral flower. |
| `scene_fence.png` | 2048×256 | A wobbly cocoa picket fence, tileable left to right. |
| `scene_hill.png` | 2048×512 | A smooth mustard hill silhouette, tileable left to right, flat. |
| `scene_lamp.png` | 512×1024 | A tall cocoa lamp post with a mustard glowing lamp, no bloom. |

## 3. Character motion (SPRITE, 1024×1024 each)

| file | prompt |
|---|---|
| `you_walk_1.png` through `you_walk_6.png` | The cream fellow walking in place, six frames of one cycle, left foot forward through right foot forward, scarf swinging. Each frame a separate file with the same framing and scale as `vessel.png`. |
| `maria_wave.png` | The ghost waving one stubby arm, grinning. |
| `maria_sleep.png` | The ghost with closed eyes and a small cream Z shape above it. |
| `maria_shock.png` | The ghost with wide round eyes and an open mouth, arms up. |
| `maria_smug.png` | The ghost with half-closed eyes and a lopsided grin, arms crossed. |

## 4. Bits (SPRITE)

| file | size | prompt |
|---|---|---|
| `confetti_a.png` | 128×128 | A flat coral rectangle, slightly rotated. |
| `confetti_b.png` | 128×128 | A flat mustard circle. |
| `confetti_c.png` | 128×128 | A flat teal triangle. |
| `confetti_d.png` | 128×128 | A flat lilac squiggle. |
| `cursor_spade.png` | 128×128 | A small chubby cocoa spade with a mustard outline, pointing up-left, for a custom cursor. |
| `cursor_hand.png` | 128×128 | A small cream pointing hand with a cocoa outline, for hover. |
| `ornament_header.png` | 1024×128 | A short horizontal flourish: two curls of cocoa line with a tiny spade at the center. |
| `sticker_new.png` | 256×256 | A coral starburst sticker shape with a cocoa outline, no text. |
