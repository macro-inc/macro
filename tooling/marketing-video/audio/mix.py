"""Build the trailer soundtrack.

Song: Mixkit "Swish Swed" (Arulo), 120 BPM. The excerpt starts on the drop's
downbeat (kick onset measured at 40.0318 s) and runs exactly 28 beats.
UI sounds are synthesized here and each is placed by its measured peak, so the
loudest sample of every click/pop/tick lands exactly on its cue.
"""
import json
import subprocess
import wave

import numpy as np

FF = __import__("os").environ.get("FF", "/root/bin/ffmpeg")
SR = 48000
SONG = "song-swish-swed-arulo.mp3"   # Mixkit 201, "Swish Swed" by Arulo
DOWNBEAT = 40.0318      # kick onset of the drop (measured)
PREROLL = 0.004         # keep the kick's first few ms
rng = np.random.default_rng(7)


def load_stereo(path):
    raw = subprocess.run([FF, "-v", "quiet", "-i", path, "-ac", "2", "-ar", str(SR), "-f", "f32le", "-"],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.float32).reshape(-1, 2).astype(np.float64)


# ---------- synthesis helpers ----------
def tt(n):
    return np.arange(n) / SR


def env(n, a, tau):
    t = tt(n)
    return np.minimum(1, t / max(a, 1e-5)) * np.exp(-np.maximum(0, t - a) / tau)


def band(x, lo, hi):
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    m = (1 / (1 + (lo / np.maximum(f, 1)) ** 4)) * (1 / (1 + (f / hi) ** 4))
    return np.fft.irfft(X * m, len(x))


def sine(f, n, ph=0.0):
    return np.sin(2 * np.pi * f * tt(n) + ph)


def sweep(f0, f1, n):
    t = tt(n)
    f = f0 * (f1 / f0) ** (t / t[-1])
    return np.sin(2 * np.pi * np.cumsum(f) / SR)


def noise(n, seed=0):
    return np.random.default_rng(seed).standard_normal(n)


def norm(x):
    return x / (np.abs(x).max() + 1e-12)


def pad(x, n):
    return np.concatenate([x, np.zeros(max(0, n - len(x)))])[:n]


# ---------- the sound palette ----------
def click(seed=0):
    n = int(0.12 * SR)
    down = band(noise(n, seed), 2200, 9000) * env(n, 0.0003, 0.0032)
    down += 0.22 * sine(1150, n) * env(n, 0.0005, 0.010) + 0.28 * sine(185, n) * env(n, 0.0008, 0.016)
    up = np.roll(band(noise(n, seed + 1), 2600, 10000) * env(n, 0.0003, 0.0025), int(0.075 * SR)) * 0.32
    return norm(down + up)


def key(seed=0):
    n = int(0.06 * SR)
    r = np.random.default_rng(100 + seed)
    k = r.uniform(0.85, 1.18)
    y = band(noise(n, 200 + seed), 1500 * k, 6500 * k) * env(n, 0.0004, 0.0038)
    y += 0.3 * sine(310 * k, n) * env(n, 0.0006, 0.010)
    return norm(y) * r.uniform(0.8, 1.0)


def enter():
    n = int(0.12 * SR)
    y = band(noise(n, 31), 1200, 5500) * env(n, 0.0004, 0.005)
    y += 0.7 * sine(135, n) * env(n, 0.001, 0.035) + 0.2 * band(noise(n, 32), 400, 2500) * env(n, 0.001, 0.012)
    return norm(y)


def tick(pitch=1.0):
    n = int(0.09 * SR)
    f = 1760 * pitch
    y = sine(f, n) * env(n, 0.0012, 0.028) + 0.12 * sine(2 * f, n) * env(n, 0.001, 0.012)
    y += 0.25 * band(noise(n, 41), 3000, 9000) * env(n, 0.0002, 0.0015)
    return norm(y)


def pop(pitch=1.0):
    n = int(0.12 * SR)
    y = sweep(420 * pitch, 980 * pitch, n) * env(n, 0.002, 0.034)
    y += 0.18 * band(noise(n, 51), 1500, 6000) * env(n, 0.0003, 0.002)
    return norm(y)


def blip():
    n = int(0.2 * SR)
    y = sine(1318.5, n) * env(n, 0.003, 0.06) + 0.15 * sine(2637, n) * env(n, 0.002, 0.03)
    return norm(y)


def chime():
    n = int(0.75 * SR)
    y = np.zeros(n)
    for f, dt, g in [(1568.0, 0.0, 1.0), (2093.0, 0.055, 0.8)]:
        m = n - int(dt * SR)
        note = sine(f, m) + 0.1 * sine(f * 2.76, m) + 0.05 * sine(f * 5.4, m)
        e = env(m, 0.002, 0.2) * (1 - 0.3 * np.exp(-tt(m) / 0.02))
        y[int(dt * SR):] += g * note * e
    return norm(y)


def swish(dur=0.16, lo=900, hi=5200, seed=61):
    n = int(dur * SR)
    t = tt(n) / dur
    e = np.sin(np.pi * np.minimum(1, t / 0.35) / 2) ** 2 * np.exp(-np.maximum(0, t - 0.35) * 5)
    return norm(band(noise(n, seed), lo, hi) * e)


def swoosh():
    n = int(0.26 * SR)
    t = tt(n) / (n / SR)
    lo = band(noise(n, 71), 350, 1600)
    hi = band(noise(n, 72), 1400, 6000)
    y = lo * (1 - t) + hi * t
    e = np.sin(np.pi * np.minimum(1, t / 0.3) / 2) ** 2 * np.exp(-np.maximum(0, t - 0.3) * 4.5)
    return norm(y * e)


def grab():
    n = int(0.06 * SR)
    y = band(noise(n, 81), 1200, 5200) * env(n, 0.0003, 0.003) + 0.35 * sine(700, n) * env(n, 0.0006, 0.012)
    return norm(y)


def stretch():
    n = int(0.16 * SR)
    y = sweep(520, 610, n) * env(n, 0.02, 0.05) + 0.2 * band(noise(n, 91), 800, 3000) * env(n, 0.01, 0.03)
    return norm(y)


def release():
    n = int(0.16 * SR)
    y = sweep(190, 118, n) * env(n, 0.002, 0.05) + 0.4 * band(noise(n, 95), 2400, 9000) * env(n, 0.0003, 0.0025)
    return norm(y)


def hover():
    n = int(0.05 * SR)
    return norm(sine(1240, n) * env(n, 0.001, 0.012))


SYNTH = {
    "click": lambda c: click(int(c["t"] * 1000) % 97),
    "key": lambda c: key(c.get("seed", int(c["t"] * 1000) % 50)),
    "enter": lambda c: enter(),
    "tick": lambda c: tick(c.get("pitch", 1.0)),
    "pop": lambda c: pop(c.get("pitch", 1.0)),
    "blip": lambda c: blip(),
    "chime": lambda c: chime(),
    "swish": lambda c: swish(),
    "swoosh": lambda c: swoosh(),
    "grab": lambda c: grab(),
    "stretch": lambda c: stretch(),
    "release": lambda c: release(),
    "hover": lambda c: hover(),
}
LEVEL = {  # per-type bus level (linear, relative to the UI bus)
    "click": 1.0, "key": 0.55, "enter": 0.8, "tick": 0.55, "pop": 0.55, "blip": 0.5, "chime": 0.5,
    "swish": 0.35, "swoosh": 0.4, "grab": 0.8, "stretch": 0.35, "release": 0.5, "hover": 0.35,
}


SONGS = {  # Mixkit Stock Music Free License
    "ambient": ("song-ambient-kodama-night-town.mp3", 11.6186),  # section entry downbeat  # "Kodama Night Town", Alejandro Magaña; section entry downbeat
    "funk": ("song-funk-are-u-ready.mp3", 17.8605),              # "Are U Ready For This?"; accented bar downbeat
}


def main():
    meta = json.load(open("cues.json"))
    dur = meta["duration"]
    n = int(round(dur * SR))

    # Alternate the two songs; each resumes where it left off. Cuts land on bar lines,
    # with a 4 ms declick. The loop end is a cut too: no fade-out.
    decoded = {k: load_stereo(f) for k, (f, _) in SONGS.items()}
    pos = {k: off for k, (_, off) in SONGS.items()}
    parts = []
    for song, bpm, beats in meta["music"]:
        length = sum(beats) * 60 / bpm
        x = decoded[song]
        a0 = int(round((pos[song] - PREROLL) * SR))
        seg = x[a0:a0 + int(round(length * SR))].copy()
        seg /= np.sqrt(np.mean(seg ** 2)) + 1e-9          # match loudness across songs
        seg *= 0.2
        d = int(0.004 * SR)
        seg[:d] *= np.linspace(0, 1, d)[:, None]
        seg[-d:] *= np.linspace(1, 0, d)[:, None]
        parts.append(seg)
        pos[song] += length
    music = np.concatenate(parts)
    music = np.pad(music, ((0, max(0, n - len(music))), (0, 0)))[:n]

    ui = np.zeros(n)
    placed = []
    for c in meta["cues"]:
        y = SYNTH[c["type"]](c) * c["gain"] * LEVEL[c["type"]]
        peak = int(np.argmax(np.abs(y)))                  # measured peak of this sound
        start = int(round(c["t"] * SR)) - peak           # peak lands on the cue (video time)
        for k in (0, -n):                                 # wrap sounds across the loop point
            a, b = start + k, start + k + len(y)
            lo, hi = max(0, a), min(n, b)
            if hi > lo:
                ui[lo:hi] += y[lo - a:hi - a]
        placed.append((c["type"], round(c["t"], 3), peak))

    music_gain, ui_gain, master_db = 1.0, 0.42, -3.0
    mix = (music * music_gain + ui[:, None] * ui_gain) * 10 ** (master_db / 20)
    peak = np.abs(mix).max()
    if peak > 0.97:
        mix *= 0.97 / peak
    pcm = (np.clip(mix, -1, 1) * 32767).astype("<i2")
    with wave.open("mix.wav", "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    # UI-only stem for level checks
    pcm_ui = (np.clip(ui * ui_gain * 10 ** (master_db / 20), -1, 1) * 32767).astype("<i2")
    with wave.open("ui.wav", "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm_ui.tobytes())
    print(f"mix.wav {n / SR:.3f}s  peak {20 * np.log10(np.abs(mix).max()):.2f} dBFS  ui peak {20 * np.log10(np.abs(ui * ui_gain * 10 ** (master_db / 20)).max()):.2f} dBFS")
    print("placed", len(placed), "cues; e.g.", placed[:4])


if __name__ == "__main__":
    main()
