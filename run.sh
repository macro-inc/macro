#!/usr/bin/env bash
# run.sh <variant-binary> <home> <mode: 256|truecolor>
cd /tmp/p11627/workspace; bin=$1; home=$2; mode=$3
if [ "$mode" = 256 ]; then
  exec unshare -r -u /bin/sh -c "hostname proof-box; exec \"\$0\" \"\$@\"" env -i PATH=/run/current-system/sw/bin HOME=$home TERM=xterm-256color TERM_PROGRAM=Apple_Terminal LANG=C.UTF-8 "$bin"
else
  exec unshare -r -u /bin/sh -c "hostname proof-box; exec \"\$0\" \"\$@\"" env -i PATH=/run/current-system/sw/bin HOME=$home TERM=xterm-256color COLORTERM=truecolor LANG=C.UTF-8 "$bin"
fi
