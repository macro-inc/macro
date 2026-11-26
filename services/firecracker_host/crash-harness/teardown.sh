#!/usr/bin/env bash
# Remove everything setup.sh and run.sh made: computers, the agent's unit,
# its VM cgroups, netns slots, nftables tables, dataset and directory.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
. "$here/env.sh"
. "$here/lib.sh"

if [ -f "/etc/systemd/system/$UNIT.service" ]; then
  start_agent ""
  for id in $(client list | jq -r '.[].computerId'); do
    client destroy "$id" >/dev/null
  done
  stop_agent
  vms="/sys/fs/cgroup/system.slice/$UNIT.service/vms"
  if [ -d "$vms" ]; then
    for leaf in "$vms"/*/; do
      [ -d "$leaf" ] || continue
      echo 1 | sudo tee "$leaf/cgroup.kill" >/dev/null
    done
  fi
  sudo rm -f "/etc/systemd/system/$UNIT.service"
  sudo systemctl daemon-reload
  sudo systemctl reset-failed "$UNIT" 2>/dev/null || true
fi
for slot in $(seq 0 "$SLOTS"); do
  sudo ip netns del "$PREFIX-$slot" 2>/dev/null || true
  sudo ip link del "${PREFIX}v$slot" 2>/dev/null || true
done
sudo nft delete table inet "$PREFIX" 2>/dev/null || true
sudo nft delete table ip "$PREFIX-nat" 2>/dev/null || true
# A dataset whose VM just ended can stay busy for minutes with nothing
# holding it; retry, and leave $ROOT for a later run if it never frees.
deadline=$((SECONDS + 300))
while sudo zfs list -H "$DATASET" >/dev/null 2>&1; do
  sudo zfs destroy -r "$DATASET" 2>/dev/null && break
  [ "$SECONDS" -lt "$deadline" ] || fail "dataset $DATASET still busy; run teardown.sh again later"
  sleep 10
done
sudo rm -rf "$ROOT"
log "teardown done"
