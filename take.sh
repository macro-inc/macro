#!/usr/bin/env bash
# One take: rxvt 2.7.10 (no truecolor) before vs after, then xterm (truecolor).
set -u
export DISPLAY=:211 FONTCONFIG_FILE=/tmp/p11627/fonts.conf
P=/tmp/p11627
RXVT=/nix/store/j0wv8aidwrfa59pmnyh08034q1yswblz-rxvt-2.7.10/bin/rxvt
XTERM=/nix/store/1icsv82zkwndwjq0ng0yfnanpfyjz1x2-xterm-411/bin/xterm
XDO=/nix/store/afzdk9rxicwxb9ywwm2107w58czah1gc-xdotool-3.20211022.1/bin/xdotool
FFMPEG=/nix/store/bygyqv3pskglmfr93mynh1g77ys5kz3i-ffmpeg-full-9.0.2-bin/bin/ffmpeg
F=-misc-fixed-medium-r-normal--15-140-75-75-c-90-iso8859-1
FB=-misc-fixed-bold-r-normal--15-140-75-75-c-90-iso8859-1
pids=()
caps=$P/captions.json; echo -n '{"captions":[' > $caps; first=1
t0=0
cap() { local at; at=$(python3 -c "import time,sys; print(time.time()-float(sys.argv[1]))" $t0); [ $first = 1 ] || echo -n ',' >> $caps; first=0
  python3 -c 'import json,sys; print(json.dumps({"at": float(sys.argv[1]), "text": sys.argv[2]}), end="")' "$at" "$1" >> $caps; }
label() { # x text color
  $RXVT +sb -fn "$FB" -geometry 104x1+$1+0 -bg "$3" -fg black -title lbl -e $P/label.sh "$2" >/dev/null 2>&1 & pids+=($!); }
term() { # x binary home mode
  $RXVT +sb -fn "$F" -geometry 104x63+$1+22 -bg black -fg white -title "$5" -e $P/run.sh $P/$2 $P/$3 $4 >/dev/null 2>&1 & pids+=($!); }
keys() { # where key: pointer into that window, then a real (XTEST) key press
  case $1 in before|tc) $XDO mousemove 400 500;; after|bytes) $XDO mousemove 1400 500;; esac; shift; $XDO key "$@"; }
killall_mine() { for p in "${pids[@]}"; do kill "$p" 2>/dev/null; done; pids=(); sleep 1; }

# Pre-roll
label 0   " BEFORE  87d3e19 (parent of merge)  rxvt 2.7.10  TERM=xterm-256color, no COLORTERM" '#ffb070'
label 964 " AFTER  main 3591681  rxvt 2.7.10  TERM=xterm-256color, no COLORTERM" '#8fd18f'
term 0   macrod-before home-before-quick 256 before
term 964 macrod-after  home-after-quick  256 after
sleep 4
$FFMPEG -loglevel error -y -f x11grab -framerate 25 -video_size 1920x1080 -i :211 -c:v libx264 -preset veryfast -crf 18 -pix_fmt yuv420p $P/raw.mp4 </dev/null & ff=$!
t0=$(date +%s.%N); sleep 0.5
cap "rxvt 2.7.10 has no truecolor and reads RGB escapes one number at a time, like Terminal.app. Quickstart:"
sleep 7
cap "Moving the selection repaints cells: before keeps painting teal, after stays in theme colors"
for i in 1 2 3; do keys before j; keys after j; sleep 1.2; keys before k; keys after k; sleep 1.2; done
sleep 2
cap "The main panel (stand-in config, no server: 'could not reach the service' is expected)"
killall_mine
label 0   " BEFORE  87d3e19 (parent of merge)  rxvt 2.7.10  TERM=xterm-256color, no COLORTERM" '#ffb070'
label 964 " AFTER  main 3591681  rxvt 2.7.10  TERM=xterm-256color, no COLORTERM" '#8fd18f'
term 0   macrod-before home-before-main 256 before
term 964 macrod-after  home-after-main  256 after
sleep 6
cap "Flipping tabs 2 Sessions, 3 Config, 4 Logs, 1 Overview repaints the whole panel"
for k in 2 3 4 1; do keys before $k; keys after $k; sleep 2.5; done
sleep 2
cap "A truecolor terminal (xterm 411, COLORTERM=truecolor) still gets 24-bit RGB from main"
killall_mine
label 0   " AFTER  main 3591681  xterm 411  COLORTERM=truecolor" '#8fd18f'
label 964 " Bytes on the wire: colour escapes each build writes in 3 s of Quickstart" '#a0c4ff'
$XTERM -geometry 116x62+0+22 -fa 'JetBrains Mono' -fs 9 -bg black -fg white -title tc -e $P/run.sh $P/macrod-after $P/home-tc-main truecolor >/dev/null 2>&1 & pids+=($!)
$RXVT +sb -fn "$F" -geometry 104x63+964+22 -bg black -fg white -title bytes -e bash -c "$P/sgr-count.sh; sleep 3600" >/dev/null 2>&1 & pids+=($!)
sleep 8
keys tc 3; sleep 3; keys tc 1
cap "Before: RGB to the 256-color terminal. After: 256-color indexes there, RGB only where truecolor is declared"
sleep 7
kill -INT $ff; wait $ff
dur=$(python3 -c "import time,sys; print(time.time()-float(sys.argv[1]))" $t0)
echo "],\"duration\": $dur}" >> $caps
killall_mine
