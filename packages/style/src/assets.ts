/**
 * Every image the game loads, by logical name, exactly as listed in ASSETS.md, ASSETS_MAP.md and ASSETS_SITE.md, less
 * the retired names below.
 * `_stylesheet.png` is a production reference only and is not loaded by the game.
 */
export type AssetKind = "tile" | "wall" | "sprite" | "decal" | "ui" | "portrait" | "art";

export interface CatalogEntry {
  name: string;
  kind: AssetKind;
  size: [number, number];
}

const sq = (n: number): [number, number] => [n, n];
const e = (name: string, kind: AssetKind, size: [number, number]): CatalogEntry => ({ name, kind, size });

export const ROOM_NAMES = [
  "hall",
  "library",
  "study",
  "chapel",
  "cellar",
  "kitchen",
  "conservatory",
  "gallery",
  "nursery",
  "vault",
] as const;

export const FIXTURE_ASSETS = ["fireplace", "well", "safe_closed", "safe_open", "altar", "piano", "mirror", "bookcase", "bed", "clock", "font", "stove"] as const;
export const ITEM_ASSETS = ["key", "letter", "candle", "locket", "ledger", "bottle", "coin", "ring", "photograph", "vial"] as const;
/**
 * Names ASSETS.md still lists from the v2 to v5 rules (the threshold, the rug, the held ring, the shudder and the v2
 * `ui_icon_*` set). The v6 game draws none of them, so they are not in the catalog and no placeholder is made.
 */
export const RETIRED_ASSETS: readonly string[] = ["decal_threshold", "decal_rug", "fx_shudder", "fx_held_ring", ...["reach", "linger", "take", "keep", "deliver", "end", "will", "wait", "use", "drop"].map((i) => `ui_icon_${i}`)];
export const DECOR_ASSETS = ["plant", "chair", "table_small", "stool", "crate", "barrel", "bookstack", "vase", "candelabra", "cushion", "rug_small", "cobweb"] as const;
/** ASSETS_SITE.md section 2 and 3: errand, game and profiler icons. */
export const SITE_ICONS = ["deliver", "visit", "carry", "expiry", "value", "energy", "snatch", "sigil", "you", "maria", "done", "taken", "expired", "untouched", "idle", "network", "unused"] as const;
/** ASSETS_SITE.md section 4: Start Here step icons. */
export const STEP_ICONS = ["read", "run", "build", "change", "adapt", "official", "submit"] as const;

/** ASSETS_DECOR.md (v6.3): the hero sky, the footer scene, the walk cycle and Maria's faces, and the small bits. */
export const DECOR_SET: CatalogEntry[] = [
  e("sky_moon", "sprite", sq(512)),
  e("sky_star", "sprite", sq(128)),
  e("sky_cloud_a", "sprite", [1024, 512]),
  e("sky_cloud_b", "sprite", [1024, 512]),
  e("sky_cloud_c", "sprite", [512, 256]),
  e("scene_tree", "sprite", sq(1024)),
  e("scene_bush_a", "sprite", sq(512)),
  e("scene_bush_b", "sprite", sq(512)),
  e("scene_fence", "sprite", [2048, 256]),
  e("scene_hill", "sprite", [2048, 512]),
  e("scene_lamp", "sprite", [512, 1024]),
  ...[1, 2, 3, 4, 5, 6].map((i) => e(`you_walk_${i}`, "sprite", sq(1024))),
  ...["wave", "sleep", "shock", "smug"].map((f) => e(`maria_${f}`, "sprite", sq(1024))),
  ...["a", "b", "c", "d"].map((c) => e(`confetti_${c}`, "sprite", sq(128))),
  e("cursor_spade", "sprite", sq(128)),
  e("cursor_hand", "sprite", sq(128)),
  e("ornament_header", "sprite", [1024, 128]),
  e("sticker_new", "sprite", sq(256)),
];

export const CATALOG: CatalogEntry[] = [
  e("tile_floor_corridor", "tile", sq(1024)),
  ...ROOM_NAMES.filter((r) => r !== "hall").map((r) => e(`tile_floor_${r}`, "tile", sq(1024))),
  e("tile_floor_hall", "tile", sq(1024)),
  e("tile_floor_hall_mark", "tile", sq(1024)),
  e("wall_cap_plaster", "wall", sq(1024)),
  e("wall_cap_stone", "wall", sq(1024)),
  e("wall_face_plaster", "wall", [1024, 512]),
  e("wall_face_stone", "wall", [1024, 512]),
  ...DECOR_ASSETS.map((d) => e(`decor_${d}`, "sprite", sq(1024))),
  e("door_open", "sprite", sq(1024)),
  e("door_locked", "sprite", sq(1024)),
  e("decal_sigil", "decal", sq(1024)),
  ...FIXTURE_ASSETS.map((f) => e(`fixture_${f}`, "sprite", sq(1024))),
  ...ITEM_ASSETS.map((i) => e(`item_${i}`, "sprite", sq(1024))),
  e("vessel", "sprite", sq(1024)),
  e("maria_ghost", "sprite", sq(1024)),
  e("maria_ghost_grab", "sprite", sq(1024)),
  e("you_grab", "sprite", sq(1024)),
  e("you_sad", "sprite", sq(1024)),
  e("you_happy", "sprite", sq(1024)),
  e("fx_accord", "sprite", sq(512)),
  e("fx_touch", "sprite", sq(1024)),
  e("fx_puff", "sprite", sq(256)),
  e("ui_logo_spade", "ui", sq(1024)),
  e("ui_frame_corner", "ui", sq(512)),
  e("ui_divider", "ui", [2048, 128]),
  e("ui_panel_dark", "ui", sq(1024)),
  e("ui_note", "ui", [1024, 512]),
  e("ui_note_done", "ui", [1024, 512]),
  e("ui_button", "ui", [1024, 256]),
  e("ui_button_hover", "ui", [1024, 256]),
  e("ui_meter_frame", "ui", [2048, 256]),
  e("ui_portrait_frame", "ui", sq(512)),
  e("ui_laurel", "ui", sq(1024)),
  e("ui_rank_1", "ui", sq(256)),
  e("ui_rank_2", "ui", sq(256)),
  e("ui_rank_3", "ui", sq(256)),
  e("portrait_maria_novice", "portrait", sq(1024)),
  e("portrait_maria_adept", "portrait", sq(1024)),
  e("portrait_maria_master", "portrait", sq(1024)),
  e("portrait_you", "portrait", sq(1024)),
  e("art_title", "art", [2560, 1440]),
  e("art_arena_bg", "art", [2560, 1440]),
  e("art_victory", "art", [2560, 1440]),
  e("art_defeat", "art", [2560, 1440]),
  e("art_email_banner", "art", [1200, 400]),
  ...SITE_ICONS.map((i) => e(`icon_${i}`, "ui", sq(256))),
  ...STEP_ICONS.map((i) => e(`icon_step_${i}`, "ui", sq(256))),
  e("badge_novice", "ui", sq(512)),
  e("badge_adept", "ui", sq(512)),
  e("badge_master", "ui", sq(512)),
  e("favicon", "ui", sq(512)),
  e("og_image", "art", [1200, 630]),
  e("footer_strip", "art", [2048, 256]),
  e("art_empty_matches", "art", [1024, 768]),
  e("art_locked", "art", [1024, 768]),
  e("art_change", "art", [1024, 768]),
  e("art_expired", "art", [1024, 768]),
  e("art_404", "art", [1024, 768]),
  e("art_submitted", "art", [1024, 768]),
  e("email_footer", "art", [1200, 120]),
  ...DECOR_SET,
];

export function anchorFor(kind: AssetKind): [number, number] {
  return kind === "sprite" ? [0.5, 0.85] : [0, 0];
}

export interface ManifestEntry {
  file: string;
  kind: AssetKind;
  size: [number, number];
  anchor: [number, number];
}
