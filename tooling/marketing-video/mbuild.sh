#!/usr/bin/env bash
# Macro mobile ad: soundtrack once, then frames + encode for each format.
set -euo pipefail
cd "$(dirname "$0")"
FF=${FF:-ffmpeg}; FR=${FRAMES:-/tmp/macro-mobile-frames}; WORKERS=${WORKERS:-4}
[ -f audio/song-funk-gimme-that-groove.mp3 ] || curl -sSL -o audio/song-funk-gimme-that-groove.mp3 https://assets.mixkit.co/music/872/872.mp3
PAGE=mobile.html FMT=916 node render.mjs cues audio/cues.json
(cd audio && FF="$FF" python3 mix.py)
for f in ${FMTS:-916 11 169}; do
  rm -rf "$FR"; PAGE=mobile.html FMT=$f node render.mjs frames "$FR" "$WORKERS"
  "$FF" -y -loglevel error -framerate 240 -i "$FR/%05d.png" -i audio/mix.wav \
    -filter_complex "[0:v]tmix=frames=4:weights='1 1 1 1',select='eq(mod(n\,4)\,3)',setpts=N/(60*TB),scale=out_color_matrix=bt709:out_range=tv[v]" \
    -map "[v]" -map 1:a -r 60 -c:v libx264 -preset slow -tune animation -profile:v high -crf 15 -pix_fmt yuv420p \
    -colorspace bt709 -color_primaries bt709 -color_trc bt709 -c:a aac -b:a 256k -movflags +faststart -shortest "macro-mobile-$f.mp4"
  echo "encoded macro-mobile-$f.mp4"
done
