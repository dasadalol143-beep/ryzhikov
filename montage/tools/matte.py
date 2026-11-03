"""Вырезка человека (Robust Video Matting, ONNX, с памятью между кадрами) → слой «только человек» с прозрачностью.
python3 montage/tools/matte.py <video> <out.mov> --ss 0 --t 7 [--w 1920] [--model mobilenetv3|resnet50]
Выход: ProRes 4444 с альфой (w × h). Используется как верхний слой над текстом: фон → текст → человек.
Проверка: --check out.png сохраняет кадр с серой подложкой, чтобы увидеть края.
"""
import argparse, pathlib, subprocess, numpy as np, cv2, onnxruntime as ort

ROOT = pathlib.Path(__file__).resolve().parent.parent
ap = argparse.ArgumentParser(); ap.add_argument("video"); ap.add_argument("out")
ap.add_argument("--ss", type=float, default=0); ap.add_argument("--t", type=float, default=0); ap.add_argument("--w", type=int, default=1920)
ap.add_argument("--model", default="mobilenetv3"); ap.add_argument("--check"); ap.add_argument("--dsr", type=float, default=0.25)
a = ap.parse_args()
sess = ort.InferenceSession(str(ROOT / f"models/matte/rvm_{a.model}_fp32.onnx"), providers=["CPUExecutionProvider"])
import json as _json
pr = _json.loads(subprocess.check_output(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,r_frame_rate,nb_frames", "-of", "json", a.video]))["streams"][0]
W0, H0 = pr["width"], pr["height"]; num, den = map(int, pr["r_frame_rate"].split("/")); fps = num / den
W = a.w; H = int(round(W * H0 / W0 / 2) * 2)
f0 = int(round(a.ss * fps)); n = int(round(a.t * fps)) if a.t else int(pr.get("nb_frames", 0))
warm = min(12, f0); f0 -= warm  # прогрев памяти модели: первые кадры окна иначе хуже
# точный выбор кадров по номеру (seek OpenCV на H.264 может промахнуться — тогда слой человека разъедется с видео)
dec = subprocess.Popen(["ffmpeg", "-v", "error", "-i", a.video, "-vf", f"select='between(n\\,{f0}\\,{f0 + warm + n - 1})',scale={W}:{H}:flags=area",
                        "-vsync", "0", "-f", "rawvideo", "-pix_fmt", "bgr24", "-"], stdout=subprocess.PIPE)
class _Cap:
    def read(self):
        b = dec.stdout.read(W * H * 3)
        return (len(b) == W * H * 3), (np.frombuffer(b, np.uint8).reshape(H, W, 3) if len(b) == W * H * 3 else None)
cap = _Cap()
rec = [np.zeros((1, 1, 1, 1), np.float32)] * 4
dsr = np.array([a.dsr], np.float32)
p = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", f"{W}x{H}", "-r", str(fps), "-i", "-",
                      "-c:v", "prores_ks", "-profile:v", "4444", "-pix_fmt", "yuva444p10le", a.out], stdin=subprocess.PIPE)
for k in range(n + warm):
    ok, fr = cap.read()
    if not ok: break
    src = cv2.cvtColor(fr, cv2.COLOR_BGR2RGB).astype(np.float32).transpose(2, 0, 1)[None] / 255
    fgr, pha, *rec = sess.run(None, {"src": src, "r1i": rec[0], "r2i": rec[1], "r3i": rec[2], "r4i": rec[3], "downsample_ratio": dsr})
    al = np.clip(pha[0, 0], 0, 1)
    al = cv2.GaussianBlur(al, (0, 0), 0.6)  # мягкий край без ореола
    if k < warm: continue
    rgba = np.dstack([cv2.cvtColor(fr, cv2.COLOR_BGR2RGB), (al * 255).astype(np.uint8)])
    p.stdin.write(rgba.tobytes())
    if a.check and k == warm + n // 2:
        bg = np.full_like(fr, 90); comp = (fr * al[..., None] + bg * (1 - al[..., None])).astype(np.uint8); cv2.imwrite(a.check, comp)
p.stdin.close(); p.wait(); print("->", a.out, f"{n} кадров")
