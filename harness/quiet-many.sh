#!/usr/bin/env bash
# quiet-many.sh <prefix> <from> <to>: like many.sh, but each run starts only after 90 s
# without a host "neighbor table overflow" line (waits at most 15 min per run).
for i in $(seq "$2" "$3"); do
  T=$(( $(date +%s) + 900 ))
  until [ "$(journalctl -k --since '-90 sec' 2>/dev/null | grep -c 'neighbor table overflow')" -eq 0 ] || [ $(date +%s) -ge $T ]; do sleep 15; done
  ~/.cache/channels-perf-b/run.sh "$1$i"
done
