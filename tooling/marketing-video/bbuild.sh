#!/usr/bin/env bash
# The block ads (blocks.html): every variant × format. Each variant's soundtrack is synthesized once from the scene's
# cues (audio/bmix.py; no music file), then each format renders as piped segments (render.mjs segments) and is muxed
# with it. Outputs are macro-blocks-<variant>-<fmt>.mp4.
#   VARIANTS="merge chain fit" FMTS="45 916 11" FF=/path/to/ffmpeg WORKERS=4 SEG=/tmp/x ./bbuild.sh
set -euo pipefail
cd "$(dirname "$0")"
FF=${FF:-ffmpeg}; WORKERS=${WORKERS:-4}; SEG=${SEG:-/tmp/macro-blocks}; OUT=${OUT:-macro-blocks}
mkdir -p "$SEG"
for v in ${VARIANTS:-merge chain fit}; do
  PAGE=blocks.html QS="&v=$v" FMT=45 node render.mjs cues "audio/blocks-$v.json"
  (cd audio && FF="$FF" python3 bmix.py "blocks-$v.json" "blocks-$v.wav")
  for f in ${FMTS:-45 916 11}; do
    d="$SEG/$v-$f"; rm -rf "$d"
    PAGE=blocks.html QS="&v=$v" FMT=$f FF="$FF" node render.mjs segments "$d" "$WORKERS"
    (for s in "$d"/seg*.mp4; do echo "file '$s'"; done) > "$d/list.txt"
    "$FF" -y -loglevel error -f concat -safe 0 -i "$d/list.txt" -i "audio/blocks-$v.wav" -map 0:v -map 1:a -c:v copy \
      -c:a aac -b:a 256k -movflags +faststart -shortest "$OUT-$v-$f.mp4"
    echo "encoded $OUT-$v-$f.mp4"
  done
done
