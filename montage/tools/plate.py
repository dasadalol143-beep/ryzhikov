"""Плашки PNG (ШАГ 1, ПИШИ «РКО», БЕСПЛАТНО, пуш «+14 000 ₽»).
python3 montage/tools/plate.py "ПИШИ «РКО»" --bg gold --out work/rko.png
python3 montage/tools/plate.py "+14 000 ₽" --push --out work/push.png
"""
import argparse, pathlib
from PIL import Image, ImageDraw, ImageFont
ROOT = pathlib.Path(__file__).resolve().parent.parent
ap = argparse.ArgumentParser(); ap.add_argument("text"); ap.add_argument("--bg", default="gold")
ap.add_argument("--size", type=int, default=96); ap.add_argument("--push", action="store_true"); ap.add_argument("--out", required=True)
a = ap.parse_args()
BG = {"gold": (230, 184, 60), "red": (220, 40, 40), "black": (12, 12, 12), "white": (255, 255, 255)}[a.bg]
FG = (12, 12, 12) if a.bg in ("gold", "white") else (255, 255, 255)
if a.push:  # пуш-уведомление банка
    f1 = ImageFont.truetype(str(ROOT / "assets/fonts/Inter.ttf"), 40); f2 = ImageFont.truetype(str(ROOT / "assets/fonts/Inter.ttf"), 64)
    im = Image.new("RGBA", (960, 220), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    d.rounded_rectangle((0, 0, 959, 219), 44, fill=(245, 245, 247, 240))
    d.rounded_rectangle((36, 50, 156, 170), 28, fill=(40, 180, 90, 255)); d.text((96, 110), "₽", font=f2, fill="white", anchor="mm")
    d.text((190, 50), "Партнёрка · сейчас", font=f1, fill=(110, 110, 115)); d.text((190, 100), "Начисление " + a.text, font=f2, fill=(15, 15, 15))
    im.save(a.out); print("->", a.out); raise SystemExit
f = ImageFont.truetype(str(ROOT / "assets/fonts/Unbounded.ttf"), a.size)
tmp = ImageDraw.Draw(Image.new("RGBA", (1, 1))); bb = tmp.textbbox((0, 0), a.text, font=f)
w, h = bb[2] - bb[0] + 90, bb[3] - bb[1] + 60
im = Image.new("RGBA", (w + 12, h + 12), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
d.rounded_rectangle((12, 12, w + 11, h + 11), 26, fill=(0, 0, 0, 120))
d.rounded_rectangle((0, 0, w, h), 26, fill=BG + (255,))
d.text((45, 30 - bb[1]), a.text, font=f, fill=FG)
im.save(a.out); print("->", a.out)
