"""Пак LUT под DJI Osmo Pocket 4P (D-Log M): база D-Log M→Rec.709 (fit_lut.py) + плёночная эмуляция (spectral_film_lut, MIT).
python3 montage/tools/make_film_luts.py <base_match.cube> <out_dir> [--size 33]
Каждый .cube в out_dir применяется ПРЯМО к исходнику D-Log M (база уже внутри).
"""
import argparse, pathlib, numpy as np, colour
from spectral_film_lut import FILM_STOCKS
from spectral_film_lut.film_spectral import FilmSpectral
from spectral_film_lut.utils import film_conversion

ap = argparse.ArgumentParser(); ap.add_argument("base"); ap.add_argument("out"); ap.add_argument("--size", type=int, default=33); a = ap.parse_args()
out = pathlib.Path(a.out); out.mkdir(parents=True, exist_ok=True)

# Образы: (файл, негатив, печать, параметры) — подобраны под тёплое/холодное/плёночное
LOOKS = [
    ("01_kodak_2383_cinema",      "Kodak Vision3 250D 5207", "Kodak Vision 2383",            dict()),
    ("02_portra400_warm",         "Kodak Portra 400",        "Kodak Portra Endura Paper",    dict(exp_kelvin=5600)),
    ("03_gold200_golden",         "Kodak Gold 200",          "Kodak Endura Premier Paper",   dict(exp_kelvin=5300)),
    ("04_fuji_eterna_teal",       "Fuji Eterna 500",         "Fuji Eterna-CP Type 3513DI",   dict(exp_kelvin=6800)),
    ("05_fuji_400h_pastel",       "Fuji Pro 400H",           "Fuji Crystal Archive DPII",    dict()),
    ("06_ektar_vivid",            "Kodak Ektar 100",         "Kodak Endura Premier Paper",   dict()),
    ("07_vision3_500T_night",     "Kodak Vision3 500T 5219", "Kodak Vision 2383",            dict(exp_kelvin=4800)),
    ("08_superia_green",          "Fuji Superia X-Tra 400",  "Fuji Crystal Archive Maxima",  dict()),
]

base = colour.read_LUT(a.base)
N = a.size
grid = colour.LUT3D(size=N).table  # [r,g,b] в 0..1
x = base.apply(grid)               # D-Log M → Rec.709 (дисплей)
stocks = {}
def stock(name):
    if name not in stocks:
        f = next(s for s in FILM_STOCKS if s.name == name)
        fs = FilmSpectral(f); fs.set_color_checker(); stocks[name] = fs
    return stocks[name]

for fname, neg, prt, kw in LOOKS:
    try:
        t = film_conversion(np.clip(x, 0, 1).astype(np.float64), stock(neg), stock(prt), input_colorspace="ITU-R BT.709",
                            output_gamut="Rec. 709", gamma_func="Rec. 709", white_clip=True, **kw)
        t = np.clip(np.nan_to_num(t), 0, 1)
        # лёгкое смешивание с базой (85% плёнки): плёнка не ломает кожу и экспозицию
        t = 0.85 * t + 0.15 * np.clip(x, 0, 1)
        colour.io.write_LUT(colour.LUT3D(table=t, name=fname), str(out / f"{fname}.cube"))
        print("ok", fname)
    except Exception as e:
        print("FAIL", fname, type(e).__name__, str(e)[:120])
