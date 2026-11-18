#!/usr/bin/env bash
# Firecracker host CLI adapter. Run against the disposable benchmark host only.
# FIRECRACKER_IMAGE must identify a real macro-box image, not the minimal CI Ubuntu image.
set -euo pipefail
# The host agent's client, as installed on the host; may carry options
# (e.g. FIRECRACKER_HOST_CLI="firecracker-host client --endpoint <file>").
read -ra cli <<< "${FIRECRACKER_HOST_CLI:-firecracker-host client}"
state=${FIRECRACKER_STATE_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}/computer-bench/firecracker}
operation=${1:?operation required}
if [ "$operation" = up ]; then name=${3:?name required}; else name=${2:?name required}; fi
if [[ ! $name =~ ^e2e-[a-zA-Z0-9-]+$ ]]; then echo 'Require an e2e-prefixed guest name' >&2; exit 2; fi
mkdir -p "$state"
file=$state/$name
now() { date +%s.%N; }
case $operation in
up)
  : "${FIRECRACKER_IMAGE:?set FIRECRACKER_IMAGE to the macro-box image id}"
  # A durable, locked counter allocates IDs only within this worker's namespace.
  # Keep the mapping until destroy succeeds so failed creates remain cleanable.
  exec 8>"$state/ids.lock"
  flock 8
  if [ -e "$file" ]; then echo "Guest state already exists: $file" >&2; exit 2; fi
  next=1
  if [ -e "$state/next" ]; then read -r next < "$state/next"; fi
  if [ "$next" -gt 65535 ]; then echo 'Guest UUID namespace exhausted' >&2; exit 2; fi
  printf -v id '01937a00-0000-7000-8000-0000000e%04x' "$next"
  printf '%s\n' "$id" > "$file"
  printf '%s\n' "$((next + 1))" > "$state/next"
  flock -u 8
  start=$(now)
  deadline=$(( $(date +%s) + ${FIRECRACKER_GOLDEN_TIMEOUT:-300} ))
  while :; do
    if response=$("${cli[@]}" create "$id" --role person --pairing-id "$id" --image "$FIRECRACKER_IMAGE" --vcpus "${SMP:-4}" \
      --memory-mib "$(( ${MEM_GIB:-16} * 1024 ))" \
      --root-disk-gib "${FIRECRACKER_ROOT_GIB:-32}" --home-disk-gib "${FIRECRACKER_HOME_GIB:-32}" 2>&1); then break; fi
    printf '%s\n' "$response" >&2
    if [[ ${response,,} != *goldennotready* && ${response,,} != *guestunreachable* ]] || [ "$(date +%s)" -gt "$deadline" ]; then exit 1; fi
    sleep 2
  done
  printf '{"t_start":%s,"t_running":%s,"computer_id":"%s"}\n' "$start" "$(now)" "$id"
  ;;
down)
  if [ ! -f "$file" ]; then exit 0; fi
  read -r id < "$file"
  "${cli[@]}" destroy "$id"
  rm "$file"
  ;;
exec)
  read -r id < "$file"
  shift 2
  exec "${cli[@]}" exec --root "$id" -- bash -lc "$*"
  ;;
stop|start|hibernate)
  read -r id < "$file"
  exec "${cli[@]}" "$operation" "$id"
  ;;
*) echo "Unsupported operation: $operation" >&2; exit 2 ;;
esac
