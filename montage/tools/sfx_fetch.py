"""Библиотека настоящих SFX с Openverse (Freesound и др.), только CC0 / CC BY. Без ключей.
python3 montage/tools/sfx_fetch.py <out_dir> "имя=запрос" ["имя=запрос" ...] [--n 3]
Для каждого имени берёт до N лучших коротких (<= 6 с) звуков: <out_dir>/<имя>_<k>.mp3, кредиты в CREDITS.md.
Лимит анонимного API: 20 поисков в минуту — между запросами пауза 3,2 с.
"""
import argparse, json, pathlib, time, urllib.parse, urllib.request

ap = argparse.ArgumentParser(); ap.add_argument("out"); ap.add_argument("cues", nargs="+"); ap.add_argument("--n", type=int, default=3); ap.add_argument("--maxdur", type=float, default=6.0); ap.add_argument("--source", default="")
a = ap.parse_args(); out = pathlib.Path(a.out); out.mkdir(parents=True, exist_ok=True)
cred = out / "CREDITS.md"; credits = cred.read_text() if cred.exists() else "# Звуки (Openverse, CC0 / CC BY)\nУказать в описании ролика для CC BY.\n\n"
meta_p = out / "manifest.json"; meta = json.loads(meta_p.read_text()) if meta_p.exists() else {}
UA = {"User-Agent": "ryzhikov-montage/1.0"}
for cue in a.cues:
    name, q = cue.split("=", 1)
    url = "https://api.openverse.org/v1/audio/?" + urllib.parse.urlencode({"q": q, "license": "cc0,by", "page_size": 20, **({"source": a.source} if a.source else {})})
    try:
        res = json.load(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40))["results"]
    except Exception as e:
        print("FAIL search", name, e); time.sleep(3.2); continue
    res = [r for r in res if r.get("license") in ("cc0", "by") and r.get("duration") and r["duration"] <= a.maxdur * 1000 and r.get("url")]
    res.sort(key=lambda r: (r["license"] != "cc0", abs(r["duration"] / 1000 - 1.2) > 2))  # CC0 и короткие — вперёд
    got = 0
    for r in res:
        if got >= a.n: break
        ext = (r.get("filetype") or "mp3").split("/")[-1]; f = out / f"{name}_{got + 1}.{ext}"
        try:
            data = urllib.request.urlopen(urllib.request.Request(r["url"], headers=UA), timeout=60).read()
        except Exception as e:
            print("  skip", r["title"][:40], e); continue
        f.write_bytes(data); got += 1
        meta[f.name] = {"cue": name, "query": q, "title": r["title"], "creator": r.get("creator"), "license": r["license"], "dur": r["duration"] / 1000, "src": r.get("foreign_landing_url")}
        credits += f"- `{f.name}`: \"{r['title']}\" — {r.get('creator')} — CC {r['license'].upper()} {r.get('license_version') or ''} — {r.get('foreign_landing_url')}\n"
    print(f"{name}: {got} шт. ({q})")
    time.sleep(3.2)
cred.write_text(credits); meta_p.write_text(json.dumps(meta, ensure_ascii=False, indent=1))
