#!/usr/bin/env bash
# Host-side guest checks. Run only on the disposable benchmark host.
# run-checks.sh BACKEND VARIANT OUT_DIR
# BACKEND_SCRIPT may select a compatible adapter; see README.md.
set -euo pipefail
TIMED_LOCK=${TIMED_LOCK:-/srv/locks/timed.lock}
here=$(\cd "$(dirname "$0")" && pwd)
backend=${1:?backend required} variant=${2:?variant required} out=${3:?output directory required}
b=${BACKEND_SCRIPT:-$here/backends/$backend.sh}
name=${E2E_NAME:-e2e-$backend-$variant-$$}
mac=52:54:00:ee:$(printf '%02x:%02x' "$((RANDOM % 256))" "$((RANDOM % 256))")
export SMP=${SMP:-4} MEM_GIB=${MEM_GIB:-16} MEM=${MEM:-16G}
functional=${E2E_FUNCTIONAL:-0}
external_lock=${E2E_LOCK_HELD:-0}
if [[ $functional != 0 && $functional != 1 ]]; then echo 'E2E_FUNCTIONAL must be 0 or 1' >&2; exit 2; fi
if [[ $external_lock != 0 && $external_lock != 1 ]]; then echo 'E2E_LOCK_HELD must be 0 or 1' >&2; exit 2; fi
acquire_lock() { [ "$functional" = 1 ] || [ "$external_lock" = 1 ] || flock -n 9; }
release_lock() { [ "$functional" = 1 ] || [ "$external_lock" = 1 ] || flock -u 9; }
mkdir -p "$out"
out=$(realpath "$out")
# Check availability before creating a guest; take the lock again per timed phase.
# Nonblocking acquisition leaves the host free for the current lock holder.
if [ "$functional" = 0 ] && [ "$external_lock" = 0 ]; then exec 9<"$TIMED_LOCK"; fi
if ! acquire_lock; then
  echo 'Timed lock busy; retry after the current host benchmark finishes.' >&2
  exit 75
fi
created=false
cleanup() {
  local rc=$? cleaned=true
  trap - EXIT
  release_lock
  if [ "$created" = true ]; then
    "$b" down "$name" >> "$out/lifecycle.log" 2>&1 || { echo "Cleanup failed for $name" >&2; cleaned=false; rc=1; }
  fi
  jq -cn --arg name "$name" --argjson ok "$cleaned" '{guest:$name,ok:$ok}' > "$out/cleanup.json"
  exit "$rc"
}
trap cleanup EXIT
wait_exec() {
  local deadline=$(( $(date +%s) + ${E2E_EXEC_TIMEOUT:-60} ))
  until timeout 5 "$b" exec "$name" 'systemctl is-active --quiet macro-home.target && mountpoint -q /home && echo up' 2>/dev/null | grep -x up >/dev/null; do
    if [ "$(date +%s)" -gt "$deadline" ]; then echo 'Guest exec never answered' >&2; return 1; fi
    sleep 1
  done
}
# Failed guest checks still produce JSON; collect all independent phases.
run_checks() {
  local mode=$1 response rc=0 result
  if ! acquire_lock; then
    echo "Timed lock busy before $mode; leaving prior phase results in $out" >&2
    exit 75
  fi
  response=$("$b" exec "$name" "bash /root/guest-checks.sh $mode" 2>> "$out/lifecycle.log") || rc=$?
  result=$(tail -n 1 <<< "$response")
  if ! jq -e --arg mode "$mode" '.mode == $mode and (.ok | type == "boolean")' <<< "$result" >/dev/null 2>&1; then
    printf '%s\n' "$response" > "$out/$mode-invalid.log"
    result=$(jq -cn --arg mode "$mode" --argjson rc "$rc" '{mode:$mode,ok:false,error:"Missing guest JSON",transport_exit_code:$rc}')
  fi
  printf '%s\n' "$result" > "$out/$mode.json"
  # Keep detailed package, browser and compiler diagnostics after guest deletion.
  "$b" exec "$name" 'tar -C /home/macro/.macro-guest-checks -czf - logs home-mount rg-version cargo/Cargo.lock browser/package-lock.json 2>/dev/null | base64 -w0; echo' > "$out/$mode-logs.base64" 2>> "$out/lifecycle.log" || true
  release_lock
}
created=true
"$b" up "$variant" "$name" "$mac" > "$out/create.json" 2>> "$out/lifecycle.log"
wait_exec
for file in guest-checks.sh browser-checks.mjs mcp-checks.py; do
  "$b" exec "$name" "echo '$(base64 -w0 "$here/$file")' | base64 -d > /root/$file" >> "$out/lifecycle.log" 2>&1
done
release_lock
run_checks before
if ! acquire_lock; then echo "Timed lock busy before stop/start" >&2; exit 75; fi
"$b" stop "$name" >> "$out/lifecycle.log" 2>&1
"$b" start "$name" "$mac" >> "$out/lifecycle.log" 2>&1
wait_exec
release_lock
run_checks after
if [ "$functional" = 0 ]; then run_checks big-build; fi
run_checks browsers
if [ "${E2E_HIBERNATE:-0}" = 1 ]; then
  run_checks hibernate-before
  if ! acquire_lock; then echo "Timed lock busy before hibernate/wake" >&2; exit 75; fi
  "$b" hibernate "$name" >> "$out/lifecycle.log" 2>&1
  "$b" start "$name" "$mac" >> "$out/lifecycle.log" 2>&1
  wait_exec
  release_lock
  run_checks hibernate-after
fi
files=("$out/before.json" "$out/after.json")
if [ "$functional" = 0 ]; then files+=("$out/big-build.json"); fi
files+=("$out/browsers.json")
if [ "${E2E_HIBERNATE:-0}" = 1 ]; then files+=("$out/hibernate-before.json" "$out/hibernate-after.json"); fi
jq -sc --arg backend "$backend" --arg variant "$variant" --argjson functional "$functional" \
  '{backend:$backend,variant:$variant,timing_valid:($functional == 0),source_build_skipped:($functional == 1),ok:all(.[];.ok),phases:.}' "${files[@]}" | tee -a "$out/checks.jsonl"
jq -e '.ok' < <(tail -n 1 "$out/checks.jsonl") >/dev/null
