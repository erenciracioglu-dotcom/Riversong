# Pack processed MP3 samples + manifest into src/samples.js (base64), loaded with a plain <script> tag.
import json, base64, os, sys
src, dst = sys.argv[1], sys.argv[2]
man = json.load(open(os.path.join(src, 'manifest.json')))
out = {}
for group, items in man.items():
    arr = []
    for it in items:
        b = base64.b64encode(open(os.path.join(src, it['f']), 'rb').read()).decode('ascii')
        e = {k: v for k, v in it.items() if k in ('p', 'g', 'ls', 'le')}
        e['d'] = b
        arr.append(e)
    out[group] = arr
with open(dst, 'w') as f:
    f.write('/* Riversong instrument samples: Versilian Community Sample Library (VCSL), CC0 1.0 - github.com/sgossner/VCSL */\n')
    f.write('window.RS_SAMPLES=' + json.dumps(out, separators=(',', ':')) + ';\n')
print(dst, os.path.getsize(dst) // 1024, 'KB')
