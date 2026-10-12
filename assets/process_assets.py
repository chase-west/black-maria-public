"""Prepare generated art, mandated downsizes/pixel pass, and review evidence.

Usage: python assets/process_assets.py ingest NAME SOURCE
       python assets/process_assets.py status
Generation is performed separately with the built-in image tool.
"""
import json
import re
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent
PALETTE = np.array([[246,231,200],[74,44,42],[42,157,143],[233,180,76],
                    [240,113,103],[127,176,105],[184,161,227]], dtype=np.int32)

def catalog():
    text = (ROOT / 'GENERATION_BRIEF.md').read_text()
    style = re.search(r'### STYLE.*?\n> (.*?)\n', text, re.S).group(1)
    suffixes = dict(re.findall(r'- \*\*(\w+):\*\* `(.*?)`', text))
    result = []
    section = None
    for line in text.splitlines():
        match = re.match(r'## (\d+)\.', line)
        if match:
            section = int(match.group(1))
        if not line.startswith('| `') or section is None:
            continue
        cells = [s.strip() for s in line.strip('|').split('|')]
        filename = cells[0].strip('`')
        if section == 0:
            continue
        default = {1:'TILE',3:'DECAL',4:'SPRITE',5:'SPRITE',6:'SPRITE',8:'UI',9:'PORTRAIT',10:'ART'}
        suffix = cells[2] if section in (2,7) else default[section]
        size = [1024,1024]
        if section in (2,7,8,9,10):
            m = re.search(r'(\d+)×(\d+)', cells[1])
            if m:
                size = list(map(int,m.groups()))
            if 'TILE' in cells[1]:
                suffix = 'TILE'
        row = cells[-1]
        kind = {'TILE':'tile','SPRITE':'sprite','DECAL':'decal','WALL':'wall','UI':'ui','PORTRAIT':'portrait','ART':'art'}[suffix]
        extra = ''
        if section == 4: extra = ' Fixture occupies about 80% of the frame.'
        if section == 5: extra = ' Item occupies about 40% of the frame.'
        if section == 6: extra = ' Character occupies about 70% of the frame.'
        prompt = (style + '\n\n' + row + '\n\n' + suffixes[suffix] + extra +
            '\nMatch the style of the attached reference sheet exactly. The attachment is only a style reference; output ONLY the requested single asset, no sheet or extra studies. '+
            f'Output dimensions {size[0]}×{size[1]}. '+
            'Use only cream #F6E7C8, cocoa #4A2C2A, teal #2A9D8F, mustard #E9B44C, coral #F07167, moss #7FB069, lilac #B8A1E3. '+
            'Lilac only for Maria or explicitly specified lilac liquid. No black or white. Flat fills, few marks, thick wobbly outlines, readable at 64 pixels, no gradients, no highlights or cast shadows. '+
            ('Spade always means the chubby playing-card suit with rounded upper point, two lobes and short stem, matching the reference emblem, never a shovel. No letters or text.' if 'spade' in row.lower() else 'Do not add spade symbols or any motifs absent from the requested asset. No letters or text.'))
        if kind == 'tile':
            prompt += ' FULL BLEED texture filling the entire square, not a floating swatch, no outer border or margin, no perspective. Repeating motifs continue across opposite edges at identical positions. Use sparse larger shapes and restrained contrast.'
        result.append(dict(name=filename[:-4],file=filename,size=size,kind=kind,section=section,prompt=prompt,transparent=suffix in ('SPRITE','DECAL','UI')))
    return result

def quantized(image, binary_alpha=False):
    a = np.array(image.convert('RGBA'))
    rgb = a[:,:,:3].astype(np.int32)
    # Row chunks keep memory usage bounded for key art.
    for y in range(0, len(a), 128):
        chunk = rgb[y:y+128]
        indices = ((chunk[:,:,None,:] - PALETTE[None,None,:,:])**2).sum(axis=3).argmin(axis=2)
        a[y:y+128,:,:3] = PALETTE[indices].astype(np.uint8)
    if binary_alpha:
        a[:,:,3] = np.where(a[:,:,3] >= 128, 255, 0)
    a[a[:,:,3] == 0,:3] = 0
    return Image.fromarray(a)

def ingest(name, source):
    entry = next(x for x in catalog() if x['name'] == name)
    image = Image.open(source).convert('RGBA')
    native = list(image.size)
    alpha = np.array(image.getchannel('A'))
    has_alpha = bool((alpha == 0).any() and (alpha > 0).any())
    if entry['transparent'] and not has_alpha:
        raise ValueError(f'{name}: missing true transparency; regenerate')
    if not entry['transparent']:
        opaque = Image.new('RGBA', image.size, (*PALETTE[0],255))
        opaque.alpha_composite(image)
        image = opaque
    if entry['section'] in (4,5,6) and has_alpha:
        fraction = {4:.8,5:.4,6:.7}[entry['section']]
        bounds = image.getchannel('A').point(lambda x: 255 if x > 32 else 0).getbbox()
        subject = image.crop(bounds)
        limit = round(min(entry['size'])*fraction)
        subject.thumbnail((limit,limit),Image.Resampling.LANCZOS)
        image = Image.new('RGBA',tuple(entry['size']))
        x = (entry['size'][0]-subject.width)//2
        y = (entry['size'][1]-subject.height)//2 if entry['section']==5 else round(entry['size'][1]*.85)-subject.height
        image.alpha_composite(subject,(x,max(0,y)))
    elif entry['kind'] == 'ui' and has_alpha:
        # Preserve emblem proportions when native generation ignores wide UI dimensions.
        bounds = image.getchannel('A').point(lambda x: 255 if x > 32 else 0).getbbox()
        subject = image.crop(bounds)
        subject.thumbnail((round(entry['size'][0]*.94), round(entry['size'][1]*.90)),Image.Resampling.LANCZOS)
        image = Image.new('RGBA',tuple(entry['size']))
        image.alpha_composite(subject,((entry['size'][0]-subject.width)//2,(entry['size'][1]-subject.height)//2))
    else:
        image = image.resize(tuple(entry['size']), Image.Resampling.LANCZOS)
    image = quantized(image)
    image.save(ROOT / entry['file'])
    for folder in ('128','64','px','px/preview','review'):
        (ROOT / folder).mkdir(parents=True,exist_ok=True)
    if entry['kind'] in ('tile','sprite','decal','wall'):
        for dimension in (128,64):
            reduced = image.copy()
            reduced.thumbnail((dimension,dimension),Image.Resampling.LANCZOS)
            reduced.save(ROOT / str(dimension) / entry['file'])
        pixel = quantized(image.resize((64,64),Image.Resampling.BOX),binary_alpha=True)
        pixel.save(ROOT / 'px' / entry['file'])
        pixel.resize((256,256),Image.Resampling.NEAREST).save(ROOT / 'px/preview' / entry['file'])
    thumb = image.copy()
    thumb.thumbnail((256,256),Image.Resampling.LANCZOS)
    thumb.save(ROOT / 'review' / entry['file'])
    if entry['kind'] in ('tile','wall'):
        tile = image.resize((256,256),Image.Resampling.LANCZOS)
        tiled = Image.new('RGBA',(768,768))
        for y in range(3):
            for x in range(3): tiled.paste(tile,(x*256,y*256))
        tiled.save(ROOT / 'review' / (name + '_3x3.png'))
    manifest_path = ROOT / 'manifest.json'
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    item = dict(file=entry['file'],kind=entry['kind'],size=entry['size'],anchor=[.5,.85] if entry['kind']=='sprite' else [0,0])
    if (ROOT / 'px' / entry['file']).exists(): item['px'] = 'px/' + entry['file']
    manifest[name] = item
    manifest_path.write_text(json.dumps(manifest,indent=2)+'\n')
    state_path = ROOT / 'generation-state.json'
    state = json.loads(state_path.read_text()) if state_path.exists() else {}
    state[name] = dict(native_size=native,alpha_verified=has_alpha if entry['transparent'] else None,status='REVIEW',source=str(source),thumbnail='review/'+entry['file'])
    state_path.write_text(json.dumps(state,indent=2)+'\n')
    report(state)
    print(json.dumps(dict(name=name,native=native,final=entry['size'],alpha=has_alpha)))

def report(state):
    lines = ['# Asset report','',
      '- `_stylesheet.png` — APPROVED by user; thumbnail: `_stylesheet.png` (native 1254×1254; delivery resized to 2048×2048).','',
      'Built-in image generation; prompts in `generation-prompts.json`, corrections in `correction-prompts.json` and `final-correction-prompts.json`. Masters normalized to requested dimensions and nearest seven-color palette. Native dimensions recorded in `generation-state.json`; wide key art was enlarged from native output to requested dimensions. Transparent pixels retain alpha. Downsizes use Lanczos; pixel set uses BOX, nearest palette color, binary alpha, and nearest-neighbor previews. REVIEW means visual QA remains pending. FAIL candidates remain saved for inspection; see `FAILED.md`.','',
      'Palette interpretation: the vial row explicitly requests lilac liquid, so this row is an exception to the general Maria-only rule. The study requests an off-palette lighter cocoa; the final version uses mustard, the nearest allowed warm light fill. Final seam correction prompts are in `seam-correction-prompts.json`. UI elements are fitted within their requested transparent canvases to preserve emblem proportions.','',
      f"Final review: {sum(v['status']=='PASS' for v in state.values())} PASS, {sum(v['status']=='FAIL' for v in state.values())} FAIL, {sum(v['status']=='REVIEW' for v in state.values())} awaiting review.",'']
    for key,value in state.items():
        note = value.get('qa_note','')
        lines.append(f"- `{key}.png` — {value['status']}; thumbnail: `{value['thumbnail']}`; native: {value['native_size']}; alpha: {value['alpha_verified']}. {note}")
    (ROOT / 'REPORT.md').write_text('\n'.join(lines)+'\n')

if __name__ == '__main__':
    if sys.argv[1] == 'catalog':
        (ROOT / 'prompts.json').write_text(json.dumps(catalog(),indent=2)+'\n')
        print(f'{len(catalog())} assets')
    elif sys.argv[1] == 'ingest': ingest(*sys.argv[2:4])
    elif sys.argv[1] == 'status':
        state = ROOT / 'generation-state.json'
        report(json.loads(state.read_text()) if state.exists() else {})
