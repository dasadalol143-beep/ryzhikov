"""Счётчик денег (прозрачный .mov ProRes 4444 под оверлей), доход золотом, потери красным.
python3 montage/tools/counter.py --from 0 --to 1450000 --dur 1.6 --color gold --out work/c1450.mov
Ступеньками (по банкам): --steps 0,15000,22000,30000,130000 --prefix "ДО "
"""
import argparse, subprocess, pathlib, numpy as np
from PIL import Image, ImageDraw, ImageFont
ROOT = pathlib.Path(__file__).resolve().parent.parent
ap = argparse.ArgumentParser()
ap.add_argument("--from", dest="a", type=float, default=0); ap.add_argument("--to", dest="b", type=float, default=0)
ap.add_argument("--steps"); ap.add_argument("--dur", type=float, default=1.5); ap.add_argument("--hold", type=float, default=1.0)
ap.add_argument("--color", default="gold"); ap.add_argument("--prefix", default=""); ap.add_argument("--suffix", default=" ₽")
ap.add_argument("--size", type=int, default=150); ap.add_argument("--w", type=int, default=1080); ap.add_argument("--h", type=int, default=400)
ap.add_argument("--fps", type=int, default=30); ap.add_argument("--out", required=True)
a = ap.parse_args()
COL = {"gold": (230, 184, 60), "red": (232, 52, 52), "white": (255, 255, 255)}[a.color]
def mkfont(sz):
    f = ImageFont.truetype(str(ROOT / "assets/fonts/Unbounded.ttf"), sz)
    try: f.set_variation_by_axes([800])
    except Exception: pass
    return f
steps = [float(x) for x in a.steps.split(",")] if a.steps else [a.a, a.b]
n_anim = int(a.dur * a.fps); n_hold = int(a.hold * a.fps)
seg = max(1, n_anim // (len(steps) - 1))
vals = []
for i in range(len(steps) - 1):
    for k in range(seg):
        p = k / seg; p = 1 - (1 - p) ** 3  # ease-out
        vals.append(steps[i] + (steps[i + 1] - steps[i]) * p)
vals += [steps[-1]] * n_hold
fmt0 = lambda v: f"{'−' if v < 0 else ''}{abs(int(round(v))):,}".replace(",", " ")
_widest = max((a.prefix + fmt0(v) + a.suffix for v in steps), key=len)
size = a.size
while size > 40:  # автоподгон: самая длинная цифра влезает с полями 60px
    font = mkfont(size); bb = ImageDraw.Draw(Image.new("RGBA", (1, 1))).textbbox((0, 0), _widest, font=font, stroke_width=6)
    if bb[2] - bb[0] <= a.w - 120: break
    size -= 6
fmt = lambda v: f"{'−' if v < 0 else ''}{abs(int(round(v))):,}".replace(",", " ")
p = subprocess.Popen(["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", f"{a.w}x{a.h}",
                      "-r", str(a.fps), "-i", "-", "-c:v", "prores_ks", "-profile:v", "4444", "-pix_fmt", "yuva444p10le", a.out],
                     stdin=subprocess.PIPE)
for v in vals:
    im = Image.new("RGBA", (a.w, a.h), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    s = a.prefix + fmt(v) + a.suffix
    bb = d.textbbox((0, 0), s, font=font); x = (a.w - (bb[2] - bb[0])) / 2; y = (a.h - (bb[3] - bb[1])) / 2 - bb[1]
    d.text((x + 6, y + 8), s, font=font, fill=(0, 0, 0, 160))
    d.text((x, y), s, font=font, fill=COL + (255,), stroke_width=6, stroke_fill=(0, 0, 0, 255))
    p.stdin.write(im.tobytes())
p.stdin.close(); p.wait(); print("->", a.out, f"{len(vals)/a.fps:.2f}s")
