"""Трекинг лица: центр и размер лица по кадрам -> кривая зума и якорь для пробивок.
python3 montage/tools/face_track.py <video> [--step 2] -> <video>.face.json  [{t, cx, cy, w}] в долях кадра
Масштаб зума в оригинале = w(t) / w_min (насколько лицо крупнее самого общего плана).
"""
import argparse, json, pathlib, cv2
ap = argparse.ArgumentParser(); ap.add_argument("video"); ap.add_argument("--step", type=int, default=2); a = ap.parse_args()
cap = cv2.VideoCapture(a.video); fps = cap.get(cv2.CAP_PROP_FPS); W = cap.get(3); H = cap.get(4)
SW, SH = int(W / 2), int(H / 2)
det = cv2.FaceDetectorYN.create(str(pathlib.Path(__file__).resolve().parent.parent / "models/face/yunet.onnx"), "", (SW, SH), 0.7)
out, i = [], 0
while True:
    ok, fr = cap.read()
    if not ok: break
    if i % a.step == 0:
        _, f = det.detect(cv2.resize(fr, (SW, SH)))
        if f is not None and len(f):
            x, y, w, h = max(f[:, :4].tolist(), key=lambda r: r[2] * r[3])
            out.append({"t": round(i / fps, 3), "cx": round((x + w / 2) * 2 / W, 4), "cy": round((y + h / 2) * 2 / H, 4), "w": round(w * 2 / W, 4)})
    i += 1
p = pathlib.Path(a.video).with_suffix(".face.json"); p.write_text(json.dumps(out)); print(len(out), "кадров с лицом ->", p)
