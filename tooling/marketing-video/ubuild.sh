#!/usr/bin/env bash
# The UI loop ads (ui.html): every ad × format, rendered as piped segments (render.mjs segments: 60 fps, 4 subframes,
# tmix) and concatenated. Each ad's soundtrack is the kit's stock track cut from its downbeat with the scene's UI sounds
# on top (meta-ads daily-video/_kit/audio/mix.py, from the cues `render.mjs cues` exports), loudness-normalized to
# -16 LUFS for Meta with true peaks under -1 dBTP. Without a mix (no KIT, or the track can't be downloaded) the video
# is written without sound as macro-ui-<ad>-<fmt>-silent.mp4.
#   KIT=/path/to/meta-ads/daily-video/_kit ADS="pr mention search email cmdk" FMTS="45 916 11" WORKERS=4 SEG=/tmp/x ./ubuild.sh
set -euo pipefail
cd "$(dirname "$0")"
FF=${FF:-ffmpeg}; WORKERS=${WORKERS:-4}; SEG=${SEG:-/tmp/macro-ui}; KIT=${KIT:-}
mkdir -p "$SEG" audio
for a in ${ADS:-pr mention search email cmdk}; do
  PAGE=ui.html QS="&ad=$a" FMT=45 node render.mjs cues "audio/ui-$a.json"
  wav=""
  if [ -n "$KIT" ] && (cd audio && FF="$FF" python3 "$KIT/audio/mix.py" "ui-$a.json" "ui-$a-raw.wav"); then
    "$FF" -y -loglevel error -i "audio/ui-$a-raw.wav" -af loudnorm=I=-16:TP=-1.5:LRA=11 -ar 48000 "audio/ui-$a.wav"
    wav="audio/ui-$a.wav"
  fi
  for f in ${FMTS:-45 916 11}; do
    d="$SEG/$a-$f"; rm -rf "$d"
    PAGE=ui.html QS="&ad=$a" FMT=$f FF="$FF" node render.mjs segments "$d" "$WORKERS"
    (for s in "$d"/seg*.mp4; do echo "file '$s'"; done) > "$d/list.txt"
    if [ -n "$wav" ]; then
      "$FF" -y -loglevel error -f concat -safe 0 -i "$d/list.txt" -i "$wav" -map 0:v -map 1:a -c:v copy -c:a aac -b:a 256k -movflags +faststart -shortest "macro-ui-$a-$f.mp4"
      echo "encoded macro-ui-$a-$f.mp4"
    else
      "$FF" -y -loglevel error -f concat -safe 0 -i "$d/list.txt" -c:v copy -movflags +faststart "macro-ui-$a-$f-silent.mp4"
      echo "encoded macro-ui-$a-$f-silent.mp4 (no sound)"
    fi
  done
done
