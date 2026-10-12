"""Prepare, measure, review, and deliver the map-art replacement pass."""
import json,re,sys,shutil
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw
from process_assets import ROOT,PALETTE,quantized

STYLE=re.search(r'### STYLE.*?\n> (.*?)\n',(ROOT.parent/'ASSETS.md').read_text(),re.S).group(1)
FLAT='Extremely low contrast, almost flat, the pattern is barely visible, no dark outlines, no cocoa lines, reads as one color from a distance.'
SUFFIX={
 'TILE':'Seamlessly tileable square texture seen from directly above, edges wrap perfectly, no visible seam.',
 'STRIP':'Horizontal strip, tileable left to right only, hard top and bottom edges, no transparency.',
 'SPRITE':'Single object, centered, 3/4 top-down view as in a 16-bit adventure game, isolated on a fully transparent background, PNG with alpha, no cast shadow.'}
BASES=['#F6E7C8','#F6E7C8','#F6E7C8','#E9B44C','#BC9C77','#E5E1D2','#267E76','#F6E7C8','#A2B98A','#2A9D8F','#F6E7C8','#655957']

def catalog():
    result=[];section=0;floor=0
    for line in (ROOT/'MAP_ART_BRIEF.md').read_text().splitlines():
        m=re.match(r'## (\d+)\.',line)
        if m:section=int(m.group(1))
        if not line.startswith('| `') or not section:continue
        cells=[c.strip() for c in line.strip('|').split('|')]
        filename=re.search(r'`(.*?)`',cells[0]).group(1)
        if 'Delete.' in cells[-1]:continue
        suffix=cells[2] if section in (2,3) else ('TILE' if section==1 else 'SPRITE')
        size=[1024,512] if suffix=='STRIP' else [1024,1024]
        name=filename[:-4];row=cells[-1]
        kind='sprite' if suffix=='SPRITE' else ('tile' if section==1 else 'wall')
        prompt=STYLE+'\n\n'+row+'\n\n'+SUFFIX[suffix]
        if section==1:
            base=BASES[floor];floor+=1
            prompt+=' '+FLAT+'\nMAP FLOOR OVERRIDE: The thick outlines and high-contrast grain in the reference are NOT for floors. Base fill '+base+'. Use only this base hue and a single adjacent tonal variation at most 8 grayscale units apart. No illumination gradient, vignette, highlights, cocoa grain or isolated dark specks. Flat full bleed across the whole canvas. Sparse faint marks only. No floating swatch, perspective or outside border. Keep every edge an uninterrupted base fill; all pattern lines fade out before canvas edges. No decorative objects.'
            if name=='tile_floor_hall_mark':prompt+=' Exception: ONE large cocoa spade with a mustard outline at the exact center, 35% of canvas width. Only its background must pass the flatness test.'
        elif suffix=='TILE':
            prompt+=' FULL BLEED cocoa top surface, not a floating wall block. Almost flat. Faint highlight is a flat printed tonal stroke, not lighting or shading; no gradients. All edges connect without a frame.'
        elif suffix=='STRIP':
            prompt+=' Front face ONLY. Fill the entire 2:1 rectangle. No top cap, side face, perspective, floor or outside margin. Straight hard top/bottom edges. Horizontal joints align at left and right edges. Slate blue-grey requested here is an explicit map-pass tonal exception to the old palette.'
        else:
            fraction=.9 if section==4 else (.6 if section==5 else .85)
            prompt+=f' Clean, tall, simple silhouette filling {round(fraction*100)}% of frame. No floor or backdrop, no cast shadow or contact shadow. Transparent inside empty openings too.'
            prompt+=' Only cream #F6E7C8, cocoa #4A2C2A, teal #2A9D8F, mustard #E9B44C, coral #F07167, moss #7FB069. No lilac, black, white, new hues, gradients, shading or shine. Use mustard as the allowed light wood tone when needed.'
        prompt+='\nMatch the style of the attached reference sheet exactly, subject to the explicit map-floor low-contrast override. Reference is for style ONLY; output only the requested asset. No text, watermark, extra studies or sheet. No baked shadow. Output dimensions '+str(size[0])+'×'+str(size[1])+'.'
        result.append(dict(name=name,file=filename,size=size,kind=kind,section=section,suffix=suffix,transparent=suffix=='SPRITE',prompt=prompt))
    return result

def read_state():
    p=ROOT/'map-generation-state.json'
    return json.loads(p.read_text()) if p.exists() else {}

def prepare(name,source):
    a=next(x for x in catalog() if x['name']==name)
    im=Image.open(source).convert('RGBA');native=list(im.size)
    alpha=np.array(im.getchannel('A'));has_alpha=bool((alpha==0).any() and (alpha>0).any())
    if a['transparent'] and not has_alpha:raise ValueError(name+': missing true alpha')
    if a['transparent']:
        bounds=im.getchannel('A').point(lambda v:255 if v>32 else 0).getbbox();subject=im.crop(bounds)
        fraction=.9 if a['section']==4 else (.6 if a['section']==5 else .85)
        subject.thumbnail((round(1024*fraction),round(1024*fraction)),Image.Resampling.LANCZOS)
        im=Image.new('RGBA',tuple(a['size']))
        # Big fixture foot anchor is 85%; retain top clearance at 90% frame height.
        bottom=.95 if a['section']==4 else .85
        y=(1024-subject.height)//2 if a['section']==5 else round(1024*bottom)-subject.height
        im.alpha_composite(subject,((1024-subject.width)//2,max(0,y)))
        im=quantized(im)
    else:
        bg=Image.new('RGBA',im.size,tuple(PALETTE[0])+(255,));bg.alpha_composite(im);im=bg.resize(tuple(a['size']),Image.Resampling.LANCZOS)
    state=read_state();previous=state.get(name,{});attempt=previous.get('attempt',0)+1
    folder=ROOT/'review/map';folder.mkdir(parents=True,exist_ok=True)
    candidate=folder/f'{name}_attempt{attempt}.png';im.save(candidate)
    info=dict(native_size=native,source=source,candidate=str(candidate.relative_to(ROOT)),attempt=attempt,status='REVIEW',alpha_verified=has_alpha if a['transparent'] else None)
    if a['section']==1:
        gray=np.array(im.convert('L'));lo,hi=np.percentile(gray,[2,98]);info['brightness_range']=round(float(hi-lo),2);info['brightness_percentiles']=[round(float(lo),2),round(float(hi),2)]
        if name=='tile_floor_hall_mark':
            # Exclude central emblem footprint only; always retain full-image result above.
            yy,xx=np.indices(gray.shape);mask=(xx<.25*gray.shape[1])|(xx>.75*gray.shape[1])|(yy<.2*gray.shape[0])|(yy>.8*gray.shape[0])
            blo,bhi=np.percentile(gray[mask],[2,98]);info['background_brightness_range']=round(float(bhi-blo),2)
        info['flatness_pass']=info.get('background_brightness_range',info['brightness_range'])<=26
    if a['suffix'] in ('TILE','STRIP'):
        tile=im.copy();tile.thumbnail((256,256));rep=Image.new('RGBA',(tile.width*3,tile.height*3))
        for y in range(3):
            for x in range(3):rep.paste(tile,(x*tile.width,y*tile.height))
        rep.save(folder/(name+'_3x3.png'))
    thumb=im.copy();thumb.thumbnail((256,256));thumb.save(folder/a['file'])
    small=im.copy();small.thumbnail((64,64));small.save(folder/(name+'_64.png'))
    history=previous.get('history',[])
    if previous:history.append({k:v for k,v in previous.items() if k!='history'})
    info['history']=history;state[name]=info
    (ROOT/'map-generation-state.json').write_text(json.dumps(state,indent=2)+'\n')
    print(json.dumps({k:v for k,v in info.items() if k!='history'}))

def accept(name,status='PASS',note=''):
    a=next(x for x in catalog() if x['name']==name);state=read_state();v=state[name]
    im=Image.open(ROOT/v['candidate']).convert('RGBA')
    if status=='PASS' and v.get('flatness_pass') is False:raise ValueError(name+': flatness failed')
    im.save(ROOT/a['file'])
    for dimension in (128,64):
        folder=ROOT/str(dimension);folder.mkdir(exist_ok=True);small=im.copy();small.thumbnail((dimension,dimension),Image.Resampling.LANCZOS);small.save(folder/a['file'])
    px_size=(64,32) if a['suffix']=='STRIP' else (64,64)
    px=quantized(im.resize(px_size,Image.Resampling.BOX),binary_alpha=True);px.save(ROOT/'px'/a['file'])
    px.resize((px_size[0]*4,px_size[1]*4),Image.Resampling.NEAREST).save(ROOT/'px/preview'/a['file'])
    v.update(status=status,qa_note=note,thumbnail='review/map/'+a['file'])
    (ROOT/'map-generation-state.json').write_text(json.dumps(state,indent=2)+'\n')
    path=ROOT/'manifest.json';manifest=json.loads(path.read_text())
    manifest[name]=dict(file=a['file'],px='px/'+a['file'],kind=a['kind'],size=a['size'],anchor=[.5,.85] if a['kind']=='sprite' else [0,0],qa_status=status)
    path.write_text(json.dumps(manifest,indent=2)+'\n')
    older=ROOT/'generation-state.json';old=json.loads(older.read_text());old[name]=v;older.write_text(json.dumps(old,indent=2)+'\n')
    update_report();print(name+' '+status)

def update_report():
    state=read_state();old=json.loads((ROOT/'generation-state.json').read_text())
    lines=['# Asset report — map art pass','',
      'Generated with the built-in image tool. Exact prompts: `map-prompts.json` and `map-prompt-history.json`. Approved reference: `_stylesheet.png`. Map brief: `MAP_ART_BRIEF.md`.','',
      'Floor masters retain the adjacent tonal shades explicitly requested by the map brief; pixel copies use the original seven-color palette. Slate wall faces likewise follow the newer brief. Hall mark flatness is measured outside its permitted central emblem; both full and background ranges are reported. Sprite masters are palette-quantized and alpha-verified. No shadows added. Wall-face pixel strips retain 2:1 aspect at 64×32.','']
    for a in catalog():
        v=state.get(a['name'],{});note=v.get('qa_note','Awaiting visual QA.')
        if a['section']==1:note+=f" Grayscale P2–P98 range: {v.get('brightness_range','pending')}/255 (limit 26)."
        if 'background_brightness_range' in v:note+=f" Background range: {v['background_brightness_range']}/255; emblem exempt."
        lines.append(f"- `{a['file']}` — {v.get('status','PENDING')}; thumbnail: `{v.get('thumbnail','review/map/'+a['file'])}`. {note}")
    names={a['name'] for a in catalog()}|{'wall_plaster','wall_stone'}
    lines+=['','## Unchanged assets','']
    for name,v in old.items():
        if name not in names:lines.append(f"- `{name}.png` — {v['status']} (unchanged); thumbnail: `{v['thumbnail']}`.")
    (ROOT/'REPORT.md').write_text('\n'.join(lines)+'\n')

def cleanup():
    for filename in ('wall_plaster.png','wall_stone.png'):
        for folder in ('','128','64','px','px/preview','review'):(ROOT/folder/filename).unlink(missing_ok=True)
        (ROOT/'review'/(filename[:-4]+'_3x3.png')).unlink(missing_ok=True)
    for filename in ('manifest.json','generation-state.json'):
        p=ROOT/filename;data=json.loads(p.read_text())
        for name in ('wall_plaster','wall_stone'):data.pop(name,None)
        p.write_text(json.dumps(data,indent=2)+'\n')
    update_report()

if __name__=='__main__':
    mode=sys.argv[1]
    if mode=='catalog':(ROOT/'map-prompts.json').write_text(json.dumps(catalog(),indent=2)+'\n');print(len(catalog()))
    elif mode=='prepare':prepare(*sys.argv[2:4])
    elif mode=='accept':accept(*sys.argv[2:])
    elif mode=='report':update_report()
    elif mode=='cleanup':cleanup()
