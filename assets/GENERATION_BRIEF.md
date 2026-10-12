# BLACK MARIA — Asset Manifest and Generation Brief

This file is a brief for Codex. It lists every image the game needs, with a filename, a size, and a prompt for an image model. Generate into `assets/` with exactly these filenames. The game loads art by these names through `assets/manifest.json` and falls back to placeholders for anything missing, so partial delivery is fine and nothing blocks on art.

## Instructions for Codex

1. Read the art direction below. Every generated image is judged against the reject list before it is saved.
2. Generate `_stylesheet.png` first. Stop and show it. Do not proceed until it is approved.
3. For every row in sections 1 to 10: compose the prompt as `STYLE + ROW PROMPT + SUFFIX`, generate at the listed size, and save to `assets/<file>`. Verify alpha for sprites, decals, and UI. Verify seamlessness for tiles by tiling 3×3. Check the reject list. Regenerate on failure up to 3 times, then log it in `assets/FAILED.md` and move on.
4. After each section, write downscaled copies of tiles, sprites, and decals to `assets/128/<file>` and `assets/64/<file>` with a high-quality filter. Never upscale. Look at the 64 px version: if the silhouette is mud, regenerate with less detail.
5. **Pixel pass.** For every tile, sprite, and decal, also write `assets/px/<file>`: box-downscale to 64×64 (tiles) or 64×64 (sprites, preserving the frame), quantize every pixel to the nearest color in the palette table below plus transparent, then save at 64×64. Also write a 4× nearest-neighbor preview to `assets/px/preview/<file>` so a human can judge it. The game can switch to this set with one flag.
6. Update `assets/manifest.json` after each file lands:
   ```json
   {"tile_floor_hall": {"file": "tile_floor_hall.png", "px": "px/tile_floor_hall.png", "kind": "tile", "size": [1024, 1024], "anchor": [0, 0]}}
   ```
   `kind` is `tile | wall | sprite | decal | ui | portrait | art`. Sprites anchor at `[0.5, 0.85]` so their feet sit on the tile. Everything else anchors at `[0, 0]`.
7. Keep `assets/REPORT.md`: one line per asset, pass or fail, and a thumbnail path.

---

## Art direction

One sentence: Saturday-morning retro. Flat cartoon with thick ink outlines, a small saturated 70s palette, risograph grain, and shapes that are a little silly and a little strange. In the spirit of EarthBound and Mother 3 for the deadpan weirdness, Katamari Damacy and Untitled Goose Game for the silliness, Chicory and A Short Hike for the warmth. Not gothic. Not dark. Not realistic. Not generic-cute.

### Palette (use these and nothing else)

| name | hex | use |
|---|---|---|
| cream | `#F6E7C8` | paper, backgrounds, light fills |
| cocoa | `#4A2C2A` | every outline, dark fills, text |
| teal | `#2A9D8F` | walls, water, cool surfaces |
| mustard | `#E9B44C` | the candidate, the society, warm highlights |
| coral | `#F07167` | accents, alerts, fun |
| moss | `#7FB069` | plants, rugs, soft surfaces |
| lilac | `#B8A1E3` | Maria, and nothing else |

No black. Outlines are cocoa. No gradients anywhere. Shading, when needed, is one flat darker tone or a dot/hatch pattern.

### STYLE (prepend to every prompt)

> Flat cartoon illustration for a whimsical retro video game. Thick cocoa-brown ink outlines, flat fills, slightly wobbly hand-drawn lines, risograph print texture with colors a little off-register. Limited palette: cream, cocoa brown, teal, mustard yellow, coral, moss green, lilac. Silly, warm, friendly, a little strange. In the spirit of EarthBound, Katamari Damacy, Chicory, and Untitled Goose Game. Not realistic, not 3D rendered, not painterly, not gothic, not dark, no gradients, no text, no watermark, no border.

### Suffixes

- **SPRITE:** `Single object, centered, 3/4 top-down view as in a 16-bit adventure game, isolated on a fully transparent background, PNG with alpha, no cast shadow.`
- **DECAL:** `Flat floor decal seen from directly above, isolated on a fully transparent background, PNG with alpha.`
- **TILE:** `Seamlessly tileable square texture seen from directly above, edges wrap perfectly, no visible seam, quiet and low-contrast so objects read on top of it.`
- **WALL:** `Square wall block for a 3/4 top-down view: a flat top cap in the upper third, a front face below it, tileable left to right, hard horizontal edges, no transparency.`
- **UI:** `Interface element with a thick cocoa outline and flat fill, isolated on a fully transparent background, PNG with alpha, rounded, friendly.`
- **PORTRAIT:** `Character portrait, head and shoulders, flat cartoon, thick outlines, cream background, square.`
- **ART:** `Wide flat cartoon illustration, big simple shapes, risograph grain, lots of cream space.`

### Reject list (regenerate if any of these appear)

- Dark, moody, gothic, or horror tone
- Realistic rendering, 3D look, gradients, soft shading, glossy highlights
- Generic mascot cute: big sparkly anime eyes, blush marks, pastel kawaii
- Any hue outside the palette, including pure black or pure white
- Thin or clean vector lines. Lines must look hand-drawn and a little wobbly
- Detail so busy the silhouette turns to mud at 64 px
- Anything that reads as text or letters
- Cast shadows baked under sprites

### Consistency rules

1. Reference `_stylesheet.png` in every later prompt: "match the style of the attached reference sheet exactly."
2. All sprites share one scale: a fixture fills about 80% of the frame, an item about 40%, the Vessel about 70%.
3. The Vessel is one character in one pose. Aura, tint, facing, and blackout are done in code. No glow baked in.
4. Maria is a wobbly lilac ghost blob with a one-toothed grin and two stubby arms. Same shape in all three portraits, more mischievous each time.
5. Mustard is for the candidate and the society. Lilac is only for Maria.
6. The society mark is a spade, drawn chubby and friendly with a rounded point and a short stem. It appears in the logo, the sigil decal, the Hall floor, the key, and the coin. Keep its silhouette identical.

---

## 0. Style sheet

| file | size | prompt |
|---|---|---|
| `_stylesheet.png` | 2048×2048 | Reference sheet on a cream background showing, in a loose grid: a mustard herringbone floor square, a teal plaster wall block with top cap and front face, a round potato-shaped little fellow with two dot eyes and a tiny coral scarf in 3/4 top-down view, a wobbly lilac ghost blob with a one-toothed grin, a chubby brass key with a spade-shaped bow, a folded cream letter with a coral wax seal, a crooked little stone fireplace in 3/4 view with three coral flame marks, a round stone well with a bucket, and a chubby friendly spade shape in cocoa with a mustard outline. All in one consistent flat cartoon style with thick cocoa outlines and risograph grain. |

## 1. Floor tiles (TILE suffix, 1024×1024)

Quiet. Low contrast. These sit under everything.

| file | prompt |
|---|---|
| `tile_floor_corridor.png` | Cream flagstones with wobbly cocoa joints, a few flat teal stones mixed in. |
| `tile_floor_hall.png` | Cream and mustard checkerboard, slightly crooked squares, cocoa joints. |
| `tile_floor_hall_mark.png` | Same checkerboard with a big chubby cocoa spade painted at center with a mustard outline. Hall center tile only. |
| `tile_floor_library.png` | Mustard herringbone parquet with cocoa seams. |
| `tile_floor_study.png` | Wide cocoa-outlined planks in a lighter cocoa tone, wobbly grain lines. |
| `tile_floor_chapel.png` | Pale cream stone slabs with cocoa joints, a few flat moss specks. |
| `tile_floor_cellar.png` | Teal-grey bricks in a wobbly pattern, cocoa mortar. |
| `tile_floor_kitchen.png` | Small cream and coral tiles in a checker, some crooked. |
| `tile_floor_conservatory.png` | Moss and cream geometric tiles, a little mustard star in the pattern. |
| `tile_floor_gallery.png` | Flat teal floor with a thin mustard border pattern. |
| `tile_floor_nursery.png` | Cream floorboards with scattered flat coral and teal polka dots. |
| `tile_floor_vault.png` | Cocoa metal plates with mustard rivets. |

## 2. Walls and doors

| file | size | suffix | prompt |
|---|---|---|---|
| `wall_plaster.png` | 1024×1024 | WALL | Teal plaster wall with a cocoa top cap, a few wobbly cracks, a tiny framed picture of a flat shape on the face. |
| `wall_stone.png` | 1024×1024 | WALL | Chunky cocoa-outlined stone wall in teal-grey with a cocoa top cap. For chapel, cellar, vault. |
| `door_open.png` | 1024×1024 | SPRITE | A friendly open doorway with a rounded arch, a cocoa frame, empty passage between, transparent outside the frame. |
| `door_locked.png` | 1024×1024 | SPRITE | A chubby cocoa door with a rounded top, a big mustard keyhole plate, a coral padlock hanging from it. Transparent outside the door. |

## 3. Hidden tiles (DECAL suffix, 1024×1024)

These render honestly. Their meaning is what the game hides. They must look like decor, not like power-ups.

| file | prompt |
|---|---|
| `decal_sigil.png` | A chubby cocoa spade painted on the floor like a hopscotch mark, slightly scuffed. Same silhouette as the logo. Code tints it when held. |
| `decal_threshold.png` | A striped coral and cream doormat, slightly crooked, with fringe. |
| `decal_rug.png` | A round braided rug in moss and mustard rings. |

## 4. Fixtures (SPRITE suffix, 1024×1024, ~80% of frame)

| file | prompt |
|---|---|
| `fixture_fireplace.png` | A crooked little stone fireplace with three flat coral flame marks and a mustard mantel. |
| `fixture_well.png` | A round stone well with a wobbly wooden roof and a bucket, flat teal water inside. |
| `fixture_safe_closed.png` | A squat cocoa safe with a big mustard dial and two little feet, closed. |
| `fixture_safe_open.png` | The same safe with its door swung open, flat cream interior. |
| `fixture_altar.png` | A small stone table with two tall candles with coral flames and a moss cloth. |
| `fixture_piano.png` | A chubby upright piano in cocoa with cream keys, lid open, one note drawn as a flat shape above it. |
| `fixture_mirror.png` | A tall oval mirror on a stand with a mustard frame, flat teal glass. |
| `fixture_bookcase.png` | A leaning bookcase stuffed with flat coral, teal, and mustard books. |
| `fixture_bed.png` | A small bed with a moss blanket and a cream pillow, feet poking out from under the covers. |
| `fixture_clock.png` | A tall grandfather clock in cocoa with a round cream face and two dot eyes on the face. |
| `fixture_font.png` | A round stone birdbath on a pedestal with flat teal water and a tiny flat duck. |
| `fixture_stove.png` | A chubby cream stove with coral burners and a tall crooked stovepipe. |

## 5. Items (SPRITE suffix, 1024×1024, ~40% of frame)

| file | prompt |
|---|---|
| `item_key.png` | A chubby brass key with a spade-shaped bow. |
| `item_letter.png` | A folded cream letter with a coral wax seal. |
| `item_candle.png` | A short cream candle in a mustard holder with a coral flame. |
| `item_locket.png` | A round mustard locket on a short chain, closed, with a tiny heart dent. |
| `item_ledger.png` | A fat cocoa book with a mustard clasp. |
| `item_bottle.png` | A round teal bottle with a cork. |
| `item_coin.png` | A big mustard coin stamped with a chubby spade. |
| `item_ring.png` | A mustard ring with a big round coral stone. |
| `item_photograph.png` | A small photo with a cream border showing a flat silhouette of two round figures. |
| `item_vial.png` | A tiny round vial of lilac liquid with a cork. |

## 6. The Vessel (SPRITE suffix, 1024×1024, ~70% of frame)

| file | prompt |
|---|---|
| `vessel.png` | A round potato-shaped little fellow in cream with two cocoa dot eyes, no mouth, stubby legs, tiny arms at the sides, a small coral scarf, standing still, facing the viewer. No mustard, no lilac, no glow. |

Facing, aura, tint, and blackout are applied in code.

## 7. Effects

Radial auras, the blackout vignette, and pull arrows are drawn in code. Only hand-drawn effect sprites are generated.

| file | size | suffix | prompt |
|---|---|---|---|
| `fx_shudder.png` | 1024×1024 | SPRITE | A wobbly cocoa ring of short jagged strokes, like a cartoon vibration, on transparent. |
| `fx_held_ring.png` | 1024×1024 | DECAL | Two chubby concentric cream rings with four little spade marks at the compass points, on transparent. Code tints it mustard or lilac. |
| `fx_accord.png` | 512×512 | SPRITE | Two wobbly cream ribbons twisting around each other upward, on transparent. |
| `fx_touch.png` | 1024×1024 | SPRITE | A cartoon burst of cream and coral stars and dots radiating from a center, on transparent. |
| `fx_puff.png` | 256×256 | SPRITE | A single small round cream puff of cartoon smoke, on transparent. Used for ambient particles and footsteps. |

## 8. UI (UI suffix unless noted)

| file | size | prompt |
|---|---|---|
| `ui_logo_spade.png` | 1024×1024 | A chubby friendly cocoa spade with a thick mustard outline. Peeking out from behind it, a lilac ghost blob with one eye visible. |
| `ui_frame_corner.png` | 512×512 | A rounded cocoa corner bracket with a tiny spade at the tip. Mirrored in code. |
| `ui_divider.png` | 2048×128 | A wobbly horizontal cocoa line with a chubby spade at center. |
| `ui_panel_dark.png` | 1024×1024, TILE | Cream paper texture with faint risograph grain, very low contrast. |
| `ui_note.png` | 1024×512 | A cream index card with a cocoa outline, a coral paperclip at the top corner, no writing. For objective cards. |
| `ui_note_done.png` | 1024×512 | The same card with a big mustard check mark drawn over it. |
| `ui_button.png` | 1024×256 | A rounded cream pill with a thick cocoa outline and a hard cocoa offset shadow below-right. |
| `ui_button_hover.png` | 1024×256 | The same pill filled mustard. |
| `ui_meter_frame.png` | 2048×256 | A long rounded cream bar with a cocoa outline and an empty channel, a tiny spade at each end. For the will meter. |
| `ui_portrait_frame.png` | 512×512 | A round cream frame with a cocoa outline and a little coral bow on top. |
| `ui_laurel.png` | 1024×1024 | A moss laurel wreath drawn chubby, with a coral ribbon at the bottom. |
| `ui_rank_1.png` | 256×256 | A chubby mustard spade. |
| `ui_rank_2.png` | 256×256 | The same spade in cream. |
| `ui_rank_3.png` | 256×256 | The same spade in coral. |
| `ui_icon_reach.png` | 256×256 | Thick cocoa line icon of a rounded doorway. |
| `ui_icon_linger.png` | 256×256 | Thick cocoa line icon of an hourglass. |
| `ui_icon_take.png` | 256×256 | Thick cocoa line icon of an open hand. |
| `ui_icon_keep.png` | 256×256 | Thick cocoa line icon of a closed hand. |
| `ui_icon_deliver.png` | 256×256 | Thick cocoa line icon of a hand placing a small object down. |
| `ui_icon_end.png` | 256×256 | Thick cocoa line icon of a flag. |
| `ui_icon_will.png` | 256×256 | Thick cocoa line icon of a flexing arm. |
| `ui_icon_wait.png` | 256×256 | Thick cocoa line icon of two vertical bars. |
| `ui_icon_use.png` | 256×256 | Thick cocoa line icon of a key. |
| `ui_icon_drop.png` | 256×256 | Thick cocoa line icon of a downward arrow into a dish. |

## 9. Portraits (PORTRAIT suffix, 1024×1024)

| file | prompt |
|---|---|
| `portrait_maria_novice.png` | A wobbly lilac ghost blob with two dot eyes and a small one-toothed grin, two stubby arms, looking a little sleepy. |
| `portrait_maria_adept.png` | The same ghost, eyes narrowed, grin wider, one arm raised like it has an idea. |
| `portrait_maria_master.png` | The same ghost, eyes very narrow, huge grin, both arms rubbing together, a tiny coral top hat. |
| `portrait_you.png` | The round cream potato fellow with the coral scarf, looking straight ahead, mildly concerned. |

## 10. Key art (ART suffix)

| file | size | prompt |
|---|---|---|
| `art_title.png` | 2560×1440 | A crooked cartoon house at dusk on a mustard hill, one window lit coral, a lilac ghost blob peeking out of the chimney, big teal sky with flat cream stars. |
| `art_arena_bg.png` | 2560×1440 | Flat cream with faint risograph grain and a few scattered flat teal and mustard shapes, almost nothing, to sit behind the game map. |
| `art_victory.png` | 2560×1440 | The round cream fellow standing in a doorway doing a little jump, arms up, confetti of flat coral and mustard shapes. |
| `art_defeat.png` | 2560×1440 | The round cream fellow sitting on the floor of the hall looking at the viewer, the lilac ghost floating above with a huge grin. |
| `art_email_banner.png` | 1200×400 | A chubby cocoa spade with a mustard outline on cream, a lilac ghost peeking from behind it. Nothing else. |

---

## Final checklist

- [ ] `_stylesheet.png` approved before anything else
- [ ] 12 floor tiles, each verified seamless and quiet
- [ ] 2 walls, 2 doors
- [ ] 3 decals that look like decor
- [ ] 12 fixtures, consistent scale, silhouettes readable at 64 px
- [ ] 10 items
- [ ] 1 Vessel, no glow, no color accents beyond the scarf
- [ ] 5 effect sprites
- [ ] 24 UI pieces
- [ ] 4 portraits, same ghost
- [ ] 5 key art
- [ ] Every file passed the reject list
- [ ] `assets/128/`, `assets/64/`, and `assets/px/` written
- [ ] `assets/manifest.json` complete with `px` paths
- [ ] `assets/REPORT.md` and `assets/FAILED.md` written
