"""Саунд-дизайн отрывка MotionDemo: синтез звуков под каждое событие графики + голос → demo_mix.wav (−14 LUFS).
python3 montage/tools/sfx_demo.py projects/v14k <events.json>
events.json — DEMO_EV из remotion/src/v4/MotionDemo.tsx (время таймлайна), S0/S1 — границы отрывка.
"""
import json, sys, subprocess, wave, pathlib, numpy as np
P = pathlib.Path(sys.argv[1]); E = json.load(open(sys.argv[2])); S0, S1 = E["S0"], E["S1"]
SR = 48000; N = int((S1 - S0) * SR) + SR; mix = np.zeros((N, 2)); rng = np.random.default_rng(11)
T = lambda d: np.arange(int(d * SR)) / SR
def env(n, a, r): t = np.arange(n) / SR; return np.minimum(1, t / max(a, 1e-4)) * np.exp(-t / r)
def bp(x, lo, hi):
    X = np.fft.rfft(x); f = np.fft.rfftfreq(len(x), 1 / SR); X[(f < lo) | (f > hi)] = 0; return np.fft.irfft(X, len(x))
def put(x, t, vol=1.0, pan=0.0):
    i = int((t - S0) * SR)
    if i < 0: x = x[-i:]; i = 0
    x = x[: N - i]; l, r = np.sqrt(0.5 * (1 - pan)), np.sqrt(0.5 * (1 + pan))
    mix[i:i + len(x), 0] += x * vol * l; mix[i:i + len(x), 1] += x * vol * r

def whoosh(d=0.5, lo=300, hi=7000, up=True):
    x = rng.normal(size=int(d * SR)); t = T(d); k = t / d
    sweep = np.concatenate([bp(seg, lo + (hi - lo) * (j / 12 if up else 1 - j / 12), lo + (hi - lo) * ((j + 1) / 12 if up else 1 - j / 12) + 400) for j, seg in enumerate(np.array_split(x, 12))])
    return sweep * np.sin(np.pi * k) ** 1.5
def shing(d=0.9, f0=2800):
    t = T(d); return sum(np.sin(2 * np.pi * f0 * m * t * (1 + 0.15 * t)) / (i + 1) for i, m in enumerate([1, 1.5, 2.01])) * env(len(t), 0.005, 0.25)
def thud(d=0.6, f0=70, f1=38):
    t = T(d); f = f1 + (f0 - f1) * np.exp(-t * 18); return np.sin(2 * np.pi * np.cumsum(f) / SR) * env(len(t), 0.002, 0.18)
def slap(d=0.2): t = T(d); return bp(rng.normal(size=len(t)), 400, 5000) * env(len(t), 0.0005, 0.02)
def boom(d=1.6): return thud(d, 90, 32) * 1.2 + bp(rng.normal(size=int(d * SR)), 30, 200) * env(int(d * SR), 0.01, 0.4) * 0.6
def riser(d=1.2):
    t = T(d); k = t / d; return (bp(rng.normal(size=len(t)), 800, 9000) * 0.5 + np.sin(2 * np.pi * np.cumsum(200 + 1600 * k ** 2) / SR) * 0.25) * k ** 2.2
def tick(): t = T(0.03); return np.sin(2 * np.pi * 3800 * t) * env(len(t), 0.0003, 0.004)
def coin(f=3200):
    t = T(0.7); return sum(np.sin(2 * np.pi * f * m * t) * np.exp(-t * (6 + 3 * i)) / (i + 1) for i, m in enumerate([1, 2.76, 5.4]))
def flick(): t = T(0.09); return bp(rng.normal(size=len(t)), 1500, 8000) * env(len(t), 0.001, 0.02)
def pop(f=900): t = T(0.12); return np.sin(2 * np.pi * np.cumsum(f * (1 + 2 * np.exp(-t * 60))) / SR) * env(len(t), 0.001, 0.03)
def pad(d, notes=(45, 52, 57, 60)):
    t = T(d); m = lambda n: 440 * 2 ** ((n - 69) / 12)
    x = sum(np.sin(2 * np.pi * m(n) * t) + 0.3 * np.sin(2 * np.pi * 2 * m(n) * t) for n in notes) / len(notes)
    return x * np.minimum(1, t / 0.6) * np.minimum(1, (d - t) / 0.5) * (0.85 + 0.15 * np.sin(2 * np.pi * t * 1.5))
def flutter(d):
    t = T(d); return bp(rng.normal(size=len(t)), 1200, 6000) * (0.4 + 0.6 * np.abs(np.sin(2 * np.pi * 11 * t))) * np.minimum(1, t / 0.2) * np.minimum(1, (d - t) / 0.5)

# 1. карточки
for k, pan in (("debit", -0.6), ("invest", 0.6), ("ip", 0.6)):
    put(whoosh(0.45), E[k] - 0.18, 0.35, pan); put(shing(0.8, 2600 if k != "invest" else 3100), E[k] + 0.25, 0.08, pan)
put(thud(0.5, 110, 45), E["ip"] + 0.4, 0.6, 0.6); put(slap(), E["ip"] + 0.4, 0.4, 0.6)
put(whoosh(0.4, up=False), E["cardsOut"], 0.3)
# 2. ПОЧЕМУ
put(riser(0.6), E["why"] - 0.55, 0.2); put(boom(1.2), E["why"], 0.45)
for i in range(6): put(pop(500 + i * 60), E["why"] + i * 0.035, 0.12)
put(whoosh(0.3), E["pay"] - 0.1, 0.18)
# 3. сцена банков
put(shing(1.0, 2200), E["scene"][0] + 0.12, 0.1); put(boom(1.8), E["scene"][0], 0.5); put(whoosh(0.5, up=False), E["scene"][0] - 0.15, 0.3)
put(pad(E["scene"][1] - E["scene"][0]) * 0.5, E["scene"][0], 0.12)
for i in range(5): put(thud(0.4, 80, 40), E["banks"] + i * 0.09 + 0.12, 0.35, -0.8 + i * 0.4)
for j in range(40):  # счётчик: тики разгоняются и тормозят
    q = j / 39; tt = E["b200"] + 1.4 * (1 - (1 - q) ** 0.5)
    put(tick(), tt, 0.18)
put(coin(2600), E["b200"] + 1.42, 0.25); put(coin(3400), E["b200"] + 1.5, 0.18)
put(flutter(3.0), E["b200"] + 0.1, 0.10)
for i in range(3): put(flick(), E["year"] + i * 0.16, 0.35, 0.7)
put(whoosh(0.5), E["attract"], 0.25)
for i in range(18): put(pop(700 + (i % 5) * 120), E["clients"] + 0.3 + i * 0.07, 0.06, -0.8 + (i % 5) * 0.4)
put(shing(1.2, 1800), E["own"], 0.12)
# 4. ТЫ
put(riser(0.9), E["you"] - 0.85, 0.22); put(boom(1.8), E["you"], 0.6); put(whoosh(0.35, up=False), E["you"] - 0.05, 0.25)
for i in range(6):
    tt = E["attract2"] + i * 0.12 + 0.3; put(pop(1100), tt, 0.12, [-0.8, 0.8, -0.9, 0.9, -0.4, 0.4][i]); put(coin(3000 + i * 150), tt + 0.12, 0.1, [-0.8, 0.8, -0.9, 0.9, -0.4, 0.4][i])

mix = mix[: int((S1 - S0) * SR)]
with wave.open(str(P / "demo_sfx.wav"), "wb") as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes((np.clip(mix, -1, 1) * 32767).astype(np.int16).tobytes())
subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", str(S0), "-t", str(S1 - S0), "-i", str(P / "voice3_proc.wav"), "-i", str(P / "demo_sfx.wav"),
                "-filter_complex", "[1:a]volume=-2dB[s];[s][0:a]sidechaincompress=threshold=0.05:ratio=3:attack=10:release=200[sd];[0:a][sd]amix=inputs=2:normalize=0:duration=first,loudnorm=I=-14:TP=-1:LRA=10[o]",
                "-map", "[o]", "-ar", str(SR), "-ac", "2", str(P / "demo_mix.wav")], check=True)
print("->", P / "demo_mix.wav")
