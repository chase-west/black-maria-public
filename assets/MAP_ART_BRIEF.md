# BLACK MARIA — Map Art Pass

A brief for Codex. This pass replaces the floor, wall, and door art, upgrades the five large fixtures, and adds a set of decor props. Every other asset from `ASSETS.md` stays as it is. Read the art direction and palette in `ASSETS.md` first; the STYLE prefix and the reject list there still apply to every prompt here.

Why: in-game, the first floor tiles turned into noise when repeated hundreds of times, the walls were flat dark slabs, and the rooms had nothing in them but one small fixture. Good top-down interiors are mostly calm flat color, walls that have height, big furniture, and a few props that make a room feel lived in.

## Instructions for Codex

1. Overwrite files in place in `assets/` using the exact filenames below. New filenames are marked NEW. Update `assets/manifest.json`, and write `assets/128/`, `assets/64/`, and `assets/px/` copies as before.
2. **Floor flatness check, mandatory.** After generating each floor tile, compute the brightness range: convert to grayscale, take the 2nd and 98th percentile pixel values, and require the difference to be at most 10% of full scale (26 on 0–255). If it fails, regenerate with the flatness line repeated twice in the prompt. Log the measured range per tile in `assets/REPORT.md`.
3. **Seamlessness check** for floors and wall faces: tile 3×3, inspect for seams, regenerate on failure.
4. **Silhouette check** for fixtures and props: downscale to 64 px and confirm the object is still recognizable. If not, regenerate with less detail.
5. Nothing in this pass has a baked shadow. Shadows are drawn in code.

## Suffixes used here

- **TILE:** `Seamlessly tileable square texture seen from directly above, edges wrap perfectly, no visible seam.`
- **FLAT:** `Extremely low contrast, almost flat, the pattern is barely visible, no dark outlines, no cocoa lines, reads as one color from a distance.`
- **STRIP:** `Horizontal strip, tileable left to right only, hard top and bottom edges, no transparency.`
- **SPRITE:** `Single object, centered, 3/4 top-down view as in a 16-bit adventure game, isolated on a fully transparent background, PNG with alpha, no cast shadow.`

---

## 1. Floors (TILE + FLAT, 1024×1024, overwrite)

Each is one palette color with a whisper of texture. Name the base color in the prompt so the flat fill and the tile agree.

| file | prompt |
|---|---|
| `tile_floor_corridor.png` | Flat cream stone floor, a faint suggestion of large flagstones in a slightly deeper cream, almost invisible joints. |
| `tile_floor_hall.png` | Flat cream floor with a very faint large checkerboard in a cream one shade deeper. |
| `tile_floor_hall_mark.png` | The same faint cream checkerboard with a big chubby cocoa spade painted at center with a mustard outline. This is the only floor tile allowed a dark element. |
| `tile_floor_library.png` | Flat light mustard floor with a faint herringbone suggested in a mustard one shade deeper. |
| `tile_floor_study.png` | Flat light cocoa-tan floor with faint wide plank lines in a tan one shade deeper. |
| `tile_floor_chapel.png` | Flat pale cream-grey stone with faint large slab joints one shade deeper. |
| `tile_floor_cellar.png` | Flat deep teal floor with a faint brick pattern in a teal one shade deeper. |
| `tile_floor_kitchen.png` | Flat warm cream floor with a faint small tile grid one shade deeper. |
| `tile_floor_conservatory.png` | Flat light moss floor with a faint geometric tile pattern one shade deeper. |
| `tile_floor_gallery.png` | Flat mid teal floor with a faint thin border pattern one shade lighter. |
| `tile_floor_nursery.png` | Flat pale cream floor with faint floorboards one shade deeper and a few barely visible coral dots. |
| `tile_floor_vault.png` | Flat dark cocoa-grey metal floor with faint plate seams one shade lighter. |

## 2. Walls (overwrite, plus NEW)

Walls are now two pieces each: a cap (the top of the wall, seen from above) and a face (the front of the wall, seen from the 3/4 angle). The renderer draws the cap on every wall tile and the face on walls that have floor to their south.

| file | size | suffix | prompt |
|---|---|---|---|
| `wall_cap_plaster.png` NEW | 1024×1024 | TILE | Flat cocoa-brown wall top seen from directly above with a faint lighter cocoa highlight line along the top edge, almost no texture. |
| `wall_face_plaster.png` NEW | 1024×512 | STRIP | Front face of a plaster wall in slate blue-grey with a few faint wobbly cocoa cracks, a thin cocoa baseboard line along the bottom, flat fill. |
| `wall_cap_stone.png` NEW | 1024×1024 | TILE | Flat cocoa-brown wall top seen from directly above with a faint lighter line along the top edge, a hint of large stone blocks. |
| `wall_face_stone.png` NEW | 1024×512 | STRIP | Front face of a chunky stone wall in slate with cocoa mortar lines drawn wobbly, flat fill, a thin cocoa baseboard along the bottom. |
| `wall_plaster.png` | | | Delete. Replaced by the cap and face pair. |
| `wall_stone.png` | | | Delete. Replaced by the cap and face pair. |

## 3. Doorways (overwrite)

| file | size | suffix | prompt |
|---|---|---|---|
| `door_open.png` | 1024×1024 | SPRITE | A rounded doorway frame in cocoa with a cream inner edge, drawn as two tall posts and an arched lintel with nothing between them, sized to sit in a one-tile gap in a wall. |
| `door_locked.png` | 1024×1024 | SPRITE | The same frame with a chubby cocoa door filling it, a big mustard keyhole plate, and a coral padlock. |

## 4. Big fixtures (overwrite, now drawn at 2×2 tiles)

These five are drawn in-game at twice the size of other fixtures. Prompt for a tall, clean silhouette filling 90% of the frame.

| file | prompt |
|---|---|
| `fixture_bed.png` | A chubby bed with a tall cocoa headboard, a moss blanket with a cream fold at the top, one cream pillow, two round feet poking out the bottom of the blanket. Fills the frame. |
| `fixture_piano.png` | A tall upright piano in cocoa, lid open, cream keys, a round stool in front, one flat coral music note floating above. Fills the frame. |
| `fixture_bookcase.png` | A tall leaning bookcase stuffed with flat coral, teal, mustard, and cream books, one book sticking out, a small plant on top. Fills the frame. |
| `fixture_fireplace.png` | A tall crooked stone fireplace with a mustard mantel, a round clock on the mantel, three flat coral flame marks in the hearth, a small log pile beside it. Fills the frame. |
| `fixture_altar.png` | A tall stone table with a moss cloth, two tall cream candles with coral flames, a small mustard bowl between them. Fills the frame. |

## 5. Decor props (NEW, SPRITE, 1024×1024, ~60% of frame)

Purely visual. The map generator scatters one to three per room on empty floor. They do not block movement. These are what make a room look lived in.

| file | prompt |
|---|---|
| `decor_plant.png` | A potted plant with big flat moss leaves in a coral pot. |
| `decor_chair.png` | A small wooden chair in cocoa with a cream cushion, slightly crooked. |
| `decor_table_small.png` | A small round side table in cocoa with a mustard cloth. |
| `decor_stool.png` | A three-legged stool in cocoa. |
| `decor_crate.png` | A wooden crate in light cocoa with a flat spade stamp. |
| `decor_barrel.png` | A chubby barrel in cocoa with two teal hoops. |
| `decor_bookstack.png` | A leaning stack of four flat books in coral, teal, mustard, and cream. |
| `decor_vase.png` | A tall round teal vase with one flat coral flower. |
| `decor_candelabra.png` | A three-arm mustard candelabra with coral flames. |
| `decor_cushion.png` | A big round floor cushion in coral with a cream button. |
| `decor_rug_small.png` | A small oval braided rug in moss and cream rings. Drawn under everything. |
| `decor_cobweb.png` | A faint cream cobweb for cellar and vault corners. |

## Checklist

- [ ] 12 floors, each under the 10% brightness range, each seamless, ranges logged
- [ ] 4 wall pieces, caps seamless, faces seamless left to right
- [ ] 2 doorways
- [ ] 5 big fixtures, silhouettes readable at 64 px
- [ ] 12 decor props
- [ ] `wall_plaster.png` and `wall_stone.png` deleted and removed from the manifest
- [ ] `assets/128/`, `assets/64/`, `assets/px/` updated
- [ ] `assets/manifest.json` and `assets/REPORT.md` updated
