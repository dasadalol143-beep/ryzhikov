"""Своя фоновая подложка без прав третьих лиц: тёплый пад + саб-бас + мягкий ритм, 90 BPM, Am–F–C–G.
python3 montage/tools/music_bed.py <out.wav> <длительность_сек> [--bpm 90] [--drums_from 6.8] [--breaks 0:0.6,42.1:0.8]
--breaks: моменты тишины в музыке (сек:длительность) — приём «музыка обрывается» на крючках.
Это временная подложка: лучше заменить лицензированным треком (montage/assets/music/).
"""
import argparse, wave, numpy as np
ap = argparse.ArgumentParser(); ap.add_argument("out"); ap.add_argument("dur", type=float)
ap.add_argument("--bpm", type=float, default=90); ap.add_argument("--drums_from", type=float, default=0)
ap.add_argument("--breaks", default=""); a = ap.parse_args()
SR = 48000; N = int(a.dur * SR); t = np.arange(N) / SR
beat = 60 / a.bpm; bar = 4 * beat
rng = np.random.default_rng(3)
midi = lambda m: 440 * 2 ** ((m - 69) / 12)
chords = [[57, 60, 64, 69], [53, 57, 60, 65], [48, 55, 60, 64], [55, 59, 62, 67]]  # Am F C G
bass = [45, 41, 48, 43]

def lp(x, k):  # однополюсный фильтр НЧ
    y = np.empty_like(x); acc = 0.0
    for i in range(len(x)): acc += k * (x[i] - acc); y[i] = acc
    return y

pad = np.zeros(N); sub = np.zeros(N)
idx = (t // (2 * bar)).astype(int) % 4
for ci in range(4):
    m = idx == ci
    if not m.any(): continue
    tt = t[m]
    for n in chords[ci]:
        for det in (-0.08, 0.0, 0.07):
            f = midi(n) * 2 ** (det / 12)
            ph = 2 * np.pi * f * tt
            pad[m] += (np.sin(ph) + 0.35 * np.sin(2 * ph) + 0.12 * np.sin(3 * ph)) / 9
    sub[m] += np.sin(2 * np.pi * midi(bass[ci] - 12) * tt) * 0.9
# мягкая атака аккордов на смене
pos = (t % (2 * bar)) / (2 * bar)
pad *= np.minimum(1, pos * 12) * (0.85 + 0.15 * np.sin(2 * np.pi * t / bar))
pad = np.convolve(pad, np.ones(24) / 24, "same")  # смягчить верх
# «пульс» под бит, как сайдчейн
bpos = (t % beat) / beat
duck = 1 - 0.35 * np.exp(-bpos * 6)
pad *= duck; sub *= duck
# ритм: мягкая бочка на 1 и 3, хэт на восьмые
drums = np.zeros(N)
kick_t = np.arange(0, 0.35, 1 / SR); kick = np.sin(2 * np.pi * np.cumsum(55 + 90 * np.exp(-kick_t * 30)) / SR) * np.exp(-kick_t * 9)
hat_t = np.arange(0, 0.05, 1 / SR); hat = rng.normal(size=len(hat_t)) * np.exp(-hat_t * 90)
hat = hat - np.convolve(hat, np.ones(6) / 6, "same")
k = a.drums_from
while k < a.dur:
    i = int(k * SR)
    for j, b in enumerate(np.arange(0, 4, 0.5)):
        p = i + int(b * beat * SR)
        if p >= N: break
        if b in (0, 2): drums[p:p + len(kick)] += kick[:N - p] * 0.55
        drums[p:p + len(hat)] += hat[:N - p] * (0.08 if b % 1 else 0.05)
    k += bar
mix = pad * 0.5 + sub * 0.22 + drums
# вступление и финал плавно
mix *= np.minimum(1, t / 1.5) * np.minimum(1, (a.dur - t) / 2.5)
for br in filter(None, a.breaks.split(",")):
    s, d = map(float, br.split(":"))
    g = np.ones(N); i0, i1 = int(s * SR), int((s + d) * SR)
    g[i0:i1] = 0; ramp = int(0.04 * SR)
    g[max(0, i0 - ramp):i0] = np.linspace(1, 0, min(ramp, i0)); g[i1:i1 + ramp] = np.linspace(0, 1, len(g[i1:i1 + ramp]))
    mix *= g
mix /= np.max(np.abs(mix)) + 1e-9
st = np.stack([mix * 0.9, np.roll(mix, int(0.012 * SR)) * 0.9], 1)  # лёгкая ширина
with wave.open(a.out, "wb") as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes((st * 32767 * 0.89).astype(np.int16).tobytes())
print("->", a.out, f"{a.dur:.1f} c")
