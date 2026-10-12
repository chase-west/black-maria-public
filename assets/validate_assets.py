"""Validate the delivered image formats and build review contact sheets."""
import json
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw
from process_assets import ROOT, PALETTE, catalog

def contact(entries, dest, cols=5, cell=(220,240), source='review'):
    canvas=Image.new('RGB',(cols*cell[0],((len(entries)+cols-1)//cols)*cell[1]),tuple(PALETTE[0]))
    draw=ImageDraw.Draw(canvas)
    for i,a in enumerate(entries):
        path=ROOT/source/a['file']
        if not path.exists(): continue
        im=Image.open(path).convert('RGBA'); im.thumbnail((cell[0]-12,cell[1]-30))
        x=(i%cols)*cell[0];y=(i//cols)*cell[1]
        canvas.paste(im,(x+(cell[0]-im.width)//2,y+25),im)
        draw.text((x+4,y+5),a['name'],fill=tuple(PALETTE[1]))
    canvas.save(ROOT/'review'/dest)

def validate():
    result={}
    allowed={tuple(x) for x in PALETTE.tolist()}
    for a in catalog():
        errors=[];path=ROOT/a['file']
        if not path.exists():
            result[a['name']]=['missing master'];continue
        im=Image.open(path).convert('RGBA');arr=np.array(im)
        if list(im.size)!=a['size']:errors.append('master dimensions')
        if a['transparent'] and not ((arr[:,:,3]==0).any() and (arr[:,:,3]>0).any()): errors.append('alpha')
        rgb=arr[arr[:,:,3]>0,:3].astype(np.uint32)
        codes=np.unique((rgb[:,0]<<16)|(rgb[:,1]<<8)|rgb[:,2])
        colors={(int(c)>>16,(int(c)>>8)&255,int(c)&255) for c in codes}
        if colors-allowed:errors.append('master palette')
        if a['kind'] in ('tile','wall','sprite','decal'):
            for size in (128,64):
                p=ROOT/str(size)/a['file']
                if not p.exists() or max(Image.open(p).size)>size: errors.append(f'{size} downsize')
            px=ROOT/'px'/a['file']
            if not px.exists():errors.append('pixel pass missing')
            else:
                pi=Image.open(px).convert('RGBA');pa=np.array(pi)
                if pi.size!=(64,64):errors.append('pixel size')
                if set(np.unique(pa[:,:,3]))-{0,255}:errors.append('pixel alpha')
                pc={tuple(x) for x in np.unique(pa[pa[:,:,3]>0,:3],axis=0).tolist()}
                if pc-allowed:errors.append('pixel palette')
                preview=Image.open(ROOT/'px/preview'/a['file']).convert('RGBA')
                if preview.size!=(256,256) or not np.array_equal(np.array(preview),np.array(pi.resize((256,256),Image.Resampling.NEAREST))):errors.append('pixel preview')
        result[a['name']]=errors
    (ROOT/'validation.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({'checked':len(result),'errors':{k:v for k,v in result.items() if v}}))

if __name__=='__main__':
    validate()
    all_assets=catalog()
    contact(all_assets,'all_assets.png',cols=8,cell=(180,200))
    contact([a for a in all_assets if a['section'] in (7,9,10)],'portraits_effects_art.png',cols=4,cell=(300,320))
    contact([dict(a,file=a['name']+'_3x3.png') for a in all_assets if a['section'] in (1,2) and a['kind'] in ('tile','wall')],'tiles_repeat.png',cols=4,cell=(300,325))
