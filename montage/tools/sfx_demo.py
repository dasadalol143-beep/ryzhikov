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
rev = np.zeros((N, 2))  # шина реверберации (посыл), сворачивается в конце
def put(x, t, vol=1.0, pan=0.0, send=0.15):
    i = int((t - S0) * SR)
    if i < 0: x = x[-i:]; i = 0
    x = x[: N - i]; l, r = np.sqrt(0.5 * (1 - pan)), np.sqrt(0.5 * (1 + pan))
    for bus, k in ((mix, 1.0), (rev, send)):
        bus[i:i + len(x), 0] += x * vol * l * k; bus[i:i + len(x), 1] += x * vol * r * k
def reverb_ir(d=2.2, tau=0.55):
    n = int(d * SR); t = np.arange(n) / SR
    ir = np.stack([bp(rng.normal(size=n), 200, 9000) * np.exp(-t / tau) for _ in range(2)], 1)
    ir[: int(0.012 * SR)] = 0; return ir / np.abs(ir).sum(0).max() * 6

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

# 1. карточки — металл / стекло / бумага + печать
def metal_ting(f0=1850, d=1.4):
    t = T(d); x = sum(np.sin(2 * np.pi * f0 * m * t + i) * np.exp(-t * (3 + 4 * i)) / (1 + i * 0.7) for i, m in enumerate([1, 2.32, 4.25, 6.63, 8.9]))
    x = x * 0.5; c = slap(0.05) * 0.6; x[: len(c)] += c; return x
def glass(f0=2600, d=1.6):
    t = T(d); return sum(np.sin(2 * np.pi * f0 * m * t) * np.exp(-t * (2.2 + 2.5 * i)) / (1 + i) for i, m in enumerate([1, 2.76, 5.4, 8.93])) * env(len(t), 0.002, 9)
def swish(d=0.55, f_hi=900, f_lo=260):
    # пролёт мимо камеры: два слоя шума + тон с допплером, пик в конце (объект приближается и проходит)
    t = T(d); k = t / d; a = np.sin(np.pi * k ** 1.4) ** 2
    tone = np.sin(2 * np.pi * np.cumsum(f_hi + (f_lo - f_hi) * k ** 2) / SR) * 0.18
    return (whoosh(d, 250, 5000) * 0.8 + bp(rng.normal(size=len(t)), 80, 600) * 0.6 + tone) * a
def paper(d=0.35):
    t = T(d); x = bp(rng.normal(size=len(t)), 500, 6000) * (np.exp(-t * 30) + 0.6 * np.exp(-np.maximum(0, t - 0.09) * 40) * (t > 0.09)); return x
def stamp_hit():
    click = bp(rng.normal(size=int(0.01 * SR)), 2000, 9000) * env(int(0.01 * SR), 0.0002, 0.002) * 1.2
    knock = thud(0.25, 240, 160) * 0.7 + np.pad(thud(0.18, 520, 400), (0, 12000 - 8640)) * 0.25
    sub = thud(0.9, 70, 38) * 1.3
    rub = bp(rng.normal(size=int(0.2 * SR)), 70, 500) * env(int(0.2 * SR), 0.001, 0.05)
    out = np.zeros(int(0.9 * SR)); out[: len(click)] += click; out[: len(knock)] += knock; out[: len(sub)] += sub; out[: len(rub)] += rub; return out
def whip(d=0.28): t = T(d); return whoosh(d, 600, 9000) * np.sin(np.pi * t / d) ** 0.7 + bp(rng.normal(size=len(t)), 100, 900) * np.sin(np.pi * t / d) * 0.4

# дебет: из-за камеры, металлический звон на посадке, блик
put(swish(0.5), E["debit"] - 0.32, 0.55, -0.5, 0.2); put(metal_ting(1850), E["debit"] + 0.22, 0.16, -0.6, 0.35)
put(thud(0.35, 150, 70), E["debit"] + 0.2, 0.35, -0.5); put(shing(1.0, 4200), E["debit"] + 0.3, 0.035, -0.5, 0.5)
# инвест: из глубины, стеклянный аккорд, рост графика — восходящие тики
put(swish(0.55, 700, 300), E["invest"] - 0.35, 0.45, 0.6, 0.2); put(glass(2350), E["invest"] + 0.25, 0.12, 0.6, 0.45); put(glass(3520), E["invest"] + 0.31, 0.07, 0.7, 0.45)
for j in range(9): put(pop(900 + j * 140), E["invest"] + 0.4 + j * 0.12, 0.035, 0.6, 0.3)
# ИП: бумага, напряжение, удар печати, тряска
put(swish(0.45, 500, 200), E["ip"] - 0.3, 0.4, 0.6, 0.2); put(paper(), E["ip"] + 0.2, 0.3, 0.6, 0.2)
put(riser(0.45) * 0.8, E["hit"] - 0.45, 0.25, 0.4, 0.3)
put(stamp_hit(), E["hit"], 0.55, 0.35, 0.35); put(boom(1.4) * 0.6, E["hit"], 0.22, 0.0, 0.3)
put(paper(0.25), E["hit"] + 0.32, 0.18, 0.5)
# уход всех трёх: хлёсткий вжух в обе стороны
put(whip(), E["cardsOut"] - 0.04, 0.4, -0.8, 0.15); put(whip(), E["cardsOut"], 0.4, 0.8, 0.15)
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

ir = reverb_ir()
for ch in range(2):
    L = len(rev) + len(ir); n2 = 1 << (L - 1).bit_length()
    mix[:, ch] += np.fft.irfft(np.fft.rfft(rev[:, ch], n2) * np.fft.rfft(ir[:, ch], n2), n2)[: len(rev)]
mix = mix[: int((S1 - S0) * SR)]
with wave.open(str(P / "demo_sfx.wav"), "wb") as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes((np.clip(mix, -1, 1) * 32767).astype(np.int16).tobytes())
subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", str(S0), "-t", str(S1 - S0), "-i", str(P / "voice3_proc.wav"), "-i", str(P / "demo_sfx.wav"),
                "-filter_complex", "[1:a]volume=-2dB[s];[s][0:a]sidechaincompress=threshold=0.05:ratio=3:attack=10:release=200[sd];[0:a][sd]amix=inputs=2:normalize=0:duration=first,loudnorm=I=-14:TP=-1:LRA=10[o]",
                "-map", "[o]", "-ar", str(SR), "-ac", "2", str(P / "demo_mix.wav")], check=True)
print("->", P / "demo_mix.wav")
