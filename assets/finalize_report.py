"""Record the completed human visual review separately from format validation."""
import json
from process_assets import ROOT, catalog, report

state=json.loads((ROOT/'generation-state.json').read_text())
failures={
    'tile_floor_library':'FAIL seamlessness: herringbone phase still jumps at repeat joins after the initial generation and three correction attempts. Candidate retained; inspect review/tile_floor_library_3x3.png.',
    'tile_floor_study':'FAIL seamlessness: doubled horizontal seam and discontinuous edge grain remain after the initial generation and three correction attempts. Candidate retained; inspect review/tile_floor_study_3x3.png.'
}
for a in catalog():
    item=state[a['name']]
    item['status']='FAIL' if a['name'] in failures else 'PASS'
    item['qa_note']=failures.get(a['name'],'Visual reject-list review passed; format checks passed.')
    if a['section']==1 and a['name'] not in failures:
        item['qa_note']='3×3 repeat visually checked; quiet flat texture and readable pixel version. Format checks passed.'
    if a['kind']=='wall':
        item['qa_note']='Horizontal repeat visually checked (vertical repeat is not required for wall blocks). Format checks passed.'
    if a['section'] in (3,4,5,6,7):
        item['qa_note']+=' Silhouette inspected at 64 px; alpha verified.'
    if a['section']==9:
        item['qa_note']+=' Portrait family checked together in review/portraits.png.'
(ROOT/'generation-state.json').write_text(json.dumps(state,indent=2)+'\n')
report(state)
lines=['# Assets failing final visual QA','',
    '80 requested assets were generated and saved. 78 pass visual review; 2 floor candidates fail strict seamlessness. All 80 pass dimensions, required alpha, master palette, downsize, and pixel-preview validation. Failed candidates remain at their requested paths and in the manifest for review; consumers should use their fallback for these two until replaced.','']
for name,note in failures.items():
    lines += [f'- `{name}.png` — {note}']
(ROOT/'FAILED.md').write_text('\n'.join(lines)+'\n')
manifest=json.loads((ROOT/'manifest.json').read_text())
for name,entry in manifest.items():entry['qa_status']=state[name]['status']
(ROOT/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print('80 assets: 78 PASS, 2 FAIL (tile seamlessness).')
