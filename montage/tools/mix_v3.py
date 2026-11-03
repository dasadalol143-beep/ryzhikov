"""Сведение в стиле эталона: чистый голос без музыкальной подложки, мягкая обработка, редкие тихие SFX.
python3 montage/tools/mix_v3.py projects/v14k [--music трек.wav --music_db -24]
Голос: склейки с кроссфейдом 12 мс (без щелчков), лёгкий шумодав, EQ, компрессия, −14 LUFS.
"""
import argparse, json, pathlib, subprocess, wave, numpy as np

ROOT = pathlib.Path(__file__).resolve().parent.parent
ap = argparse.ArgumentParser(); ap.add_argument("proj"); ap.add_argument("--music"); ap.add_argument("--music_db", type=float, default=-24)
a = ap.parse_args(); P = pathlib.Path(a.proj); SR = 48000
T = json.load(open(P / "timeline.json")); C = json.load(open(P / "cues3.json"))
total = T["duration"] + C["end"]
src = ROOT / "input/src5/src.mp4"

# 1. голос: каждый клип из исходника, кроссфейд 12 мс на стыках
def clip(s, d):
    r = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{s:.4f}", "-i", str(src), "-t", f"{d + 0.012:.4f}", "-map", "0:a:0", "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(r, np.float32).copy()
N = int(total * SR) + SR; v = np.zeros(N, np.float32); xf = int(0.012 * SR)
for c in T["clips"]:
    d = c["frames"] * 1001 / 24000
    x = clip(c["src_in"], d); i0 = int(round(c["t_in"] * SR))
    ramp_in = np.linspace(0, 1, xf, dtype=np.float32); ramp_out = ramp_in[::-1]
    x[:xf] *= ramp_in; x[-xf:] *= ramp_out
    v[i0:i0 + len(x)] += x[: N - i0]
v = v[: int(total * SR)]
# последнее слово: мягкий спад под затемнение
fo = int(0.6 * SR); v[-fo:] *= np.linspace(1, 0, fo)
raw = P / "voice3_raw.wav"
with wave.open(str(raw), "wb") as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes((np.clip(v, -1, 1) * 32767).astype(np.int16).tobytes())
# мягкая обработка; задержку фильтров компенсирует atrim (замер)
subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(raw), "-af",
                "highpass=f=70,afftdn=nr=5:nf=-46,equalizer=f=220:t=q:w=1.1:g=-1.5,equalizer=f=3500:t=q:w=1.3:g=1.8,"
                "acompressor=threshold=-20dB:ratio=2.5:attack=8:release=160:makeup=2,atrim=start=0.025,asetpts=PTS-STARTPTS,apad=pad_dur=0.05", "-ac", "2", "-ar", str(SR), str(P / "voice3_proc.wav")], check=True)

# 2. SFX: только мягкий «шелест» на крупных фразах и вспышке, тихо
def load(n):
    with wave.open(str(ROOT / "assets/sfx" / f"{n}.wav")) as w:
        return np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(np.float32).reshape(-1, w.getnchannels()) / 32768
sfx = np.zeros((int(total * SR) + SR, 2), np.float32)
def put(n, t, vol):
    x = load(n) * vol; i = int(max(0, t - 0.06) * SR); sfx[i:i + len(x)] += x[: len(sfx) - i]
for h in C["heads"]:
    if h["y"] < 0.5 or h["text"] in ("Объявить тебе челлендж", "14 000₽"): put("whoosh", h["s"], 0.09)
put("whoosh", C["ev"]["screen"][0], 0.12); put("whoosh", C["ev"]["card"][0], 0.09); put("whoosh", C["ev"]["flash"], 0.14)
with wave.open(str(P / "sfx3.wav"), "wb") as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes((np.clip(sfx[: int(total * SR)], -1, 1) * 32767).astype(np.int16).tobytes())

inputs = ["-i", str(P / "voice3_proc.wav"), "-i", str(P / "sfx3.wav")]
fc = "[0:a][1:a]amix=inputs=2:normalize=0:duration=first,loudnorm=I=-14:TP=-1:LRA=8[o]"
if a.music:
    inputs += ["-i", a.music]
    fc = (f"[2:a]volume={a.music_db}dB,afade=t=out:st={total - 2}:d=2[m];[m][0:a]sidechaincompress=threshold=0.03:ratio=5:attack=30:release=400[md];"
          "[0:a][1:a][md]amix=inputs=3:normalize=0:duration=first,loudnorm=I=-14:TP=-1:LRA=8[o]")
subprocess.run(["ffmpeg", "-v", "error", "-y", *inputs, "-filter_complex", fc, "-map", "[o]", "-ar", str(SR), "-ac", "2", str(P / "mix3.wav")], check=True)
print("->", P / "mix3.wav", f"{total:.2f} c")
