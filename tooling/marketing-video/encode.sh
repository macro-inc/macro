#!/usr/bin/env bash
# Encode already-rendered subframes (see build.sh) into the final MP4s.
set -euo pipefail
cd "$(dirname "$0")"
FF=${FF:-ffmpeg}
FRAMES=${FRAMES:-/tmp/macro-trailer-frames}
VF="[0:v]tmix=frames=4:weights='1 1 1 1',select='eq(mod(n\,4)\,3)',setpts=N/(60*TB)"
ENC=(-c:v libx264 -preset slow -tune animation -profile:v high -pix_fmt yuv420p
     -colorspace bt709 -color_primaries bt709 -color_trc bt709 -c:a aac -b:a 256k -movflags +faststart -shortest)
"$FF" -y -loglevel error -framerate 240 -i "$FRAMES/%05d.png" -i audio/mix.wav \
  -filter_complex "$VF,scale=out_color_matrix=bt709:out_range=tv[v]" -map "[v]" -map 1:a -r 60 -crf 14 "${ENC[@]}" ${OUT:-macro-trailer}.mp4
"$FF" -y -loglevel error -framerate 240 -i "$FRAMES/%05d.png" -i audio/mix.wav \
  -filter_complex "$VF,scale=1080:1080:flags=lanczos:out_color_matrix=bt709:out_range=tv[v]" -map "[v]" -map 1:a -r 60 -crf 16 "${ENC[@]}" ${OUT:-macro-trailer}-1080.mp4
echo "encoded ${OUT:-macro-trailer}.mp4 and ${OUT:-macro-trailer}-1080.mp4"
