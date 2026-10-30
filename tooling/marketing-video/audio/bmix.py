"""Soundtrack for the block ads (blocks.html): close, ASMR-style block foley over a soft synthesized bed.

Everything is synthesized here, so there is no music file to license or download. The bed is a 100 BPM groove in F
(felt kick, shaker, sub bass, a Rhodes-like electric piano and a pad) on the scene's bars: the kick drops out for the
two beats the core hovers, and the core locks on the downbeat of bar 5. The foley is the point. Every contact is a
short, dry, close sound with a tuned body (bigger blocks sound lower; block snaps climb an F major pentatonic as the
system fills), placed so its loudest sample lands on the cue and panned to where the block lands.

    python3 bmix.py cues.json out.wav      cues.json from `node render.mjs cues` (PAGE=blocks.html)
FF=/path/to/ffmpeg measures loudness. The result is 48 kHz stereo at about -16 LUFS with true peaks under -1 dBTP.
"""
import json
import os
import re
import subprocess
import sys
import wave

import numpy as np

from mix import SR, band, blip, chime, env, key, noise, norm, pop, sine, sweep, swish, swoosh, tick, tt

FF = os.environ.get("FF", "ffmpeg")
BED_DB = 7.0   # how far the music bed sits under the foley (integrated loudness)


def midi(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def penta(i, base=65):
    """Degree i of the F major pentatonic (F G A C D), counting up from MIDI note `base` (an F)."""
    o, d = divmod(int(i), 5)
    return midi(base + 12 * o + [0, 2, 4, 7, 9][d])


def modal(f0, n, modes, seed):
    """A struck object: decaying partials at ratios of f0 (ratio, gain, decay seconds), random phases."""
    r = np.random.default_rng(seed)
    y = np.zeros(n)
    for m, g, tau in modes:
        y += g * sine(f0 * m, n, r.uniform(0, 6.28)) * env(n, 0.0004, tau)
    return y


def delayed(x, sec):
    k = int(sec * SR)
    return np.concatenate([np.zeros(k), x])[: len(x)]


def grains(n, seed, k=48):
    """A rough surface: sparse spikes, smoothed into an amplitude texture around 1."""
    g = np.abs(noise(n, seed)) ** 3
    g = np.convolve(g, np.ones(k) / k, mode="same")
    return g / (g.mean() + 1e-9)


# ---------- the block foley ----------
BAR = [(1, 1.0, 0.075), (2.76, 0.32, 0.03), (5.4, 0.1, 0.012)]   # a free bar's modes: a woodblock "tok"


def snap(f0, seed=0):
    """A block clicking into place: a hard transient, the latch a few ms later, a short tuned body, a low knock."""
    n = int(0.32 * SR)
    r = np.random.default_rng(seed)
    hit = band(noise(n, seed), 2000, 12500) * env(n, 0.00012, 0.0011)
    latch = delayed(band(noise(n, seed + 1), 2600, 11000) * env(n, 0.00012, 0.0008), r.uniform(0.008, 0.012))
    body = modal(f0, n, BAR, seed + 2)
    knock = sine(150, n) * env(n, 0.0008, 0.02) + 0.6 * band(noise(n, seed + 3), 100, 900) * env(n, 0.0005, 0.008)
    return norm(0.9 * hit + 0.45 * latch + 0.36 * body + 0.5 * knock)


def tock(f0, seed=0):
    """A small tile landing: brighter and lighter than a block."""
    n = int(0.22 * SR)
    hit = band(noise(n, seed), 2600, 13000) * env(n, 0.0001, 0.0008)
    body = modal(f0, n, [(1, 1.0, 0.05), (2.76, 0.3, 0.02), (5.4, 0.1, 0.008)], seed + 2)
    knock = sine(240, n) * env(n, 0.0006, 0.012)
    return norm(0.85 * hit + 0.42 * body + 0.32 * knock)


def thock(seed=5):
    """The core locking in: a deep keycap thock, a sub drop, and the whole system ringing on F."""
    n = int(1.8 * SR)
    hit = band(noise(n, seed), 1500, 10000) * env(n, 0.0002, 0.0022)
    body = modal(midi(53), n, [(1, 1.0, 0.16), (2.0, 0.4, 0.09), (2.76, 0.25, 0.05), (4.1, 0.1, 0.02)], seed)
    sub = sweep(92, 44, n) * env(n, 0.001, 0.14)
    ring = sum(g * sine(midi(m), n) for m, g in [(65, 1.0), (72, 0.5), (77, 0.32), (81, 0.18)]) * env(n, 0.002, 0.55)
    return norm(0.8 * hit + 0.55 * body + 0.85 * sub + 0.2 * ring)


def fill(f0, seed=0):
    """A module filling with color: a soft thump, a mallet note and a breath of air."""
    n = int(0.6 * SR)
    t = tt(n)
    air = band(noise(n, seed), 300, 2600) * np.minimum(1, t / 0.04) * np.exp(-np.maximum(0, t - 0.04) / 0.07)
    mallet = (sine(f0, n) + 0.22 * sine(2 * f0, n) + 0.06 * sine(4 * f0, n)) * env(n, 0.002, 0.2)
    thud = sine(118, n) * env(n, 0.002, 0.045)
    return norm(0.28 * air + 0.55 * mallet + 0.5 * thud)


def slide(dur, seed=0):
    """Friction on the table: textured noise, loudest as it sets off, fading as it slows into the snap."""
    n = int(max(0.08, dur) * SR)
    t = tt(n) / (n / SR)
    y = band(noise(n, seed), 900, 5200) * (0.4 + 0.6 * grains(n, seed + 7))
    e = np.sin(np.pi * np.minimum(1, t / 0.12) / 2) ** 2 * (1 - t) ** 1.6
    return norm(y * e)


def lift(seed=0):
    """Picked up: a short, soft rush of air."""
    n = int(0.24 * SR)
    t = tt(n) / 0.24
    return norm(band(noise(n, seed), 600, 3800) * np.sin(np.pi * t) ** 2 * (1 - t))


def clunk(hard=False, seed=0):
    """Two pieces that don't fit: a dull, inharmonic knock with a rattle (and a bounce when it's hard)."""
    n = int(0.5 * SR)
    body = modal(196, n, [(1, 1, 0.07), (1.47, 0.7, 0.05), (2.09, 0.5, 0.035), (3.3, 0.3, 0.02)], seed)
    thud = band(noise(n, seed + 1), 60, 700) * env(n, 0.0005, 0.03) + sweep(120, 58, n) * env(n, 0.001, 0.05)
    hit = band(noise(n, seed + 2), 1200, 7000) * env(n, 0.0002, 0.004)
    rattle = sum(delayed(band(noise(n, seed + 3 + i), 2000, 9000) * env(n, 0.0002, 0.0012), d) * g
                 for i, (d, g) in enumerate([(0.018, 0.5), (0.031, 0.35), (0.047, 0.22)]))
    y = 0.5 * body + 0.8 * thud + 0.5 * hit + 0.35 * rattle
    if hard:
        y = y + 0.38 * delayed(y, 0.115)
    return norm(y)


def tak(seed=0):
    """A tile settling on the table: a soft, short click with a little wood in it (pitch varies tile to tile)."""
    n = int(0.1 * SR)
    r = np.random.default_rng(300 + seed)
    hit = band(noise(n, seed), 1800, 9000) * env(n, 0.0001, 0.0009)
    body = modal(r.uniform(1150, 1700), n, [(1, 1.0, 0.018), (2.76, 0.3, 0.008)], seed)
    return norm(0.8 * hit + 0.35 * body) * r.uniform(0.75, 1.0)


def tic(seed=0):
    """The ring pulling tight: a tiny, crisp click."""
    n = int(0.08 * SR)
    return norm(band(noise(n, seed), 3000, 12500) * env(n, 0.0001, 0.0007) + 0.3 * modal(1900, n, [(1, 1, 0.01)], seed))


def press(seed=0):
    """A keycap going down: click, a short body, bottoming out."""
    n = int(0.22 * SR)
    hit = band(noise(n, seed), 1500, 9000) * env(n, 0.0002, 0.0015)
    body = modal(380, n, [(1, 1, 0.03), (2.3, 0.4, 0.015)], seed)
    bottom = sine(120, n) * env(n, 0.001, 0.022)
    return norm(0.7 * hit + 0.5 * body + 0.6 * bottom)


def release(seed=0):
    """The keycap springing back: lighter and higher."""
    n = int(0.12 * SR)
    return norm(band(noise(n, seed), 2500, 11000) * env(n, 0.0001, 0.0009) + 0.25 * modal(900, n, [(1, 1, 0.012)], seed))


def toggle(seed=0):
    """A switch: two small clicks."""
    a = tic(seed)
    return norm(a + 0.7 * delayed(a, 0.035))


def scribble(seed=0):
    """A line being written: soft pencil grain."""
    n = int(0.2 * SR)
    t = tt(n) / 0.2
    return norm(band(noise(n, seed), 2200, 7000) * grains(n, seed + 3, 24) * np.sin(np.pi * t) ** 1.5)


def rec():
    """The call's record tone: two soft bips."""
    n = int(0.3 * SR)
    a = sine(880, n) * env(n, 0.002, 0.03)
    return norm(a + delayed(sine(1318.5, n) * env(n, 0.002, 0.035), 0.09))


def softriser(dur=1.4):
    """Tension under the hovering core: filtered noise and a faint rising tone, cut off by the lock."""
    n = int(dur * SR)
    t = tt(n) / dur
    hiss = band(noise(n, 801), 1500, 7000) * t ** 2.2
    tone = sweep(220, 440, n) * t ** 3 * 0.25
    y = (hiss + tone) * (0.05 + 0.95 * t)
    y[-int(0.004 * SR):] *= np.linspace(1, 0, int(0.004 * SR))
    return norm(y)


START = {"slide", "lift", "riser", "whoosh", "scribble"}   # placed by their start; everything else by its peak


def synth(c):
    k, seed = c["type"], c.get("seed", int(c["t"] * 1000) % 97)
    s = c.get("seq", 0)
    if k == "snap":
        return snap(penta(s % 8, 65), seed)            # F4 up
    if k == "tock":
        return tock(penta(2 + s % 6, 77), seed)        # tiles: each module's tiles climb from A5
    if k == "fill":
        return fill(penta(s % 8, 65), seed)
    return {
        "thock": lambda: thock(), "slide": lambda: slide(c.get("dur", 0.4), seed), "lift": lambda: lift(seed),
        "whoosh": lambda: swoosh(), "clunk": lambda: clunk(bool(c.get("hard")), seed), "click": lambda: tic(seed),
        "tick": lambda: tick(c.get("pitch", 1.0)), "pop": lambda: pop(c.get("pitch", 1.0)), "key": lambda: key(c.get("seed", 0)),
        "press": lambda: press(seed), "release": lambda: release(seed), "chime": lambda: chime(), "blip": lambda: blip(),
        "swish": lambda: swish(), "riser": lambda: softriser(c.get("dur", 1.4)), "rec": lambda: rec(),
        "toggle": lambda: toggle(seed), "scribble": lambda: scribble(seed), "tak": lambda: tak(seed),
    }[k]()


LEVEL = {"snap": 1.0, "tock": 0.62, "thock": 1.25, "fill": 0.55, "slide": 0.16, "lift": 0.22, "whoosh": 0.3, "clunk": 1.0,
         "click": 0.42, "tick": 0.35, "pop": 0.45, "key": 0.42, "press": 0.85, "release": 0.5, "chime": 0.32, "blip": 0.35,
         "swish": 0.25, "riser": 0.2, "rec": 0.3, "toggle": 0.5, "scribble": 0.18, "tak": 0.55}


# ---------- the bed ----------
VOICE = {   # chord voicings (MIDI) and bass roots
    "F": ([53, 60, 64, 67, 69, 72], 41), "Am": ([57, 60, 64, 67, 72], 45), "Dm": ([50, 57, 60, 64, 65, 69], 38),
    "Bb": ([46, 57, 60, 62, 65, 69], 34), "Csus": ([48, 55, 60, 62, 65, 67], 36),
}


def ep(f, dur, vel=1.0):
    """A Rhodes-like FM tine: the bark fades fast, the note rings."""
    n = int(dur * SR)
    t = tt(n)
    I = 1.5 * np.exp(-t / 0.3) + 0.12
    y = np.sin(2 * np.pi * f * t + I * np.sin(2 * np.pi * f * t)) + 0.1 * np.sin(2 * np.pi * 7 * f * t) * np.exp(-t / 0.04)
    e = np.minimum(1, t / 0.004) * np.exp(-t / 0.85)
    r = int(min(0.12, dur / 3) * SR)
    e[-r:] *= np.linspace(1, 0, r)
    return y * e * vel


def kick(vel=1.0):
    n = int(0.4 * SR)
    return band(sweep(110, 50, n) * env(n, 0.001, 0.1) + 0.15 * band(noise(n, 901), 1000, 4500) * env(n, 0.0002, 0.002), 40, 8000) * vel


def shaker(seed, vel=1.0):
    n = int(0.08 * SR)
    return band(noise(n, seed), 5000, 13000) * env(n, 0.006, 0.018) * vel


def bassnote(f, dur, vel=1.0):
    n = int(dur * SR)
    t = tt(n)
    y = np.sin(2 * np.pi * f * t) + 0.35 * np.sin(4 * np.pi * f * t) + 0.12 * np.sin(6 * np.pi * f * t)   # harmonics so phones hear it
    e = np.minimum(1, t / 0.008) * np.exp(-t / 0.32)
    r = int(min(0.06, dur / 3) * SR)
    e[-r:] *= np.linspace(1, 0, r)
    return band(y * e, 45, 2000) * vel


def pad(notes, dur, seed):
    n = int(dur * SR)
    t = tt(n)
    r = np.random.default_rng(seed)
    y = sum(np.sin(2 * np.pi * midi(m) * (1 + d) * t + r.uniform(0, 6.28)) for m in notes for d in (-0.0023, 0.0023))
    e = np.minimum(1, t / 0.35) * np.minimum(1, (dur - t) / 0.3)
    return band(y * e, 80, 1800)


def put(buf, x, at, pan=0.0):
    a = int(round(at * SR))
    if a >= len(buf):
        return
    b = min(len(buf), a + len(x))
    x = x[: b - a]
    f = min(len(x), int(0.004 * SR))
    x = x.copy()
    x[len(x) - f:] *= np.linspace(1, 0, f)                               # no click where a sound's buffer ends
    gl, gr = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
    lo = max(0, -a)
    buf[max(0, a):b, 0] += x[lo:] * gl
    buf[max(0, a):b, 1] += x[lo:] * gr


def bed(meta, n):
    m = meta["music"]
    spb = 60 / m["bpm"]
    beats, lock, end = m["beats"], m["lock"], m["end"]
    CH = [(0, "F"), (4, "Am"), (8, "Dm"), (12, "Bb"), (14, "Csus"), (16, "F"), (20, "Bb"), (22, "F")]
    keys = np.zeros((n, 2))
    drums = np.zeros((n, 2))
    bass = np.zeros((n, 2))
    pads = np.zeros((n, 2))
    for i, (b0, name) in enumerate(CH):
        b1 = CH[i + 1][0] if i + 1 < len(CH) else beats
        notes, root = VOICE[name]
        # electric piano: a soft strum on the chord, an answering stab on the "and" of 2
        for j, note in enumerate(notes):
            put(keys, ep(midi(note), (b1 - b0) * spb + 0.6, 0.55 - 0.03 * j), b0 * spb + j * 0.011, -0.25 + 0.1 * j)
        for b in np.arange(b0 + 1.5, b1, 4):
            for j, note in enumerate(notes[1:]):
                put(keys, ep(midi(note), 0.42, 0.24), b * spb + j * 0.006, -0.2 + 0.08 * j)
        put(pads, pad(notes[1:], (b1 - b0) * spb + 0.3, 50 + i), b0 * spb)
        # bass: root on 1 and 3, a pickup before the next chord
        for b in np.arange(b0, b1, 2):
            if lock - 2 <= b < lock:
                continue
            put(bass, bassnote(midi(root), 1.6 * spb, 0.9), b * spb)
        if b1 - b0 >= 4:
            put(bass, bassnote(midi(root + 12), 0.4 * spb, 0.45), (b1 - 0.5) * spb)
    put(bass, bassnote(midi(36), 2 * spb, 0.7), (lock - 2) * spb)          # held under the hover
    for b in range(beats):
        if lock - 2 <= b < lock or b >= beats - 1:
            continue                                                     # the breath before the lock; let the end ring
        if b % 2 == 0:
            put(drums, kick(1.0 if b % 4 == 0 else 0.8), b * spb)
    for s16 in range(beats * 4):
        b = s16 / 4
        if lock - 2 <= b < lock or b >= beats - 1:
            continue
        sw = 0.012 if s16 % 2 else 0.0                                   # a little swing
        vel = [0.45, 0.22, 0.7, 0.25][s16 % 4] * (0.6 if b >= end else 1.0)
        put(drums, shaker(1000 + s16, vel), b * spb + sw, 0.35)
    return keys, drums, bass, pads


# ---------- space ----------
def ir(sec, decay, seed, lp=5000):
    n = int(sec * SR)
    t = tt(n)
    out = []
    for ch in range(2):
        x = noise(n, seed + ch) * np.exp(-t / decay)
        x = band(x, 120, lp)
        x[: int(0.012 * SR)] = 0                                         # pre-delay
        out.append(x / np.sqrt(np.sum(x ** 2)))
    return np.stack(out, 1)


def convolve(x, h):
    n = len(x) + len(h) - 1
    N = 1 << (n - 1).bit_length()
    y = np.zeros((len(x), 2))
    for ch in range(2):
        y[:, ch] = np.fft.irfft(np.fft.rfft(x[:, ch], N) * np.fft.rfft(h[:, ch], N), N)[: len(x)]
    return y


def tp_limit(x, ceil_db=-1.3, rel=0.06, over=4):
    """Look-ahead limiter on the true peak: the signal is band-limited-interpolated 4x to find the peaks between samples,
    the gain is already down when a peak arrives (1.5 ms look-ahead, smoothed), and recovers with a short release."""
    n = len(x)
    up = np.stack([np.fft.irfft(np.fft.rfft(x[:, c]), n * over) * over for c in range(x.shape[1])], 1)
    pk = np.abs(up).max(axis=1)[: n * over].reshape(n, over).max(axis=1)
    need = np.minimum(1.0, 10 ** (ceil_db / 20) / np.maximum(pk, 1e-9))
    L = int(0.0015 * SR)
    g = need.copy()
    for k in range(1, L):
        g[:-k] = np.minimum(g[:-k], need[k:])
    out = np.empty(n)
    cur, a = 1.0, np.exp(-1 / (rel * SR))
    for i in range(n):
        v = g[i]
        cur = v if v < cur else v + (cur - v) * a
        out[i] = cur
    out = np.convolve(out, np.ones(L) / L)[:n]
    out = np.minimum(out, g)
    return x * out[:, None]


def measure(path):
    out = subprocess.run([FF, "-hide_banner", "-nostats", "-i", path, "-af", "ebur128=peak=true", "-f", "null", "-"],
                         capture_output=True, text=True).stderr
    return float(re.findall(r"I:\s+(-?[\d.]+) LUFS", out)[-1]), float(re.findall(r"Peak:\s+(-?[\d.]+) dBFS", out)[-1])


def write(path, x):
    pcm = (np.clip(x, -1, 1) * 32767).astype("<i2")
    with wave.open(path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


def main(cues_path, out_path):
    meta = json.load(open(cues_path))
    n = int(round(meta["duration"] * SR))
    fol = np.zeros((n, 2))
    for c in meta["cues"]:
        y = synth(c) * c["gain"] * LEVEL[c["type"]]
        start = c["t"] if c["type"] in START else c["t"] - int(np.argmax(np.abs(y))) / SR
        put(fol, y, start, c.get("pan", 0.0))
    keys, drums, bass, pads = bed(meta, n)
    room = ir(0.5, 0.06, 11, 7000)                                       # a small, close room for the foley
    hall = ir(1.6, 0.25, 21, 4500)                                       # a softer space for the keys
    fol = 0.9 * fol + 0.12 * convolve(fol, room)
    music = 0.5 * keys + 0.45 * drums + 0.5 * bass + 0.06 * pads + 0.35 * convolve(0.5 * keys + 0.06 * pads, hall)
    # the bed sits a fixed distance under the foley, whatever the variant's density
    tmp = out_path + ".tmp.wav"
    write(tmp, fol / (np.abs(fol).max() + 1e-9) * 0.5)
    lf, _ = measure(tmp)
    write(tmp, music / (np.abs(music).max() + 1e-9) * 0.5)
    lm, _ = measure(tmp)
    fol = fol / (np.abs(fol).max() + 1e-9) * 0.5
    music = music / (np.abs(music).max() + 1e-9) * 0.5 * 10 ** ((lf - BED_DB - lm) / 20)
    mix = fol + music
    fade = int(0.25 * SR)
    mix[-fade:] *= np.linspace(1, 0, fade)[:, None] ** 1.5
    mix = mix / (np.abs(mix).max() + 1e-9) * 0.5
    gain = 0.0
    for _ in range(5):                                                   # find the gain that lands on -16 LUFS after limiting
        y = tp_limit(mix * 10 ** (gain / 20))
        write(tmp, y)
        lufs2, tp2 = measure(tmp)
        if abs(lufs2 + 16.0) < 0.1:
            break
        gain += -16.0 - lufs2
    os.replace(tmp, out_path)
    print(f"{out_path}: {n / SR:.3f}s  {lufs2:.1f} LUFS  {tp2:.1f} dBTP  ({len(meta['cues'])} cues; bed {BED_DB} dB under the foley)")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
