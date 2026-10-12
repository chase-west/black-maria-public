# BLACK MARIA — Site and Game Chrome Assets

A brief for Codex. These are the images the portal needs beyond the map art in `ASSETS.md` and `ASSETS_MAP.md`. Same art direction, same palette, same STYLE prefix and reject list from `ASSETS.md`. Generate into `assets/` with these exact filenames and update `assets/manifest.json`. Icons also get `assets/64/` copies. Anything missing falls back to a placeholder, so partial delivery is fine.

Suffixes: **ICON** = `Minimal line icon, thick cocoa strokes, flat fill where stated, isolated on a fully transparent background, PNG with alpha, readable at 24 px.` **SPRITE**, **UI**, **ART** as in `ASSETS.md`.

## 1. Characters (SPRITE, 1024×1024)

| file | prompt |
|---|---|
| `maria_ghost.png` | The wobbly lilac ghost blob, full body, two dot eyes, one-toothed grin, two stubby arms out to the sides, wavy bottom edge, facing the viewer, slightly transparent lilac fill with a cocoa outline. No glow. |
| `maria_ghost_grab.png` | The same ghost lunging forward, both arms reaching, grin wide. Used for the snatch animation. |
| `you_grab.png` | The cream potato fellow lunging forward, both stubby arms reaching, scarf flying. Used for the snatch animation. |
| `you_sad.png` | The cream fellow with dot eyes turned down and the scarf drooping. Used when an errand is lost or expires. |
| `you_happy.png` | The cream fellow doing a small jump, arms up. Used when an errand completes. |

## 2. Errand and game icons (ICON, 256×256)

| file | prompt |
|---|---|
| `icon_deliver.png` | A hand placing a small box down. |
| `icon_visit.png` | A rounded doorway with a footprint in front of it. |
| `icon_carry.png` | Two hands holding a small box close. |
| `icon_expiry.png` | An hourglass, sand mostly in the bottom. |
| `icon_value.png` | A small stack of three coins. |
| `icon_energy.png` | A flexing arm. |
| `icon_snatch.png` | A grabbing hand with motion lines. |
| `icon_sigil.png` | A small chubby spade. |
| `icon_you.png` | The cream fellow's face, just the round head and dot eyes. |
| `icon_maria.png` | The ghost's face, round with the one-toothed grin. |

## 3. Profiler icons (ICON, 256×256, flat mustard fill where stated)

| file | prompt |
|---|---|
| `icon_done.png` | A chubby check mark, mustard fill. |
| `icon_taken.png` | The ghost's face holding a small box, lilac fill. |
| `icon_expired.png` | An hourglass with a crack and the sand spilled. |
| `icon_untouched.png` | A closed eye. |
| `icon_idle.png` | Three Z letters floating, drawn as shapes. |
| `icon_network.png` | A cable with a gap in the middle and two little sparks. |
| `icon_unused.png` | A battery mostly full with a question mark. |

## 4. Start Here step icons (ICON, 256×256)

| file | prompt |
|---|---|
| `icon_step_read.png` | An open book. |
| `icon_step_run.png` | A play triangle inside a rounded square. |
| `icon_step_build.png` | A wrench crossed with a pencil. |
| `icon_step_change.png` | A bell with motion lines. |
| `icon_step_adapt.png` | Two arrows in a loop. |
| `icon_step_official.png` | A flag on a pole. |
| `icon_step_submit.png` | An envelope with a small spade seal. |

## 5. Tier badges (UI, 512×512)

| file | prompt |
|---|---|
| `badge_novice.png` | A round cream badge with a cocoa outline, a single small spade in the center. |
| `badge_adept.png` | The same badge in mustard with two spades. |
| `badge_master.png` | The same badge in lilac with three spades and a tiny coral top hat on the middle one. |

## 6. Site chrome

| file | size | suffix | prompt |
|---|---|---|---|
| `favicon.png` | 512×512 | UI | A chubby cocoa spade with a thick mustard outline on a cream circle. Must read at 16 px. |
| `og_image.png` | 1200×630 | ART | The crooked cartoon house at dusk on a mustard hill, the cream fellow and the lilac ghost standing side by side in front of it, a big spade in the sky where the moon would be. Cream border. No text. |
| `footer_strip.png` | 2048×256 | ART | A flat silhouette strip of the house's roofline and chimneys in cocoa on transparent, the ghost peeking from one chimney, for the bottom of every page. |
| `art_empty_matches.png` | 1024×768 | ART | The cream fellow sitting on an upturned crate in an empty room, looking at the viewer, one flat coral flower in a vase beside him. For "no matches yet." |
| `art_locked.png` | 1024×768 | ART | A chubby cocoa door with a big mustard padlock and a small clock face above it, the ghost waiting beside it with arms crossed. For the official page before minute 60. |
| `art_change.png` | 1024×768 | ART | The ghost ringing a large coral bell, the cream fellow covering his ears, a few flat shapes flying. For the minute-60 announcement. |
| `art_expired.png` | 1024×768 | ART | The house at night with every window dark, the ghost asleep on the roof. For "the clock has ended." |
| `art_404.png` | 1024×768 | ART | The cream fellow standing in a doorway that opens onto flat cream nothing, scratching his head. |
| `art_submitted.png` | 1024×768 | ART | The cream fellow and the ghost sitting together on the front step of the house, both waving. For the submission confirmation. |
| `email_footer.png` | 1200×120 | ART | A thin cocoa roofline silhouette with one chubby spade at center, on cream. |

## Checklist

- [ ] 5 character sprites, same scale as `vessel.png`
- [ ] 10 errand and game icons
- [ ] 7 profiler icons
- [ ] 7 step icons
- [ ] 3 badges
- [ ] 10 site chrome pieces, `favicon.png` checked at 16 px
- [ ] `assets/64/` for every icon
- [ ] `assets/manifest.json` and `assets/REPORT.md` updated
