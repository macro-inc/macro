#!/bin/sh
# isolated.sh <port> <command...>: run a command in a network namespace of its own with only the
# stack's proxy port forwarded in, so container churn on this box cannot abort Chromium's requests
# (ERR_NETWORK_CHANGED). Needs socat on PATH and the system bwrap.
port=$1; shift
sock="${XDG_RUNTIME_DIR:-/tmp}/che2e-$port-$$.sock"
socat "UNIX-LISTEN:$sock,fork,unlink-early,unlink-close" "TCP:127.0.0.1:$port" &
outer=$!
sleep 1
/usr/bin/bwrap --unshare-net --dev-bind / / sh -c '
  port=$1; sock=$2; shift 2
  ip link set lo up 2>/dev/null
  socat "TCP-LISTEN:$port,fork,reuseaddr" "UNIX-CONNECT:$sock" & inner=$!
  sleep 1
  "$@"; code=$?
  kill $inner
  exit $code' sh "$port" "$sock" "$@"
code=$?
kill $outer
exit $code
