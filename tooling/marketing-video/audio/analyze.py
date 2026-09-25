"""Beat analysis with numpy only.

Onset envelope = log-magnitude spectral flux. Tempo = the beat period whose
fold of the whole-track envelope is sharpest (constant-tempo electronic music
folds into a very sharp comb only at its exact period).
"""
import json
import subprocess
import sys

import numpy as np

FF = __import__("os").environ.get("FF", "/root/bin/ffmpeg")
SR = 22050
HOP = 256
NFFT = 2048
FPS = SR / HOP


def load(path, sr=SR, channels=1):
    raw = subprocess.run(
        [FF, "-v", "quiet", "-i", path, "-ac", str(channels), "-ar", str(sr), "-f", "f32le", "-"],
        capture_output=True,
        check=True,
    ).stdout
    x = np.frombuffer(raw, np.float32)
    return x.reshape(-1, channels) if channels > 1 else x


def stft_mag(x):
    win = np.hanning(NFFT).astype(np.float32)
    n = 1 + (len(x) - NFFT) // HOP
    idx = np.arange(NFFT)[None, :] + HOP * np.arange(n)[:, None]
    frames = x[idx] * win
    return np.abs(np.fft.rfft(frames, axis=1))


def onset_env(mag, lo_hz=0, hi_hz=SR / 2):
    freqs = np.fft.rfftfreq(NFFT, 1 / SR)
    band = (freqs >= lo_hz) & (freqs < hi_hz)
    s = np.log1p(100 * mag[:, band])
    flux = np.maximum(0, np.diff(s, axis=0)).sum(axis=1)
    flux = np.concatenate([[0], flux])
    # remove slow trend so loud sections don't dominate
    k = int(FPS * 1.0)
    trend = np.convolve(flux, np.ones(k) / k, mode="same")
    env = np.maximum(0, flux - trend)
    return env / (env.max() + 1e-9)


def fold_sharpness(env, period_frames, bins=48):
    n = np.arange(len(env))
    phase = (n / period_frames) % 1.0
    hist = np.bincount((phase * bins).astype(int), weights=env, minlength=bins)
    hist = hist / (hist.sum() + 1e-9)
    return hist.max() * bins, hist  # 1.0 = flat, higher = sharper


def tempo(env, lo=90, hi=150):
    bpms = np.arange(lo, hi, 0.05)
    scores = np.array([fold_sharpness(env, FPS * 60 / b)[0] for b in bpms])
    i = int(np.argmax(scores))
    # refine
    fine = np.arange(bpms[i] - 0.06, bpms[i] + 0.06, 0.002)
    fs = np.array([fold_sharpness(env, FPS * 60 / b, bins=96)[0] for b in fine])
    j = int(np.argmax(fs))
    return fine[j], fs[j], scores


def analyze(path):
    x = load(path)
    mag = stft_mag(x)
    env = onset_env(mag)
    bpm, sharp, _ = tempo(env)
    half = len(env) // 2
    b1, _, _ = tempo(env[:half], bpm - 2, bpm + 2)
    b2, _, _ = tempo(env[half:], bpm - 2, bpm + 2)
    return dict(bpm=round(float(bpm), 3), sharp=round(float(sharp), 2), drift=round(float(abs(b1 - b2)), 3), dur=round(len(x) / SR, 1))


if __name__ == "__main__":
    cat = {r["url"].split("/")[-1]: r for r in json.load(open("catalog.json"))}
    out = []
    for f in sys.argv[1:]:
        key = f.split("/")[-1]
        try:
            a = analyze(f)
        except Exception as e:  # noqa: BLE001
            print(key, "ERR", e)
            continue
        a.update(file=key, name=cat.get(key, {}).get("name"), genre=cat.get(key, {}).get("genre"))
        out.append(a)
        print(f"{key:10s} {a['bpm']:8.3f}  sharp={a['sharp']:5.2f}  drift={a['drift']:.3f}  {a['genre']:12s} {a['name']}", flush=True)
    json.dump(out, open("tempo.json", "w"), indent=1)
