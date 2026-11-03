"""Обязательная проверка монтажа: в готовом голосе не должно быть пауз длиннее порога. Падает с кодом 1.
python3 montage/tools/qa_pauses.py <voice.wav> [--max 0.12] [--skip_end 0.8]
"""
import argparse, sys, wave, numpy as np
ap = argparse.ArgumentParser(); ap.add_argument("wav"); ap.add_argument("--max", type=float, default=0.12); ap.add_argument("--skip_end", type=float, default=0.8)
a = ap.parse_args()
with wave.open(a.wav) as w:
    x = np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(np.float32).reshape(-1, w.getnchannels()).mean(1) / 32768; sr = w.getframerate()
hop = int(sr * 0.01); r = np.sqrt(np.convolve(x ** 2, np.ones(hop * 3) / (hop * 3), "same"))[::hop]; db = 20 * np.log10(r + 1e-9)
thr = np.percentile(db, 90) - 24; low = db < thr; bad = []; i = 0; n = len(low) - int(a.skip_end * 100)
while i < n:
    if low[i]:
        j = i
        while j < len(low) and low[j]: j += 1
        if (j - i) / 100 > a.max and i > 30: bad.append((i / 100, (j - i) / 100))
        i = j
    else: i += 1
for s, d in bad: print(f"ПАУЗА {s:7.2f} c  {d:.2f} c")
print("OK: пауз длиннее %.2f c нет" % a.max if not bad else f"ОШИБКА: {len(bad)} пауз длиннее {a.max} c"); sys.exit(1 if bad else 0)
