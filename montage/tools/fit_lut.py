"""Снимает цветовое преобразование «исходник (D-Log M) → готовый грейд» по парам кадров и пишет 3D LUT (.cube).
python3 montage/tools/fit_lut.py <src.mp4> <ref.mp4> <pairs.json [[t_ref, t_src], ...]> <out.cube> [--look warm]
Метод: квантильное сопоставление каналов RGB на центральной зоне кадра (без титров), сглаживание кривых,
затем опционально творческий «вид»: тёплые светлые (жёлтый), лёгкая бирюза в тенях, мягкий контраст.
"""
import argparse, json, subprocess, numpy as np

ap = argparse.ArgumentParser(); ap.add_argument("src"); ap.add_argument("ref"); ap.add_argument("pairs"); ap.add_argument("out")
ap.add_argument("--look", default="none"); ap.add_argument("--size", type=int, default=33); a = ap.parse_args()

def frame(path, t, w=640, h=360):
    r = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{t:.3f}", "-i", path, "-frames:v", "1", "-vf", f"scale={w}:{h},format=rgb48le",
                        "-f", "rawvideo", "-pix_fmt", "rgb48le", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(r, np.uint16).reshape(h, w, 3).astype(np.float64) / 65535

P = json.load(open(a.pairs))
S, R = [], []
for p in P:
    tr, ts = p[0] + 0.25, p[1] + 0.25
    s, r = frame(a.src, ts), frame(a.ref, tr)
    # центр без титров и размытых краёв
    S.append(s[90:270, 120:520].reshape(-1, 3)); R.append(r[90:270, 120:520].reshape(-1, 3))
S, R = np.concatenate(S), np.concatenate(R)
q = np.linspace(0, 1, 257)
curves = []
for c in range(3):
    xs = np.quantile(S[:, c], q); ys = np.quantile(R[:, c], q)
    xs = np.maximum.accumulate(xs + np.arange(len(xs)) * 1e-7)  # строго возрастающая
    grid = np.linspace(0, 1, 1024); yi = np.interp(grid, xs, ys)
    yi = np.convolve(np.pad(yi, 24, mode="edge"), np.ones(49) / 49, "valid")  # гладкая кривая без ступенек
    curves.append((grid, np.clip(yi, 0, 1)))

def apply(rgb):
    out = np.stack([np.interp(rgb[..., c], *curves[c]) for c in range(3)], -1)
    if a.look == "warm":
        L = np.array([0.2126, 0.7152, 0.0722])
        out = out * np.array([1.035, 1.0, 0.93])                                                     # баланс белого в тепло (жёлтый)
        Y = (out @ L)[..., None]
        hi = np.clip((Y - 0.4) / 0.6, 0, 1) ** 1.1; lo = np.clip((0.42 - Y) / 0.42, 0, 1) ** 1.4
        out = out + hi * np.array([0.04, 0.025, -0.045]) + lo * np.array([-0.02, 0.006, 0.026])    # золотые светлые, бирюза в тенях
        Y = (out @ L)[..., None]
        Yc = Y + 0.10 * (Y - 0.5) * (1 - np.abs(2 * Y - 1))                                           # мягкая S-кривая
        out = Yc + (out - Y) * 1.16                                                                   # плотнее цвет
        out = 0.012 + out * 0.982
    return np.clip(out, 0, 1)

N = a.size; g = np.linspace(0, 1, N)
b, gg, r = np.meshgrid(g, g, g, indexing="ij")  # .cube: красный меняется быстрее всех
lut = apply(np.stack([r, gg, b], -1).reshape(-1, 3))
with open(a.out, "w") as f:
    f.write(f'TITLE "fit {a.look}"\nLUT_3D_SIZE {N}\n')
    for v in lut: f.write(f"{v[0]:.6f} {v[1]:.6f} {v[2]:.6f}\n")
# проверка: насколько исходник после LUT близок к эталону по статистике
fit = apply(S[::7]);
print("эталон  mean RGB", R.mean(0).round(3), " после LUT", fit.mean(0).round(3) if a.look == "none" else "(с творческим видом)")
print("->", a.out)
