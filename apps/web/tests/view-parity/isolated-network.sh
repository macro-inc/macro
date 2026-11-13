#!/usr/bin/env bash
# Runs a command in its own network namespace, with the given localhost ports
# forwarded from the host. Chromium drops in-flight requests whenever a host
# network interface changes (net::ERR_NETWORK_CHANGED); in the namespace none
# ever does.
# The namespace has its own process tree too, so killing the script or its
# process group stops everything in it.
#
#   tests/view-parity/isolated-network.sh "<port> <port>" <command...>
#
# Linux only. Needs unprivileged user namespaces, `ip` and `socat`.
set -uo pipefail

ports=$1
shift

# A unix socket path is capped at 108 bytes, so both ends of each bridge run
# from inside the socket directory and use a relative path.
sockets=$(mktemp -d)
bridges=()
for port in $ports; do
  (cd "$sockets" && exec socat "UNIX-LISTEN:$port.sock,fork" "TCP:127.0.0.1:$port") &
  bridges+=($!)
done
# Killing unshare kills the namespace's first process (--kill-child), and the
# kernel then stops everything else in it, so the trap ends the namespace too
# when the script itself is the one being killed.
namespace=
trap 'kill -KILL $namespace 2>/dev/null; kill "${bridges[@]}" 2>/dev/null; rm -rf "$sockets"' EXIT

SOCKETS=$sockets PORTS=$ports unshare --map-root-user --net --pid --fork --mount-proc --kill-child bash -c '
  ip link set lo up
  forwards=()
  for port in $PORTS; do
    (cd "$SOCKETS" && exec socat "TCP-LISTEN:$port,fork,reuseaddr,bind=127.0.0.1" "UNIX-CONNECT:$port.sock") &
    forwards+=($!)
  done
  sleep 0.5
  "$@"
  status=$?
  kill "${forwards[@]}" 2>/dev/null
  exit $status
' isolated-network "$@" &
namespace=$!
wait "$namespace"
