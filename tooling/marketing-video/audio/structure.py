"""Beat phase, downbeat and per-bar energy map for one track.

usage: python3 structure.py cand/201.mp3 BPM
"""
import sys

import numpy as np

from analyze import FPS, NFFT, SR, fold_sharpness, load, onset_env, stft_mag

path, bpm = sys.argv[1], float(sys.argv[2])
x = load(path)
mag = stft_mag(x)
period = FPS * 60 / bpm  # frames per beat

# Beat phase from the kick band: fold the low-band onset envelope at the beat period.
low = onset_env(mag, 20, 150)
_, hist = fold_sharpness(low, period, bins=96)
peak_bin = int(np.argmax(hist))
# parabolic refine on the circular histogram
a, b, c = hist[(peak_bin - 1) % 96], hist[peak_bin], hist[(peak_bin + 1) % 96]
off = 0.5 * (a - c) / (a - 2 * b + c + 1e-12)
phase_frames = ((peak_bin + 0.5 + off) / 96) * period
# STFT frame i is centered at i*HOP + NFFT/2 samples; onset flux at frame i marks the attack.
beat0 = (phase_frames * (SR / FPS) + NFFT / 2) / SR  # seconds of the first beat in the grid

nbeats = int((len(x) / SR - beat0) / (60 / bpm))
beat_t = beat0 + np.arange(nbeats) * 60 / bpm

# Per-beat band energies (dB) for novelty + map.
freqs = np.fft.rfftfreq(NFFT, 1 / SR)
bands = [(20, 150), (150, 2000), (2000, 6000), (6000, 11000)]
power = mag**2
band_e = np.stack([power[:, (freqs >= lo) & (freqs < hi)].sum(1) for lo, hi in bands], 1)
feats = []
for t in beat_t:
    i0 = int(t * FPS)
    i1 = int((t + 60 / bpm) * FPS)
    feats.append(10 * np.log10(band_e[i0:i1].mean(0) + 1e-9))
feats = np.array(feats)
nov = np.r_[0, np.linalg.norm(np.diff(feats, axis=0), axis=1)]
scores = [nov[r::4].mean() for r in range(4)]
down = int(np.argmax(scores))
print(f"bpm={bpm} beat0={beat0:.4f}s  downbeat offset r={down} scores={np.round(scores, 2)}")

# Bar map (from the downbeat)
bars = (nbeats - down) // 4
ref = feats.max(0)
print("bar  t(s)    low  mid  hi   air  | novelty at bar start")
for k in range(bars):
    i = down + 4 * k
    e = feats[i : i + 4].mean(0) - ref
    bar = "".join("#" if v > -6 else ("+" if v > -12 else ("." if v > -20 else " ")) for v in e)
    print(f"{k:3d} {beat_t[i]:6.2f}  {e[0]:5.1f}{e[1]:5.1f}{e[2]:5.1f}{e[3]:5.1f}  [{bar}]  {nov[i]:5.2f}")
