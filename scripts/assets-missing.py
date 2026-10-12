#!/usr/bin/env python3
"""List asset files named in the briefs that are not yet in assets/."""
import re, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
expected = {}
for brief in ["ASSETS.md", "ASSETS_MAP.md", "ASSETS_SITE.md", "ASSETS_DECOR.md"]:
    for m in re.finditer(r"`([a-z0-9_]+\.png)`", (root / brief).read_text()):
        expected.setdefault(m.group(1), brief)
    if brief == "ASSETS_DECOR.md":
        for i in range(1, 7):
            expected.setdefault(f"you_walk_{i}.png", brief)
for f in ["wall_plaster.png", "wall_stone.png"]:
    expected.pop(f, None)
have = {p.name for p in (root / "assets").glob("*.png")}
missing = sorted(f for f in expected if f not in have)
print(f"expected {len(expected)}, present {len(expected) - len(missing)}, missing {len(missing)}")
by = {}
for f in missing:
    by.setdefault(expected[f], []).append(f)
for b, fs in by.items():
    print(f"\n{b}: {len(fs)} missing")
    for f in fs:
        print("  ", f)
