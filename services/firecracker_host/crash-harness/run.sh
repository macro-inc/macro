#!/usr/bin/env bash
# Kill the agent (SIGKILL, as kill -9) at each crash point, start it again,
# and check that it settles the computer as README.md says, that the
# interrupted operation succeeds when retried, and that no process, jail or
# slot leaks. Needs setup.sh first. Usage: run.sh [crash-point ...]
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
. "$here/env.sh"
. "$here/lib.sh"

# One computer per case, its id derived from the case's position in $all.
computer() { printf '01937a00-0000-7000-8000-%012x\n' "$((0xc4a500 + $1))"; }

create() {
  client create "$1" --image "$IMAGE" --vcpus "$VCPUS" --memory-mib "$MEMORY_MIB" \
    --root-disk-gib "$ROOT_DISK_GIB" --home-disk-gib 4 "${@:2}" >/dev/null
}

# Run an operation the armed agent dies in; its failure is the point.
interrupted() {
  if "$@" >/dev/null 2>&1; then
    fail "$* succeeded; the agent should have died in it"
  fi
  wait_dead
}

clean_up() {
  # A just-ended VM's dataset can stay busy for a while; the control
  # plane's destroy effect retries the same way.
  local deadline=$((SECONDS + 120)) errors
  errors=$(mktemp)
  until client destroy "$1" >/dev/null 2>"$errors"; do
    grep -q "dataset is busy" "$errors" || fail "destroy $1: $(cat "$errors")"
    [ "$SECONDS" -lt "$deadline" ] || fail "dataset of $1 still busy after 120 s"
    log "WARN destroy $1: dataset busy, retrying"
    sleep 5
  done
  rm -f "$errors"
  expect_state "$1" absent
  sudo zfs list -H "$DATASET/computers/$1" >/dev/null 2>&1 && fail "dataset of $1 left behind"
  check_invariants
}

# Case bodies: setup with the agent unarmed, the interrupted operation
# with it armed, then checks with it unarmed.
case_create_disks_prepared() {
  local id=$1
  start_agent create-disks-prepared
  interrupted create "$id"
  start_agent ""
  expect_state "$id" absent
  create "$id"
  expect_state "$id" running
  expect_exec "$id"
}

case_create_record_saved() {
  local id=$1
  start_agent create-record-saved
  interrupted create "$id"
  start_agent ""
  expect_state "$id" stopped
  create "$id"
  expect_state "$id" running
  expect_exec "$id"
}

# Killed inside the launch: a VM runs that no record points at.
case_launch() {
  local id=$1 point=$2
  start_agent "$point"
  interrupted create "$id"
  start_agent ""
  expect_state "$id" stopped
  check_invariants
  create "$id"
  expect_state "$id" running
  expect_exec "$id"
}

case_launch_saved() {
  local id=$1
  start_agent launch-saved
  interrupted create "$id"
  start_agent ""
  expect_state "$id" running
  wait_restored "$id"
  expect_exec "$id"
}

# Killed inside a hibernation; $2 is the point, $3 the state the
# restarted agent must settle on.
case_hibernate() {
  local id=$1 point=$2 settled=$3
  start_agent ""
  create "$id"
  stop_agent
  start_agent "$point"
  interrupted client hibernate "$id"
  start_agent ""
  expect_state "$id" "$settled"
  check_invariants
  if [ "$settled" = paused ]; then
    client hibernate "$id" >/dev/null
    expect_state "$id" hibernated
  fi
  client start "$id" >/dev/null
  expect_state "$id" running
  expect_exec "$id"
}

case_wake_saved() {
  local id=$1
  start_agent ""
  create "$id"
  client hibernate "$id" >/dev/null
  stop_agent
  start_agent wake-saved
  interrupted client start "$id"
  start_agent ""
  expect_state "$id" running
  sudo test -e "$ROOT/zfs/hibernation/$id" && fail "stale hibernation of $id left behind"
  expect_exec "$id"
}

case_destroy_disks_deleted() {
  local id=$1
  start_agent ""
  create "$id"
  stop_agent
  start_agent destroy-disks-deleted
  interrupted client destroy "$id"
  start_agent ""
  # The record lives in the computer's dataset: gone with the disks.
  case "$(state_of "$id")" in
    absent | stopped) ;;
    *) fail "computer $id is $(state_of "$id") after a destroy cut short" ;;
  esac
}

# A golden build killed in the guest's boot: a shape of its own, so the
# harness's golden stays.
case_golden_booted() {
  local memory=$((MEMORY_MIB + 256))
  start_agent golden-booted
  client build-golden --image "$IMAGE" --vcpus "$VCPUS" --memory-mib "$memory" >/dev/null
  wait_dead 900
  start_agent ""
  check_invariants
  client build-golden --image "$IMAGE" --vcpus "$VCPUS" --memory-mib "$memory" >/dev/null
  wait_golden_ready "$VCPUS" "$memory"
  check_invariants
}

all=(
  create-disks-prepared create-record-saved launch-spawned launch-returned launch-saved
  hibernate-flag-saved hibernate-snapshot-created hibernate-published hibernate-ended
  wake-saved destroy-disks-deleted golden-booted
)
cases=("${all[@]}")
if [ "$#" -gt 0 ]; then cases=("$@"); fi

for point in "${cases[@]}"; do
  # Each point has its own computer, so a case cut short never leaks
  # into another.
  number=0
  for index in "${!all[@]}"; do
    [ "${all[$index]}" = "$point" ] && number=$((index + 1))
  done
  [ "$number" -gt 0 ] || fail "no case for $point"
  id=$(computer "$number")
  log "case $point ($id)"
  case "$point" in
    create-disks-prepared) case_create_disks_prepared "$id" ;;
    create-record-saved) case_create_record_saved "$id" ;;
    launch-spawned | launch-returned) case_launch "$id" "$point" ;;
    launch-saved) case_launch_saved "$id" ;;
    hibernate-flag-saved | hibernate-snapshot-created) case_hibernate "$id" "$point" paused ;;
    hibernate-published | hibernate-ended) case_hibernate "$id" "$point" hibernated ;;
    wake-saved) case_wake_saved "$id" ;;
    destroy-disks-deleted) case_destroy_disks_deleted "$id" ;;
    golden-booted) case_golden_booted; log "PASS $point"; continue ;;
    *) fail "no case for $point" ;;
  esac
  check_invariants
  clean_up "$id"
  log "PASS $point"
done
stop_agent
log "all ${#cases[@]} cases passed"
