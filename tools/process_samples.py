"""Trim, tune-measure, normalise and encode the VCSL sources into MP3s + manifest.json (needs ffmpeg, numpy).
Usage: python process_samples.py src_dir out_dir   then   python make_samples_js.py out_dir ../src/samples.js
Note: VCSL names notes with middle C = C3, so +12 is added to get MIDI pitch; each sample is measured with an FFT.
"""
import os, sys, json, glob, base64, subprocess, numpy as np
SR = 44100
SRC, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
NOTE = {'C':0,'Cs':1,'D':2,'Ds':3,'E':4,'F':5,'Fs':6,'G':7,'Gs':8,'A':9,'As':10,'B':11}
def decode(p):
    raw = subprocess.run(['ffmpeg','-v','error','-i',p,'-ac','1','-ar',str(SR),'-f','f32le','-'],capture_output=True,check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).astype(np.float64)
def vcsl_midi(tag):  # VCSL names notes with middle C = C3 -> +12 for scientific pitch
    return 12*(int(tag[-1])+1) + NOTE[tag[:-1]] + 12
def onset_of(x):
    pk = np.max(np.abs(x)); return int(np.argmax(np.abs(x) > pk*0.01))
def cents_of(x, on, midi, start=0.08, dur=0.5):
    f0 = 440*2**((midi-69)/12)
    a = on+int(start*SR); seg = x[a:a+int(dur*SR)]
    w = seg*np.hanning(len(seg)); N = 1<<19
    sp = np.abs(np.fft.rfft(w, N)); fr = np.fft.rfftfreq(N, 1/SR)
    i0, i1 = np.searchsorted(fr, f0*2**(-1.4/12)), np.searchsorted(fr, f0*2**(1.4/12))
    k = i0+int(np.argmax(sp[i0:i1]))
    y0,y1,y2 = np.log(sp[k-1:k+2]+1e-12); d = 0.5*(y0-y2)/(y0-2*y1+y2)
    return 1200*np.log2((k+d)*SR/N/f0)
def encode(y, path, kbps):
    pcm = (np.clip(y, -1, 1)*32767).astype('<i2').tobytes()
    subprocess.run(['ffmpeg','-v','error','-y','-f','s16le','-ar',str(SR),'-ac','1','-i','-','-c:a','libmp3lame','-b:a',f'{kbps}k',path], input=pcm, check=True)
manifest = {}
def add(group, item): manifest.setdefault(group, []).append(item)
def oneshot(group, path, maxlen, fade, kbps=96, midi=None, rms_win=0.25, target=0.12, name=None):
    x = decode(path); on = onset_of(x)
    st = max(0, on-int(0.002*SR))
    y = x[st:st+int(maxlen*SR)].copy()
    n = len(y); f = min(int(fade*SR), n//2)
    y[n-f:] *= np.cos(np.linspace(0, np.pi/2, f))**2
    r = np.sqrt(np.mean(y[:int(rms_win*SR)]**2))+1e-12
    g = target/r; pk = np.max(np.abs(y))*g; extra = 1.0
    if pk > 0.95: extra = pk/0.95; g /= extra
    y *= g
    item = {'g': round(float(extra),4)}
    if midi is not None:
        c = cents_of(x, on, midi); item['p'] = round(midi + c/100, 3); item['c'] = round(float(c),1)
    fn = os.path.join(OUT, (name or os.path.basename(path).split('.')[0]) + '.mp3')
    encode(y, fn, kbps); item['f'] = os.path.basename(fn); item['len'] = round(n/SR,3)
    add(group, item); return item
def looped(group, path, midi, loop_a=0.45, loop_len=1.6, xf=0.3, tail=0.12, kbps=96, target=0.12):
    x = decode(path); on = onset_of(x)
    c = cents_of(x, on, midi, start=0.4, dur=0.8)
    f0 = 440*2**((midi + c/100 - 69)/12)
    st = max(0, on-int(0.002*SR))
    y = x[st:].copy()
    ls = int((0.002+loop_a)*SR)
    L = int(round(round(loop_len*f0)/f0*SR))       # whole number of periods
    le = ls + L; F = int(xf*SR); T = int(tail*SR)
    out = y[:le+T].copy()
    t = np.linspace(0, 1, F)
    fo, fi = np.cos(t*np.pi/2), np.sin(t*np.pi/2)
    out[le-F:le] = y[le-F:le]*fo + y[ls-F:ls]*fi    # end of loop blends into what precedes loop start
    out[le:le+T] = y[ls:ls+T]                        # post-loop tail duplicates post-start (tolerates onset jitter)
    r = np.sqrt(np.mean(out[ls:le]**2))+1e-12
    g = target/r; pk = np.max(np.abs(out))*g; extra = 1.0
    if pk > 0.95: extra = pk/0.95; g /= extra
    out *= g
    fn = os.path.join(OUT, os.path.basename(path).split('__')[0] + '_' + group + '.mp3')
    encode(out, fn, kbps)
    add(group, {'p': round(midi + c/100, 3), 'c': round(float(c),1), 'g': round(float(extra),4), 'f': os.path.basename(fn),
                'ls': round(ls/SR, 5), 'le': round(le/SR, 5), 'len': round(len(out)/SR,3)})
# --- stones: marimba + vibraphone (soft mallets) ---
for p in sorted(glob.glob(f'{SRC}/marimba/*.wav')):
    tag = os.path.basename(p).split('__')[0]
    if tag == 'F1': continue
    m = vcsl_midi(tag)
    oneshot('marimba', p, maxlen=2.6 if m < 66 else 1.8, fade=0.5, midi=m, rms_win=0.2, target=0.11, name=f'marimba_{tag}')
for p in sorted(glob.glob(f'{SRC}/vibraphone_soft/*.wav')):
    tag = os.path.basename(p).split('__')[0]; m = vcsl_midi(tag)
    oneshot('vibes', p, maxlen=3.4, fade=1.2, midi=m, rms_win=0.3, target=0.10, name=f'vibes_{tag}')
# --- reeds: renaissance organ 8' (wooden flue pipes), looped sustain ---
for p in sorted(glob.glob(f'{SRC}/organ_8inch/*.wav')):
    tag = os.path.basename(p).split('__')[0]
    if tag == 'D4': continue
    looped('organ', p, vcsl_midi(tag))
# --- falls: concert bass drum + frame drums ---
oneshot('bass', f'{SRC}/bassdrum2/bassdrum_hit_mf1.wav', 2.6, 1.4, kbps=80, rms_win=0.3, target=0.16, name='bass_mf1')
oneshot('bass', f'{SRC}/bassdrum2/bassdrum_hit_mp1.wav', 2.6, 1.4, kbps=80, rms_win=0.3, target=0.16, name='bass_mp1')
oneshot('frame', f'{SRC}/framedrum/HDrumL_Hit_v3_rr1_Sum.wav', 1.6, 0.8, kbps=80, rms_win=0.15, target=0.16, name='frameL_1')
oneshot('frame', f'{SRC}/framedrum/HDrumL_Hit_v3_rr2_Sum.wav', 1.6, 0.8, kbps=80, rms_win=0.15, target=0.16, name='frameL_2')
oneshot('frameS', f'{SRC}/framedrum/HDrumS_Hit_v3_rr1_Sum.wav', 1.3, 0.7, kbps=80, rms_win=0.12, target=0.16, name='frameS_1')
# --- gravel: small shaker + cabasa ---
for nm in ['Mid_ShakerHighFaster_Up_rr1','Mid_ShakerHighFaster_Down_rr1','Mid_ShakerLowFaster_Down_rr1','Mid_ShakerDouble_Up_rr1']:
    oneshot('shaker', f'{SRC}/shaker_small/{nm}.wav', 0.3, 0.06, kbps=96, rms_win=0.08, target=0.10, name='shaker_'+nm.split('_',1)[1][:18])
oneshot('cabasa', f'{SRC}/cabasa/Cabasa1_Hit_rr1_Mid.wav', 0.5, 0.15, kbps=96, rms_win=0.1, target=0.10, name='cabasa_1')
# --- dam release: ocean drum wave + soft gong;  lantern: nepalese hand bell ---
oneshot('whoosh', f'{SRC}/oceandrum/OceanDrum_Sus_2_Mid.wav', 4.2, 1.6, kbps=80, rms_win=2.0, target=0.10, name='ocean_2')
oneshot('gong', f'{SRC}/gong2/hit_light1.mp3', 4.0, 1.5, kbps=80, rms_win=1.0, target=0.08, name='gong_light1')
oneshot('bell', f'{SRC}/handbells/HB_1.wav', 1.8, 0.6, kbps=96, rms_win=0.3, target=0.08, name='handbell_1')
json.dump(manifest, open(os.path.join(OUT,'manifest.json'),'w'), indent=1)
tot = 0
for g, items in manifest.items():
    sz = sum(os.path.getsize(os.path.join(OUT,i['f'])) for i in items); tot += sz
    print(f"{g:8s} n={len(items):2d} {sz/1024:7.1f} KB  " + ' '.join(f"{i.get('p','-')}({i.get('c','')})" for i in items))
print(f'TOTAL {tot/1024:.1f} KB -> base64 ~{tot*4/3/1024:.0f} KB')
