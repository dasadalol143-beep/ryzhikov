#!/bin/bash
# Оригинал | наш рендер бок о бок (540x960 каждый), звук нашего рендера.
# compare.sh <orig.mp4> <ours.mp4> <out.mp4>
set -e
ffmpeg -v error -y -i "$1" -i "$2" -filter_complex \
 "[0:v]scale=540:960,setsar=1,fps=30,drawtext=fontfile=$(dirname $0)/../assets/fonts/Inter.ttf:text='ОРИГИНАЛ':x=20:y=20:fontsize=28:fontcolor=white:box=1:boxcolor=black@0.5[a];\
  [1:v]scale=540:960,setsar=1,fps=30,drawtext=fontfile=$(dirname $0)/../assets/fonts/Inter.ttf:text='ДВИЖОК':x=20:y=20:fontsize=28:fontcolor=yellow:box=1:boxcolor=black@0.5[b];\
  [a][b]hstack=inputs=2:shortest=1[v]" -map "[v]" -map 1:a -c:v libx264 -crf 20 -pix_fmt yuv420p -c:a aac "$3"
