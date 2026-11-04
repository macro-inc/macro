#!/usr/bin/env bash
# "One day in Macro" (day.html): each cut × mode × format, rendered as piped segments (render.mjs segments: 60 fps,
# 4 subframes, tmix) and concatenated, with the kit's composed score and the scene's UI sounds (meta-ads
# daily-video/_kit/audio/mix.py) normalized to -16 LUFS. One soundtrack per cut, shared by both modes.
#   KIT=/path/to/meta-ads/daily-video/_kit CUTS="45 15" MODES="light dark" FMTS="45 916 11" WORKERS=4 SEG=/tmp/x ./dbuild.sh
set -euo pipefail
cd "$(dirname "$0")"
FF=${FF:-ffmpeg}; WORKERS=${WORKERS:-4}; SEG=${SEG:-/tmp/macro-day}; KIT=${KIT:?set KIT to the daily-video kit}
mkdir -p "$SEG" audio
for c in ${CUTS:-45 15}; do
  PAGE=day.html QS="&cut=$c&music=score" FMT=45 node render.mjs cues "audio/day-$c.json"
  (cd audio && FF="$FF" python3 "$KIT/audio/mix.py" "day-$c.json" "day-$c-raw.wav")
  "$FF" -y -loglevel error -i "audio/day-$c-raw.wav" -af loudnorm=I=-16:TP=-1.5:LRA=11 -ar 48000 "audio/day-$c.wav"
  for m in ${MODES:-light dark}; do
    for f in ${FMTS:-45 916 11}; do
      d="$SEG/$c-$m-$f"; rm -rf "$d"
      PAGE=day.html QS="&cut=$c&mode=$m" FMT=$f FF="$FF" node render.mjs segments "$d" "$WORKERS"
      (for s in "$d"/seg*.mp4; do echo "file '$s'"; done) > "$d/list.txt"
      "$FF" -y -loglevel error -f concat -safe 0 -i "$d/list.txt" -i "audio/day-$c.wav" -map 0:v -map 1:a -c:v copy -c:a aac -b:a 256k -movflags +faststart -shortest "macro-day-$c-$m-$f.mp4"
      echo "encoded macro-day-$c-$m-$f.mp4"; rm -rf "$d"
    done
  done
done
