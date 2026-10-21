#!/usr/bin/env bash
# Режет видеопереходы на кадры и склеивает их в вертикальные листы по 10 кадров.
# Использование: build-film.sh <папка с c0.mp4..c5.mp4 и k0.png..k6.png> <папка site>
set -euo pipefail
export Q; SRC=$1; SITE=$2; OUT=$SITE/assets/film; FPS=${FPS:-12}; W=${W:-960}; PER=10; Q=${Q:-50}
mkdir -p "$OUT"; TMP=$(mktemp -d)
for v in "$SRC"/c*.mp4; do
  c=$(basename "$v" .mp4)
  rm -f "$TMP"/*.png
  ffmpeg -v error -y -i "$v" -vf "fps=$FPS,scale=$W:-2" "$TMP/f_%03d.png"
  n=$(ls "$TMP"/f_*.png | wc -l)
  sheets=$(( (n + PER - 1) / PER ))
  for ((s=0; s<sheets; s++)); do
    start=$((s*PER+1)); list=()
    for ((i=start; i<start+PER && i<=n; i++)); do list+=("$TMP/$(printf 'f_%03d.png' $i)"); done
    python3 - "$OUT/${c}_$s.webp" "${list[@]}" <<'PY'
import sys
from PIL import Image
out, fs = sys.argv[1], sys.argv[2:]
ims = [Image.open(f).convert('RGB') for f in fs]
w, h = ims[0].size
sheet = Image.new('RGB', (w, h * len(ims)))
for i, im in enumerate(ims): sheet.paste(im, (0, i * h))
sheet.save(out, 'WEBP', quality=int(__import__("os").environ.get("Q","50")), method=6)
PY
  done
  echo "$c $n"
done
for k in "$SRC"/k*.png; do
  python3 -c "import sys;from PIL import Image;Image.open(sys.argv[1]).convert('RGB').resize((1600,900)).save(sys.argv[2],'WEBP',quality=72,method=6)" "$k" "$OUT/$(basename "$k" .png).webp"
done
rm -rf "$TMP"
