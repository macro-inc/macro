#!/usr/bin/env bash
# Run each macrod for 3 s in a pty and count the colour escapes it writes.
cd /tmp/p11627
count() { # label binary home mode
  f=out-$5.bin
  script -q -c "stty cols 104 rows 40; timeout 3 /tmp/p11627/run.sh /tmp/p11627/$2 /tmp/p11627/$3 $4" /tmp/p11627/$f >/dev/null 2>&1 </dev/null
  rgb=$(grep -aoE $'\e\\[[0-9;]*[34]8;2;[0-9]+;[0-9]+;[0-9]+' $f | wc -l)
  idx=$(grep -aoE $'\e\\[[0-9;]*[34]8;5;[0-9]+' $f | wc -l)
  printf '%-44s RGB (38;2/48;2): %5d   256 (38;5/48;5): %5d\n' "$1" "$rgb" "$idx"
}
echo "Colour escapes macrod writes in 3 s of Quickstart:"
count "before 87d3e19, TERM=xterm-256color"    macrod-before home-before-quick 256 before
count "after main, TERM=xterm-256color"        macrod-after  home-after-quick  256 after
count "after main, COLORTERM=truecolor"        macrod-after  home-tc-quick     truecolor tc
