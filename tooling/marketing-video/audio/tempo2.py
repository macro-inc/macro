import json, sys
import numpy as np
from analyze import load, stft_mag, onset_env, tempo, fold_sharpness, FPS
cat = {r["url"].split("/")[-1]: r for r in json.load(open("catalog2.json"))}
for f in sys.argv[1:]:
    k = f.split("/")[-1]; r = cat.get(k, {})
    try:
        x = load(f); env = onset_env(stft_mag(x))
        b, sh, _ = tempo(env, 70, 130)
        lowband = onset_env(stft_mag(x), 20, 150); _, shl, _ = tempo(lowband, b - 1, b + 1)
        rms = float(np.sqrt(np.mean(x ** 2)))
        print(f"{k:10s} {b:7.2f} sharp={sh:5.2f} kick={shl:5.2f} rms={rms:.3f} {r.get('genre','')[:12]:12s} {r.get('name')}", flush=True)
    except Exception as e:
        print(k, "ERR", e)
