"""Сведение звука ролика «14 000 ₽»: голос (обработка) + музыка (сайдчейн под голос) + SFX по событиям графики → −14 LUFS.
python3 montage/tools/mix_v14k.py projects/v14k [--music путь.wav]
Читает: voice_raw.wav, cues.json (события из remotion/src/v2/cues.ts), timeline.json (слова).
Пишет: voice_proc.wav, sfx.wav, music.wav, mix.wav (48 кГц стерео).
"""
import argparse, json, pathlib, re, subprocess, wave, numpy as np

ROOT = pathlib.Path(__file__).resolve().parent.parent
ap = argparse.ArgumentParser(); ap.add_argument("proj"); ap.add_argument("--music"); a = ap.parse_args()
P = pathlib.Path(a.proj); SR = 48000
cues = json.load(open(P / "cues.json")); T = json.load(open(P / "timeline.json"))
ev = cues["ev"]; total = cues["duration"] + cues["end"]
run = lambda *c: subprocess.run(c, check=True)

# 1. голос
run("ffmpeg", "-v", "error", "-y", "-i", str(P / "voice_raw.wav"), "-af",
    "highpass=f=75,afftdn=nr=10:nf=-42,equalizer=f=250:t=q:w=1.2:g=-2,equalizer=f=3200:t=q:w=1.4:g=2.5,"
    "equalizer=f=9000:t=q:w=1:g=1.5,acompressor=threshold=-21dB:ratio=3:attack=6:release=140:makeup=3,alimiter=limit=0.95,"
    f"apad=whole_dur={total}", "-ar", str(SR), "-ac", "2", str(P / "voice_proc.wav"))

# 2. музыка: своя подложка (или трек пользователя), обрыв на смене плана
clip5 = cues["clips"][5]["t_in"]
if a.music:
    run("ffmpeg", "-v", "error", "-y", "-i", a.music, "-t", str(total), "-ar", str(SR), "-ac", "2", "-af", f"afade=t=out:st={total - 2.5}:d=2.5", str(P / "music.wav"))
else:
    run("python3", "-I", str(ROOT / "tools/music_bed.py"), str(P / "music.wav"), f"{total:.3f}", "--bpm", "90",
        "--drums_from", f"{ev['k14'][1]:.3f}", "--breaks", f"{clip5 - 0.32:.3f}:0.36")

# 3. SFX по событиям
norm = lambda x: re.sub(r"[«»\"“”.,!?…:;—-]", "", x.lower()).replace("ё", "е")
def wt(text, near, field="s"):
    c = [w for w in T["words"] if norm(w["w"]).startswith(norm(text))]
    return min(c, key=lambda w: abs(w["s"] - near))[field]
def load(name):
    with wave.open(str(ROOT / "assets/sfx" / f"{name}.wav")) as w:
        x = np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(np.float32) / 32768
        return x.reshape(-1, w.getnchannels())
sfx = np.zeros((int(total * SR) + SR, 2), np.float32)
def put(name, t, vol):
    x = load(name) * vol; i = int(max(0, t - 2 / 24) * SR)  # за 2 кадра до визуала
    sfx[i:i + len(x)] += x[: len(sfx) - i]
fl = ev["flow"][0]
plan = [
    ("whoosh", 0.0, 0.28),
    ("impact", ev["challenge"][0], 0.30),
    ("whoosh", ev["k14"][0], 0.25), ("cash_push", ev["k14"][0] + 1.0, 0.35),
    ("whoosh", ev["arb"][0], 0.22),
    ("click", ev["years"][0], 0.35),
    ("bass_drop", ev["m145"][0], 0.40), ("cash_push", ev["m145"][0] + 1.5, 0.35),
    ("whoosh", fl, 0.38), ("click", wt("реферальную", 45.9), 0.35), ("click", wt("клиенту", 49.9), 0.35),
    ("click", wt("сами", 53.6) - 0.2, 0.3), ("click", wt("друг", 54.7), 0.3), ("whoosh", ev["flow"][1] - 0.4, 0.28),
    ("whoosh", ev["steps1"][0], 0.32), ("click", wt("Шаг", 57.2), 0.38), ("click", wt("Второй", 62.6), 0.38), ("click", wt("Третий", 69.8), 0.38),
    ("tick", wt("ИП", 73.1), 0.35), ("tick", wt("дебетовая", 78.6), 0.35), ("tick", wt("инвестиционный", 79.7), 0.35),
    ("whoosh", ev["steps1"][1] - 0.4, 0.25),
    ("impact", ev["b200"][0], 0.32),
    ("whoosh", ev["steps2"][0], 0.32), ("click", ev["steps2"][0] + 0.35, 0.4), ("whoosh", ev["steps2"][1] - 0.4, 0.25),
    ("slap", ev["free"][0], 0.35),
    ("whoosh", ev["offer"][0], 0.32), ("click", wt("FinCPA", 128.2), 0.38), ("click", wt("Альфа", 132.0), 0.38), ("whoosh", ev["offer"][1] - 0.4, 0.25),
    ("bass_drop", ev["k16"][0], 0.30), ("notification", ev["push16"], 0.45), ("cash_push", ev["push16"] + 0.25, 0.3),
    ("whoosh", cues["duration"], 0.3),
]
for n, t, v in plan: put(n, t, v)
sfx = sfx[: int(total * SR)]
with wave.open(str(P / "sfx.wav"), "wb") as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes((np.clip(sfx, -1, 1) * 32767).astype(np.int16).tobytes())

# 4. микс: музыка −20 дБ и сайдчейн под голос, SFX, нормализация −14 LUFS
fc = ("[1:a]volume=-20dB[m];[m][0:a]sidechaincompress=threshold=0.025:ratio=7:attack=25:release=380[md];"
      "[2:a]volume=-3dB[s];[0:a][md][s]amix=inputs=3:normalize=0:duration=first,loudnorm=I=-14:TP=-1:LRA=9[o]")
run("ffmpeg", "-v", "error", "-y", "-i", str(P / "voice_proc.wav"), "-i", str(P / "music.wav"), "-i", str(P / "sfx.wav"),
    "-filter_complex", fc, "-map", "[o]", "-ar", str(SR), "-ac", "2", str(P / "mix.wav"))
print("->", P / "mix.wav", f"{total:.2f} c, SFX событий: {len(plan)}")
