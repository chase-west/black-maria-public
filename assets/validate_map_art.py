"""Format checks, unchanged-asset checks, and map-art contact sheets."""
import hashlib,json,sys
from PIL import Image,ImageDraw
import numpy as np
from map_art_pass import ROOT,catalog,read_state
from process_assets import PALETTE

def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def snapshot():
    changed={a['file'] for a in catalog()}|{'wall_plaster.png','wall_stone.png'}
    files={}
    for folder in ('','128','64','px','px/preview'):
        for p in (ROOT/folder).glob('*.png'):
            if p.name not in changed:files[str(p.relative_to(ROOT))]=sha(p)
    (ROOT/'map-unchanged-baseline.json').write_text(json.dumps(files,indent=2)+'\n')
    print(f'Recorded {len(files)} unchanged image hashes.')

def contact(section=None,repeat=False,pixels=False):
    entries=[a for a in catalog() if section is None or a['section']==section]
    if repeat:entries=[a for a in entries if a['suffix'] in ('TILE','STRIP')]
    cols=4;cell=(280,300);canvas=Image.new('RGB',(cols*cell[0],((len(entries)+cols-1)//cols)*cell[1]),tuple(PALETTE[0]));d=ImageDraw.Draw(canvas)
    state=read_state()
    for i,a in enumerate(entries):
        suffix='_3x3.png' if repeat else ('_64.png' if pixels else '.png')
        path=ROOT/'review/map'/(a['name']+suffix)
        if not path.exists():continue
        im=Image.open(path).convert('RGBA')
        if pixels:im=im.resize((im.width*3,im.height*3),Image.Resampling.NEAREST)
        im.thumbnail((cell[0]-12,cell[1]-44))
        x=(i%cols)*cell[0];y=(i//cols)*cell[1]
        canvas.paste(im,(x+(cell[0]-im.width)//2,y+40),im)
        d.text((x+4,y+4),a['name'],fill=tuple(PALETTE[1]))
        if a['section']==1:
            v=state.get(a['name'],{});rng=v.get('background_brightness_range',v.get('brightness_range','?'))
            d.text((x+4,y+19),f'P2-P98: {rng}/255',fill=tuple(PALETTE[1]))
    filename=('section'+str(section) if section else 'all')+('_repeat' if repeat else '_64' if pixels else '')+'.png'
    canvas.save(ROOT/'review/map'/filename);print(str(ROOT/'review/map'/filename))

def validate():
    errors={};state=read_state();manifest=json.loads((ROOT/'manifest.json').read_text())
    allowed={tuple(x) for x in PALETTE.tolist()}
    for a in catalog():
        es=[];p=ROOT/a['file']
        if state.get(a['name'],{}).get('status') not in ('PASS','FAIL'):es.append('visual QA incomplete')
        if manifest.get(a['name'],{}).get('qa_status')!=state.get(a['name'],{}).get('status'):es.append('manifest QA status mismatch')
        if not p.exists():errors[a['name']]=['missing master'];continue
        im=Image.open(p).convert('RGBA');arr=np.array(im)
        if list(im.size)!=a['size']:es.append('master dimensions')
        if a['transparent'] and not ((arr[:,:,3]==0).any() and (arr[:,:,3]>0).any()):es.append('alpha')
        if a['section']==1:
            gray=np.array(im.convert('L'));lo,hi=np.percentile(gray,[2,98])
            if round(float(hi-lo),2)!=state[a['name']]['brightness_range']:es.append('brightness log mismatch')
            if not state[a['name']]['flatness_pass']:es.append('flatness')
        for dimension in (128,64):
            p=ROOT/str(dimension)/a['file']
            if not p.exists() or max(Image.open(p).size)>dimension:es.append(f'{dimension} downsize')
        p=ROOT/'px'/a['file']
        if not p.exists():es.append('missing pixel image')
        else:
            px=Image.open(p).convert('RGBA');pa=np.array(px);size=(64,32) if a['suffix']=='STRIP' else (64,64)
            if px.size!=size:es.append('pixel dimensions')
            if set(np.unique(pa[:,:,3]))-{0,255}:es.append('pixel alpha')
            colors={tuple(c) for c in np.unique(pa[pa[:,:,3]>0,:3],axis=0).tolist()}
            if colors-allowed:es.append('pixel palette')
            pr=Image.open(ROOT/'px/preview'/a['file']).convert('RGBA')
            if not np.array_equal(np.array(pr),np.array(px.resize((size[0]*4,size[1]*4),Image.Resampling.NEAREST))):es.append('pixel preview')
        if manifest.get(a['name'],{}).get('size')!=a['size']:es.append('manifest dimensions')
        if es:errors[a['name']]=es
    baseline=json.loads((ROOT/'map-unchanged-baseline.json').read_text());changed=[p for p,h in baseline.items() if not (ROOT/p).exists() or sha(ROOT/p)!=h]
    for name in ('wall_plaster','wall_stone'):
        if name in manifest:errors[name]=['obsolete manifest entry']
        for folder in ('','128','64','px','px/preview'):
            if (ROOT/folder/(name+'.png')).exists():errors.setdefault(name,[]).append('obsolete image remains')
    result=dict(checked=len(catalog()),manifest_entries=len(manifest),errors=errors,unchanged_images_checked=len(baseline),unexpected_changes=changed)
    (ROOT/'map-validation.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))

if __name__=='__main__':
    if sys.argv[1]=='snapshot':snapshot()
    elif sys.argv[1]=='validate':validate()
    elif sys.argv[1]=='contact':contact(int(sys.argv[2]) if len(sys.argv)>2 else None,repeat='--repeat' in sys.argv,pixels='--pixels' in sys.argv)
