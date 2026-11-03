#!/bin/bash
# Сборка рабочего видео: клипы из 4K, грейд, 2560x1440, concat. Звук: клипы с фейдами 10 мс.
set -e
S=../../input/src5/src.mp4
mkdir -p cut
python3 -I -c "
import json; T=json.load(open('timeline.json'))
for i,c in enumerate(T['clips']): import json as j; G=j.load(open('clip_gamma.json')); print(i, c['src_in'], '%.6f' % (c['frames']*1001/24000), c['frames'], G[i])" > cut/list.txt
> cut/v.txt; > cut/a.txt
while read i s d n gm; do
  if [ -s cut/v_$i.mp4 ] && [ "$(cat cut/v_$i.frames 2>/dev/null)" = "$n" ] && [ -s cut/a_$i.wav ]; then echo "file 'v_$i.mp4'" >> cut/v.txt; echo "file 'a_$i.wav'" >> cut/a.txt; continue; fi
  ffmpeg -nostdin -v error -y -ss $s -i $S -frames:v $n -map 0:v:0 -vf "scale=2560:1440:flags=lanczos,format=rgb48le,lut3d=file=/home/user/ryzhikov/montage/assets/luts/v14k_warm.cube:interp=tetrahedral,eq=gamma=$gm,format=yuv420p" -r 24000/1001 -c:v libx264 -preset veryfast -crf 14 -an cut/v_$i.mp4 && echo $n > cut/v_$i.frames
  ffmpeg -nostdin -v error -y -ss $s -i $S -t $d -map 0:a:0 -af "afade=t=in:d=0.01,afade=t=out:st=$(python3 -c "print(max(0,$d-0.012))"):d=0.012" -ar 48000 -c:a pcm_s16le cut/a_$i.wav
  ffmpeg -nostdin -v error -y -i cut/a_$i.wav -af "apad=whole_dur=$d,atrim=0:$d" -c:a pcm_s16le cut/a2_$i.wav && mv cut/a2_$i.wav cut/a_$i.wav
  echo "file 'v_$i.mp4'" >> cut/v.txt; echo "file 'a_$i.wav'" >> cut/a.txt
done < cut/list.txt
ffmpeg -v error -y -f concat -safe 0 -i cut/v.txt -c copy cut_video.mp4
ffmpeg -v error -y -f concat -safe 0 -i cut/a.txt -c copy voice_raw.wav
echo BUILD_DONE
