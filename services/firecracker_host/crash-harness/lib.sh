# shellcheck shell=bash
# Helpers for the crash harness; sourced after env.sh.

log() { printf '%s %s\n' "$(date -u +%H:%M:%S)" "$*" >&2; }
fail() { log "FAIL: $*"; exit 1; }

main_pid() { systemctl show -p MainPID --value "$UNIT"; }

# (Re)start the agent, armed at crash point $1 (empty: unarmed), and wait
# until it answers.
start_agent() {
  local point=$1
  if [ -n "$point" ]; then
    echo "CRASH_ARGS=--crash-at $point" | sudo tee "$ROOT/crash.env" >/dev/null
  else
    echo "CRASH_ARGS=" | sudo tee "$ROOT/crash.env" >/dev/null
  fi
  sudo systemctl reset-failed "$UNIT" 2>/dev/null || true
  sudo systemctl restart "$UNIT"
  started_at=$(date +%s)
  local deadline=$((SECONDS + 120))
  until client host >/dev/null 2>&1; do
    [ "$SECONDS" -lt "$deadline" ] || fail "agent did not answer within 120 s"
    sleep 0.5
  done
}

# Stop the agent the way systemd does (SIGTERM, VMs stay).
stop_agent() {
  sudo systemctl stop "$UNIT" 2>/dev/null || true
}

# Wait until the armed agent killed itself.
wait_dead() {
  local deadline=$((SECONDS + ${1:-300}))
  while [ "$(main_pid)" != 0 ]; do
    [ "$SECONDS" -lt "$deadline" ] || fail "agent still alive; crash point not reached"
    sleep 0.5
  done
  # journald may write the agent's last line a moment after it died.
  # grep reads everything (no -q): under pipefail, a grep that stops at the
  # match kills journalctl and sed with SIGPIPE and fails the pipe.
  local _
  for _ in $(seq 20); do
    if sudo journalctl -u "$UNIT" --since "@$started_at" --no-pager -q -o cat | sed 's/\x1b\[[0-9;]*m//g' \
      | grep "crash point reached" >/dev/null; then
      return 0
    fi
    sleep 0.5
  done
  fail "agent died, but not at its crash point"
}

# A computer's state, or "absent".
state_of() {
  local output
  if output=$(client get "$1" 2>&1); then
    jq -r .state <<<"$output"
  elif grep -qi "does not exist" <<<"$output"; then
    echo absent
  else
    fail "get $1: $output"
  fi
}

expect_state() {
  local actual
  actual=$(state_of "$1")
  [ "$actual" = "$2" ] || fail "computer $1 is $actual, expected $2"
}

# Wait for the restore that the restarted agent resumes in the background.
wait_restored() {
  local deadline=$((SECONDS + 120))
  until [ "$(client get "$1" | jq -r .restorePending)" = false ]; do
    [ "$SECONDS" -lt "$deadline" ] || fail "computer $1 still has restorePending"
    sleep 1
  done
}

wait_golden_ready() {
  local deadline=$((SECONDS + 900)) kind
  while :; do
    kind=$(client goldens | jq -r --arg image "$IMAGE" --argjson vcpus "$1" --argjson memory "$2" \
      '.[] | select(.key.image == $image and .key.vcpus == $vcpus and .key.memoryMib == $memory) | .state.kind')
    case "$kind" in
      ready) return 0 ;;
      failed) fail "golden ${1}v-${2}m failed: $(client goldens)" ;;
    esac
    [ "$SECONDS" -lt "$deadline" ] || fail "golden ${1}v-${2}m not ready in time"
    sleep 5
  done
}

# The guest answers a command.
expect_exec() {
  client exec "$1" -- true || fail "exec in $1 failed"
}

health() {
  curl -sS --cacert "$ROOT/tls/server.crt" --cert "$ROOT/tls/client.crt" \
    --key "$ROOT/tls/client.key" "https://127.0.0.1:$PORT/health"
}

# What must hold after every case: the host is ready (the reconcile left
# nothing), Firecracker processes are exactly those of running or paused
# computers, and so are the jails and the taken network slots.
check_invariants() {
  local report live jails processes slots_free
  report=$(health)
  [ "$(jq -r .ready <<<"$report")" = true ] || fail "not ready: $report"
  live=$(client list | jq '[.[] | select(.state == "running" or .state == "paused")] | length')
  local vms="/sys/fs/cgroup/system.slice/$UNIT.service/vms"
  processes=$(sudo sh -c "cat $vms/*/cgroup.procs 2>/dev/null" | grep -c . || true)
  jails=$(sudo find "$ROOT/zfs/jails/firecracker" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | grep -c . || true)
  slots_free=$(client host | jq .networkSlots.free)
  [ "$jails" -eq "$live" ] || fail "$jails jails for $live live computers"
  [ "$slots_free" -eq $((SLOTS - live)) ] || fail "$slots_free free slots with $live live computers"
  # Each VM is one Firecracker process (the jailer execs into it).
  [ "$processes" -eq "$live" ] || fail "$processes processes in VM cgroups for $live live computers"
}
