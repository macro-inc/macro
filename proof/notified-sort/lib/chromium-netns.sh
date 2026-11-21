#!/usr/bin/env bash
# Chromium in a network namespace of its own, reaching only the two dev
# servers. Chromium fails every in-flight request (net::ERR_NETWORK_CHANGED)
# when the host's interfaces change, and container restarts on a shared
# machine change them every few seconds; in its own namespace it sees only
# loopback. Each port in PROOF_NETNS_PORTS is carried from the namespace's
# loopback to the host's over a Unix socket. Playwright runs this as the
# browser executable (PROOF_CHROMIUM is the real one) and talks to it over
# inherited pipes, which the namespace does not touch.
set -euo pipefail
: "${PROOF_CHROMIUM:?}" "${PROOF_SOCAT:?}" "${PROOF_NETNS_PORTS:?}"
pids=()
if [ -n "${PROOF_NETNS_HOSTDIR:-}" ]; then
  # The host side is already served (lib/module-cache.ts).
  dir="$PROOF_NETNS_HOSTDIR"
  cleanup() { :; }
else
  dir="$(mktemp -d)"
  cleanup() {
    kill "${pids[@]}" 2>/dev/null || true
    rm -rf "$dir"
  }
  for port in ${PROOF_NETNS_PORTS//,/ }; do
    "$PROOF_SOCAT" "UNIX-LISTEN:$dir/$port.sock,fork" "TCP4:127.0.0.1:$port" &
    pids+=("$!")
  done
fi
trap cleanup EXIT
trap 'kill -TERM "$child" 2>/dev/null; wait "$child"; exit 143' TERM INT
for port in ${PROOF_NETNS_PORTS//,/ }; do
  until [ -S "$dir/$port.sock" ]; do sleep 0.05; done
done
export NETNS_DIR="$dir"
unshare --user --map-root-user --net bash -c '
  set -euo pipefail
  ip link set lo up
  for port in ${PROOF_NETNS_PORTS//,/ }; do
    "$PROOF_SOCAT" "TCP4-LISTEN:$port,bind=127.0.0.1,fork,reuseaddr" "UNIX-CONNECT:$NETNS_DIR/$port.sock" &
    "$PROOF_SOCAT" "TCP6-LISTEN:$port,bind=[::1],fork,reuseaddr,ipv6only" "UNIX-CONNECT:$NETNS_DIR/$port.sock" &
  done
  "$PROOF_CHROMIUM" "$@" &
  browser=$!
  trap "kill -TERM $browser 2>/dev/null" TERM INT
  status=0
  wait $browser || status=$?
  kill $(jobs -p) 2>/dev/null || true
  exit $status
' bash "$@" &
child=$!
wait "$child"
