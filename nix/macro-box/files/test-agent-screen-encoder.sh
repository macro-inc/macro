# The agent screen encoder against Xvfb: a bad config line is refused, a good
# one gives Constrained Baseline H.264 as ftyp + moov, then one moof + mdat per
# frame. Called by the macro-box-screen-encoder check with the encoder on PATH.
set -euo pipefail

Xvfb :7 -screen 0 1280x720x24 -nolisten tcp &
xvfb=$!
trap 'kill $xvfb' EXIT
until [ -S /tmp/.X11-unix/X7 ]; do sleep 0.1; done
export DISPLAY=:7

for line in "" "0 640 360 10" "10 641 360 10" "10 640 360 10 x" "10 640 360"; do
  if printf '%s\n' "$line" | agent-screen-encoder > refused.mp4 2> /dev/null; then
    echo "accepted config line '$line'" >&2
    exit 1
  fi
  [ ! -s refused.mp4 ] || { echo "wrote output for '$line'" >&2; exit 1; }
done

# ffmpeg ignores stdin (the connection), so stop it with SIGINT as a closed
# connection's SIGPIPE would.
{ printf '10 640 360 5\n'; sleep 10; } | timeout -s INT 3 agent-screen-encoder > out.mp4 || [ $? = 124 ]

stream=$(ffprobe -v error -select_streams v:0 -count_packets \
  -show_entries stream=codec_name,profile,width,height,has_b_frames,nb_read_packets -of csv=p=0 out.mp4)
echo "stream: $stream"
IFS=, read -r codec profile width height b_frames packets <<< "$stream"
[ "$codec,$profile,$width,$height,$b_frames" = "h264,Constrained Baseline,640,360,0" ]
[ "$packets" -ge 10 ]

python3 - out.mp4 "$packets" <<'PY'
import struct, sys
data = open(sys.argv[1], "rb").read()
boxes, at = [], 0
while at < len(data):
    size, kind = struct.unpack(">I4s", data[at:at + 8])
    boxes.append(kind.decode())
    at += size
assert boxes[:2] == ["ftyp", "moov"], boxes[:4]
fragments = [b for b in boxes[2:] if b != "mfra"]
assert fragments == ["moof", "mdat"] * (len(fragments) // 2), fragments[:8]
assert len(fragments) // 2 == int(sys.argv[2]), (len(fragments) // 2, sys.argv[2])
print(f"{len(fragments) // 2} fragments, one per frame")
PY
