"""Download the VCSL (CC0) source samples Riversong uses.
Usage: python fetch_samples.py vcsl.json out_dir
vcsl.json is the index from https://raw.githubusercontent.com/felixroos/dough-samples/main/vcsl.json
The organ_8inch notes (C1 E1 G#1 C2 E2 G#2 C3 E3 G#3 C4) are fetched the same way from the organ_8inch entry.
"""
import json, os, sys, urllib.parse, urllib.request, concurrent.futures as cf
idx = json.load(open(sys.argv[1]))
out = sys.argv[2]
base = idx['_base']
want = {
  'marimba': 'ALL', 'vibraphone_soft': 'ALL',
  'recorder_bass_sus': ['F#2','A#2','D3','C3','E3'],
  'recorder_tenor_sus': ['F#3','A#3','D4','C4','E4','G#3'],
  'recorder_alto_sus': ['F#4','A#4','D5','C5','E5'],
  'recorder_soprano_sus': ['D5','F#5','A#5','C6'],
}
lists = {
  'bassdrum1': ['BDrumNew_hit_v3_rr1_Sum.wav','BDrumNew_hit_v3_rr2_Sum.wav','BDrumNew_hit_v5_rr1_Sum.wav'],
  'bassdrum2': ['bassdrum_hit_mf1.wav','bassdrum_hit_mp1.wav','bassdrum_hit_f.wav'],
  'framedrum': ['HDrumL_Hit_v2_rr1_Sum.wav','HDrumL_Hit_v3_rr1_Sum.wav','HDrumL_Hit_v3_rr2_Sum.wav','HDrumS_Hit_v2_rr1_Sum.wav','HDrumS_Hit_v3_rr1_Sum.wav'],
  'shaker_small': ['Mid_ShakerDouble_Down_rr1.wav','Mid_ShakerDouble_Up_rr1.wav','Mid_ShakerHighFaster_Down_rr1.wav','Mid_ShakerHighFaster_Up_rr1.wav','Mid_Shaker_Slap_rr1.wav','Mid_ShakerLowFaster_Down_rr1.wav'],
  'cabasa': ['Cabasa1_Hit_rr1_Mid.wav','Cabasa1_Hit_rr2_Mid.wav'],
  'oceandrum': ['OceanDrum_Sus_1_Mid.wav','OceanDrum_Sus_2_Mid.wav'],
  'gong2': ['hit_light1.mp3','hit_light2.mp3'],
  'handbells': ['HB_1.wav','HB_2.wav','HB_3.wav'],
}
jobs = []
for inst, notes in want.items():
  m = idx[inst]
  for note, files in m.items():
    if notes != 'ALL' and note not in notes: continue
    f = files[0] if isinstance(files, list) else files
    jobs.append((inst, note, f))
for inst, names in lists.items():
  for f in idx[inst]:
    if urllib.parse.unquote(f).split('/')[-1] in names:
      jobs.append((inst, None, f))
def get(job):
  inst, note, f = job
  name = urllib.parse.unquote(f).split('/')[-1]
  d = os.path.join(out, inst); os.makedirs(d, exist_ok=True)
  dst = os.path.join(d, (note.replace('#','s') + '__' if note else '') + name)
  if os.path.exists(dst) and os.path.getsize(dst) > 1000: return dst, 'cached'
  url = base + f
  with urllib.request.urlopen(url, timeout=60) as r: data = r.read()
  open(dst, 'wb').write(data)
  return dst, len(data)
with cf.ThreadPoolExecutor(6) as ex:
  for res in ex.map(get, jobs):
    print(res)
print('total', len(jobs))
