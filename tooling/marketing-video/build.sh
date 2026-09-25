#!/usr/bin/env bash
# Rebuild the trailer end to end: sound cues -> soundtrack -> frames -> MP4.
#   FF=/path/to/ffmpeg WORKERS=4 ./build.sh
set -euo pipefail
cd "$(dirname "$0")"
FF=${FF:-ffmpeg}
FRAMES=${FRAMES:-/tmp/macro-trailer-frames}
WORKERS=${WORKERS:-4}

# Music (Mixkit Stock Music Free License), fetched on demand, never committed:
#   ambient: "Kodama Night Town" (Mixkit 114), funk: "Are U Ready For This?" (Mixkit 1127)
[ -f audio/song-ambient-kodama-night-town.mp3 ] || curl -sSL -o audio/song-ambient-kodama-night-town.mp3 https://assets.mixkit.co/music/114/114.mp3
[ -f audio/song-funk-are-u-ready.mp3 ] || curl -sSL -o audio/song-funk-are-u-ready.mp3 https://assets.mixkit.co/music/1127/1127.mp3

node render.mjs cues audio/cues.json
(cd audio && FF="$FF" python3 mix.py)
"$FF" -y -loglevel error -i audio/mix.wav -c:a aac -b:a 192k macro-trailer-audio.m4a

rm -rf "$FRAMES"
node render.mjs frames "$FRAMES" "$WORKERS"   # 60 fps x 4 subframes, 180° shutter

FF="$FF" FRAMES="$FRAMES" ./encode.sh
