#!/usr/bin/env bash
# The block ads: every variant × mode × format of blocks.html (v1: merge chain fit) or, with PAGE=blocks2.html, the
# premium v2 (replace price swap). Each variant's soundtrack is synthesized once from the scene's cues (audio/bmix.py; no
# music file; the cues don't depend on the mode), then each mode and format renders as piped segments (render.mjs
# segments) and is muxed with it. Outputs are macro-blocks-<variant>-<mode>-<fmt>.mp4 (v1) and
# macro-blocks2-<variant>-<mode>-<fmt>.mp4 (v2).
#   PAGE=blocks2.html VARIANTS="replace price swap" MODES="light dark" FMTS="45 916 11" FF=/path/to/ffmpeg WORKERS=4 SEG=/tmp/x ./bbuild.sh
set -euo pipefail
cd "$(dirname "$0")"
FF=${FF:-ffmpeg}; WORKERS=${WORKERS:-4}; SEG=${SEG:-/tmp/macro-blocks}; PAGE=${PAGE:-blocks.html}
if [ "$PAGE" = blocks2.html ]; then DEF="replace price swap"; OUT=${OUT:-macro-blocks2}; else DEF="merge chain fit"; OUT=${OUT:-macro-blocks}; fi
mkdir -p "$SEG"
for v in ${VARIANTS:-$DEF}; do
  PAGE=$PAGE QS="&v=$v" FMT=45 node render.mjs cues "audio/blocks-$v.json"
  (cd audio && FF="$FF" python3 bmix.py "blocks-$v.json" "blocks-$v.wav")
  for m in ${MODES:-light dark}; do
    for f in ${FMTS:-45 916 11}; do
      d="$SEG/$v-$m-$f"; rm -rf "$d"
      PAGE=$PAGE QS="&v=$v&mode=$m" FMT=$f FF="$FF" node render.mjs segments "$d" "$WORKERS"
      (for s in "$d"/seg*.mp4; do echo "file '$s'"; done) > "$d/list.txt"
      "$FF" -y -loglevel error -f concat -safe 0 -i "$d/list.txt" -i "audio/blocks-$v.wav" -map 0:v -map 1:a -c:v copy \
        -c:a aac -b:a 256k -movflags +faststart -shortest "$OUT-$v-$m-$f.mp4"
      echo "encoded $OUT-$v-$m-$f.mp4"
    done
  done
done
