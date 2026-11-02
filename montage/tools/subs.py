"""Слова -> ASS-субтитры в стиле Рыжикова (вертикаль 1080x1920).
Мелкие субтитры внизу (2-4 слова, активное слово жёлтым), мат со звёздочками.
python3 montage/tools/subs.py work/voice.words.json [--big big.json] -> work/voice.ass
big.json (опц.): [{"text":"−90 000 ₽","s":13.0,"e":16.5,"color":"red"}, ...] крупный текст по центру.
"""
import argparse, json, pathlib, re
ROOT = pathlib.Path(__file__).resolve().parent.parent
CENSOR = {r"пиздец": "п*здец", r"ебашу": "еб*шу", r"заебись": "зае*ись", r"ебать": "е*ать",
          r"хуй": "х*й", r"бля": "бл*", r"сука": "с*ка", r"пизд": "п*зд", r"еб": "е*"}
def censor(w):
    lw = w.lower()
    for k, v in CENSOR.items():
        if re.match(k, lw): return v + w[len(v):] if len(w) > len(v) else v
    return w
COL = {"gold": "&H0037AFD4&", "red": "&H003030E6&", "white": "&H00FFFFFF&", "yellow": "&H0000E1FF&"}
def ts(x): return f"{int(x//3600)}:{int(x%3600//60):02}:{x%60:05.2f}"
ap = argparse.ArgumentParser(); ap.add_argument("words"); ap.add_argument("--big"); ap.add_argument("--chunk", type=int, default=3)
a = ap.parse_args()
W = json.loads(pathlib.Path(a.words).read_text())
head = f"""[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Sub,Montserrat,72,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,5,2,2,70,70,300,204
Style: Big,Unbounded,124,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,7,4,5,60,60,0,204

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
ev = []
for i in range(0, len(W), a.chunk):
    grp = W[i:i + a.chunk]
    for j, w in enumerate(grp):
        s = w["s"]; e = grp[j + 1]["s"] if j + 1 < len(grp) else w["e"]
        txt = " ".join((f"{{\\c{COL['yellow']}}}{censor(x['w'])}{{\\c{COL['white']}}}" if k == j else censor(x["w"])) for k, x in enumerate(grp))
        ev.append(f"Dialogue: 1,{ts(s)},{ts(e)},Sub,,0,0,0,,{txt}")
if a.big:
    for b in json.loads(pathlib.Path(a.big).read_text()):
        c = COL.get(b.get("color", "white"), COL["white"])
        ev.append(f"Dialogue: 2,{ts(b['s'])},{ts(b['e'])},Big,,0,0,0,,{{\\c{c}\\fad(80,80)\\t(0,120,\\fscx112\\fscy112)\\t(120,220,\\fscx100\\fscy100)}}{b['text'].upper()}")
out = pathlib.Path(a.words).with_suffix("").with_suffix(".ass")
out.write_text(head + "\n".join(ev) + "\n"); print("->", out)
