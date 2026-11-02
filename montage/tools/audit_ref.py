"""Покадровый аудит монтажа: измеряет то, что глазом легко пропустить.
python3 montage/tools/audit_ref.py <video> [--words words.json]
Пишет рядом с видео:
  audit.csv        t, lum, top, bot, sharp, sat, diff, face_w, face_cx, face_cy, yellow, white
  audit.png        графики по времени (яркость, резкость, зум по лицу, насыщенность, смена кадра, текст)
  audit_events.txt найденные события: вспышки, затемнения, размытые переходы, склейки, зумы, Ч/Б, смены текста
Метрики:
  lum   средняя яркость (0–255): вспышка = скачок вверх, затемнение = провал
  top/bot  яркость верхних 20% / нижних 30% относительно середины: затемнение низа под текст < 1
  sharp  резкость (дисперсия Лапласиана, центр кадра): провал = переход через размытие
  sat   насыщенность: ≈0 = чёрно-белый участок
  diff  среднее изменение к прошлому кадру: пик = склейка
  face_w  ширина лица / ширина кадра: рост = наезд, скачок = пробивка или джамп-кат
  yellow / white  доля жёлтых-светящихся / ярко-белых пикселей в нижних 55% (активность текста)
"""
import argparse, csv, json, pathlib
import numpy as np, cv2
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

ROOT = pathlib.Path(__file__).resolve().parent.parent
ap = argparse.ArgumentParser(); ap.add_argument("video"); ap.add_argument("--words"); a = ap.parse_args()
vid = pathlib.Path(a.video); out = vid.parent
cap = cv2.VideoCapture(str(vid)); fps = cap.get(cv2.CAP_PROP_FPS); W = int(cap.get(3)); H = int(cap.get(4))
SW, SH = 360, int(360 * H / W)
det = cv2.FaceDetectorYN.create(str(ROOT / "models/face/yunet.onnx"), "", (SW, SH), 0.7)
rows, prev, i = [], None, 0
while True:
    ok, fr = cap.read()
    if not ok: break
    s = cv2.resize(fr, (SW, SH), interpolation=cv2.INTER_AREA)
    g = cv2.cvtColor(s, cv2.COLOR_BGR2GRAY).astype(np.float32)
    hsv = cv2.cvtColor(s, cv2.COLOR_BGR2HSV)
    mid = g[int(SH * .35):int(SH * .6)].mean() + 1e-3
    c = g[int(SH * .2):int(SH * .8), int(SW * .15):int(SW * .85)]
    sharp = cv2.Laplacian(c, cv2.CV_32F).var()
    diff = float(np.abs(g - prev).mean()) if prev is not None else 0.0
    prev = g
    _, f = det.detect(s)
    fw = fcx = fcy = 0.0
    if f is not None and len(f):
        x, y, w, h = max(f[:, :4].tolist(), key=lambda r: r[2] * r[3]); fw, fcx, fcy = w / SW, (x + w / 2) / SW, (y + h / 2) / SH
    low = hsv[int(SH * .45):]
    yellow = float(cv2.inRange(low, (12, 70, 170), (40, 255, 255)).mean() / 255)
    white = float(cv2.inRange(low, (0, 0, 238), (180, 30, 255)).mean() / 255)
    rows.append([round(i / fps, 3), round(float(g.mean()), 1), round(g[:int(SH * .2)].mean() / mid, 3), round(g[int(SH * .7):].mean() / mid, 3),
                 round(float(sharp), 1), round(float(hsv[..., 1].mean()), 1), round(diff, 2), round(fw, 4), round(fcx, 3), round(fcy, 3),
                 round(yellow, 4), round(white, 4)])
    i += 1
cols = ["t", "lum", "top", "bot", "sharp", "sat", "diff", "face_w", "face_cx", "face_cy", "yellow", "white"]
with open(out / "audit.csv", "w", newline="") as fh:
    wr = csv.writer(fh); wr.writerow(cols); wr.writerows(rows)
A = np.array(rows); t = A[:, 0]; D = {c: A[:, k] for k, c in enumerate(cols)}

# --- события ---
ev = []
med = lambda x, k=int(fps): np.array([np.median(x[max(0, j - k):j + k + 1]) for j in range(len(x))])
lm = med(D["lum"]); sm = med(D["sharp"])
for j in range(1, len(t)):
    if D["lum"][j] > 215 and D["lum"][j - 1] <= 215: ev.append((t[j], "ВСПЫШКА в белое", f"lum {D['lum'][j]:.0f}"))
    if D["lum"][j] < 18 and D["lum"][j - 1] >= 18: ev.append((t[j], "ЗАТЕМНЕНИЕ в чёрное", f"lum {D['lum'][j]:.0f}"))
    if D["sharp"][j] < 0.25 * sm[j] and D["sharp"][j - 1] >= 0.25 * sm[j]: ev.append((t[j], "РАЗМЫТИЕ (переход)", f"sharp {D['sharp'][j]:.0f} при норме {sm[j]:.0f}"))
    if D["sat"][j] < 8 and D["sat"][j - 1] >= 8: ev.append((t[j], "Ч/Б участок начался", f"sat {D['sat'][j]:.1f}"))
    if D["sat"][j] >= 8 and D["sat"][j - 1] < 8: ev.append((t[j], "Ч/Б участок закончился", f"sat {D['sat'][j]:.1f}"))
dthr = np.percentile(D["diff"], 99.3)
for j in range(1, len(t)):
    if D["diff"][j] > max(dthr, 18) and D["diff"][j] >= D["diff"][max(0, j - 2):j + 3].max(): ev.append((t[j], "СКЛЕЙКА / резкая смена", f"diff {D['diff'][j]:.0f}"))
fw = D["face_w"]
for j in range(2, len(t)):
    a0, a1 = fw[j - 2], fw[j]
    if a0 > 0.05 and a1 > 0.05 and abs(a1 / a0 - 1) > 0.12: ev.append((t[j], "СКАЧОК КРУПНОСТИ (пробивка/джамп-кат)", f"лицо {a0:.3f}→{a1:.3f} (×{a1 / a0:.2f})"))
# плавные зумы: окно 1 с, изменение >8% без скачков
k = int(fps)
for j in range(k, len(t), k // 2):
    seg = fw[j - k:j]
    if (seg > 0.05).all() and np.abs(np.diff(seg) / seg[:-1]).max() < 0.03:
        r = seg[-1] / seg[0]
        if abs(r - 1) > 0.06: ev.append((t[j - k], "ПЛАВНЫЙ НАЕЗД" if r > 1 else "ПЛАВНЫЙ ОТЪЕЗД", f"×{r:.2f} за 1 с"))
ev.sort()
txt = [f"Видео: {vid}  {W}x{H} {fps:.0f}fps  {t[-1]:.1f} c", ""]
txt += [f"{e[0]:7.2f}s  {e[1]:<38} {e[2]}" for e in ev]
txt += ["", "Средние: затемнение верха %.2f, низа %.2f (1 = без затемнения)" % (np.median(D["top"]), np.median(D["bot"])),
        "Доля кадров с лицом: %.0f%%" % (100 * (fw > 0.05).mean())]
(out / "audit_events.txt").write_text("\n".join(txt))

# --- график ---
fig, ax = plt.subplots(7, 1, figsize=(22, 16), sharex=True)
ax[0].plot(t, D["lum"], lw=0.8); ax[0].set_ylabel("яркость")
ax[1].plot(t, D["sharp"], lw=0.8, c="tab:green"); ax[1].set_ylabel("резкость"); ax[1].set_yscale("log")
ax[2].plot(t, np.where(fw > 0.05, fw, np.nan), lw=1, c="tab:red"); ax[2].set_ylabel("лицо (зум)")
ax[3].plot(t, D["sat"], lw=0.8, c="tab:purple"); ax[3].set_ylabel("насыщ.")
ax[4].plot(t, D["diff"], lw=0.8, c="tab:orange"); ax[4].set_ylabel("смена кадра")
ax[5].plot(t, D["bot"], lw=0.8, label="низ/середина"); ax[5].plot(t, D["top"], lw=0.8, label="верх/середина"); ax[5].legend(loc="upper right"); ax[5].set_ylabel("затемнение")
ax[6].plot(t, D["yellow"], lw=0.8, c="goldenrod", label="жёлтый текст"); ax[6].plot(t, D["white"], lw=0.8, c="gray", label="белый"); ax[6].legend(loc="upper right"); ax[6].set_ylabel("текст")
if a.words:
    for w in json.load(open(a.words)):
        ax[6].axvline(w["s"], c="k", lw=0.3, alpha=0.4)
for x in ax: x.grid(alpha=0.3); x.set_xticks(np.arange(0, t[-1] + 1, 1))
ax[-1].set_xlabel("сек")
plt.tight_layout(); plt.savefig(out / "audit.png", dpi=70)
print("\n".join(txt[:3]), f"... событий: {len(ev)} -> {out}/audit_events.txt, audit.png")
