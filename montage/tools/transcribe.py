"""Голос -> слова с таймкодами (faster-whisper, русский).
python3 montage/tools/transcribe.py input/voice.mp4 [--model large-v3-turbo|medium|small]
Пишет work/<имя>.words.json и work/<имя>.srt
"""
import argparse, json, pathlib
from faster_whisper import WhisperModel
ROOT = pathlib.Path(__file__).resolve().parent.parent
ap = argparse.ArgumentParser(); ap.add_argument("media"); ap.add_argument("--model", default="large-v3-turbo")
a = ap.parse_args()
m = WhisperModel(a.model, device="cpu", compute_type="int8", download_root=str(ROOT / "models"))
segs, info = m.transcribe(a.media, language="ru", word_timestamps=True, vad_filter=True,
                          initial_prompt="РКО, ИП на НПД, Альфа, ВТБ, Озон, FCN, партнёрка, Пхукет, Мой налог.")
words, srt = [], []
for i, s in enumerate(segs, 1):
    for w in s.words: words.append({"w": w.word.strip(), "s": round(w.start, 3), "e": round(w.end, 3)})
    f = lambda x: f"{int(x//3600):02}:{int(x%3600//60):02}:{int(x%60):02},{int(x*1000%1000):03}"
    srt.append(f"{i}\n{f(s.start)} --> {f(s.end)}\n{s.text.strip()}\n")
stem = pathlib.Path(a.media).stem; (ROOT / "work").mkdir(exist_ok=True)
(ROOT / "work" / f"{stem}.words.json").write_text(json.dumps(words, ensure_ascii=False, indent=1))
(ROOT / "work" / f"{stem}.srt").write_text("\n".join(srt))
print(f"{len(words)} слов, {info.duration:.1f} c -> work/{stem}.words.json")
