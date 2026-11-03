#!/bin/bash
# Полная 4K-сборка отрывка MotionDemo: 4K-исходник → вырезка → база без 3D → 3D-слои (карты, банки) → склейка + звук
set -e
cd /home/user/ryzhikov/montage/projects/v14k
S=../../input/src5/src.mp4; P=../../remotion/public/media
B=/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell
rm -rf cut4k; mkdir -p cut4k; > cut4k/v.txt
while read i s d n gm; do
  ffmpeg -nostdin -v error -y -ss $s -i $S -frames:v $n -map 0:v:0 -vf "scale=3840:2160:flags=lanczos,format=rgb48le,lut3d=file=/home/user/ryzhikov/montage/assets/luts/v14k_warm.cube:interp=tetrahedral,eq=gamma=$gm,format=yuv420p" -r 24000/1001 -c:v libx264 -preset veryfast -crf 14 -an cut4k/v_$i.mp4
  echo "file 'v_$i.mp4'" >> cut4k/v.txt
done < cut/list4k.txt
ffmpeg -nostdin -v error -y -f concat -safe 0 -i cut4k/v.txt -c copy cut4k_demo.mp4
ln -f cut4k_demo.mp4 $P/v14k_cut4k_demo.mp4
python3 -I ../../tools/matte.py cut4k_demo.mp4 $P/demo_person_q4k.mov --ss $(python3 -c "print(176*1001/24000)") --t 2.15 --w 3840 --dsr 0.125
python3 -I ../../tools/matte.py cut4k_demo.mp4 $P/demo_person_ty4k.mov --ss $(python3 -c "print(397*1001/24000)") --t 2.9 --w 3840 --dsr 0.125
echo STAGE_SRC_DONE
cd ../../remotion
npx remotion render src/index.ts MotionDemo ../projects/v14k/demo4k_base.mp4 --scale 2 --codec h264 --crf 15 --concurrency 3 --muted --props='{"noCards":true}' --timeout 600000 --browser-executable $B
echo STAGE_BASE_DONE
rm -rf ../projects/v14k/cards4k ../projects/v14k/banks4k
npx remotion render src/index.ts CardsOnly ../projects/v14k/cards4k --sequence --image-format png --scale 2 --concurrency 2 --timeout 600000 --gl=swangle --browser-executable $B
echo STAGE_CARDS_DONE
npx remotion render src/index.ts BanksOnly ../projects/v14k/banks4k --sequence --image-format png --scale 2 --concurrency 2 --timeout 600000 --gl=swangle --browser-executable $B
echo STAGE_BANKS_DONE
