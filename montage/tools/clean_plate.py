"""Вытирает светящийся жёлтый/золотой текст из видео (маска по цвету + заливка по окружению) -> чистая подложка.
python3 montage/tools/clean_plate.py <in.mp4> <out.mp4> [--ss 0 --t 6]
Подходит только для тестов: на однородном фоне почти не видно, на руках и складках остаются мягкие пятна.
"""
import argparse, subprocess, numpy as np, cv2
ap = argparse.ArgumentParser(); ap.add_argument("src"); ap.add_argument("out"); ap.add_argument("--ss", type=float, default=0); ap.add_argument("--t", type=float, default=6)
a = ap.parse_args()
cap = cv2.VideoCapture(a.src); fps = cap.get(cv2.CAP_PROP_FPS); W = int(cap.get(3)); H = int(cap.get(4))
cap.set(cv2.CAP_PROP_POS_MSEC, a.ss * 1000)
p = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{W}x{H}", "-r", str(fps), "-i", "-",
                      "-c:v", "libx264", "-crf", "16", "-pix_fmt", "yuv420p", a.out], stdin=subprocess.PIPE)
n = int(a.t * fps)
for _ in range(n):
    ok, fr = cap.read()
    if not ok: break
    hsv = cv2.cvtColor(fr, cv2.COLOR_BGR2HSV)
    core = cv2.inRange(hsv, (12, 70, 170), (40, 255, 255))           # жёлтое ядро букв
    halo = cv2.inRange(hsv, (10, 40, 140), (42, 255, 255))           # тёплое свечение вокруг
    m = cv2.dilate(core, np.ones((9, 9), np.uint8), iterations=2)
    m = cv2.bitwise_or(m, cv2.bitwise_and(halo, cv2.dilate(core, np.ones((41, 41), np.uint8))))
    m[: int(H * 0.6)] = 0                                           # текст только в нижней части: лицо не трогаем
    m = cv2.dilate(m, np.ones((7, 7), np.uint8))
    clean = cv2.inpaint(fr, m, 9, cv2.INPAINT_TELEA)
    soft = cv2.GaussianBlur(m, (0, 0), 6).astype(np.float32)[..., None] / 255
    blur = cv2.GaussianBlur(clean, (0, 0), 7)
    fr = (clean * (1 - soft) + blur * soft).astype(np.uint8)
    p.stdin.write(fr.tobytes())
p.stdin.close(); p.wait(); print("->", a.out)
