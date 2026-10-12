"""Assemble the current manifest and approved reference into a labeled sheet."""
import json, math
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
manifest = json.loads((ROOT / 'manifest.json').read_text())
order = {'tile': 0, 'wall': 1, 'sprite': 2, 'decal': 3, 'ui': 4, 'portrait': 5, 'art': 6}
entries = [('_stylesheet.png', 'approved style reference')]
entries += [(v['file'], v['kind']) for v in sorted(manifest.values(), key=lambda v: order[v['kind']])]
font_path = '/System/Library/Fonts/Supplemental/Arial.ttf'
font = ImageFont.truetype(font_path, 17)
small = ImageFont.truetype(font_path, 14)
title = ImageFont.truetype(font_path, 44)
cols, cw, ch, top = 8, 320, 290, 120
sheet = Image.new('RGB', (cols*cw, top + math.ceil(len(entries)/cols)*ch + 20), '#F6E7C8')
draw = ImageDraw.Draw(sheet)
draw.text((24, 20), 'BLACK MARIA — COMPLETE ASSET SHEET', font=title, fill='#4A2C2A')
draw.text((26, 78), f'{len(manifest)} current game assets + approved style reference • master artwork', font=font, fill='#4A2C2A')
for i, (filename, kind) in enumerate(entries):
    x, y = (i % cols)*cw + 12, top + (i//cols)*ch
    im = Image.open(ROOT / filename).convert('RGBA')
    panel = Image.new('RGBA', (296, 230), '#EDE1C8')
    if im.getchannel('A').getextrema()[0] < 255:
        p = ImageDraw.Draw(panel)
        for yy in range(0, 230, 16):
            for xx in range(0, 296, 16):
                p.rectangle((xx, yy, xx+15, yy+15), fill=('#879B98' if (xx//16+yy//16)%2 else '#91A5A1'))
    im.thumbnail((280, 218), Image.Resampling.LANCZOS)
    panel.alpha_composite(im, ((296-im.width)//2, (230-im.height)//2))
    sheet.paste(panel.convert('RGB'), (x, y))
    draw.text((x+2, y+237), filename, font=font, fill='#4A2C2A')
    draw.text((x+2, y+260), kind, font=small, fill='#796356')
output = ROOT / 'review' / 'all-assets-sheet.png'
sheet.save(output)
print(f'{output}: {sheet.width}×{sheet.height}, {len(entries)} labeled images')
