#!/usr/bin/env bash
# Supervised SSH-over-IAP tunnels between this machine and a Macro computers host.
#
#   computers-tunnels.sh incus             localhost:18443 -> host Incus API (127.0.0.1:8443)
#   computers-tunnels.sh reverse PORT...   boxes reach <bridge>:PORT -> this machine's localhost:PORT
#   computers-tunnels.sh all PORT...       both
#
# Each tunnel restarts when it drops. Environment:
#   GCLOUD            gcloud binary (default: gcloud on PATH)
#   RUNTIME_HOST      instance name (default: runtime-dev-1)
#   GCP_PROJECT       (default: macro-435922)
#   GCP_ZONE          (default: us-east4-b)
#   INCUS_LOCAL_PORT  (default: 18443)
set -euo pipefail

gcloud_bin=${GCLOUD:-$(command -v gcloud || true)}
host=${RUNTIME_HOST:-runtime-dev-1}
project=${GCP_PROJECT:-macro-435922}
zone=${GCP_ZONE:-us-east4-b}
incus_local_port=${INCUS_LOCAL_PORT:-18443}
bridge_address=10.210.0.1
state_dir=${XDG_CONFIG_HOME:-$HOME/.config}/macro-computers

if [[ -z $gcloud_bin ]]; then
  echo "gcloud not found; set GCLOUD" >&2
  exit 1
fi
mkdir -p "$state_dir"

# ssh_tunnel [SSH_OPTION...] [-- REMOTE_COMMAND...]
ssh_tunnel() {
  local options=()
  while (($# > 0)) && [[ $1 != -- ]]; do
    options+=("$1")
    shift
  done
  (($# > 0)) && shift
  ssh \
    -o "ProxyCommand=$gcloud_bin compute start-iap-tunnel $host 22 --listen-on-stdin --project $project --zone $zone --verbosity=warning" \
    -o HostKeyAlias="$host" \
    -o UserKnownHostsFile="$state_dir/known_hosts" \
    -o StrictHostKeyChecking=accept-new \
    -o ServerAliveInterval=15 \
    -o ServerAliveCountMax=3 \
    -o ExitOnForwardFailure=yes \
    -o BatchMode=yes \
    "${options[@]}" "root@$host" "$@"
}

supervise() {
  local name=$1
  shift
  while true; do
    echo "[$name] connecting" >&2
    set +e
    "$@"
    local status=$?
    set -e
    echo "[$name] exited with $status; restarting in 3s" >&2
    sleep 3
  done
}

incus_tunnel() {
  ssh_tunnel -N -L "localhost:$incus_local_port:127.0.0.1:8443"
}

reverse_tunnel() {
  local forwards=() elements=()
  for port in "$@"; do
    [[ $port =~ ^[0-9]+$ ]] || { echo "not a port: $port" >&2; exit 1; }
    forwards+=(-R "$bridge_address:$port:localhost:$port")
    elements+=("$port")
  done
  local set_ports
  set_ports=$(IFS=,; echo "${elements[*]}")
  # The remote loop keeps the host's @tunnel_ports set fresh; entries expire
  # 90s after the tunnel dies, closing those ports to boxes again.
  local refresh="add element inet macro-boxes tunnel_ports { $set_ports }
delete element inet macro-boxes tunnel_ports { $set_ports }
add element inet macro-boxes tunnel_ports { $(sed 's/,/ timeout 90s,/g; s/$/ timeout 90s/' <<<"$set_ports") }"
  ssh_tunnel "${forwards[@]}" -- \
    "while :; do printf '%s\n' '$refresh' | nft -f - || exit 1; sleep 30; done"
}

command=${1:-}
shift || true
case $command in
  incus)
    supervise incus incus_tunnel
    ;;
  reverse)
    (($# > 0)) || { echo "usage: $0 reverse PORT..." >&2; exit 1; }
    supervise reverse reverse_tunnel "$@"
    ;;
  all)
    (($# > 0)) || { echo "usage: $0 all PORT..." >&2; exit 1; }
    trap 'kill 0' EXIT INT TERM
    supervise incus incus_tunnel &
    supervise reverse reverse_tunnel "$@" &
    wait
    ;;
  *)
    echo "usage: $0 {incus | reverse PORT... | all PORT...}" >&2
    exit 1
    ;;
esac
