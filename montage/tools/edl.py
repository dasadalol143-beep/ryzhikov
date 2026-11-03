"""Монтажный лист → точные склейки по тишине + сжатие пауз → timeline.json
python3 montage/tools/edl.py <edl.json> <words.json> <voice16k.wav> <out_timeline.json>

edl.json: {"segments": [{"in": 13.30, "out": 19.98, "note": "хук"}, ...], "max_pause": 0.4, "keep_pause": 0.16}
Для каждой границы ищется минимум громкости в окне ±0,15 с, чтобы не срезать звук слова.
Паузы внутри сегмента длиннее max_pause сжимаются до keep_pause (сегмент режется на клипы).
timeline.json: clips [{src_in, src_out, t_in, t_out, seg}] и words, пересчитанные во время таймлайна.
"""
import json, sys, wave, numpy as np

edl, words, wav, out = sys.argv[1:5]
E = json.load(open(edl)); W = json.load(open(words))
with wave.open(wav) as w:
    sr = w.getframerate(); a = np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(np.float32) / 32768
hop = int(sr * 0.01)
rms = np.sqrt(np.convolve(a ** 2, np.ones(hop * 2) / (hop * 2), "same"))[::hop]  # 10 мс

def snap(t, lo=-0.15, hi=0.15):
    i0, i1 = max(0, int((t + lo) * 100)), min(len(rms) - 1, int((t + hi) * 100))
    return (i0 + int(np.argmin(rms[i0:i1 + 1]))) / 100 if i1 > i0 else t

max_pause, keep = E.get("max_pause", 0.4), E.get("keep_pause", 0.16)
clips, t = [], 0.0
for si, s in enumerate(E["segments"]):
    sw = [w for w in W if w["s"] >= s["in"] - 0.05 and w["e"] <= s["out"] + 0.05]
    # разрезаем по длинным паузам внутри сегмента
    parts, cur = [], [s["in"], None]
    for a_, b_ in zip(sw, sw[1:]):
        gap = b_["s"] - a_["e"]
        if gap > max_pause:
            parts.append((cur[0], a_["e"] + keep / 2)); cur = [b_["s"] - keep / 2, None]
    parts.append((cur[0], s["out"]))
    for pi, (i, o) in enumerate(parts):
        if not s.get("nosnap"):  # nosnap: граница стоит жёстко (рядом чужое слово, подгонка могла бы его захватить)
            i = snap(i, -0.08, 0.06) if pi == 0 else i
            o = snap(o, -0.06, 0.12) if pi == len(parts) - 1 else o
        clips.append({"src_in": round(i, 3), "src_out": round(o, 3), "t_in": round(t, 3), "t_out": round(t + o - i, 3), "seg": si, "note": s.get("note", "")})
        t += o - i
# квантуем по кадрам: длительность клипа = целое число кадров, звук режется на ту же длину (иначе рассинхрон губ на склейках)
FPS = E.get("fps", 24000 / 1001)
t = 0.0
for c in clips:
    n = max(1, round((c["src_out"] - c["src_in"]) * FPS))
    c["frames"] = n; c["src_out"] = round(c["src_in"] + n / FPS, 4)
    c["t_in"] = round(t, 4); t += n / FPS; c["t_out"] = round(t, 4)
# слова → время таймлайна
tw = []
for c in clips:
    for w in W:
        if w["s"] >= c["src_in"] - 0.02 and w["s"] < c["src_out"]:
            tw.append({"w": w["w"], "s": round(c["t_in"] + w["s"] - c["src_in"], 3), "e": round(c["t_in"] + min(w["e"], c["src_out"]) - c["src_in"], 3), "seg": c["seg"]})
json.dump({"duration": round(t, 3), "clips": clips, "words": tw}, open(out, "w"), ensure_ascii=False, indent=1)
print(f"клипов {len(clips)}, длительность {t:.2f} c ({int(t // 60)}:{t % 60:04.1f}), слов {len(tw)}")
