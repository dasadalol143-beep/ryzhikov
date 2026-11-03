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
    if not s.get("nosnap"):  # края сегмента — в ближайший провал громкости (иначе рез режет звук слова)
        s = {**s, "in": snap(s["in"], -0.06, 0.06), "out": snap(s["out"], -0.04, 0.12)}
    # разрезаем по длинным паузам внутри сегмента
    parts, cur = [], [s["in"], None]
    for a_, b_ in zip(sw, sw[1:]):
        gap = b_["s"] - a_["e"]
        if gap > max_pause:
            # рез в самой тихой точке у краёв промежутка (в промежутке может быть «э-э», вдох, шум — его выкидываем)
            o_cut = snap(a_["e"] + 0.04, -0.04, min(0.12, gap / 2))
            i_cut = snap(b_["s"] - 0.04, -min(0.12, gap / 2), 0.04)
            parts.append((cur[0], o_cut)); cur = [i_cut, None]
    parts.append((cur[0], s["out"]))
    # паузы ПО ЗВУКУ: Whisper прячет тишину внутрь слов («Я» 0,84 с, «Суть» 0,82 с). Любая тишина > sil_max
    # внутри части вырезается, остаётся sil_keep (по половине с каждой стороны) — между словами нет «мёртвого» воздуха
    sil_max, sil_keep = E.get("sil_max", 0.16), E.get("sil_keep", 0.1)
    db = 20 * np.log10(rms + 1e-9); thr = np.percentile(db, 90) - E.get("sil_db", 24)
    split = []
    for (i, o) in parts:
        k0, k1 = int(i * 100), int(o * 100); cur_i = i; j = k0
        while j < k1:
            if db[j] < thr:
                m = j
                while m < k1 and db[m] < thr: m += 1
                if (m - j) / 100 > sil_max and j > k0 and m < k1:  # не трогаем тишину на краях части
                    split.append((cur_i, j / 100 + sil_keep / 2)); cur_i = m / 100 - sil_keep / 2
                j = m
            else: j += 1
        split.append((cur_i, o))
    # края частей: тишина в начале/конце обрезается по звуку до 0,05 с
    trimmed = []
    for (i, o) in split:
        k0, k1 = int(i * 100), int(o * 100)
        a0 = k0
        while a0 < k1 - 5 and db[a0] < thr: a0 += 1
        b0 = k1
        while b0 > a0 + 5 and db[b0 - 1] < thr: b0 -= 1
        trimmed.append((max(i, a0 / 100 - E.get("edge_in", 0.05)), min(o, b0 / 100 + E.get("edge_out", 0.06))))
    # микро-куски (< min_part) дают мигание картинки: без слов — выкидываем, со словами — склеиваем с соседом
    mp = E.get("min_part", 0.25)
    hasw = lambda a, b: any(w["e"] > a + 0.02 and w["s"] < b - 0.02 for w in sw)
    trimmed = [p for p in trimmed if p[1] - p[0] >= mp or hasw(*p)]
    merged = []
    for p in trimmed:
        if merged and (p[1] - p[0] < mp or merged[-1][1] - merged[-1][0] < mp) and p[0] - merged[-1][1] < 0.6:
            merged[-1] = (merged[-1][0], p[1])
        else: merged.append(p)
    parts = merged
    for pi, (i, o) in enumerate(parts):
        pass  # границы уже стоят по звуку (см. выше), дополнительная подгонка не нужна
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
tw = []; used = []
for c in clips:
    for w in W:
        # слово принадлежит клипу, если его конец внутри клипа (начало по Whisper часто раньше реального звука)
        we = max(w["e"], w["s"] + 0.1)  # слова нулевой длины (Whisper) тоже считаем
        if we > c["src_in"] + 0.04 and w["s"] < c["src_out"] - 0.04 and not (w["s"] < c["src_in"] - 0.02 and any(w is x for x in used)):
            used.append(w)
            tw.append({"w": w["w"], "s": round(c["t_in"] + max(w["s"], c["src_in"]) - c["src_in"], 3), "e": round(c["t_in"] + min(w["e"], c["src_out"]) - c["src_in"], 3), "seg": c["seg"]})
json.dump({"duration": round(t, 3), "clips": clips, "words": tw}, open(out, "w"), ensure_ascii=False, indent=1)
print(f"клипов {len(clips)}, длительность {t:.2f} c ({int(t // 60)}:{t % 60:04.1f}), слов {len(tw)}")
